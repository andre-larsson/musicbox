#!/usr/bin/env node
// Dev server for the editor: serves the repo read-only on localhost, lists scores, and
// tells open editors when a .scrim file changes so they reload it.
//
//   node bin/serve.js                 the editor on the repo, with live reload
//   node bin/serve.js --static dist   a build, served the way GitHub Pages serves it

import http from 'node:http';
import { createReadStream, statSync, watch } from 'node:fs';
import { join, normalize, extname, sep, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listScores } from './list-scores.js';

const si = process.argv.indexOf('--static');
const staticDir = si > 1 ? process.argv[si + 1] : null;
if (si > 1 && !staticDir) { console.error('Usage: serve.js --static DIR'); process.exit(1); }
const root = staticDir ? resolve(staticDir) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scoresDir = join(root, 'scores');
const port = Number(process.env.PORT || 5178);
const host = '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.scrim': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml'
};

const clients = new Set();
const pending = new Map();
if (!staticDir) try {
  watch(scoresDir, { recursive: true }, (_ev, file) => {
    if (!file || !String(file).endsWith('.scrim')) return;
    const rel = 'scores/' + String(file).split(sep).join('/');
    clearTimeout(pending.get(rel));
    // editors often write a file in several steps; wait for it to settle
    pending.set(rel, setTimeout(() => {
      pending.delete(rel);
      for (const res of clients) res.write(`data: ${JSON.stringify({ file: rel })}\n\n`);
    }, 80));
  });
} catch (e) {
  console.warn(`Not watching scores/ for changes: ${e.message}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}`);
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }

  if (path === '/' && !staticDir) { res.writeHead(302, { Location: '/editor/' }).end(); return; }
  if (path === '/__scores' && !staticDir) {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(listScores(root)));
    return;
  }
  if (path === '/__watch' && !staticDir) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

  // static files inside the repo, never dotfiles (.git and friends)
  let file = normalize(join(root, path));
  if (!file.startsWith(root + sep) || path.split('/').some(p => p.startsWith('.'))) { res.writeHead(404).end(); return; }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); }
  } catch { res.writeHead(404, { 'Content-Type': TYPES['.txt'] }).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`musicbox editor: http://${host}:${port}/${staticDir ? '' : 'editor/'}`);
  console.log(staticDir ? `Serving the build in ${staticDir}, as GitHub Pages would.` : 'Watching scores/ — saved .scrim files reload in the editor.');
});
