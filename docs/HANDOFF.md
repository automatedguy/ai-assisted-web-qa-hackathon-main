# Project Handoff

Updated: 2026-10-20. Implementation: eight specialized agents, activity explanations,
bounded browser-state checks, semantic links and catalog regression tooling.

## Installation validation (2026-10-20)

New-user instructions: [Run on Windows, macOS or Linux](RUNNING.md).
The repository-root launcher provides `npm run setup`, `npm start`,
`npm run start:platform` and `npm run doctor`. Windows PowerShell uses `npm.cmd`.
Setup uses the dependency lockfile, installs Chromium, preserves existing `.env`,
and verifies the browser, input files and writable data directories without model calls.

- A clean macOS ARM64 checkout in a path containing spaces installed successfully
  with Node 22.18.0 and downloaded Playwright Chromium. The real browser launch and
  screenshot diagnostic passed. Repeated setup preserved the existing `.env`.
- Native installation tests passed against both the development and clean dependency
  trees: site/dashboard startup, occupied-port rejection, shutdown, restart, saved
  reviews/HTML exports, and platform-only mode, using isolated data and free ports.
- All 107 offline tests and TypeScript checks passed with the portable test runner.
- The Compose test built Linux ARM64 images, verified both service health checks,
  captured a Chromium screenshot, crawled the practice site, reviewed/exported a
  finding and uploaded/selected a profile. After `down` and container recreation,
  the profile, selection, saved run, review and screenshot were retained in the volume.
  Only the disposable test project's containers/network/volume were removed afterward.
- `.github/workflows/portability.yml` defines Windows/macOS/Linux jobs for Node 22/24
  and a Docker job. Hosted CI results, native Windows and Node 24 verification remain
  pending until that workflow runs; local macOS and Linux-container success do not
  certify those environments. No paid model audit was started for installation testing.

## Catalog implementation validation (2026-10-19)

- TypeScript checks and all 99 offline tests pass, including SQLite restart/recovery, media identity,
  grouped-currency reconciliation and cost-estimation regressions.
- `npm run test:catalog-browser` captured 37 desktop/mobile states across the three
  practice pages and verified generated singular/empty copy, all three mobile-menu
  accessible names, four sorted-date defects, responsive resources and screenshot replay.
- The activity-panel desktop/mobile regression also passes.
- The authorized live test (`eb41d5a6-2c1f-4d2f-99a5-824a4ad916e0`) detected
  25/25 catalog cases in 111 seconds with 32 findings and no worker failures.
- A subsequent dashboard run (`8183342d-8a3c-49a4-a8ee-5174953ea315`) also detected
  25/25 cases in 108 seconds with 33 findings and no worker failures. Both found
  all three mobile-menu occurrences and all four sorted-date defects.
- Case matching is not certification of correction quality or unseen-site accuracy.
  The dashboard run exposed a grouped currency-format duplicate retaining dollar
  symbols, alongside the correct per-plan euro fixes (addressed below). Follow-up
  work: improve screenshot reliability and Business-row highlighting. Subtitle findings have
  textual evidence but no highlighted rendered element. One non-catalog translation
  finding also varied between major and minor severity across these runs.
- Production code does not import the catalog; its examples are test-only.

Media identity follow-up: `media-v2-*` IDs no longer hash model wording. They use
asset/check identity and inspected-content/policy fingerprints. Offline audit tests
verify that reworded evidence and reordered responses preserve review statuses,
while changed content requires review. Multiple observations for the same
asset/check are retained together; different checks remain separate. Legacy media
IDs need one fresh review because they lack content fingerprints. Other agents'
exact-quote identity remains unchanged; durable review persistence was added below. The live
catalog runs above predate this identity change; no additional paid audit was run.

Currency reconciliation follow-up: exact page/element spans and row context now
allow a grouped Formatting finding to be absorbed into its per-plan Locale
findings only when every quoted price is covered unambiguously. IDs, source-backed
corrections and review decisions remain unchanged. Partial or ambiguous coverage
is retained for review. Offline replay of dashboard audit `8183342d` reduced its
33 findings to 32, removing only the conflicting dollar-formatting group while
retaining 25/25 catalog cases, all three menu occurrences and four sorted dates.
This was a replay of saved results, not a new paid audit or a dashboard mutation.
Mock audit tests also verify source-backed corrections and final worker counts
for grouped and individual responses.

