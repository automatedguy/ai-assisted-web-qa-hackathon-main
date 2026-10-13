import * as cheerio from "cheerio";

export type PageLink = { text: string; href: string };
export type PageImage = { src: string; alt: string | null };
export type PageTrack = {
  src: string;
  kind: string | null;
  srclang: string | null;
  label: string | null;
};

export type CrawledPage = {
  url: string;
  status: number;
  title: string;
  language: string | null;
  text: string;
  links: PageLink[];
  images: PageImage[];
  tracks: PageTrack[];
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

      const links = $("a[href]")
        .toArray()
        .map((element) => {
          const anchor = $(element);
          const href = anchor.attr("href")?.trim() ?? "";
          const resolved = pageUrl(href, url);
          return {
            text: anchor.text().replace(/\s+/g, " ").trim(),
            href: resolved ?? href,
          };
        });

      const images = $("img")
        .toArray()
        .map((element) => {
          const image = $(element);
          const rawSrc = image.attr("src") ?? "";
          return {
            src: rawSrc ? pageUrl(rawSrc, url) ?? rawSrc : "",
            alt: image.attr("alt") ?? null,
          };
        });

      const tracks = $("video track")
        .toArray()
        .map((element) => {
          const track = $(element);
          const rawSrc = track.attr("src") ?? "";
          return {
            src: rawSrc ? pageUrl(rawSrc, url) ?? rawSrc : "",
            kind: track.attr("kind") ?? null,
            srclang: track.attr("srclang") ?? null,
            label: track.attr("label") ?? null,
          };
        });

      pages.push({
        url,
        status: response.status,
        title: $("title").first().text().trim(),
        language: $("html").attr("lang") ?? null,
        text: $("body").text().replace(/\s+/g, " ").trim(),
        links,
        images,
        tracks,
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
