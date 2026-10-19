import { costLabel } from './costs.js';
import { categoryNames } from './activity.js';
import { agentCatalog } from './activity-cards.js';

export function createHistoryView(document, api, onSelect) {
  const $ = selector => document.querySelector(selector);
  let offset = 0, selectedId = '', run = null, runs = [], total = 0;
  let loadVersion = 0, comparisonVersion = 0, comparisonKey = null, disabled = false;
  const label = item => `${new Date(item.startedAt).toLocaleString()} · ${item.kind === 'crawl' ? 'Links only' : 'Audit'} · ${item.status} · ${item.issueCount ?? item.issues?.length ?? 0} findings · ${item.siteUrl || item.crawl?.startUrl || 'Site not recorded'}${item.profileName || item.configuration?.profileName ? ' · ' + (item.profileName || item.configuration.profileName) : ''} · ${item.id.slice(0, 8)}`;
  function options(select, items, firstLabel, selected) {
    const values = [{ value: '', label: firstLabel }, ...items.map(item => ({ value: item.id, label: label(item) }))];
    const key = JSON.stringify(values);
    if (select.dataset.options !== key) {
      select.replaceChildren(...values.map(value => {
        const option = document.createElement('option'); option.value = value.value; option.textContent = value.label; return option;
      }));
      select.dataset.options = key;
    }
    select.value = selected;
  }
  function renderSelectors() {
    const listed = [...runs];
    if (selectedId && run?.id === selectedId && !listed.some(item => item.id === selectedId)) listed.unshift(run);
    options($('#run-history'), listed, 'Current workspace (follow latest run)', selectedId);
    $('#history-page').textContent = total ? `${offset + 1}–${Math.min(offset + runs.length, total)} of ${total} saved runs` : 'No saved runs yet.';
    $('#history-newer').disabled = disabled || offset === 0;
    $('#history-older').disabled = disabled || offset + runs.length >= total;
    $('#run-history').disabled = disabled;
    $('#history-refresh').disabled = disabled;
    const baseline = $('#comparison-baseline').value;
    const compatible = runs.filter(item => run && item.id !== run.id && item.siteUrl === (run.siteUrl || run.crawl?.startUrl) &&
      item.kind === (run.kind || 'audit') && item.profileFingerprint === run.configuration?.profileFingerprint && item.startedAt <= run.startedAt && item.status !== 'running');
    // Keep an explicitly chosen baseline across history pagination/polling.
    const oldOption = [...$('#comparison-baseline').options].find(item => item.value === baseline);
    options($('#comparison-baseline'), compatible, 'Previous same-site run (automatic)', baseline);
    if (baseline && oldOption && !compatible.some(item => item.id === baseline)) {
      $('#comparison-baseline').append(oldOption); $('#comparison-baseline').value = baseline;
    }
    $('#comparison-baseline').disabled = disabled || !run;
  }
  function renderSpending(spending) {
    $('#history-cost').textContent = `${spending.total.runs} saved runs · ${costLabel(spending.total)}`;
    $('#history-cost-note').textContent = 'All saved sites and check types; uses recorded rates, not calculator overrides. ' +
      (spending.activeRuns ? `${spending.activeRuns} running: usage so far only. ` : '') +
      (spending.total.partial ? 'Incomplete usage or pricing: totals exclude unknown charges. ' : '') +
      (spending.total.cacheApproximate ? 'Some cache usage was not reported. ' : '') + 'Estimates, not invoices.';
    for (const [name, groups] of [['models', spending.models], ['agents', spending.agents]]) {
      const list = $('#history-cost-' + name); list.replaceChildren();
      for (const [key, estimate] of Object.entries(groups)) {
        const item = document.createElement('li');
        const title = name === 'agents' ? agentCatalog.find(agent => agent.id === key)?.name || key : key;
        item.textContent = `${title} · ${estimate.runs} runs · ${costLabel(estimate)}`; list.append(item);
      }
      if (!list.children.length) { const item = document.createElement('li'); item.textContent = 'No recorded usage.'; list.append(item); }
    }
  }
  async function refresh() {
    const version = ++loadVersion;
    try {
      const data = await api(`/api/audits?limit=25&offset=${offset}`);
      if (version !== loadVersion) return null;
      runs = data.runs; total = data.total;
      renderSelectors(); renderSpending(data.spending);
      $('#history-error').textContent = '';
      return data;
    } catch (error) {
      if (version === loadVersion) $('#history-error').textContent = 'Could not load saved history: ' + error.message;
      return null;
    }
  }
  async function compare() {
    const baseline = $('#comparison-baseline').value;
    const key = run ? `${run.id}:${run.status}:${run.issues.length}:${baseline}` : '';
    if (key === comparisonKey) return;
    comparisonKey = key;
    const version = ++comparisonVersion;
    $('#comparison-results').replaceChildren();
    $('#comparison-summary').textContent = run ? 'Loading comparison…' : 'Select a saved run to compare findings.';
    $('#comparison-warning').textContent = '';
    if (!run) return;
    try {
      const data = await api(`/api/audits/${encodeURIComponent(run.id)}/comparison` + (baseline ? `?baseline=${encodeURIComponent(baseline)}` : ''));
      if (version !== comparisonVersion) return;
      if (!data) { $('#comparison-summary').textContent = 'No earlier run of this site and check type is available yet.'; return; }
      $('#comparison-summary').textContent = `${data.new.length} new · ${data.recurring.length} recurring · ${data.noLongerDetected.length} no longer detected. Compared with ${label(data.baseline)}.`;
      $('#comparison-warning').textContent = data.warning;
      for (const [key, title] of [['new', 'New findings'], ['recurring', 'Recurring findings'], ['noLongerDetected', 'No longer detected (not confirmed resolved)']]) {
        const details = document.createElement('details'); const summary = document.createElement('summary');
        summary.textContent = `${title} (${data[key].length})`; details.append(summary);
        const list = document.createElement('ul');
        for (const issue of data[key].slice(0, 100)) {
          const item = document.createElement('li');
          item.textContent = `${categoryNames[issue.category] || issue.category} · ${issue.description} · ${issue.location.page_url} · ${issue.status}`;
          list.append(item);
        }
        details.append(list);
        if (data[key].length > 100) details.append('Showing the first 100 findings; the summary includes all findings.');
        $('#comparison-results').append(details);
      }
    } catch (error) {
      if (version === comparisonVersion) { comparisonKey = null; $('#comparison-summary').textContent = 'Could not compare runs: ' + error.message; }
    }
  }
  $('#run-history').addEventListener('change', () => { selectedId = $('#run-history').value; onSelect(selectedId || null); });
  $('#history-newer').addEventListener('click', () => { offset = Math.max(0, offset - 25); void refresh(); });
  $('#history-older').addEventListener('click', () => { offset += 25; void refresh(); });
  $('#history-refresh').addEventListener('click', () => { comparisonKey = null; onSelect(selectedId || null); });
  $('#comparison-baseline').addEventListener('change', () => void compare());
  return {
    refresh,
    setBusy(value) { disabled = value; renderSelectors(); },
    render(value, selection = null) {
      if (run?.id !== value?.id) { $('#comparison-baseline').value = ''; comparisonKey = null; }
      run = value; selectedId = selection || '';
      $('#history-selected').textContent = run ? `Viewing ${selectedId ? 'saved run' : 'current workspace'}: ${label(run)}` : 'Current workspace is empty. Saved runs remain available.';
      renderSelectors(); void compare();
    },
  };
}