Cost follow-up: per-worker/per-agent estimates, a visible run total, editable
per-model rates and a similar-run budget calculator are available in the activity
panel. GPT-6 Astra has a dated official Standard short-context preset; environment
overrides and unknown models are handled explicitly. New runs snapshot rates and
capture cache-read/write counts; incomplete usage is labeled as a subtotal and
missing cache details as approximate. Existing snapshots can be priced without
API calls. Desktop/mobile fixtures verify rate editing, polling stability, reset,
unknown models, zero rates and incomplete-usage warnings. See the platform README
for billing exclusions and the preset's source/date. No paid audit was needed.

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

All eight categories are implemented under a shared coordinator with eight agents:
Spelling & Grammar, Links, Locale, Formatting, Brand Voice, Terminology, Translation Quality and Media.
HTTP/fragment and numeric-date checks are deterministic; Links also uses a model
for destination meaning. Media combines deterministic
resource/metadata checks with model-based caption, alt text and image inspection.

| Component | Location and behavior |
|---|---|
| Server | `platform-template/src/server.ts`: Express API and static dashboard |
| Crawler | `src/crawler/crawl.ts`: same-origin HTML extraction with block boundaries, up to 50 visits; normalizes `/index.html` to `/` |
| Configuration | `src/config.ts`: loads YAML on each audit, validates required target locale, preserves additional profile fields |
| Coordinator | `src/orchestrator/audit.ts`: agent registry, site/page dispatch, concurrency of two, isolated failures, issue validation and deduplication |
| Worker contract | `src/agents/types.ts`: agent inputs, scope, declared categories, execution report, partial-failure findings |
| Spelling & Grammar | `src/agents/spelling-grammar.ts`: Responses structured outputs for `spelling_grammar`; exact source-evidence validation |
| Locale | `src/agents/locale-formatting.ts`: profile-driven currency, unit, address and phone checks |
| Formatting | `src/agents/locale-formatting.ts`: profile-driven presentation checks plus deterministic numeric dates |
| Brand Voice | `src/agents/brand-terminology.ts`: profile-driven tone/style and brand-only forbidden-term checks |
| Terminology | `src/agents/brand-terminology.ts`: glossary checks and shared forbidden-term ownership |
| Translation Quality | `src/agents/translation-quality.ts`: source/target meaning comparison; `reference-content.ts`: mapped Markdown loading within the configured directory |
| Media | `src/agents/media.ts`: resource/metadata and visual/language checks; `media-resources.ts`: bounded fetches, image signatures and basic WebVTT extraction |
| Shared model client | `src/agents/model-check.ts`: structured outputs, retries, exact evidence, token/cost tracking |
| Links | `src/agents/links.ts`: HTTP/fragment checks and validated anchor/destination semantic review |
| Browser evidence | `src/crawler/rendered.ts`: bounded desktop/mobile state capture; `src/agents/rendered-checks.ts`: existing category agents review captured copy and dates |
| Issue contract | `docs/ISSUE_SCHEMA.json`, with TypeScript types in `src/issues.ts` |
| Dashboard | `src/dashboard/public/`: activity panel, category review, saved-run selector, comparisons and cumulative estimates |
| History | `src/run-store.ts`, `src/history.ts`: SQLite snapshots, review events, recovery, comparisons and spending summaries |

Paths beginning with `src/` above are relative to `platform-template/`.

`POST /api/audits` returns 202 and starts a background audit. The dashboard polls
`GET /api/audits/latest`; concurrent audit/crawl requests get 409.
`POST /api/crawl` remains a model-free crawl/link-check operation.
`GET /api/issues` and `PATCH /api/issues/:id/status` support review.
`DELETE /api/results` clears the workspace and future review carry-forward, retaining
saved runs, review events, screenshots and cost history. It rejects active runs.
`GET /api/audits` lists paginated summaries and all-history cost totals;
`GET /api/audits/:id` restores any run. The dashboard reviews via
`PATCH /api/audits/:runId/issues/:id/status`, so historical edits cannot mutate the
latest run. `GET /api/audits/:id/reviews` exposes timestamped changes;
`GET /api/audits/:id/comparison` compares against the previous same-site/check-type
run, or a supplied `baseline` ID. Missing findings are not claimed to be fixed.

