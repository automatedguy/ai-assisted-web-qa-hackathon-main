import { copyFile, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { checkNode, root, platform, npmCli, runNode, requirePlatform, reportError } from './common.mjs';

try {
  checkNode();
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--with-deps')) throw new Error('Usage: npm run setup [-- --with-deps]. Use --with-deps for Linux browser system packages.');
  try {
    await copyFile(join(root, '.env.example'), join(root, '.env'), constants.COPYFILE_EXCL);
    console.log('Created .env. Add your OPENAI_API_KEY for model-backed audits; link checks work without it.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Keeping your existing .env unchanged.');
  }
  console.log('Installing the exact dependencies from platform-template/package-lock.json…');
  await runNode([npmCli(), 'ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: platform });
  console.log('Installing Playwright Chromium for browser checks and screenshots…');
  await runNode([join(platform, 'node_modules/playwright/cli.js'), 'install', ...(flags.includes('--with-deps') ? ['--with-deps'] : []), 'chromium']);
  requirePlatform.resolve('tsx');
  await runNode([join(root, 'scripts/doctor.mjs')], { cwd: root });
  console.log('\nSetup complete. Run npm start from the repository folder.');
} catch (error) { reportError(error); }
