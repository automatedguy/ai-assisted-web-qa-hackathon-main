import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit, executeAudit } from '../src/orchestrator/audit.js';
import { catalogReport } from './catalog-cases.js';

if (process.env.QA_ALLOW_LIVE_AUDIT !== '1') throw new Error('Set QA_ALLOW_LIVE_AUDIT=1 to authorize paid model calls. This is not part of npm test.');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the explicit live audit.');
const audit = createAudit();
await executeAudit(audit, process.env.SITE_URL ?? 'http://localhost:8080', process.env.OPENAI_MODEL ?? 'gpt-6-astra', []);
const report = catalogReport(audit.issues);
const directory = await mkdtemp(join(tmpdir(),'qa-catalog-live-'));
await writeFile(join(directory,'audit.json'),JSON.stringify(audit,null,2));
await writeFile(join(directory,'catalog-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({auditId:audit.id,status:audit.status,findings:audit.issues.length,detected:report.detected,total:report.total,
  missing:report.results.filter(result=>!result.detected).map(result=>result.id),occurrenceChecks:report.occurrenceChecks,directory},null,2));
if (audit.status !== 'completed' || report.detected !== 25 || report.occurrenceChecks.mobileMenuPages !== 3 || report.occurrenceChecks.sortedDateElements !== 4) process.exitCode=1;