History requires Node 22.18+ (`nvm use`; root `.nvmrc`) and uses built-in SQLite,
with no native npm dependency. Default storage is `platform-template/data/`;
`QA_DATA_DIR` overrides it. Screenshots default to that directory's `screenshots/`
subdirectory. Compose adds a persistent `qa-history` volume; end-to-end container
recreation/persistence validation passed on 2026-10-20 (see above). Use one server per data directory. Stop the
server before backing up/copying the whole directory. Never delete the volume to
clear the UI. Node 22 can emit the built-in SQLite experimental warning.

Checkpoints run during phases, worker completion, every second while active and
at completion. Interrupted runs recover as partial without resuming paid requests;
costs warn that requests since the last checkpoint may be missing. Explicit reviews
carry forward by site/stable ID across restarts and intervening absent findings.
The saved snapshots preserve recorded prices; browser calculator overrides never
rewrite cumulative history. Tests use temporary storage and no paid model calls.

The activity panel has a fixed summary, prominent attention section and eight
expandable agent cards with page outcomes, configured policy rules, limitations
and per-agent diagnostics (including media checks). **Why this was flagged** shows
evidence and decision summaries, not private model reasoning. New findings retain
their check method and, for policy findings, the cited rule; new workers retain
rule snapshots and execution timestamps. Older runs display without inventing
missing metadata. **View findings** focuses the selected category outside the panel.
The filterable timeline shows the last 60 updates observed by this browser tab.
These are polling observations, not a persistent server event log; refresh rebuilds
the view from the current snapshot. Skipped/failed checks and unrun categories stay
visible in the main activity bar. No additional model calls are made. Run
`npm run test:activity-ui` in `platform-template/` for mocked desktop/mobile browser checks.

The Spelling & Grammar agent uses the profile's target locale and glossary, one request per
successful HTML page. It has a 60-second request timeout and one retry for transient
failures. Every accepted audit finding passes JSON Schema validation. Text-agent
evidence must be a nonempty exact substring of the page text. Translation findings separately
validate exact source and target quotes before displaying both in `evidence`.
Media validates alt/caption text against the corresponding asset and explicitly
labels model visual observations rather than claiming exact pixel verification.
Workers now declare/report `categories: string[]` rather than a singular category.
Workers report attempts, duration,
findings, model, and token usage; completion events are logged as JSON.

Locale/Formatting makes one additional model request per successful page with
applicable explicit rules. Missing optional policies are not inferred from the
target locale; Formatting skips when no relevant policies exist, while Locale
always checks target-language copy. Captured state batches add interface and
accessible-name reviews to the existing agents. It checks date,
number and currency notation, physical units, currency identity, and configured
address/phone/capitalization rules. See the platform README for supported fields.
Numeric date findings survive a failed model step while the worker remains failed.
Wrong currencies/units take precedence over duplicate formatting findings for the
same expression. No exchange rates or replacement prices are invented.

Brand/Terminology makes one additional request per successful page when supported
`brand_voice` or `glossary` rules are present. Tone, style and brand-only forbidden
terms are Brand Voice findings; protected names, preferred equivalents and glossary
bans are Terminology findings. A term prohibited in both sections belongs to
Terminology. Missing/empty rules cause a visible skip without an API request.
Each accepted finding cites a configured rule and exact page evidence. See the
platform README for supported fields, duplicate handling and model limitations.

Translation Quality compares each mapped reference Markdown with its target page.
It covers mistranslations, omissions, unsupported additions and meaning drift,
while excluding grammar, glossary, formatting and media-only differences. Missing
page mappings skip; missing, empty, ambiguous, unsafe or oversized mapped sources
fail the worker before any translation model call. Source/target evidence is
validated separately. Omissions use clearly labeled target insertion anchors;
additions show source context. Both source and target have a 24,000-character limit.

