import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { brandTerminologyRules } from '../src/agents/brand-terminology.js';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';
import type { Findings } from '../src/agents/model-check.js';

test('shared prohibitions have one owner without dropping brand-only rules', () => {
  const rules = brandTerminologyRules({
    locale: { target_locale: 'de-DE' },
    brand_voice: { tone: ' ', forbidden_terms: [' BILLIG ', 'locker', 'ＳＡＬＥ'], style_rules: [] },
    glossary: { banned_terms: ['billig', 'sale'], do_not_translate: ['', null], preferred_terms: { '': 'invalid', valid: '' } },
  });
  assert.deepEqual(rules, [
    { id: 'brand_voice.forbidden_terms', category: 'brand_voice', value: ['locker'] },
    { id: 'glossary.banned_terms', category: 'terminology', value: ['billig', 'sale'] },
  ]);
});

test('brand and terminology workflow with alternate profiles and a local model', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-brand-'));
  const profilePath = join(directory, 'profile.yaml');
  let html = '';
  let findings: Findings['issues'] = [];
  let mode = 'valid';
  let brandCalls = 0;
  let received: { targetLocale: string; rules: ReturnType<typeof brandTerminologyRules>; page: { text: string } } | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/responses') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const brand = ['brand_voice_findings', 'terminology_findings'].includes(body.text.format.name);
      if (brand) { brandCalls++; received = JSON.parse(body.input); }
      if (brand && mode === 'retry' && brandCalls === 1) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Rate limit' } })); return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      const input = brand ? JSON.parse(body.input) : undefined;
      const responseFindings = brand && findings.length === 1 ? findings : (brand ? findings.filter(finding => input.rules.some((rule: any) => rule.id === finding.rule)) : []);
      response.end(JSON.stringify({
        id: 'resp_mock', object: 'response', status: brand && mode === 'incomplete' ? 'incomplete' : 'completed', model: 'mock-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ issues: responseFindings }), annotations: [] }] }],
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
      })); return;
    }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? '<p>Missing</p>' : html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const names = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LINGUISTIC_ASSET_PATH', 'OPENAI_INPUT_USD_PER_MILLION', 'OPENAI_OUTPUT_USD_PER_MILLION'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { OPENAI_BASE_URL: origin + '/v1', OPENAI_API_KEY: 'mock', LINGUISTIC_ASSET_PATH: profilePath,
    OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_OUTPUT_USD_PER_MILLION: '2' });
  const finding = (rule: string, evidence: string, replacement = 'Use the configured wording.'): Findings['issues'][number] => ({
    rule, evidence, expected: replacement, severity: 'minor', description: 'The content violates the configured rule.', confidence: 0.95, suggested_fix: replacement,
  });
  const setup = async (profile: Record<string, unknown>, text = '<p>Bonjour ami</p>') => {
    mode = 'valid'; brandCalls = 0; findings = []; received = undefined; process.env.OPENAI_API_KEY = 'mock';
    html = `<html><body>${text}</body></html>`;
    await writeFile(profilePath, stringify({ locale: { target_locale: 'fr-FR' }, ...profile }));
  };
  const run = async (previousIssues = [] as ReturnType<typeof createAudit>['issues']) => {
    const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', previousIssues); return audit;
  };
  const worker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'brand-voice')!;
  const terminologyWorker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'terminology')!;
  try {
    await t.test('routes rules to both categories, deduplicates findings, tracks usage and retains review status', async () => {
      await setup({
        brand_voice: { tone: 'formal and concise', style_rules: ['Use active voice'], forbidden_terms: ['nul', 'coucou'] },
        glossary: { banned_terms: ['nul'], do_not_translate: ['CloudNest'], preferred_terms: { 'cloud storage': 'stockage en ligne' } },
      }, '<p>Coucou mon pote ! Ce produit est nul.</p><p>Utilisez NidNuage et stockage nuage.</p><p>Le fichier est enregistré par le service.</p>');
      findings = [finding('brand_voice.tone', 'mon pote'), finding('brand_voice.style_rules', 'Le fichier est enregistré par le service.'),
        finding('brand_voice.forbidden_terms', 'Coucou'), finding('glossary.banned_terms', 'nul'), finding('glossary.banned_terms', 'nul'),
        finding('glossary.do_not_translate', 'NidNuage', 'Use the protected name “CloudNest”.'),
        finding('glossary.preferred_terms', 'stockage nuage', 'Use “stockage en ligne”.')];
      const audit = await run();
      assert.equal(brandCalls, 2); assert.equal(worker(audit).status, 'completed'); assert.equal(worker(audit).issueCount, 3);
      assert.equal(terminologyWorker(audit).status, 'completed'); assert.equal(terminologyWorker(audit).issueCount, 3);
      assert.deepEqual(worker(audit).categories, ['brand_voice']);
      assert.equal(worker(audit).inputTokens, 120); assert.equal(worker(audit).estimatedCostUsd, 0.00018);
      assert.equal(received!.targetLocale, 'fr-FR');
      assert(received!.rules.some(rule => rule.id === 'brand_voice.forbidden_terms' || rule.id === 'glossary.banned_terms'));
      assert.deepEqual(audit.issues.map(issue => issue.category).sort(), ['brand_voice', 'brand_voice', 'brand_voice', 'terminology', 'terminology', 'terminology']);
      assert.equal(audit.issues.find(issue => issue.evidence === 'stockage nuage')!.suggested_fix, 'Use “stockage en ligne”.');
      assert.deepEqual(audit.issues.find(issue => issue.evidence === 'stockage nuage')!.assessment, {
        method: 'model_text', rule: { id: 'glossary.preferred_terms', value: '{"cloud storage":"stockage en ligne"}' },
      });
      assert(terminologyWorker(audit).rules?.some(rule => rule.id === 'glossary.preferred_terms'));
      assert(terminologyWorker(audit).startedAt); assert(terminologyWorker(audit).finishedAt);
      assert(audit.issues.every(issue => audit.crawl!.pages[0].text.includes(issue.evidence)));
      const reviewed = audit.issues.find(issue => issue.evidence === 'nul')!; reviewed.status = 'dismissed';
      findings = findings.map(issue => ({ ...issue, description: 'Reworded explanation.' }));
      const next = await run(audit.issues);
      assert.equal(next.issues.find(issue => issue.id === reviewed.id)!.status, 'dismissed');
      assert.deepEqual(next.coverage.filter(item => !item.implemented), []);
    });
    await t.test('accepts clean Japanese content and preserves an unseen glossary', async () => {
      await setup({ locale: { target_locale: 'ja-JP' }, brand_voice: { tone: 'polite' },
        glossary: { do_not_translate: ['HoshiDrive'], preferred_terms: { 'shared folder': '共有フォルダー' } },
      }, '<p>HoshiDrive の共有フォルダーをご利用ください。</p>');
      const audit = await run(); assert.deepEqual(audit.issues, []); assert.equal(worker(audit).status, 'completed');
      assert.equal(received!.targetLocale, 'ja-JP');
      assert.deepEqual(received!.rules.find(rule => rule.id === 'glossary.preferred_terms')!.value, { 'shared folder': '共有フォルダー' });
    });
    await t.test('supports either section independently without inventing rules for the other', async () => {
      for (const [profile, rule, category] of [
        [{ brand_voice: { tone: 'formal' } }, 'brand_voice.tone', 'brand_voice'],
        [{ glossary: { banned_terms: ['ami'] } }, 'glossary.banned_terms', 'terminology'],
      ] as const) {
        await setup(profile); findings = [finding(rule, 'ami')]; const audit = await run();
        assert.equal(worker(audit).status === 'completed' || terminologyWorker(audit).status === 'completed', true); assert.equal(audit.issues[0].category, category);
        assert.equal(received!.rules.length, 1);
      }
    });
    await t.test('skips missing, empty and unsupported policies without a request', async () => {
      for (const profile of [{}, { brand_voice: {}, glossary: {} },
        { brand_voice: { tone: '', style_rules: [], future_policy: 'unknown' }, glossary: { banned_terms: [], preferred_terms: {} } }]) {
        await setup(profile); const audit = await run();
        assert.equal(brandCalls, 0); assert.equal(worker(audit).status, 'skipped'); assert.equal(terminologyWorker(audit).status, 'skipped'); assert.equal(worker(audit).attempts, 0);
        assert.equal(worker(audit).estimatedCostUsd, 0); assert.deepEqual(audit.issues, []);
      }
    });
    await t.test('rejects unconfigured rules and invented evidence while retaining sibling findings', async () => {
      for (const invalid of [finding('glossary.banned_terms', 'ami'), finding('brand_voice.tone', 'invented evidence')]) {
        await setup({ brand_voice: { tone: 'formal' } }, '<p>Bonjour ami</p><a href="/missing">Details</a>');
        findings = [invalid]; const audit = await run();
        assert.equal(worker(audit).status === 'failed' || terminologyWorker(audit).status === 'failed', true); assert.equal(worker(audit).issueCount, 0);
        assert.equal(audit.issues.length, 1); assert.equal(audit.issues[0].category, 'links');
      }
    });
    await t.test('missing credentials and incomplete responses fail visibly', async () => {
      for (const failure of ['missing-key', 'incomplete']) {
        await setup({ brand_voice: { tone: 'formal' } });
        if (failure === 'missing-key') delete process.env.OPENAI_API_KEY;
        else mode = 'incomplete';
        const audit = await run(); assert.equal(worker(audit).status === 'failed' || terminologyWorker(audit).status === 'failed', true); assert.equal(audit.status, 'partial');
        assert.deepEqual(audit.issues, []);
        if (failure === 'missing-key') assert.equal(brandCalls, 0);
      }
    });
    await t.test('retries transient failures and marks incomplete usage', async () => {
      await setup({ brand_voice: { tone: 'formal' } }); mode = 'retry';
      const audit = await run(); assert.equal(brandCalls, 2); assert.equal(worker(audit).attempts, 2);
      assert.equal(worker(audit).status, 'completed'); assert.equal(worker(audit).usageComplete, false);
      assert.equal(worker(audit).estimatedCostUsd, null);
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
