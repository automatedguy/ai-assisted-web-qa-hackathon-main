# QA Platform

TypeScript / Express audit platform with a coordinator, OpenAI Spelling & Grammar, Locale,
Formatting, Brand Voice, Terminology, Translation Quality and Media agents, and a
Links agent with deterministic and semantic checks. All eight categories are implemented: spelling/grammar,
links, formatting, locale rules, brand voice, terminology, translation quality, and media.
Findings also receive best-effort annotated screenshots: Playwright renders each
affected page, replays recorded interactions at the captured viewport, and red markers
identify the matching selector/XPath or closest text block.

## Run locally

From `platform-template/`, run `npm install` and `npm run dev`, then open
http://localhost:3000. The development script loads the repository-root `.env`.
The practice site must be running at `SITE_URL` (default http://localhost:8080).

- **Run audit** loads the YAML profile, crawls the site, and dispatches workers.
  Page text, mapped reference Markdown, image bytes, alt text, caption text and
  relevant profile values are sent to OpenAI; API charges apply. The configured
  model must support image inputs for visual checks.
- **Crawl and check links only** runs the existing deterministic check without
  model requests.
- **Clear results** removes the current audit, crawled pages, findings, and review
  decisions from the server and dashboard. Results stay cleared after a refresh.
  Clearing is disabled during checks and review updates; `DELETE /api/results`
  also rejects requests while an audit or crawl is running.
- Review findings by category and mark them verified, dismissed, or escalated.
  Review actions become available after the audit finishes.
- Findings with visual evidence show the annotated screenshot inline; use **Open
  full screenshot** for the original-size capture. Screenshots are kept in the
  server's temporary evidence directory for the current process.
- Finding cards separate severity, category, review status, evidence, and corrections.
  Long evidence expands with **Show more**; **Details** contains confidence and element
  location. Page links open in a new tab. Reviews update the existing card, preserving
  its position and expanded content; save failures appear inline without changing status.
- A compact activity bar shows progress and findings. Failed, skipped, and unrun
  checks remain visible even when the activity panel is closed.
- **View activity** opens a side panel with a fixed run summary, an attention
  section, and eight expandable agent cards. Each card shows scope, page results,
  progress, findings and limitations. It fills the screen on mobile. Close it with
  the Close button or Escape; keyboard focus returns to View activity.
- **Why this was flagged** presents evidence, explanation, expected result and
  suggested fix. New findings record whether the check was deterministic, model
  text review or visual observation; policy findings also preserve the cited rule.
  New worker reports retain configured policy rules and start/finish timestamps.
  Older runs remain readable, but missing metadata is not reconstructed.
- Each agent's **Diagnostics** contains timing, attempts, model, token/cost totals
  and media checks. **View findings** closes the panel and focuses that category.
  Disclosures stay open across updates, and the panel does not auto-scroll.
- **Timeline** filters by agent and attention, with an explicit **Jump to latest**
  button. **Check coverage** reports actual execution; **Run usage** shows totals.
- Activity descriptions come from the existing audit polling, with no additional
  model calls. The last 60 observed updates are kept in the current browser tab;
  timestamps indicate when an update was observed. Refreshing rebuilds the view
  from the latest server snapshot, so this is not a durable event history and
  brief transitions between polls may not appear. Clear results resets the view.

`npm run typecheck` checks TypeScript. `npm test` runs integration checks with
an isolated local website and simulated OpenAI API; it does not load `.env`
or contact OpenAI. `npm run test:activity-ui` exercises the panel in Playwright on
desktop and mobile using mocked API data, including polling stability, evidence,
filters, keyboard focus and reset. Install a Playwright Chromium browser first,
or set `QA_BROWSER_PATH` to a local Chrome executable. It prints the directory of
its temporary screenshots and does not touch a running audit.
`docker compose up --build` from the repository root starts
both services; free ports 8080 and 3000 first if already running separately.

## Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server-side credential; keep it in ignored `.env` |
| `OPENAI_MODEL` | Model supporting Responses structured outputs |
| `SITE_URL` | Site to crawl |
| `LINGUISTIC_ASSET_PATH` | YAML profile; defaults to the supplied local practice profile |
| `ISSUE_SCHEMA_PATH` | Issue JSON Schema; defaults to `docs/ISSUE_SCHEMA.json` locally |
| `REFERENCE_CONTENT_PATH` | Reference directory; defaults to `/data/reference-content` when mounted, otherwise the repository's `reference-content/` |
| `OPENAI_INPUT_USD_PER_MILLION` | Optional input token rate for the configured model |
| `OPENAI_OUTPUT_USD_PER_MILLION` | Optional output token rate for the configured model |

Set both rates to enable USD estimates. These use reported token counts at the
configured rates, without cached-token discounts; they are not billing totals.
Cost remains unavailable when rates or request usage are unknown. Docker
Compose supplies mounted profile/schema paths and passes the rates through.
Compose sets `REFERENCE_CONTENT_PATH=/data/reference-content` and mounts that
directory read-only for Translation Quality checks.

## Architecture

`POST /api/audits` starts a background run (202); concurrent run requests get
409. `GET /api/audits/latest` exposes the current run for dashboard polling.
The coordinator in `src/orchestrator/audit.ts` loads configuration, crawls once,
and schedules at most two workers concurrently. Agent modules implement the
shared contract in `src/agents/types.ts`; adding a module to the registry
exposes its declared categories and dispatch scope. Each finding must belong
to one of the worker's declared categories. Worker API reports now contain
`categories: string[]` instead of the previous singular `category` field.

- Links: checks fetched same-origin destinations for HTTP errors and missing
  fragments, then reviews anchor promises against actual destination content in
  batches of twelve, capped at 120 candidates per page with explicit incomplete
  coverage beyond that limit. Both anchor and destination quotes are validated. The
  model-free **Crawl and check links only** action does not perform semantic review.
- Spelling & Grammar: one request per successful HTML page, using the YAML target locale
  and glossary. Structured findings must contain exact evidence from that page.
- Locale: one model request per successful HTML page for target-language copy and
  applicable currency, measurement, address or phone policies. It reports only
  `locale_rules`. Available mapped source prices inform corrections; without source
  authority the agent must not assume exchange-rate parity or replace actual prices
  with profile examples.
- Formatting: deterministic numeric-date checking plus one model request per
  successful HTML page with applicable date, number, currency-presentation or
  capitalization rules. It reports only `formatting`.
- Brand Voice: one model request per successful HTML page with tone, style and
  brand-only forbidden-term policies. It reports only `brand_voice`.
- Terminology: one model request per successful HTML page with banned terms,
  protected names and preferred glossary equivalents. It reports only
  `terminology`; shared forbidden terms belong here.
- Translation Quality: one model request per successfully mapped page, comparing
  reference Markdown with target text. Both evidence quotes must match their
  respective inputs exactly before the finding is accepted.
- Media: deterministic metadata/resource checks followed by at most one model
  request per page for alt text, caption language, image descriptions and visible
  image text. Image-only pages are included. Per-resource checks appear in the
  Media card's **Diagnostics** and JSON completion logs.
- All accepted issues are validated against the supplied issue schema and
  deduplicated by stable ID. Matching findings retain their previous review
  status within the current server session.
- Transient model errors get one retry; each attempt has a 60-second timeout.
  Worker failures remain visible and do not cancel other workers.
- Worker completion events are also written as JSON to server logs.

## Locale and formatting rules

Rules are read from the YAML profile on each audit. Missing optional rules
do not acquire defaults from `target_locale`. Locale always checks the explicit
target language; Formatting skips when its optional policies are absent.

| Profile field | Check/category |
|---|---|
| `locale.target_locale` | Wrong-language interface copy and accessible names (`locale_rules`) |
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
the worker is marked failed. Model retry/usage reporting is shared with Spelling & Grammar.

The crawler inserts spaces at block boundaries and line breaks while retaining
inline word fragments, preventing synthetic errors such as joined table cells
or definition-list entries. Extracted text is still normalized, not a browser
layout: whitespace/layout and raw HTML markup validation are not implemented.

## Browser-state checks and catalog regression

Before dispatch, `src/crawler/rendered.ts` captures desktop (1440px) and mobile
(390px) states with Playwright. It discovers radio filters, select options, search
fields, details disclosures and mobile navigation controls; it does not import
practice-site selectors or strings. Each action starts from a fresh page state.
Captured text and accessible attributes feed the existing Spelling & Grammar and
Locale agents in bounded batches (up to eight per agent/page, 16,000 characters
per batch). These reviews and semantic links add model calls and API cost.
Formatting checks visible dates deterministically, using ISO `datetime` metadata
to disambiguate swapped day/month values without treating metadata itself as copy.

Exploration uses fresh unauthenticated contexts, blocks non-GET/cross-origin
requests and video downloads, and never intentionally submits forms or activates
arbitrary action buttons. Discovery is limited to independent single actions, not
all combinations or authenticated workflows. The defaults are 16 states per
viewport and a 60-second exploration budget per page; `QA_MAX_STATES_PER_VIEWPORT`
can set a limit from 1 to 40. Browser failures/budget limits make coverage partial.
`QA_DISABLE_BROWSER_CHECKS=1` explicitly skips this stage; the dashboard reports it.
Use `QA_BROWSER_PATH` for a local Chrome executable or install Playwright Chromium.

`browserCoverage` reports state counts and limitations. Findings can retain
`reproduction` with viewport, ordered steps, observed attribute and actual resource
URL. Both finding Details and activity explanations expose this information.
Screenshots replay the state and refuse to attach the wrong responsive image.
Repeated text at distinct elements gets distinct identities. Reconciliation removes
overlapping voice findings and gives currency-identity corrections precedence over
conflicting notation-only fixes at the same element; independent locations remain.
For simple table prices, an unambiguous matching source row and required currency
also enable deterministic correction of the notation while preserving the exact
source amount. Ambiguous rows, grouped amounts and absent source authority are not
automatically repaired. This never uses a profile example as an actual price.

Validation commands (run inside `platform-template/`):

- `npm test`: offline unit/integration checks with simulated model responses;
  browser exploration and screenshots are disabled here.
- `npm run test:catalog-browser`: an isolated practice-site server, real browser
  interactions, generated-copy observations, all three mobile-menu occurrences,
  all four sorted dates, responsive resource selection and screenshot replay.
  No `.env` or model calls. This verifies discovery and deterministic checks, not
  live model accuracy.
- `QA_ALLOW_LIVE_AUDIT=1 npm run test:catalog-live`: explicitly authorized paid
  audit using `.env`; writes audit JSON and a 25-case comparison to a temporary
  directory without replacing the dashboard's current run. Success requires all
  25 case matches, three mobile-menu pages and four date elements. Inspect the
  report and corrections manually: evidence matching alone is not certification
  of accuracy, severity or absence of false positives.

Catalog expectations live only in `test/catalog-cases.ts`. Keep unseen-profile and
valid-counterexample tests alongside the practice benchmark.

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

## Translation quality and references

Map target pages to source Markdown in the YAML profile:

```yaml
locale:
  source_locale: en-GB
  target_locale: fr-FR
reference_content:
  - page: /index.html
    source_text_path: reference-content/home.en.md
  - page: /pricing.html
    source_text_path: pricing.en.md
```

Both source path forms above resolve inside `REFERENCE_CONTENT_PATH`. Absolute
paths are also accepted if they are inside that directory. Nested directories
and `.md`/`.markdown` files are supported. Traversal and symlinks escaping the
reference directory are rejected. Reference files are only read, never modified.

Page mappings resolve against `SITE_URL`; `/index.html` and `/` (also nested index
pages) match the crawler's normalization when there is no query string. Fragments
are ignored, while origins and query strings must match. Multiple mappings to the
same normalized page fail visibly instead of selecting an arbitrary source.
An unmapped page skips Translation Quality without calling the model. A mapped
file that is missing, unreadable, empty, invalid or oversized fails that worker,
leaving sibling checks running. Source and target texts each have a 24,000-character
limit; neither is silently truncated. Source locale is optional and is inferred
by the model from the source text when absent, without assuming English.

The agent checks mistranslations, missing meaning, unsupported factual additions
and substantive meaning drift. It is instructed to respect paraphrases, reordered
content, equivalent unit conversions and editorial labels in the reference, and
to leave grammar, tone, glossary, formatting and media issues to their owners.

Findings display separate source and target quotes in the existing `evidence`
field, keeping the supplied issue schema unchanged. For omissions, the target
quote is explicitly labeled as an insertion anchor; missing words are never
fabricated as target evidence. For additions, the source quote is labeled as
context. Exact quotes establish provenance, not semantic correctness: whether a
meaning is absent or changed still depends on model judgment and human review.
Descriptions and explanatory prose are requested in English, with corrections
quoted in the target language. Matching quote pairs retain review status across
runs in the current server session.

## Media checks

The crawler retains image alt attributes, nearby context, explicit decorative
roles, ordinary `src`/`srcset` and `<picture>` alternatives; video sources, posters
and associated tracks retain element XPath locations. The Media agent checks:

- Missing image alt attributes (without treating a deliberately empty decorative
  alt as automatically wrong), missing source URLs, HTTP errors, and empty/HTML
  responses in place of media.
- Video source availability using a bounded range GET. This establishes resource
  availability, not successful playback, codec support, audio or frame contents.
- Caption/subtitle language declarations against the target language. Correctly
  labeled alternate-language tracks are allowed alongside the target option.
- Fetched WebVTT headers, readable cues and basic timing validity, followed by
  model comparison of actual cue language with the declared language. Caption
  necessity for videos without tracks is undetermined because audio is not inspected.
- Alt language, clearly misleading image descriptions, informative images with
  inappropriate empty alt, and legible image text inconsistent with the target
  locale or supplied context. PNG, JPEG and WebP bytes are actually attached to
  the model request; image content is never inferred solely from filenames.

Alt and caption findings require exact evidence from the corresponding asset's
text. Visual descriptions and transcriptions cannot be deterministically checked
against pixels and are explicitly labeled **Visual observation (model; review
required)**. Findings name the asset URL and element XPath. Model failures retain
independent metadata/resource findings and leave the worker failed.

Media finding IDs (`media-v2-*`) use the page, element, resource and check type,
plus a fingerprint of the inspected content and relevant policy/context. They do
not depend on generated explanations, visual transcriptions, corrections,
confidence, severity or response order. Rewording the same finding therefore
preserves its verified/dismissed/escalated status on the next audit. Replaced
image bytes at the same URL, changed captions/alt text or relevant policy/context
changes require a fresh review. Visual checks conservatively include supplied
page text in the fingerprint; selector changes also create a new identity.

Each media check on an asset/content version is one review unit. Multiple model
observations for that unit are retained together, using the highest severity and
lowest confidence; different checks, elements and responsive assets remain
separate. Alt-language findings share the img element's single alt attribute
across responsive sources. The check type is exposed as `assessment.check`.

Older media IDs have no content fingerprint and are not automatically matched to
the new IDs: the first run after this change needs fresh media review decisions.
This change addresses media identity; text checks still depend on exact evidence
quotes, so changes in quote boundaries can produce new IDs. Review persistence
remains in-memory and does not survive a server restart.

Media fetches are restricted to the page's HTTP(S) origin, including redirects,
with a 10-second timeout and three redirects. Bounds per page are 40 resource
checks, eight image inputs and 16 MiB of attached image bytes. Each image is
limited to 4 MiB, each track to 256 KiB and 24,000 extracted characters, and
combined model metadata/caption input to 48,000 characters. Video responses are
read up to 4 KiB. Repeated URLs share fetched bytes within a page worker.

External/inline media, unsupported image formats (including SVG/GIF), limit hits
and uncertain fetch failures appear as skipped/failed checks and make the worker
and audit incomplete; they are not silently counted as inspected. CSS backgrounds,
JavaScript-loaded media, iframe embeds, full image decoding, video playback,
audio transcription and caption synchronization remain outside this implementation.
These are implementation limits, not hardcoded practice-profile rules.

Image requests follow the [OpenAI image-input format](https://developers.openai.com/api/docs/guides/images-vision).
The basic cue extractor follows [WebVTT](https://www.w3.org/TR/webvtt1/); it is not
a full rendering or conformance validator.

## Current limits and next milestones

Audit results and review decisions are in memory; restarting clears them.
Only the latest run is retained. Durable history and review audit trails are
still pending. Overall runs are labeled **partial** while any category is
unimplemented, a worker fails, or crawl/browser coverage is incomplete. **Completed** means
the run finished without those failures; inspect worker skips and media limitations
to understand what was actually checked. Findings themselves do not make a run partial.

Next milestones are durable run/review history, Docker validation and an unseen-input
rehearsal. External links and dedicated destination-language checks remain pending.
Page agents skip non-success responses,
and pages over 24,000 characters fail their model step visibly until chunking
is added. Contextual locale/formatting checks depend on model judgment and need
human review; tests with a simulated API verify routing/validation, not live
model accuracy. The crawler caps visits at 50. Inputs must generalize to
unseen sites and profiles; profile-specific strings must never be hardcoded.
