import * as cheerio from "cheerio";

export type PageLink = { text: string; href: string; selector: string };
export type PageImage = { src: string; alt: string | null; candidates: string[]; selector: string; context: string; decorative: boolean };
export type PageTrack = {
  src: string;
  kind: string | null;
  srclang: string | null;
  label: string | null;
  selector: string;
  videoSelector: string;
};
export type PageVideo = { sources: string[]; poster: string | null; selector: string; tracks: PageTrack[] };

export type CrawledPage = {
  url: string;
  status: number;
  title: string;
  language: string | null;
  text: string;
  links: PageLink[];
  images: PageImage[];
  tracks: PageTrack[];
  videos: PageVideo[];
};

export type CrawlResult = {
  startUrl: string;
  pages: CrawledPage[];
  responses: Array<{ url: string; status: number; contentType: string }>;
  errors: Array<{ url: string; message: string }>;
  limitReached: boolean;
};

const MAX_PAGES = 50;

function pageUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const candidate = new URL(rawUrl, baseUrl);
    if (!["http:", "https:"].includes(candidate.protocol)) return null;
    candidate.hash = "";
    if (!candidate.search && /(?:^|\/)index\.html$/i.test(candidate.pathname)) {
      candidate.pathname = candidate.pathname.replace(/index\.html$/i, "");
    }
    return candidate.toString();
  } catch {
    return null;
  }
}

export async function crawlSite(rawStartUrl: string): Promise<CrawlResult> {
  const startUrl = pageUrl(rawStartUrl, rawStartUrl);
  if (!startUrl) throw new Error("SITE_URL must be a valid HTTP or HTTPS URL.");

  const origin = new URL(startUrl).origin;
  const queue = [startUrl];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const responses: CrawlResult["responses"] = [];
  const errors: CrawlResult["errors"] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!;
    visited.add(url);

    try {
      const response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(12_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      responses.push({ url, status: response.status, contentType });
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      $("script, style, noscript, svg").remove();
      // text() alone joins adjacent blocks (e.g. <dt>Miles</dt><dd>de equipos</dd>).
      // Preserve inline word fragments but separate rendered blocks and line breaks.
      $("br, hr").replaceWith(" ");
      $("address, article, aside, blockquote, dd, details, div, dl, dt, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, li, main, nav, ol, p, pre, section, summary, table, tbody, td, th, thead, tr, ul")
        .prepend(" ").append(" ");

      const links = $("a[href]")
        .toArray()
        .map((element, index) => {
          const anchor = $(element);
          const href = anchor.attr("href")?.trim() ?? "";
          const resolved = pageUrl(href, url);
          return {
            text: anchor.text().replace(/\s+/g, " ").trim(),
            href: resolved ?? href,
            selector: `(//a[@href])[${index + 1}]`,
          };
        });

      // Asset URLs must not inherit HTML index-page normalization.
      const assetUrl = (raw: string) => { try { return new URL(raw, url).href; } catch { return raw; } };
      const srcsetUrls = (raw: string) => raw.trim().startsWith("data:") ? [raw.trim()] :
        raw.split(",").map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean).map(assetUrl);
      const images = $("img")
        .toArray()
        .map((element, index) => {
          const image = $(element);
          const rawSrc = image.attr("src")?.trim() ?? "";
          const candidates = [...new Set([
            ...(rawSrc ? [assetUrl(rawSrc)] : []), ...srcsetUrls(image.attr("srcset") ?? ""),
            ...image.closest("picture").find("source[srcset]").toArray().flatMap(source => srcsetUrls($(source).attr("srcset") ?? "")),
          ])];
          return {
            src: rawSrc ? assetUrl(rawSrc) : "", candidates, selector: `(//img)[${index + 1}]`,
            alt: image.attr("alt") ?? null,
            context: image.parent().text().replace(/\s+/g, " ").trim().slice(0, 600),
            decorative: ["presentation", "none"].includes(image.attr("role") ?? "") || image.attr("aria-hidden") === "true",
          };
        });

      const videos: PageVideo[] = $("video").toArray().map((element, index) => {
        const video = $(element);
        const selector = `(//video)[${index + 1}]`;
        const sources = [video.attr("src"), ...video.find("source").toArray().map(source => $(source).attr("src"))]
          .filter((src): src is string => Boolean(src?.trim())).map(src => assetUrl(src.trim()));
        return {
          sources: [...new Set(sources)], selector, poster: video.attr("poster") ? assetUrl(video.attr("poster")!) : null,
          tracks: video.find("track").toArray().map((element, trackIndex) => {
            const track = $(element); const src = track.attr("src")?.trim();
            return { src: src ? assetUrl(src) : "", kind: track.attr("kind") ?? "subtitles",
              srclang: track.attr("srclang") ?? null, label: track.attr("label") ?? null,
              selector: `${selector}/track[${trackIndex + 1}]`, videoSelector: selector };
          }),
        };
      });
      const tracks = videos.flatMap(video => video.tracks);

      pages.push({
        url,
        status: response.status,
        title: $("title").first().text().trim(),
        language: $("html").attr("lang") ?? null,
        text: $("body").text().replace(/\s+/g, " ").trim(),
        links,
        images,
        tracks,
        videos,
      });

      for (const link of links) {
        const target = pageUrl(link.href, url);
        if (!target || new URL(target).origin !== origin || queued.has(target)) continue;
        queued.add(target);
        queue.push(target);
      }
    } catch (error) {
      errors.push({
        url,
        message: error instanceof Error ? error.message : "Could not fetch page.",
      });
    }
  }

  return { startUrl, pages, responses, errors, limitReached: queue.length > 0 };
}
