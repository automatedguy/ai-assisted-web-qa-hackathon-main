// Disposable Compose project. No .env secrets, existing containers, or user volumes are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, checkNode } from './common.mjs';

checkNode();
const directory = await mkdtemp(join(tmpdir(), 'qa-compose-check-'));
const envFile = join(directory, 'empty.env'); await writeFile(envFile, '');
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port; await new Promise(resolve => server.close(resolve)); return number;
}
const appPort = await freePort(), sitePort = await freePort();
const project = 'qa-install-' + randomUUID().slice(0, 8);
const env = { ...process.env, OPENAI_API_KEY: '', PORT: String(appPort), PRACTICE_SITE_PORT: String(sitePort) };
const executable = process.env.QA_COMPOSE_BINARY || 'docker';
const prefix = process.env.QA_COMPOSE_BINARY ? [] : ['compose'];
const base = [...prefix, '--project-directory', root, '--env-file', envFile, '-p', project, '-f', join(root, 'docker-compose.yml')];
async function compose(args) {
  const child = spawn(executable, [...base, ...args], { cwd: root, env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Compose ${args[0]} failed (${code}).`);
}
const request = (path, options) => fetch(`http://127.0.0.1:${appPort}${path}`, { ...options, signal: AbortSignal.timeout(30000) });
async function json(path, options) { const response = await request(path, options); assert(response.ok, await response.clone().text()); return response.json(); }
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  await compose(['up', '--build', '-d', '--wait', '--wait-timeout', '120']);
  assert.equal((await json('/api/health')).apiKeyConfigured, false);
  await compose(['exec', '-T', 'qa-platform', 'node', '--input-type=module', '-e', "import {chromium} from 'playwright'; const browser=await chromium.launch(); const page=await browser.newPage(); await page.goto('http://site-under-test/'); await page.screenshot({path:process.env.QA_DATA_DIR+'/screenshots/install-smoke.png'}); await browser.close();"]);
  const screenshot = Buffer.from(await (await request('/api/screenshots/install-smoke.png')).arrayBuffer());
  assert.equal(screenshot.subarray(1, 4).toString(), 'PNG');
  const crawl = await json('/api/crawl', { method: 'POST' }); assert(crawl.issues.length);
  const issue = crawl.issues[0];
  await json(`/api/audits/${crawl.runId}/issues/${issue.id}/status`, { ...post({ status: 'verified' }), method: 'PATCH' });
  const catalog = await json('/api/test-configuration');
  const added = await json('/api/test-configuration/profiles', post({ revision: catalog.revision, name: 'Installation smoke profile', yaml: 'locale:\n  target_locale: en-GB\n' }));
  await json('/api/test-configuration', { ...post({ revision: added.revision, siteId: 'environment', profileId: added.addedId }), method: 'PATCH' });
  await compose(['down']); // Keep this project's volume, then recreate both containers.
  await compose(['up', '-d', '--wait', '--wait-timeout', '120']);
  const restored = await json('/api/test-configuration');
  assert.equal(restored.selected.profileId, added.addedId);
  assert.equal(restored.profiles.find(profile => profile.id === added.addedId).available, true);
  assert.equal((await json(`/api/audits/${crawl.runId}`)).issues[0].status, 'verified');
  assert.match(await (await request(`/api/audits/${crawl.runId}/export`)).text(), /verified/);
  assert.deepEqual(Buffer.from(await (await request('/api/screenshots/install-smoke.png')).arrayBuffer()), screenshot);
  console.log('Docker installation passed: healthy services, Chromium screenshot, crawl, review/export, profile upload and volume persistence after container recreation.');
} finally {
  try { await compose(['down', '--volumes', '--remove-orphans']); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
