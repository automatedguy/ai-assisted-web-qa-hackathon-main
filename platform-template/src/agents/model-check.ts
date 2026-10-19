import OpenAI from "openai";
import { Ajv } from "ajv";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentContext } from "./types.js";
import { configuredPricing } from "../costs.js";
import { workerCost } from "../dashboard/public/costs.js";

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
  source_evidence?: string; kind?: "mistranslation" | "omission" | "addition" | "meaning_drift";
  asset_id?: string; check?: "alt_language" | "image_content" | "image_text" | "caption_language";
  element_id?: string; destination_evidence?: string;
}> };
type Options = {
  name: string; instructions: string; input: unknown; ruleIds?: string[]; sourceText?: string;
  images?: Array<{ id: string; dataUrl: string }>;
  mediaAssets?: Record<string, { alt: string | null; captionText: string | null; visual: boolean }>;
  evidenceItems?: Record<string, string>;
  linkTargets?: Record<string, string>;
};

export async function requestFindings({ page, model, report }: AgentContext, options: Options): Promise<Findings["issues"]> {
  const item = findingSchema.properties.issues.items;
  const extraProperties = {
    ...(options.evidenceItems ? { element_id: { type: "string", enum: Object.keys(options.evidenceItems) } } : {}),
    ...(options.linkTargets ? { destination_evidence: { type: "string", minLength: 1 } } : {}),
    ...(options.ruleIds ? { rule: { type: "string", enum: options.ruleIds } } : {}),
    ...(options.sourceText !== undefined ? {
      source_evidence: { type: "string", minLength: 1 },
      kind: { type: "string", enum: ["mistranslation", "omission", "addition", "meaning_drift"] },
    } : {}),
    ...(options.mediaAssets ? {
      asset_id: { type: "string", enum: Object.keys(options.mediaAssets) },
      check: { type: "string", enum: ["alt_language", "image_content", "image_text", "caption_language"] },
    } : {}),
  };
  const schema = {
    ...findingSchema,
    properties: { issues: { ...findingSchema.properties.issues, items: {
      ...item,
      required: [...item.required, ...Object.keys(extraProperties)],
      properties: { ...item.properties, ...extraProperties },
    } } },
  };
  const validate = new Ajv().compile<Findings>(schema);
  if (!page) throw new Error("Model check requires a page.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  // Fail visibly rather than silently claiming to have checked a truncated page.
  if (!options.evidenceItems && page.text.length > 24000) throw new Error("Page exceeds the 24,000-character model-check limit; chunking is not implemented yet.");
  const client = new OpenAI({ maxRetries: 0, timeout: 60000 });
  report.model = model;
  report.estimatedCostUsd = null;
  if (report.pricing === undefined) report.pricing = configuredPricing(model);
  for (let attempt = 1; attempt <= 2; attempt++) {
    report.modelCalls = (report.modelCalls ?? 0) + 1;
    report.attempts = report.modelCalls;
    report.requestAttempt = attempt;
    report.stage = "Reviewing content with model";
    let result;
    try {
      result = await client.responses.create({
        model, store: false, max_output_tokens: 4000,
        instructions: options.instructions,
        input: options.images?.length ? [{ role: "user", content: [
          { type: "input_text", text: JSON.stringify(options.input) },
          ...options.images.flatMap(image => [
            { type: "input_text" as const, text: `Image asset_id: ${image.id}` },
            { type: "input_image" as const, image_url: image.dataUrl, detail: "high" as const },
          ]),
        ] }] : JSON.stringify(options.input),
        text: { format: { type: "json_schema", name: options.name, strict: true, schema } },
      });
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      report.usageComplete = false;
      const retryable = status === 429 || (status !== undefined && status >= 500) || error instanceof OpenAI.APIConnectionError;
      if (retryable && attempt < 2) { report.stage = "Waiting to retry"; await delay(1000); continue; }
      throw new Error(status ? `OpenAI request failed (HTTP ${status}). Check model access, quota, and API configuration.` : "OpenAI request failed or timed out.");
    }
    if (result.usage) {
      report.inputTokens += result.usage.input_tokens;
      report.outputTokens += result.usage.output_tokens;
      const details = result.usage.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number } | undefined;
      const cached = details?.cached_tokens, written = details?.cache_write_tokens;
      const validCached = typeof cached === "number" && Number.isSafeInteger(cached) && cached >= 0;
      const validWritten = typeof written === "number" && Number.isSafeInteger(written) && written >= 0;
      const validSplit = (validCached ? cached : 0) + (validWritten ? written : 0) <= result.usage.input_tokens;
      report.cachedInputTokens = (report.cachedInputTokens ?? 0) + (validSplit && validCached ? cached : 0);
      report.cacheWriteInputTokens = (report.cacheWriteInputTokens ?? 0) + (validSplit && validWritten ? written : 0);
      report.cacheUsageComplete = (report.cacheUsageComplete ?? true) && validCached && validWritten && validSplit;
    } else report.usageComplete = false;
    report.estimatedCostUsd = report.usageComplete ? workerCost(report, report.pricing).usd : null;
    report.stage = "Validating response and evidence";
    if (result.status !== "completed") throw new Error("Model response incomplete; no findings accepted.");
    let parsed: unknown;
    try { parsed = JSON.parse(result.output_text); }
    catch { throw new Error("Model response was empty, refused, or invalid JSON."); }
    if (!validate(parsed)) throw new Error("Model response failed schema validation.");
    if (options.mediaAssets) {
      for (const issue of parsed.issues) {
        const asset = options.mediaAssets[issue.asset_id ?? ""];
        const valid = asset && issue.evidence.trim() && (
          issue.check === "alt_language" ? Boolean(asset.alt?.includes(issue.evidence)) :
          issue.check === "caption_language" ? Boolean(asset.captionText?.includes(issue.evidence)) :
          ["image_content", "image_text"].includes(issue.check ?? "") && asset.visual);
        if (!valid) throw new Error("Media finding did not match an inspected asset or its evidence; no model findings accepted.");
      }
    } else if (parsed.issues.some(issue => !issue.evidence.trim() || !(options.evidenceItems ? options.evidenceItems[issue.element_id ?? ""] : page.text)?.includes(issue.evidence))) {
      throw new Error("Model evidence did not match the source page; no findings accepted.");
    }
    if (options.linkTargets && parsed.issues.some(issue => !issue.destination_evidence?.trim() ||
      !options.linkTargets![issue.element_id ?? ""]?.includes(issue.destination_evidence))) {
      throw new Error("Link evidence did not match the inspected destination; no findings accepted.");
    }
    if (options.sourceText !== undefined && parsed.issues.some(issue =>
      !issue.source_evidence?.trim() || !options.sourceText!.includes(issue.source_evidence))) {
      throw new Error("Model source evidence did not match the reference Markdown; no findings accepted.");
    }
    return parsed.issues;
  }
  throw new Error("Model retries exhausted.");
}
