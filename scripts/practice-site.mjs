import { join } from 'node:path';
import { root, requirePlatform, port } from './common.mjs';

const express = requirePlatform('express');
const app = express();
app.use(express.static(join(root, 'site-under-test/public')));
const server = app.listen(port(process.env.PRACTICE_SITE_PORT, 8080, 'PRACTICE_SITE_PORT'), '127.0.0.1');
server.on('error', error => { console.error(`Practice site: ${error.message}`); process.exitCode = 1; });
function stop() { server.closeAllConnections(); server.close(() => process.exit(0)); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
process.on('message', message => { if (message === 'shutdown') stop(); });
