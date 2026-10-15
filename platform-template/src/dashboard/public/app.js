import { createActivityView, categoryNames } from './activity.js';
import { createIssuesView } from './issues-view.js';
const $ = selector => document.querySelector(selector);
const auditButton = $('#audit');
const crawlButton = $('#crawl');
const clearButton = $('#clear');
const activity = createActivityView(document);
let crawlRun;
let issues = [];
let auditActive = false;
let reviewBusy = false;
let viewVersion = 0;
let pageTitles = new Map();
const issuesView = createIssuesView(document, async (issue, status) => {
  reviewBusy = true; busy(auditActive); renderIssues();
  try {
    const updated = await api('/api/issues/' + encodeURIComponent(issue.id) + '/status', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
    });
    const current = issues.find(item => item.id === issue.id);
    if (current) current.status = updated.status;
  } finally { reviewBusy = false; busy(auditActive); renderIssues(); }
});
const categories = ['spelling_grammar', 'formatting', 'links', 'locale_rules', 'brand_voice', 'translation_quality', 'terminology', 'media'];
for (const category of categories) {
  const option = document.createElement('option'); option.value = category; option.textContent = categoryNames[category];
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
  crawlRun = undefined; activity.render(null);
  renderPages(null); renderIssues();
}
function crawlSummary(crawl) {
  const successful = crawl.pages.filter(page => page.status >= 200 && page.status < 300).length;
  const broken = crawl.responses.filter(response => response.status >= 400).length;
  return `${successful} successful ${successful === 1 ? 'page' : 'pages'} · ${broken} broken ${broken === 1 ? 'destination' : 'destinations'}`;
}
function renderPages(crawl) {
  pageTitles = new Map((crawl?.pages || []).map(page => [page.url, page.title]));
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
  crawlRun = {
    id: crawlRun?.id || 'restored-crawl', kind: 'crawl', status: partial ? 'partial' : 'completed',
    phase: 'Finished', startedAt: crawlRun?.startedAt, durationMs, crawl, issues,
    workers: [{ id: 'links', agent: 'links', categories: ['links'], status: partial ? 'partial' : 'completed',
      attempts: 1, durationMs, issueCount: issues.length, inputTokens: 0, outputTokens: 0,
      estimatedCostUsd: 0, usageComplete: true,
      message: partial ? 'Some destinations could not be checked. See crawl details.' : 'Checked fetched same-origin destinations for HTTP errors.' }],
  };
  activity.render(crawlRun);
  renderPages(crawl); renderIssues();
}
function renderIssues() {
  issuesView.render(issues, { category: $('#category').value, disabled: auditActive || reviewBusy, pageTitles });
}
function renderAudit(audit) {
  busy(audit.status === 'running');
  activity.render(audit);
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
  busy(true); renderIssues(); $('#message').textContent = '';
  try { renderAudit(await api('/api/audits', { method: 'POST' })); await pollAudit(); }
  catch (error) { $('#message').textContent = error.message; busy(false); await pollAudit(); }
});
crawlButton.addEventListener('click', async () => {
  viewVersion++;
  clearTimeout(pollTimer);
  const started = performance.now();
  busy(true); $('#message').textContent = 'Crawling pages and checking links…';
  crawlButton.textContent = 'Checking links…';
  crawlRun = {
    id: `crawl-${Date.now()}`, kind: 'crawl', status: 'running', phase: 'Crawling pages and checking links',
    startedAt: new Date().toISOString(), issues: [], workers: [{
      id: 'links', agent: 'links', categories: ['links'], status: 'running', attempts: 1,
      durationMs: 0, issueCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, usageComplete: true,
    }],
  };
  activity.render(crawlRun);
  $('#category').value = 'all';
  renderIssues();
  try {
    const crawl = await api('/api/crawl', { method: 'POST' }); issues = crawl.issues;
    renderCrawl(crawl, performance.now() - started);
    $('#message').textContent = `Link check finished: ${issues.length} ${issues.length === 1 ? 'finding' : 'findings'}. See Findings below.`;
  } catch (error) {
    crawlRun.status = 'failed'; crawlRun.error = error.message; crawlRun.durationMs = performance.now() - started;
    crawlRun.workers[0].status = 'failed'; crawlRun.workers[0].message = error.message;
    activity.render(crawlRun);
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
