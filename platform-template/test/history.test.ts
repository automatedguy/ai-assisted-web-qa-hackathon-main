import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunStore } from '../src/run-store.js';
import { compareRuns, summarizeRun, summarizeSpending } from '../src/history.js';
import { createAudit, type Audit } from '../src/orchestrator/audit.js';
import type { QaIssue } from '../src/issues.js';

const issue = (id: string): QaIssue => ({ id, category: 'links', severity: 'minor', status: 'new', confidence: 1,
  description: 'Missing link', evidence: '404', location: { page_url: 'https://example.test/', element_type: 'link' } });
function run(id: string, day = 1): Audit {
  return { ...createAudit(), id, kind: 'audit', siteUrl: 'https://example.test/', status: 'completed', phase: 'Finished',
    startedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`, issues: [issue('same')],
    pricing: { model: 'test', input: 1, output: 2, cachedInput: 0.1, cacheWrite: 1.25, source: 'test' },
    workers: [{ id: 'worker', agent: 'links', categories: ['links'], status: 'completed', attempts: 1, durationMs: 10,
      issueCount: 1, model: 'test', modelCalls: 1, inputTokens: 1000, outputTokens: 1000, usageComplete: true,
      cachedInputTokens: 0, cacheWriteInputTokens: 0, cacheUsageComplete: true, estimatedCostUsd: null }] };
}

test('SQLite retains snapshots, rate cards, current selection and isolated reviews after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-history-'));
  let store = new RunStore(join(directory, 'history.sqlite'));
  try {
    const first = run('first'), second = run('second', 2);
    store.save(first, true); store.save(second, true);
    assert.equal(store.review('first', 'same', 'verified')?.status, 'verified');
    assert.equal(store.get('second')!.issues[0].status, 'new');
    assert.equal(store.current()!.id, 'second');
    assert.equal(first.issues[0].status, 'new', 'saved snapshots are not mutable aliases');
    store.close(); store = new RunStore(join(directory, 'history.sqlite'));
    assert.equal(store.current()!.id, 'second');
    assert.equal(store.get('first')!.issues[0].status, 'verified');
    assert.equal(store.get('first')!.pricing!.output, 2);
    assert.equal(store.reviews('first').length, 1);
    assert.equal(store.reviewIssues(first.siteUrl!)[0].status, 'verified');
    assert.deepEqual(store.reviewIssues('https://different.test/'), []);
    assert.equal(store.list(1).runs[0].id, 'second');
    assert.equal(store.list(1, 1).runs[0].id, 'first');
    assert.equal(store.list().total, 2);
    assert.equal(store.previous(second)!.id, 'first');
    assert.equal(store.spending().total.usd, 0.006);
    assert.equal(store.spending().models.test.usd, 0.006);
    assert.equal(store.spending().agents.links.runs, 2);
    store.save(second); assert.equal(store.list().total, 2, 'checkpoint is an upsert, not a new run');
    store.clearCurrent(first.siteUrl!);
    assert.equal(store.current(), null); assert.equal(store.list().total, 2);
    assert.equal(store.get('first')!.issues[0].status, 'verified');
    assert.deepEqual(store.reviewIssues(first.siteUrl!), []);
    store.close(); store = new RunStore(join(directory, 'history.sqlite'));
    assert.equal(store.current(), null, 'clearing survives restart without deleting history');
    assert.equal(store.reviews('first').length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('restart recovery retains evidence, marks interrupted work and unknown usage, and never resumes it', () => {
  const store = new RunStore(':memory:');
  try {
    const interrupted = run('interrupted'); interrupted.status = 'running';
    interrupted.workers[0].status = 'running';
    interrupted.workers.push({ ...interrupted.workers[0], id: 'queued', status: 'queued', inputTokens: 0, outputTokens: 0, modelCalls: 0 });
    store.save(interrupted, true);
    assert.throws(() => store.review(interrupted.id, 'same', 'dismissed'), /finish/);
    assert.equal(store.recoverInterrupted(), 1);
    const recovered = store.current()!;
    assert.equal(recovered.status, 'partial'); assert.equal(recovered.phase, 'Interrupted');
    assert.equal(recovered.issues.length, 1); assert.match(recovered.error!, /last checkpoint/);
    assert.equal(recovered.workers[0].status, 'failed'); assert.equal(recovered.workers[0].usageComplete, false);
    assert.equal(recovered.workers[1].status, 'skipped'); assert.equal(recovered.cost!.partial, true);
    assert.equal(store.recoverInterrupted(), 0);
  } finally { store.close(); }
});

test('comparisons use stable IDs, enforce site/type/time boundaries and qualify missing findings', () => {
  const before = run('before'), after = run('after', 2);
  before.issues.push(issue('gone')); after.issues.push(issue('new'));
  after.issues[0].description = 'Reworded explanation';
  const comparison = compareRuns(after, before);
  assert.deepEqual(comparison.new.map(item => item.id), ['new']);
  assert.deepEqual(comparison.recurring.map(item => item.id), ['same']);
  assert.deepEqual(comparison.noLongerDetected.map(item => item.id), ['gone']);
  assert.match(comparison.warning, /does not prove a fix/); assert.equal(comparison.incomplete, false);
  after.status = 'partial'; assert.equal(compareRuns(after, before).incomplete, true);
  assert.throws(() => compareRuns(before, after), /earlier/);
  assert.throws(() => compareRuns(after, after), /different/);
  assert.throws(() => compareRuns({ ...after, kind: 'crawl' }, before), /same site and check type/);
  assert.throws(() => compareRuns({ ...after, siteUrl: 'https://other.test/' }, before), /same site and check type/);
});

test('default baseline skips other sites and link-only checks', () => {
  const store = new RunStore(':memory:');
  try {
    const before = run('before'), other = run('other', 2), crawl = run('crawl', 3), current = run('current', 4);
    other.siteUrl = 'https://other.test/'; crawl.kind = 'crawl';
    for (const item of [before, other, crawl, current]) store.save(item);
    assert.equal(store.previous(current)!.id, before.id);
    assert.equal(store.previous(before), null);
  } finally { store.close(); }
});

test('cumulative estimates preserve unknown usage, cached costs and model/agent grouping', () => {
  const first = run('first'), unknown = run('unknown', 2), mixed = run('mixed', 3);
  first.workers[0].cachedInputTokens = 1000;
  unknown.pricing = null; unknown.workers[0].model = 'unknown';
  mixed.workers.push({ ...mixed.workers[0], id: 'extra', agent: 'media', model: 'other',
    pricing: { model: 'other', input: 3, output: 5, cachedInput: 1, cacheWrite: 4, source: 'custom' } });
  const totals = summarizeSpending([first, unknown, mixed].map(summarizeRun));
  assert.equal(totals.total.runs, 3); assert.equal(totals.total.partial, true); assert.equal(totals.total.unpriced, 1);
  assert(Math.abs(totals.total.usd! - 0.0131) < 1e-10);
  assert.equal(totals.models.unknown.usd, null); assert.equal(totals.agents.media.usd, 0.008);
  assert.equal(totals.models.test.runs, 2);
  assert.equal(summarizeSpending([]).total.usd, null);
});
