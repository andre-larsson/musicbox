import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/score.js';

// Every ```scrim block in the docs must be a complete score with no errors or warnings.
for (const doc of ['docs/PROMPT.md', 'README.md']) {
  test(`scores in ${doc} compile cleanly`, () => {
    const text = readFileSync(new URL('../' + doc, import.meta.url), 'utf8');
    const blocks = [...text.matchAll(/```scrim\n([\s\S]*?)```/g)].map(m => m[1]);
    for (const b of blocks) {
      const s = compile(b);
      assert.deepEqual(s.errors, [], b.slice(0, 40));
      assert.deepEqual(s.warnings, [], b.slice(0, 40));
    }
  });
}
