import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QaIssue } from "./issues.js";

type Marker = { id: string; selector?: string; evidence: string; label: string };

const screenshotDir = process.env.SCREENSHOT_DIR ?? join(tmpdir(), "qa-platform-screenshots");
const viewport = { width: 1440, height: 900 };

function markerFor(issue: QaIssue): Marker {
  return {
    id: issue.id,
    selector: issue.location.selector_or_xpath,
    evidence: issue.evidence,
    label: `${issue.category} · ${issue.severity}`,
  };
}

/**
 * Captures one annotated screenshot per affected page. The dynamic import keeps
 * audits usable in environments where the optional browser runtime is absent.
 */
export async function captureIssueScreenshots(auditId: string, issues: QaIssue[]): Promise<void> {
  if (!issues.length || process.env.QA_DISABLE_SCREENSHOTS === "1") return;
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.warn(JSON.stringify({ event: "screenshots_skipped", reason: "Playwright is not installed." }));
    return;
  }

  const groups = new Map<string, QaIssue[]>();
  for (const issue of issues) {
    const group = groups.get(issue.location.page_url) ?? [];
    group.push(issue); groups.set(issue.location.page_url, group);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.warn(JSON.stringify({ event: "screenshots_skipped", reason: error instanceof Error ? error.message : "Browser launch failed." }));
    return;
  }

  await mkdir(screenshotDir, { recursive: true });
  try {
    for (const [pageUrl, pageIssues] of groups) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      try {
        await page.route("**/*", route => route.request().resourceType() === "media" ? route.abort() : route.continue());
        await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 20_000 });
        for (const issue of pageIssues) {
          const marker = markerFor(issue);
          const filename = createHash("sha256").update(`${auditId}\n${issue.id}\n${pageUrl}`).digest("hex").slice(0, 20) + ".png";
          const output = join(screenshotDir, filename);
          const visual = await page.evaluate<Array<{ id: string; highlighted: boolean }>>(`(() => { const items = ${JSON.stringify([marker])};
          function findByXPath(value) {
            try { return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
            catch { return null; }
          }
          function findByText(value) {
            const candidates = [value, ...(value.match(/[“"]([^”]+)[”"]/g) ?? []).map(item => item.slice(1, -1))].filter(Boolean);
            for (const candidate of candidates) {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walker.nextNode())) {
                if ((node.textContent ?? "").includes(candidate)) return node.parentElement;
              }
            }
            return null;
          }
          const result = [];
          items.forEach((item, index) => {
            const target = item.selector ? findByXPath(item.selector) : findByText(item.evidence);
            if (!target) { result.push({ id: item.id, highlighted: false }); return; }
            const rect = target.getBoundingClientRect();
            if (!rect.width || !rect.height) { result.push({ id: item.id, highlighted: false }); return; }
            const marker = document.createElement("div");
            marker.dataset.qaScreenshotMarker = item.id;
            marker.style.cssText = "position:absolute;z-index:2147483647;left:" + Math.max(0, rect.left + window.scrollX - 4) + "px;top:" + Math.max(0, rect.top + window.scrollY - 4) + "px;width:" + (rect.width + 8) + "px;height:" + (rect.height + 8) + "px;border:3px solid #d71920;border-radius:5px;background:#d7192020;box-shadow:0 0 0 2px #fff,0 2px 8px #0008;pointer-events:none;";
            const label = document.createElement("span");
            label.textContent = (index + 1) + " · " + item.label;
            label.style.cssText = "position:absolute;left:-3px;top:-27px;padding:3px 6px;background:#d71920;color:#fff;border-radius:4px;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;";
            marker.append(label); document.body.append(marker);
            result.push({ id: item.id, highlighted: true });
          });
          return result;
          })()`);
          await page.screenshot({ path: output, fullPage: true });
          const highlighted = visual[0]?.highlighted ?? false;
          issue.visual_evidence = {
            screenshot_url: `/api/screenshots/${filename}`,
            highlighted,
            note: highlighted ? "The affected element is outlined in red." : "The page was captured, but the affected element could not be located automatically.",
          };
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: "screenshot_failed", pageUrl, reason: error instanceof Error ? error.message : "Page capture failed." }));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
