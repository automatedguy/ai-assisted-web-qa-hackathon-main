const $ = selector => document.querySelector(selector);
const auditButton = $('#audit');
const crawlButton = $('#crawl');
let issues = [];
let auditActive = false;
let reviewBusy = false;
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
function busy(value) { auditActive = value; auditButton.disabled = value; crawlButton.disabled = value; }
function renderPages(crawl) {
  $('#pages').replaceChildren();
  if (!crawl) { $('#crawl-status').textContent = ''; return; }
  const failed = crawl.responses.filter(item => item.status < 200 || item.status >= 400).length;
  $('#crawl-status').textContent = `${crawl.pages.length} HTML pages crawled; ${failed} unsuccessful HTTP responses; ${crawl.errors.length} crawl failures.` +
    (crawl.limitReached ? ' Page limit reached: coverage is incomplete.' : '');
  for (const page of crawl.pages) {
    const item = document.createElement('li'); const link = document.createElement('a');
    link.href = page.url; link.textContent = page.title || page.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    item.append(link, ` — HTTP ${page.status}, ${page.links.length} links`); $('#pages').append(item);
  }
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
    ]) { const p = document.createElement('p'); p.textContent = text; item.append(p); }
    for (const [status, label] of [['verified', 'Verify'], ['dismissed', 'Dismiss'], ['escalated', 'Escalate']]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = auditActive || status === issue.status;
      button.addEventListener('click', async () => {
        reviewBusy = true;
        for (const control of $('#issues').querySelectorAll('button')) control.disabled = true;
        auditButton.disabled = true; crawlButton.disabled = true;
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
  try {
    const audit = await api('/api/audits/latest');
    if (audit) { renderAudit(audit); if (audit.status === 'running') pollTimer = setTimeout(pollAudit, 1000); }
    else {
      busy(false); $('#audit-status').textContent = 'No audit in this server session.';
      issues = await api('/api/issues'); renderIssues(); renderPages(await api('/api/pages'));
    }
  } catch (error) {
    $('#message').textContent = 'Could not refresh audit: ' + error.message;
    if (auditActive) pollTimer = setTimeout(pollAudit, 3000);
  }
}
auditButton.addEventListener('click', async () => {
  busy(true); $('#message').textContent = '';
  try { renderAudit(await api('/api/audits', { method: 'POST' })); await pollAudit(); }
  catch (error) { $('#message').textContent = error.message; busy(false); await pollAudit(); }
});
crawlButton.addEventListener('click', async () => {
  busy(true); $('#message').textContent = 'Crawling pages and checking links…';
  try {
    const crawl = await api('/api/crawl', { method: 'POST' }); renderPages(crawl); issues = crawl.issues;
    $('#audit-status').textContent = 'Crawl and links only. Language and Locale/Formatting agents were not run.';
    $('#workers').replaceChildren(); $('#coverage').replaceChildren(); $('#usage').textContent = '';
    $('#message').textContent = '';
  } catch (error) { $('#message').textContent = error.message; }
  finally { busy(false); renderIssues(); }
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
