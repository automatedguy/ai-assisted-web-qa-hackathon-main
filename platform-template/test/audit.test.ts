import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';

// The fake API is local. These checks never load .env or contact OpenAI.
test('audit workflow with an unseen profile and simulated model', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-audit-'));
  let mode = 'valid';
  let calls = 0;
  let receivedLocale = '';
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/responses') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const formatName = JSON.parse(body).text.format.name;
      if (['brand_voice_findings', 'terminology_findings', 'locale_findings'].includes(formatName)) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'resp_brand', object: 'response', status: 'completed', model: 'mock-model',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"issues":[]}', annotations: [] }] }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        })); return;
      }
      if (formatName !== 'spelling_grammar_findings') return response.end(JSON.stringify({ issues: [] }));
      calls++; // Spelling & Grammar calls; specialized policy agents have their own fixtures.
      receivedLocale = JSON.parse(JSON.parse(body).input).targetLocale;
      if (mode === 'retry' && calls === 1) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Simulated rate limit' } })); return;
      }
      const issues = mode === 'clean' ? [] : [{
        severity: 'minor', description: 'Agreement error.', evidence: mode === 'invalid' ? 'invented evidence' : 'Bonjour faute',
        expected: 'Bonjour', confidence: 0.9, suggested_fix: 'Bonjour',
      }];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'resp_mock', object: 'response', status: 'completed', model: 'mock-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ issues }), annotations: [] }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
          input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 } },
      })); return;
    }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? '<html><body>Missing</body></html>' : '<html lang="fr"><title>Example</title><body><p>Bonjour faute</p><a href="/missing">Plans</a></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const profilePath = join(directory, 'profile.yaml');
  const names = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LINGUISTIC_ASSET_PATH', 'OPENAI_INPUT_USD_PER_MILLION', 'OPENAI_OUTPUT_USD_PER_MILLION'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    OPENAI_BASE_URL: origin + '/v1', OPENAI_API_KEY: 'mock-local-key', LINGUISTIC_ASSET_PATH: profilePath,
    OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_OUTPUT_USD_PER_MILLION: '2',
  });
  const reset = async (nextMode = 'valid') => {
    mode = nextMode; calls = 0;
    process.env.OPENAI_API_KEY = 'mock-local-key';
    await writeFile(profilePath, 'locale:\n  target_locale: fr-FR\nglossary:\n  do_not_translate: [Example]\nfuture_section:\n  enabled: true\n');
  };
  try {
    await t.test('runs configured workers, validates findings, tracks usage, preserves review status', async () => {
      await reset(); const audit = createAudit();
      await executeAudit(audit, origin, 'mock-model', []);
      assert.equal(audit.status, 'completed'); // A broken link is a finding, not a worker failure.
      assert.equal(receivedLocale, 'fr-FR');
      assert.equal(audit.workers.length, 8); // 404 error page is not sent to page workers.
      assert(audit.workers.every(worker => worker.status === 'completed' || worker.status === 'skipped'));
      const locale = audit.workers.find(worker => worker.agent === 'locale')!;
      assert.equal(locale.status, 'completed'); assert.equal(locale.attempts, 1);
      assert.equal(audit.workers.find(worker => worker.agent === 'formatting')?.status, 'skipped');
      assert.equal(audit.workers.find(worker => worker.agent === 'brand-voice')?.status, 'skipped');
      assert.deepEqual(audit.coverage.filter(entry => entry.implemented).map(entry => entry.category), ['spelling_grammar', 'formatting', 'links', 'locale_rules', 'brand_voice', 'translation_quality', 'terminology', 'media']);
      assert.deepEqual(new Set(audit.issues.map(issue => issue.category)), new Set(['links', 'spelling_grammar']));
      assert.equal(calls, 1);
      const language = audit.workers.find(worker => worker.agent === 'spelling-grammar')!;
      assert.equal(language.inputTokens, 100); assert.equal(language.estimatedCostUsd, 0.00014);
      assert.equal(language.cachedInputTokens, 40); assert.equal(language.cacheWriteInputTokens, 10);
      assert.equal(language.cacheUsageComplete, true);
      assert.equal(audit.cost?.partial, false); assert(audit.cost!.usd! > 0);
      assert.equal(audit.pricing?.input, 1); assert.equal(language.pricing?.output, 2);
      audit.issues[0].status = 'verified';
      const second = createAudit(); await executeAudit(second, origin, 'mock-model', audit.issues);
      assert.equal(second.issues.find(issue => issue.id === audit.issues[0].id)?.status, 'verified');
    });
    await t.test('rejects fabricated evidence while retaining link findings', async () => {
      await reset('invalid'); const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', []);
      assert.equal(audit.workers.find(worker => worker.agent === 'spelling-grammar')?.status, 'failed');
      assert.equal(audit.issues.length, 1); assert.equal(audit.issues[0].category, 'links');
    });
    await t.test('clean output is a completed worker with zero spelling/grammar findings', async () => {
      await reset('clean'); const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', []);
      const language = audit.workers.find(worker => worker.agent === 'spelling-grammar')!;
      assert.equal(language.status, 'completed'); assert.equal(language.issueCount, 0);
    });
    await t.test('retries transient failures and marks unknown usage', async () => {
      await reset('retry'); const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', []);
      const language = audit.workers.find(worker => worker.agent === 'spelling-grammar')!;
      assert.equal(language.status, 'completed'); assert.equal(language.attempts, 2);
      assert.equal(language.usageComplete, false); assert.equal(language.estimatedCostUsd, null);
    });
    await t.test('missing API key fails Spelling & Grammar without blocking Links', async () => {
      await reset(); delete process.env.OPENAI_API_KEY;
      const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', []);
      assert.equal(calls, 0); assert.equal(audit.issues[0].category, 'links');
      assert.equal(audit.workers.find(worker => worker.agent === 'spelling-grammar')?.status, 'failed');
    });
    await t.test('invalid YAML profile stops the audit before model calls', async () => {
      await reset(); await writeFile(profilePath, 'locale: {}');
      const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', []);
      assert.equal(audit.status, 'failed'); assert.match(audit.error!, /Invalid linguistic profile/);
      assert.equal(calls, 0);
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
