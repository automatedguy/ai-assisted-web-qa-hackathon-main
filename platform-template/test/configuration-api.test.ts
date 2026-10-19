import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object'); return address.port;
}
test('app configuration switches run inputs, persists uploads, rejects stale/active changes and preserves history', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-configuration-api-'));
  const profile = join(directory, 'profile.yaml'); await writeFile(profile, 'locale:\n  target_locale: en-GB\n');
  let release: (() => void) | undefined, entered: (() => void) | undefined, gate: Promise<void> | undefined;
  const visits: string[] = [];
  const site = createServer(async (request, response) => {
    visits.push(request.url!); if (gate) { entered?.(); await gate; }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? 'Missing' : '<html><body><h1>Configured site</h1><a href="/missing">Missing page</a></body></html>');
  });
  const sitePort = await listen(site), origin = `http://127.0.0.1:${sitePort}`;
  const reservation = createServer(), port = await listen(reservation); await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ChildProcess | undefined, exited: Promise<unknown> | undefined;
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const json = async (path: string, method = 'GET', body?: unknown) => { const response = await request(path, method, body); assert(response.ok, await response.clone().text()); return response.json(); };
  async function start() {
    let logs = '';
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...process.env, PORT: String(port),
      SITE_URL: origin + '/a/', LINGUISTIC_ASSET_PATH: profile, REFERENCE_CONTENT_PATH: join(directory, 'unused'),
      OPENAI_API_KEY: '', QA_DATA_DIR: join(directory, 'data'), QA_DISABLE_SCREENSHOTS: '1', QA_DISABLE_BROWSER_CHECKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { logs += data; }); child.stderr!.on('data', data => { logs += data; }); exited = once(child, 'exit');
    for (let i = 0; i < 100; i++) {
      try { if ((await request('/api/health')).ok) return; } catch { /* Starting. */ }
      if (child.exitCode !== null) break; await delay(30);
    }
    assert.fail('Server failed to start: ' + logs);
  }
  async function stop() { child?.kill(); await exited; child = undefined; }
  async function finish(id: string) {
    for (let i = 0; i < 150; i++) { const run = await json('/api/audits/' + id); if (run.status !== 'running') return run; await delay(20); }
    assert.fail('Run did not finish');
  }
  try {
    await start();
    const original = await json('/api/crawl', 'POST'); assert.equal(original.startUrl, origin + '/a/');
    let config = await json('/api/test-configuration'); const oldRevision = config.revision;
    assert.equal(config.sites[0].url, origin + '/a/'); assert.equal(config.profiles[0].locale, 'en-GB');
    assert.equal((await request('/api/test-configuration/sites', 'POST', { revision: config.revision, url: 'file:///etc/passwd' })).status, 400);
    config = await json('/api/test-configuration/sites', 'POST', { revision: config.revision, name: 'Second website', url: origin + '/b/' });
    const siteId = config.addedId;
    assert.equal((await request('/api/test-configuration', 'PATCH', { revision: oldRevision, siteId, profileId: 'environment' })).status, 409);
    const yaml = 'locale:\n  target_locale: fr-FR\nreference_content:\n  - page: /b/\n    source_text_path: reference-content/home.md\n';
    assert.equal((await request('/api/test-configuration/profiles', 'POST', { revision: config.revision, yaml })).status, 400, 'mapped reference files are required');
    config = await json('/api/test-configuration/profiles', 'POST', { revision: config.revision, name: 'French profile', yaml,
      references: [{ path: 'home.md', content: 'Source for the second website.' }] });
    const profileId = config.addedId;
    config = await json('/api/test-configuration', 'PATCH', { revision: config.revision, siteId, profileId });
    assert.equal(await json('/api/audits/latest'), null);
    assert.equal((await json('/api/audits')).total, 1);
    const before = visits.length;
    assert.equal((await request('/api/audits', 'POST', { configurationRevision: oldRevision })).status, 409);
    assert.equal(visits.length, before, 'stale clients cannot start checks against a different selection');
    gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = await json('/api/audits', 'POST', { configurationRevision: config.revision }); await started;
    assert.equal(pending.siteUrl, origin + '/b/'); assert.equal(pending.configuration.profileName, 'French profile');
    assert.equal((await request('/api/test-configuration', 'PATCH', { revision: config.revision, siteId: 'environment', profileId: 'environment' })).status, 409);
    assert.equal((await request('/api/test-configuration/sites', 'POST', { revision: config.revision, url: 'https://third.test/' })).status, 409);
    release!(); gate = undefined;
    const first = await finish(pending.id); assert.equal(first.targetLocale, 'fr-FR');
    assert.equal(first.workers.find((worker: any) => worker.agent === 'translation-quality').message, 'OPENAI_API_KEY is not configured.', 'the uploaded reference was resolved before the model step');
    const finding = first.issues.find((item: any) => item.category === 'links'); assert(finding);
    await json(`/api/audits/${first.id}/issues/${finding.id}/status`, 'PATCH', { status: 'verified' });
    config = await json('/api/test-configuration/profiles', 'POST', { revision: config.revision, name: 'German profile', yaml: 'locale:\n  target_locale: de-DE\n' });
    const otherProfileId = config.addedId;
    config = await json('/api/test-configuration', 'PATCH', { revision: config.revision, siteId, profileId: otherProfileId });
    const second = await finish((await json('/api/audits', 'POST', { configurationRevision: config.revision })).id);
    assert.equal(second.targetLocale, 'de-DE');
    assert.equal(second.issues.find((item: any) => item.id === finding.id).status, 'new');
    assert.equal((await json(`/api/audits/${first.id}`)).issues.find((item: any) => item.id === finding.id).status, 'verified');
    assert.equal(await json(`/api/audits/${second.id}/comparison`), null);
    config = await json('/api/test-configuration', 'PATCH', { revision: config.revision, siteId, profileId });
    await stop(); await start();
    const restored = await json('/api/test-configuration'); assert.deepEqual(restored.selected, { siteId, profileId });
    assert.equal(await json('/api/audits/latest'), null);
    assert.equal((await json('/api/audits')).total, 3);
    const third = await finish((await json('/api/audits', 'POST', { configurationRevision: restored.revision })).id);
    assert.equal(third.targetLocale, 'fr-FR'); assert.equal(third.issues.find((item: any) => item.id === finding.id).status, 'verified');
    assert.match(await (await request(`/api/audits/${first.id}/export`)).text(), /French profile/);
  } finally {
    release?.(); if (child) await stop(); site.closeAllConnections(); await new Promise<void>(resolve => site.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
