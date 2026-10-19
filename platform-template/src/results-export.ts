import type { Audit } from './orchestrator/audit.js';
import { summarizeRun } from './history.js';
import { htmlReport } from './html-report.js';

export type ExportFormat = 'html' | 'csv';

// Quote every cell and neutralize formula-like text before opening in spreadsheets.
// HTML displays the original evidence verbatim.
function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function exportResults(run: Audit, format: ExportFormat, reviewHistory: unknown[], screenshotDirectory: string, exportedAt = new Date().toISOString()) {
  const summary = summarizeRun(run);
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  const filename = `skynet-results-${safe(run.startedAt)}-${safe(run.id)}.${format}`;
  if (format === 'html') {
    return { filename, contentType: 'text/html; charset=utf-8', body: await htmlReport(run, reviewHistory, screenshotDirectory, exportedAt) };
  }

  const headers = ['run_id', 'run_kind', 'site_url', 'run_status', 'started_at', 'finished_at', 'exported_at',
    'target_locale', 'id', 'category', 'severity', 'status', 'page_url', 'selector_or_xpath', 'element_type',
    'description', 'evidence', 'expected', 'suggested_fix', 'confidence', 'assessment_method', 'assessment_check',
    'rule_id', 'rule_value', 'screenshot_path', 'screenshot_highlighted', 'screenshot_note', 'reproduction_json'];
  const rows = run.issues.map(issue => [run.id, summary.kind, summary.siteUrl, run.status, run.startedAt, run.finishedAt,
    exportedAt, run.targetLocale, issue.id, issue.category, issue.severity, issue.status, issue.location.page_url,
    issue.location.selector_or_xpath, issue.location.element_type, issue.description, issue.evidence, issue.expected,
    issue.suggested_fix, issue.confidence, issue.assessment?.method, issue.assessment?.check, issue.assessment?.rule?.id,
    issue.assessment?.rule?.value, issue.visual_evidence?.screenshot_url, issue.visual_evidence?.highlighted,
    issue.visual_evidence?.note, issue.reproduction ? JSON.stringify(issue.reproduction) : undefined]);
  return { filename, contentType: 'text/csv; charset=utf-8',
    body: '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' };
}
