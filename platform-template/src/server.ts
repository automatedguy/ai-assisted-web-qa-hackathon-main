import express from "express";
import OpenAI from "openai";
import { checkBrokenLinks } from "./agents/links.js";
import type { QaIssue } from "./issues.js";
import { createAudit, executeAudit, type Audit } from "./orchestrator/audit.js";
import { fileURLToPath } from "node:url";
import { crawlSite, type CrawlResult } from "./crawler/crawl.js";
import { mkdirSync } from "node:fs";
import { databasePath, screenshotDir } from './storage-paths.js';
import { RunStore } from './run-store.js';
import { compareRuns } from './history.js';
import { runCost } from './dashboard/public/costs.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
const siteUrl = new URL(process.env.SITE_URL ?? "http://localhost:8080").href;
const store = new RunStore(databasePath);
store.recoverInterrupted();
let latestAudit: Audit | null = store.current();
let latestCrawl: CrawlResult | null = latestAudit?.crawl ?? null;
let latestIssues: QaIssue[] = latestAudit?.issues ?? [];
let crawling = false;
mkdirSync(screenshotDir, { recursive: true });
const active = () => crawling || latestAudit?.status === 'running';
function checkpoint(audit: Audit) {
  try { delete audit.persistenceError; store.save(audit); }
  catch (error) {
    audit.persistenceError = 'Could not save the latest checkpoint. History and costs may be out of date; check server storage.';
    console.error('History checkpoint failed:', error);
  }
}
function beginRun(kind: 'audit' | 'crawl') {
  const run = createAudit(); run.kind = kind; run.siteUrl = siteUrl;
  if (kind === 'audit') run.model = model;
  store.save(run, true); // Fail before starting network/model work if storage is unavailable.
  latestAudit = run; latestIssues = run.issues; latestCrawl = null;
  return run;
}
const checkpointTimer = setInterval(() => {
  if (latestAudit?.status === 'running' || latestAudit?.persistenceError) {
    if (latestAudit.status === 'running') latestAudit.durationMs = Date.now() - Date.parse(latestAudit.startedAt);
    checkpoint(latestAudit);
  }
}, 1000);
checkpointTimer.unref();

app.use(express.json());
app.use(express.static(fileURLToPath(new URL("./dashboard/public/", import.meta.url))));
app.use("/api/screenshots", express.static(screenshotDir, { fallthrough: false, maxAge: "1h" }));

app.get("/api/audits/latest", (_request, response) => response.json(latestAudit));
app.get('/api/audits', (request, response) => {
  const limit = Number(request.query.limit ?? 50), offset = Number(request.query.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
    response.status(400).json({ error: 'Use an integer limit from 1 to 100 and a nonnegative offset.' }); return;
  }
  response.json({ ...store.list(limit, offset), spending: store.spending(), currentRunId: latestAudit?.id ?? null,
    activeRunId: active() ? latestAudit?.id : null });
});
app.get('/api/audits/:id', (request, response) => {
  const run = latestAudit?.id === request.params.id ? latestAudit : store.get(request.params.id);
  if (!run) { response.status(404).json({ error: 'Run not found.' }); return; }
  response.json(run);
});
app.get('/api/audits/:id/comparison', (request, response) => {
  const run = latestAudit?.id === request.params.id ? latestAudit : store.get(request.params.id);
  if (!run) { response.status(404).json({ error: 'Run not found.' }); return; }
  if (request.query.baseline !== undefined && typeof request.query.baseline !== 'string') {
    response.status(400).json({ error: 'Use one baseline run ID.' }); return;
  }
  const baseline = request.query.baseline ? store.get(request.query.baseline as string) : store.previous(run);
  if (!baseline) {
    if (request.query.baseline) response.status(404).json({ error: 'Baseline run not found.' });
    else response.json(null);
    return;
  }
  try { response.json(compareRuns(run, baseline)); }
  catch (error) { response.status(400).json({ error: (error as Error).message }); }
});
app.get('/api/audits/:id/reviews', (request, response) => {
  if (!store.get(request.params.id)) { response.status(404).json({ error: 'Run not found.' }); return; }
  response.json(store.reviews(request.params.id));
});
app.post("/api/audits", (_request, response) => {
  if (active()) {
    response.status(409).json({ error: "An audit or crawl is already running." });
    return;
  }
  const previous = store.reviewIssues(siteUrl);
  const audit = beginRun('audit');
  response.status(202).json(audit);
  void executeAudit(audit, siteUrl, model, previous, () => checkpoint(audit)).then(() => {
    latestCrawl = audit.crawl ?? null;
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model, storage: 'sqlite', persistenceError: latestAudit?.persistenceError ?? null,
  });
});

