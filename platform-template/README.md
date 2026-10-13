# QA Platform — Starter Scaffold

The initial platform is a TypeScript and Express app. It provides a small
dashboard, a same-origin crawler capped at 50 pages, a deterministic checker
for broken same-origin links, and a button for a short OpenAI API connection
check. Issues can be marked verified, dismissed, or escalated; review state is
currently held in memory and resets when the server restarts. Build the
remaining checkers and durable issue store here, keeping the contract below
so organizers can swap in the demo site and linguistic asset without code
changes.

## Local Development

From this directory, run `npm install`, then `npm run dev`. The development
script reads `OPENAI_API_KEY` and `OPENAI_MODEL` from the repository-root
`.env` file. Open `http://localhost:3000`; clicking **Test OpenAI connection**
makes a short billable API request. `npm run typecheck` checks TypeScript.

To run the site and platform together, stop any separately run site container
that already owns port `8080`, then run `docker compose up --build` from the
repository root. Compose passes the root `.env` values into the platform.
Never commit `.env` or expose its key in browser code.

## Contract

**Inputs your container receives** (set in `docker-compose.yml` at the repo root):
- `SITE_URL` — base URL of the site under test (e.g. `http://site-under-test`)
- `LINGUISTIC_ASSET_PATH` — path to the linguistic asset YAML, mounted read-only at `/data/linguistic-assets/...`
- Reference source content (for translation-quality checks), mounted read-only at `/data/reference-content/*.md`

**What your platform must do:**
1. Crawl or fetch the pages of the site at `SITE_URL`.
2. Run checks across all categories in `docs/CHECK_CATALOG.md` using the linguistic asset as ground truth for "what correct looks like."
3. Produce issues conforming to `docs/ISSUE_SCHEMA.json`.
4. Serve a review dashboard on port `3000` where a human can see every check performed, filter/browse issues, and mark each one `verified`, `dismissed`, or `escalated`.
5. Log what ran: which agent, on what input, how long it took, and (if you're tracking it) token/cost usage.

**What you're free to design yourself:**
- Language, framework, storage, agent framework or none at all.
- How you crawl the site (headless browser, static HTML parse, etc.) — note the site includes an embedded video with a caption track, so plan for that if you want the media checks working.
- Prompt design, model choice per agent, orchestration pattern.
- Dashboard UI — a plain web page is fine.

## Suggested (not required) folder layout

```
src/
  orchestrator/   # coordinates the checker agents, aggregates results
  agents/         # one module per check category, or however you split it
  dashboard/      # the review UI
```

These three folders exist as placeholders — delete, rename, or restructure
freely.

## At demo time

Organizers will stop the `site-under-test` container and start a different
one (unseen content, unseen linguistic asset, same shape). Your
`qa-platform` container should not need code changes — just re-point
`SITE_URL` / `LINGUISTIC_ASSET_PATH` and re-run.
