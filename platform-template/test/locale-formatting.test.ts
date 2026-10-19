import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { checkDateFormat } from '../src/agents/date-format.js';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';
import type { Findings } from '../src/agents/model-check.js';

test('numeric dates follow explicit patterns without guessing ambiguous dates', () => {
  const check = (text: string, format?: string) => checkDateFormat(text, 'https://example.test/', format).issues;
  assert.equal(check('03/14/2026', 'DD/MM/YYYY')[0].expected, '14/03/2026');
  assert.equal(check('14/03/2026', 'MM/DD/YYYY')[0].expected, '03/14/2026');
  assert.equal(check('14/03/2026', 'YYYY-MM-DD')[0].expected, '2026-03-14');
  assert.equal(check('2026-03-14', 'DD.MM.YYYY')[0].expected, '14.03.2026');
  assert.deepEqual(check('03/04/2026 29/02/2024', 'DD/MM/YYYY'), []);
  assert.match(check('03/04/2026', 'YYYY-MM-DD')[0].expected!, /confirm the intended date/);
  assert.equal(check('29/02/2025', 'DD/MM/YYYY').length, 1);
  assert.equal(check('1/3/2026', 'DD/MM/YYYY')[0].suggested_fix!.includes('Confirm'), true);
  assert.deepEqual(check('03/14/2026'), []);
  assert.deepEqual(check('March 14, 2026', 'D MMMM YYYY'), []); // Model handles prose patterns.
  assert.deepEqual(check('ID123/12/2026 https://example.test/2026-03-14', 'DD/MM/YYYY'), []);
  assert.equal(check('03/14/2026 and 03/14/2026', 'DD/MM/YYYY').length, 1);
});

