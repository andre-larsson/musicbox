// Random parts: {…} notes, chance= and jitter=, the arpeggiator, {B C} pattern choices,
// beds, seeds, and switch * -> *.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../src/score.js';
import { createRng, realize, pass } from '../src/random.js';
import { MusicPlayer } from '../src/player.js';
import { analyze } from '../src/analyze.js';

const head = 'tempo 120\nkey A minor\nvoice a celesta center=A4\n';
const ok = s => { assert.deepEqual(s.errors, [], JSON.stringify(s.errors)); return s; };
const msgs = s => s.errors.map(e => e.msg).join('\n');

test('{…} keeps every choice, and rests count as choices', () => {
  const s = ok(compile(head + 'pattern A\na | {A4 C5 .}:4 {E5,G5}--- .:8 |\nloop A'));
  const evs = s.loop.events;
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[0].pick, [[69], [72], []]);
  assert.equal(evs[0].m, undefined);
  assert.deepEqual(evs[1].pick, [[76], [79]]);
  assert.ok(Math.abs(evs[1].d - 0.5) < 1e-9, 'the length after the braces counts: 4 steps = 0.5 s');
});

test('{chord} follows the harmony line, also through %', () => {
  const s = ok(compile(head + 'pattern A\nharmony | Am | F |\na | {chord}:16 | % |\nloop A'));
  const pcs = e => e.pick.map(o => o[0] % 12).sort((x, y) => x - y);
  assert.deepEqual(pcs(s.loop.events[0]), [0, 4, 9]);
  assert.deepEqual(pcs(s.loop.events[1]), [0, 5, 9]);
});

