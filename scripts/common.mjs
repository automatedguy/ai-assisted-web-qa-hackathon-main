import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const platform = join(root, 'platform-template');
export const requirePlatform = createRequire(join(platform, 'package.json'));
export function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error(`Node.js ${version} is too old. Install Node.js 22.18+ (latest 22.x recommended), then reopen your terminal.`);
}
export function loadEnvironment() {
  checkNode();
  const path = process.env.QA_ENV_FILE ? resolve(process.env.QA_ENV_FILE) : join(root, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
  else if (process.env.QA_ENV_FILE) throw new Error('QA_ENV_FILE does not exist.');
  // A copied template must not appear to be a working API credential.
  if (process.env.OPENAI_API_KEY === 'replace_with_your_key') process.env.OPENAI_API_KEY = '';
}
export function port(value, fallback, name) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${name} must be an integer between 1 and 65535.`);
  return number;
}
export async function checkPort(number, host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Port ${number} is unavailable. Stop the existing service or change PORT / PRACTICE_SITE_PORT in .env.`)));
    server.listen(number, host, () => server.close(resolve));
  });
}
export function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: platform, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed (${code ?? 'signal'}): node ${args[0]}`)));
  });
}
export function npmCli() {
  const executable = dirname(process.execPath);
  const candidates = [process.env.npm_execpath, join(executable, 'node_modules/npm/bin/npm-cli.js'), join(executable, '../lib/node_modules/npm/bin/npm-cli.js')];
  const path = candidates.find(path => path && existsSync(path));
  if (!path) throw new Error('npm could not be found. Run this through npm run setup using the Node.js installation that includes npm.');
  return path;
}
export function reportError(error) { console.error(`\nSetup/startup failed: ${error.message}`); process.exitCode = 1; }
