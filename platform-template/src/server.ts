import express from "express";
import OpenAI from "openai";
import { checkBrokenLinks, type QaIssue } from "./agents/links.js";
import { crawlSite, type CrawlResult } from "./crawler/crawl.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
const siteUrl = process.env.SITE_URL ?? "http://localhost:8080";
let latestCrawl: CrawlResult | null = null;
let latestIssues: QaIssue[] = [];

app.use(express.json());

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

app.get("/", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QA Platform</title></head>
  <body>
    <main>
      <h1>QA Platform</h1>
      <p id="status">Checking server configuration…</p>
      <button id="crawl" type="button">Crawl test site</button>
      <p id="crawl-status" aria-live="polite"></p>
      <ul id="pages"></ul>
      <section aria-labelledby="issues-heading">
        <h2 id="issues-heading">Findings</h2>
        <p id="issue-summary">No crawl yet.</p>
        <ul id="issues"></ul>
      </section>
      <button id="test" type="button">Test OpenAI connection</button>
      <pre id="result" aria-live="polite"></pre>
    </main>
    <script>
      const status = document.querySelector('#status');
      const result = document.querySelector('#result');
      const button = document.querySelector('#test');
      const crawlButton = document.querySelector('#crawl');
      const crawlStatus = document.querySelector('#crawl-status');
      const pagesList = document.querySelector('#pages');
      const issueSummary = document.querySelector('#issue-summary');
      const issuesList = document.querySelector('#issues');
      function renderIssues(issues) {
        issuesList.replaceChildren();
        issueSummary.textContent = issues.length +
          (issues.length === 1 ? ' link issue.' : ' link issues.');
        for (const issue of issues) {
          const item = document.createElement('li');
          const heading = document.createElement('strong');
          heading.textContent = issue.severity.toUpperCase() + ' · ' + issue.description;
          const evidence = document.createElement('p');
          evidence.textContent = 'Evidence: ' + issue.evidence;
          const location = document.createElement('p');
          location.textContent = 'Page: ' + issue.location.page_url + ' · Status: ' + issue.status;
          const actions = document.createElement('div');
          for (const [nextStatus, label] of [
            ['verified', 'Verified'],
            ['dismissed', 'Dismiss'],
            ['escalated', 'Escalate'],
          ]) {
            const action = document.createElement('button');
            action.type = 'button';
            action.textContent = label;
            action.disabled = issue.status === nextStatus;
            action.addEventListener('click', async () => {
              action.disabled = true;
              try {
                const update = await fetch('/api/issues/' + encodeURIComponent(issue.id) + '/status', {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ status: nextStatus }),
                });
                const updatedIssue = await update.json();
                if (!update.ok) throw new Error(updatedIssue.error);
                issue.status = updatedIssue.status;
                location.textContent = 'Page: ' + issue.location.page_url + ' · Status: ' + issue.status;
                for (const button of actions.querySelectorAll('button')) {
                  button.disabled = button.textContent === label;
                }
              } catch (error) {
                crawlStatus.textContent = 'Could not update the issue: ' + String(error);
                action.disabled = false;
              }
            });
            actions.append(action);
          }
          item.append(heading, evidence, location, actions);
          issuesList.append(item);
        }
      }
      fetch('/api/issues').then(r => r.json()).then(issues => {
        if (issues.length > 0) renderIssues(issues);
      });
      fetch('/api/health').then(r => r.json()).then(data => {
        status.textContent = data.apiKeyConfigured
          ? 'Server ready · API key configured · Model: ' + data.model
          : 'Server ready · API key missing';
      }).catch(() => { status.textContent = 'Could not load server status.'; });
      crawlButton.addEventListener('click', async () => {
        crawlButton.disabled = true;
        crawlStatus.textContent = 'Crawling pages…';
        pagesList.replaceChildren();
        issuesList.replaceChildren();
        try {
          const response = await fetch('/api/crawl', { method: 'POST' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          for (const page of data.pages) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = page.url;
            link.textContent = page.title || page.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const details = document.createElement('span');
            details.textContent = ' — HTTP ' + page.status + ', ' + page.links.length +
              (page.links.length === 1 ? ' link' : ' links');
            item.append(link, details);
            pagesList.append(item);
          }
          const httpFailures = data.responses.filter(item => item.status < 200 || item.status >= 400).length;
          crawlStatus.textContent = data.pages.length + (data.pages.length === 1 ? ' HTML page crawled; ' : ' HTML pages crawled; ') +
            httpFailures + (httpFailures === 1 ? ' unsuccessful HTTP response; ' : ' unsuccessful HTTP responses; ') +
            data.errors.length + (data.errors.length === 1 ? ' crawl failure.' : ' crawl failures.') +
            (data.limitReached ? ' Page limit reached.' : '');
          renderIssues(data.issues);
        } catch (error) {
          crawlStatus.textContent = String(error);
        } finally {
          crawlButton.disabled = false;
        }
      });
      button.addEventListener('click', async () => {
        button.disabled = true;
        result.textContent = 'Sending a short request to the model…';
        try {
          const response = await fetch('/api/test-model', { method: 'POST' });
          const data = await response.json();
          result.textContent = response.ok ? data.message : data.error;
        } catch (error) {
          result.textContent = String(error);
        } finally {
          button.disabled = false;
        }
      });
    </script>
  </body>
</html>`);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`QA Platform listening on port ${port}`);
});
