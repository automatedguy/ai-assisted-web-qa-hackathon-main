import type { Audit } from './orchestrator/audit.js';
import { runCost, workerCost, workerPricing, type Estimate } from './dashboard/public/costs.js';

export type CostTotal = Estimate & { runs: number; unpriced: number };
function emptyTotal(): CostTotal { return { usd: null, partial: false, cacheApproximate: false, runs: 0, unpriced: 0 }; }
function add(total: CostTotal, estimate: Estimate) {
  if (estimate.usd !== null) total.usd = (total.usd ?? 0) + estimate.usd;
  total.partial ||= estimate.partial || estimate.usd === null;
  total.cacheApproximate ||= estimate.cacheApproximate;
  if (estimate.usd === null) total.unpriced++;
}
export function summarizeRun(run: Audit) {
  const models: Record<string, Estimate> = Object.create(null);
  const agents: Record<string, Estimate> = Object.create(null);
  for (const worker of run.workers) {
    const estimate = workerCost(worker, workerPricing(worker, run.pricing));
    for (const [groups, key] of [[models, worker.model || (worker.modelCalls === 0 ? 'No model calls' : run.model || 'Unknown model')], [agents, worker.agent]] as const) {
      const total = groups[key] ??= emptyTotal();
      if (estimate.usd !== null) total.usd = (total.usd ?? 0) + estimate.usd;
      total.partial ||= estimate.partial || estimate.usd === null;
      total.cacheApproximate ||= estimate.cacheApproximate;
    }
  }
  return { id: run.id, kind: run.kind ?? 'audit', siteUrl: run.siteUrl ?? run.crawl?.startUrl ?? '',
    profileName: run.configuration?.profileName, profileFingerprint: run.configuration?.profileFingerprint,
    startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status, durationMs: run.durationMs,
    issueCount: run.issues.length, cost: runCost(run), models, agents };
}
export type RunSummary = ReturnType<typeof summarizeRun>;
export function summarizeSpending(runs: RunSummary[]) {
  const total = emptyTotal();
  const models: Record<string, CostTotal> = Object.create(null);
  const agents: Record<string, CostTotal> = Object.create(null);
  for (const run of runs) {
    total.runs++; add(total, run.cost);
    for (const [groups, estimates] of [[models, run.models], [agents, run.agents]] as const) {
      for (const [key, estimate] of Object.entries(estimates)) {
        const group = groups[key] ??= emptyTotal();
        group.runs++; add(group, estimate);
      }
    }
  }
  return { total, models, agents, activeRuns: runs.filter(run => run.status === 'running').length };
}

export function compareRuns(current: Audit, baseline: Audit) {
  if (current.id === baseline.id) throw new Error('Choose a different baseline run.');
  if ((current.siteUrl ?? current.crawl?.startUrl) !== (baseline.siteUrl ?? baseline.crawl?.startUrl) ||
      (current.kind ?? 'audit') !== (baseline.kind ?? 'audit')) throw new Error('Compare runs of the same site and check type.');
  if (current.configuration?.profileFingerprint !== baseline.configuration?.profileFingerprint) throw new Error('Compare runs using the same linguistic profile and reference content.');
  if (baseline.startedAt > current.startedAt) throw new Error('The baseline must be an earlier run.');
  const before = new Set(baseline.issues.map(issue => issue.id));
  const after = new Set(current.issues.map(issue => issue.id));
  const incomplete = [baseline, current].some(run => run.status !== 'completed' || run.crawl?.limitReached ||
    run.crawl?.errors.length || run.workers.some(worker => worker.status !== 'completed' &&
      !(worker.status === 'skipped' && worker.message === 'No image or video elements found.')) ||
    run.browserCoverage?.some(page => page.status !== 'completed'));
  return { baseline: summarizeRun(baseline), current: summarizeRun(current), incomplete,
    warning: (incomplete ? 'Coverage is incomplete in one or both runs. ' : '') +
      'Matched by stable finding ID. No longer detected does not prove a fix: content, policy, selectors, evidence quotes or model output may have changed.',
    new: current.issues.filter(issue => !before.has(issue.id)),
    recurring: current.issues.filter(issue => before.has(issue.id)),
    noLongerDetected: baseline.issues.filter(issue => !after.has(issue.id)) };
}
