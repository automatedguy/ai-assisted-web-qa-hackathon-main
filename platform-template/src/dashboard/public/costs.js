export const pricingSource = 'https://developers.openai.com/api/docs/models/gpt-6-astra';

export function defaultPricing(model) {
  if (model !== 'gpt-6-astra') return null;
  return { model, input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
    source: 'OpenAI Standard, short context · checked 2026-10-19', sourceUrl: pricingSource };
}

export function parseRate(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function validPricing(pricing) {
  return Boolean(pricing && ['input', 'cachedInput', 'cacheWrite', 'output'].every(key =>
    typeof pricing[key] === 'number' && Number.isFinite(pricing[key]) && pricing[key] >= 0));
}

const tokens = value => Number.isSafeInteger(value) && value >= 0;

export function workerCost(worker, pricing) {
  const input = worker.inputTokens, output = worker.outputTokens;
  const validUsage = tokens(input) && tokens(output);
  const partial = !validUsage || worker.usageComplete !== true;
  const noCalls = worker.modelCalls === 0 || (!worker.model && worker.estimatedCostUsd === 0);
  if (validUsage && input === 0 && output === 0 && noCalls && !partial) {
    return { usd: 0, inputUsd: 0, outputUsd: 0, partial: false, cacheApproximate: false };
  }
  if (!validUsage || !validPricing(pricing)) {
    // Legacy runs may have a server estimate but no saved rate card. Keep that
    // estimate until the user supplies rates; never treat unknown usage as complete.
    if (validUsage && !partial && Number.isFinite(worker.estimatedCostUsd) && worker.estimatedCostUsd >= 0) {
      return { usd: worker.estimatedCostUsd, partial: false, cacheApproximate: false, recorded: true };
    }
    return { usd: null, partial: true, cacheApproximate: false };
  }
  const cached = tokens(worker.cachedInputTokens) ? worker.cachedInputTokens : 0;
  const written = tokens(worker.cacheWriteInputTokens) ? worker.cacheWriteInputTokens : 0;
  const validSplit = cached + written <= input;
  const cachedTokens = validSplit ? cached : 0, writeTokens = validSplit ? written : 0;
  const weightedInput = (input - cachedTokens - writeTokens) * pricing.input +
    cachedTokens * pricing.cachedInput + writeTokens * pricing.cacheWrite;
  const inputUsd = weightedInput / 1e6;
  const outputUsd = output * pricing.output / 1e6;
  const usd = (weightedInput + output * pricing.output) / 1e6;
  return { usd: Number.isFinite(usd) ? usd : null, inputUsd, outputUsd, partial: partial || !Number.isFinite(usd),
    cacheApproximate: input > 0 && (!validSplit || worker.cacheUsageComplete !== true) };
}

export function workerPricing(worker, runPricing, overrides = {}) {
  const model = worker.model || runPricing?.model;
  if (Object.hasOwn(overrides, model)) return overrides[model];
  if (worker.pricing !== undefined) return worker.pricing;
  if (runPricing === null || runPricing?.model === model) return runPricing;
  return defaultPricing(model);
}

export function runCost(run, overrides = {}) {
  const workers = run?.workers || [];
  const estimates = workers.map(worker => workerCost(worker, workerPricing(worker, run?.pricing, overrides)));
  const known = estimates.filter(estimate => estimate.usd !== null);
  const usd = known.reduce((sum, estimate) => sum + estimate.usd, 0);
  return {
    usd: known.length && Number.isFinite(usd) ? usd : null,
    partial: estimates.some(estimate => estimate.partial) || !Number.isFinite(usd),
    cacheApproximate: estimates.some(estimate => estimate.cacheApproximate),
    unpriced: estimates.filter(estimate => estimate.usd === null).length,
    input: workers.reduce((sum, worker) => sum + (tokens(worker.inputTokens) ? worker.inputTokens : 0), 0),
    output: workers.reduce((sum, worker) => sum + (tokens(worker.outputTokens) ? worker.outputTokens : 0), 0),
  };
}

export function costLabel(estimate) {
  if (estimate.usd === null) return 'Unavailable — set rates or check usage';
  return '$' + estimate.usd.toFixed(5) + (estimate.partial ? ' known-usage subtotal' : estimate.recorded ? ' recorded estimate' : ' estimated');
}
