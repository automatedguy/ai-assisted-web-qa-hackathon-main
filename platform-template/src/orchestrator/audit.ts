import { randomUUID } from "node:crypto";
import { crawlSite, type CrawlResult } from "../crawler/crawl.js";
import { loadProfile, loadIssueValidator } from "../config.js";
import { categories, type QaIssue } from "../issues.js";
import { checkBrokenLinks } from "../agents/links.js";
import { spellingGrammarAgent } from "../agents/spelling-grammar.js";
import { localeAgent, formattingAgent, localeRules, formattingRules } from "../agents/locale-formatting.js";
import { brandVoiceAgent, terminologyAgent, brandVoiceRules, terminologyRules } from "../agents/brand-terminology.js";
import { translationQualityAgent } from "../agents/translation-quality.js";
import { mediaAgent } from "../agents/media.js";
import { WorkerFailure } from "../agents/types.js";
import type { Agent, WorkerRun } from "../agents/types.js";
import { captureIssueScreenshots } from "../visual-evidence.js";

const agents: Agent[] = [
  { id: "links", categories: ["links"], scope: "site", execute: async ({ crawl }) => checkBrokenLinks(crawl) },
  spellingGrammarAgent,
  localeAgent,
  formattingAgent,
  brandVoiceAgent,
  terminologyAgent,
  translationQualityAgent,
  mediaAgent,
];
export type Audit = {
  id: string; status: "running" | "completed" | "partial" | "failed";
  phase: string; startedAt: string; finishedAt?: string; durationMs: number;
  targetLocale?: string; crawl?: CrawlResult; workers: WorkerRun[]; issues: QaIssue[];
  coverage: Array<{ category: QaIssue["category"]; implemented: boolean }>;
  error?: string;
};
export function createAudit(): Audit {
  return {
    id: randomUUID(), status: "running", phase: "Loading profile", startedAt: new Date().toISOString(), durationMs: 0,
    workers: [], issues: [], coverage: categories.map(category => ({ category, implemented: agents.some(agent => agent.categories.includes(category)) })),
  };
}
export async function executeAudit(audit: Audit, siteUrl: string, model: string, previous: QaIssue[]) {
  const started = Date.now();
  try {
    const profile = await loadProfile();
    const validateIssue = await loadIssueValidator();
    audit.targetLocale = profile.locale.target_locale;
    audit.phase = "Crawling site";
    const crawl = audit.crawl = await crawlSite(siteUrl);
    const pages = crawl.pages.filter(page => page.status >= 200 && page.status < 300);
    if (!pages.length) throw new Error("No successful HTML pages were available to audit.");
    audit.phase = "Running workers";
    const policyRules = {
      locale: localeRules(profile), formatting: formattingRules(profile),
      "brand-voice": brandVoiceRules(profile), terminology: terminologyRules(profile),
    };
    const tasks = agents.flatMap(agent => (agent.scope === "site" ? [undefined] : pages.filter(page => agent.includeEmptyPages || page.text.trim())).map(page => {
      const report: WorkerRun = {
        id: randomUUID(), agent: agent.id, categories: agent.categories, pageUrl: page?.url,
        status: "queued", attempts: 0, durationMs: 0, issueCount: 0,
        inputTokens: 0, outputTokens: 0, estimatedCostUsd: agent.id === "links" ? 0 : null, usageComplete: true,
        rules: (policyRules[agent.id as keyof typeof policyRules] ?? []).map(rule => ({
          id: rule.id, value: typeof rule.value === "string" ? rule.value : JSON.stringify(rule.value),
        })),
      };
      audit.workers.push(report);
      return async () => {
        const workerStart = Date.now();
        report.status = "running"; report.attempts = 1;
        report.startedAt = new Date().toISOString();
        report.stage = agent.id === "links" ? "Checking HTTP responses" : "Preparing checks";
        const accept = (issues: QaIssue[]) => {
          if (issues.some(issue => !validateIssue(issue) || !agent.categories.includes(issue.category))) throw new Error("Worker findings failed issue schema validation.");
          for (const issue of issues) {
            if (audit.issues.some(existing => existing.id === issue.id)) continue;
            issue.status = previous.find(existing => existing.id === issue.id)?.status ?? "new";
            audit.issues.push(issue);
            report.issueCount++;
          }
        };
        try {
          const issues = await agent.execute({ crawl, page, profile, model, report });
          accept(issues);
          // Agents can explicitly skip when their optional profile rules are absent.
          if ((report as WorkerRun).status !== "skipped") report.status = "completed";
        } catch (error) {
          report.status = "failed";
          report.message = error instanceof Error ? error.message : "Worker failed.";
          if (error instanceof WorkerFailure) {
            try { accept(error.issues); }
            catch { report.message = "Worker findings failed issue schema validation."; }
          }
        } finally {
          report.finishedAt = new Date().toISOString();
          report.durationMs = Date.now() - workerStart;
          console.log(JSON.stringify({ event: "worker_finished", auditId: audit.id, ...report }));
        }
      };
    }));
    // Two independent workers at a time; a failed worker never cancels siblings.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, async () => {
      while (next < tasks.length) { const task = tasks[next++]; await task(); }
    }));
    if (audit.issues.length) {
      audit.phase = "Capturing visual evidence";
      await captureIssueScreenshots(audit.id, audit.issues);
    }
    audit.status = audit.workers.some(worker => worker.status === "failed") || crawl.errors.length > 0 || crawl.limitReached || audit.coverage.some(item => !item.implemented) ? "partial" : "completed";
    audit.phase = "Finished";
  } catch (error) {
    audit.status = "failed"; audit.phase = "Failed";
    audit.error = error instanceof Error ? error.message : "Audit failed.";
  } finally {
    audit.finishedAt = new Date().toISOString(); audit.durationMs = Date.now() - started;
  }
}
