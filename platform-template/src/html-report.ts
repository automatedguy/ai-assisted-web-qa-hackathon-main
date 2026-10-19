import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Audit } from './orchestrator/audit.js';
import { categories, type QaIssue } from './issues.js';
import { costLabel, runCost } from './dashboard/public/costs.js';

const labels: Record<QaIssue['category'], string> = {
  spelling_grammar: 'Spelling & grammar', formatting: 'Formatting', links: 'Links', locale_rules: 'Locale rules',
  brand_voice: 'Brand voice', translation_quality: 'Translation quality', terminology: 'Terminology', media: 'Media',
};
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const text = (value: unknown) => `<span class="verbatim">${escape(value)}</span>`;
function link(value: string | undefined) {
  if (!value) return 'Not recorded';
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return `<a href="${escape(url.href)}" rel="noopener noreferrer" target="_blank">${escape(value)}</a>`;
  } catch { /* Unsupported links are displayed only as text. */ }
  return escape(value);
}
function fields(items: Array<[string, unknown]>) {
  return `<dl>${items.filter(([,value]) => value !== undefined && value !== null && value !== '').map(([key,value]) =>
    `<div><dt>${escape(key)}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>`;
}
type Screenshot = { src?: string; message?: string };
async function screenshot(path: string, directory: string): Promise<Screenshot> {
  // Only read PNGs from the configured screenshot directory; never fetch URLs.
  const filename = path.match(/^\/api\/screenshots\/([a-zA-Z0-9_-]+\.png)$/)?.[1];
  if (!filename) return { message: 'Screenshot unavailable: the saved image reference is not supported.' };
  try {
    const root = await realpath(directory), file = await realpath(join(root, filename));
    if (dirname(file) !== root) return { message: 'Screenshot unavailable: the image is outside the screenshot directory.' };
    const bytes = await readFile(file);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { message: 'Screenshot unavailable: the saved file is not a PNG image.' };
    }
    return { src: 'data:image/png;base64,' + bytes.toString('base64') };
  } catch { return { message: 'Screenshot unavailable: the saved image file is missing or cannot be read.' }; }
}

export async function htmlReport(run: Audit, reviews: unknown[], screenshotDirectory: string, exportedAt: string): Promise<string> {
  const images = new Map<string, Screenshot>();
  for (const issue of run.issues) {
    const path = issue.visual_evidence?.screenshot_url;
    if (path && !images.has(path)) images.set(path, await screenshot(path, screenshotDirectory));
  }
  const embedded = run.issues.filter(issue => images.get(issue.visual_evidence?.screenshot_url ?? '')?.src).length;
  const cost = runCost(run);
  const successful = run.crawl?.pages.filter(page => page.status >= 200 && page.status < 300).length ?? 0;
  const incomplete = run.status !== 'completed' || run.crawl?.limitReached || Boolean(run.crawl?.errors.length) ||
    run.workers.some(worker => ['failed', 'queued', 'running'].includes(worker.status));
  const table = (headers: string[], rows: string[][]) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const finding = (issue: QaIssue, index: number) => {
    const visual = issue.visual_evidence, image = images.get(visual?.screenshot_url ?? '');
    const screenshotHtml = image?.src ? `<figure tabindex="0" aria-label="Screenshot for finding ${index + 1}; scroll to see the full image"><img src="${image.src}" alt="Saved screenshot for finding ${index + 1}" /><figcaption>${escape(visual?.note || (visual?.highlighted ? 'The affected element is outlined in red.' : 'No element highlight was recorded.'))}</figcaption></figure>` :
      `<p class="unavailable">${escape(image?.message || 'No screenshot was captured for this finding.')}${visual?.note ? ' ' + escape(visual.note) : ''}</p>`;
    return `<article class="finding" id="finding-${index + 1}">
      <div class="finding-top"><span class="eyebrow">Finding ${index + 1} · ${escape(labels[issue.category] ?? issue.category)}</span><div><span class="badge severity-${escape(issue.severity)}">${escape(issue.severity)}</span> <span class="badge">${escape(issue.status)}</span></div></div>
      <h3>${escape(issue.description)}</h3><p class="location">${link(issue.location.page_url)}</p>
      <div class="finding-content"><div><h4>Evidence</h4><blockquote>${text(issue.evidence)}</blockquote>
      ${issue.expected ? `<h4>Expected result</h4><p>${text(issue.expected)}</p>` : ''}
      ${issue.suggested_fix ? `<h4>Suggested fix</h4><p>${text(issue.suggested_fix)}</p>` : ''}
      ${fields([['Selector / XPath', issue.location.selector_or_xpath], ['Element type', issue.location.element_type],
        ['Assessment', issue.assessment?.method === 'deterministic' ? 'Deterministic check' : issue.assessment?.method === 'model_visual' ? 'Model visual observation — review required' : issue.assessment?.method === 'model_text' ? 'Model text review' : 'Not recorded'],
        ['Check', issue.assessment?.check], ['Rule', issue.assessment?.rule ? `${issue.assessment.rule.id}: ${issue.assessment.rule.value}` : undefined],
        ['Confidence (not calibrated accuracy)', issue.confidence], ['Finding ID', issue.id]])}
      ${issue.reproduction ? `<h4>Reproduction</h4><p>Viewport: ${escape(issue.reproduction.viewport.width)} × ${escape(issue.reproduction.viewport.height)}</p>
        ${issue.reproduction.steps.length ? `<ol>${issue.reproduction.steps.map(step => `<li>${text(`${step.action}: ${step.selector}${step.value !== undefined ? ' → ' + step.value : ''}`)}</li>`).join('')}</ol>` : '<p>No interaction steps recorded.</p>'}
        ${fields([['Attribute', issue.reproduction.attribute], ['Resource', issue.reproduction.resourceUrl], ['State', issue.reproduction.stateId]])}` : ''}
      </div><div class="visual"><h4>Screenshot</h4>${screenshotHtml}</div></div></article>`;
  };
  const reviewRows = reviews.map(item => {
    const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return [value.reviewedAt, value.issueId, value.previousStatus, value.status].map(escape);
  });
  const workers = run.workers.map(worker => [escape(worker.agent), link(worker.pageUrl) === 'Not recorded' ? 'Whole site' : link(worker.pageUrl),
    escape(worker.status), escape(worker.issueCount), text(worker.message || worker.stage || ''),
    text(`${(worker.durationMs / 1000).toFixed(1)}s · ${worker.attempts} attempts · ${worker.inputTokens} input / ${worker.outputTokens} output tokens${worker.usageComplete ? '' : ' · usage incomplete'}`)]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Skynet QA report — ${escape(run.id)}</title>
<style>
:root{color-scheme:light;--ink:#242426;--muted:#626269;--line:#dedee2;--accent:#a80000}*{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#151515;color:#fff;border-bottom:4px solid var(--accent);padding:36px max(24px,calc((100% - 1160px)/2))}header p{color:#ccc}h1{font-size:34px;line-height:1.2;margin:8px 0 12px}h2{font-size:23px;margin-top:0}h3{font-size:19px;margin:16px 0 8px}h4{font-size:14px;color:var(--muted);margin:20px 0 8px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:700}main{max-width:1208px;margin:28px auto;padding:0 24px}section,.finding{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;margin:20px 0}a{color:#852323;overflow-wrap:anywhere}header a{color:#fff}p,dd,td,li,h3,.location{overflow-wrap:anywhere}.muted,footer,figcaption,dt{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metric{padding:16px;background:#f7f7f8;border-radius:8px}.metric strong{display:block;font-size:28px;color:var(--accent)}.metric span{color:var(--muted);font-size:13px}.warning{padding:14px 18px;background:#fff4df;border-left:4px solid #b46c00;margin:18px 0}.category-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.category-grid a{display:flex;gap:12px;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:6px;padding:12px;text-decoration:none}.category-grid strong{font-size:22px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px}dt{font-size:12px;font-weight:650}dd{margin:3px 0 0}.verbatim{white-space:pre-wrap;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}th{background:#f4f4f5}th,td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;min-width:85px}.finding-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.badge{display:inline-block;border-radius:5px;background:#eeeef1;padding:4px 9px;font-size:12px;font-weight:650;text-transform:capitalize}.severity-critical{background:#fceaea;color:#9b1515}.severity-major{background:#fff3dc;color:#85520e}.finding-content{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}.finding-content dl{grid-template-columns:1fr}blockquote{margin:0;background:#f6f6f8;border-left:3px solid #b7b7c0;padding:14px 16px}figure{margin:0;border:1px solid var(--line);border-radius:6px;overflow:auto;max-height:800px}figure img{display:block;width:100%;height:auto}figcaption{padding:10px;font-size:12px}.unavailable{padding:18px;background:#f7f7f8;color:var(--muted);border:1px dashed var(--line);border-radius:6px}.category-section{padding:0;background:transparent;border:0}.category-section>h2{padding-top:12px}details summary{cursor:pointer;font-weight:650}footer{font-size:12px;padding:16px 0 32px}nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:18px}
header .badge{color:var(--ink)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media(max-width:700px){header{padding:24px}main{padding:0 12px}.metrics,.category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.finding-content,dl{grid-template-columns:1fr}section,.finding{padding:18px}.category-section{padding:0}.metric strong{font-size:23px}h1{font-size:28px}}
@media print{body{background:#fff;font-size:10pt}header{background:#fff;color:#111;padding:12px 0}header p,header a{color:#111}main{max-width:none;margin:0;padding:0}nav{display:none}section,.finding{border-radius:0;padding:12px}.finding{break-before:auto}h2,h3,h4{break-after:avoid}.finding-content{display:block}figure{max-height:none;overflow:visible;break-inside:avoid}figure img{max-height:230mm;width:auto;max-width:100%;object-fit:contain}.table-wrap{overflow:visible}table{font-size:9pt;table-layout:fixed}th,td{min-width:0}a{text-decoration:none;color:#111}}
</style></head><body>
<header><div class="eyebrow">SKYNET / QA REPORT</div><h1>${run.kind === 'crawl' ? 'Link check results' : 'Audit results'}</h1><p>${link(run.siteUrl ?? run.crawl?.startUrl)}</p><span class="badge">${escape(run.status)}</span><nav><a href="#overview">Overview</a><a href="#findings">Findings</a><a href="#checks">Checks &amp; coverage</a><a href="#reviews">Review history</a></nav></header>
<main><section id="overview"><h2>Run overview</h2>
<div class="metrics"><div class="metric"><strong>${run.issues.length}</strong><span>Findings</span></div><div class="metric"><strong>${successful}</strong><span>Successful pages</span></div><div class="metric"><strong>${embedded} / ${run.issues.length}</strong><span>Findings with embedded screenshots</span></div><div class="metric"><strong>${(run.durationMs / 1000).toFixed(1)}s</strong><span>Run duration</span></div></div>
${incomplete ? '<p class="warning">This run has incomplete coverage. Its findings are retained, but an absence of findings does not mean every check passed.</p>' : ''}
${run.error ? `<p class="warning">${text(run.error)}</p>` : ''}
${fields([['Run ID', run.id], ['Started (UTC)', run.startedAt], ['Finished (UTC)', run.finishedAt || 'Not recorded'], ['Report generated (UTC)', exportedAt],
  ['Target locale', run.targetLocale || 'Not recorded'], ['Model', run.model || (run.kind === 'crawl' ? 'No model calls' : 'Not recorded')], ['Estimated cost', costLabel(cost)],
  ['Review statuses', ['new', 'verified', 'dismissed', 'escalated'].map(status => `${run.issues.filter(issue => issue.status === status).length} ${status}`).join(' · ')]])}
<p class="muted">Review statuses reflect the time of export. Verified confirms a finding, not a fix. Costs use recorded/default rates, not temporary calculator overrides.</p></section>
<section id="findings"><h2>Findings by category</h2><div class="category-grid">${categories.map(category => `<a href="#category-${category}"><span>${escape(labels[category])}</span><strong>${run.issues.filter(issue => issue.category === category).length}</strong></a>`).join('')}</div>${run.issues.length ? '' : '<p>No findings were recorded. Check the run status and coverage below before concluding the site passed.</p>'}</section>
${categories.map(category => `<section class="category-section" id="category-${category}"><h2>${escape(labels[category])}</h2>${run.issues.some(issue => issue.category === category) ? run.issues.map((issue,index) => issue.category === category ? finding(issue,index) : '').join('') : '<p class="muted">No findings recorded in this category.</p>'}</section>`).join('')}
<section id="checks"><h2>Checks &amp; coverage</h2>${workers.length ? table(['Agent', 'Page / scope', 'Status', 'Findings', 'Details', 'Duration & usage'], workers) : '<p>No worker reports were recorded.</p>'}
<h3>Pages and destinations</h3>${run.crawl ? table(['URL', 'HTTP status'], run.crawl.responses.map(response => [link(response.url), escape(response.status)])) : '<p>No crawl results were recorded.</p>'}
${run.crawl?.limitReached ? '<p class="warning">The crawler reached its page limit.</p>' : ''}
${run.crawl?.errors.length ? `<h3>Crawl errors</h3><ul>${run.crawl.errors.map(error => `<li>${link(error.url)} — ${escape(error.message)}</li>`).join('')}</ul>` : ''}
${run.browserCoverage?.length ? `<h3>Browser-state coverage</h3>${table(['Page', 'Status', 'States', 'Limitations'], run.browserCoverage.map(page => [link(page.pageUrl), escape(page.status), escape(page.states), text(page.limitations.join('\n'))]))}` : ''}
${run.workers.some(worker => worker.rules?.length || worker.mediaChecks?.length) ? `<h3>Recorded check details</h3>${run.workers.filter(worker => worker.rules?.length || worker.mediaChecks?.length).map(worker => `<details open><summary>${escape(worker.agent)} — ${link(worker.pageUrl)}</summary>${worker.rules?.length ? `<ul>${worker.rules.map(rule => `<li>${text(`${rule.id}: ${rule.value}`)}</li>`).join('')}</ul>` : ''}${worker.mediaChecks?.length ? table(['Asset', 'Check', 'Status', 'Details'], worker.mediaChecks.map(check => [text(check.asset), escape(check.check), escape(check.status), text(check.message)])) : ''}</details>`).join('')}` : ''}</section>
<section id="reviews"><h2>Review history</h2>${reviewRows.length ? table(['Reviewed (UTC)', 'Finding ID', 'Previous status', 'Status'], reviewRows) : '<p>No review changes were recorded for this run. Carried-forward statuses are shown on the findings.</p>'}</section>
<footer>Skynet · Run ${escape(run.id)} · Standalone report with embedded available screenshots. No connection is required to read this report. Website links open the original site.</footer></main></body></html>`;
}
