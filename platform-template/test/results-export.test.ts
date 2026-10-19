import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportResults } from '../src/results-export.js';
import type { Audit } from '../src/orchestrator/audit.js';
import { mkdtemp, writeFile, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'cheerio';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');

const run = (): Audit => ({
  id: 'saved-run', kind: 'audit', siteUrl: 'https://example.test/', status: 'partial', phase: 'Finished',
  startedAt: '2026-10-19T12:00:00.000Z', finishedAt: '2026-10-19T12:01:00.000Z', durationMs: 60000,
  targetLocale: 'fr-FR', workers: [], coverage: [], error: 'Some checks failed.',
  issues: [{ id: 'finding-1', category: 'translation_quality', severity: 'major', status: 'verified', confidence: .9,
    location: { page_url: 'https://example.test/pricing', selector_or_xpath: '#price', element_type: 'text' },
    description: 'Écart de prix, "offre"', evidence: 'Ligne 1\nLigne 2, "quoted" — 日本語',
    expected: '19,99 €', suggested_fix: 'Afficher le prix correct.',
    assessment: { method: 'model_text', rule: { id: 'currency', value: 'EUR' } },
    visual_evidence: { screenshot_url: '/api/screenshots/saved.png', highlighted: true },
    reproduction: { viewport: { width: 390, height: 844 }, steps: [{ action: 'click', selector: '#pricing' }] },
  }],
});

// Parse quoted RFC 4180 records, including embedded newlines and escaped quotes.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  return rows;
}

test('HTML report embeds available screenshots and retains evidence, partial coverage and reviews offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-report-'));
  try {
  await writeFile(join(directory, 'saved.png'), png);
  const audit = run(), before = structuredClone(audit);
  const reviews = [{ issueId: 'finding-1', previousStatus: 'new', status: 'verified', reviewedAt: audit.finishedAt }];
  const file = await exportResults(audit, 'html', reviews, directory, '2026-10-20T12:00:00.000Z');
  const $ = load(file.body);
  assert.equal($('img').attr('src'), 'data:image/png;base64,' + png.toString('base64'));
  assert.equal($('.finding').length, 1);
  assert.equal($('.finding blockquote').text(), audit.issues[0].evidence);
  assert.equal($('.finding h3').text(), audit.issues[0].description);
  assert.match($('#overview').text(), /2026-10-20T12:00:00.000Z/);
  assert.match($('#overview').text(), /incomplete coverage/);
  assert.match($('#reviews').text(), /finding-1.*new.*verified/);
  assert.match($('.finding').text(), /19,99 €/);
  assert.match($('.finding').text(), /click: #pricing/);
  assert.equal($('script, link, iframe').length, 0);
  assert.equal($('[src]').not('img').length, 0);
  assert.deepEqual(audit, before);
  assert.match(file.contentType, /text\/html/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CSV exports every finding, Unicode, multiline evidence, quotes, review status and optional fields', async () => {
  const audit = run();
  audit.issues.push({ ...audit.issues[0], id: 'finding-2', category: 'links', status: 'dismissed',
    assessment: undefined, reproduction: undefined, visual_evidence: undefined, confidence: 0 });
  const file = await exportResults(audit, 'csv', [], '/unused');
  assert.equal(file.body.charCodeAt(0), 0xFEFF);
  const [headers, ...rows] = parseCsv(file.body);
  assert.equal(rows.length, 2); rows.forEach(row => assert.equal(row.length, headers.length));
  const first = Object.fromEntries(headers.map((name, i) => [name, rows[0][i]]));
  const second = Object.fromEntries(headers.map((name, i) => [name, rows[1][i]]));
  assert.equal(first.evidence, audit.issues[0].evidence); assert.equal(first.description, audit.issues[0].description);
  assert.equal(first.run_status, 'partial'); assert.equal(first.status, 'verified');
  assert.equal(first.rule_value, 'EUR'); assert.equal(first.screenshot_path, '/api/screenshots/saved.png');
  assert.deepEqual(JSON.parse(first.reproduction_json), audit.issues[0].reproduction);
  assert.equal(second.status, 'dismissed'); assert.equal(second.category, 'links');
  assert.equal(second.confidence, '0'); assert.equal(second.rule_value, ''); assert.equal(second.screenshot_path, '');
});

test('CSV neutralizes spreadsheet formulas while HTML preserves original evidence; empty runs still export', async () => {
  for (const payload of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', '\t=1+1', '\r=1', '\n=1', '  =1+1', '\uFEFF=1']) {
    const audit = run(); audit.issues[0].evidence = payload;
    const [headers, row] = parseCsv((await exportResults(audit, 'csv', [], '/unused')).body);
    assert.equal(row[headers.indexOf('evidence')], "'" + payload);
    assert.equal(load((await exportResults(audit, 'html', [], '/missing')).body)('.finding blockquote').text(), payload.replaceAll('\r', '\n'));
  }
  const audit = run(); audit.issues = []; audit.id = '../../bad\r\n"id';
  const file = await exportResults(audit, 'csv', [], '/unused');
  assert.equal(parseCsv(file.body).length, 1);
  assert.match(file.filename, /^skynet-results-[a-zA-Z0-9_-]+\.csv$/);
  assert.match((await exportResults(audit, 'html', [], '/missing')).body, /No findings were recorded/);
});

test('HTML escapes untrusted evidence and URLs; missing, external, traversing and symlinked screenshots never expose files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-report-paths-'));
  try {
    const root = join(directory, 'screenshots'); await mkdir(root);
    await writeFile(join(directory, 'outside.png'), png);
    await symlink(join(directory, 'outside.png'), join(root, 'escape.png'));
    await writeFile(join(root, 'invalid.png'), '<svg onload="alert(1)">not a screenshot</svg>');
    const audit = run();
    audit.issues[0].description = '<script>window.injected=true</script>';
    audit.issues[0].evidence = '</blockquote><img src="https://evil.test/track" onerror="alert(1)">';
    audit.issues[0].location.page_url = 'javascript:alert(1)';
    const paths = ['/api/screenshots/missing.png', 'https://evil.test/image.png', '/api/screenshots/../outside.png',
      '/api/screenshots/%2e%2e%2foutside.png', '/api/screenshots/escape.png', '/api/screenshots/invalid.png', ''];
    audit.issues = paths.map((path, i) => ({ ...audit.issues[0], id: `finding-${i}`, visual_evidence: { screenshot_url: path, highlighted: false } }));
    const $ = load((await exportResults(audit, 'html', [], root)).body);
    assert.equal($('.finding').length, paths.length);
    assert.equal($('script,img,iframe').length, 0);
    assert.equal($('a[href^="javascript:"]').length, 0);
    assert.equal($('.finding h3').first().text(), audit.issues[0].description);
    assert.equal($('.finding blockquote').first().text(), audit.issues[0].evidence);
    assert.equal($('.unavailable').length, paths.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
