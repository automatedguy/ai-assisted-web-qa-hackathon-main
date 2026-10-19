export const agentCatalog = [
  { id: 'spelling-grammar', category: 'spelling_grammar', name: 'Spelling & Grammar',
    scope: 'Spelling, punctuation and grammatical agreement in the target locale.', limit: 'Model judgments require human review.' },
  { id: 'formatting', category: 'formatting', name: 'Formatting',
    scope: 'Dates, numbers, currency notation and configured capitalization rules.', limit: 'Checks extracted text; does not validate CSS or page layout.' },
  { id: 'links', category: 'links', name: 'Links',
    scope: 'HTTP errors at fetched destinations within the site.', limit: 'External links, destination meaning and unvisited URLs are not checked.' },
  { id: 'locale', category: 'locale_rules', name: 'Locale',
    scope: 'Configured currency, measurement, address and phone conventions.', limit: 'Optional policies must be supplied in the profile.' },
  { id: 'brand-voice', category: 'brand_voice', name: 'Brand Voice',
    scope: 'Configured tone, style and brand-only forbidden terms.', limit: 'Tone is contextual; review the cited rule and evidence.' },
  { id: 'translation-quality', category: 'translation_quality', name: 'Translation Quality',
    scope: 'Meaning changes, omissions and additions against mapped reference content.', limit: 'Unmapped pages are skipped. Source and target quotes are shown together.' },
  { id: 'terminology', category: 'terminology', name: 'Terminology',
    scope: 'Protected names, banned terms and preferred glossary equivalents.', limit: 'Context determines whether a glossary entry applies.' },
  { id: 'media', category: 'media', name: 'Media',
    scope: 'Resource availability, alt text, image content and caption language.', limit: 'Video playback, audio and caption synchronization are not inspected.' },
];

export const methodNames = {
  deterministic: 'Deterministic check', model_text: 'Model text review',
  model_visual: 'Model visual observation — review required',
};
export const isNotApplicable = worker => worker.agent === 'media' && worker.status === 'skipped' &&
  worker.message === 'No image or video elements found.';
export const needsAttention = worker => ['failed', 'partial'].includes(worker.status) ||
  (worker.status === 'skipped' && !isNotApplicable(worker));

export function agentCardData(run, agent) {
  const workers = (run?.workers || []).filter(worker => worker.categories.includes(agent.category));
  const findings = (run?.issues || []).filter(issue => issue.category === agent.category);
  const completed = workers.filter(worker => worker.status === 'completed').length;
  const failed = workers.filter(worker => ['failed', 'partial'].includes(worker.status)).length;
  const skipped = workers.filter(worker => worker.status === 'skipped' && !isNotApplicable(worker)).length;
  const active = workers.filter(worker => worker.status === 'running');
  const waiting = workers.filter(worker => worker.status === 'queued').length;
  const notApplicable = workers.filter(isNotApplicable).length;
  const state = failed ? 'Needs attention' : active.length ? 'Running' : waiting ? 'Waiting' :
    skipped ? 'Skipped checks' : completed ? 'Completed' : notApplicable ? 'Not applicable' :
      run?.status === 'running' && run.kind !== 'crawl' ? 'Waiting for dispatch' : 'Not run';
  return { workers, findings, completed, failed, skipped, active, waiting, notApplicable, state };
}