test('{scale} picks from the key in the octave around center', () => {
  const s = ok(compile(head + 'pattern A\na | {scale}:16 |\nloop A'));
  assert.deepEqual(s.loop.events[0].pick.map(o => o[0]), [64, 65, 67, 69, 71, 72, 74]); // E4 to D5, around A4
  assert.match(msgs(compile('voice a flute\npattern A\na | {scale}:16 |')), /needs? .*key|there's no key/i);
});

test('bad braces give clear errors on the right line', () => {
  const s = compile(head + 'pattern A\na | {A4 X9}:16 |\na | {A4 C5:16 |\nloop A');
  assert.equal(s.errors.length, 2, msgs(s));
  assert.equal(s.errors[0].line, 5);
  assert.match(s.errors[0].msg, /X9/);
  assert.equal(s.errors[1].line, 6);
});

test('chance=, jitter= and the arp options are read; arp needs a melodic voice', () => {
  const s = ok(compile('voice p sine chance=0.7 jitter=0.2 arp=updown rate=3 span=2 pool=scale\npattern A\np | C4:16 |'));
  const v = s.voices[0];
  assert.deepEqual([v.chance, v.jitter, v.arp, v.rate, v.span, v.pool], [0.7, 0.2, 'updown', 3, 2, 'scale']);
  assert.match(msgs(compile('voice k kick arp=up\npattern A\nk | x... |')), /melodic/);
  assert.match(msgs(compile('voice p sine arp=sideways\npattern A\np | C4:16 |')), /arp= takes/);
});

test('the arpeggiator plays chords up, down and up-down, one note every rate steps', () => {
  const notes = arp => compile(`voice p harp arp=${arp} rate=2\npattern A\np | C4+E4+G4:16 |`).loop.events.map(e => e.m[0]);
  assert.deepEqual(notes('up'), [60, 64, 67, 60, 64, 67, 60, 64]);
  assert.deepEqual(notes('down'), [67, 64, 60, 67, 64, 60, 67, 64]);
  assert.deepEqual(notes('updown'), [60, 64, 67, 64, 60, 64, 67, 64]);
  const span = compile('voice p harp arp=up rate=4 span=2\npattern A\np | C4+E4:16 |').loop.events.map(e => e.m[0]);
  assert.deepEqual(span, [60, 64, 72, 76]);
  const single = compile('voice p harp arp=up rate=4\npattern A\np | C4:16 |').loop.events;
  assert.equal(single.length, 1, 'single notes play as written');
});

test('arp on [*] follows chord changes inside a long note; arp=random and pool=scale make choices', () => {
  const s = ok(compile(head.replace('center=A4', 'center=A4 arp=up rate=8') + 'pattern A\nharmony | Am F |\na | [*]:16 |\nloop A'));
  // up: the 1st note of Am around A4 (E4), then the 2nd note of F around A4 (F4 A4 C5), A4
  assert.deepEqual(s.loop.events.map(e => e.m[0]), [64, 69]);
  const r = ok(compile(head.replace('center=A4', 'center=A4 arp=random rate=4 pool=scale') + 'pattern A\nharmony | Am |\na | [*]:16 |\nloop A'));
  assert.equal(r.loop.events.length, 4);
  assert.equal(r.loop.events[0].pick.length, 7, 'the seven notes of A minor from the chord\'s lowest note');
});

test('{B C} in a loop line compiles each choice once and repeats choices as weights', () => {
  const s = ok(compile(head + 'pattern A\na | A4:16 |\npattern B\na | C5:16 |\npattern C\na | E5:16 | E5:16 |\ncue x\nloop A {B C C}'));
  const c = s.cues.x;
  assert.equal(c.loopSlots.length, 2);
  assert.equal(c.loopSlots[1].length, 3);
  assert.equal(c.loopSlots[1][1], c.loopSlots[1][2], 'C is compiled once');
  assert.deepEqual(c.loop.sections.map(x => x.name), ['A', 'B'], 'loop holds the first choices');
  const names = new Set();
  const rng = createRng(3);
  for (let i = 0; i < 60; i++) names.add(pass(c, 'loop', rng).sections.map(x => x.name).join(' '));
  assert.deepEqual([...names].sort(), ['A B', 'A C']);
  assert.match(analyze(s).text, /loop A \{B C C\} \(2–3 bars/);
  assert.equal(s.warnings.length, 0, 'patterns used only inside braces count as played');
  assert.match(msgs(compile(head + 'pattern A\na | A4:16 |\ncue x\nloop A {}')), /Empty braces/);
});

test('realize: chance, rests, jitter, and seeds', () => {
  const ev = { t: 0, d: 1, v: 0, vel: 0.8, pick: [[60], [64], []] };
  const rng = createRng(42);
  const seen = new Set(); let silent = 0;
  for (let i = 0; i < 300; i++) {
    const r = realize(ev, { chance: 1, jitter: 0.2 }, rng);
    if (!r) { silent++; continue; }
    seen.add(r.ev.m[0]);
    assert.ok(r.dt >= 0 && r.dt < 0.2);
    assert.equal(r.ev.pick, undefined);
  }
  assert.deepEqual([...seen].sort(), [60, 64]);
  assert.ok(silent > 60 && silent < 140, 'the rest is picked about a third of the time');
  assert.equal(realize({ t: 0, m: [60] }, { chance: 0 }, rng), null);
  const a = createRng(7), b = createRng(7);
  assert.deepEqual(Array.from({ length: 5 }, a), Array.from({ length: 5 }, b));
});

test('beds: declared once, chosen per cue, and checked', () => {
  const src = head + 'bed sea sea vol=0.5\nbed hum drone note=A1 layer=1\npattern A\na | A4:16 |\ncue x\nloop A\nbeds sea=0.4\ncue y\nloop A\n';
  const s = ok(compile(src));
  assert.deepEqual(s.beds.map(b => [b.name, b.inst, b.note]), [['sea', 'sea', null], ['hum', 'drone', 33]]);
  assert.deepEqual(s.cues.x.beds, { sea: 0.4 });
  assert.equal(s.cues.y.beds, null, 'no beds line: every bed plays');
  assert.match(analyze(s).text, /sea\s+sea\s+vol 0\.5\s+in x ×0\.4, y/);
  const bad = compile(head + 'bed hum drone\nbed a sea\nbed w fog\npattern A\na | A4:16 |\nbeds sea\ncue x\nloop A\nbeds nope');
  const m = msgs(bad);
  assert.match(m, /drone needs a pitch/);
  assert.match(m, /already/);
  assert.match(m, /Unknown bed "fog"/);
  assert.match(m, /goes in a cue/);
  assert.match(m, /"nope" isn't a bed/);
});

test('switch * -> * is allowed, and the player prefers the most specific rule', () => {
  const s = ok(compile(head + 'pattern A\na | A4:16 |\ncue x\nloop A\ncue y\nloop A\nswitch * -> * at beat\nswitch x -> * at pattern\nswitch * -> y at loop'));
  const p = new MusicPlayer({ autoTick: false });
  p.song = s;
  assert.equal(p.findRule('x', 'y').at, 'loop');
  assert.equal(p.findRule('x', 'x').at, 'pattern');
  assert.equal(p.findRule('y', 'x').at, 'beat');
});

test('the analyzer flags random choices that rub, not colour notes', () => {
  const s = compile('tempo 120\nvoice a celesta\npattern A\nharmony | Am | E |\na | {D5 G5 B5}:16 | {A4 C5 D5 G5}:16 |\nloop A');
  const f = analyze(s).findings.pick;
  assert.equal(f.length, 1, 'D, G and B over Am are colour');
  assert.deepEqual([f[0].bar, f[0].notes], [2, ['A4', 'C5', 'G5']], 'A over G#, C over B, G against the major third');
});

/* ------------------------------------------------------------------ player */

function fakes(seed) {
  const ctx = { currentTime: 0, state: 'running', resume() {}, destination: {} };
  const played = [], beds = [];
  const param = () => ({
    value: 0, target: null, at: null,
    cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v, t) { this.target = v; this.at = t; }
  });
  const synth = {
    out: { gain: param() },
    warm() {},
    session(song) {
      return {
        bus: { gain: param(), disconnect() {} }, sendBus: { gain: param(), disconnect() {} },
        ch: song.voices.map(v => ({ v, def: { level: 1 }, input: { gain: param() } })),
        play(ev, t) { played.push({ ev, t, voice: song.voices[ev.v].name }); },
        stop() {}
      };
    },
    bed(def) {
      const b = { def, input: { gain: param() }, level: 1, stopped: null, stop(fade, at) { this.stopped = { fade, at }; } };
      beds.push(b);
      return b;
    }
  };
  const player = new MusicPlayer({ context: ctx, synth, autoTick: false, seed });
  const runTo = t => { while (ctx.currentTime < t) { ctx.currentTime = Math.min(t, ctx.currentTime + 0.025); player.tick(); } };
  return { ctx, player, played, beds, runTo };
}

const dice = `tempo 120
voice a celesta chance=0.5 jitter=0.1
pattern A
a | {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 {A4 C5 E5}:2 |
pattern B
a | B4:16 |
cue x
loop A {A B}
`;

test('the player rolls the dice as it goes, and a seed repeats the music', () => {
  const run = seed => { const f = fakes(seed); f.player.load(dice); f.player.play('x'); f.runTo(20); return f.played.map(p => `${p.ev.m[0]}@${p.t.toFixed(4)}`); };
  const a = run(5), b = run(5), c = run(6);
  assert.deepEqual(a, b, 'same seed, same music');
  assert.notDeepEqual(a, c, 'another seed, other music');
  const f = fakes(5); f.player.load(dice); f.player.play('x'); f.runTo(20);
  const late = f.played.filter(p => p.voice === 'a' && p.ev.m[0] !== 71).map(p => (p.t - 0.1) % 0.25);
  assert.ok(late.some(x => x > 0.01) && late.every(x => x < 0.1 + 1e-9), 'jitter delays notes by up to 0.1 s');
  assert.ok(f.played.some(p => p.ev.m[0] === 71), 'pattern B comes up');
  assert.equal(f.player.state.seed, 5);
});

test('beds start with the music, change level on a switch, and stop with it', () => {
  const src = `tempo 120
bed sea sea vol=0.5
bed gust wind vol=1 layer=1
voice a celesta
pattern A
a | A4:16 |
cue calm
loop A
beds sea
cue storm
loop A
beds sea=0.5 gust
switch * -> * at bar fade 3
`;
  const { player, beds, runTo } = fakes(1);
  player.load(src);
  player.play('calm', { intensity: 0 });
  runTo(0.5);
  const [sea, gust] = beds;
  assert.equal(beds.length, 2);
  assert.equal(sea.input.gain.target, 0.5, 'sea plays in calm');
  assert.equal(gust.input.gain.target, 0, 'gust is not in calm');
  player.goto('storm');
  runTo(3);
  assert.equal(beds.length, 2, 'the same beds keep going');
  assert.equal(sea.input.gain.target, 0.25);
  assert.equal(gust.input.gain.target, 0, 'gust is layer 1 and the intensity is 0');
  player.setIntensity(1);
  assert.equal(gust.input.gain.target, 1);
  player.mute('sea');
  assert.equal(sea.input.gain.target, 0);
  player.stop(1);
  assert.ok(sea.stopped && gust.stopped);
});

test('the demo scores compile cleanly and play', () => {
  for (const f of ['brinelight', 'night-ferry']) {
    const text = readFileSync(new URL(`../scores/demo/${f}.scrim`, import.meta.url), 'utf8');
    const s = compile(text);
    assert.deepEqual(s.errors, [], f);
    assert.deepEqual(s.warnings, [], f);
    const { player, played, runTo } = fakes(9);
    player.load(text);
    player.play();
    runTo(30);
    player.goto(s.cueOrder[1]);
    runTo(60);
    assert.ok(played.length > 50, f);
    assert.equal(player.state.cue, s.cueOrder[1]);
  }
});
