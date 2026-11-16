import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenScore, createResetLibrary } from '../editor/scorefiles.js';
import { NEW_SCORE } from '../editor/library.js';

function fixture(ids) {
  const parts = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', files: [] }]));
  const events = {};
  const dialog = {
    open: false, querySelector: selector => parts[selector.slice(1)],
    showModal() { this.open = true; }, close() { this.open = false; events.close?.(); },
    addEventListener: (name, callback) => { events[name] = callback; }
  };
  return { button: {}, dialog, parts };
}

test('Open reads a file for review and imports exactly one complete pasted score', async () => {
  const { button, dialog, parts } = fixture(['openFile', 'openText', 'openStatus', 'importScore', 'cancelOpen']);
  const opened = [];
  createOpenScore(button, dialog, (text, name) => opened.push({ text, name }));
  button.onclick();
  parts.openFile.files = [{ name: 'shore.scrim', text: async () => NEW_SCORE }];
  await parts.openFile.onchange();
  assert.equal(parts.openText.value, NEW_SCORE);
  assert.equal(opened.length, 0, 'choosing a file waits for Open score');
  await parts.importScore.onclick();
  assert.deepEqual(opened, [{ text: NEW_SCORE, name: 'shore' }]);
  assert.equal(dialog.open, false);
  button.onclick(); parts.openFile.files = [];
  parts.openText.value = '```scrim\n' + NEW_SCORE + '```';
  await parts.importScore.onclick();
  assert.equal(opened[1].text, NEW_SCORE);
  button.onclick();
  await parts.importScore.onclick();
  assert.equal(dialog.open, true, 'empty input leaves the dialog open with a useful error');
  assert.match(parts.openStatus.textContent, /Choose a score/);
});

test('cancelled file reads cannot overwrite the next import', async () => {
  const { button, dialog, parts } = fixture(['openFile', 'openText', 'openStatus', 'importScore', 'cancelOpen']);
  createOpenScore(button, dialog, () => {});
  button.onclick();
  let finish;
  parts.openFile.files = [{ name: 'slow.scrim', text: () => new Promise(resolve => { finish = resolve; }) }];
  const reading = parts.openFile.onchange();
  parts.cancelOpen.onclick();
  button.onclick(); parts.openText.value = 'new paste';
  finish(NEW_SCORE); await reading;
  assert.equal(parts.openText.value, 'new paste');
});

test('reset requires its explicit action, preserves data on error, and can be cancelled while loading', async () => {
  const { button, dialog, parts } = fixture(['resetStatus', 'resetCount', 'cancelReset', 'confirmReset']);
  let resets = 0, signal;
  createResetLibrary(button, dialog, { count: () => 3, onReset: async value => { signal = value; resets++; throw new Error('blocked'); } });
  button.onclick();
  assert.equal(resets, 0);
  assert.match(parts.resetCount.textContent, /3 scores/);
  await parts.confirmReset.onclick();
  assert.equal(resets, 1);
  assert.ok(dialog.open);
  assert.match(parts.resetStatus.textContent, /scores have been kept/);
  parts.cancelReset.onclick();
  assert.ok(signal.aborted);

  let finish;
  createResetLibrary(button, dialog, { count: () => 3, onReset: value => {
    signal = value; return new Promise(resolve => { finish = resolve; });
  } });
  button.onclick();
  const pending = parts.confirmReset.onclick();
  parts.cancelReset.onclick();
  assert.ok(signal.aborted, 'the caller can stop fetching and skip deletion after cancellation');
  finish(); await pending;
  assert.equal(dialog.open, false);
});
