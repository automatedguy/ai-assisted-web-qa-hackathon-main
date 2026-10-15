const $ = selector => document.querySelector(selector);
const auditButton = $('#audit');
const crawlButton = $('#crawl');
const clearButton = $('#clear');
let issues = [];
let auditActive = false;
let reviewBusy = false;
let viewVersion = 0;
const categories = ['spelling_grammar', 'formatting', 'links', 'locale_rules', 'brand_voice', 'translation_quality', 'terminology', 'media'];
for (const category of categories) {
  const option = document.createElement('option'); option.value = category; option.textContent = category;
  $('#category').append(option);
}
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function busy(value) {
  auditActive = value;
  for (const button of [auditButton, crawlButton, clearButton]) button.disabled = value || reviewBusy;
}
function renderEmpty() {
  issues = [];
  $('#category').value = 'all';
  $('#audit-status').textContent = 'No results. Run an audit or check links to get started.';
  $('#workers').replaceChildren(); $('#coverage').replaceChildren(); $('#usage').textContent = '';
  renderPages(null); renderIssues();
}
function crawlSummary(crawl) {
  const successful = crawl.pages.filter(page => page.status >= 200 && page.status < 300).length;
  const broken = crawl.responses.filter(response => response.status >= 400).length;
  return `${successful} successful ${successful === 1 ? 'page' : 'pages'} · ${broken} broken ${broken === 1 ? 'destination' : 'destinations'}`;
}
function renderPages(crawl) {
  $('#pages').replaceChildren();
  $('#broken-pages').replaceChildren();
  $('#broken-destinations').hidden = true;
  if (!crawl) { $('#crawl-status').textContent = ''; return; }
  $('#crawl-status').textContent = `${crawlSummary(crawl)} · ${crawl.errors.length} crawl failures.` +
    (crawl.limitReached ? ' Page limit reached: coverage is incomplete.' : '');
  const successfulPages = crawl.pages.filter(page => page.status >= 200 && page.status < 300);
  for (const page of successfulPages) {
    const item = document.createElement('li'); const link = document.createElement('a');
    link.href = page.url; link.textContent = page.title || page.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const info = document.createElement('p'); info.className = 'page-info';
    info.textContent = `${page.url} · ${page.links.length} links on this page`;
    item.append(link, info); $('#pages').append(item);
  }
  if (!successfulPages.length) {
    const item = document.createElement('li'); item.textContent = 'No successfully loaded pages yet.';
    $('#pages').append(item);
  }
  const broken = crawl.responses.filter(response => response.status >= 400);
  $('#broken-destinations').hidden = broken.length === 0;
  for (const destination of broken) {
    const item = document.createElement('li'); const link = document.createElement('a');
    link.href = destination.url; link.textContent = destination.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const status = document.createElement('strong'); status.className = 'destination-error';
    status.textContent = destination.status === 404 ? 'Page not found (HTTP 404)' : `HTTP error ${destination.status}`;
    item.append(status, link);
    const sources = successfulPages.filter(page => page.links.some(link => link.href === destination.url));
    if (sources.length) {
      const info = document.createElement('p'); info.className = 'page-info'; info.append('Linked from: ');
      sources.forEach((page, index) => {
        if (index) info.append(', ');
        const source = document.createElement('a'); source.href = page.url; source.textContent = page.title || page.url;
        source.target = '_blank'; source.rel = 'noopener noreferrer'; info.append(source);
      });
      item.append(info);
    }
    $('#broken-pages').append(item);
  }
}
function renderCrawl(crawl, durationMs) {
  const partial = crawl.errors.length > 0 || crawl.limitReached || !crawl.pages.some(page => page.status >= 200 && page.status < 300);
  const duration = durationMs === undefined ? 'Unavailable' : (durationMs / 1000).toFixed(1) + 's';
  $('#audit-status').textContent = `${partial ? 'PARTIAL' : 'COMPLETED'} · Crawl and link check · ${crawlSummary(crawl)} · ${issues.length} link ${issues.length === 1 ? 'finding' : 'findings'}.`;
  $('#workers').replaceChildren();
  const row = document.createElement('tr');
  for (const text of ['links · site', partial ? 'partial' : 'completed', 1, duration, issues.length, '0 / 0',
    'Checked fetched same-origin destinations for HTTP errors.']) {
    const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
  }
  $('#workers').append(row);
  $('#coverage').replaceChildren();
  for (const category of categories) {
    const item = document.createElement('li');
    item.textContent = category + (category === 'links' ? ' — ran' : ' — not run');
    $('#coverage').append(item);
  }
  $('#usage').textContent = 'No model requests · 0 tokens · Cost: $0';
  renderPages(crawl);
  renderIssues();
}
function renderIssues() {
  if (reviewBusy) return;
  $('#issues').replaceChildren();
  const filtered = issues.filter(issue => $('#category').value === 'all' || issue.category === $('#category').value);
  $('#issue-summary').textContent = `${filtered.length} shown / ${issues.length} total findings.`;
  for (const issue of filtered) {
    const item = document.createElement('li'); const heading = document.createElement('strong');
    heading.textContent = `${issue.severity.toUpperCase()} · ${issue.category} · ${issue.description}`; item.append(heading);
    for (const text of [
      'Evidence: ' + issue.evidence, 'Page: ' + issue.location.page_url,
      'Status: ' + issue.status + ' · Confidence: ' + Math.round(issue.confidence * 100) + '%',
      ...(issue.expected ? ['Expected: ' + issue.expected] : []),
      ...(issue.suggested_fix ? ['Suggested fix: ' + issue.suggested_fix] : []),
    ]) {
      const p = document.createElement('p'); p.textContent = text;
      if (text.startsWith('Evidence: ')) p.style.whiteSpace = 'pre-wrap';
      item.append(p);
    }
    for (const [status, label] of [['verified', 'Verify'], ['dismissed', 'Dismiss'], ['escalated', 'Escalate']]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = auditActive || status === issue.status;
      button.addEventListener('click', async () => {
        reviewBusy = true;
        for (const control of $('#issues').querySelectorAll('button')) control.disabled = true;
        busy(auditActive);
        try {
          const updated = await api('/api/issues/' + encodeURIComponent(issue.id) + '/status', {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
          });
          issue.status = updated.status;
        } catch (error) { $('#message').textContent = error.message; }
        finally { reviewBusy = false; busy(auditActive); renderIssues(); }
      });
      item.append(button);
    }
    $('#issues').append(item);
  }
}
function renderAudit(audit) {
  busy(audit.status === 'running');
  const elapsed = audit.status === 'running' ? Date.now() - Date.parse(audit.startedAt) : audit.durationMs;
  $('#audit-status').textContent = `${audit.status.toUpperCase()} · ${audit.phase} · ${(elapsed / 1000).toFixed(1)}s` +
    (audit.targetLocale ? ' · Locale: ' + audit.targetLocale : '') + (audit.error ? ' · ' + audit.error : '');
  $('#coverage').replaceChildren();
  for (const entry of audit.coverage) {
    const item = document.createElement('li'); item.textContent = entry.category + (entry.implemented ? ' — available' : ' — not implemented');
    $('#coverage').append(item);
  }
  $('#workers').replaceChildren();
  for (const worker of audit.workers) {
    const row = document.createElement('tr');
    for (const text of [worker.agent + (worker.pageUrl ? ' · ' + worker.pageUrl : ' · site'), worker.status, worker.attempts,
      (worker.durationMs / 1000).toFixed(1) + 's', worker.issueCount, worker.inputTokens + ' / ' + worker.outputTokens,
      (worker.categories || []).join(', ') + ' · ' + (worker.message || worker.model || 'Deterministic checks')]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    if (worker.mediaChecks?.length) {
      const details = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = 'Media checks'; details.append(summary);
      const list = document.createElement('ul');
      for (const check of worker.mediaChecks) {
        const item = document.createElement('li');
        item.textContent = `${check.check} · ${check.status} · ${check.asset} · ${check.message}`; list.append(item);
      }
      details.append(list); row.lastElementChild.append(details);
    }
    $('#workers').append(row);
  }
  const input = audit.workers.reduce((total, worker) => total + worker.inputTokens, 0);
  const output = audit.workers.reduce((total, worker) => total + worker.outputTokens, 0);
  const knownCost = audit.workers.length && audit.workers.every(worker => worker.estimatedCostUsd !== null);
  const cost = knownCost ? '$' + audit.workers.reduce((sum, worker) => sum + worker.estimatedCostUsd, 0).toFixed(5) : 'unavailable (rates not configured or usage incomplete)';
  $('#usage').textContent = `Reported tokens: ${input} input / ${output} output · Estimated cost: ${cost}` +
    (audit.workers.some(worker => !worker.usageComplete) ? ' · Some requests have unknown usage.' : '');
  renderPages(audit.crawl); issues = audit.issues; renderIssues();
}
let pollTimer;
async function pollAudit() {
  clearTimeout(pollTimer);
  const version = viewVersion;
  try {
    const audit = await api('/api/audits/latest');
    if (version !== viewVersion) return;
    if (audit) { renderAudit(audit); if (audit.status === 'running') pollTimer = setTimeout(pollAudit, 1000); }
    else {
      const loadedIssues = await api('/api/issues');
      const crawl = await api('/api/pages');
      if (version !== viewVersion) return;
      busy(false); issues = loadedIssues;
      if (crawl.responses.length || crawl.errors.length) renderCrawl(crawl);
      else renderEmpty();
    }
  } catch (error) {
    if (version !== viewVersion) return;
    $('#message').textContent = 'Could not refresh audit: ' + error.message;
    if (auditActive) pollTimer = setTimeout(pollAudit, 3000);
  }
}
auditButton.addEventListener('click', async () => {
  viewVersion++; clearTimeout(pollTimer);
  busy(true); $('#message').textContent = '';
  try { renderAudit(await api('/api/audits', { method: 'POST' })); await pollAudit(); }
  catch (error) { $('#message').textContent = error.message; busy(false); await pollAudit(); }
});
crawlButton.addEventListener('click', async () => {
  viewVersion++;
  clearTimeout(pollTimer);
  const started = performance.now();
  busy(true); $('#message').textContent = 'Crawling pages and checking links…';
  crawlButton.textContent = 'Checking links…';
  $('#audit-status').textContent = 'RUNNING · Crawling pages and checking links…';
  $('#workers').replaceChildren(); $('#coverage').replaceChildren(); $('#usage').textContent = '';
  $('#category').value = 'all';
  renderIssues();
  try {
    const crawl = await api('/api/crawl', { method: 'POST' }); issues = crawl.issues;
    renderCrawl(crawl, performance.now() - started);
    $('#message').textContent = `Link check finished: ${issues.length} ${issues.length === 1 ? 'finding' : 'findings'}. See Findings below.`;
  } catch (error) {
    $('#audit-status').textContent = 'FAILED · Crawl and link check';
    $('#message').textContent = error.message;
  } finally { crawlButton.textContent = 'Crawl and check links only'; busy(false); renderIssues(); }
});
clearButton.addEventListener('click', async () => {
  viewVersion++; clearTimeout(pollTimer);
  busy(true); renderIssues(); clearButton.textContent = 'Clearing…';
  $('#message').textContent = '';
  try {
    await api('/api/results', { method: 'DELETE' });
    busy(false); renderEmpty();
    $('#message').textContent = 'Results and review decisions cleared.';
  } catch (error) {
    $('#message').textContent = 'Could not clear results: ' + error.message;
    busy(false); await pollAudit();
  } finally { clearButton.textContent = 'Clear results'; renderIssues(); }
});
$('#category').addEventListener('change', renderIssues);
$('#test').addEventListener('click', async () => {
  $('#test').disabled = true; $('#result').textContent = 'Contacting OpenAI…';
  try { $('#result').textContent = (await api('/api/test-model', { method: 'POST' })).message; }
  catch (error) { $('#result').textContent = error.message; }
  finally { $('#test').disabled = false; }
});
api('/api/health').then(data => {
  $('#status').textContent = 'Server ready · ' + (data.apiKeyConfigured ? 'API key configured' : 'API key missing') + ' · Model: ' + data.model;
}).catch(error => { $('#status').textContent = error.message; });
void pollAudit();
