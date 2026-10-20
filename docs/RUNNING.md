# Run Skynet on your computer

The simplest installation uses Node.js. Docker is optional. You can download the
repository as a ZIP; Git is not required. Keep the extracted directory structure intact.

## Requirements

- Install the latest **Node.js 22.x** release (minimum 22.18), including npm, from
  [nodejs.org](https://nodejs.org/en/download). Node 24 is also included in CI.
- Browser checks use Playwright Chromium. Use Windows 11+, macOS 14+, or a supported
  Ubuntu/Debian system. Check [Playwright's current system requirements](https://playwright.dev/docs/intro#system-requirements)
  before using an older operating system. Ubuntu 22.04/24.04 and Debian 12/13 are supported choices.
- Internet access is needed to download dependencies/Chromium, access remote sites,
  and run model-backed checks. Local link checks do not need an API credential.
- Full audits require your own `OPENAI_API_KEY` and a configured model supporting
  Responses structured outputs and image inputs. API usage incurs charges.

The launcher does not assume Docker, Python, Git, Bash, or a separately installed Chrome.

## Windows: PowerShell

Extract the project, for example to `C:\Projects\ai-assisted-web-qa-hackathon-main`.
Open PowerShell and run each command separately:

```powershell
cd C:\Projects\ai-assisted-web-qa-hackathon-main
node --version
npm.cmd run setup
notepad .env
npm.cmd start
```

In Notepad, add your key after `OPENAI_API_KEY=` and save before starting. Leave it
blank if you only want **Crawl and check links only**. The `.cmd` suffix avoids the
PowerShell `npm.ps1` execution-policy problem without changing Windows security settings.
Do not copy someone else's `.env`, `node_modules`, or machine-specific browser path.

## macOS and Linux

Open a terminal in the extracted repository directory:

```sh
node --version
npm run setup
```

On supported Linux distributions, use this setup command to install Chromium's OS
libraries too; the package manager may request administrator access:

```sh
npm run setup -- --with-deps
```

Edit the generated `.env` in a text editor and set `OPENAI_API_KEY` if needed, then:

```sh
npm start
```

## What setup and startup do

`npm run setup` creates `.env` only if it does not already exist, installs the exact
platform dependencies with `npm ci`, downloads the matching Chromium, and runs
diagnostics. Existing credentials, data and settings are preserved. Re-run setup
after downloading an updated version, with the app stopped.

`npm start` loads the root `.env` and starts both the practice site and dashboard in
one terminal. Wait for **Ready**, then open:

- Dashboard: **http://localhost:3000**
- Practice website: **http://localhost:8080**

Keep the terminal open. **Ctrl+C** stops both services. Run `npm start` again to
restart; it does not resume interrupted audits or make model calls by itself.
The native launcher listens on the local computer by default.

Run `npm run doctor` (`npm.cmd run doctor` on Windows) whenever setup needs checking.
It checks Node, dependencies, SQLite, the default profile/schema/references, writable
storage, and an actual Chromium launch and screenshot. It reports whether a key is
set but never prints it, validates model access, or starts a paid audit. It checks
the environment's default assets; uploaded selections are validated in the app.

## First check and switching sites

1. Open **Test configuration** and confirm the practice site/profile are selected.
2. Run **Crawl and check links only** first. The practice site intentionally includes
   a broken link, so a successful check should produce a finding.
3. Review the finding, then use **Export Results → HTML**. Saved runs remain in history.
4. With an API key configured, use **Run audit** for all applicable agent checks.

To test another website, start that site's server separately, use **Add a website**,
upload/select its YAML and optional reference folder, then **Apply selection**.
No site repository is cloned or started by the selector. Optional checks require
their corresponding policies; translation comparison requires mapped source text.

If you already run the practice site elsewhere, use `npm run start:platform` to start
only the dashboard. An external `SITE_URL` in `.env` also skips the bundled practice
server. The app remembers a previously applied selection; changing `.env` does not
silently replace an uploaded/saved selection. Use **Reload choices** and **Apply selection**.

## Ports and paths

If another application uses the default ports, add these lines to the root `.env`:

```dotenv
PORT=3001
PRACTICE_SITE_PORT=8081
```

Restart and use the URLs printed by the launcher. If you explicitly set `SITE_URL`,
make sure it matches the site you intend to test. The launcher reports occupied
ports and does not stop other applications to free them.

The supplied profile, reference folder and issue schema are found automatically.
For custom Windows paths, forward slashes avoid backslash-escape surprises:

```dotenv
LINGUISTIC_ASSET_PATH="C:/QA Assets/customer-profile.yaml"
REFERENCE_CONTENT_PATH="C:/QA Assets/reference-content"
QA_DATA_DIR="C:/QA Data/skynet"
```

Close the app before moving or backing up its data. By default, history, uploaded
profiles and screenshots are in `platform-template/data/`. Back up that entire directory
and restore it to the same data path: uploaded profile records currently retain server
file paths. For a new computer with different paths, upload its profiles again rather
than assuming a copied database will relocate those files. Do not share `.env`; it
contains your credential.

## Optional Docker installation

Install Docker Engine with Compose on Linux, or Docker Desktop using Linux containers
on Windows/macOS. Native Node.js is not required for this path. In the repository root,
create `.env` from `.env.example` and edit the API key:

```powershell
# Windows PowerShell, first setup only
Copy-Item .env.example .env
notepad .env
docker compose up --build -d --wait
```

```sh
# macOS/Linux, first setup only
cp -n .env.example .env
# Edit .env in your text editor.
docker compose up --build -d --wait
```

Both services have health checks. Open the same localhost URLs above. `PORT` and
`PRACTICE_SITE_PORT` change the host ports for Docker too. Compose uses its internal
site URL and mounted read-only assets, independent of native path overrides.

```sh
docker compose ps
docker compose logs --tail=100 qa-platform
docker compose down
```

Ordinary `down` retains the `qa-history` volume. **Do not use `down -v` to stop the
app**: it deletes saved history, uploaded assets and screenshots. When replacing
the repository directory, keep the same Compose project name to reuse its volume.

To test a website running on your Windows/macOS host from Docker Desktop, use
`http://host.docker.internal:PORT` in the site selector. Container `localhost` refers
to the container itself. Linux Docker networking may require an explicit host mapping.

## Troubleshooting

| Symptom | Action |
|---|---|
| `node` / `npm` not recognized | Install Node with npm and reopen the terminal. Check `node --version`. |
| Node/SQLite error | Use Node 22.18+; run `npm run doctor`. |
| `npm.ps1` cannot be loaded | Use `npm.cmd` in PowerShell. |
| Port already in use | Stop your previous app instance or change the ports in `.env`. |
| Browser missing or fails to launch | Re-run setup; on Linux add `-- --with-deps`. Remove stale `QA_BROWSER_PATH` values copied from another machine. |
| Download blocked by company network | Configure your approved npm/Playwright proxy or certificate settings with IT, then re-run setup. Do not disable TLS verification. |
| Missing API key | Add it to root `.env`, restart, or use link-only checks. |
| Model request fails | Check the configured model's availability, credential permissions and API quota. Setup does not make a paid request to verify these. |
| Wrong site/profile selected | Use **Reload choices**, select the matching pair, then **Apply selection**. |
| Long audit appears idle | Larger sites can take time; inspect **View activity**. This installation change does not add an in-app Stop button or page-limit control. |
| `docker compose` unavailable | Install/update Compose or Docker Desktop, or use the native Node setup. |

## Installation regression checks

From the repository root:

```sh
npm test
npm run test:install
```

The test runner is OS-independent and uses local mock services without loading `.env`.
Installation tests use temporary directories (including spaces), free ports and empty
credentials. They verify both native servers, port conflicts, shutdown, restart, reviews
and HTML export persistence. They do not touch your saved runs.

With Docker and Compose available, `node scripts/docker-smoke.mjs` builds a disposable
project, checks Chromium/screenshots and saved data across container recreation, then
removes only its own test containers and volume. It does not read your `.env` or make
model calls. It requires free disk space and internet access for the image build.

`.github/workflows/portability.yml` runs native setup/tests on Windows, macOS and Linux
with Node 22/24, plus a Linux Docker persistence test. A workflow definition is not proof
of a passing run: inspect the actual CI results for the commit being distributed.
