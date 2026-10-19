import { costLabel, parseRate, runCost, workerPricing, validPricing } from './costs.js';

export function createCostView(document, onChange) {
  const $ = selector => document.querySelector(selector);
  const overrides = Object.create(null);
  let currentRun, model, recordedPricing;
  const fields = { input: $('#cost-rate-input'), cachedInput: $('#cost-rate-cached'), cacheWrite: $('#cost-rate-write'), output: $('#cost-rate-output') };
  const set = (selector, text) => { if ($(selector).textContent !== text) $(selector).textContent = text; };
  function fillRates() {
    const pricing = overrides[model] || recordedPricing;
    for (const [key, field] of Object.entries(fields)) field.value = validPricing(pricing) ? pricing[key] : '';
  }
  function update() {
    const cost = runCost(currentRun, overrides);
    const active = currentRun?.status === 'running';
    const label = currentRun ? costLabel(cost) + (active ? ' so far' : '') : 'No run yet';
    set('#activity-cost', currentRun ? label : '');
    set('#panel-cost', currentRun ? 'Run cost: ' + label : '');
    set('#cost-total', label);
    set('#activity-usage', currentRun ? `Reported tokens: ${cost.input.toLocaleString()} input / ${cost.output.toLocaleString()} output` : 'No usage yet.');
    const pricing = overrides[model] || recordedPricing;
    set('#cost-basis', model ? `Rates for ${model}: ${pricing?.source || 'No rates configured. Enter all four rates below.'}` : 'Run an audit to configure estimates for its model.');
    const warnings = [];
    if (cost.partial) warnings.push('Incomplete estimate: unknown request usage or unpriced workers are excluded.');
    if (cost.unpriced) warnings.push(`${cost.unpriced} worker(s) could not be priced.`);
    if (cost.cacheApproximate) warnings.push('Some cache details were not recorded; unclassified input uses the regular input rate.');
    if (new Set((currentRun?.workers || []).map(w => w.model).filter(Boolean)).size > 1) warnings.push('Multiple models: edited rates apply only to ' + model + '. Other models use their own rates.');
    set('#cost-warning', currentRun ? warnings.join(' ') : '');
    const runs = Number($('#cost-run-count').value);
    const projected = cost.usd === null ? NaN : cost.usd * runs;
    set('#cost-projection', Number.isInteger(runs) && runs >= 1 && runs <= 10000 && Number.isFinite(projected) ?
      `$${projected.toFixed(5)} for ${runs} similar run${runs === 1 ? '' : 's'}${cost.partial ? ' (known-usage subtotal only)' : ''}.` : 'Enter 1–10,000 runs; an estimated run cost is required.');
  }
  $('#cost-rates').addEventListener('submit', event => {
    event.preventDefault();
    const rates = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, parseRate(field.value)]));
    if (!model || !validPricing(rates)) { set('#cost-error', 'Enter a non-negative USD rate in every field.'); return; }
    overrides[model] = { ...rates, model, source: 'Custom calculator rates · this tab only; does not change API billing or server configuration' };
    set('#cost-error', ''); update(); onChange();
  });
  $('#cost-reset').addEventListener('click', () => {
    delete overrides[model]; fillRates(); set('#cost-error', ''); update(); onChange();
  });
  $('#cost-run-count').addEventListener('input', update);
  return {
    overrides: () => overrides,
    render(run) {
      const changedRun = currentRun?.id !== run?.id;
      currentRun = run;
      const nextModel = run?.pricing?.model || run?.workers?.find(worker => worker.model)?.model;
      const worker = run?.workers?.find(worker => worker.model === nextModel) || {};
      const nextPricing = workerPricing(worker, run?.pricing);
      const changed = changedRun || model !== nextModel || JSON.stringify(recordedPricing) !== JSON.stringify(nextPricing);
      model = nextModel; recordedPricing = nextPricing;
      if (changed) { fillRates(); set('#cost-error', ''); }
      $('#cost-rate-fields').disabled = !model;
      update();
    },
  };
}
