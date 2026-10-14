# Project Handoff

Updated: 2026-10-14. Implementation: Locale/Formatting milestone on `main`.
Use Git history to identify the current commit and publication status.
Remote: https://github.com/automatedguy/ai-assisted-web-qa-hackathon-main.
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

Four of eight categories are implemented under a shared coordinator: Language,
Links, Formatting, and Locale Rules. Language and Locale/Formatting use specialized
model instructions; Links and numeric-date checking are deterministic. Brand Voice,
Terminology, Translation Quality, and Media remain unimplemented.

| Component | Location and behavior |
|---|---|
| Server | `platform-template/src/server.ts`: Express API and static dashboard |
| Crawler | `src/crawler/crawl.ts`: same-origin HTML extraction with block boundaries, up to 50 visits; normalizes `/index.html` to `/` |
| Configuration | `src/config.ts`: loads YAML on each audit, validates required target locale, preserves additional profile fields |
| Coordinator | `src/orchestrator/audit.ts`: agent registry, site/page dispatch, concurrency of two, isolated failures, issue validation and deduplication |
| Worker contract | `src/agents/types.ts`: agent inputs, scope, declared categories, execution report, partial-failure findings |
| Language | `src/agents/language.ts`: Responses structured outputs for `spelling_grammar`; exact source-evidence validation |
| Locale/Formatting | `src/agents/locale-formatting.ts`: profile-driven policies, contextual model checks and overlap suppression; `date-format.ts`: deterministic numeric dates |
| Shared model client | `src/agents/model-check.ts`: structured outputs, retries, exact evidence, token/cost tracking |
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
be a nonempty exact substring of the page text. Workers now declare/report `categories: string[]` rather than a singular category.
Workers report attempts, duration,
findings, model, and token usage; completion events are logged as JSON.

Locale/Formatting makes one additional model request per successful page with
applicable explicit rules. Missing optional policies are not inferred from the
target locale; the worker skips when no relevant policies exist. It checks date,
number and currency notation, physical units, currency identity, and configured
address/phone/capitalization rules. See the platform README for supported fields.
Numeric date findings survive a failed model step while the worker remains failed.
Wrong currencies/units take precedence over duplicate formatting findings for the
same expression. No exchange rates or replacement prices are invented.

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

- `npm run typecheck`, dashboard JavaScript syntax, and Git whitespace checks passed.
- `npm test` passed all 17 TAP entries, including the two parent groups. Tests use
  local mock website/API servers without loading `.env` or contacting OpenAI.
- Coverage includes alternate Japanese, US, French and German profiles; numeric
  date ambiguity and calendar validity; currency/unit category separation;
  explicit number/address/phone/capitalization rules; skipped optional policies;
  exact evidence and configured-rule validation; retry/usage tracking; retained
  deterministic findings on model failure; review status preservation; and block
  text extraction without artificial word concatenation.
- A live practice-site audit completed on 2026-10-14 in about 18.4 seconds. All
  seven workers completed. Seven findings were reviewed: one broken link, one
  grammar error, one date-format error, one nonmetric weight, and three wrong
  currency prices. No additional locale/formatting false positives were observed
  in this smoke test. This is not a full accuracy benchmark.
- The earlier “Milesde” finding was a crawler artifact from adjacent `dt`/`dd`
  elements. Block-boundary spacing now prevents it, with regression coverage.
- The running development server picked up the changes; refresh the dashboard
  to see four available categories and the latest results. The overall audit
  remains `partial` because four categories are unimplemented.
- Docker Compose end-to-end validation remains pending.

## Known Limitations

- Runs and review state are in memory; only the latest run is retained. No durable
  audit trail exists. Matching findings preserve statuses only within that session.
- Audits deliberately show `partial` while categories are missing, workers fail,
  or crawl coverage is incomplete.
- Links does not yet assess external links, wrong-locale destinations, or anchor meaning.
- Model-based page checks fail visibly above 24,000 characters; chunking is pending.
- Contextual locale checks depend on model judgment; numeric-date recognition is
  heuristic. Raw HTML markup, rendered layout and whitespace checks remain pending.
- A subsequent live run returned some currency explanations/instructions in Spanish.
  Enforcing English explanations while retaining target-language replacement text
  needs refinement.
- Locale/Formatting supports the explicit fields documented in the platform README;
  unknown locale keys are preserved but do not automatically become checks.
- Media metadata is extracted, but image/video/caption auditing is not implemented.
- Reference Markdown is supplied/mounted but not yet consumed by a Translation agent.

## Next Task: Brand and Terminology

1. Implement checks driven by `brand_voice` and `glossary`, preserving original
   evidence and target-language corrections with English explanations.
2. Reuse the multi-category agent contract and shared model client where useful;
   avoid duplicate issues for terms listed in multiple profile sections.
3. Exercise alternate profiles and clean/error fixtures, then review live findings.

Following milestones: Translation, Links/Media expansion, durable runs and review
history, and a full unseen-input demo rehearsal.

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
