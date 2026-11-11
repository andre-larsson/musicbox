#!/usr/bin/env node
// musicbox check: compile scores, print errors and warnings with line numbers, then an
// analysis report. Exits with status 1 if any score has errors.
// musicbox link: print a link that opens a score in the editor, or read the score in a link.

import { readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { compile } from '../src/score.js';
import { analyze } from '../src/analyze.js';
import { EDITOR_URL, scoreCode } from '../src/link.js';

const USAGE = `Usage:
  musicbox check [--json] [--quiet] FILE.scrim...
      Errors and warnings with line numbers, then an analysis report.
      --quiet   only print errors and warnings, not the analysis report
      --json    print machine-readable results
  musicbox link [--base URL] FILE.scrim
      Print a link that opens the score in the editor, ready to play.
      --base    the editor to link to (default ${EDITOR_URL})
  musicbox link --decode LINK
      Print the score inside a link (for edits made in the editor).`;

const args = process.argv.slice(2);
const cmd = args.shift();

if (cmd === 'link') {
  const bi = args.indexOf('--base');
  const base = bi >= 0 ? args[bi + 1] : EDITOR_URL;
  const rest = args.filter((a, i) => !a.startsWith('--') && !(bi >= 0 && i === bi + 1));
  const decode = args.includes('--decode');
  if (rest.length !== 1 || (bi >= 0 && !base) || args.some(a => a.startsWith('--') && a !== '--decode' && a !== '--base')) { console.error(USAGE); process.exit(2); }
  if (decode) {
    const code = scoreCode(rest[0]) || rest[0].trim();
    try { process.stdout.write(inflateRawSync(Buffer.from(code, 'base64url')).toString('utf8')); }
    catch { console.error("Can't read a score in that link. It may have been cut short when it was copied."); process.exit(1); }
    process.exit(0);
  }
  let text;
  try { text = readFileSync(rest[0], 'utf8'); } catch (e) { console.error(`${rest[0]}: can't read: ${e.message}`); process.exit(1); }
  const song = compile(text);
  if (song.errors.length) {
    for (const e of song.errors) console.error(`${rest[0]}:${e.line}: error: ${e.msg}`);
    console.error('No link: fix the errors first (musicbox check shows them all).');
    process.exit(1);
  }
  console.log(base.replace(/#.*$/, '') + '#score=' + deflateRawSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64url'));
  process.exit(0);
}
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
