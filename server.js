/**
 * Smart Attendance Management System - local development server.
 *
 * Zero dependencies on purpose: the whole app is plain HTML/CSS/JavaScript,
 * so we only need something that serves the folder over http:// (a http origin
 * is required by ES modules and by the camera API - file:// will not work).
 *
 * Run with:  npm start      (or:  node server.js)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.join(ROOT, path.normalize(pathname));

    // Basic path-traversal guard: never serve anything outside the project root.
    if (!filePath.startsWith(ROOT)) {
      send(res, 403, 'Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        send(res, 404, `404 - Not found: ${pathname}`, { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    send(res, 500, `500 - ${error.message}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  const modelsReady = fs.existsSync(path.join(ROOT, 'vendor', 'face-api', 'face-api.js'));
  console.log('');
  console.log('  Smart Attendance Management System');
  console.log('  ----------------------------------');
  console.log(`  Local URL   : http://${HOST}:${PORT}`);
  console.log(`  Face models : ${modelsReady ? 'found in ./vendor/face-api' : 'MISSING - run "npm run setup"'}`);
  console.log('');
  console.log('  Open the Local URL in Chrome or Edge. Press Ctrl+C to stop.');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try: $env:PORT=5174; npm start\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});