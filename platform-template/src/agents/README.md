# Workers and agents

`types.ts` defines the common agent contract and observable worker result.
`language.ts` owns the Language agent instructions. `locale-formatting.ts`
owns policy selection, contextual locale/formatting instructions and overlap
suppression; `date-format.ts` is its deterministic numeric-date tool.
`brand-terminology.ts` owns brand tone/style and glossary checks, assigning
shared forbidden terms to Terminology and reporting two categories per worker.
`translation-quality.ts` compares target pages with mapped Markdown sources;
`reference-content.ts` resolves page mappings and confines read-only source access
to the reference directory. Translation findings contain validated quotes from
both source and target, with insertion anchors labeled for omissions.
`media.ts` combines metadata/resource checks with alt/caption language and visual
image inspection. `media-resources.ts` provides bounded same-origin fetches,
image signature detection and basic WebVTT extraction. Media findings preserve
asset URLs/XPaths; exact text evidence and model visual observations are distinguished.
`model-check.ts` shares structured output, API retry, usage accounting and exact
source-evidence validation. `links.ts` provides deterministic HTTP findings.
The orchestrator registers and schedules agents independently.

To add an agent, implement `Agent`, declare its `categories` and site/page scope,
and register it in `../orchestrator/audit.ts`. Return issues conforming to
`docs/ISSUE_SCHEMA.json`; do not change review status or call other workers
from inside an agent. Record model usage and attempts on the worker report.
An agent without applicable optional policies may set its report to `skipped`
with a reason. Throw `WorkerFailure` with independently obtained deterministic
issues to retain them when a later model step fails; the coordinator validates
them and marks the worker failed.
