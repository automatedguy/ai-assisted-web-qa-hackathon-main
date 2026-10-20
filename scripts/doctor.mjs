import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnvironment, platform, requirePlatform, port, reportError, runNode } from './common.mjs';

async function inspectInstallation() {
  console.log(`OK Node.js ${process.versions.node} (${process.platform}/${process.arch})`);
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(':memory:'); database.exec('SELECT 1'); database.close();
  console.log('OK SQLite available');
  const { loadProfile, loadIssueValidator } = await import(pathToFileURL(join(platform, 'src/config.ts')).href);
  const { loadReference } = await import(pathToFileURL(join(platform, 'src/agents/reference-content.ts')).href);
  const sitePort = port(process.env.PRACTICE_SITE_PORT, 8080, 'PRACTICE_SITE_PORT');
  port(process.env.PORT, 3000, 'PORT');
  const site = process.env.SITE_URL || `http://localhost:${sitePort}`;
  const url = new URL(site);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SITE_URL must use HTTP or HTTPS.');
  const profile = await loadProfile(); await loadIssueValidator();
  for (const reference of profile.reference_content ?? []) await loadReference(new URL(reference.page, site).href, site, profile);
  console.log(`OK Default linguistic profile (${profile.locale.target_locale}), issue schema and mapped references`);
  const { dataDir, screenshotDir } = await import(pathToFileURL(join(platform, 'src/storage-paths.ts')).href);
  for (const directory of new Set([dataDir, screenshotDir])) {
    await mkdir(directory, { recursive: true });
    const probe = await mkdtemp(join(directory, '.write-check-'));
    try { await writeFile(join(probe, 'probe'), 'ok'); }
    finally { await rm(probe, { recursive: true, force: true }); }
  }
  console.log('OK Data and screenshot directories are writable');
  const { chromium } = requirePlatform('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}) });
    const page = await browser.newPage(); await page.setContent('<p>Browser check</p>');
    await page.screenshot();
  } catch {
    throw new Error('Chromium could not launch. Run npm run setup; on Linux use npm run setup -- --with-deps. If QA_BROWSER_PATH is set, check that it points to an installed browser on this computer.');
  } finally { await browser?.close(); }
  console.log('OK Chromium launches and captures screenshots');
  console.log(process.env.OPENAI_API_KEY ? 'OK API key is set (model access and billing were not tested)' : 'NOTE No API key: use Crawl and check links only, or add OPENAI_API_KEY to .env for full audits.');
  console.log('Diagnostics passed. No website audit or paid model request was made.');
}

try {
  loadEnvironment();
  try { requirePlatform.resolve('tsx'); requirePlatform('express'); }
  catch { throw new Error('Platform dependencies are missing. Run npm run setup from the repository folder.'); }
  if (process.argv.includes('--checks')) await inspectInstallation();
  else await runNode(['--import', 'tsx', fileURLToPath(import.meta.url), '--checks']);
} catch (error) { reportError(error); }
