import { categoryNames } from './activity.js';

const label = text => text.charAt(0).toUpperCase() + text.slice(1);

export function createIssuesView(document, onReview) {
  const list = document.querySelector('#issues');
  const cards = new Map();
  let nextId = 0;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function createCard(issue) {
    const card = { issue, expanded: false };
    const item = card.item = element('li', 'issue-card');
    item.dataset.issueId = issue.id;
    const header = element('div', 'issue-card-header');
    const classification = element('div', 'issue-classification');
    card.severity = element('span', 'issue-severity');
    card.category = element('span', 'issue-category');
    card.status = element('span', 'issue-status');
    card.status.setAttribute('role', 'status');
    classification.append(card.severity, card.category); header.append(classification, card.status);
    card.heading = element('h3', 'issue-title');
    card.heading.id = `finding-title-${++nextId}`;
    item.setAttribute('aria-labelledby', card.heading.id);

    const evidence = element('div', 'issue-evidence');
    card.quote = element('p', 'issue-quote'); card.quote.id = `finding-evidence-${nextId}`;
    card.expand = element('button', 'issue-expand', 'Show more'); card.expand.type = 'button';
    card.expand.setAttribute('aria-controls', card.quote.id);
    card.expand.addEventListener('click', () => { card.expanded = !card.expanded; updateEvidence(card); });
    evidence.append(element('p', 'issue-label', 'Evidence'), card.quote, card.expand);

    card.visual = element('figure', 'issue-visual');
    card.visualImage = element('img', 'issue-screenshot');
    card.visualLink = element('a', 'issue-screenshot-link', 'Open full screenshot ↗');
    card.visualLink.target = '_blank'; card.visualLink.rel = 'noopener noreferrer';
    card.visual.append(card.visualImage, card.visualLink);

    card.correction = element('div', 'issue-correction');
    const corrections = element('dl', 'issue-correction-fields');
    card.expected = element('div'); card.expectedValue = element('dd');
    card.expected.append(element('dt', '', 'Expected'), card.expectedValue);
    card.fix = element('div'); card.fixValue = element('dd');
    card.fix.append(element('dt', '', 'Suggested fix'), card.fixValue);
    corrections.append(card.expected, card.fix);
    card.correction.append(element('p', 'issue-label', 'Correction'), corrections);

    card.details = element('details', 'issue-details');
    const fields = element('dl', 'issue-detail-fields');
    card.detailFields = {};
    for (const field of ['Confidence', 'Element', 'Selector / XPath']) {
      const group = element('div'); const value = element('dd');
      group.append(element('dt', '', field), value); fields.append(group);
      card.detailFields[field] = { group, value };
    }
    card.details.append(element('summary', '', 'Details'), fields);

    const footer = element('div', 'issue-footer');
    card.page = element('a', 'issue-page'); card.page.target = '_blank'; card.page.rel = 'noopener noreferrer';
    const actions = element('div', 'issue-actions');
    actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Review finding');
    card.buttons = new Map();
    for (const [status, text] of [['verified', 'Verify'], ['dismissed', 'Dismiss'], ['escalated', 'Escalate']]) {
      const button = element('button', status === 'verified' ? 'issue-verify' : 'issue-secondary', text);
      button.type = 'button'; card.buttons.set(status, button);
      button.addEventListener('click', async () => {
        card.feedback.dataset.error = 'false'; card.feedback.textContent = 'Saving review…';
        try { await onReview(card.issue, status); card.feedback.textContent = ''; }
        catch (error) { card.feedback.dataset.error = 'true'; card.feedback.textContent = `Could not save review: ${error.message}`; }
      });
      actions.append(button);
    }
    footer.append(card.page, actions);
    card.feedback = element('p', 'issue-feedback'); card.feedback.setAttribute('role', 'status');
    item.append(header, card.heading, evidence, card.visual, card.correction, card.details, footer, card.feedback);
    return card;
  }

  function updateEvidence(card) {
    const evidence = card.issue.evidence;
    const long = evidence.length > 600 || evidence.split('\n').length > 8;
    const preview = Array.from(evidence.split('\n').slice(0, 6).join('\n')).slice(0, 480).join('');
    setText(card.quote, long && !card.expanded ? preview + '…' : evidence);
    card.expand.hidden = !long;
    card.expand.textContent = card.expanded ? 'Show less' : 'Show more';
    card.expand.setAttribute('aria-expanded', String(card.expanded));
  }

  return {
    render(issues, { category, disabled, pageTitles }) {
      const ids = new Set(issues.map(issue => issue.id));
      for (const [id, card] of cards) {
        if (!ids.has(id)) { card.item.remove(); cards.delete(id); }
      }
      const filtered = issues.filter(issue => category === 'all' || issue.category === category);
      document.querySelector('#issue-summary').textContent = `${filtered.length} shown / ${issues.length} total findings.`;
      for (const issue of issues) {
        let card = cards.get(issue.id);
        if (!card) { card = createCard(issue); cards.set(issue.id, card); }
        card.issue = issue;
        card.item.hidden = category !== 'all' && issue.category !== category;
        setText(card.severity, label(issue.severity)); card.severity.dataset.severity = issue.severity;
        setText(card.category, categoryNames[issue.category] || issue.category);
        setText(card.status, label(issue.status)); card.status.dataset.status = issue.status;
        setText(card.heading, issue.description);
        updateEvidence(card);
        const visual = issue.visual_evidence;
        card.visual.hidden = !visual?.screenshot_url;
        if (visual?.screenshot_url) {
          card.visualImage.src = visual.screenshot_url;
          card.visualImage.alt = visual.highlighted ? 'Screenshot with the affected element highlighted in red.' : 'Screenshot of the affected page.';
          card.visualLink.href = visual.screenshot_url;
          card.visualLink.title = visual.note || '';
        }
        card.correction.hidden = !issue.expected && !issue.suggested_fix;
        card.expected.hidden = !issue.expected; card.fix.hidden = !issue.suggested_fix;
        setText(card.expectedValue, issue.expected || ''); setText(card.fixValue, issue.suggested_fix || '');
        for (const [field, value] of Object.entries({
          Confidence: `${Math.round(issue.confidence * 100)}%`, Element: issue.location.element_type,
          'Selector / XPath': issue.location.selector_or_xpath,
        })) {
          card.detailFields[field].group.hidden = !value;
          setText(card.detailFields[field].value, value || '');
        }
        const rawUrl = issue.location.page_url;
        let pageName = rawUrl;
        card.page.removeAttribute('href');
        try {
          const url = new URL(rawUrl);
          if (['http:', 'https:'].includes(url.protocol)) {
            card.page.href = url.href;
            pageName = pageTitles.get(rawUrl) || (url.pathname === '/' ? 'Home' : url.pathname + url.search);
          }
        } catch { /* Preserve the supplied location as text when it is not a web URL. */ }
        setText(card.page, `Page: ${pageName}${card.page.hasAttribute('href') ? ' ↗' : ''}`);
        card.page.title = rawUrl;
        for (const [status, button] of card.buttons) button.disabled = disabled || status === issue.status;
      }
      // Avoid removing/reinserting existing cards: focus, scroll and disclosures
      // survive review updates and polling. Only move a node when order changes.
      issues.forEach((issue, index) => {
        const item = cards.get(issue.id).item;
        if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
      });
    },
  };
}
