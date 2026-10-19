import type { CrawlResult, CrawledPage } from "../crawler/crawl.js";
import type { Profile } from "../config.js";
import type { QaIssue } from "../issues.js";
import type { Pricing } from "../dashboard/public/costs.js";

export type WorkerRun = {
  id: string; agent: string; categories: QaIssue["category"][]; pageUrl?: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  attempts: number; durationMs: number; issueCount: number;
  modelCalls?: number;
  requestAttempt?: number;
  inputTokens: number; outputTokens: number; estimatedCostUsd: number | null;
  cachedInputTokens?: number; cacheWriteInputTokens?: number; cacheUsageComplete?: boolean;
  pricing?: Pricing | null;
  usageComplete: boolean; model?: string; message?: string;
  startedAt?: string; finishedAt?: string; stage?: string;
  rules?: Array<{ id: string; value: string }>;
  mediaChecks?: Array<{ asset: string; check: string; status: "completed" | "failed" | "skipped"; message: string }>;
};
export type AgentContext = {
  crawl: CrawlResult; page?: CrawledPage; profile: Profile; model: string;
  report: WorkerRun;
  referenceContentPath?: string;
};
export type Agent = {
  id: string; categories: QaIssue["category"][]; scope: "site" | "page";
  includeEmptyPages?: boolean;
  execute(context: AgentContext): Promise<QaIssue[]>;
};

// Keep validated deterministic evidence even when a later model step fails.
export class WorkerFailure extends Error {
  constructor(message: string, readonly issues: QaIssue[]) { super(message); }
}
