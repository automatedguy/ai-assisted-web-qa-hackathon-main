# Repository Guidelines

## Project Structure & Module Organization

This repository is a hackathon starter kit for building a demo-ready, multi-agent web QA platform. `site-under-test/` contains the practice site; `linguistic-assets/` holds the site's YAML profile; and `reference-content/` contains English source pages for translation checks. `docs/ISSUE_SCHEMA.json` defines the issue format. The platform scaffold is under `platform-template/`, with placeholder directories for `src/orchestrator/`, `src/agents/`, and `src/dashboard/`. The root `docker-compose.yml` defines the shared network and practice site; its example platform service is currently commented out.

## Build, Test, and Development Commands

- `docker compose up --build` builds and starts the practice site at `http://localhost:8080`.
- To run your platform in the same network, implement its Dockerfile and uncomment/configure the `qa-platform` service in `docker-compose.yml`; it should serve the dashboard on container port `3000`.
- `docker compose down` stops and removes the local containers and network.

No platform build, test, or lint command is prescribed because the scaffold intentionally has no implementation. Add language-specific commands when choosing a stack and document them in `platform-template/README.md`.

## Coding Style & Naming Conventions

Choose conventions appropriate to your implementation language and apply them consistently. Keep orchestration, check agents, and dashboard responsibilities clear. Use descriptive lowercase filenames (for example, `links.py` or `translation_quality.ts`) and keep configuration outside source code. Read `SITE_URL` and `LINGUISTIC_ASSET_PATH` from the environment, and avoid hardcoding practice-site profile values so the platform works with an unseen demo site.

## Testing & Demo Readiness

There is no test framework or coverage target in the starter. Add focused checks for your chosen stack and document how to run them. Before the demo, run the platform against the practice site, validate issues against `docs/ISSUE_SCHEMA.json`, and exercise all eight check categories. Confirm the dashboard supports review statuses and that logs show which checks ran.

## Team Changes & Demo Handoff

Git history is unavailable in this checkout, so no team commit convention is established. Keep commits focused with clear subjects (for example, `Add link checker`). For handoff, document the architecture and how to start the platform, include validation results, and note required environment variables or Docker changes. Capture dashboard screenshots when they help explain the demo.

## Configuration & Demo Compatibility

The platform container receives `SITE_URL` and `LINGUISTIC_ASSET_PATH`; reference Markdown files are mounted under `/data/reference-content/`. Treat mounted inputs as read-only. The demo swaps the site and linguistic asset without code changes, so derive checks from those inputs rather than fixed page content.
