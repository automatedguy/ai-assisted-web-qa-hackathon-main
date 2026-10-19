import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CrawledPage } from '../src/crawler/crawl.js';
import type { QaIssue } from '../src/issues.js';
import { reconcileFindings } from '../src/orchestrator/reconcile.js';

function fixture(prices = ['$9.99/mes', '$19.99/mes', '$39.99/mes']) {
  const names = ['Starter', 'Team', 'Business'];
  const rows = prices.map((price, index) => `${names[index]} ${price} ${index + 1} TB`);
  const page: CrawledPage = { url: 'https://example.test/pricing', text: rows.join(' '), status: 200, title: 'Plans', language: 'es',
    links: [], images: [], videos: [], tracks: [], elements: prices.map((price, index) => ({
      selector: `#price-${index}`, tag: 'td', entity: names[index], text: price, context: rows[index], ancestors: [`#row-${index}`],
    })) };
  const locale: QaIssue[] = prices.map((price, index) => ({ id: `currency-${index}`, category: 'locale_rules', severity: 'major',
    location: { page_url: page.url, selector_or_xpath: `#price-${index}`, element_type: 'text' },
    assessment: { method: 'model_text', rule: { id: 'currency', value: 'EUR' } },
    evidence: price, description: 'Wrong currency for this plan.', expected: `${[9.99, 19.99, 39.99][index]} EUR`,
    suggested_fix: `Source-backed correction for ${names[index]}`, status: ['verified', 'dismissed', 'escalated'][index] as QaIssue['status'], confidence: 0.99,
  }));
  const format: QaIssue = { id: 'grouped-format', category: 'formatting', severity: 'minor',
    location: { page_url: page.url, element_type: 'text' },
    assessment: { method: 'model_text', rule: { id: 'currency_format', value: 'EUR, comma decimal, symbol after amount' } },
    evidence: page.text, description: 'All prices have incorrect notation.', expected: 'Keep dollars and change notation.',
    suggested_fix: '9,99 $, 19,99 $, 39,99 $', status: 'new', confidence: 1 };
  return { page, locale, format };
}

test('grouped formatting is absorbed into all three per-plan Locale findings, preserving corrections and decisions', () => {
  const { page, locale, format } = fixture();
  const before = structuredClone(locale);
  const result = reconcileFindings([format, ...locale], [page]);
  assert.deepEqual(result.map(issue => issue.id), locale.map(issue => issue.id));
  for (const [index, issue] of result.entries()) {
    assert.deepEqual({ ...issue, description: before[index].description }, before[index]);
    assert.match(issue.description, /also violates currency notation/);
    assert.doesNotMatch(issue.suggested_fix!, /\$/);
  }
  reconcileFindings([format, ...result], [page]);
  assert(result.every(issue => issue.description.match(/also violates currency notation/g)?.length === 1));
});

test('individual and grouped formatting responses produce equivalent per-plan results in either worker order', () => {
  const grouped = fixture(); const individual = fixture();
  const formats = individual.locale.map((issue, index) => ({ ...individual.format, id: `format-${index}`,
    evidence: issue.evidence, location: issue.location }));
  const expected = reconcileFindings([...grouped.locale, grouped.format], [grouped.page]);
  assert.deepEqual(reconcileFindings([...formats, ...individual.locale], [individual.page]), expected);
});

test('an uncovered price or absent Locale worker leaves the grouped formatting finding intact', () => {
  const { page, locale, format } = fixture();
  assert.equal(reconcileFindings([format, ...locale.slice(0, 2)], [page]).length, 3);
  assert(locale.every(issue => !issue.description.includes('also violates')));
  assert.deepEqual(reconcileFindings([format], [page]), [format]);
});

test('equal prices in independent rows stay separate and cannot cover each other', () => {
  const { page, locale, format } = fixture(['$9.99/mes', '$9.99/mes', '$39.99/mes']);
  assert.equal(reconcileFindings([format, locale[0], locale[2]], [page]).length, 3);
  assert.deepEqual(reconcileFindings([format, ...locale], [page]).map(issue => issue.id), locale.map(issue => issue.id));
  const individual = { ...format, evidence: locale[1].evidence, location: locale[1].location };
  assert.deepEqual(reconcileFindings([individual, ...locale], [page]), locale);
});

test('matching amounts on other pages, elements or browser states do not suppress a finding', () => {
  for (const change of ['page', 'selector', 'state']) {
    const { page, locale, format } = fixture();
    if (change === 'page') locale[1].location.page_url = 'https://example.test/other';
    if (change === 'selector') locale[1].location.selector_or_xpath = '#unrelated';
    if (change === 'state') locale[1].reproduction = { viewport: { width: 390, height: 844 }, steps: [] };
    assert(reconcileFindings([format, ...locale], [page]).includes(format));
  }
});

test('ambiguous contexts, duplicate Locale candidates and unmarked decimal prices fail closed', () => {
  const { page, locale, format } = fixture();
  const repeated = { ...page, text: `${page.text} ${page.text}` };
  assert(reconcileFindings([format, ...locale], [repeated]).includes(format));
  const duplicate = { ...locale[0], id: 'conflicting-locale', expected: 'Different correction' };
  assert(reconcileFindings([format, ...locale, duplicate], [page]).includes(format));
  const barePrice = { ...format, evidence: format.evidence + ' Extra plan 49.99/mes' };
  assert(reconcileFindings([barePrice, ...locale], [{ ...page, text: barePrice.evidence }]).includes(barePrice));
});

test('whole amounts are matched, including ISO codes, suffix symbols and grouped thousands', () => {
  const { page, locale, format } = fixture(['USD 1,299.99/mes', '19,99 $/mes', 'CHF 39.99/mes']);
  assert.deepEqual(reconcileFindings([format, ...locale], [page]), locale);
  locale[0].evidence = '299.99';
  assert(reconcileFindings([format, ...locale], [page]).includes(format));
});

test('unrelated formatting rules and reviews are untouched', () => {
  const { page, locale, format } = fixture();
  const date = { ...format, id: 'date', assessment: { method: 'deterministic' as const, rule: { id: 'date_format', value: 'DD/MM/YYYY' } } };
  assert.deepEqual(reconcileFindings([...locale, date], [page]), [...locale, date]);
  assert(reconcileFindings([format, ...locale], []).includes(format));
});
