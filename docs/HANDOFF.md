# Project Handoff

Updated: 2026-10-13. Implementation baseline: `fbd97f9` on `main`, pushed to
https://github.com/automatedguy/ai-assisted-web-qa-hackathon-main.
Check Git status and recent commits before continuing; this is a point-in-time snapshot.

## Objective and Constraints

Build a **multi-agent web QA platform** for the hackathon. Given a website URL,
a YAML linguistic profile, and reference content, it must audit eight categories,
produce evidence-backed issues, support human review, and show execution monitoring.
The demo replaces the practice site and profile with unseen inputs, without code changes.

- Use TypeScript. Keep the platform interface and explanations in English;
  preserve source evidence and corrections in their original/target language.
- Read profile values dynamically. Never hardcode Nimbus, Spanish, or practice URLs.
- Keep credentials in ignored `.env`; never put keys in source, logs, or browser code.
- Preserve `AGENTS.md`: the user requested that an existing file not be overwritten.
  Its scaffold descriptions are stale; the implementation and platform README now
  include TypeScript, active Compose services, and tests.
- The root README contains the actual check catalog and evaluation criteria.
  Its referenced `docs/CHECK_CATALOG.md` is absent.

## Current Implementation

This is the first architecture milestone, **not the completed multi-agent system**.
There is one model-backed Language agent and one deterministic Links worker under
a shared coordinator. Six categories remain unimplemented.

| Component | Location and behavior |
|---|---|
| Server | `platform-template/src/server.ts`: Express API and static dashboard |
| Crawler | `src/crawler/crawl.ts`: same-origin HTML extraction, up to 50 visits; normalizes `/index.html` to `/` |
| Configuration | `src/config.ts`: loads YAML on each audit, validates required target locale, preserves additional profile fields |
| Coordinator | `src/orchestrator/audit.ts`: agent registry, site/page dispatch, concurrency of two, isolated failures, issue validation and deduplication |
| Worker contract | `src/agents/types.ts`: agent inputs, scope, category, execution report |
| Language | `src/agents/language.ts`: Responses structured outputs for `spelling_grammar`; exact source-evidence validation |
| Links | `src/agents/links.ts`: reports fetched same-origin destinations returning HTTP errors |
| Issue contract | `docs/ISSUE_SCHEMA.json`, with TypeScript types in `src/issues.ts` |
| Dashboard | `src/dashboard/public/`: audit progress, worker table, category filtering, review actions |

Paths beginning with `src/` above are relative to `platform-template/`.

`POST /api/audits` returns 202 and starts a background audit. The dashboard polls
`GET /api/audits/latest`; concurrent audit/crawl requests get 409.
`POST /api/crawl` remains a model-free crawl/link-check operation.
`GET /api/issues` and `PATCH /api/issues/:id/status` support review.

The Language agent uses the profile's target locale and glossary, one request per
successful HTML page. It has a 60-second request timeout and one retry for transient
failures. Every accepted audit finding passes JSON Schema validation. Evidence must
be a nonempty exact substring of the page text. Workers report attempts, duration,
findings, model, and token usage; completion events are logged as JSON.

## Run and Configure

The local setup previously used Colima and a standalone Docker container for the
practice site at http://localhost:8080, plus `npm run dev` at http://localhost:3000.
Confirm processes and ports before starting duplicates.

From `platform-template/`:

```bash
npm install
npm run dev
```

The development command loads `../.env`. Required API configuration is
`OPENAI_API_KEY`; `OPENAI_MODEL` selects the model (current default: `gpt-6-astra`).
Use a model supporting Responses structured outputs.

`SITE_URL`, `LINGUISTIC_ASSET_PATH`, and `ISSUE_SCHEMA_PATH` override local defaults.
See `.env.example`. Optional `OPENAI_INPUT_USD_PER_MILLION` and
`OPENAI_OUTPUT_USD_PER_MILLION` enable approximate cost reporting for that model;
unknown rates/usage are displayed as unavailable, not zero.

Alternatively, run `docker compose up --build` from the repository root. Compose
starts both services and mounts profiles, reference content, and the issue schema.
The Compose plugin was unavailable earlier on this machine; this updated Compose
setup has not been exercised end to end.

Click **Run audit** to use the model; this sends page text to OpenAI and incurs API
usage. **Crawl and check links only** does not call the model. Signing into another
ChatGPT account does not change the application's `.env` API credential.

## Validation Already Performed

- `npm run typecheck` passed; dashboard JavaScript syntax and Git whitespace checks passed.
- `node --import tsx --test test/audit.test.ts` passed all six scenarios (seven TAP
  entries including the parent): changed locale/profile, stable review status,
  rejected fabricated evidence, clean output, transient retry, missing API key,
  and invalid profile handling are covered across those scenarios.
- Integration tests use a local fake website and fake OpenAI endpoint, not `.env`
  or paid API requests. Run them with `npm test` from `platform-template/`.
- The refreshed browser showed the new dashboard controls successfully.
- Earlier user checks confirmed API connectivity and the practice site's broken
  pricing link. The new Language agent's live accuracy has **not** been evaluated.

## Known Limitations

- Runs and review state are in memory; only the latest run is retained. No durable
  audit trail exists. Matching findings preserve statuses only within that session.
- Audits deliberately show `partial` while categories are missing, workers fail,
  or crawl coverage is incomplete.
- Links does not yet assess external links, wrong-locale destinations, or anchor meaning.
- Language fails visibly above 24,000 characters per page; chunking is pending.
- Media metadata is extracted, but image/video/caption auditing is not implemented.
- Reference Markdown is supplied/mounted but not yet consumed by a Translation agent.

## Next Task: Locale and Formatting

1. Implement profile-driven `locale_rules` and `formatting` checks, using relevant
   locale fields for dates, numbers, currencies, units, and other applicable rules.
2. Adapt the agent contract and coordinator deliberately: each registered agent
   currently declares a **single category**, and validation enforces that category.
   Either support multiple declared categories or register separate workers sharing
   implementation. Update coverage reporting and tests accordingly.
3. Keep reliable deterministic checks as tools; use specialized model reasoning
   where context is needed. Preserve exact evidence and avoid duplicate findings
   between the two categories. Missing optional rules must not imply hardcoded defaults.
4. Exercise a different profile and clean/error fixtures, then check the practice
   site and inspect findings for false positives.

Following milestones: Brand/Terminology, Translation, Links/Media expansion,
durable runs and review history, and a full unseen-input demo rehearsal.

## Git and Session Continuity

Remote `origin` points to the repository above; `main` tracks `origin/main`.
GitHub authentication uses `automatedguy`. Commit and push when the user requests it.
The previous session approved Git add/commit/push and dependency installation;
a new session must check its own permissions instead of assuming those grants transfer.

An initial HTTPS upload failed with HTTP 400. A one-off retry succeeded with:

```bash
git -c http.version=HTTP/1.1 -c http.postBuffer=8388608 push -u origin main
```

The subsequent ordinary `git push origin main` succeeded. Do not change global Git
settings preemptively. On a different computer, clone the repo and configure `.env`
locally; the key is intentionally absent from GitHub.
