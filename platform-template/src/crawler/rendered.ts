import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";
import type { CrawledPage } from "./crawl.js";
import type { BrowserStep, Reproduction } from "../issues.js";

export type Observation = {
  id: string; selector: string; text: string; tag: string; context: string;
  datetime?: string; reproduction: Reproduction;
};
export type RenderedPage = {
  status: "completed" | "partial" | "skipped";
  states: number; observations: Observation[];
  resources: Array<{ selector: string; url: string; reproduction: Reproduction }>;
  limitations: string[];
};
const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
export async function replaySteps(page: Page, steps: BrowserStep[]) {
  for (const step of steps) {
    const locator = page.locator(step.selector);
    if (step.action === "fill") await locator.fill(step.value ?? "");
    else if (step.action === "select") await locator.selectOption(step.value ?? "");
    else if (step.action === "check") await locator.check();
    else await locator.click();
  }
}

// Browser-side function: no project helpers, network calls, or fixture selectors.
function inspectDocument() {
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const selector = (el: Element): string => {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    for (const attr of ["data-id", "data-key", "data-name"]) {
      const value = el.getAttribute(attr);
      if (value) {
        const candidate = el.tagName.toLowerCase() + "[" + attr + "=" + JSON.stringify(value) + "]";
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
    }
    if (!el.parentElement) return el.tagName.toLowerCase();
    const siblings = [...el.parentElement.children].filter(item => item.tagName === el.tagName);
    return selector(el.parentElement) + " > " + el.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
  };
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,li,td,th,time,button,a,label,summary,[role=status],[role=alert],input,textarea")].filter(visible);
  const observations: Array<{ selector: string; text: string; tag: string; context: string; attribute?: string; datetime?: string }> = [];
  for (const node of nodes) {
    const base = { selector: selector(node), tag: node.tagName.toLowerCase(), context: clean(node.closest("tr,li,section,form,nav")?.textContent ?? "").slice(0, 1000) };
    const text = clean(node.innerText ?? "");
    if (text && !nodes.some(other => other !== node && node.contains(other) && clean(other.innerText ?? ""))) {
      observations.push({ ...base, text, datetime: node.getAttribute("datetime") ?? undefined });
    }
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const value = node.getAttribute(attribute);
      if (value?.trim()) observations.push({ ...base, text: value, attribute });
    }
  }
  const steps: BrowserStep[] = [];
  for (const node of document.querySelectorAll<HTMLInputElement>("input[type=radio]")) {
    if (visible(node) && !node.disabled && !node.checked) steps.push({ action: "check", selector: selector(node) });
  }
  for (const node of document.querySelectorAll<HTMLSelectElement>("select")) {
    if (visible(node) && !node.disabled) for (const option of node.options) {
      if (!option.disabled && option.value !== node.value) steps.push({ action: "select", selector: selector(node), value: option.value });
    }
  }
  for (const node of document.querySelectorAll<HTMLInputElement>("input[type=search],input[role=searchbox]")) {
    if (visible(node) && !node.disabled && !node.readOnly) {
      const names = [...(node.closest("section,main") ?? document).querySelectorAll<HTMLElement>("[data-name]")]
        .map(el => el.dataset.name!).filter(Boolean).slice(0, 2);
      for (const value of [...names, "qa-no-match-7f39b2"]) steps.push({ action: "fill", selector: selector(node), value });
    }
  }
  for (const node of document.querySelectorAll<HTMLElement>("details:not([open]) > summary,button[type=button][aria-controls][aria-expanded=false]")) {
    // Never activate arbitrary submit/delete/purchase buttons. Only disclosures/navigation.
    const controlled = document.getElementById(node.getAttribute("aria-controls") ?? "");
    if (visible(node) && (node.tagName === "SUMMARY" || controlled?.matches("nav,[role=navigation]"))) steps.push({ action: "click", selector: selector(node) });
  }
  const resources = [...document.images].filter(visible).map(node => ({
    selector: `(//img)[${[...document.images].indexOf(node) + 1}]`, url: node.currentSrc || node.src,
  }));
  return { observations, steps, resources };
}

export async function collectRenderedPages(pages: CrawledPage[]): Promise<void> {
  const eligible = pages.filter(page => page.status >= 200 && page.status < 300);
  for (const page of eligible) page.rendered = { status: "completed", states: 0, observations: [], resources: [], limitations: [] };
  if (process.env.QA_DISABLE_BROWSER_CHECKS === "1") {
    for (const page of eligible) Object.assign(page.rendered!, { status: "skipped", limitations: ["Browser-state checks disabled; interactive and accessible states were not checked."] });
    return;
  }
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}) }); }
  catch {
    for (const page of eligible) Object.assign(page.rendered!, { status: "partial", limitations: ["Browser unavailable; interactive states were not checked. Install Chromium or configure QA_BROWSER_PATH."] });
    return;
  }
  try {
    for (const source of eligible) {
      const result = source.rendered!;
      const seen = new Set<string>();
      const budget = Math.max(1, Math.min(40, Number(process.env.QA_MAX_STATES_PER_VIEWPORT) || 16));
      const deadline = Date.now() + 60000;
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport, serviceWorkers: "block" });
        await context.addInitScript("globalThis.__name = (fn) => fn;");
        await context.route("**/*", route => {
          const request = route.request();
          const allowed = request.method() === "GET" && new URL(request.url()).origin === new URL(source.url).origin && request.resourceType() !== "media";
          return allowed ? route.continue() : route.abort();
        });
        const page = await context.newPage(); page.setDefaultTimeout(2500);
        const visit = async (steps: BrowserStep[]) => {
          await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 10000 });
          await replaySteps(page, steps);
          await page.waitForTimeout(100);
          const snapshot = await page.evaluate(inspectDocument);
          const reproduction: Reproduction = { viewport, steps, stateId: "state-" + createHash("sha256").update(JSON.stringify([viewport, steps])).digest("hex").slice(0, 12) };
          result.states++;
          for (const item of snapshot.observations) {
            if (!item.attribute && !item.datetime && source.text.includes(item.text)) continue;
            const key = JSON.stringify([item.selector, item.attribute, item.text]);
            if (seen.has(key)) continue;
            seen.add(key);
            result.observations.push({ ...item, id: "observed-" + createHash("sha256").update(key).digest("hex").slice(0, 16),
              reproduction: { ...reproduction, attribute: item.attribute } });
          }
          for (const item of snapshot.resources) if (!result.resources.some(existing => existing.selector === item.selector && existing.url === item.url)) {
            result.resources.push({ ...item, reproduction: { ...reproduction, resourceUrl: item.url } });
          }
          return snapshot.steps;
        };
        try {
          const actions = await visit([]);
          if (actions.length + 1 > budget) { result.status = "partial"; result.limitations.push(`State budget reached at ${viewport.width}px; some controls were not explored.`); }
          for (const action of actions.slice(0, budget - 1)) {
            if (Date.now() > deadline) { result.status = "partial"; result.limitations.push("60-second page exploration budget reached."); break; }
            try { await visit([action]); }
            catch { result.status = "partial"; result.limitations.push(`Could not explore ${action.action} ${action.selector} at ${viewport.width}px.`); }
          }
        } catch { result.status = "partial"; result.limitations.push(`Could not capture initial state at ${viewport.width}px.`); }
        finally { await context.close(); }
      }
      result.limitations.push("Scope: desktop/mobile initial states and independent single-action controls; combinations, authenticated flows and submissions are not explored.");
    }
  } finally { await browser.close(); }
}
