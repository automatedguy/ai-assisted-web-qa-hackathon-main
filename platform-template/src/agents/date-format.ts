import { createHash } from "node:crypto";
import type { QaIssue } from "../issues.js";

type DateParts = { DD: number; MM: number; YYYY: number };
type Token = keyof DateParts;
const orders: Token[][] = [["DD", "MM", "YYYY"], ["MM", "DD", "YYYY"], ["YYYY", "MM", "DD"]];

export function issueId(pageUrl: string, rule: string, evidence: string) {
  return "locale-formatting-" + createHash("sha256").update(`${pageUrl}\n${rule}\n${evidence}`).digest("hex").slice(0, 16);
}

function calendarDate(parts: DateParts) {
  const { DD, MM, YYYY } = parts;
  const leap = YYYY % 4 === 0 && (YYYY % 100 !== 0 || YYYY % 400 === 0);
  return YYYY >= 1 && MM >= 1 && MM <= 12 && DD >= 1 && DD <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][MM - 1];
}

// Only explicit numeric patterns are deterministic. Prose patterns go to the model.
export function checkDateFormat(text: string, pageUrl: string, format: unknown) {
  const issues: QaIssue[] = [];
  const checkedDates: string[] = [];
  if (typeof format !== "string") return { issues, checkedDates };
  const pattern = /^(DD|MM|YYYY)([/.-])(DD|MM|YYYY)\2(DD|MM|YYYY)$/.exec(format.trim());
  if (!pattern) return { issues, checkedDates };
  const order = [pattern[1], pattern[3], pattern[4]] as Token[];
  if (!orders.some(candidate => candidate.join() === order.join())) return { issues, checkedDates };
  const render = (parts: DateParts) => order.map(token => String(parts[token]).padStart(token.length, "0")).join(pattern[2]);
  const dates = /(?<![\p{L}\p{N}/-])(\d{1,4})([/.-])(\d{1,2})\2(\d{1,4})(?![\p{L}\p{N}/-])/gu;
  for (const match of text.matchAll(dates)) {
    const evidence = match[0];
    const values = [match[1], match[3], match[4]];
    if (values[0].length !== 4 && values[2].length !== 4) continue;
    if (checkedDates.includes(evidence)) continue;
    checkedDates.push(evidence);
    const possible = orders.flatMap(candidate => {
      if (values[candidate.indexOf("YYYY")].length !== 4) return [];
      const parts = Object.fromEntries(candidate.map((token, index) => [token, Number(values[index])])) as DateParts;
      return calendarDate(parts) ? [parts] : [];
    });
    const expectedParts = Object.fromEntries(order.map((token, index) => [token, Number(values[index])])) as DateParts;
    if (values[order.indexOf("YYYY")].length === 4 && calendarDate(expectedParts) && render(expectedParts) === evidence) continue;
    const corrections = [...new Set(possible.map(render))];
    const expected = corrections.length === 1 ? corrections[0] : `A valid date in ${format} format; confirm the intended date.`;
    issues.push({
      id: issueId(pageUrl, "date_format", evidence), category: "formatting", severity: "minor",
      location: { page_url: pageUrl, element_type: "text" },
      description: `The date does not follow the configured ${format} calendar-date format.`,
      evidence, expected, confidence: 1, status: "new",
      suggested_fix: corrections.length === 1 ? `Use ${expected}.` : `Confirm the intended date and write it as ${format}.`,
    });
  }
  return { issues, checkedDates };
}
