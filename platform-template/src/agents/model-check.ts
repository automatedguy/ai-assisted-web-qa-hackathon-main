import OpenAI from "openai";
import { Ajv } from "ajv";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentContext } from "./types.js";

const findingSchema = {
  type: "object", additionalProperties: false,
  required: ["issues"], properties: { issues: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["severity", "description", "evidence", "expected", "confidence", "suggested_fix"],
    properties: {
      severity: { type: "string", enum: ["critical", "major", "minor", "suggestion"] },
      description: { type: "string" }, evidence: { type: "string" },
      expected: { type: "string" }, suggested_fix: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  } } },
};
export type Findings = { issues: Array<{
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string; evidence: string; expected: string; confidence: number; suggested_fix: string; rule?: string;
}> };
function rate(name: string): number | null {
  const raw = process.env[name];
  if (!raw?.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
type Options = {
  name: string; instructions: string; input: unknown; ruleIds?: string[];
};

export async function requestFindings({ page, model, report }: AgentContext, options: Options): Promise<Findings["issues"]> {
  const schema = options.ruleIds ? {
    ...findingSchema,
    properties: { issues: { ...findingSchema.properties.issues, items: {
      ...findingSchema.properties.issues.items,
      required: [...findingSchema.properties.issues.items.required, "rule"],
      properties: { ...findingSchema.properties.issues.items.properties, rule: { type: "string", enum: options.ruleIds } },
    } } },
  } : findingSchema;
  const validate = new Ajv().compile<Findings>(schema);
  if (!page) throw new Error("Model check requires a page.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  // Fail visibly rather than silently claiming to have checked a truncated page.
  if (page.text.length > 24000) throw new Error("Page exceeds the 24,000-character model-check limit; chunking is not implemented yet.");
  const client = new OpenAI({ maxRetries: 0, timeout: 60000 });
  report.model = model;
  report.estimatedCostUsd = null;
  const inputRate = rate("OPENAI_INPUT_USD_PER_MILLION");
  const outputRate = rate("OPENAI_OUTPUT_USD_PER_MILLION");
  for (let attempt = 1; attempt <= 2; attempt++) {
    report.attempts = attempt;
    let result;
    try {
      result = await client.responses.create({
        model, store: false, max_output_tokens: 4000,
        instructions: options.instructions,
        input: JSON.stringify(options.input),
        text: { format: { type: "json_schema", name: options.name, strict: true, schema } },
      });
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      report.usageComplete = false;
      const retryable = status === 429 || (status !== undefined && status >= 500) || error instanceof OpenAI.APIConnectionError;
      if (retryable && attempt < 2) { await delay(1000); continue; }
      throw new Error(status ? `OpenAI request failed (HTTP ${status}). Check model access, quota, and API configuration.` : "OpenAI request failed or timed out.");
    }
    if (result.usage) {
      report.inputTokens += result.usage.input_tokens;
      report.outputTokens += result.usage.output_tokens;
    } else report.usageComplete = false;
    if (inputRate !== null && outputRate !== null && report.usageComplete) {
      report.estimatedCostUsd = (report.inputTokens * inputRate + report.outputTokens * outputRate) / 1e6;
    }
    if (result.status !== "completed") throw new Error("Model response incomplete; no findings accepted.");
    let parsed: unknown;
    try { parsed = JSON.parse(result.output_text); }
    catch { throw new Error("Model response was empty, refused, or invalid JSON."); }
    if (!validate(parsed)) throw new Error("Model response failed schema validation.");
    if (parsed.issues.some(issue => !issue.evidence.trim() || !page.text.includes(issue.evidence))) {
      throw new Error("Model evidence did not match the source page; no findings accepted.");
    }
    return parsed.issues;
  }
  throw new Error("Model retries exhausted.");
}
