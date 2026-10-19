import { agentCatalog, createAgentCards, needsAttention } from './activity-cards.js';
import { createCostView } from './cost-view.js';

export const categoryNames = {
  spelling_grammar: 'Spelling and grammar', formatting: 'Formatting', links: 'Links',
  locale_rules: 'Locale rules', brand_voice: 'Brand voice', translation_quality: 'Translation quality',
  terminology: 'Terminology', media: 'Media',
};
const agentNames = {
  'spelling-grammar': 'Spelling & Grammar', language: 'Spelling & Grammar', links: 'Links', locale: 'Locale', formatting: 'Formatting',
  'brand-voice': 'Brand voice', terminology: 'Terminology', 'translation-quality': 'Translation quality', media: 'Media',
};
const count = (number, noun) => `${number} ${number === 1 ? noun : noun === 'category' ? 'categories' : noun + 's'}`;
const nameOf = worker => agentNames[worker.agent] || worker.agent;
const pageOf = worker => {
  if (!worker.pageUrl) return 'the site';
  try { const url = new URL(worker.pageUrl); return url.pathname === '/' ? 'the home page' : url.pathname + url.search; }
  catch { return worker.pageUrl; }
};
const seconds = value => Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : 'Unavailable';
// Only the explicit no-media result is inapplicable. Missing configuration,
// unsupported resources, and other skipped work must remain visible as such.
const displayStatus = worker => worker.status === 'skipped' && worker.agent === 'media' &&
  worker.message === 'No image or video elements found.' ? 'not applicable' : worker.status;

export function workerActivity(worker) {
  const subject = `${nameOf(worker)} · ${pageOf(worker)}`;
  if (worker.status === 'queued') return `${subject}: waiting to start.`;
  const requestAttempt = worker.requestAttempt ?? worker.attempts;
  if (worker.status === 'running') return `${subject}: reviewing${requestAttempt > 1 ? ` (attempt ${requestAttempt})` : ''}.`;
  if (displayStatus(worker) === 'not applicable') return `${subject}: not applicable — no images or videos on this page.`;
  if (worker.status === 'skipped') return `${subject}: skipped. ${worker.message || 'This check did not run.'}`;
  if (worker.status === 'failed' || worker.status === 'partial') {
    return `${subject}: ${worker.status === 'partial' ? 'incomplete' : 'needs attention'}. ${worker.message || 'The check could not finish.'}` +
      (worker.issueCount ? ` ${count(worker.issueCount, 'finding')} retained.` : '');
  }
  return `${subject}: finished with ${count(worker.issueCount, 'finding')}.`;
}

