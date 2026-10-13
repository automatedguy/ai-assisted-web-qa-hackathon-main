import type { CrawlResult, CrawledPage } from "../crawler/crawl.js";
import type { Profile } from "../config.js";
import type { QaIssue } from "../issues.js";

export type WorkerRun = {
  id: string; agent: string; category: QaIssue["category"]; pageUrl?: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  attempts: number; durationMs: number; issueCount: number;
  inputTokens: number; outputTokens: number; estimatedCostUsd: number | null;
  usageComplete: boolean; model?: string; message?: string;
};
export type AgentContext = {
  crawl: CrawlResult; page?: CrawledPage; profile: Profile; model: string;
  report: WorkerRun;
};
export type Agent = {
  id: string; category: QaIssue["category"]; scope: "site" | "page";
  execute(context: AgentContext): Promise<QaIssue[]>;
};
