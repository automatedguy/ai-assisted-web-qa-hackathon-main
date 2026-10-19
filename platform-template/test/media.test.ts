import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { parseCaptions } from '../src/agents/media-resources.js';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';
import type { Findings } from '../src/agents/model-check.js';

test('WebVTT extraction supports identifiers, settings and markup while rejecting unusable cues', () => {
  const parsed = parseCaptions('\uFEFFWEBVTT\r\n\r\nNOTE ignored\r\n\r\ncue-1\r\n00:01.000 --> 00:03.000 align:start\r\n<v A><b>Bonjour</b> &amp; bienvenue.\r\n\r\n00:02.000 --> 00:04.000\r\nDeuxième ligne.\r\n');
  assert.equal(parsed.text, 'Bonjour & bienvenue.\nDeuxième ligne.'); assert.equal(parsed.cues.length, 2);
  for (const invalid of ['Hello', 'WEBVTT\n\n', 'WEBVTT\n00:00.000 --> 00:01.000\nHi',
    'WEBVTT\n\n00:61.000 --> 00:62.000\nHi', 'WEBVTT\n\n00:03.000 --> 00:02.000\nHi',
    'WEBVTT\n\n00:03.000 --> 00:04.000\nHi\n\n00:01.000 --> 00:02.000\nEarlier']) {
    assert.throws(() => parseCaptions(invalid), /Caption/);
  }
});