// Derive coverage from execution reports, rather than treating implementation as execution.
export function activitySummary(run) {
  if (!run) return { status: 'Ready to check your site', detail: 'Run an audit or check links to get started.', attention: '', tone: 'idle', coverage: [] };
  const workers = run.workers || [];
  const active = workers.filter(worker => worker.status === 'running').length;
  const failed = workers.filter(worker => ['failed', 'partial'].includes(worker.status)).length;
  const skipped = workers.filter(worker => displayStatus(worker) === 'skipped').length;
  const notApplicable = workers.filter(worker => displayStatus(worker) === 'not applicable');
  const running = run.status === 'running';
  const linksOnly = run.kind === 'crawl';
  const coverage = Object.entries(categoryNames).map(([category, label]) => {
    const applicable = workers.filter(worker => worker.categories.includes(category));
    const counts = ['completed', 'running', 'queued', 'failed', 'partial', 'skipped', 'not applicable']
      .map(status => ({ status, total: applicable.filter(worker => displayStatus(worker) === status).length }))
      .filter(entry => entry.total);
    const unavailable = run.coverage?.some(entry => entry.category === category && !entry.implemented);
    return { category, label, text: counts.length ? counts.map(entry => `${entry.total} ${entry.status}`).join(' · ') :
      unavailable ? 'Unavailable' : (running && !linksOnly ? 'Waiting for dispatch' : 'Not run') };
  });
  const unrun = coverage.filter(entry => entry.text === 'Unavailable' || (!running && entry.text === 'Not run')).length;
  const warnings = [];
  if (failed) warnings.push(`${count(failed, 'check')} need${failed === 1 ? 's' : ''} attention`);
  if (skipped) warnings.push(`${count(skipped, 'check')} skipped`);
  if (unrun) warnings.push(`${count(unrun, 'category')} not run`);
  if (run.crawl?.errors.length || run.crawl?.limitReached || (run.status === 'partial' && !failed)) warnings.push('Crawl or check coverage incomplete');
  if (run.status === 'failed') warnings.unshift('Run failed');
  if (run.browserCoverage?.some(entry => entry.status !== 'completed')) warnings.push('Browser-state coverage incomplete or disabled');
  const title = linksOnly ? 'Link check' : 'Audit';
  const state = running ? 'running' : run.status === 'completed' ? 'complete' : run.status === 'failed' ? 'failed' : 'finished with incomplete checks';
  return {
    status: `${title} ${state} · ${running ? `${count(active, 'check')} active · ` : ''}${count(run.issues.length, 'finding')}`,
    detail: run.error || (running ? run.phase : linksOnly ? 'Checked fetched destinations within this site.' : 'Review the findings below.'),
    attention: warnings.join(' · '), coverage,
    note: notApplicable.length ? `${count(notApplicable.length, 'check')} not applicable` +
      (notApplicable.length === 1 ? ` · ${pageOf(notApplicable[0])}: no images or videos.` : ' · No images or videos on these pages. See activity for details.') : '',
    tone: failed || ['failed', 'partial'].includes(run.status) ? 'warning' : running ? 'running' : 'complete',
  };
}

