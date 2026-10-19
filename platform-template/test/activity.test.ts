import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary, workerActivity, categoryNames } from '../src/dashboard/public/activity.js';
import { agentCardData, agentCatalog, needsAttention } from '../src/dashboard/public/activity-cards.js';

const worker = (overrides = {}) => ({
  id: 'spelling-grammar-home', agent: 'spelling-grammar', categories: ['spelling_grammar'], status: 'completed',
  pageUrl: 'https://example.test/', attempts: 1, issueCount: 0, ...overrides,
});
const run = (overrides = {}) => ({
  id: 'example', status: 'completed', phase: 'Finished', issues: [], workers: [worker()], ...overrides,
});

test('agent cards distinguish completed checks, failures and non-applicable media', () => {
  const media = agentCatalog.find(agent => agent.id === 'media')!;
  const reports = [
    worker({ id: 'ok', agent: 'media', categories: ['media'], issueCount: 1 }),
    worker({ id: 'failed', agent: 'media', categories: ['media'], status: 'failed' }),
    worker({ id: 'empty', agent: 'media', categories: ['media'], status: 'skipped', message: 'No image or video elements found.' }),
  ];
  const data = agentCardData(run({ workers: reports, issues: [{ category: 'media' }, { category: 'links' }] }), media);
  assert.equal(data.state, 'Needs attention');
  assert.equal(data.completed, 1); assert.equal(data.failed, 1);
  assert.equal(data.notApplicable, 1); assert.equal(data.skipped, 0); assert.equal(data.findings.length, 1);
  assert.equal(needsAttention(reports[2]), false);
  assert.equal(agentCardData(run({ workers: [] }), media).state, 'Not run');
  assert.equal(agentCardData(run({ workers: [], status: 'running' }), media).state, 'Waiting for dispatch');
  assert.equal(agentCardData(run({ workers: [], kind: 'crawl', status: 'running' }), media).state, 'Not run');
});

test('activity distinguishes available categories from checks that actually ran', () => {
  const result = activitySummary(run({ coverage: Object.keys({ spelling_grammar: 1, links: 1 }).map(category => ({ category, implemented: true })) }));
  assert.equal(result.coverage.find(entry => entry.category === 'spelling_grammar').text, '1 completed');
  assert.equal(result.coverage.find(entry => entry.category === 'links').text, 'Not run');
  assert.match(result.attention, /7 categories not run/);
});

test('failed and skipped checks remain visible even when siblings completed', () => {
  const result = activitySummary(run({ status: 'partial', workers: [
    worker(), worker({ id: 'failed', status: 'failed' }), worker({ id: 'skipped', status: 'skipped' }),
  ] }));
  assert.equal(result.tone, 'warning');
  assert.match(result.attention, /1 check needs attention/);
  assert.match(result.attention, /1 check skipped/);
  assert.equal(result.coverage[0].text, '1 completed · 1 failed · 1 skipped');
});

test('running checks report actual concurrency and do not call queued categories completed', () => {
  const result = activitySummary(run({ status: 'running', phase: 'Running workers', workers: [
    worker({ status: 'running' }), worker({ id: 'queued', status: 'queued' }),
  ] }));
  assert.match(result.status, /1 check active/);
  assert.equal(result.tone, 'running');
  assert.equal(result.coverage[0].text, '1 running · 1 queued');
  assert.equal(result.coverage.find(entry => entry.category === 'media').text, 'Waiting for dispatch');
  assert.equal(result.attention, '');
});

test('link-only runs disclose their limited scope and incomplete crawls', () => {
  const result = activitySummary(run({ kind: 'crawl', workers: [worker({ agent: 'links', categories: ['links'] })] }));
  assert.match(result.status, /Link check complete/);
  assert.match(result.attention, /7 categories not run/);
  const partial = activitySummary(run({ status: 'partial', crawl: { errors: [], limitReached: true } }));
  assert.match(partial.attention, /coverage incomplete/);
});

test('failed startup and unavailable categories cannot look like full coverage', () => {
  const failed = activitySummary(run({ status: 'failed', error: 'Profile could not be loaded.', workers: [] }));
  assert.match(failed.attention, /Run failed.*8 categories not run/);
  assert.equal(failed.detail, 'Profile could not be loaded.');
  const unavailable = activitySummary(run({ status: 'running', workers: [], coverage: [{ category: 'media', implemented: false }] }));
  assert.equal(unavailable.coverage.find(entry => entry.category === 'media').text, 'Unavailable');
  assert.match(unavailable.attention, /1 category not run/);
});

test('human-readable activity includes retry attempts, skip reasons and retained findings', () => {
  assert.match(workerActivity(worker({ status: 'running', attempts: 2 })), /Spelling & Grammar · the home page: reviewing \(attempt 2\)/);
  assert.match(workerActivity(worker({ status: 'skipped', message: 'No configured rules.' })), /skipped. No configured rules/);
  assert.match(workerActivity(worker({ status: 'failed', issueCount: 1, message: 'Request failed.' })), /Request failed. 1 finding retained/);
  assert.equal(activitySummary(null).tone, 'idle');
});

test('media on a page without images or videos is neutral and not applicable', () => {
  const noMedia = worker({ agent: 'media', categories: ['media'], status: 'skipped',
    pageUrl: 'https://example.test/pricing.html', message: 'No image or video elements found.' });
  const result = activitySummary(run({ workers: [worker({ categories: Object.keys(categoryNames) }), noMedia] }));
  assert.equal(result.attention, '');
  assert.equal(result.note, '1 check not applicable · /pricing.html: no images or videos.');
  assert.equal(result.tone, 'complete');
  assert.equal(result.coverage.find(entry => entry.category === 'media').text, '1 completed · 1 not applicable');
  assert.match(workerActivity(noMedia), /not applicable — no images or videos on this page/);
});

test('inapplicable media does not hide missing references, unsupported resources or failures', () => {
  const result = activitySummary(run({ status: 'partial', workers: [
    worker({ agent: 'media', categories: ['media'], status: 'skipped', message: 'No image or video elements found.' }),
    worker({ agent: 'translation-quality', categories: ['translation_quality'], status: 'skipped', message: 'No reference_content mapping for this page; translation quality was not checked.' }),
    worker({ agent: 'media', categories: ['media'], status: 'skipped', message: 'Unsupported media.' }),
    worker({ agent: 'media', categories: ['media'], status: 'failed', message: 'Resource limit reached.' }),
  ] }));
  assert.match(result.attention, /2 checks skipped/);
  assert.match(result.attention, /1 check needs attention/);
  assert.match(result.note, /1 check not applicable/);
  assert.equal(result.tone, 'warning');
});
