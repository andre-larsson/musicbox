import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compile } from '../src/score.js';
import { analyze } from '../src/analyze.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const head = 'tempo 120\nvoice lead flute\nvoice pad strings\nvoice bass upright\nvoice kick kick\n';

// Hashes of the events the original Scrimshaw parser produced for its example scores, leaving
// out each slide's source note (`g`). If one of these changes, musicbox no longer plays Scrimshaw
// scores the same way. Slides are the one deliberate difference: Scrimshaw slid a `~` note from
// the voice's last note in the previous section; musicbox slides from the note before it.
const UPSTREAM = {
  '01-moonlit-harbor.scrim': '5c64d02f146cc071',
  '02-rusty-anchor.scrim': 'fd35d3e9cad2f8e8',
  '03-ghost-galleon.scrim': 'acf865968fcb4ae0',
  '04-jungle-path.scrim': '574d2bb214855104',
  '05-duel-on-the-docks.scrim': '644b3e64dc126bee',
  '06-lantern-waltz.scrim': '066fde49d955f7f0'
};
const noSlides = evs => evs.map(({ g, ...e }) => e);

test('Scrimshaw example scores compile exactly as upstream, apart from slide sources', () => {
  for (const [file, h] of Object.entries(UPSTREAM)) {
    const s = compile(read('scores/scrimshaw/' + file));
    assert.deepEqual(s.errors, [], file);
    assert.deepEqual(s.warnings, [], file);
    assert.equal(hash(JSON.stringify({ intro: noSlides(s.intro.events), loop: noSlides(s.loop.events) })), h, file);
  }
});

test('a ~ note slides from the note before it in the same voice', () => {
  const s = compile(head + 'pattern A\nbass | D2:4 ~A2:4 E2:4 ~G2:4 |\npattern B\nbass | ~D2:8 .:8 |\nloop A B');
  assert.deepEqual(s.errors, []);
  const slides = s.loop.events.filter(e => e.g != null).map(e => [e.g, e.m[0]]);
  assert.deepEqual(slides, [[38, 45], [40, 43], [43, 38]]);
  // the upstream examples now slide the way they are written: D2 to A2, A2 to D3, E1 to E2
  const harbor = compile(read('scores/scrimshaw/01-moonlit-harbor.scrim'));
  assert.deepEqual([...harbor.intro.events, ...harbor.loop.events].filter(e => e.g != null).map(e => [e.g, e.m.at(-1)]),
    [[38, 45], [45, 50], [38, 45], [45, 50], [40, 45], [52, 45]]);
});

test('the demo score compiles cleanly', () => {
  const s = compile(read('scores/demo/tide-caves.scrim'));
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.cueOrder, ['explore', 'combat', 'victory']);
  assert.equal(s.defaultCue, 'explore');
});

test(':N lengths match dashes', () => {
  const a = compile(head + 'pattern A\nlead | D5--- .--- [Dm]------- |\nloop A');
  const b = compile(head + 'pattern A\nlead | D5:4 .:4 [Dm]:8 |\nloop A');
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(a.loop.events, b.loop.events);
  const c = compile(head + 'pattern A\nlead | D5:4 -:4 .:8 |\nloop A');
  assert.equal(c.loop.events[0].d, compile(head + 'pattern A\nlead | D5:8 .:8 |\nloop A').loop.events[0].d);
});

test(':N and dashes together is an error; wrong totals name the bar', () => {
  const s = compile(head + 'pattern A\nlead | D5--:4 .:12 |\nloop A');
  assert.match(s.errors[0].msg, /both dashes and :N/);
  const t = compile(head + 'pattern A\nlead | D5:4 E5:4 | F5:15 |\nloop A');
  assert.equal(t.errors.length, 2);
  assert.match(t.errors[0].msg, /Bar 1 of "lead" in pattern A has 8 steps/);
  assert.match(t.errors[1].msg, /Bar 2 of "lead" in pattern A has 15 steps/);
  // the error points at the line that holds the bar, not the voice's first line
  const u = compile(head + 'pattern A\nlead | C5:16 | C5:16 |\nlead | C5:16 | C5:12 |\nloop A');
  assert.equal(u.errors[0].line, 8);
});

test('[*] follows the harmony line, including through %', () => {
  const s = compile(head + 'pattern A\nharmony | C | F G |\npad | [*]:16 | [*]:8 [*]:8 |\nlead | [*]:16 | % |\nloop A');
  assert.deepEqual(s.errors, []);
  const pad = s.loop.events.filter(e => e.v === 1).map(e => e.m.map(m => m % 12).sort((a, b) => a - b));
  assert.deepEqual(pad, [[0, 4, 7], [0, 5, 9], [2, 7, 11]]);
  // % repeats bar 1's rhythm but takes the chord from bar 2's harmony (F at the downbeat)
  const lead = s.loop.events.filter(e => e.v === 0).map(e => e.m.map(m => m % 12).sort((a, b) => a - b));
  assert.deepEqual(lead, [[0, 4, 7], [0, 5, 9]]);
});

