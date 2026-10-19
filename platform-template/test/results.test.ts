import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return address.port;
}

test('clear results resets server state and refuses active checks', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-results-'));
  const profile = join(directory, 'profile.yaml');
  await writeFile(profile, 'locale:\n  target_locale: en-GB\n');
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const site = createServer(async (request, response) => {
    if (gate) { entered?.(); await gate; }
    response.writeHead(request.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    response.end(request.url === '/missing' ? 'Not found' : '<html><body><a href="/missing">Missing page</a></body></html>');
  });
  const sitePort = await listen(site);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, PORT: String(port), SITE_URL: `http://127.0.0.1:${sitePort}`,
      LINGUISTIC_ASSET_PATH: profile, OPENAI_API_KEY: '', QA_DATA_DIR: join(directory, 'history') },
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  const assertEmpty = async () => {
    assert.equal(await (await request('/api/audits/latest')).json(), null);
    assert.deepEqual(await (await request('/api/issues')).json(), []);
    const pages = await (await request('/api/pages')).json();
    assert.deepEqual(pages.pages, []); assert.deepEqual(pages.responses, []);
    assert.deepEqual(pages.errors, []);
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await request('/api/health')).ok; } catch { /* Wait for server startup. */ }
      if (ready) break;
      await delay(50);
    }
    assert(ready, 'server started');
    for (const endpoint of ['/api/crawl', '/api/audits']) {
      gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const pending = request(endpoint, 'POST');
      await started;
      assert.equal((await request('/api/results', 'DELETE')).status, 409);
      release!(); gate = undefined;
      assert((await pending).ok);
      if (endpoint === '/api/audits') {
        let audit;
        do { await delay(20); audit = await (await request('/api/audits/latest')).json(); }
        while (audit.status === 'running');
        assert(audit.issues.length > 0);
      }
      const findings = await (await request('/api/issues')).json();
      assert.equal(findings.length, 1);
      assert.equal((await request(`/api/issues/${findings[0].id}/status`, 'PATCH', { status: 'verified' })).status, 200);
      assert.equal((await request('/api/results', 'DELETE')).status, 200);
      await assertEmpty();
      assert.equal((await request(`/api/issues/${findings[0].id}/status`, 'PATCH', { status: 'dismissed' })).status, 404);
      const rerun = await (await request('/api/crawl', 'POST')).json();
      assert.equal(rerun.issues[0].status, 'new');
      assert.equal((await request('/api/results', 'DELETE')).status, 200);
      assert.equal((await request('/api/results', 'DELETE')).status, 200);
      await assertEmpty();
    }
  } finally {
    release?.(); child.kill(); await exited;
    site.closeAllConnections();
    await new Promise<void>(resolve => site.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
