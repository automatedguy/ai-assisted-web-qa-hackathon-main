import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Audit } from './orchestrator/audit.js';
import type { QaIssue } from './issues.js';
import { summarizeRun, summarizeSpending, type RunSummary } from './history.js';
import { runCost } from './dashboard/public/costs.js';

export class RunStore {
  private db: DatabaseSync;
  private inTransaction = false;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version as number;
    if (version > 1) { this.db.close(); throw new Error('History database is newer than this application.'); }
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, site_url TEXT NOT NULL, kind TEXT NOT NULL,
          started_at TEXT NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL, summary TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);
        CREATE INDEX IF NOT EXISTS runs_site ON runs(site_url, kind, started_at DESC);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_decisions (
          site_url TEXT NOT NULL, issue_id TEXT NOT NULL, issue TEXT NOT NULL,
          PRIMARY KEY(site_url, issue_id)
        );
        CREATE TABLE IF NOT EXISTS review_events (
          id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), issue_id TEXT NOT NULL,
          previous_status TEXT NOT NULL, status TEXT NOT NULL, reviewed_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    });
  }
  private transaction<T>(operation: () => T): T {
    if (this.inTransaction) return operation();
    this.db.exec('BEGIN IMMEDIATE'); this.inTransaction = true;
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.inTransaction = false; }
  }
  close() { this.db.close(); }
  save(run: Audit, makeCurrent = false) {
    const summary = summarizeRun(run);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO runs (id, site_url, kind, started_at, status, snapshot, summary) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, snapshot=excluded.snapshot, summary=excluded.summary`)
        .run(run.id, summary.siteUrl, summary.kind, run.startedAt, run.status, JSON.stringify(run), JSON.stringify(summary));
      if (makeCurrent) this.db.prepare("INSERT INTO metadata VALUES ('current_run', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(run.id);
    });
  }
  get(id: string): Audit | null {
    const row = this.db.prepare('SELECT snapshot FROM runs WHERE id=?').get(id) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) : null;
  }
  current(): Audit | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='current_run'").get() as { value: string } | undefined;
    return row?.value ? this.get(row.value) : null;
  }
  list(limit = 50, offset = 0) {
    const rows = this.db.prepare('SELECT summary FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?').all(limit, offset) as { summary: string }[];
    const { total } = this.db.prepare('SELECT COUNT(*) AS total FROM runs').get() as { total: number };
    return { runs: rows.map(row => JSON.parse(row.summary) as RunSummary), total, limit, offset };
  }
  spending() {
    const rows = this.db.prepare('SELECT summary FROM runs').all() as { summary: string }[];
    return summarizeSpending(rows.map(row => JSON.parse(row.summary)));
  }
  previous(run: Audit): Audit | null {
    const summary = summarizeRun(run);
    const row = this.db.prepare(`SELECT snapshot FROM runs WHERE site_url=? AND kind=? AND id<>? AND started_at<=?
      AND status<>'running' ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(summary.siteUrl, summary.kind, run.id, run.startedAt) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) : null;
  }
  reviewIssues(siteUrl: string): QaIssue[] {
    return (this.db.prepare('SELECT issue FROM review_decisions WHERE site_url=?').all(siteUrl) as { issue: string }[])
      .map(row => JSON.parse(row.issue));
  }
  review(runId: string, issueId: string, status: QaIssue['status']) {
    return this.transaction(() => {
      const run = this.get(runId);
      if (!run) return null;
      if (run.status === 'running') throw new Error('Wait for this run to finish before reviewing findings.');
      const issue = run.issues.find(item => item.id === issueId);
      if (!issue) return null;
      const previous = issue.status;
      issue.status = status;
      this.save(run);
      this.db.prepare(`INSERT INTO review_decisions VALUES (?, ?, ?) ON CONFLICT(site_url, issue_id) DO UPDATE SET issue=excluded.issue`)
        .run(run.siteUrl ?? run.crawl?.startUrl ?? '', issue.id, JSON.stringify(issue));
      this.db.prepare('INSERT INTO review_events (run_id, issue_id, previous_status, status, reviewed_at) VALUES (?, ?, ?, ?, ?)')
        .run(run.id, issue.id, previous, status, new Date().toISOString());
      return issue;
    });
  }
  reviews(runId: string) {
    return this.db.prepare('SELECT issue_id AS issueId, previous_status AS previousStatus, status, reviewed_at AS reviewedAt FROM review_events WHERE run_id=? ORDER BY id').all(runId);
  }
  clearCurrent(siteUrl: string) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM metadata WHERE key='current_run'").run();
      // Preserve historical decisions, but reset carry-forward decisions for a fresh workspace.
      this.db.prepare('DELETE FROM review_decisions WHERE site_url=?').run(siteUrl);
    });
  }
  recoverInterrupted() {
    const rows = this.db.prepare("SELECT snapshot FROM runs WHERE status='running'").all() as { snapshot: string }[];
    this.transaction(() => {
      for (const row of rows) {
        const run: Audit = JSON.parse(row.snapshot);
        run.status = 'partial'; run.phase = 'Interrupted'; run.interrupted = true;
        run.error = 'Server stopped before this run finished. Saved findings and usage were recovered; requests after the last checkpoint may be missing. Start a new run to finish checking.';
        run.finishedAt = new Date().toISOString();
        for (const worker of run.workers) {
          if (worker.status === 'running') {
            worker.status = 'failed'; worker.usageComplete = false; worker.estimatedCostUsd = null;
            worker.message = 'Interrupted by server restart; usage may be incomplete.';
          } else if (worker.status === 'queued') { worker.status = 'skipped'; worker.message = 'Not run before server restart.'; }
        }
        run.cost = runCost(run);
        this.save(run);
      }
    });
    return rows.length;
  }
}
