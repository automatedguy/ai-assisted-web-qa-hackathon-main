import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { exportResults } from '../src/results-export.ts';

const directory = await mkdtemp(join(tmpdir(), 'qa-html-report-'));
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}) });
try {
  const fixture = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  await fixture.setContent('<html><body style="font-family:Arial;padding:48px;background:#f6f6f8"><h1>Example pricing page</h1><p>Captured during the audit</p><div style="border:3px solid #a80000;padding:24px;width:450px;background:white"><h2>Business plan</h2><p>Unlimited storage</p><strong>19,99 € / month</strong></div></body></html>');
  await fixture.screenshot({ path: join(directory, 'evidence.png') });
  await fixture.close();
  const issue = { id: 'translation-1', category: 'translation_quality', severity: 'major', status: 'verified', confidence: .92,
    location: { page_url: 'https://example.test/pricing', element_type: 'text', selector_or_xpath: '#business-plan' },
    description: 'The translated storage allowance differs from the source.',
    evidence: 'Source: "100 GB"\nTarget: "Unlimited storage"\nLiteral text: <script>window.injected=true</script>',
    expected: 'Preserve the 100 GB allowance.', suggested_fix: 'Replace “Unlimited storage” with “100 GB”.',
    visual_evidence: { screenshot_url: '/api/screenshots/evidence.png', highlighted: true, note: 'The affected plan is outlined in red.' },
    assessment: { method: 'model_text', check: 'Meaning comparison' },
    reproduction: { viewport: { width: 1000, height: 560 }, steps: [] },
  };
  const run = { id: 'offline-fixture', kind: 'audit', status: 'partial', phase: 'Finished', siteUrl: 'https://example.test/',
    startedAt: '2026-10-19T12:00:00.000Z', finishedAt: '2026-10-19T12:01:00.000Z', durationMs: 60000, targetLocale: 'fr-FR',
    issues: [issue, { ...issue, id: 'missing-shot', category: 'media', status: 'new', severity: 'minor',
      description: 'The image alternative text needs review.', visual_evidence: { screenshot_url: '/api/screenshots/missing.png', highlighted: false } }],
    workers: [{ id: 'translation', agent: 'translation-quality', categories: ['translation_quality'], status: 'completed',
      pageUrl: 'https://example.test/pricing', attempts: 1, durationMs: 12000, issueCount: 1, inputTokens: 100, outputTokens: 50,
      estimatedCostUsd: null, usageComplete: true, model: 'custom-model' }], coverage: [],
  };
  const report = await exportResults(run, 'html', [{ issueId: issue.id, previousStatus: 'new', status: 'verified', reviewedAt: run.finishedAt }], directory);
  const reportPath = join(directory, report.filename); await writeFile(reportPath, report.body);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const network = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(reportPath).href);
    await page.locator('img').evaluate(img => img.decode());
    assert.equal(await page.locator('img').evaluate(img => img.naturalWidth), 1000);
    assert.equal(await page.locator('.finding').count(), 2);
    assert.match(await page.locator('#finding-1 blockquote').innerText(), /<script>window.injected=true<\/script>/);
    assert.equal(await page.locator('script').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.match(await page.locator('#finding-2 .unavailable').innerText(), /missing or cannot be read/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(directory, `${viewport.width}-overview.png`) });
    await page.locator('a[href="#category-translation_quality"]').click();
    await page.locator('#finding-1').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, `${viewport.width}-finding.png`) });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('figure').evaluate(el => getComputedStyle(el).maxHeight), 'none');
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Standalone HTML report passed: embedded image decoded offline, desktop/mobile, escaped evidence, missing image notice and print layout.');
  console.log('Report and screenshots:', directory);
} finally { await browser.close(); }