test('locale and formatting workflow with alternate profiles and a local model', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-locale-'));
  const profilePath = join(directory, 'profile.yaml');
  let html = '';
  let mode = 'valid';
  let findings: Findings['issues'] = [];
  let received: any;
  let localeCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/responses') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const locale = ['locale_findings', 'formatting_findings'].includes(body.text.format.name);
      if (locale) { received = JSON.parse(body.input); localeCalls++; }
      if (locale && mode === 'retry' && localeCalls === 1) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Rate limit' } })); return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      const input = locale ? JSON.parse(body.input) : undefined;
      const responseFindings = locale ? findings.filter(finding => input.rules.some((rule: any) => rule.id === finding.rule)) : [];
      response.end(JSON.stringify({
        id: 'resp_mock', object: 'response', status: mode === 'incomplete' && locale ? 'incomplete' : 'completed', model: 'mock-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ issues: responseFindings }), annotations: [] }] }],
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
      })); return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }); response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const names = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LINGUISTIC_ASSET_PATH', 'OPENAI_INPUT_USD_PER_MILLION', 'OPENAI_OUTPUT_USD_PER_MILLION'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { OPENAI_BASE_URL: origin + '/v1', OPENAI_API_KEY: 'mock', LINGUISTIC_ASSET_PATH: profilePath,
    OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_OUTPUT_USD_PER_MILLION: '2' });
  const finding = (rule: string, evidence: string, expected = 'Follow the configured rule.'): Findings['issues'][number] => ({
    rule, evidence, expected, severity: 'minor', description: 'The content violates the configured rule.', confidence: 0.95, suggested_fix: expected,
  });
  const setup = async (locale: Record<string, unknown>, text: string, extra = {}) => {
    mode = 'valid'; localeCalls = 0; findings = []; received = undefined;
    process.env.OPENAI_API_KEY = 'mock'; html = `<html><body>${text}</body></html>`;
    await writeFile(profilePath, stringify({ locale, ...extra }));
  };
  const run = async (previousIssues = [] as ReturnType<typeof createAudit>['issues']) => {
    const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', previousIssues); return audit;
  };
  const worker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'formatting')!;
  const localeWorker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'locale')!;
  try {
    await t.test('routes both categories, removes overlaps and preserves review status', async () => {
      await setup({ target_locale: 'ja-JP', date_format: 'YYYY-MM-DD', currency_format: 'JPY, symbol before amount, no decimal digits', measurement_units: 'metric' },
        '<p>日付: 14/03/2026</p><p>料金: USD 19.99</p><p>重さ: 2 lb</p><p>料金: ¥20.50</p>');
      findings = [finding('currency', 'USD 19.99'), finding('currency_format', 'USD 19.99'), finding('measurement_units', '2 lb'),
        finding('currency_format', '¥20.50'), finding('date_format', '14/03/2026')];
      const audit = await run();
      assert.equal(worker(audit).status, 'completed'); assert.equal(worker(audit).issueCount, 2);
      assert.deepEqual(worker(audit).categories, ['formatting']);
      assert.equal(localeWorker(audit).status, 'completed'); assert.equal(localeWorker(audit).issueCount, 2);
      assert.equal(worker(audit).estimatedCostUsd, 0.00018);
      assert.equal(received.targetLocale, 'ja-JP');
      assert.deepEqual(received.checkedDates, ['14/03/2026']);
      assert.deepEqual(audit.issues.map(issue => issue.category).sort(), ['formatting', 'formatting', 'locale_rules', 'locale_rules']);
      assert(audit.issues.every(issue => audit.crawl!.pages[0].text.includes(issue.evidence)));
      assert.equal(audit.issues.find(issue => issue.evidence === '14/03/2026')?.expected, '2026-03-14');
      assert.deepEqual(audit.issues.find(issue => issue.evidence === '14/03/2026')?.assessment, {
        method: 'deterministic', rule: { id: 'date_format', value: 'YYYY-MM-DD' },
      });
      assert.deepEqual(audit.issues.find(issue => issue.evidence === '2 lb')?.assessment, {
        method: 'model_text', rule: { id: 'measurement_units', value: 'metric' },
      });
      audit.issues[0].status = 'verified'; const next = await run(audit.issues);
      assert.equal(next.issues.find(issue => issue.id === audit.issues[0].id)?.status, 'verified');
    });
    await t.test('accepts clean US currency, imperial units, and month-first dates', async () => {
      await setup({ target_locale: 'en-US', date_format: 'MM/DD/YYYY', currency_format: 'USD, symbol before amount, dot decimal', measurement_units: 'imperial' },
        '<p>Updated: 03/14/2026. Price: $19.99. Weight: 2 lb.</p>');
      // A redundant model date finding must not override a clean deterministic result.
      findings = [finding('date_format', '03/14/2026')];
      const audit = await run(); assert.deepEqual(audit.issues, []); assert.equal(worker(audit).status, 'completed');
      assert.equal(localeWorker(audit).status, 'completed');
    });
    await t.test('supports explicit number, address, phone and capitalization rules', async () => {
      await setup({ target_locale: 'fr-FR', number_format: 'comma decimal', address_format: 'postcode before city', phone_format: 'international +33', capitalization: 'sentence case headings' },
        '<p>Nombre: 1.5</p><h1>TOUT EN MAJUSCULES</h1><p>Paris 75001</p><p>020 1234 5678</p>');
      findings = [finding('number_format', '1.5'), finding('capitalization', 'TOUT EN MAJUSCULES'), finding('address_format', 'Paris 75001'), finding('phone_format', '020 1234 5678')];
      const audit = await run(); assert.equal(audit.issues.length, 4); assert.equal(worker(audit).status, 'completed'); assert.equal(localeWorker(audit).status, 'completed');
      assert(!received.rules.some((rule: any) => rule.id === 'currency'));
    });
    await t.test('does not infer policies when optional rules are absent', async () => {
      await setup({ target_locale: 'de-DE' }, '<p>03/14/2026 $19.99 2 lb</p>');
      const audit = await run(); assert.equal(localeCalls, 1); assert.deepEqual(audit.issues, []);
      assert.equal(worker(audit).status, 'skipped'); assert.equal(localeWorker(audit).status, 'completed'); assert.equal(worker(audit).estimatedCostUsd, 0);
    });
    await t.test('rejects unconfigured rules and invented evidence but keeps deterministic dates', async () => {
      for (const invalid of [finding('measurement_units', '2 lb'), finding('date_format', 'fabricated text')]) {
        await setup({ target_locale: 'fr-FR', date_format: 'DD/MM/YYYY' }, '<p>03/14/2026 2 lb</p>'); findings = [invalid];
        const audit = await run();
        assert.equal(audit.issues.length, 1); assert.equal(audit.issues[0].expected, '14/03/2026');
      }
    });
    await t.test('model failures retain dates and leave coverage visibly partial', async () => {
      for (const failure of ['missing-key', 'incomplete', 'oversize']) {
        await setup({ target_locale: 'fr-FR', date_format: 'DD/MM/YYYY' }, '<p>03/14/2026</p>');
        if (failure === 'missing-key') delete process.env.OPENAI_API_KEY;
        if (failure === 'incomplete') mode = 'incomplete';
        if (failure === 'oversize') html += 'x'.repeat(24001);
        const audit = await run(); assert.equal(audit.status, 'partial'); assert.equal(worker(audit).status, 'failed');
        assert.equal(audit.issues.length, 1); assert.equal(worker(audit).issueCount, 1);
      }
    });
    await t.test('retries transient failures and tracks unknown usage', async () => {
      await setup({ target_locale: 'fr-FR', measurement_units: 'metric' }, '<p>1 kg</p>'); mode = 'retry';
      const audit = await run(); assert.equal(localeCalls, 2); assert.equal(localeWorker(audit).attempts, 2);
      assert.equal(localeWorker(audit).status, 'completed'); assert.equal(localeWorker(audit).usageComplete, false);
      assert.equal(localeWorker(audit).estimatedCostUsd, null);
    });
    await t.test('crawler separates blocks while preserving inline word fragments', async () => {
      await setup({ target_locale: 'es-ES' }, '<dl><dt>Miles</dt><dd>de equipos</dd></dl><p>in<strong>line</strong><br>next</p><table><tr><td>Plan</td><td>$19.99</td></tr></table>');
      const audit = await run(); assert.equal(audit.crawl!.pages[0].text, 'Miles de equipos inline next Plan $19.99');
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
