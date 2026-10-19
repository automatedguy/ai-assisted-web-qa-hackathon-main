import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredPricing } from '../src/costs.js';
import { defaultPricing, workerCost, workerPricing, runCost, costLabel, parseRate } from '../src/dashboard/public/costs.js';

const model = 'gpt-6-astra';
const pricing = defaultPricing(model)!;
const usage = { model, inputTokens: 9050, outputTokens: 14, usageComplete: true };

test('published preset estimates the supplied workers and totals without another API call', () => {
  const workers = [usage, { ...usage, inputTokens: 3966, outputTokens: 15 }, { ...usage, inputTokens: 6046, outputTokens: 283 }];
  assert.deepEqual(workers.map(worker => workerCost(worker, pricing).usd), [0.0912, 0.04041, 0.07461]);
  const total = runCost({ workers });
  assert(Math.abs(total.usd! - 0.20622) < 1e-10);
  assert.equal(total.cacheApproximate, true); assert.equal(total.partial, false);
  assert.equal(costLabel(total), '$0.20622 estimated');
});

test('cache reads and writes are subdivisions of input, not additional input', () => {
  const cost = workerCost({ ...usage, inputTokens: 15000, outputTokens: 100,
    cachedInputTokens: 12000, cacheWriteInputTokens: 3000, cacheUsageComplete: true }, pricing);
  assert.equal(cost.usd, 0.0545); assert.equal(cost.inputUsd, 0.0495); assert.equal(cost.outputUsd, 0.005);
  assert.equal(cost.cacheApproximate, false);
  const invalid = workerCost({ ...usage, cachedInputTokens: 10000, cacheWriteInputTokens: 10000, cacheUsageComplete: true }, pricing);
  assert.equal(invalid.usd, 0.0912); assert.equal(invalid.cacheApproximate, true);
});

test('explicit rates override defaults, while partial or invalid configuration fails closed', () => {
  assert.deepEqual(configuredPricing(model, {}), pricing);
  assert.equal(configuredPricing('unlisted-model', {}), null);
  assert.equal(configuredPricing(model, { OPENAI_INPUT_USD_PER_MILLION: '10' }), null);
  assert.equal(configuredPricing(model, { OPENAI_INPUT_USD_PER_MILLION: 'bad', OPENAI_OUTPUT_USD_PER_MILLION: '50' }), null);
  const custom = configuredPricing('custom', { OPENAI_INPUT_USD_PER_MILLION: '2', OPENAI_OUTPUT_USD_PER_MILLION: '8', OPENAI_CACHED_INPUT_USD_PER_MILLION: '0.5' })!;
  assert.equal(custom.cachedInput, 0.5); assert.equal(custom.cacheWrite, 2);
  assert.equal(workerPricing({ ...usage, pricing: null }, pricing), null);
  const free = configuredPricing(model, { OPENAI_INPUT_USD_PER_MILLION: '0', OPENAI_OUTPUT_USD_PER_MILLION: '0' })!;
  assert.equal(workerCost(usage, free).usd, 0);
  for (const value of ['', ' ', undefined, null, -1, Infinity, 'abc']) assert.equal(parseRate(value), null);
});

test('missing usage or unpriced models produce an explicit known-usage subtotal', () => {
  const cost = runCost({ workers: [usage, { ...usage, model: 'unknown' }, { ...usage, usageComplete: false }] });
  assert.equal(cost.partial, true); assert.equal(cost.unpriced, 1);
  assert.equal(cost.usd, 0.1824); assert.match(costLabel(cost), /known-usage subtotal/);
  assert.equal(workerCost({ ...usage, inputTokens: NaN }, pricing).usd, null);
  assert.equal(runCost({ workers: [{ ...usage, model: 'unknown' }] }).usd, null);
});

test('queued and deterministic zero-call workers are free without hiding unknown request usage', () => {
  const free = { inputTokens: 0, outputTokens: 0, modelCalls: 0, usageComplete: true, pricing: null };
  assert.equal(runCost({ workers: [free] }).usd, 0);
  assert.equal(runCost({ workers: [free] }).partial, false);
  const failed = workerCost({ ...free, modelCalls: 1, usageComplete: false }, pricing);
  assert.equal(failed.usd, 0); assert.equal(failed.partial, true);
  assert.equal(runCost(null).usd, null);
});

test('calculator overrides apply only to their model and do not mutate recorded pricing', () => {
  const override = { ...pricing, input: 20, output: 100 };
  const snapshot = { ...pricing, input: 3, output: 6 };
  const worker = { ...usage, pricing: snapshot };
  assert.equal(workerPricing(worker, pricing), snapshot);
  assert.equal(workerPricing(worker, pricing, { [model]: override }), override);
  assert.equal(workerPricing({ ...usage, model: 'other' }, pricing, { [model]: override }), null);
  runCost({ workers: [worker], pricing }, { [model]: override });
  assert.equal(worker.pricing.input, 3);
});

test('legacy server estimates remain visible when their model has no preset or rate snapshot', () => {
  const worker = { ...usage, model: 'legacy-model', estimatedCostUsd: 0.25 };
  assert.equal(costLabel(workerCost(worker, null)), '$0.25000 recorded estimate');
  assert.equal(runCost({ workers: [worker] }).usd, 0.25);
  assert.equal(workerCost({ ...worker, usageComplete: false }, null).usd, null);
});