Media fetches same-origin images, responsive alternatives, video sources, posters
and caption files. It attaches PNG/JPEG/WebP image bytes to one model request per
page and reviews actual fetched caption cues. Model alt/caption evidence must be
an exact substring of that asset's text; visual observations are labeled for human
review rather than presented as verified OCR. Missing alt/source, HTTP failures
and malformed captions are deterministic findings that survive model failures.
Worker `mediaChecks` are visible in dashboard details and completion logs.
Media-only pages are dispatched even when body text is empty.

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
Media visual checks also require image-input support; the existing model setting
is reused without introducing a separate model or API credential.

`SITE_URL`, `LINGUISTIC_ASSET_PATH`, `ISSUE_SCHEMA_PATH`, and
`REFERENCE_CONTENT_PATH` override local defaults. The reference directory defaults
to `/data/reference-content` if mounted, otherwise the repository's reference directory.
See `.env.example`. Optional `OPENAI_INPUT_USD_PER_MILLION` and
`OPENAI_OUTPUT_USD_PER_MILLION` override the dated GPT-6 Astra preset or price an
unlisted model. Optional cached-input/cache-write rates are also supported.
Unknown rates are not treated as free; incomplete usage produces a labeled
known-usage subtotal. These estimates are not invoices.

Alternatively, run `docker compose up --build -d --wait` from the repository root. Compose
starts both services and mounts profiles, reference content, and the issue schema.
The local Docker CLI lacked Compose; installation testing used a checksum-verified,
temporary official Compose executable. The updated setup passed end to end with
isolated ports and volumes; the existing practice-site container was left running.

Click **Run audit** to use the model; this sends page text and mapped reference
Markdown, images, alt text and caption text to OpenAI and incurs API
usage. **Crawl and check links only** does not call the model. Signing into another
ChatGPT account does not change the application's `.env` API credential.

## Validation Already Performed

- `npm run typecheck`, dashboard JavaScript syntax, and Git whitespace checks passed.
- `npm test` passed all 55 TAP entries, including parent groups. Tests use
  local mock website/API servers without loading `.env` or contacting OpenAI.
- Dashboard validation on 2026-10-15 covered observed concurrency, incomplete and
  skipped coverage, retry descriptions, and reset behavior. Headless Chrome checks
  with intercepted API responses exercised live updates, stable disclosures,
  keyboard focus/Escape, clear/reset, crawl/reload and mobile layout. Desktop and
  mobile screenshots were inspected. No paid model audit was run for this UI change.
- Coverage includes alternate Japanese, US, French and German profiles; numeric
  date ambiguity and calendar validity; currency/unit category separation;
  explicit number/address/phone/capitalization rules; skipped optional policies;
  exact evidence and configured-rule validation; retry/usage tracking; retained
  deterministic findings on model failure; review status preservation; and block
  text extraction without artificial word concatenation.
- Brand/Terminology tests additionally cover French/Japanese profiles, all six
  supported policy fields, shared forbidden terms with Unicode/case normalization,
  either profile section alone, clean output, skipped empty/unknown policies,
  duplicate findings, stable review status, rule/evidence rejection, and failure
  isolation. These use simulated responses and are not an accuracy benchmark.
- Translation tests cover URL/index/fragment/query matching, configurable mounted
  directory layouts, absolute and relative source paths, traversal/symlink rejection,
  missing/empty/oversized/ambiguous references, French and Japanese targets with
  English/German sources, clean output, omission/addition evidence labels,
  exact source/target evidence rejection, review-state preservation, failure isolation,
  retries and usage. The source/target comparisons in these tests use mock responses.
- Media tests cover actual byte submission to the mock API, responsive/media-only
  pages, alt/caption evidence validation, visual-evidence labeling, malformed WebVTT,
  wrong language metadata, alternate caption languages, broken images/videos/tracks,
  same-origin redirects, unsupported/oversized resources, image limits, review-state
  preservation, retained deterministic findings and retry/usage reporting.
- A live eight-category audit on 2026-10-14 finished `completed` in 55.1 seconds:
  15 workers completed and the pricing page's Media worker skipped (no media).
  It produced 22 total findings, including six Media findings: missing hero alt,
  English marketing text in the mobile responsive image, a contradictory security
  image headline, incorrect product identity in alt text, English team-photo alt,
  and English cues in a track labeled Spanish. The actual images, markup and
  caption file were inspected against these findings. Seven image inputs (including
  a repeated poster) and one caption track were reviewed. This is a smoke test,
  not a full accuracy benchmark; review statuses were left unchanged.
