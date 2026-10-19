import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

// Keep defaults independent of the shell's working directory. Never store data
// in the read-only profile/reference mounts or expose the database as an asset.
export const dataDir = resolve(process.env.QA_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
export const databasePath = join(dataDir, 'history.sqlite');
export const screenshotDir = process.env.SCREENSHOT_DIR || join(dataDir, 'screenshots');
