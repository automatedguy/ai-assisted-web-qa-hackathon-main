# QA Platform

TypeScript / Express audit platform with a coordinator, OpenAI Language,
Locale/Formatting and Brand/Terminology agents, and a deterministic Links worker.
Six categories are available: spelling/grammar, links, formatting, locale rules,
brand voice, and terminology.

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
- The progress table shows worker categories, status, model, attempts, duration, findings,
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
exposes its declared categories and dispatch scope. Each finding must belong
to one of the worker's declared categories. Worker API reports now contain
`categories: string[]` instead of the previous singular `category` field.

- Links: checks fetched same-origin destinations for HTTP errors.
- Language: one request per successful HTML page, using the YAML target locale
  and glossary. Structured findings must contain exact evidence from that page.
- Locale/Formatting: deterministic numeric-date checking followed by one model
  request per successful HTML page with explicit applicable rules. The model
  interprets natural-language policies and context; every finding cites a
  configured rule and exact page-text evidence. The two categories share one
  worker and request to avoid duplicate currency/unit findings and token usage.
- Brand/Terminology: one model request per successful HTML page with supported
  brand or glossary policies. Tone/style and terminology findings are categorized
  separately, with glossary ownership of shared forbidden terms.
- All accepted issues are validated against the supplied issue schema and
  deduplicated by stable ID. Matching findings retain their previous review
  status within the current server session.
- Transient model errors get one retry; each attempt has a 60-second timeout.
  Worker failures remain visible and do not cancel other workers.
- Worker completion events are also written as JSON to server logs.

## Locale and formatting rules

Rules are read from the YAML profile on each audit. Missing optional rules
do not acquire defaults from `target_locale`; with no applicable rules the
worker is visibly skipped and makes no API request.

| Profile field | Check/category |
|---|---|
| `locale.date_format` | Date notation (`formatting`) |
| `locale.number_format` | Explicit number separators/notation (`formatting`) |
| `locale.currency_format` | Currency notation (`formatting`) and required currency identity (`locale_rules`) when specified |
| `locale.currency` | Explicit required currency identity, taking precedence over identity in `currency_format` |
| `locale.measurement_units` | Physical units/system (`locale_rules`) |
| `locale.address_format`, `locale.phone_format` | Explicit address/phone conventions (`locale_rules`) |
| `locale.capitalization`, `locale.capitalization_rules` | Explicit capitalization policies (`formatting`) |
| `formatting` | Additional text-formatting policies as a string, list, or object (`formatting`) |

The date tool supports `DD/MM/YYYY`, `MM/DD/YYYY`, and `YYYY/MM/DD`, with
`/`, `-`, or `.` separators, checks calendar validity, and preserves ambiguous
month/day meanings rather than guessing. Other date patterns are assessed by
the model. Wrong currency identity takes precedence over notation for the
same expression; prices are not automatically converted or relabeled. A
currency-specific decimal rule does not create a general number policy.
Model findings cannot override numeric dates already assessed by the tool.
If the model step fails, valid deterministic date findings remain visible and
the worker is marked failed. Model retry/usage reporting is shared with Language.

The crawler inserts spaces at block boundaries and line breaks while retaining
inline word fragments, preventing synthetic errors such as joined table cells
or definition-list entries. Extracted text is still normalized, not a browser
layout: whitespace/layout and raw HTML markup validation are not implemented.

## Brand voice and terminology rules

`brand-terminology.ts` reads these optional fields on each audit:

| Profile field | Check/category |
|---|---|
| `brand_voice.tone` | Tone described by a string (`brand_voice`) |
| `brand_voice.style_rules` | List of editorial rules (`brand_voice`) |
| `brand_voice.forbidden_terms` | List of prohibited brand terms (`brand_voice`) |
| `glossary.banned_terms` | List of prohibited terms (`terminology`) |
| `glossary.do_not_translate` | List of protected names (`terminology`) |
| `glossary.preferred_terms` | Mapping of source concepts to approved target-language terms (`terminology`) |

List entries must be nonempty strings; preferred-term keys and values must be
nonempty strings. Unknown fields are preserved by configuration loading but do
not become checks. With no supported nonempty rules, the worker skips without
an API request. Either section can be used on its own.

Terms present in both forbidden lists are assigned to the glossary rule, using
case-insensitive Unicode normalization for that comparison. The model is told
not to report lexical violations again as tone/style. Duplicate findings with
the same category and exact evidence receive one stable ID; matching findings
retain their review status on subsequent runs in the same server session.

The model checks terms in context, including translated protected names and
incorrect equivalents of glossary concepts. It is instructed to respect clean
content, quotations, exceptions, and absent glossary concepts, and to avoid
incidental substring matches or invented requirements. Each finding must cite
a configured rule and exact page evidence. Descriptions and explanatory prose
are requested in English; evidence and quoted corrections retain their original
or target language. Contextual accuracy and language compliance still require
human review; mock API tests validate the workflow, not model judgment.

## Current limits and next milestones

Audit results and review decisions are in memory; restarting clears them.
Only the latest run is retained. Durable history and review audit trails are
still pending. Overall runs are labeled **partial** while any category is
unimplemented, a worker fails, or crawl coverage is incomplete.

Translation and Media agents remain to implement. Links
currently covers fetched same-origin HTTP errors only; wrong-locale links and
anchor/destination meaning are pending. Page agents skip non-success responses,
and pages over 24,000 characters fail their model step visibly until chunking
is added. Contextual locale/formatting checks depend on model judgment and need
human review; tests with a simulated API verify routing/validation, not live
model accuracy. The crawler caps visits at 50. Inputs must generalize to
unseen sites and profiles; profile-specific strings must never be hardcoded.
