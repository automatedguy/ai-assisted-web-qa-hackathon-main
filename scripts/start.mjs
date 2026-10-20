import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, platform, requirePlatform, loadEnvironment, checkPort, port, reportError } from './common.mjs';

const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping local services. Saved history is retained.');
  await Promise.all(children.map(child => new Promise(resolve => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send('shutdown', () => {});
    else child.kill('SIGTERM');
  })));
  process.exitCode = code;
  if (process.connected) process.disconnect();
}
function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: platform, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  children.push(child);
  child.once('error', error => { reportError(error); void stop(1); });
  child.once('exit', (code, signal) => { if (!stopping) { console.error(`A service exited (${signal || code}).`); void stop(code || 1); } });
  return child;
}
async function ready(url) {
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* boot */ }
    await delay(100);
  }
  if (!stopping) throw new Error(`Service did not become ready at ${url}. Check the startup messages above.`);
}
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
process.on('message', message => { if (message === 'shutdown') void stop(); });
try {
  loadEnvironment();
  if (process.argv.slice(2).some(flag => flag !== '--platform-only')) throw new Error('Usage: npm start or npm run start:platform.');
  try { requirePlatform.resolve('tsx'); requirePlatform.resolve('express'); }
  catch { throw new Error('Dependencies are missing. Run npm run setup first.'); }
  const appPort = port(process.env.PORT, 3000, 'PORT'), sitePort = port(process.env.PRACTICE_SITE_PORT, 8080, 'PRACTICE_SITE_PORT');
  const localSite = `http://localhost:${sitePort}`;
  const site = new URL(process.env.SITE_URL || localSite);
  const managedSite = !process.argv.includes('--platform-only') && ['localhost', '127.0.0.1'].includes(site.hostname) && site.protocol === 'http:' && Number(site.port || 80) === sitePort;
  if (managedSite && sitePort === appPort) throw new Error('PORT and PRACTICE_SITE_PORT must be different.');
  const host = process.env.HOST || '127.0.0.1';
  await checkPort(appPort, host);
  if (managedSite) await checkPort(sitePort);
  const env = { ...process.env, HOST: host, PORT: String(appPort), PRACTICE_SITE_PORT: String(sitePort), SITE_URL: site.href };
  if (managedSite) {
    launch([join(root, 'scripts/practice-site.mjs')], env);
    await ready(`http://127.0.0.1:${sitePort}/`);
  }
  if (!stopping) {
    launch(['--import', 'tsx', 'src/server.ts'], env);
    await ready(`http://127.0.0.1:${appPort}/api/health`);
    if (!stopping) {
      console.log(`\nDashboard: http://localhost:${appPort}\n${managedSite ? 'Practice site' : 'Configured site'}: ${site.href}`);
      console.log('Ready. Press Ctrl+C to stop. Use Test configuration to choose the site/profile for your next run.');
      if (!env.OPENAI_API_KEY) console.log('No API key configured: link-only checks are available.');
    }
  }
} catch (error) { reportError(error); await stop(1); }
