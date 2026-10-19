import { createHash } from "node:crypto";

export type MediaCheck = "missing_source" | "http_error" | "invalid_resource" | "missing_alt" |
  "caption_metadata" | "invalid_captions" | "alt_language" | "image_content" | "image_text" | "caption_language";

export type ResourceVersion = { status: number; contentType: string; digest: string };

// Profile object key order is not part of an issue's identity.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function mediaIssueId(input: {
  pageUrl: string; pageText: string; targetLocale: string; glossary: unknown; check: MediaCheck;
  asset: { src: string; selector: string; elementType: string; alt: string | null;
    captionText: string | null; context?: string; decorative?: boolean; srclang?: string | null };
  resource?: ResourceVersion; facts?: unknown;
}): string {
  const { asset, check } = input;
  const visual = check === "image_content" || check === "image_text";
  const language = check === "alt_language" || check === "caption_language";
  const elementOnly = check === "alt_language" || check === "missing_alt";
  const identity = {
    version: 2, page: input.pageUrl, element: asset.selector, elementType: asset.elementType, check,
    // One alt attribute belongs to the img element, not each responsive source.
    resourceUrl: elementOnly ? undefined : asset.src,
    resource: elementOnly ? undefined : input.resource,
    alt: elementOnly || visual ? asset.alt : undefined,
    decorative: check === "missing_alt" || visual ? asset.decorative : undefined,
    captions: check === "caption_language" ? asset.captionText : undefined,
    srclang: check === "caption_language" ? asset.srclang : undefined,
    targetLocale: visual || language || check === "caption_metadata" ? input.targetLocale : undefined,
    glossary: visual || language ? input.glossary : undefined,
    // The model sees this context; changing it can change whether an image is misleading.
    context: visual ? [asset.context, input.pageText] : undefined,
    facts: input.facts,
  };
  return "media-v2-" + createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex").slice(0, 32);
}
