import type { CrawledPage, PageElement } from "../crawler/crawl.js";
import type { QaIssue } from "../issues.js";

type Span = { start: number; end: number };
const contains = (outer: Span, inner: Span) => outer.start <= inner.start && outer.end >= inner.end;

function uniqueSpan(text: string, quote: string): Span | undefined {
  const start = quote ? text.indexOf(quote) : -1;
  if (start < 0 || text.indexOf(quote, start + 1) !== -1) return;
  return { start, end: start + quote.length };
}

function elementSpan(page: CrawledPage, element: PageElement): Span | undefined {
  const direct = uniqueSpan(page.text, element.text);
  if (direct) return direct;
  // Equal prices in different rows need the row context, not an amount-only match.
  const context = uniqueSpan(page.text, element.context);
  const local = uniqueSpan(element.context, element.text);
  if (context && local) return { start: context.start + local.start, end: context.start + local.end };
}

/** Only reconcile an explicit monetary expression when its entire amount is covered. */
function moneySpans(text: string): Span[] {
  const number = String.raw`\d+(?:[.,]\d+)*(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?`;
  const currency = String.raw`(?:\p{Sc}|[A-Z]{3})`;
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}.,])(?:${currency}\s*${number}|${number}\s*${currency})(?![\p{L}\p{N}.,])`, "gu");
  return [...text.matchAll(pattern)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
}

/**
 * Return the per-location Locale findings covering EVERY quoted price, or nothing.
 * An ambiguous/uncovered price must not disappear merely because another price matches.
 * No amounts, currency conversions or replacement text are inferred here.
 */
export function coveredCurrencyFindings(format: QaIssue, issues: QaIssue[], pages: CrawledPage[]): QaIssue[] | undefined {
  if (format.category !== "formatting" || format.assessment?.rule?.id !== "currency_format" || format.reproduction) return;
  const page = pages.find(page => page.url === format.location.page_url);
  if (!page?.elements) return;
  let scope = uniqueSpan(page.text, format.evidence);
  const prices = moneySpans(format.evidence);
  if (!prices.length) return;
  // A bare decimal elsewhere in the quote may be an additional price without a symbol.
  if ([...format.evidence.matchAll(/\d+[.,]\d+/g)].some(match =>
    !prices.some(price => contains(price, { start: match.index!, end: match.index! + match[0].length })))) return;
  if (format.location.selector_or_xpath) {
    const element = page.elements.find(element => element.selector === format.location.selector_or_xpath);
    const range = element && elementSpan(page, element);
    const local = element && uniqueSpan(element.text, format.evidence);
    if (!range || !local) return;
    scope = { start: range.start + local.start, end: range.start + local.end };
  }
  if (!scope) return;
  const candidates = issues.filter(issue => issue.category === "locale_rules" && issue.assessment?.rule?.id === "currency" &&
    issue.location.page_url === page.url && !issue.reproduction && issue.location.selector_or_xpath);
  const covered = new Set<QaIssue>();
  for (const price of prices) {
    const absolute = { start: scope.start + price.start, end: scope.start + price.end };
    const matches = candidates.filter(issue => {
      const element = page.elements!.find(element => element.selector === issue.location.selector_or_xpath);
      const range = element && elementSpan(page, element);
      const quote = element && uniqueSpan(element.text, issue.evidence);
      if (!range || !quote) return false;
      return contains({ start: range.start + quote.start, end: range.start + quote.end }, absolute);
    });
    if (matches.length !== 1) return;
    covered.add(matches[0]);
  }
  return [...covered];
}
