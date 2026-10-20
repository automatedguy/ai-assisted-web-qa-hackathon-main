import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checkNode, platform, runNode, reportError } from './common.mjs';

try {
  checkNode();
  const files = (await readdir(join(platform, 'test'))).filter(name => name.endsWith('.test.ts')).sort().map(name => join('test', name));
  await runNode(['--import', 'tsx', '--test', ...files], { env: { ...process.env, QA_DISABLE_SCREENSHOTS: '1', QA_DISABLE_BROWSER_CHECKS: '1', OPENAI_API_KEY: '' } });
} catch (error) { reportError(error); }
