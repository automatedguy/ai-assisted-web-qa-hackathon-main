import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Ajv } from "ajv";
import type { QaIssue } from "./issues.js";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export type Profile = Record<string, unknown> & {
  locale: Record<string, unknown> & { target_locale: string };
  reference_content?: Array<{ page: string; source_text_path: string }>;
};
const validateProfile = new Ajv().compile<Profile>({
  type: "object", required: ["locale"],
  properties: {
    locale: {
      type: "object", required: ["target_locale"],
      properties: { target_locale: { type: "string", minLength: 2 }, source_locale: { type: "string", minLength: 2 } },
    },
    brand_voice: { type: "object" }, glossary: { type: "object" },
    reference_content: { type: "array", items: {
      type: "object", required: ["page", "source_text_path"],
      properties: { page: { type: "string", minLength: 1 }, source_text_path: { type: "string", minLength: 1 } },
    } },
  },
});
export function parseProfile(source: string): Profile {
  let value: unknown;
  try { value = parse(source, { maxAliasCount: 50 }); }
  catch { throw new Error("Cannot read or parse LINGUISTIC_ASSET_PATH."); }
  if (!validateProfile(value)) throw new Error("Invalid linguistic profile: " + new Ajv().errorsText(validateProfile.errors));
  return value;
}
export function defaultProfilePath() {
  return process.env.LINGUISTIC_ASSET_PATH ?? resolve(repositoryRoot, "linguistic-assets/practice-profile.yaml");
}
export async function loadProfile(path = defaultProfilePath()): Promise<Profile> {
  let source: string;
  try { source = await readFile(path, 'utf8'); }
  catch { throw new Error('Cannot read LINGUISTIC_ASSET_PATH.'); }
  return parseProfile(source);
}
export async function loadIssueValidator() {
  const path = process.env.ISSUE_SCHEMA_PATH ?? resolve(repositoryRoot, "docs/ISSUE_SCHEMA.json");
  const schema = JSON.parse(await readFile(path, "utf8"));
  return new Ajv().compile<QaIssue>(schema);
}
