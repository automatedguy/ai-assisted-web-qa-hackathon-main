import express from "express";
import OpenAI from "openai";
import { checkBrokenLinks } from "./agents/links.js";
import type { QaIssue } from "./issues.js";
import { createAudit, executeAudit, type Audit } from "./orchestrator/audit.js";
import { fileURLToPath } from "node:url";
import { crawlSite, type CrawlResult } from "./crawler/crawl.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
const siteUrl = process.env.SITE_URL ?? "http://localhost:8080";
let latestCrawl: CrawlResult | null = null;
let latestIssues: QaIssue[] = [];
let latestAudit: Audit | null = null;
let crawling = false;

app.use(express.json());
app.use(express.static(fileURLToPath(new URL("./dashboard/public/", import.meta.url))));

app.get("/api/audits/latest", (_request, response) => response.json(latestAudit));
app.post("/api/audits", (_request, response) => {
  if (crawling || latestAudit?.status === "running") {
    response.status(409).json({ error: "An audit or crawl is already running." });
    return;
  }
  const previous = latestIssues;
  const audit = latestAudit = createAudit();
  latestIssues = audit.issues;
  latestCrawl = null;
  response.status(202).json(audit);
  void executeAudit(audit, siteUrl, model, previous).then(() => {
    latestCrawl = audit.crawl ?? null;
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model,
  });
});

app.get("/api/pages", (_request, response) => {
  response.json(latestCrawl ?? { pages: [], responses: [], errors: [], startUrl: siteUrl, limitReached: false });
});

app.get("/api/issues", (_request, response) => {
  response.json(latestIssues);
});

app.patch("/api/issues/:id/status", (request, response) => {
  const { status } = request.body as { status?: unknown };
  if (!["verified", "dismissed", "escalated"].includes(String(status))) {
    response.status(400).json({ error: "Status must be verified, dismissed, or escalated." });
    return;
  }

  const issue = latestIssues.find((item) => item.id === request.params.id);
  if (!issue) {
    response.status(404).json({ error: "Issue not found." });
    return;
  }

  issue.status = status as QaIssue["status"];
  response.json(issue);
});

app.post("/api/crawl", async (_request, response) => {
  if (crawling || latestAudit?.status === "running") {
    response.status(409).json({ error: "An audit or crawl is already running." });
    return;
  }
  crawling = true;
  latestAudit = null;
  try {
    const previousStatuses = new Map(latestIssues.map((issue) => [issue.id, issue.status]));
    latestCrawl = await crawlSite(siteUrl);
    latestIssues = checkBrokenLinks(latestCrawl);
    for (const issue of latestIssues) {
      const previousStatus = previousStatuses.get(issue.id);
      if (previousStatus) issue.status = previousStatus;
    }
    response.json({ ...latestCrawl, issues: latestIssues });
  } catch {
    response.status(502).json({ error: "Could not crawl SITE_URL. Check the site URL and network." });
  } finally {
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

app.listen(port, "0.0.0.0", () => {
  console.log(`QA Platform listening on port ${port}`);
});
