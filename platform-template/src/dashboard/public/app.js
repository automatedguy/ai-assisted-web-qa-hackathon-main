import { createActivityView, categoryNames } from './activity.js';
import { createIssuesView } from './issues-view.js';
import { createHistoryView } from './history-view.js';
const $ = selector => document.querySelector(selector);
const auditButton = $('#audit');
const crawlButton = $('#crawl');
const clearButton = $('#clear');
const activity = createActivityView(document, category => {
  showCategory(category);
  $('#issues-heading').setAttribute('tabindex', '-1');
  $('#issues-heading').focus({ preventScroll: true });
});
let crawlRun;
let issues = [];
let auditActive = false;
let reviewBusy = false;
let viewVersion = 0;
let pageTitles = new Map();
let selectedCategory = 'all';
let selectedRunId = null;
let displayedRun = null;
let serverActive = false;
let operationBusy = false;
let selectionLoading = false;
const history = createHistoryView(document, api, id => {
  selectedRunId = id; viewVersion++; clearTimeout(pollTimer);
  selectionLoading = true; busy(auditActive); renderIssues();
  selectedCategory = 'all'; void pollAudit();
});
const issuesView = createIssuesView(document, async (issue, status) => {
  reviewBusy = true; busy(auditActive); renderIssues();
  try {
    const path = displayedRun ? `/api/audits/${encodeURIComponent(displayedRun.id)}/issues/` : '/api/issues/';
    const updated = await api(path + encodeURIComponent(issue.id) + '/status', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
    });
    const current = issues.find(item => item.id === issue.id);
    if (current) current.status = updated.status;
  } finally { reviewBusy = false; busy(auditActive); renderIssues(); }
});
const categories = ['spelling_grammar', 'formatting', 'links', 'locale_rules', 'brand_voice', 'translation_quality', 'terminology', 'media'];
const severityOrder = ['critical', 'major', 'minor', 'suggestion'];
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function busy(value) {
  auditActive = value;
  for (const button of [auditButton, crawlButton, clearButton]) button.disabled = value || reviewBusy || selectionLoading;
  // Clearing always targets the current workspace, never an archived run.
  clearButton.disabled ||= Boolean(selectedRunId);
  history.setBusy(reviewBusy || operationBusy || selectionLoading);
}
function renderEmpty() {
  displayedRun = null; history.render(null, selectedRunId);
  issues = [];
  selectedCategory = 'all';
  crawlRun = undefined; activity.render(null);
  renderPages(null); renderCategoryCards(); renderIssues();
}
function renderCategoryCards() {
  const cards = $('#category-cards'); cards.replaceChildren();
  const total = issues.length;
  $('#category-summary').textContent = total ? `${total} total ${total === 1 ? 'finding' : 'findings'} across ${categories.length} categories.` : 'Run an audit to see findings by category.';
  for (const category of categories) {
    const categoryIssues = issues.filter(issue => issue.category === category);
    const card = document.createElement('button'); card.type = 'button'; card.className = 'category-card';
    card.dataset.category = category; card.classList.toggle('category-card-active', selectedCategory === category);
    const title = document.createElement('strong'); title.textContent = categoryNames[category] || category;
    const count = document.createElement('span'); count.className = 'category-card-count'; count.textContent = String(categoryIssues.length);
    const label = document.createElement('span'); label.className = 'category-card-label'; label.textContent = categoryIssues.length === 1 ? 'finding' : 'findings';
    const breakdown = document.createElement('span'); breakdown.className = 'category-card-breakdown';
    const severityCounts = severityOrder.map(severity => `${categoryIssues.filter(issue => issue.severity === severity).length} ${severity}`).filter(value => !value.startsWith('0 '));
    breakdown.textContent = severityCounts.length ? severityCounts.join(' · ') : 'No findings';
    card.append(title, count, label, breakdown);
    card.addEventListener('click', () => showCategory(category));
    cards.append(card);
  }
}
function showCategory(category) {
  selectedCategory = category;
  renderCategoryCards(); renderIssues();
  $('#findings-detail').hidden = false;
  $('#findings-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  renderPages(crawl); renderCategoryCards(); renderIssues();
}
function renderIssues() {
  $('#findings-detail').hidden = selectedCategory === 'all' || issues.length === 0;
  $('#issues-heading').textContent = selectedCategory === 'all' ? 'All findings' : `${categoryNames[selectedCategory] || selectedCategory} findings`;
  issuesView.render(issues, { category: selectedCategory, disabled: auditActive || reviewBusy || selectionLoading, pageTitles });
}
function renderAudit(audit) {
  displayedRun = audit;
  busy(serverActive || audit.status === 'running');
  history.render(audit, selectedRunId);
  activity.render(audit);
  renderPages(audit.crawl); issues = audit.issues; renderCategoryCards(); renderIssues();
}
let pollTimer;
async function pollAudit() {
  clearTimeout(pollTimer);
  const version = viewVersion;
  try {
    const data = await history.refresh();
    if (version !== viewVersion) return;
    if (data) serverActive = Boolean(data.activeRunId);
    const audit = await api(selectedRunId ? '/api/audits/' + encodeURIComponent(selectedRunId) : '/api/audits/latest');
    if (version !== viewVersion) return;
    if (audit) { renderAudit(audit); if (serverActive || audit.status === 'running') pollTimer = setTimeout(pollAudit, 1000); }
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
  } finally {
    if (version === viewVersion) { selectionLoading = false; busy(auditActive); renderIssues(); }
  }
}
auditButton.addEventListener('click', async () => {
  viewVersion++; clearTimeout(pollTimer);
  operationBusy = true; selectedRunId = null;
  busy(true); renderIssues(); $('#message').textContent = '';
  try { renderAudit(await api('/api/audits', { method: 'POST' })); await pollAudit(); }
  catch (error) { $('#message').textContent = error.message; busy(false); await pollAudit(); }
  finally { operationBusy = false; busy(auditActive); }
});
crawlButton.addEventListener('click', async () => {
  viewVersion++;
  clearTimeout(pollTimer);
  operationBusy = true; selectedRunId = null;
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
  selectedCategory = 'all';
  renderCategoryCards();
  renderIssues();
  try {
    const crawl = await api('/api/crawl', { method: 'POST' }); issues = crawl.issues;
    await pollAudit();
    $('#message').textContent = `Link check finished: ${issues.length} ${issues.length === 1 ? 'finding' : 'findings'}. See Findings below.`;
  } catch (error) {
    crawlRun.status = 'failed'; crawlRun.error = error.message; crawlRun.durationMs = performance.now() - started;
    crawlRun.workers[0].status = 'failed'; crawlRun.workers[0].message = error.message;
    activity.render(crawlRun);
    $('#message').textContent = error.message;
  } finally { operationBusy = false; crawlButton.textContent = 'Crawl and check links only'; busy(false); renderIssues(); await pollAudit(); }
});
clearButton.addEventListener('click', async () => {
  viewVersion++; clearTimeout(pollTimer);
  operationBusy = true;
  busy(true); renderIssues(); clearButton.textContent = 'Clearing…';
  $('#message').textContent = '';
  try {
    const result = await api('/api/results', { method: 'DELETE' });
    selectedRunId = null; serverActive = false;
    busy(false); renderEmpty();
    $('#message').textContent = result.message || 'Workspace cleared. Saved history retained.';
    await history.refresh();
  } catch (error) {
    $('#message').textContent = 'Could not clear results: ' + error.message;
    busy(false); await pollAudit();
  } finally { operationBusy = false; clearButton.textContent = 'Clear workspace'; busy(auditActive); renderIssues(); }
});
$('#back-to-categories').addEventListener('click', () => {
  selectedCategory = 'all'; renderCategoryCards(); renderIssues();
  $('#category-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
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
