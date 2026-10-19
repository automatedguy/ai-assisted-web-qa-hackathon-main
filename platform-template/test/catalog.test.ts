import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderedDateIssues } from '../src/agents/rendered-checks.js';
import { locateFindings, reconcileFindings } from '../src/orchestrator/reconcile.js';
import { checkBrokenLinks } from '../src/agents/links.js';
import type { QaIssue } from '../src/issues.js';
import type { Observation } from '../src/crawler/rendered.js';
import { sourcePriceCorrection } from '../src/agents/source-price.js';
import { catalogReport } from './catalog-cases.js';

const observation = (text: string, datetime?: string): Observation => ({ id: text, text, datetime,
  selector: '#date', tag: 'time', context: 'Updated', reproduction: { viewport: { width: 390, height: 844 }, steps: [] } });
test('rendered dates preserve valid controls and disambiguate swapped dates using ISO metadata', () => {
  assert.deepEqual(renderedDateIssues([observation('01/10/2026', '2026-10-01'), observation('28/09/2026', '2026-09-28')], 'https://test/', 'DD/MM/YYYY'), []);
  assert.equal(renderedDateIssues([observation('10/01/2026', '2026-10-01')], 'https://test/', 'DD/MM/YYYY')[0].expected, '01/10/2026');
  assert.deepEqual(renderedDateIssues([observation('10/01/2026')], 'https://test/', 'DD/MM/YYYY'), []);
  assert.deepEqual(renderedDateIssues([observation('03/04/2026', '2026-02-31')], 'https://test/', 'DD/MM/YYYY'), []);
  assert.deepEqual(renderedDateIssues([observation('2026-10-01', '2026-10-01')], 'https://test/', 'YYYY-MM-DD'), []);
});

const finding = (overrides: Partial<QaIssue> = {}): QaIssue => ({ id: 'example', category: 'brand_voice', severity: 'minor',
  location: { page_url: 'https://test/', selector_or_xpath: '#intro', element_type: 'text' }, description: 'Rule violation', evidence: 'Greeting slang',
  expected: 'Greeting', suggested_fix: 'Greeting', status: 'new', confidence: 1, ...overrides });
test('catalog evaluation tracks 25 cases independently from raw finding count', () => {
  const empty = catalogReport([]); assert.equal(empty.total,25); assert.equal(empty.detected,0);
  const raw = finding({category:'spelling_grammar',evidence:'1 archivos'});
  const repeated = catalogReport([raw,{...raw,id:'duplicate'}]);
  assert.equal(repeated.detected,1); assert.equal(repeated.results.find(item=>item.id==='QA-08')!.issueIds.length,2);
});
test('reconciliation merges overlapping voice/currency findings without merging independent defects', () => {
  const whole = finding(); const word = finding({ id: 'word', evidence: 'slang', expected: 'Remove slang' });
  const separate = finding({ id: 'separate', evidence: 'Different sentence' });
  assert.deepEqual(reconcileFindings([word, whole, separate]), [whole, separate]);
  const currency = finding({ id: 'currency', category: 'locale_rules', evidence: '$9.99', expected: '9,99 €', assessment: { method: 'model_text', rule: { id: 'currency', value: 'EUR' } } });
  const format = finding({ id: 'format', category: 'formatting', evidence: '$9.99', expected: '9,99 $', assessment: { method: 'model_text', rule: { id: 'currency_format', value: 'EUR' } } });
  const otherCell = { ...format, id: 'other', location: { ...format.location, selector_or_xpath: '#another' } };
  assert.deepEqual(reconcileFindings([format, currency, otherCell]), [currency, otherCell]);
});
test('identical text at independent elements retains both locations and distinct stable IDs', () => {
  const raw = finding({ location: { page_url: 'https://test/', element_type: 'text' } });
  const page = { elements: [ { selector: '#one', text: raw.evidence, tag: 'p', context: '' }, { selector: '#two', text: raw.evidence, tag: 'p', context: '' } ] } as any;
  const result = locateFindings([raw], page);
  assert.equal(result.length, 2); assert.notEqual(result[0].id, result[1].id);
  assert.equal(reconcileFindings(result).length, 2);
});
test('link checks distinguish missing fragments from valid fragments and retain repeated anchor locations', () => {
  const page = { url: 'https://test/', status: 200, sections: { plans: 'Plans' }, links: [
    { text: 'Plans', href: 'https://test/#plans', selector: '#good' },
    { text: 'Old', href: 'https://test/#old', selector: '#bad' },
    { text: 'Old again', href: 'https://test/#old', selector: '#bad2' },
  ] };
  const result = checkBrokenLinks({ startUrl: page.url, pages: [page], responses: [{url:page.url,status:200}], errors:[],limitReached:false } as any);
  assert.equal(result.length, 2); assert(result.every(issue => issue.description.includes('fragment')));
  assert.notEqual(result[0].id, result[1].id);
});

test('source-backed currency fixes preserve each row amount and never use profile example prices', () => {
  const profile = {locale:{target_locale:'es-ES',currency_format:'EUR, symbol after amount, comma decimal (e.g. 19,99 €)'}};
  const source = '- **Starter** — 9.99 €/month — 100 GB\n- **Team** — 19.99 €/month — 1 TB\n- **Business** — 39.99 €/month — 5 TB';
  for (const [entity,amount] of [['Starter','9.99'],['Team','19.99'],['Business','39.99']]) {
    const text = '$'+amount+'/mes';
    const page = {elements:[{tag:'td',text,entity}]} as any;
    assert.equal(sourcePriceCorrection(page,text,profile,source),amount.replace('.',',')+' €/mes');
    assert.equal(sourcePriceCorrection(page,text,profile),undefined);
    assert.equal(sourcePriceCorrection(page,text,profile,source.replace(amount, '99.99')),undefined);
  }
  const yen = {locale:{target_locale:'ja-JP',currency:'JPY',currency_format:'JPY, symbol before amount, no decimal digits'}};
  assert.equal(sourcePriceCorrection({elements:[{tag:'td',text:'USD 250',entity:'Basic'}]} as any,'USD 250',yen,'- **Basic** — 250 JPY/month'),'¥250');
});
