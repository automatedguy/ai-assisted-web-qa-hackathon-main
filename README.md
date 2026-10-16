# AI-Assisted Web QA Platform

## Structure

```
.
├── docker-compose.yml          # brings up the practice site + a team's platform
├── site-under-test/            # the practice static site (Dockerized)
├── linguistic-assets/
│   └── practice-profile.yaml   # brand voice / locale / glossary rules for the practice site
├── reference-content/          # English source content, for translation-quality 
├── platform-template/          # TypeScript/Express QA platform and dashboard
├── docs/                       # issue schema, handoff notes, and presentation assets
└── .env.example                # local configuration template
```

## Objective

Build a multi-agent platform that, given the URL of a static website and a
linguistic asset describing its expected editorial/brand/locale conditions,
automatically audits the site's content and surfaces issues for human QA
review. This is a capability-building exercise: the emphasis is on agentic
architecture, monitoring, and generalization to unseen input — not on the
specific practice site itself.

## How it works

1. You develop and self-test against the **practice site** in
   `site-under-test/`, using the linguistic asset in
   `linguistic-assets/practice-profile.yaml`. The practice site contains a
   mix of clean content and intentionally seeded issues across all check
   categories — there is no answer key. Use your own judgment to validate
   your detection.
2. At demo time, organizers swap in a **new site + new linguistic asset**
   (unseen content, same shape). You re-run your already-built platform
   against it live, with no code changes, to show it generalizes.

## What you're building

- A multi-agent system, not a single prompt, that checks: spelling &
  grammar, formatting, links, locale-specific rules, brand voice,
  translation quality, terminology-in-context, and media (images/video) —
  see the check catalog below for details.
- Issues that conform to `docs/ISSUE_SCHEMA.json`.
- A review dashboard where a human can see what ran, browse issues, and
  mark each `verified`, `dismissed`, or `escalated`.
- Basic monitoring: what ran, how long it took, what it cost.

## What's provided

- `site-under-test/` — the practice static site, Dockerized.
- `linguistic-assets/practice-profile.yaml` — the linguistic asset for the
  practice site.
- `reference-content/*.md` — English source content, for translation-
  quality comparison against the target-locale site.
- `platform-template/` — the implemented TypeScript/Express platform, including
  the coordinator, six agents, dashboard, tests, and Dockerfile.
- `docker-compose.yml` — brings up the practice site and your platform
  together on a shared network.
- `docs/` — this brief, the check catalog, the issue schema, and the
  evaluation rubric.

## What's not provided (by design)

- No answer key for the practice site's seeded issues.
- No accuracy benchmark for the model-backed checks; use the seeded practice
  site for smoke testing and review findings before the demo.

## Getting started

```
docker compose up --build
```

This starts the practice site on `http://localhost:8080` and the platform
dashboard on `http://localhost:3000`. The platform requires `OPENAI_API_KEY`
for model-backed audits; copy `.env.example` to `.env` and configure it first.

See `platform-template/README.md` for the exact contract your platform
must satisfy so organizers can swap in the demo site without touching your
code.


# Check Catalog

Your platform must attempt all eight categories below. You decide how many
agents to use and how they're split — one per category, several categories
per agent, whatever architecture you can explain and justify.

| Category | What it catches | Illustrative example |
|---|---|---|
| `spelling_grammar` | Typos, grammatical errors, punctuation, agreement errors in the target locale | Subject/verb or number agreement mistakes |
| `formatting` | Date/number/currency format mismatches vs. locale rules, inconsistent capitalization, broken markup | A US-style date on an `es-ES` page |
| `links` | Broken (404) links, links pointing to the wrong locale, anchor text that doesn't match its destination | A nav link pointing to a page that doesn't exist |
| `locale_rules` | Units, currency, address/phone formats expected for the target locale | Imperial units or USD pricing on a `metric`/`EUR` page |
| `brand_voice` | Tone/style drift from the linguistic asset's brand voice rules, forbidden terms | Casual slang on a page meant to read as confident and concise |
| `translation_quality` | Mistranslation, omission, addition, or meaning drift vs. the reference source content | A translated sentence drops a key qualifier like "free" |
| `terminology` | Inconsistent or incorrect glossary use; do-not-translate terms translated anyway; banned terms used | A product name gets translated when it should stay as-is |
| `media` | Missing/incorrect alt text, wrong-language captions, text-in-image mismatched to the page's locale, broken media | A caption track in the wrong language for the page it's on |

## Notes

- Every issue needs **evidence** — the actual offending text/element — not
  just a category label. A reviewer should be able to verify your finding
  in a few seconds without re-deriving it themselves.
- The practice site (`site-under-test`) contains a mix of clean and
  seeded-issue content, spanning all eight categories, including one
  embedded video with a caption track. There is no answer key — this is
  intentional. Use it to develop and sanity-check your own detection.
- The demo site will use a different linguistic asset with different
  values — do not hardcode against the practice profile's specific
  strings (brand name, glossary terms, forbidden words, etc.).


# Evaluation

Teams are scored primarily on how their platform performs against the
**unseen demo site**, run live at demo time.

| Dimension | What's assessed |
|---|---|
| **Detection accuracy** | Precision/recall against the organizers' seeded ground truth on the demo site — did it find the real issues without flooding the reviewer with false positives? |
| **Coverage** | Did the platform attempt all eight check categories, including the video/media checks? |
| **Review workflow** | Can a human reviewer quickly see what ran, browse issues, and verify/dismiss/escalate them? Is the audit trail visible? |
| **Architecture & explainability** | Is this a genuine multi-agent design the team can explain? Does each issue come with usable evidence/reasoning, not just a verdict? |
| **Monitoring & Observability** | Can the team show which agents and checks executed, their status, duration, outputs, failures, retries, and audit trail? |
| **Cost/efficiency** | How effectively does the platform balance detection quality with token consumption, latency, parallelism, retries, and fallback strategies? |