test('harmony line: even split, explicit lengths, and mistakes', () => {
  const ok = compile(head + 'pattern A\nharmony | Dm:12 A7:4 | Bb C | % | = |\nloop A');
  assert.deepEqual(ok.errors, []);
  // bar 3 (%) repeats Bb C; bar 4 (=) holds bar 3's C for another whole bar
  assert.deepEqual(ok.patterns.A.harmony.map(h => [h.sym, h.step, h.len]),
    [['Dm', 0, 12], ['A7', 12, 4], ['Bb', 16, 8], ['C', 24, 8], ['Bb', 32, 8], ['C', 40, 24]]);
  const mixed = compile(head + 'pattern A\nharmony | Dm:12 A7 |\nloop A');
  assert.match(mixed.errors[0].msg, /every chord a length or none/);
  const uneven = compile(head + 'pattern A\nharmony | Dm A7 C |\nloop A');
  assert.match(uneven.errors[0].msg, /doesn't divide evenly/);
  const unknown = compile(head + 'pattern A\nharmony | Dzz |\nloop A');
  assert.match(unknown.errors[0].msg, /Can't read|Unknown chord/);
  const noHarmony = compile(head + 'pattern A\npad | [*]:16 |\nloop A');
  assert.match(noHarmony.errors[0].msg, /no harmony line/);
  const reserved = compile('voice harmony flute\npattern A\nharmony | C |\nloop A');
  assert.match(reserved.errors[0].msg, /"harmony" is the chord line/);
});

test('chord symbols in sections follow arrangement transposition', () => {
  const s = compile(head + 'pattern A\nharmony | Dm | Bb/D |\nlead | D5:16 | D5:16 |\nloop A+2');
  assert.deepEqual(s.loop.sections[0].harmony.map(h => h.sym), ['Em', 'C/E']);
});

test('warnings: short parts and patterns nothing plays', () => {
  const s = compile(head + 'pattern A\nlead | D5:16 | E5:16 |\nbass | D2:16 |\npattern B\nlead | C5:16 |\nloop A');
  assert.deepEqual(s.errors, []);
  assert.equal(s.warnings.length, 2);
  assert.match(s.warnings[0].msg, /"bass" has 1 bar in pattern A, but the pattern is 2 bars long/);
  assert.match(s.warnings[1].msg, /Pattern "B" is never played/);
});

test('errors in patterns that are never played still show up', () => {
  const s = compile(head + 'pattern A\nlead | D5:16 |\npattern B\nlead | C5:3 |\nloop A');
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0].msg, /pattern B has 3 steps/);
});

test('cues, then, and switch lines', () => {
  const src = head + `pattern A\nlead | D5:16 |\npattern B\nlead | E5:16 |\npattern hit\nkick | xxxx xxxx xxxx XXXX |
cue calm
play A
loop B
cue fight
loop B*2
cue win
play A
then calm
switch calm -> fight at beat via hit fade 1
switch * -> win at now`;
  const s = compile(src);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.warnings, []);
  assert.equal(s.defaultCue, 'calm');
  assert.equal(s.cues.win.then, 'calm');
  assert.equal(s.cues.fight.loop.sections.length, 2);
  assert.deepEqual(s.transitions.map(t => [t.from, t.to, t.at, t.fade, t.viaName]), [['calm', 'fight', 'beat', 1, 'hit'], ['*', 'win', 'now', null, null]]);
  assert.equal(s.transitions[0].via.events.length, 16);

  const bad = compile(head + 'pattern A\nlead | D5:16 |\ncue a\nloop A\nthen nowhere\nswitch a -> b at sometime');
  const msgs = bad.errors.map(e => e.msg).join('\n');
  assert.match(msgs, /"at sometime"/);
  assert.match(msgs, /"b" isn't a cue/);
  assert.match(msgs, /"nowhere", which isn't a cue/);
  assert.match(bad.warnings.map(w => w.msg).join('\n'), /loops forever, so its "then" never happens/);
});

test('scores without cue lines get a "main" cue', () => {
  const s = compile(head + 'pattern A\nlead | D5:16 |\npattern B\nlead | E5:16 |');
  assert.deepEqual(s.cueOrder, ['main']);
  assert.deepEqual(s.cues.main.loop.sections.map(x => x.name), ['A', 'B']);
});

test('layer= and key are parsed', () => {
  const s = compile('key F# dorian\nvoice a flute layer=2\npattern A\nkey Bb major\na | C5:16 |\nloop A');
  assert.deepEqual(s.errors, []);
  assert.equal(s.voices[0].layer, 2);
  assert.equal(s.key.name, 'F# dorian');
  assert.equal(s.patterns.A.key.name, 'Bb major');
  assert.match(compile('key H minor').errors[0].msg, /Can't read the key/);
});

test('analyze flags out-of-range notes and non-chord tones', () => {
  const s = compile('key C major\nvoice lead flute\npattern A\nharmony | C | G |\nlead | C3:16 | F#5:16 |\nloop A');
  const { text, findings } = analyze(s);
  assert.equal(findings.range.length, 1);
  assert.match(text, /C3 is below the usual flute range/);
  assert.deepEqual(findings.harmony.map(f => [f.bar, f.notes[0], f.chord]), [[2, 'F#5', 'G']]);
  assert.deepEqual(findings.key.map(f => f.note), ['F#']);
});
