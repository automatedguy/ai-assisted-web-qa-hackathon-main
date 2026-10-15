import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary, workerActivity } from '../src/dashboard/public/activity.js';

const worker = (overrides = {}) => ({
  id: 'language-home', agent: 'language', categories: ['spelling_grammar'], status: 'completed',
  pageUrl: 'https://example.test/', attempts: 1, issueCount: 0, ...overrides,
});
const run = (overrides = {}) => ({
  id: 'example', status: 'completed', phase: 'Finished', issues: [], workers: [worker()], ...overrides,
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
  assert.match(workerActivity(worker({ status: 'running', attempts: 2 })), /Language · the home page: reviewing \(attempt 2\)/);
  assert.match(workerActivity(worker({ status: 'skipped', message: 'No configured rules.' })), /skipped. No configured rules/);
  assert.match(workerActivity(worker({ status: 'failed', issueCount: 1, message: 'Request failed.' })), /Request failed. 1 finding retained/);
  assert.equal(activitySummary(null).tone, 'idle');
});
