import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listScores } from '../bin/list-scores.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the static build has the editor, the library, every score and an index of them', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'musicbox-build-')), 'site');
  try {
    execFileSync(process.execPath, [join(root, 'bin/build.js'), out], { stdio: 'pipe' });
    const index = JSON.parse(readFileSync(join(out, 'scores/index.json'), 'utf8'));
    assert.deepEqual(index, listScores(root));
    for (const f of [...index, 'editor/index.html', 'editor/editor.js', 'src/player.js', 'src/random.js', 'docs/PROMPT.md', 'LICENSE', 'NOTICE']) {
      assert.ok(existsSync(join(out, f)), f);
    }
    assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /url=editor\//);
    const editor = readFileSync(join(out, 'editor/editor.js'), 'utf8');
    assert.doesNotMatch(editor, /fetch\('\//, 'no root-relative fetches: the site lives under /musicbox/');
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('the build refuses to overwrite the repository', () => {
  assert.throws(() => execFileSync(process.execPath, [join(root, 'bin/build.js'), root], { stdio: 'pipe' }));
});