export function createAgentCards(document, onViewFindings) {
  const list = document.querySelector('#agent-activity');
  const cards = new Map();
  const node = (tag, className, text) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const set = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  const path = worker => {
    if (!worker.pageUrl) return 'Whole site';
    try { const url = new URL(worker.pageUrl); return url.pathname + url.search; } catch { return worker.pageUrl; }
  };
  const duration = ms => Number.isFinite(ms) ? (ms / 1000).toFixed(1) + 's' : 'Unavailable';
  const count = (value, noun) => value + ' ' + noun + (value === 1 ? '' : 's');
  function disclosure(label, className = '') {
    const details = node('details', className);
    details.append(node('summary', '', label));
    return details;
  }
  function create(agent) {
    const item = node('li', 'agent-card');
    const details = disclosure('', 'agent-card-disclosure');
    const summary = details.firstElementChild;
    const name = node('strong', '', agent.name);
    const badge = node('span', 'agent-badge');
    const progress = node('span', 'agent-progress');
    summary.append(name, badge, progress);
    const body = node('div', 'agent-card-body');
    body.append(node('p', 'agent-scope', agent.scope));
    const active = node('p', 'agent-current');
    const pages = node('ul', 'agent-pages');
    pages.setAttribute('aria-label', agent.name + ' page checks');
    const rules = disclosure('Configured rules for this run', 'agent-subsection');
    const ruleText = node('p', 'agent-rule-text');
    rules.append(ruleText);
    const findings = disclosure('Why this was flagged', 'agent-subsection');
    const explanations = node('div', 'agent-explanations');
    findings.append(node('p', 'activity-muted', 'Evidence and decision summaries from the checks. Model findings still need human review.'), explanations);
    const view = node('button', 'agent-view-findings', 'View findings');
    view.type = 'button';
    view.addEventListener('click', () => onViewFindings(agent.category));
    const diagnostics = disclosure('Diagnostics', 'agent-subsection');
    const diagnosticText = node('p', 'agent-diagnostics');
    diagnostics.append(diagnosticText);
    body.append(active, pages, rules, findings, view, node('p', 'activity-muted', agent.limit), diagnostics);
    details.append(body); item.append(details); list.append(item);
    return { item, details, badge, progress, active, pages, pageNodes: new Map(), rules, ruleText,
      findings, explanations, findingNodes: new Map(), view, diagnosticText };
  }
  function renderFinding(card, issue) {
    let entry = card.findingNodes.get(issue.id);
    if (!entry) {
      const details = disclosure('', 'agent-finding');
      const fields = node('dl', 'agent-evidence');
      const values = {};
      for (const label of ['Method', 'Rule', 'Page', 'Observed', 'Explanation', 'Expected', 'Suggested fix']) {
        const group = node('div');
        const value = node('dd');
        group.append(node('dt', '', label), value); fields.append(group);
        values[label] = { group, value };
      }
      details.append(fields); card.explanations.append(details);
      entry = { details, values }; card.findingNodes.set(issue.id, entry);
    }
    set(entry.details.firstElementChild, issue.severity + ' · ' + issue.description);
    const rule = issue.assessment?.rule;
    const values = {
      Method: methodNames[issue.assessment?.method] || 'Not recorded for this finding',
      Rule: rule ? rule.id + ': ' + rule.value : undefined,
      Page: path({ pageUrl: issue.location.page_url }), Observed: issue.evidence,
      Explanation: issue.description, Expected: issue.expected, 'Suggested fix': issue.suggested_fix,
    };
    for (const [label, value] of Object.entries(values)) {
      entry.values[label].group.hidden = !value;
      set(entry.values[label].value, value || '');
    }
  }
  return {
    reset() { cards.clear(); list.replaceChildren(); },
    render(run) {
      for (const agent of agentCatalog) {
        let card = cards.get(agent.id);
        if (!card) { card = create(agent); cards.set(agent.id, card); }
        const data = agentCardData(run, agent);
        set(card.badge, data.state);
        card.badge.dataset.state = data.failed || data.skipped ? 'attention' : data.active.length ? 'running' :
          data.completed ? 'complete' : 'neutral';
        const unit = agent.id === 'links' ? 'site checks' : 'page checks';
        const counts = [data.completed + '/' + data.workers.length + ' ' + unit + ' completed',
          count(data.findings.length, 'finding'), duration(data.workers.reduce((sum, w) => sum + (w.durationMs || 0), 0)) + ' worker time'];
        if (data.failed) counts.push(data.failed + ' failed');
        if (data.skipped) counts.push(data.skipped + ' skipped');
        if (data.notApplicable) counts.push(data.notApplicable + ' not applicable');
        set(card.progress, data.workers.length ? counts.join(' · ') : 'No checks have run.');
        set(card.active, data.active.map(w => path(w) + ' · ' + (w.stage || 'Reviewing page') +
          (w.attempts > 1 ? ' · attempt ' + w.attempts : '')).join('\n'));
        card.active.hidden = !data.active.length;
        const workerIds = new Set(data.workers.map(w => w.id));
        for (const [id, item] of card.pageNodes) if (!workerIds.has(id)) { item.remove(); card.pageNodes.delete(id); }
        for (const worker of data.workers) {
          let item = card.pageNodes.get(worker.id);
          if (!item) { item = node('li'); card.pages.append(item); card.pageNodes.set(worker.id, item); }
          const status = isNotApplicable(worker) ? 'not applicable' : worker.status;
          set(item, path(worker) + ' · ' + status + ' · ' + count(worker.issueCount, 'finding') +
            (worker.message ? '\n' + worker.message : ''));
          item.dataset.attention = String(needsAttention(worker));
        }
        const policies = [...new Set(data.workers.flatMap(w => (w.rules || []).map(rule => rule.id + ': ' + rule.value)))];
        card.rules.hidden = !policies.length;
        set(card.ruleText, policies.join('\n'));
        card.findings.hidden = !data.findings.length; card.view.hidden = !data.findings.length;
        const ids = new Set(data.findings.map(issue => issue.id));
        for (const [id, entry] of card.findingNodes) if (!ids.has(id)) { entry.details.remove(); card.findingNodes.delete(id); }
        data.findings.forEach(issue => renderFinding(card, issue));
        set(card.diagnosticText, data.workers.length ? data.workers.map(w => {
          const cost = Number.isFinite(w.estimatedCostUsd) && w.usageComplete ? '$' + w.estimatedCostUsd.toFixed(5) : 'unavailable';
          return path(w) + ' · ' + duration(w.durationMs) + ' · ' + count(w.attempts, 'attempt') + '\n' +
            (w.model || 'No model call recorded') + ' · Tokens: ' + (w.inputTokens ?? 'unavailable') + ' in / ' + (w.outputTokens ?? 'unavailable') + ' out · Cost: ' + cost +
            (!w.usageComplete ? ' · Usage incomplete' : '') +
            (w.startedAt ? '\nStarted: ' + w.startedAt : '') + (w.finishedAt ? '\nFinished: ' + w.finishedAt : '') +
            (w.mediaChecks?.length ? '\n' + w.mediaChecks.map(c => c.check + ' · ' + c.status + ' · ' + c.asset + ' · ' + c.message).join('\n') : '');
        }).join('\n\n') : 'No execution data yet.');
      }
    },
  };
}
