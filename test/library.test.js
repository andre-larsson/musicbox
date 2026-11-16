import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScoreLibrary, scoreInfo, importText, NEW_SCORE, LIBRARY_KEY } from '../editor/library.js';
import { compile } from '../src/score.js';

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  let serial = 0, time = 0;
  const options = { makeId: () => `local:${++serial}`, now: () => String(++time) };
  return { storage, data, library: createScoreLibrary(storage, options), options };
}

test('browser scores and invalid drafts survive reload exactly, including their metadata and selection', () => {
  const { library, storage } = fixture();
  const text = NEW_SCORE.replace('title Untitled', 'title Café ♪\ncomposer Someone\nabout A quiet shore.') + '# work in progress\ntune | nope |\n';
  assert.ok(compile(text).errors.length);
  const record = library.save({ text, name: 'uploaded-file' });
  const restored = createScoreLibrary(storage);
  assert.equal(restored.error, '');
  assert.equal(restored.selected, record.id);
  assert.equal(restored.get(record.id).text, text);
  assert.deepEqual(scoreInfo(text), { title: 'Café ♪', composer: 'Someone', about: 'A quiet shore.', tempo: 96, key: 'A minor', beats: 4, steps: 4 });
  restored.select('scores/demo/night-ferry.scrim');
  assert.equal(createScoreLibrary(storage).selected, 'scores/demo/night-ferry.scrim');
});

test('edits update one browser copy and leave the source and creation time intact', () => {
  const { library } = fixture();
  const original = library.save({ text: NEW_SCORE, name: 'Untitled', source: 'scores/demo/example.scrim' });
  const edit = library.save({ id: original.id, text: NEW_SCORE + '# edited\n', name: original.name });
  assert.equal(library.scores.length, 1);
  assert.equal(edit.createdAt, original.createdAt);
  assert.notEqual(edit.updatedAt, original.updatedAt);
  assert.equal(edit.source, original.source);
  library.get(edit.id).text = 'external mutation';
  assert.equal(library.get(edit.id).text, edit.text);
});

test('reset removes only musicbox data and failed removal keeps scores intact', () => {
  const { library, data, storage } = fixture();
  data.set('another-app', 'keep');
  const record = library.save({ text: NEW_SCORE });
  const remove = storage.removeItem;
  storage.removeItem = () => { throw new Error('blocked'); };
  assert.throws(() => library.reset(), /blocked/);
  assert.equal(library.get(record.id).text, NEW_SCORE);
  storage.removeItem = remove;
  library.reset();
  assert.deepEqual(library.scores, []);
  assert.equal(library.selected, null);
  assert.equal(data.has(LIBRARY_KEY), false);
  assert.equal(data.get('another-app'), 'keep');
});

test('quota failures keep an in-memory draft and report that it was not saved', () => {
  const { storage, library } = fixture();
  const set = storage.setItem;
  storage.setItem = () => { throw new Error('quota'); };
  const record = library.save({ text: NEW_SCORE });
  assert.match(library.error, /Could not save/);
  assert.equal(library.get(record.id).text, NEW_SCORE);
  assert.equal(createScoreLibrary(storage).get(record.id), null);
  storage.setItem = set;
  library.save({ id: record.id, text: NEW_SCORE });
  assert.equal(library.error, '');
  assert.equal(createScoreLibrary(storage).get(record.id).text, NEW_SCORE);
});

test('corrupt or unsupported storage is not silently overwritten, and explicit reset recovers it', () => {
  for (const raw of ['{broken', '{"version":99,"scores":[]}', '{"version":1,"scores":[{}]}']) {
    const { storage, data, options } = fixture();
    data.set(LIBRARY_KEY, raw);
    const library = createScoreLibrary(storage, options);
    assert.match(library.error, /Could not read/);
    library.save({ text: NEW_SCORE });
    assert.equal(data.get(LIBRARY_KEY), raw);
    library.reset();
    const record = library.save({ text: NEW_SCORE });
    assert.equal(library.error, '');
    assert.equal(createScoreLibrary(storage).get(record.id).text, NEW_SCORE);
  }
  const unavailable = createScoreLibrary(null);
  const record = unavailable.save({ text: NEW_SCORE });
  assert.equal(unavailable.get(record.id).text, NEW_SCORE);
  assert.match(unavailable.error, /Could not read/);
});

test('Open accepts original Scrimshaw and Markdown-wrapped musicbox scores without losing text', () => {
  const original = readFileSync(new URL('fixtures/scrimshaw/01-moonlit-harbor.scrim', import.meta.url), 'utf8');
  assert.equal(importText(original), original);
  assert.deepEqual(compile(importText(original)).errors, []);
  assert.equal(importText('\uFEFF' + original), original);
  assert.equal(importText('Here is the score:\n```scrim\n' + NEW_SCORE + '```\nTry it.'), NEW_SCORE);
  assert.throws(() => importText(''), /Choose a score/);
  assert.throws(() => importText('```scrim\n' + NEW_SCORE + '```\n```scrim\n' + NEW_SCORE + '```'), /one complete score/);
  assert.deepEqual(compile(NEW_SCORE).errors, []);
  assert.deepEqual(compile(NEW_SCORE).warnings, []);
});