app.get("/api/pages", (_request, response) => {
  response.json(latestCrawl ?? { pages: [], responses: [], errors: [], startUrl: siteUrl, limitReached: false });
});

app.get("/api/issues", (_request, response) => {
  response.json(latestIssues);
});

app.delete("/api/results", (_request, response) => {
  if (active()) {
    response.status(409).json({ error: "Wait for the current audit or crawl to finish before clearing results." });
    return;
  }
  store.clearCurrent(siteUrl);
  latestAudit = null;
  latestCrawl = null;
  latestIssues = [];
  response.json({ message: "Workspace cleared. Saved runs, reviews and cost history were retained. Future runs start with fresh review decisions." });
});

app.patch(['/api/issues/:id/status', '/api/audits/:runId/issues/:id/status'], (request, response) => {
  const { status } = (request.body ?? {}) as { status?: unknown };
  if (typeof status !== 'string' || !["verified", "dismissed", "escalated"].includes(status)) {
    response.status(400).json({ error: "Status must be verified, dismissed, or escalated." });
    return;
  }

  const runId = typeof request.params.runId === 'string' ? request.params.runId : latestAudit?.id;
  const run = runId ? store.get(runId) : null;
  if (!run) {
    response.status(404).json({ error: 'Run not found.' }); return;
  }
  if (run.status === 'running' || (latestAudit?.id === runId && active())) {
    response.status(409).json({ error: 'Wait for this run to finish before reviewing findings.' }); return;
  }
  if (latestAudit && latestAudit.id === runId && latestAudit.persistenceError) {
    response.status(503).json({ error: latestAudit.persistenceError }); return;
  }
  const issue = store.review(runId!, String(request.params.id), status as QaIssue['status']);
  if (!issue) {
    response.status(404).json({ error: "Issue not found." });
    return;
  }

  if (latestAudit?.id === runId) {
    const current = latestIssues.find(item => item.id === issue.id);
    if (current) current.status = issue.status;
  }
  response.json(issue);
});

app.post("/api/crawl", async (_request, response) => {
  if (active()) {
    response.status(409).json({ error: "An audit or crawl is already running." });
    return;
  }
  const previousStatuses = new Map(store.reviewIssues(siteUrl).map(issue => [issue.id, issue.status]));
  const audit = beginRun('crawl');
  audit.phase = 'Crawling pages and checking links';
  audit.workers = [{ id: 'links', agent: 'links', categories: ['links'], status: 'running', attempts: 1,
    durationMs: 0, issueCount: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, estimatedCostUsd: 0, usageComplete: true,
    startedAt: audit.startedAt }];
  checkpoint(audit); crawling = true;
  try {
    latestCrawl = audit.crawl = await crawlSite(siteUrl);
    latestIssues = audit.issues = checkBrokenLinks(latestCrawl);
    for (const issue of latestIssues) {
      const previousStatus = previousStatuses.get(issue.id);
      if (previousStatus) issue.status = previousStatus;
    }
    audit.status = latestCrawl.errors.length || latestCrawl.limitReached || !latestCrawl.pages.some(page => page.status >= 200 && page.status < 300) ? 'partial' : 'completed';
    audit.phase = 'Finished';
    audit.workers[0].status = audit.status === 'completed' ? 'completed' : 'failed';
    audit.workers[0].issueCount = latestIssues.length;
    response.json({ ...latestCrawl, issues: latestIssues, runId: audit.id });
  } catch {
    audit.status = 'failed'; audit.phase = 'Failed'; audit.error = 'Could not crawl SITE_URL. Check the site URL and network.';
    audit.workers[0].status = 'failed'; audit.workers[0].message = audit.error;
    response.status(502).json({ error: "Could not crawl SITE_URL. Check the site URL and network." });
  } finally {
    audit.finishedAt = audit.workers[0].finishedAt = new Date().toISOString();
    audit.durationMs = audit.workers[0].durationMs = Date.now() - Date.parse(audit.startedAt);
    audit.cost = runCost(audit); checkpoint(audit);
    crawling = false;
  }
});

app.post("/api/test-model", async (_request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const client = new OpenAI();
    const result = await client.responses.create({
      model,
      input: "Reply with exactly: API connection successful.",
      max_output_tokens: 24,
    });
    response.json({ message: result.output_text, model });
  } catch {
    console.error("OpenAI API request failed.");
    response.status(502).json({
      error: "OpenAI request failed. Check the API key and model configuration.",
    });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('API request failed:', error);
  response.status(500).json({ error: 'Could not complete the request. Check server logs and storage permissions.' });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`QA Platform listening on port ${port}`);
});
function shutdown() {
  clearInterval(checkpointTimer);
  if (latestAudit?.status === 'running' || latestAudit?.persistenceError) checkpoint(latestAudit);
  server.close(); store.close(); process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
