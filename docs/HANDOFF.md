# Project Handoff

Updated: 2026-10-14. Implementation: Media milestone on `main`.
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

All eight categories are implemented under a shared coordinator with six agents:
Language, Links, Locale/Formatting, Brand/Terminology, Translation Quality and Media.
Links and numeric-date checks are deterministic. Media combines deterministic
resource/metadata checks with model-based caption, alt text and image inspection.

| Component | Location and behavior |
|---|---|
| Server | `platform-template/src/server.ts`: Express API and static dashboard |
| Crawler | `src/crawler/crawl.ts`: same-origin HTML extraction with block boundaries, up to 50 visits; normalizes `/index.html` to `/` |
| Configuration | `src/config.ts`: loads YAML on each audit, validates required target locale, preserves additional profile fields |
| Coordinator | `src/orchestrator/audit.ts`: agent registry, site/page dispatch, concurrency of two, isolated failures, issue validation and deduplication |
| Worker contract | `src/agents/types.ts`: agent inputs, scope, declared categories, execution report, partial-failure findings |
| Language | `src/agents/language.ts`: Responses structured outputs for `spelling_grammar`; exact source-evidence validation |
| Locale/Formatting | `src/agents/locale-formatting.ts`: profile-driven policies, contextual model checks and overlap suppression; `date-format.ts`: deterministic numeric dates |
| Brand/Terminology | `src/agents/brand-terminology.ts`: profile-driven tone/style and glossary checks, shared forbidden-term ownership, stable finding IDs |
| Translation Quality | `src/agents/translation-quality.ts`: source/target meaning comparison; `reference-content.ts`: mapped Markdown loading within the configured directory |
| Media | `src/agents/media.ts`: resource/metadata and visual/language checks; `media-resources.ts`: bounded fetches, image signatures and basic WebVTT extraction |
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
target locale; the worker skips when no relevant policies exist. It checks date,
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
`OPENAI_OUTPUT_USD_PER_MILLION` enable approximate cost reporting for that model;
unknown rates/usage are displayed as unavailable, not zero.

Alternatively, run `docker compose up --build` from the repository root. Compose
starts both services and mounts profiles, reference content, and the issue schema.
The Compose plugin was unavailable earlier on this machine; this updated Compose
setup has not been exercised end to end.

Click **Run audit** to use the model; this sends page text and mapped reference
Markdown, images, alt text and caption text to OpenAI and incurs API
usage. **Crawl and check links only** does not call the model. Signing into another
ChatGPT account does not change the application's `.env` API credential.

## Validation Already Performed

- `npm run typecheck`, dashboard JavaScript syntax, and Git whitespace checks passed.
- `npm test` passed all 48 TAP entries, including parent groups. Tests use
  local mock website/API servers without loading `.env` or contacting OpenAI.
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
- Media checks are bounded to same-origin HTTP(S) resources and supported raster
  image inputs. Unsupported assets/limits cause visible incomplete coverage.
  Video checks do not play/decode the full video, inspect audio, or validate caption
  alignment. CSS backgrounds, iframe embeds and dynamically loaded media are not
  crawled. See the platform README for the precise request/size/count limits.
- Translation comparisons use extracted body text and raw reference Markdown.
  Semantic absence, acceptable paraphrasing and duplicate ownership require model
  judgment and human review; exact quote validation does not establish accuracy.

## Next Task: Durable Runs and Review History

1. Persist audits, worker reports, findings and review decisions across restarts.
2. Record review status changes with timestamps and expose past runs in the dashboard.
3. Test restart recovery and run isolation, then validate Docker Compose end to end.

Following milestones: Links expansion and a full unseen-input demo rehearsal.

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
