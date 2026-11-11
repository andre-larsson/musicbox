import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeScore, decodeScore, scoreLink, scoreCode, EDITOR_URL } from '../src/link.js';

const cli = fileURLToPath(new URL('../bin/musicbox.js', import.meta.url));
const demo = fileURLToPath(new URL('../scores/demo/night-ferry.scrim', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('the editor code round-trips a score, including non-ASCII text', async () => {
  const text = readFileSync(demo, 'utf8') + '\n# café ♪\n';
  assert.equal(await decodeScore(await encodeScore(text)), text);
  const link = await scoreLink(text);
  assert.ok(link.startsWith(EDITOR_URL + '#score='));
  assert.equal(scoreCode(link), link.split('#score=')[1]);
  assert.equal(scoreCode('#a=1&score=abc_-9'), 'abc_-9');
  assert.equal(scoreCode('https://example.com/editor/'), null);
});

test('links from the CLI open in the editor, and the editor\'s links decode in the CLI', async () => {
  const text = readFileSync(demo, 'utf8');
  const url = execFileSync(process.execPath, [cli, 'link', demo], { encoding: 'utf8' }).trim();
  assert.equal(await decodeScore(scoreCode(url)), text, 'zlib in the CLI, DecompressionStream in the editor');
  const fromEditor = await scoreLink(text, 'http://127.0.0.1:5178/editor/');
  assert.equal(run('link', '--decode', fromEditor).stdout, text);
  const based = run('link', '--base', 'http://127.0.0.1:5178/editor/?x=1#old', demo).stdout.trim();
  assert.match(based, /^http:\/\/127\.0\.0\.1:5178\/editor\/\?x=1#score=[A-Za-z0-9_-]+$/);
});

test('no link for a score with errors, and a clear message for a cut-off link', () => {
  const r = run('link', '/dev/null');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No link/);
  const cut = run('link', '--decode', 'https://a403.space/musicbox/editor/#score=rVXbbuM2EH');
  assert.equal(cut.status, 1);
  assert.match(cut.stderr, /cut short/);
  assert.equal(run('link').status, 2);
});
