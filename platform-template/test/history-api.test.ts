import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'cheerio';
import { RunStore } from '../src/run-store.js';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object'); return address.port;
}

test('API run history, scoped reviews, clear, screenshots and interrupted audits survive process restarts', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-history-api-'));
  const profile = join(directory, 'profile.yaml');
  await writeFile(profile, 'locale:\n  target_locale: en-GB\n');
  await mkdir(join(directory, 'history', 'screenshots'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(directory, 'history', 'screenshots', 'saved.png'), png);
  let gate: Promise<void> | undefined, entered: (() => void) | undefined, release: (() => void) | undefined;
  let siteRequests = 0;
  const site = createServer(async (request, response) => {
    siteRequests++;
    if (gate) { entered?.(); await gate; }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? 'Missing' : '<html><body><a href="/missing">Missing link</a></body></html>');
  });
  const sitePort = await listen(site);
  const reservation = createServer(), port = await listen(reservation);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ChildProcess | undefined, exited: Promise<unknown> | undefined;
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  const json = async (path: string) => { const response = await request(path); assert.equal(response.status, 200); return response.json(); };
  async function start() {
    let logs = '';
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env: { ...process.env,
      PORT: String(port), SITE_URL: `http://127.0.0.1:${sitePort}`, LINGUISTIC_ASSET_PATH: profile,
      OPENAI_API_KEY: '', QA_DATA_DIR: join(directory, 'history'), SCREENSHOT_DIR: join(directory, 'history', 'screenshots') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', chunk => { logs += chunk; }); child.stderr!.on('data', chunk => { logs += chunk; });
    exited = once(child, 'exit');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await request('/api/health')).ok) return; } catch { /* boot */ }
      if (child.exitCode !== null) break;
      await delay(40);
    }
    assert.fail('Server did not start: ' + logs);
  }
  async function stop(signal: NodeJS.Signals = 'SIGTERM') { child?.kill(signal); await exited; child = undefined; }
  try {
    await start();
    const first = await (await request('/api/crawl', 'POST')).json();
    const id = first.issues[0].id;
    assert.equal((await request(`/api/audits/${first.runId}/issues/${id}/status`, 'PATCH', { status: 'verified' })).status, 200);
    await stop();
    const savedStore = new RunStore(join(directory, 'history', 'history.sqlite'));
    try {
      const saved = savedStore.get(first.runId)!;
      saved.issues[0].visual_evidence = { screenshot_url: '/api/screenshots/saved.png', highlighted: true };
      savedStore.save(saved);
    } finally { savedStore.close(); }
    await start();
    assert.equal((await json('/api/audits/latest')).id, first.runId);
    assert.equal((await json('/api/issues'))[0].status, 'verified');
    assert.deepEqual(Buffer.from(await (await request('/api/screenshots/saved.png')).arrayBuffer()), png);
    const second = await (await request('/api/crawl', 'POST')).json();
    assert.equal(second.issues[0].status, 'verified', 'explicit reviews carry forward after restart');
    assert.equal((await request(`/api/audits/${first.runId}/issues/${id}/status`, 'PATCH', { status: 'dismissed' })).status, 200);
    assert.equal((await json('/api/issues'))[0].status, 'verified', 'historical review does not rewrite current run');
    assert.equal((await json(`/api/audits/${first.runId}/reviews`)).length, 2);
    const requestsBeforeExport = siteRequests;
    const exportResponse = await request(`/api/audits/${first.runId}/export`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition')!, /^attachment; filename="skynet-results-.*\.html"$/);
    assert.match(exportResponse.headers.get('content-type')!, /text\/html/);
    assert.equal(exportResponse.headers.get('cache-control'), 'no-store');
    const exported = load(await exportResponse.text());
    assert.match(exported('#overview').text(), new RegExp(first.runId));
    assert.match(exported('.finding-top').text(), /dismissed/);
    assert.equal(exported('#reviews tbody tr').length, 2);
    assert.equal(exported('img').attr('src'), 'data:image/png;base64,' + png.toString('base64'));
    const currentExport = load(await (await request(`/api/audits/${second.runId}/export?format=html`)).text());
    assert.match(currentExport('.finding-top').text(), /verified/);
    const csvResponse = await request(`/api/audits/${first.runId}/export?format=csv`);
    assert.match(csvResponse.headers.get('content-type')!, /text\/csv/);
    assert.match(csvResponse.headers.get('content-disposition')!, /\.csv"$/);
    assert.match(await csvResponse.text(), /"dismissed"/);
    assert.equal(siteRequests, requestsBeforeExport, 'exports do not crawl or run new checks');
    assert.equal((await request(`/api/audits/${first.runId}/export?format=json`)).status, 400);
    assert.equal((await request(`/api/audits/${first.runId}/export?format=html&format=csv`)).status, 400);
    assert.equal((await request('/api/audits/missing/export')).status, 404);
    const list = await json('/api/audits?limit=1&offset=1');
    assert.equal(list.total, 2); assert.equal(list.runs.length, 1); assert.equal(list.runs[0].id, first.runId);
    assert.equal(list.spending.total.usd, 0); assert.equal(list.spending.total.partial, false);
    assert.equal((await json(`/api/audits/${second.runId}/comparison`)).recurring.length, 1);
    assert.equal((await request('/api/audits?limit=-1')).status, 400);
    assert.equal((await request('/api/audits?offset=1e21')).status, 400);
    assert.equal((await request('/api/audits/missing')).status, 404);
    assert.equal((await request(`/api/audits/${second.runId}/comparison?baseline=missing`)).status, 404);
    assert.equal((await request(`/api/audits/${second.runId}/comparison?baseline=${second.runId}`)).status, 400);
    assert.equal((await request(`/api/audits/${second.runId}/issues/${id}/status`, 'PATCH', { status: 'invalid' })).status, 400);
    assert.equal((await request(`/api/audits/${second.runId}/issues/${id}/status`, 'PATCH', { status: ['verified'] })).status, 400);
    assert.equal((await request(`/api/audits/${second.runId}/issues/unknown/status`, 'PATCH', { status: 'verified' })).status, 404);
    assert.equal((await request('/api/results', 'DELETE')).status, 200);
    await stop(); await start();
    assert.equal(await json('/api/audits/latest'), null); assert.equal((await json('/api/audits')).total, 2);
    assert.equal((await json(`/api/audits/${first.runId}`)).issues[0].status, 'dismissed');
    assert.match(load(await (await request(`/api/audits/${first.runId}/export`)).text())('.finding-top').text(), /dismissed/, 'exports remain available after clearing and restarting');
    const fresh = await (await request('/api/crawl', 'POST')).json();
    assert.equal(fresh.issues[0].status, 'new');
    gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = await (await request('/api/audits', 'POST')).json();
    await started;
    assert.equal((await request('/api/results', 'DELETE')).status, 409);
    assert.equal((await request('/api/audits', 'POST')).status, 409);
    assert.equal((await request(`/api/audits/${pending.id}/export`)).status, 409);
    assert.equal((await request(`/api/audits/${first.runId}/export`)).status, 200, 'a saved run can be exported while another run is active');
    assert.equal((await request(`/api/audits/${pending.id}/issues/${id}/status`, 'PATCH', { status: 'verified' })).status, 409);
    await stop('SIGKILL'); release!(); gate = undefined;
    const requestsBeforeRestart = siteRequests;
    await start();
    const recovered = await json(`/api/audits/${pending.id}`);
    assert.equal(recovered.status, 'partial'); assert.equal(recovered.phase, 'Interrupted');
    assert.match(recovered.error, /last checkpoint/);
    assert.match(await (await request(`/api/audits/${pending.id}/export`)).text(), /Server stopped before this run finished/);
    assert.equal(siteRequests, requestsBeforeRestart, 'restart does not retry site/model requests');
    assert.equal((await json('/api/audits')).total, 4);
  } finally {
    release?.(); if (child) await stop();
    site.closeAllConnections(); await new Promise<void>(resolve => site.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
