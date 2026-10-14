import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadReference } from '../src/agents/reference-content.js';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';
import type { Findings } from '../src/agents/model-check.js';

test('reference loading respects URL identity and the configured content directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-references-'));
  const root = join(directory, 'mounted-references');
  const previous = process.env.REFERENCE_CONTENT_PATH;
  try {
    await mkdir(root); await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'source.md'), '# Unseen source\nKeep the original meaning.');
    await writeFile(join(directory, 'outside.md'), 'Must not read this.');
    await symlink(join(directory, 'outside.md'), join(root, 'escape.md'));
    await writeFile(join(root, 'empty.md'), '  \n');
    await writeFile(join(root, 'large.md'), 'x'.repeat(24001));
    await mkdir(join(root, 'directory.md'));
    process.env.REFERENCE_CONTENT_PATH = root;
    const origin = 'https://unseen.test/';
    const profile = (path: string, page = '/index.html') => ({ locale: { target_locale: 'de-DE' }, reference_content: [{ page, source_text_path: path }] });
    for (const path of ['reference-content/nested/source.md', 'nested/source.md', join(root, 'nested/source.md')]) {
      assert.equal((await loadReference(origin, origin, profile(path)))!.text, '# Unseen source\nKeep the original meaning.');
    }
    assert(await loadReference(origin + 'nested/', origin, profile('nested/source.md', '/nested/index.html#intro')));
    assert(await loadReference(origin + 'pricing?plan=team', origin, profile('nested/source.md', '/pricing?plan=team#details')));
    assert.equal(await loadReference(origin + 'pricing?plan=other', origin, profile('nested/source.md', '/pricing?plan=team')), null);
    assert.equal(await loadReference(origin, origin, profile('nested/source.md', 'https://other.test/index.html')), null);
    assert.equal(await loadReference(origin + 'unmapped', origin, profile('nested/source.md')), null);
    assert.equal(await loadReference(origin, origin, { locale: { target_locale: 'de-DE' } }), null);
    for (const path of ['../outside.md', join(directory, 'outside.md'), 'escape.md', 'missing.md', 'empty.md', 'large.md', 'directory.md', 'source.txt']) {
      await assert.rejects(loadReference(origin, origin, profile(path)), /Reference|reference/);
    }
    await assert.rejects(loadReference(origin, origin, {
      ...profile('nested/source.md'), reference_content: [
        { page: '/', source_text_path: 'nested/source.md' }, { page: '/index.html', source_text_path: 'nested/source.md' },
      ],
    }), /Multiple reference mappings/);
  } finally {
    if (previous === undefined) delete process.env.REFERENCE_CONTENT_PATH; else process.env.REFERENCE_CONTENT_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('translation workflow compares mapped sources with target evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-translation-'));
  const profilePath = join(directory, 'profile.yaml');
  const sourcePath = join(directory, 'source.md');
  let html = '';
  let findings: Findings['issues'] = [];
  let mode = 'valid';
  let translationCalls = 0;
  let received: any;
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/responses') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const translation = body.text.format.name === 'translation_quality_findings';
      if (translation) { translationCalls++; received = JSON.parse(body.input); }
      if (translation && mode === 'retry' && translationCalls === 1) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Rate limit' } })); return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'resp_mock', object: 'response', status: translation && mode === 'incomplete' ? 'incomplete' : 'completed', model: 'mock-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ issues: translation ? findings : [] }), annotations: [] }] }],
        usage: { input_tokens: 150, output_tokens: 40, total_tokens: 190 },
      })); return;
    }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? '<p>Missing</p>' : html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const names = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LINGUISTIC_ASSET_PATH', 'REFERENCE_CONTENT_PATH', 'OPENAI_INPUT_USD_PER_MILLION', 'OPENAI_OUTPUT_USD_PER_MILLION'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { OPENAI_BASE_URL: origin + '/v1', OPENAI_API_KEY: 'mock', LINGUISTIC_ASSET_PATH: profilePath,
    REFERENCE_CONTENT_PATH: directory, OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_OUTPUT_USD_PER_MILLION: '2' });
  const finding = (kind: Findings['issues'][number]['kind'], source: string, target: string): Findings['issues'][number] => ({
    kind, source_evidence: source, evidence: target, expected: 'Preserve the source meaning.', severity: 'major',
    description: 'The target changes the source meaning.', confidence: 0.95, suggested_fix: 'Use “Annulez à tout moment”.',
  });
  const setup = async (source = 'Cancel anytime.', target = '<p>Annulez à la fin de l’année.</p>', extra = {}) => {
    mode = 'valid'; translationCalls = 0; findings = []; received = undefined; process.env.OPENAI_API_KEY = 'mock';
    html = `<html><body>${target}</body></html>`;
    await writeFile(sourcePath, source);
    await writeFile(profilePath, stringify({ locale: { target_locale: 'fr-FR', source_locale: 'en-GB' },
      reference_content: [{ page: '/index.html', source_text_path: 'reference-content/source.md' }], ...extra }));
  };
  const run = async (previousIssues = [] as ReturnType<typeof createAudit>['issues']) => {
    const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', previousIssues); return audit;
  };
  const worker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'translation-quality')!;
  try {
    await t.test('reports paired evidence, deduplicates and preserves review state', async () => {
      await setup(); findings = [finding('meaning_drift', 'Cancel anytime.', 'Annulez à la fin de l’année.')];
      findings.push({ ...findings[0], kind: 'mistranslation' });
      const audit = await run(); assert.equal(worker(audit).status, 'completed'); assert.equal(audit.issues.length, 1);
      assert.equal(translationCalls, 1); assert.equal(worker(audit).inputTokens, 150); assert.equal(worker(audit).estimatedCostUsd, 0.00023);
      assert.equal(received.sourceLocale, 'en-GB'); assert.equal(received.targetLocale, 'fr-FR');
      assert.equal(received.source.text, 'Cancel anytime.');
      assert.equal(audit.issues[0].category, 'translation_quality');
      assert.equal(audit.issues[0].evidence, 'Source (reference-content/source.md): “Cancel anytime.”\nTarget: “Annulez à la fin de l’année.”');
      assert.equal(audit.issues[0].suggested_fix, 'Use “Annulez à tout moment”.');
      assert.deepEqual(audit.coverage.filter(item => !item.implemented), []);
      audit.issues[0].status = 'verified'; findings[0].description = 'Changed explanation.';
      const next = await run(audit.issues); assert.equal(next.issues[0].status, 'verified');
    });
    await t.test('omissions use a target insertion anchor and additions use source context', async () => {
      await setup('A free trial. Cancel anytime.', '<p>Une période d’essai.</p><p>Annulez à tout moment avec des frais de 10 euros.</p>');
      findings = [finding('omission', 'A free trial.', 'Une période d’essai.'),
        finding('addition', 'Cancel anytime.', 'avec des frais de 10 euros')];
      const audit = await run(); assert.equal(worker(audit).status, 'completed'); assert.equal(audit.issues.length, 2);
      assert.match(audit.issues[0].evidence, /Target insertion anchor \(omitted meaning is absent\)/);
      assert.match(audit.issues[1].evidence, /Source context/);
    });
    await t.test('clean Japanese content with German source uses configured languages and glossary', async () => {
      await setup('Jederzeit kündbar.', '<p>いつでも解約できます。</p>', { locale: { source_locale: 'de-DE', target_locale: 'ja-JP' },
        glossary: { do_not_translate: ['HoshiDrive'] } });
      const audit = await run(); assert.deepEqual(audit.issues, []); assert.equal(worker(audit).status, 'completed');
      assert.equal(received.sourceLocale, 'de-DE'); assert.equal(received.targetLocale, 'ja-JP');
      assert.deepEqual(received.glossary, { do_not_translate: ['HoshiDrive'] });
      await setup('Jederzeit kündbar.', '<p>いつでも解約できます。</p>', { locale: { target_locale: 'ja-JP' } });
      await run(); assert.equal(received.sourceLocale, null);
    });
    await t.test('unmapped pages skip without reading a reference or calling the model', async () => {
      for (const references of [undefined, [], [{ page: '/different', source_text_path: 'missing.md' }]]) {
        await setup('', '<p>Bonjour</p>', { reference_content: references });
        const audit = await run(); assert.equal(worker(audit).status, 'skipped'); assert.equal(worker(audit).attempts, 0);
        assert.equal(worker(audit).estimatedCostUsd, 0); assert.equal(translationCalls, 0);
      }
    });
    await t.test('missing, empty, oversized or ambiguous mapped sources fail before model calls', async () => {
      for (const failure of ['missing', 'empty', 'oversized', 'ambiguous']) {
        await setup(failure === 'empty' ? '  ' : failure === 'oversized' ? 'x'.repeat(24001) : 'Source.');
        if (failure === 'missing') await rm(sourcePath);
        if (failure === 'ambiguous') await writeFile(profilePath, stringify({ locale: { target_locale: 'fr-FR' }, reference_content: [
          { page: '/', source_text_path: 'source.md' }, { page: '/index.html', source_text_path: 'source.md' },
        ] }));
        const audit = await run(); assert.equal(worker(audit).status, 'failed'); assert.equal(worker(audit).attempts, 0);
        assert.equal(translationCalls, 0); assert.equal(worker(audit).estimatedCostUsd, 0);
        assert.equal(audit.status, 'partial');
      }
    });
    await t.test('rejects fabricated source/target evidence, missing evidence and unknown kinds', async () => {
      for (const invalid of [finding('meaning_drift', 'Invented source.', 'Annulez à la fin de l’année.'),
        finding('meaning_drift', 'Cancel anytime.', 'Invented target.'),
        { ...finding('meaning_drift', 'Cancel anytime.', 'Annulez à la fin de l’année.'), source_evidence: undefined },
        { ...finding('meaning_drift', 'Cancel anytime.', 'Annulez à la fin de l’année.'), kind: 'grammar' as any }]) {
        await setup('Cancel anytime.', '<p>Annulez à la fin de l’année.</p><a href="/missing">Details</a>'); findings = [invalid];
        const audit = await run(); assert.equal(worker(audit).status, 'failed'); assert.equal(worker(audit).issueCount, 0);
        assert.equal(audit.issues.length, 1); assert.equal(audit.issues[0].category, 'links');
      }
    });
    await t.test('oversized targets, missing credentials and incomplete responses fail visibly', async () => {
      for (const failure of ['oversized-target', 'missing-key', 'incomplete']) {
        await setup();
        if (failure === 'missing-key') delete process.env.OPENAI_API_KEY;
        if (failure === 'oversized-target') html += 'x'.repeat(24001);
        if (failure === 'incomplete') mode = 'incomplete';
        const audit = await run(); assert.equal(worker(audit).status, 'failed'); assert.equal(audit.status, 'partial');
        assert.deepEqual(audit.issues, []);
        assert.equal(translationCalls, failure === 'incomplete' ? 1 : 0);
      }
    });
    await t.test('retries transient failures and marks incomplete usage', async () => {
      await setup(); mode = 'retry';
      const audit = await run(); assert.equal(translationCalls, 2); assert.equal(worker(audit).attempts, 2);
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
