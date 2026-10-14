import * as cheerio from "cheerio";

export type MediaResource = { status: number; contentType: string; data: Buffer };

export async function fetchMediaResource(rawUrl: string, pageUrl: string, kind: "image" | "video" | "track"): Promise<MediaResource> {
  const origin = new URL(pageUrl).origin;
  let url = new URL(rawUrl, pageUrl);
  const signal = AbortSignal.timeout(10000);
  const limit = kind === "image" ? 4 * 1024 * 1024 : kind === "track" ? 256 * 1024 : 4096;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      throw new Error("Only same-origin HTTP(S) media is inspected; external or inline media remains unchecked.");
    }
    const response = await fetch(url, { redirect: "manual", credentials: "omit", signal,
      headers: kind === "video" ? { range: "bytes=0-4095" } : {} });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Media redirect has no Location header.");
      url = new URL(location, url); continue;
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, contentType, data: Buffer.alloc(0) }; }
    if (kind !== "video" && Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel(); throw new Error(`Media exceeds the ${limit}-byte ${kind} inspection limit.`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        if (kind !== "video" && length + value.length > limit) throw new Error(`Media exceeds the ${limit}-byte ${kind} inspection limit.`);
        const chunk = value.subarray(0, limit - length); chunks.push(chunk); length += chunk.length;
        if (kind === "video" && length === limit) break;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return { status: response.status, contentType, data: Buffer.concat(chunks) };
  }
  throw new Error("Media redirect limit exceeded.");
}

export function imageMime(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Basic WebVTT cue extraction; rendering settings and audio alignment are not validated.
export function parseCaptions(raw: string): { text: string; cues: Array<{ timing: string; text: string }> } {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(normalized)) throw new Error("Caption file lacks a WEBVTT header.");
  const timestamp = "(?:\\d{2,}:)?[0-5]\\d:[0-5]\\d\\.\\d{3}";
  const timing = new RegExp(`^(${timestamp})[ \\t]+-->[ \\t]+(${timestamp})(?:[ \\t]+.*)?$`);
  const seconds = (value: string) => value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  const cues: Array<{ timing: string; text: string }> = [];
  let lastStart = -1;
  const blocks = normalized.split(/\n[ \t]*\n/);
  if (blocks[0].includes("-->")) throw new Error("Caption header must be separated from cues by a blank line.");
  for (const block of blocks.slice(1)) {
    if (!block.trim() || /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
    const lines = block.trimEnd().split("\n");
    const index = lines[0].includes("-->") ? 0 : 1;
    const match = timing.exec(lines[index] ?? "");
    if (!match || seconds(match[2]) <= seconds(match[1]) || seconds(match[1]) < lastStart) {
      throw new Error("Caption file contains invalid or out-of-order cue timings.");
    }
    lastStart = seconds(match[1]);
    const text = cheerio.load(lines.slice(index + 1).join("\n")).text().replace(/\s+/g, " ").trim();
    if (text) cues.push({ timing: lines[index], text });
  }
  if (!cues.length) throw new Error("Caption file contains no readable cues.");
  return { text: cues.map(cue => cue.text).join("\n"), cues };
}
