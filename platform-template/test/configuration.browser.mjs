import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'qa-configuration-ui-'));
const referenceDirectory = join(directory, 'reference-content'); await mkdir(join(referenceDirectory, 'nested'), { recursive: true });
await writeFile(join(referenceDirectory, 'nested', 'home.md'), 'Uploaded reference text.');
const assets = new URL('../src/dashboard/public/', import.meta.url);
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}) });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let configuration = { revision: 'one', sites: [{ id: 'environment', name: 'Configured site', url: 'http://localhost:8080/' }],
      profiles: [{ id: 'environment', name: 'Practice YAML', locale: 'es-ES', available: true, referenceCount: 0 }],
      selected: { siteId: 'environment', profileId: 'environment' } };
    let run = null, upload, runRequest, failSite = true, failLoad = false;
    const cost = { usd: 0, partial: false, cacheApproximate: false, runs: 0, unpriced: 0 };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (url.origin !== 'http://qa.test') return route.fulfill({ status: 204, body: '' });
      if (url.pathname.startsWith('/api/')) {
        let data;
        if (url.pathname === '/api/health') data = { apiKeyConfigured: false, model: 'fixture-model' };
        else if (url.pathname === '/api/test-configuration' && method === 'GET') {
          if (failLoad) { failLoad = false; return route.fulfill({ status: 503, json: { error: 'Configuration unavailable.' } }); }
          data = configuration;
        } else if (url.pathname === '/api/test-configuration/sites') {
          if (failSite) { failSite = false; return route.fulfill({ status: 400, json: { error: 'Could not save website. Try again.' } }); }
          const body = route.request().postDataJSON(); assert.equal(body.revision, configuration.revision);
          configuration = { ...configuration, revision: 'two', sites: [...configuration.sites, { id: 'second', name: body.name, url: body.url }] };
          data = { ...configuration, addedId: 'second' };
        } else if (url.pathname === '/api/test-configuration/profiles') {
          upload = route.request().postDataJSON(); assert.equal(upload.revision, configuration.revision);
          configuration = { ...configuration, revision: 'three', profiles: [...configuration.profiles, { id: 'french', name: upload.name, locale: 'fr-FR', available: true, referenceCount: 1 }] };
          data = { ...configuration, addedId: 'french' };
        } else if (url.pathname === '/api/test-configuration' && method === 'PATCH') {
          const body = route.request().postDataJSON(); assert.equal(body.revision, configuration.revision);
          configuration = { ...configuration, revision: 'four', selected: { siteId: body.siteId, profileId: body.profileId } }; run = null; data = configuration;
        } else if (url.pathname === '/api/crawl') {
          runRequest = route.request().postDataJSON();
          run = { id: 'selected-run', kind: 'crawl', status: 'completed', phase: 'Finished', startedAt: new Date().toISOString(), durationMs: 10,
            siteUrl: configuration.sites.find(site => site.id === configuration.selected.siteId).url,
            configuration: { ...configuration.selected, profileName: 'French profile' },
            issues: [], workers: [], coverage: [], crawl: { pages: [], responses: [], errors: [], limitReached: false } };
          data = { ...run.crawl, issues: [], runId: run.id };
        } else if (url.pathname === '/api/audits') data = { runs: run ? [{ ...run, issueCount: 0, cost }] : [], total: run ? 1 : 0,
          currentRunId: run?.id, activeRunId: run?.status === 'running' ? run.id : null,
          spending: { total: cost, models: {}, agents: {}, activeRuns: run?.status === 'running' ? 1 : 0 } };
        else if (url.pathname === '/api/audits/latest') data = run;
        else if (url.pathname.endsWith('/comparison')) data = null;
        else if (url.pathname === '/api/issues') data = [];
        else if (url.pathname === '/api/pages') data = { pages: [], responses: [], errors: [], limitReached: false };
        else throw new Error('Unexpected request: ' + url.pathname);
        return route.fulfill({ json: data });
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      assert.match(file, /^[a-z0-9-]+\.(html|css|js|png)$/);
      return route.fulfill({ body: await readFile(new URL(file, assets)), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html' });
    });
    await page.goto('http://qa.test/');
    await page.waitForFunction(() => !document.querySelector('#audit').disabled);
    await page.getByText('Add a website', { exact: true }).click();
    await page.locator('#site-name').fill('Customer <script>'); await page.locator('#site-url').fill('https://customer.test/');
    await page.getByRole('button', { name: 'Add website', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#configuration-message').dataset.error === 'true');
    assert.match(await page.locator('#configuration-message').textContent(), /Could not save website/);
    assert.equal(await page.locator('#site-url').inputValue(), 'https://customer.test/');
    await page.getByRole('button', { name: 'Add website', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#test-site').value === 'second');
    assert.equal(await page.locator('#audit').isDisabled(), true, 'draft choices cannot start a run');
    await page.getByText('Add a linguistic asset', { exact: true }).click();
    await page.locator('#profile-name').fill('French profile');
    await page.locator('#profile-file').setInputFiles({ name: 'french.yaml', mimeType: 'application/yaml', buffer: Buffer.from('locale:\n  target_locale: fr-FR\n') });
    await page.locator('#profile-references').setInputFiles(referenceDirectory);
    await page.getByRole('button', { name: 'Add linguistic asset', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#test-profile').value === 'french');
    assert.deepEqual(upload.references, [{ path: 'nested/home.md', content: 'Uploaded reference text.' }]);
    assert.match(upload.yaml, /fr-FR/);
    await page.locator('#configuration-apply').click();
    await page.waitForFunction(() => !document.querySelector('#audit').disabled);
    assert.deepEqual(configuration.selected, { siteId: 'second', profileId: 'french' });
    assert.match(await page.locator('#configuration-current').innerText(), /https:\/\/customer.test\/.*French profile/);
    await page.locator('#crawl').click();
    await page.waitForFunction(() => document.querySelector('#history-selected').textContent.includes('selected'));
    assert.equal(runRequest.configurationRevision, 'four');
    assert.equal(run.siteUrl, 'https://customer.test/');
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#audit').disabled);
    assert.equal(await page.locator('#test-site').inputValue(), 'second'); assert.equal(await page.locator('#test-profile').inputValue(), 'french');
    failLoad = true; await page.locator('#configuration-reload').click();
    await page.waitForFunction(() => document.querySelector('#configuration-message').textContent.includes('Configuration unavailable'));
    assert.equal(await page.locator('#audit').isDisabled(), true);
    await page.locator('#configuration-reload').click(); await page.waitForFunction(() => !document.querySelector('#audit').disabled);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#test-configuration').screenshot({ path: join(directory, `${viewport.width}-configuration.png`) });
    run.status = 'running'; await page.reload();
    await page.waitForFunction(() => document.querySelector('#activity-status').textContent.includes('running'));
    assert.equal(await page.locator('#test-site').isDisabled(), true); assert.equal(await page.locator('#test-profile').isDisabled(), true);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Configuration UI passed: desktop/mobile, add site, upload YAML and reference folder, apply, reload, stale draft prevention, failure recovery and active-run locking.');
  console.log('Screenshots:', directory);
} finally { await browser.close(); }
