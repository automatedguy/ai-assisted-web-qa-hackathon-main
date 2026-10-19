import assert from 'node:assert/strict';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { collectRenderedPages } from '../src/crawler/rendered.js';
import { crawlSite } from '../src/crawler/crawl.js';
import { renderedDateIssues } from '../src/agents/rendered-checks.js';
import { checkBrokenLinks } from '../src/agents/links.js';
import { captureIssueScreenshots } from '../src/visual-evidence.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QaIssue } from '../src/issues.js';

// Real practice HTML/JS/assets, isolated server, no model calls or .env.
delete process.env.QA_DISABLE_BROWSER_CHECKS;
const app = express();
app.use(express.static(fileURLToPath(new URL('../../site-under-test/public/', import.meta.url))));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const address = server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const crawl = await crawlSite(origin);
  const home = crawl.pages.find(page => page.url === origin + '/')!;
  const pricing = crawl.pages.find(page => page.url.endsWith('/pricing.html'))!;
  const about = crawl.pages.find(page => page.url.endsWith('/about.html'))!;
  assert(pricing.links.some(link => link.href === origin + '/about.html#productos' && link.text === 'Ver Business en la tabla'));
  assert(about.sections?.productos.includes('Nuestros productos'));
  assert(pricing.sections?.planes.includes('Business'));
  assert.equal(checkBrokenLinks(crawl).length, 1);
  await collectRenderedPages(crawl.pages);
  const snapshots = home.rendered!;
  assert.equal(snapshots.status, 'completed', JSON.stringify(snapshots.limitations));
  const one = snapshots.observations.find(item => item.text === '1 archivos')!;
  assert(one, 'QA-08: singular state collected'); assert(one.reproduction.steps.length);
  assert(snapshots.observations.some(item => item.text === 'No files match your search.'), 'QA-09: English empty state collected');
  for (const page of [home, about, pricing]) {
    assert.equal(page.rendered!.status, 'completed', JSON.stringify(page.rendered!.limitations));
    const menu = page.rendered!.observations.find(item => item.text === 'Close menu')!;
    assert(menu, 'QA-10: every page has the mobile accessible-name observation');
    assert.equal(menu.reproduction.attribute, 'aria-label'); assert.equal(menu.reproduction.viewport.width, 390);
    assert(menu.reproduction.steps.some(step => step.action === 'click'));
  }
  const dates = renderedDateIssues(snapshots.observations, home.url, 'DD/MM/YYYY');
  assert.equal(dates.length, 4, 'QA-11: all four date elements, not just unambiguous dates');
  assert(dates.some(issue => issue.evidence === '10/01/2026' && issue.expected === '01/10/2026'));
  assert.equal(new Set(dates.map(issue => issue.location.selector_or_xpath)).size, 4);
  assert(dates.every(issue => issue.reproduction?.steps.some(step => step.action === 'select')));
  const mobile = snapshots.resources.find(item => item.url.endsWith('/workspace-mobile.png'))!;
  const desktop = snapshots.resources.find(item => item.url.endsWith('/workspace-desktop.png'))!;
  assert.equal(mobile.reproduction.viewport.width, 390); assert.equal(desktop.reproduction.viewport.width, 1440);
  // Verify production screenshot replay, not just collection.
  const mobileIssue: QaIssue = {id:'mobile-evidence',category:'media',severity:'major',status:'new',confidence:1,
    location:{page_url:home.url,element_type:'image',selector_or_xpath:mobile.selector},description:'Mobile image localization',
    evidence:mobile.url,reproduction:mobile.reproduction};
  await captureIssueScreenshots('catalog-browser-test', [...dates,mobileIssue]);
  if (process.env.QA_DISABLE_SCREENSHOTS !== '1') {
    assert(dates.every(issue => issue.visual_evidence?.highlighted), 'Rendered evidence must be replayed and highlighted');
    assert(mobileIssue.visual_evidence?.highlighted, 'The mobile resource must be replayed');
    const { screenshotDir } = await import('../src/storage-paths.js');
    const png = await readFile(join(screenshotDir,mobileIssue.visual_evidence.screenshot_url.split('/').pop()!));
    assert.equal(png.readUInt32BE(16),390,'Mobile evidence must not use a desktop screenshot');
  }
  console.log(JSON.stringify({ status: 'passed', states: crawl.pages.map(page => ({ url: page.url, states: page.rendered?.states })),
    checks: ['QA-06 destination preserved', 'QA-08 generated singular', 'QA-09 empty state', 'QA-10 three mobile menus', 'QA-11 four dates and ISO disambiguation', 'QA-13 responsive resources', 'state screenshot replay'] }, null, 2));
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
