import { createHash } from "node:crypto";
import type { CrawlResult } from "../crawler/crawl.js";

import type { QaIssue } from "../issues.js";

export function checkBrokenLinks(crawl: CrawlResult): QaIssue[] {
  const origin = new URL(crawl.startUrl).origin;
  const statusByUrl = new Map(crawl.responses.map((item) => [item.url, item.status]));
  const seen = new Set<string>();
  const issues: QaIssue[] = [];

  for (const page of crawl.pages) {
    for (const link of page.links) {
      let target: URL;
      try {
        target = new URL(link.href, page.url);
      } catch {
        continue;
      }
      if (target.origin !== origin) continue;

      const status = statusByUrl.get(target.toString());
      if (status === undefined || status < 400) continue;

      const issueKey = `${page.url}\n${target.toString()}`;
      if (seen.has(issueKey)) continue;
      seen.add(issueKey);

      const digest = createHash("sha1").update(issueKey).digest("hex").slice(0, 12);
      const anchorText = link.text ? `«${link.text}» → ` : "";
      issues.push({
        id: `link-${digest}`,
        category: "links",
        severity: "major",
        location: { page_url: page.url, element_type: "link" },
        description: `The link destination returned HTTP ${status}.`,
        evidence: `${anchorText}${target.toString()} (HTTP ${status})`,
        expected: "The link should lead to an available destination.",
        confidence: 1,
        suggested_fix: "Review the destination URL or replace it with a valid page.",
        status: "new",
      });
    }
  }

  return issues;
}
