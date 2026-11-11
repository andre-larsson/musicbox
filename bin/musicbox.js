#!/usr/bin/env node
// musicbox check: compile scores, print errors and warnings with line numbers, then an
// analysis report. Exits with status 1 if any score has errors.

import { readFileSync } from 'node:fs';
import { compile } from '../src/score.js';
import { analyze } from '../src/analyze.js';

const USAGE = `Usage: musicbox check [--json] [--quiet] FILE.scrim...

  --quiet   only print errors and warnings, not the analysis report
  --json    print machine-readable results`;

const args = process.argv.slice(2);
const cmd = args.shift();
const flags = new Set(args.filter(a => a.startsWith('--')));
const files = args.filter(a => !a.startsWith('--'));
for (const f of flags) if (!['--json', '--quiet'].includes(f)) { console.error(`Unknown option ${f}\n\n${USAGE}`); process.exit(2); }
if (cmd !== 'check' || !files.length) { console.error(USAGE); process.exit(2); }

let failed = false;
const results = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`${file}: can't read: ${e.message}`); failed = true; continue; }
  const song = compile(text);
  if (song.errors.length) failed = true;
  const report = song.errors.length ? null : analyze(song);
  if (flags.has('--json')) {
    results.push({ file, errors: song.errors, warnings: song.warnings, findings: report && report.findings });
    continue;
  }
  for (const e of song.errors) console.log(`${file}:${e.line}: error: ${e.msg}`);
  for (const w of song.warnings) console.log(`${file}:${w.line}: warning: ${w.msg}`);
  if (song.errors.length) { console.log(`${file}: ${song.errors.length} error${song.errors.length === 1 ? '' : 's'}`); continue; }
  if (!flags.has('--quiet')) console.log(`${files.length > 1 ? '\n== ' + file + '\n' : ''}${report.text}`);
  else if (!song.warnings.length) console.log(`${file}: ok`);
}
if (flags.has('--json')) console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