- A live seven-category practice-site audit on 2026-10-14 completed all 13 workers
  in 43.9 seconds and produced 17 total findings. Translation Quality added four:
  omitted product reliability, Business storage reduced from 5 TB to 1 TB, an
  annual-period cancellation restriction, and an omitted free-trial qualifier.
  Source/target quotes and English explanations for these four were inspected.
  The home page returned no translation findings. This is a smoke test, not a
  precision/recall benchmark; no review statuses were changed during validation.
- A live six-category practice-site audit on 2026-10-14 completed all ten workers
  in 31.4 seconds and produced 12 findings. The five new findings were two Brand
  Voice issues (forbidden address term and casual slang) and three Terminology
  issues (nonpreferred cloud-storage wording, a translated protected product name,
  and an inflected banned term). Their evidence and English explanations were
  inspected; the shared brand/glossary ban appeared once under Terminology.
  This is a smoke test, not a full precision/recall benchmark. No review statuses
  were changed during this check.
- A live practice-site audit completed on 2026-10-14 in about 18.4 seconds. All
  seven workers completed. Seven findings were reviewed: one broken link, one
  grammar error, one date-format error, one nonmetric weight, and three wrong
  currency prices. No additional locale/formatting false positives were observed
  in this smoke test. This is not a full accuracy benchmark.
- The earlier “Milesde” finding was a crawler artifact from adjacent `dt`/`dd`
  elements. Block-boundary spacing now prevents it, with regression coverage.
- The dashboard derives coverage from the coordinator registry and now exposes
  all eight available categories. Audits can now finish `completed` when workers
  succeed/skip and crawl coverage is complete; findings are not worker failures.
- Docker Compose end-to-end installation and persistence validation passed on
  2026-10-20; hosted Windows/macOS/Linux CI execution remains pending.

## Known Limitations

- History is single-process SQLite, without retention controls, authentication or
  reviewer identities. Snapshot/review history is durable; the observed activity
  timeline remains tab-local. Pre-feature in-memory runs cannot be reconstructed.
- Audits deliberately show `partial` while categories are missing, workers fail,
  or crawl coverage is incomplete.
- Links does not assess external links or run a dedicated destination-language check.
- Browser exploration covers independent discovered controls at two viewports, not
  every interaction combination, authenticated flow or submission. State/timeout
  limits and browser failures are exposed in `browserCoverage`. See platform README
  for configuration and catalog test commands. Mock tests do not establish 25/25
  live-model accuracy; the explicit paid catalog audit measures case matching.
- Model-based page checks fail visibly above 24,000 characters; chunking is pending.
- Contextual locale checks depend on model judgment; numeric-date recognition is
  heuristic. Raw HTML markup, rendered layout and whitespace checks remain pending.
- A subsequent live run returned some currency explanations/instructions in Spanish.
  Enforcing English explanations while retaining target-language replacement text
  needs refinement.
- Locale/Formatting supports the explicit fields documented in the platform README;
  unknown locale keys are preserved but do not automatically become checks.
- Media checks are bounded to same-origin HTTP(S) resources and supported raster
  image inputs. Unsupported assets/limits cause visible incomplete coverage.
  Video checks do not play/decode the full video, inspect audio, or validate caption
  alignment. CSS backgrounds, iframe embeds and dynamically loaded media are not
  crawled. See the platform README for the precise request/size/count limits.
- Translation comparisons use extracted body text and raw reference Markdown.
  Semantic absence, acceptable paraphrasing and duplicate ownership require model
  judgment and human review; exact quote validation does not establish accuracy.

## Next Task: Persistence Deployment Validation

1. Run the portability CI matrix and review Windows/macOS/Linux results before distributing a release.
2. Add explicit retention/export controls and an operational backup procedure.
3. Add reviewer identity/authentication if the dashboard will be shared beyond the demo.

Following milestones: broader link/state coverage and a full unseen-input demo rehearsal.

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
