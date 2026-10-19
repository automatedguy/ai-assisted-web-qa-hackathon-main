import { createHash } from "node:crypto";
import type { QaIssue } from "../issues.js";
import type { CrawledPage } from "../crawler/crawl.js";
import { coveredCurrencyFindings } from "./currency-reconciliation.js";

export function locateFindings(issues: QaIssue[], page?: CrawledPage): QaIssue[] {
  if (!page?.elements) return issues;
  const elements = page.elements;
  return issues.flatMap(issue => {
    if (issue.location.selector_or_xpath) return [issue];
    const target = issue.category === "translation_quality" ? /\nTarget[^:]*: “([\s\S]*)”$/.exec(issue.evidence)?.[1] : issue.evidence;
    if (!target) return [issue];
    const matches = elements.filter(element => element.text.includes(target));
    if (!matches.length) return [issue];
    // Prefer the smallest containing element, without collapsing repeated independent occurrences.
    return matches.filter(element => !matches.some(other => other !== element && other.ancestors?.includes(element.selector))).map(element => ({ ...issue,
      id: issue.id + "-" + createHash("sha256").update(element.selector).digest("hex").slice(0, 8),
      location: { ...issue.location, selector_or_xpath: element.selector } }));
  });
}

function includeCurrencyNotation(currency: QaIssue, format: QaIssue) {
  const note = `The same expression also violates currency notation: ${format.assessment!.rule!.value}.`;
  if (!currency.description.includes(note)) currency.description += " " + note;
}

export function reconcileFindings(issues: QaIssue[], pages: CrawledPage[] = []): QaIssue[] {
  const result: QaIssue[] = [];
  const ordered = [...issues].sort((a, b) => Number(b.assessment?.rule?.id === "currency") - Number(a.assessment?.rule?.id === "currency") || b.evidence.length - a.evidence.length);
  for (const issue of ordered) {
    const covered = coveredCurrencyFindings(issue, result, pages);
    if (covered) {
      for (const currency of covered) includeCurrencyNotation(currency, issue);
      continue;
    }
    const same = result.find(existing => {
      if (!issue.location.selector_or_xpath || existing.location.page_url !== issue.location.page_url || existing.location.selector_or_xpath !== issue.location.selector_or_xpath) return false;
      if (existing.reproduction?.attribute !== issue.reproduction?.attribute) return false;
      if (existing.assessment?.check !== issue.assessment?.check) return false;
      const overlap = existing.evidence.includes(issue.evidence) || issue.evidence.includes(existing.evidence);
      // With page evidence, the all-price coverage check above owns currency merging.
      const currencyOverlap = !pages.length && existing.assessment?.rule?.id === "currency" && issue.assessment?.rule?.id === "currency_format";
      // Never merge unrelated defects in the same paragraph, independent media resources or distinct state text.
      return overlap && (currencyOverlap || existing.category === issue.category &&
        (existing.category === "brand_voice" || existing.expected === issue.expected && existing.assessment?.rule?.id === issue.assessment?.rule?.id));
    });
    if (!same) result.push(issue);
    else if (same.assessment?.rule?.id === "currency" && issue.assessment?.rule?.id === "currency_format") {
      includeCurrencyNotation(same, issue);
    }
  }
  return issues.filter(issue => result.includes(issue));
}
