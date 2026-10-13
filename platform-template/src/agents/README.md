# Workers and agents

`types.ts` defines the common agent contract and observable worker result.
`language.ts` owns the Language agent instructions, schema, API calls, and
source-evidence validation. `links.ts` provides deterministic HTTP findings.
The orchestrator registers and schedules these independently.

To add an agent, implement `Agent`, assign its category and site/page scope,
and register it in `../orchestrator/audit.ts`. Return issues conforming to
`docs/ISSUE_SCHEMA.json`; do not change review status or call other workers
from inside an agent. Record model usage and attempts on the worker report.
