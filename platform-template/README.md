# QA Platform

TypeScript / Express audit platform with a coordinator, an OpenAI Language
agent, and a deterministic Links worker. This is the first architecture
milestone: two categories are available, with six still to implement.

## Run locally

From `platform-template/`, run `npm install` and `npm run dev`, then open
http://localhost:3000. The development script loads the repository-root `.env`.
The practice site must be running at `SITE_URL` (default http://localhost:8080).

- **Run audit** loads the YAML profile, crawls the site, and dispatches workers.
  Page text and relevant profile values are sent to OpenAI; API charges apply.
- **Crawl and check links only** runs the existing deterministic check without
  model requests.
- Review findings by category and mark them verified, dismissed, or escalated.
  Review actions become available after the audit finishes.
- The progress table shows worker status, model, attempts, duration, findings,
  and reported input/output token counts.

`npm run typecheck` checks TypeScript. `npm test` runs integration checks with
an isolated local website and simulated OpenAI API; it does not load `.env`
or contact OpenAI. `docker compose up --build` from the repository root starts
both services; free ports 8080 and 3000 first if already running separately.

## Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server-side credential; keep it in ignored `.env` |
| `OPENAI_MODEL` | Model supporting Responses structured outputs |
| `SITE_URL` | Site to crawl |
| `LINGUISTIC_ASSET_PATH` | YAML profile; defaults to the supplied local practice profile |
| `ISSUE_SCHEMA_PATH` | Issue JSON Schema; defaults to `docs/ISSUE_SCHEMA.json` locally |
| `OPENAI_INPUT_USD_PER_MILLION` | Optional input token rate for the configured model |
| `OPENAI_OUTPUT_USD_PER_MILLION` | Optional output token rate for the configured model |

Set both rates to enable USD estimates. These use reported token counts at the
configured rates, without cached-token discounts; they are not billing totals.
Cost remains unavailable when rates or request usage are unknown. Docker
Compose supplies mounted profile/schema paths and passes the rates through.
Reference files remain mounted at `/data/reference-content` for the future
Translation agent.

## Architecture

`POST /api/audits` starts a background run (202); concurrent run requests get
409. `GET /api/audits/latest` exposes the current run for dashboard polling.
The coordinator in `src/orchestrator/audit.ts` loads configuration, crawls once,
and schedules at most two workers concurrently. Agent modules implement the
shared contract in `src/agents/types.ts`; adding a module to the registry
exposes its category and dispatch scope.

- Links: checks fetched same-origin destinations for HTTP errors.
- Language: one request per successful HTML page, using the YAML target locale
  and glossary. Structured findings must contain exact evidence from that page.
- All accepted issues are validated against the supplied issue schema and
  deduplicated by stable ID. Matching findings retain their previous review
  status within the current server session.
- Transient model errors get one retry; each attempt has a 60-second timeout.
  Worker failures remain visible and do not cancel other workers.
- Worker completion events are also written as JSON to server logs.

## Current limits and next milestones

Audit results and review decisions are in memory; restarting clears them.
Only the latest run is retained. Durable history and review audit trails are
still pending. Overall runs are labeled **partial** while any category is
unimplemented, a worker fails, or crawl coverage is incomplete.

Locale/Formatting, Brand/Terminology, Translation, and Media agents remain to
implement. Links currently covers fetched same-origin HTTP errors only;
wrong-locale links and anchor/destination meaning are pending. Language skips
non-success responses, and pages over 24,000 characters fail visibly until
chunking is added. The crawler caps visits at 50. Inputs must generalize to
unseen sites and profiles; profile-specific strings must never be hardcoded.
