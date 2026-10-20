import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, checkNode, port } from '../common.mjs';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port; await new Promise(resolve => server.close(resolve)); return number;
}
test('unsupported Node versions and invalid ports give actionable errors', () => {
  assert.throws(() => checkNode('21.7.0'), /22.18/);
  assert.throws(() => checkNode('22.17.0'), /22.18/);
  checkNode('22.18.0'); checkNode('24.0.0');
  assert.throws(() => port('abc', 3000, 'PORT'), /PORT/);
  assert.throws(() => port('65536', 3000, 'PORT'), /65535/);
});

test('native launcher serves both apps, persists reviews and exports, and releases ports on shutdown', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa install with spaces '));
  const appPort = await freePort(), sitePort = await freePort();
  const envFile = join(directory, '.env');
  await writeFile(envFile, 'OPENAI_API_KEY=\n');
  const env = { ...process.env, QA_ENV_FILE: envFile, PORT: String(appPort), PRACTICE_SITE_PORT: String(sitePort),
    SITE_URL: '', HOST: '127.0.0.1', OPENAI_API_KEY: '', QA_DATA_DIR: join(directory, 'saved data'), SCREENSHOT_DIR: join(directory, 'screenshots'),
    LINGUISTIC_ASSET_PATH: join(root, 'linguistic-assets/practice-profile.yaml'), REFERENCE_CONTENT_PATH: join(root, 'reference-content'),
    QA_DISABLE_BROWSER_CHECKS: '1', QA_DISABLE_SCREENSHOTS: '1' };
  let child, exit, logs = '';
  const request = (path, options) => fetch(`http://127.0.0.1:${appPort}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
  const json = async (path, options) => { const response = await request(path, options); assert(response.ok, await response.clone().text()); return response.json(); };
  async function start(args = []) {
    child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    exit = once(child, 'exit');
    for (let attempt = 0; attempt < 150; attempt++) {
      if (logs.includes('Ready. Press Ctrl+C')) return;
      if (child.exitCode !== null) break;
      await delay(50);
    }
    assert.fail('Launcher did not start: ' + logs);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.send('shutdown'); await exit; assert.equal(child.exitCode, 0, logs); child = undefined;
  }
  try {
    await start();
    assert.equal((await json('/api/health')).apiKeyConfigured, false);
    assert.match(await (await request('/')).text(), /Test configuration/);
    const crawl = await json('/api/crawl', { method: 'POST' });
    assert(crawl.issues.length > 0);
    const finding = crawl.issues[0];
    await json(`/api/audits/${crawl.runId}/issues/${finding.id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'verified' }) });
    const before = await (await request(`/api/audits/${crawl.runId}/export`)).text();
    assert.match(before, /verified/);
    // A second launcher must fail instead of killing/reusing another process.
    const duplicate = spawn(process.execPath, [join(root, 'scripts/start.mjs')], { cwd: directory, env });
    let duplicateLog = ''; duplicate.stderr.on('data', data => { duplicateLog += data; });
    assert.equal((await once(duplicate, 'exit'))[0], 1);
    assert.match(duplicateLog, /Port .* unavailable/);
    await stop();
    await assert.rejects(fetch(`http://127.0.0.1:${sitePort}/`));
    await assert.rejects(request('/api/health'));
    await start();
    assert.equal((await json('/api/audits/latest')).id, crawl.runId);
    assert.equal((await json('/api/issues'))[0].status, 'verified');
    assert.match(await (await request(`/api/audits/${crawl.runId}/export`)).text(), /verified/);
    assert.equal(await readFile(envFile, 'utf8'), 'OPENAI_API_KEY=\n');
    await stop();
    // A supplied external URL / platform-only mode does not start the practice service.
    await start(['--platform-only']);
    await assert.rejects(fetch(`http://127.0.0.1:${sitePort}/`));
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
