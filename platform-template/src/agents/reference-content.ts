import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { repositoryRoot, type Profile } from "../config.js";

const MAX_SOURCE_CHARACTERS = 24000;

// Match the crawler's index.html aliases, preserving query-specific pages.
function canonicalUrl(value: string, baseUrl: string): string {
  if (!value.trim()) throw new Error("Reference page mapping must not be blank.");
  const url = new URL(value, baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Reference page mapping must use HTTP or HTTPS.");
  url.hash = "";
  if (!url.search) url.pathname = url.pathname.replace(/\/index\.html$/i, "/");
  return url.href;
}

export async function referenceRoot(): Promise<string> {
  if (process.env.REFERENCE_CONTENT_PATH?.trim()) return resolve(process.env.REFERENCE_CONTENT_PATH);
  // The demo contract mounts this directory even when only the two required env vars are supplied.
  try { await stat("/data/reference-content"); return "/data/reference-content"; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(repositoryRoot, "reference-content");
  }
}

function contained(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function loadReference(pageUrl: string, startUrl: string, profile: Profile, referenceContentPath?: string): Promise<{ path: string; text: string } | null> {
  const matches = (profile.reference_content ?? []).filter(entry =>
    canonicalUrl(entry.page, startUrl) === canonicalUrl(pageUrl, startUrl));
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error("Multiple reference mappings resolve to this page; configure exactly one source.");
  const path = matches[0].source_text_path.trim();
  if (!path || ![".md", ".markdown"].includes(extname(path).toLowerCase())) {
    throw new Error("Reference source must be a nonempty Markdown file path (.md or .markdown).");
  }
  try {
    const configuredRoot = referenceContentPath ? resolve(referenceContentPath) : await referenceRoot();
    const root = await realpath(configuredRoot);
    // Accept the starter's repository-relative prefix and paths relative to the reference directory.
    const file = resolve(configuredRoot, path.replace(/^reference-content\//, ""));
    if (!contained(configuredRoot, file)) throw new Error("Reference path must stay inside REFERENCE_CONTENT_PATH.");
    const resolved = await realpath(file);
    if (!contained(root, resolved)) throw new Error("Reference symlink must stay inside REFERENCE_CONTENT_PATH.");
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("Reference source must be a regular Markdown file.");
    if (info.size > MAX_SOURCE_CHARACTERS * 4) throw new Error("Reference exceeds the 24,000-character limit; chunking is not implemented yet.");
    const text = await readFile(resolved, "utf8");
    if (!text.trim()) throw new Error("Reference source is empty.");
    if (text.length > MAX_SOURCE_CHARACTERS) throw new Error("Reference exceeds the 24,000-character limit; chunking is not implemented yet.");
    return { path, text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) throw new Error("Cannot read the mapped reference Markdown. Check source_text_path and REFERENCE_CONTENT_PATH.");
    throw error;
  }
}
