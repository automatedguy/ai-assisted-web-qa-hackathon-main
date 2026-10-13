# Audit coordinator

`audit.ts` loads the YAML profile and issue validator, crawls once, schedules
registered workers with a concurrency limit of two, validates findings, and
retains individual worker failures. The server starts runs asynchronously;
the dashboard polls their progress. A partial result must not be shown as
full eight-category coverage.
