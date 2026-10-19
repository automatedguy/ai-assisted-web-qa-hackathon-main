import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { agentCatalog } from '../src/dashboard/public/activity-cards.js';

// Serve only fixture data and repository assets. No live server, credentials or model calls.
const assets = new URL('../src/dashboard/public/', import.meta.url);
const screenshotDirectory = await mkdtemp(join(tmpdir(), 'qa-activity-ui-'));
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}) });
const issue = {
  id: 'locale-fixture', category: 'locale_rules', severity: 'minor', status: 'new', confidence: 0.95,
  description: 'The weight uses imperial units instead of the configured metric units.',
  evidence: '2 lb <script>window.injected = true</script>', expected: 'Metric units', suggested_fix: '0.91 kg',
  location: { page_url: 'https://example.test/', selector_or_xpath: 'body', element_type: 'text' },
  assessment: { method: 'model_text', rule: { id: 'measurement_units', value: 'metric' } },
};
const makeRun = () => ({
  id: 'activity-fixture', status: 'running', phase: 'Running workers', targetLocale: 'fr-FR',
  startedAt: new Date(Date.now() - 2000).toISOString(), durationMs: 0, issues: [structuredClone(issue)],
  crawl: { pages: [{ url: 'https://example.test/', title: 'Example', status: 200, links: [] }], responses: [], errors: [], limitReached: false },
  workers: agentCatalog.map(agent => ({
    id: agent.id, agent: agent.id, categories: [agent.category], pageUrl: 'https://example.test/',
    status: agent.id === 'locale' ? 'running' : agent.id === 'media' ? 'skipped' : 'completed',
    stage: 'Reviewing content with model', attempts: 1, issueCount: agent.id === 'locale' ? 1 : 0,
    message: agent.id === 'media' ? 'No image or video elements found.' : undefined,
    inputTokens: 100, outputTokens: 25, estimatedCostUsd: null, usageComplete: true,
    cachedInputTokens: 0, cacheWriteInputTokens: 0, cacheUsageComplete: true,
    durationMs: 500, model: 'gpt-6-astra', startedAt: new Date().toISOString(),
    rules: agent.id === 'locale' ? [{ id: 'measurement_units', value: 'metric' }] : [],
  })),
});
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let run = makeRun(); let snapshots = 0;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://qa.test') return route.fulfill({ status: 204, body: '' });
      if (url.pathname.startsWith('/api/')) {
        let data;
        if (url.pathname === '/api/health') data = { apiKeyConfigured: false, model: 'fixture-model' };
        else if (url.pathname === '/api/audits/latest') { data = run; snapshots++; }
        else if (url.pathname === '/api/results' && route.request().method() === 'DELETE') { run = null; data = { cleared: true }; }
        else throw new Error('Unexpected API request: ' + url.pathname);
        return route.fulfill({ json: data });
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      assert.match(file, /^[a-z0-9-]+\.(html|css|js|png)$/);
      const body = await readFile(new URL(file, assets));
      return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html' });
    });
    await page.goto('http://qa.test/');
    await page.locator('#view-activity').click();
    await page.waitForFunction(() => document.querySelectorAll('.agent-card').length === 8);
    const locale = page.locator('.agent-card').filter({ has: page.locator('strong', { hasText: /^Locale$/ }) });
    await locale.locator('.agent-card-disclosure > summary').click();
    await locale.getByText('Why this was flagged', { exact: true }).click();
    await locale.locator('.agent-finding > summary').click();
    assert.match(await locale.locator('.agent-evidence').innerText(), /measurement_units: metric/);
    assert.match(await locale.locator('.agent-evidence').innerText(), /Model text review/);
    assert.match(await locale.locator('.agent-evidence').innerText(), /<script>/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    // Polls must retain disclosure nodes, focus and reading position.
    await locale.locator('.agent-finding > summary').focus();
    const scrollBefore = await page.locator('.activity-panel-body').evaluate(el => el.scrollTop);
    const previous = snapshots;
    const deadline = Date.now() + 5000;
    while (snapshots < previous + 2 && Date.now() < deadline) await page.waitForTimeout(100);
    assert(snapshots >= previous + 2, 'Expected two polling updates');
    assert.equal(await locale.locator('.agent-finding').getAttribute('open'), '');
    assert.equal(await locale.locator('.agent-finding > summary').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.activity-panel-body').evaluate(el => el.scrollTop), scrollBefore);
    // Existing runs can be estimated immediately; edits remain intact during polling.
    assert.match(await page.locator('#panel-cost').innerText(), /\$0\.01800 estimated so far/);
    await page.locator('#run-cost-calculator > summary').click();
    assert.equal(await page.locator('#cost-rate-input').inputValue(), '10');
    await page.locator('#cost-rate-input').fill('20');
    await page.locator('#cost-rate-output').fill('100');
    const costSnapshots = snapshots;
    await page.waitForTimeout(1200);
    assert(snapshots > costSnapshots);
    assert.equal(await page.locator('#cost-rate-input').inputValue(), '20');
    await page.locator('#cost-rates button[type="submit"]').click();
    assert.match(await page.locator('#panel-cost').innerText(), /\$0\.03600/);
    assert.match(await locale.locator('.agent-diagnostics').textContent(), /Cost: \$0\.00450 estimated/);
    await page.locator('#cost-run-count').fill('10');
    assert.match(await page.locator('#cost-projection').innerText(), /\$0\.36000 for 10 similar runs/);
    await page.locator('#cost-rate-input').fill('');
    assert.equal(await page.locator('#cost-rate-input').evaluate(el => el.checkValidity()), false);
    await page.locator('#cost-reset').click();
    assert.match(await page.locator('#panel-cost').innerText(), /\$0\.01800/);
    assert.match(await page.locator('#cost-projection').innerText(), /\$0\.18000/);
    assert.equal(await page.locator('.activity-panel-body').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: join(screenshotDirectory, `${viewport.width}-costs.png`) });
    await page.locator('#run-cost-calculator > summary').click();
    // Failure remains conspicuous alongside retained evidence and neutral no-media skips.
    const localeWorker = run.workers.find(worker => worker.agent === 'locale');
    Object.assign(localeWorker, { status: 'failed', usageComplete: false, message: 'Second request failed; first finding retained.', finishedAt: new Date().toISOString() });
    run.status = 'partial'; run.durationMs = 4000;
    await page.waitForFunction(() => !document.querySelector('#panel-attention').hidden);
    assert.match(await page.locator('#panel-attention').innerText(), /Second request failed/);
    assert.match(await page.locator('#panel-cost').innerText(), /known-usage subtotal/);
    assert.match(await page.locator('#cost-warning').textContent(), /Incomplete estimate/);
    assert.doesNotMatch(await page.locator('#panel-attention').innerText(), /no images or videos/i);
    assert.match(await locale.locator('.agent-badge').innerText(), /Needs attention/);
    assert.match(await page.locator('#panel-metrics').innerText(), /1 page loaded · 6\/8 checks completed/);
    await page.locator('#activity-timeline > summary').click();
    await page.locator('#timeline-agent').selectOption('locale_rules');
    await page.locator('#timeline-kind').selectOption('attention');
    assert.equal(await page.locator('#activity-events li').count(), 1);
    await page.locator('#timeline-latest').click();
    assert.equal(await page.locator('#activity-events li').evaluate(el => el === document.activeElement), true);
    await page.locator('#timeline-agent').selectOption('links');
    assert.equal(await page.locator('#activity-events li').count(), 0);
    assert.equal(await page.locator('#timeline-latest').isDisabled(), true);
    // Header stays reachable while the body scrolls, with no horizontal overflow.
    await page.locator('.activity-panel-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await page.locator('#close-activity').isVisible(), true);
    const header = await page.locator('.activity-panel-header').boundingBox();
    assert(header.y >= 0 && header.y + header.height <= viewport.height);
    assert.equal(await page.locator('#activity-panel').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.locator('.activity-panel-body').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator('.activity-panel-body').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(screenshotDirectory, `${viewport.width}.png`) });
    await locale.locator('.agent-evidence').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, `${viewport.width}-evidence.png`) });
    await locale.locator('.agent-view-findings').click();
    await page.waitForFunction(() => !document.querySelector('#activity-panel').open && document.activeElement.id === 'issues-heading');
    assert.match(await page.locator('#issues-heading').innerText(), /Locale rules findings/);
    await page.locator('#view-activity').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'view-activity');
    // Previously recorded runs need no migration and must not invent a method/rule.
    delete run.issues[0].assessment;
    run.workers.forEach(worker => { delete worker.rules; delete worker.startedAt; delete worker.finishedAt; delete worker.stage; });
    await page.reload();
    await page.locator('#view-activity').click();
    await locale.locator('.agent-card-disclosure > summary').click();
    await locale.getByText('Why this was flagged', { exact: true }).click();
    await locale.locator('.agent-finding > summary').click();
    assert.match(await locale.locator('.agent-evidence').innerText(), /Not recorded for this finding/);
    assert.doesNotMatch(await locale.locator('.agent-evidence').innerText(), /measurement_units/);
    // Unknown models never inherit Astra prices, but can be priced explicitly.
    run.workers.forEach(worker => { worker.model = 'custom-model'; worker.usageComplete = true; });
    await page.reload();
    await page.locator('#view-activity').click();
    await page.waitForFunction(() => document.querySelector('#cost-basis').textContent.includes('custom-model'));
    assert.match(await page.locator('#panel-cost').innerText(), /Unavailable/);
    await page.locator('#run-cost-calculator > summary').click();
    assert.equal(await page.locator('#cost-rate-input').inputValue(), '');
    for (const id of ['input', 'cached', 'write', 'output']) await page.locator('#cost-rate-' + id).fill('0');
    await page.locator('#cost-rates button[type="submit"]').click();
    assert.match(await page.locator('#panel-cost').innerText(), /\$0\.00000 estimated/);
    await page.keyboard.press('Escape');
    await page.locator('#clear').click();
    await page.locator('#view-activity').click();
    await page.waitForFunction(() => document.querySelector('#panel-status').textContent === 'Ready to check your site');
    assert.equal(await page.locator('.agent-finding').count(), 0);
    assert.equal(await page.locator('#activity-events li').count(), 0);
    assert.equal(await page.locator('.agent-card-disclosure[open]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Activity panel checks passed: desktop/mobile, cost calculator, polling, evidence, filters, focus and reset.');
  console.log('Screenshots:', screenshotDirectory);
} finally { await browser.close(); }
