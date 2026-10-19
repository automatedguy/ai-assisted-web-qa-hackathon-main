import { defaultPricing, parseRate, type Pricing } from "./dashboard/public/costs.js";

export function configuredPricing(model: string, env: NodeJS.ProcessEnv = process.env): Pricing | null {
  const keys = ["OPENAI_INPUT_USD_PER_MILLION", "OPENAI_OUTPUT_USD_PER_MILLION", "OPENAI_CACHED_INPUT_USD_PER_MILLION", "OPENAI_CACHE_WRITE_USD_PER_MILLION"];
  if (!keys.some(key => env[key]?.trim())) return defaultPricing(model);
  const input = parseRate(env[keys[0]]), output = parseRate(env[keys[1]]);
  const cachedInput = env[keys[2]]?.trim() ? parseRate(env[keys[2]]) : input;
  const cacheWrite = env[keys[3]]?.trim() ? parseRate(env[keys[3]]) : input;
  if (input === null || output === null || cachedInput === null || cacheWrite === null) return null;
  return { model, input, output, cachedInput, cacheWrite,
    source: "Configured USD rates per million tokens; unspecified cache rates use the input rate" };
}
