import type { Profile } from "../config.js";
import type { CrawledPage } from "../crawler/crawl.js";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A narrow, source-authorized price repair. Never infer exchange rates or use profile example amounts. */
export function sourcePriceCorrection(page: CrawledPage, evidence: string, profile: Profile, source?: string): string | undefined {
  const policy = profile.locale.currency ?? profile.locale.currency_format;
  if (typeof policy !== "string" || !source) return;
  const code = /\b[A-Z]{3}\b/.exec(policy)?.[0];
  if (!code) return;
  const cells = page.elements?.filter(element => element.tag === "td" && element.text.includes(evidence) && element.entity) ?? [];
  if (cells.length !== 1) return;
  const entity = cells[0].entity!;
  if (entity.length < 2) return;
  try {
    const format = new Intl.NumberFormat(profile.locale.target_locale, { style: "currency", currency: code });
    const symbol = format.formatToParts(0).find(part => part.type === "currency")!.value.normalize("NFKC");
    const token = `(?:${escape(code)}|${escape(symbol)})`;
    const price = new RegExp(`${token}\\s*(\\d+(?:[.,]\\d{1,2})?)(?![\\d.,])|(?<![\\d.,])(\\d+(?:[.,]\\d{1,2})?)\\s*${token}`, "gu");
    const entityMatch = new RegExp(`(?:^|[\\s*|—-])${escape(entity)}(?=[\\s*|—:,-]|$)`, "u");
    const amounts = new Set(source.normalize("NFKC").split("\n").filter(line => entityMatch.test(line)).flatMap(line =>
      [...line.matchAll(price)].map(match => Number((match[1] ?? match[2]).replace(",", ".")))));
    if (amounts.size !== 1) return;
    const amount = [...amounts][0];
    // Accept only a single, simple price expression, not grouped amounts or arbitrary numbers.
    const observed = /^(\p{Sc}|[A-Z]{3})\s*(\d+(?:[.,]\d{1,2})?)([^\d.,].*)?$|^(\d+(?:[.,]\d{1,2})?)\s*(\p{Sc}|[A-Z]{3})(.*)$/u.exec(evidence.trim());
    if (!observed || Number((observed[2] ?? observed[4]).replace(",", ".")) !== amount) return;
    const suffix = observed[3] ?? observed[6] ?? "";
    let corrected = format.format(amount).replace(/\u00a0|\u202f/g, " ");
    const notation = String(profile.locale.currency_format ?? "");
    // Only override placement when explicitly stated; unknown prose stays with the locale formatter.
    const parts = format.formatToParts(amount);
    let number = parts.filter(part => !["currency", "literal"].includes(part.type)).map(part => part.value).join("");
    if (/comma decimal/i.test(notation) && !parts.some(part => part.type === "group")) number = number.replace(".", ",");
    if (/dot decimal/i.test(notation) && !parts.some(part => part.type === "group")) number = number.replace(",", ".");
    if (/symbol after amount/i.test(notation)) corrected = number + " " + symbol;
    if (/symbol before amount/i.test(notation)) corrected = symbol + number;
    return corrected + suffix;
  } catch { return; }
}
