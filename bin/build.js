#!/usr/bin/env node
// Builds the static site for GitHub Pages: the editor, the library, every score plus an index
// of them (scores/index.json stands in for the dev server's list), the format reference and
// the licence files. Fails if any score has errors, so a broken score never goes live.
//
//   node bin/build.js [OUT_DIR]     (default: dist/)

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/score.js';
import { listScores } from './list-scores.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'dist'));
const rel = relative(out, root);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) {
  console.error(`Refusing to build into ${out}: it would replace the repository.`);
  process.exit(1);
}

const scores = listScores(root);
let failed = false;
for (const f of scores) {
  const s = compile(readFileSync(join(root, f), 'utf8'));
  for (const e of s.errors) { console.error(`${f}:${e.line}: error: ${e.msg}`); failed = true; }
}
if (failed) { console.error('Not building: fix the score errors first.'); process.exit(1); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const d of ['editor', 'src']) cpSync(join(root, d), join(out, d), { recursive: true });
for (const f of scores) { mkdirSync(dirname(join(out, f)), { recursive: true }); cpSync(join(root, f), join(out, f)); }
writeFileSync(join(out, 'scores', 'index.json'), JSON.stringify(scores, null, 1) + '\n');
mkdirSync(join(out, 'docs'));
cpSync(join(root, 'docs', 'PROMPT.md'), join(out, 'docs', 'PROMPT.md'));
for (const f of ['LICENSE', 'NOTICE', 'README.md']) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>musicbox</title>
<meta http-equiv="refresh" content="0; url=editor/">
<link rel="icon" href="data:,">
</head>
<body>
<p><a href="editor/">Open the musicbox editor</a></p>
</body>
</html>
`);
console.log(`Built ${scores.length} scores into ${relative(root, out) || out}`);