export function createActivityView(document, onViewFindings = () => {}) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#activity-panel');
  const trigger = $('#view-activity');
  trigger.addEventListener('click', () => { panel.showModal(); trigger.setAttribute('aria-expanded', 'true'); });
  $('#close-activity').addEventListener('click', () => panel.close());
  let selectedFindings;
  panel.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (selectedFindings) { const category = selectedFindings; selectedFindings = undefined; onViewFindings(category); }
    else trigger.focus();
  });
  const cards = createAgentCards(document, category => { selectedFindings = category; panel.close(); });
  let latestRun;
  const costs = createCostView(document, () => cards.render(latestRun, costs.overrides()));
  let currentId;
  let previousWorkers = new Map();
  let previousPhase;
  let previousStatus;
  let events = [];
  const setText = (selector, text) => { if ($(selector).textContent !== text) $(selector).textContent = text; };
  const event = (text, worker, attention = false) => events.push({ text, categories: worker?.categories || [],
    attention: attention || Boolean(worker && needsAttention(worker)),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  for (const agent of agentCatalog) {
    const option = document.createElement('option'); option.value = agent.category; option.textContent = agent.name;
    $('#timeline-agent').append(option);
  }
  // Keep disclosure controls and the panel scroll position stable during polling.
  const updateList = (selector, lines) => {
    const list = $(selector);
    lines.forEach((text, index) => {
      let item = list.children[index];
      if (!item) { item = document.createElement('li'); list.append(item); }
      if (item.textContent !== text) item.textContent = text;
    });
    while (list.children.length > lines.length) list.lastElementChild.remove();
  };
  const renderTimeline = () => {
    const category = $('#timeline-agent').value;
    const attentionOnly = $('#timeline-kind').value === 'attention';
    const visible = events.filter(entry => (category === 'all' || entry.categories.includes(category)) && (!attentionOnly || entry.attention));
    updateList('#activity-events', visible.map(entry => `${entry.time} — ${entry.text}`));
    $('#events-empty').hidden = visible.length > 0;
    setText('#events-empty', events.length ? 'No updates match these filters.' : 'No activity yet.');
    $('#timeline-latest').disabled = !visible.length;
  };
  $('#timeline-agent').addEventListener('change', renderTimeline);
  $('#timeline-kind').addEventListener('change', renderTimeline);
  $('#timeline-latest').addEventListener('click', () => {
    const last = $('#activity-events').lastElementChild;
    if (last) { last.tabIndex = -1; last.focus({ preventScroll: true }); last.scrollIntoView({ block: 'nearest' }); }
  });
  return {
    render(run) {
      latestRun = run;
      const summary = activitySummary(run);
      $('#activity-bar').dataset.state = summary.tone;
      setText('#activity-status', summary.status); setText('#activity-detail', summary.detail);
      setText('#activity-attention', summary.attention); $('#activity-attention').hidden = !summary.attention;
      setText('#activity-note', summary.note || ''); $('#activity-note').hidden = !summary.note;
      setText('#panel-status', summary.status);
      const duration = run?.status === 'running' ? Date.now() - Date.parse(run.startedAt) : run?.durationMs;
      setText('#activity-duration', Number.isFinite(duration) ? seconds(duration) : '');
      if (currentId !== run?.id || !run) {
        currentId = run?.id; previousWorkers = new Map(); previousPhase = undefined; previousStatus = undefined; events = [];
        cards.reset();
        $('#timeline-agent').value = 'all'; $('#timeline-kind').value = 'all';
      }
      if (run) {
        if (run.phase !== previousPhase && run.status === 'running') event(run.phase + '.');
        for (const worker of run.workers) {
          const fingerprint = `${worker.status}:${worker.attempts}:${worker.stage || ''}:${worker.message || ''}`;
          if (previousWorkers.get(worker.id) !== fingerprint && worker.status !== 'queued') {
            event(workerActivity(worker) + (worker.status === 'running' && worker.stage ? ' ' + worker.stage + '.' : ''), worker);
          }
          previousWorkers.set(worker.id, fingerprint);
        }
        if (run.status !== previousStatus && run.status !== 'running') event(summary.status + (summary.attention ? '. ' + summary.attention : '') + (summary.note ? '. ' + summary.note : ''), undefined, Boolean(summary.attention));
        previousPhase = run.phase; previousStatus = run.status;
      }
      events = events.slice(-60);
      // Oldest first; new updates append without moving the reader's scroll position.
      renderTimeline();
      const workers = run?.workers || [];
      costs.render(run);
      cards.render(run, costs.overrides());
      $('#agents-empty').hidden = workers.length > 0;
      const completed = workers.filter(w => w.status === 'completed').length;
      const loadedPages = run?.crawl?.pages.filter(page => page.status >= 200 && page.status < 300).length || 0;
      setText('#panel-metrics', run ? `${count(loadedPages, 'page')} loaded · ${completed}/${workers.length} checks completed · ${seconds(duration)}` : '');
      setText('#panel-phase', run?.status === 'running' ? run.phase : run?.targetLocale ? 'Target locale: ' + run.targetLocale : '');
      const attention = workers.filter(needsAttention).map(w => workerActivity(w));
      if (run?.error) attention.unshift(run.error);
      if (run?.crawl?.errors.length) attention.push(...run.crawl.errors.map(error => 'Crawl: ' + error.url + ' · ' + error.message));
      if (run?.crawl?.limitReached) attention.push('Crawl limit reached. Some pages were not checked.');
      for (const entry of run?.browserCoverage || []) if (entry.status !== 'completed') attention.push('Browser coverage · ' + entry.pageUrl + ': ' + entry.limitations.join(' '));
      if (summary.attention && !attention.length) attention.push(summary.attention);
      updateList('#panel-attention-items', attention);
      $('#panel-attention').hidden = !attention.length;
      updateList('#activity-coverage', summary.coverage.map(entry => `${entry.label} — ${entry.text}`));
      updateList('#activity-browser-coverage', (run?.browserCoverage || []).map(entry => `${entry.pageUrl} · ${entry.states} states captured · ${entry.status}\n${entry.limitations.join(' ')}`));
    },
  };
}
