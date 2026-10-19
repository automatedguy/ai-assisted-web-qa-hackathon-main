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
  if (worker.status === 'running') return `${subject}: reviewing${worker.attempts > 1 ? ` (attempt ${worker.attempts})` : ''}.`;
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

export function createActivityView(document) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#activity-panel');
  const trigger = $('#view-activity');
  trigger.addEventListener('click', () => { panel.showModal(); trigger.setAttribute('aria-expanded', 'true'); });
  $('#close-activity').addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => { trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); });
  let currentId;
  let previousWorkers = new Map();
  let previousPhase;
  let previousStatus;
  let events = [];
  const setText = (selector, text) => { if ($(selector).textContent !== text) $(selector).textContent = text; };
  const event = text => events.push({ text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
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
  return {
    render(run) {
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
      }
      if (run) {
        if (run.phase !== previousPhase && run.status === 'running') event(run.phase + '.');
        for (const worker of run.workers) {
          const fingerprint = `${worker.status}:${worker.attempts}:${worker.message || ''}`;
          if (previousWorkers.get(worker.id) !== fingerprint && worker.status !== 'queued') event(workerActivity(worker));
          previousWorkers.set(worker.id, fingerprint);
        }
        if (run.status !== previousStatus && run.status !== 'running') event(summary.status + (summary.attention ? '. ' + summary.attention : '') + (summary.note ? '. ' + summary.note : ''));
        previousPhase = run.phase; previousStatus = run.status;
      }
      events = events.slice(-60);
      // Oldest first; new updates append without moving the reader's scroll position.
      updateList('#activity-events', events.map(entry => `${entry.time} — ${entry.text}`));
      $('#events-empty').hidden = events.length > 0;
      const workers = run?.workers || [];
      const agents = [...new Set(workers.map(worker => worker.agent))];
      updateList('#agent-activity', agents.map(agent => {
        const reports = workers.filter(worker => worker.agent === agent);
        const counts = ['running', 'queued', 'completed', 'failed', 'partial', 'skipped', 'not applicable'].map(status => {
          const total = reports.filter(worker => displayStatus(worker) === status).length;
          return total ? `${total} ${status === 'queued' ? 'waiting' : status === 'partial' ? 'incomplete' : status}` : '';
        }).filter(Boolean);
        const active = reports.filter(worker => worker.status === 'running').map(pageOf);
        return `${nameOf(reports[0])} — ${counts.join(' · ')}${active.length ? '\nReviewing ' + active.join(', ') : ''}`;
      }));
      $('#agents-empty').hidden = agents.length > 0;
      updateList('#activity-coverage', summary.coverage.map(entry => `${entry.label} — ${entry.text}`));
      const input = workers.reduce((sum, worker) => sum + worker.inputTokens, 0);
      const output = workers.reduce((sum, worker) => sum + worker.outputTokens, 0);
      const known = workers.length && workers.every(worker => worker.estimatedCostUsd !== null && worker.usageComplete);
      const cost = known ? '$' + workers.reduce((sum, worker) => sum + worker.estimatedCostUsd, 0).toFixed(5) : 'unavailable';
      setText('#activity-usage', run ? `Reported tokens: ${input} input / ${output} output · Estimated cost: ${cost}` +
        (workers.some(worker => !worker.usageComplete) ? ' · Some usage is unknown.' : '') : 'No usage yet.');
      const technical = workers.map(worker => `${nameOf(worker)} · ${worker.pageUrl || 'site'}\n` +
        `${displayStatus(worker)} · ${count(worker.attempts, 'attempt')} · Duration: ${seconds(worker.durationMs)} · ${count(worker.issueCount, 'finding')}\n` +
        `Tokens: ${worker.inputTokens} in / ${worker.outputTokens} out · ${worker.model || 'No model reported'}\n` +
        (worker.message || '') + (worker.mediaChecks?.length ? '\n' + worker.mediaChecks.map(check => `${check.check} · ${check.status} · ${check.asset} · ${check.message}`).join('\n') : ''));
      if (run?.error) technical.unshift(run.error);
      if (run?.crawl) technical.push(...run.crawl.errors.map(error => `Crawl failed: ${error.url} · ${error.message}`));
      updateList('#activity-technical', technical);
    },
  };
}