test('media workflow fetches assets, submits image bytes and validates evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-media-'));
  const profilePath = join(directory, 'profile.yaml');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=', 'base64');
  const captions = 'WEBVTT\n\n00:00.000 --> 00:02.000\nWelcome to our team.\n';
  let imageBytes = png; let captionData = captions;
  let html = ''; let mode = 'valid'; let mediaCalls = 0;
  let findings: Findings['issues'] = []; let received: any; let imageInputs: any[] = [];
  const fetched: string[] = []; let videoRange: string | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/responses') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); const media = body.text.format.name === 'media_findings';
      if (media) {
        mediaCalls++;
        received = JSON.parse(typeof body.input === 'string' ? body.input : body.input[0].content[0].text);
        imageInputs = typeof body.input === 'string' ? [] : body.input[0].content.filter((entry: any) => entry.type === 'input_image');
        if (mode === 'retry' && mediaCalls === 1) {
          response.writeHead(429, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'Rate limit' } })); return;
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'resp_mock', object: 'response', status: media && mode === 'incomplete' ? 'incomplete' : 'completed', model: 'mock-model',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ issues: media ? findings : [] }), annotations: [] }] }],
        usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 },
      })); return;
    }
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
    fetched.push(request.url!);
    if (request.url === '/missing.png' || request.url === '/missing.vtt' || request.url === '/missing.mp4') {
      response.writeHead(404); response.end('Missing'); return;
    }
    if (request.url === '/redirect.png' || request.url === '/external.png') {
      response.writeHead(302, { location: request.url === '/external.png' ? 'https://outside.test/asset.png' : '/ok.png' }); response.end(); return;
    }
    if (request.url === '/huge.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(5 * 1024 * 1024) }); response.end(png); return;
    }
    if (request.url === '/fake.png') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<p>Error page</p>'); return; }
    if (request.url === '/vector.svg') { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end('<svg/>'); return; }
    if (request.url?.endsWith('.png')) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(imageBytes); return; }
    if (request.url === '/video.mp4') {
      videoRange = request.headers.range;
      response.writeHead(206, { 'content-type': 'video/mp4' }); response.end(Buffer.from('000000186674797069736f6d', 'hex')); return;
    }
    if (request.url?.endsWith('.vtt')) {
      response.writeHead(200, { 'content-type': 'text/vtt' });
      response.end(request.url === '/bad.vtt' ? 'WEBVTT\n\n00:03.000 --> 00:01.000\nBad' : captionData); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`;
  const names = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LINGUISTIC_ASSET_PATH', 'OPENAI_INPUT_USD_PER_MILLION', 'OPENAI_OUTPUT_USD_PER_MILLION'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { OPENAI_BASE_URL: origin + '/v1', OPENAI_API_KEY: 'mock', LINGUISTIC_ASSET_PATH: profilePath,
    OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_OUTPUT_USD_PER_MILLION: '2' });
  const setup = async (markup: string, targetLocale = 'fr-FR') => {
    mode = 'valid'; mediaCalls = 0; findings = []; received = undefined; imageInputs = []; fetched.length = 0; videoRange = undefined;
    imageBytes = png; captionData = captions;
    process.env.OPENAI_API_KEY = 'mock'; html = `<html><body>${markup}</body></html>`;
    await writeFile(profilePath, stringify({ locale: { target_locale: targetLocale }, glossary: { do_not_translate: ['AsterBox'] } }));
  };
  const finding = (asset_id: string, check: Findings['issues'][number]['check'], evidence: string): Findings['issues'][number] => ({
    asset_id, check, evidence, severity: 'minor', description: 'The asset does not match the configured locale or description.',
    expected: 'Use the configured language and an accurate description.', suggested_fix: 'Use “Notre équipe”.', confidence: 0.95,
  });
  const run = async (previousIssues = [] as ReturnType<typeof createAudit>['issues']) => {
    const audit = createAudit(); await executeAudit(audit, origin, 'mock-model', previousIssues); return audit;
  };
  const worker = (audit: ReturnType<typeof createAudit>) => audit.workers.find(item => item.agent === 'media')!;
  try {
    await t.test('sends image bytes, alt and fetched captions; locates findings and preserves reviews', async () => {
      await setup('<p>Notre équipe</p><img src="/ok.png" alt="Team photo"><video poster="/ok.png"><source src="/video.mp4"><track src="/captions.vtt" srclang="fr" kind="captions"></video>');
      findings = [finding('image-1-1', 'alt_language', 'Team photo'), finding('image-1-1', 'image_text', 'Welcome'), finding('track-1-1', 'caption_language', 'Welcome to our team.')];
      const audit = await run(); assert.equal(audit.status, 'completed'); assert.equal(worker(audit).status, 'completed');
      assert.equal(mediaCalls, 1); assert.equal(imageInputs.length, 2); assert.equal(imageInputs[0].image_url, `data:image/png;base64,${png.toString('base64')}`);
      assert.equal(received.targetLocale, 'fr-FR'); assert.equal(received.assets.find((asset: any) => asset.id === 'track-1-1').captionText, 'Welcome to our team.');
      assert.equal(videoRange, 'bytes=0-4095'); assert.equal(fetched.filter(path => path === '/ok.png').length, 1);
      assert.equal(audit.issues.length, 3); assert(audit.issues.every(issue => issue.category === 'media'));
      assert.deepEqual(audit.issues.map(issue => issue.assessment?.method), ['model_text', 'model_visual', 'model_text']);
      assert.equal(audit.issues[0].location.selector_or_xpath, '(//img)[1]');
      assert.match(audit.issues[1].evidence, /Visual observation \(model; review required\)/);
      assert.equal(audit.issues[2].location.element_type, 'video'); assert.match(audit.issues[2].evidence, /Caption cue text/);
      assert.equal(worker(audit).inputTokens, 200); assert.equal(worker(audit).estimatedCostUsd, 0.0003);
      assert(worker(audit).mediaChecks!.some(check => check.check === 'caption language' && check.status === 'completed'));
      audit.issues[0].status = 'verified'; findings[0].description = 'Reworded explanation.';
      const next = await run(audit.issues); assert.equal(next.issues.find(issue => issue.id === audit.issues[0].id)!.status, 'verified');
    });
    await t.test('covers media-only pages, picture alternatives and img srcset without requiring body text', async () => {
      await setup('<picture><source srcset="/mobile.png 600w"><img src="/desktop.png" srcset="/wide.png 1200w" alt=""></picture>', 'ja-JP');
      const audit = await run(); assert.equal(audit.status, 'completed'); assert.equal(worker(audit).status, 'completed');
      assert.equal(audit.workers.length, 2); assert.equal(imageInputs.length, 3); assert.deepEqual(audit.issues, []);
      assert.equal(received.targetLocale, 'ja-JP');
      assert.deepEqual(audit.crawl!.pages[0].images[0].candidates, ['/desktop.png', '/wide.png', '/mobile.png'].map(path => origin + path));
    });
    await t.test('keeps media IDs and all review statuses across reworded evidence, corrections and reordered findings', async () => {
      await setup('<img src="/ok.png" alt="Team photo"><video src="/video.mp4"><track src="/captions.vtt" srclang="fr"></video>');
      findings = [finding('image-1-1', 'alt_language', 'Team photo'), finding('image-1-1', 'image_text', 'The image says Welcome.'),
        finding('track-1-1', 'caption_language', 'Welcome to our team.')];
      const first = await run(); assert.equal(first.status, 'completed');
      first.issues.forEach((issue, index) => { issue.status = (['verified', 'dismissed', 'escalated'] as const)[index]; });
      findings = findings.map((item, index) => ({ ...item, evidence: ['Team', 'English text is visible: Welcome.', 'our team.'][index],
        description: 'Different explanation.', suggested_fix: 'Different correction.', expected: 'Different wording.', severity: 'major' as const, confidence: 0.88 })).reverse();
      const second = await run(first.issues);
      assert.equal(second.status, 'completed'); assert.equal(second.issues.length, 3);
      assert.deepEqual(new Set(second.issues.map(issue => issue.id)), new Set(first.issues.map(issue => issue.id)));
      for (const issue of second.issues) {
        assert.match(issue.id, /^media-v2-[a-f0-9]{32}$/);
        assert.equal(issue.status, first.issues.find(old => old.id === issue.id)!.status);
        assert.equal(issue.description, 'Different explanation.');
      }
    });
    await t.test('changed image bytes at the same URL and changed captions require fresh reviews', async () => {
      await setup('<img src="/ok.png" alt="Team photo"><video src="/video.mp4"><track src="/captions.vtt" srclang="fr"></video>');
      findings = [finding('image-1-1', 'image_text', 'English text'), finding('track-1-1', 'caption_language', 'Welcome')];
      const first = await run(); first.issues.forEach(issue => { issue.status = 'dismissed'; });
      // The fake model only needs a supported signature; change the fetched byte version.
      imageBytes = Buffer.concat([png, Buffer.from('changed-image')]);
      captionData = captions.replace('our team', 'our office');
      const second = await run(first.issues);
      assert.equal(second.status, 'completed'); assert.equal(second.issues.length, 2);
      assert(second.issues.every(issue => issue.status === 'new' && !first.issues.some(old => old.id === issue.id)));
    });
    await t.test('changed alt text or target locale does not inherit a previous dismissal', async () => {
      const markup = '<img src="/ok.png" alt="Team photo">';
      await setup(markup); findings = [finding('image-1-1', 'alt_language', 'Team')];
      const first = await run(); first.issues[0].status = 'dismissed';
      html = html.replace('Team photo', 'Team portrait');
      const changedAlt = await run(first.issues);
      assert.notEqual(changedAlt.issues[0].id, first.issues[0].id); assert.equal(changedAlt.issues[0].status, 'new');
      await setup(markup, 'es-ES'); findings = [finding('image-1-1', 'alt_language', 'Team')];
      const changedLocale = await run(first.issues);
      assert.notEqual(changedLocale.issues[0].id, first.issues[0].id); assert.equal(changedLocale.issues[0].status, 'new');
    });
    await t.test('separates elements, responsive assets and check types while consolidating one shared alt attribute', async () => {
      await setup('<picture><source srcset="/mobile.png 600w"><img src="/desktop.png" alt="Team photo"></picture><img src="/desktop.png" alt="Team photo">');
      findings = [finding('image-1-1', 'image_text', 'Welcome'), finding('image-1-2', 'image_text', 'Welcome'),
        finding('image-2-1', 'image_text', 'Welcome'), finding('image-1-1', 'image_content', 'Welcome'),
        finding('image-1-1', 'alt_language', 'Team photo'), finding('image-1-2', 'alt_language', 'Team photo')];
      const audit = await run(); assert.equal(audit.status, 'completed');
      assert.equal(audit.issues.length, 5); assert.equal(new Set(audit.issues.map(issue => issue.id)).size, 5);
      assert.equal(audit.issues.filter(issue => issue.assessment?.check === 'alt_language').length, 1);
    });
    await t.test('preserves every observation when a model splits the same asset/check into multiple findings', async () => {
      await setup('<img src="/ok.png" alt="">');
      findings = [finding('image-1-1', 'image_text', 'English headline'),
        { ...finding('image-1-1', 'image_text', 'Contradictory footer'), severity: 'major', confidence: 0.8 }];
      const first = await run(); assert.equal(first.status, 'completed'); assert.equal(first.issues.length, 1);
      assert.match(first.issues[0].evidence, /English headline/); assert.match(first.issues[0].evidence, /Contradictory footer/);
      assert.equal(first.issues[0].severity, 'major'); assert.equal(first.issues[0].confidence, 0.8);
      first.issues[0].status = 'verified'; findings.reverse();
      const second = await run(first.issues);
      assert.equal(second.issues[0].id, first.issues[0].id); assert.equal(second.issues[0].evidence, first.issues[0].evidence);
      assert.equal(second.issues[0].status, 'verified');
    });
    await t.test('does not guess a review migration for legacy media IDs without content fingerprints', async () => {
      await setup('<img src="/ok.png" alt="">'); findings = [finding('image-1-1', 'image_text', 'English copy')];
      const first = await run();
      const legacy = { ...first.issues[0], id: 'media-0123456789abcdef', status: 'dismissed' as const };
      const second = await run([legacy]);
      assert.equal(second.issues[0].status, 'new');
    });
    await t.test('reports missing alt, broken images/videos/tracks and malformed captions deterministically', async () => {
      await setup('<img src="/missing.png"><img src="/fake.png" alt=""><video src="/missing.mp4"><track src="/missing.vtt" srclang="fr"><track src="/bad.vtt" srclang="fr"></video>');
      const audit = await run(); assert.equal(worker(audit).status, 'completed'); assert.equal(mediaCalls, 0);
      assert.equal(audit.issues.length, 6); assert(audit.issues.every(issue => issue.category === 'media'));
      assert(audit.issues.every(issue => issue.assessment?.method === 'deterministic'));
      assert(audit.issues.some(issue => issue.description.includes('alt attribute')));
      assert(audit.issues.some(issue => issue.description.includes('WebVTT')));
    });
    await t.test('detects missing sources while respecting decorative empty alt and alternate caption languages', async () => {
      await setup('<img alt=""><video></video>');
      const missing = await run(); assert.equal(missing.issues.length, 2); assert.equal(mediaCalls, 0);
      await setup('<img src="/ok.png" alt="" role="presentation"><video src="/video.mp4"><track src="/captions.vtt" srclang="fr-FR"><track src="/english.vtt" srclang="en"></video>');
      const clean = await run(); assert.deepEqual(clean.issues, []); assert.equal(worker(clean).status, 'completed');
      await setup('<video src="/video.mp4"><track src="/captions.vtt" srclang="en"></video>');
      const mismatch = await run(); assert.equal(mismatch.issues.length, 1); assert.match(mismatch.issues[0].evidence, /Declared caption languages: en/);
    });
    await t.test('absent media skips without model or asset requests', async () => {
      await setup('<p>Bonjour</p>'); const audit = await run();
      assert.equal(worker(audit).status, 'skipped'); assert.equal(worker(audit).attempts, 0); assert.equal(mediaCalls, 0); assert.deepEqual(fetched, []);
    });
    await t.test('redirects stay within origin; unsupported or oversized assets leave coverage partial', async () => {
      await setup('<img src="/redirect.png" alt="">'); const valid = await run(); assert.equal(worker(valid).status, 'completed');
      for (const src of ['/external.png', 'https://outside.test/image.png', '/vector.svg', '/huge.png']) {
        await setup(`<img src="${src}">`); const audit = await run();
        assert.equal(audit.status, 'partial'); assert.equal(worker(audit).status, 'failed');
        assert(audit.issues.some(issue => issue.description.includes('alt attribute')));
        assert(worker(audit).mediaChecks!.some(check => check.status !== 'completed')); assert.equal(mediaCalls, 0);
      }
    });
    await t.test('visual inspection limits are explicit and preserve inspected assets', async () => {
      await setup(Array.from({ length: 9 }, (_, index) => `<img src="/${index}.png" alt="">`).join(''));
      const audit = await run(); assert.equal(imageInputs.length, 8); assert.equal(worker(audit).status, 'failed');
      assert.match(worker(audit).message!, /Eight-image/); assert.equal(mediaCalls, 1);
    });
    await t.test('rejects invented alt/caption quotes and unknown assets while retaining deterministic findings', async () => {
      for (const invalid of [finding('image-2-1', 'alt_language', 'invented'), finding('track-1-1', 'caption_language', 'invented'), finding('unknown', 'image_text', 'invented')]) {
        await setup('<img src="/ok.png"><img src="/team.png" alt="Team photo"><video src="/video.mp4"><track src="/captions.vtt" srclang="fr"></video>'); findings = [invalid];
        const audit = await run(); assert.equal(worker(audit).status, 'failed'); assert.equal(audit.issues.length, 1);
        assert.match(audit.issues[0].description, /alt attribute/);
      }
      await setup('<img src="/missing.png" alt="Team photo">'); findings = [finding('image-1-1', 'image_text', 'Cannot have seen this')];
      const unseen = await run(); assert.equal(worker(unseen).status, 'failed'); assert.equal(unseen.issues.length, 1);
      assert.match(unseen.issues[0].evidence, /HTTP 404/);
    });
    await t.test('missing credentials and incomplete model responses retain metadata findings', async () => {
      for (const failure of ['key', 'incomplete']) {
        await setup('<img src="/ok.png">'); if (failure === 'key') delete process.env.OPENAI_API_KEY; else mode = 'incomplete';
        const audit = await run(); assert.equal(worker(audit).status, 'failed'); assert.equal(audit.issues.length, 1);
        assert.match(audit.issues[0].description, /alt attribute/); assert.equal(mediaCalls, failure === 'key' ? 0 : 1);
      }
    });
    await t.test('retries transient model errors and tracks unknown usage', async () => {
      await setup('<img src="/ok.png" alt="">'); mode = 'retry'; const audit = await run();
      assert.equal(mediaCalls, 2); assert.equal(worker(audit).attempts, 2); assert.equal(worker(audit).status, 'completed');
      assert.equal(worker(audit).usageComplete, false); assert.equal(worker(audit).estimatedCostUsd, null);
    });
  } finally {
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
