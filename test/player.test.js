import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MusicPlayer, boundaryAfter } from '../src/player.js';
import { compile } from '../src/score.js';

// A fake AudioContext clock and a synth that records what would have played.
function fakes() {
  const ctx = { currentTime: 0, state: 'running', resume() {}, destination: {} };
  const played = [];
  const param = () => ({
    value: 1, target: null, at: null,
    cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v, t) { this.target = v; this.at = t; }
  });
  let sessions = 0;
  const synth = {
    out: { gain: param() },
    warm() {},
    session(song) {
      const id = ++sessions;
      return {
        id, bus: { gain: param(), disconnect() {} }, sendBus: { gain: param(), disconnect() {} },
        ch: song.voices.map(v => ({ v, def: { level: 1 }, input: { gain: param() } })),
        play(ev, t) { played.push({ ev, t, session: id, voice: song.voices[ev.v].name }); },
        stop() {}
      };
    }
  };
  const player = new MusicPlayer({ context: ctx, synth, autoTick: false });
  const runTo = t => { while (ctx.currentTime < t) { ctx.currentTime = Math.min(t, ctx.currentTime + 0.025); player.tick(); } };
  return { ctx, synth, player, played, runTo };
}

const score = `tempo 120
voice lead flute
voice drum kick layer=1
pattern A
lead | C5:4 D5:4 E5:4 F5:4 | G5:16 |
drum | x... x... x... x... | % |
pattern B
lead | A5:8 B5:8 |
pattern hit
drum | xxxx xxxx xxxx XXXX |
cue calm
loop A
cue fight
loop B
cue win
play B
then calm
switch calm -> fight at bar via hit
`;
// at 120 bpm with 4 steps per beat a bar lasts 2 s

test('boundaryAfter finds beats, bars and pattern ends', () => {
  const s = compile(score);
  const tl = s.cues.calm.loop; // one section, 2 bars, 4 s
  assert.equal(boundaryAfter(tl, 0, 'bar'), 0);
  assert.equal(boundaryAfter(tl, 0.1, 'bar'), 2);
  assert.equal(boundaryAfter(tl, 0.1, 'beat'), 0.5);
  assert.equal(boundaryAfter(tl, 2.6, 'pattern'), 4);
  assert.equal(boundaryAfter(tl, 3.9, 'bar'), 4);
  assert.equal(boundaryAfter(tl, 3.0, 'loop'), 4);
});

test('play schedules the cue and loops it', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(9);
  const leads = played.filter(p => p.voice === 'lead');
  // 5 lead notes per 4 s loop, loop starts at 0.1
  assert.ok(leads.length >= 10);
  assert.ok(Math.abs(leads[5].t - 4.1) < 1e-9);
});

test('goto switches on the next bar, through the via pattern, with nothing overlapping', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(0.9);
  player.goto('fight');
  runTo(8);
  const old = played.filter(p => p.session === 1);
  const fresh = played.filter(p => p.session === 2);
  const T = 2.1; // first bar line after the queued notes (start at 0.1 + one 2 s bar)
  assert.ok(old.every(p => p.t < T - 1e-9), 'old cue stops at the switch');
  assert.ok(Math.abs(fresh[0].t - T) < 1e-9, 'new music starts on the bar line');
  const via = fresh.filter(p => p.t < T + 2 - 1e-9);
  assert.equal(via.length, 16, 'the hit pattern plays once');
  assert.ok(via.every(p => p.voice === 'drum'));
  assert.equal(fresh.find(p => p.voice === 'lead').t, T + 2, 'fight starts after the hit');
  assert.equal(player.target, 'fight');
});

test('goto to the cue already playing does nothing', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(1);
  player.goto('calm');
  runTo(5);
  assert.ok(played.every(p => p.session === 1));
});

test('a later goto replaces a pending one', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(0.5);
  player.goto('fight');               // pending: would start the hit at 2.1
  player.goto('win', { at: 'beat' }); // replaces it before it starts
  runTo(6);
  assert.deepEqual([...new Set(played.map(p => p.session))], [1, 2], 'the fight run never opened');
  const win = played.filter(p => p.session === 2);
  assert.ok(Math.abs(win[0].t - 1.1) < 1e-9, 'win starts on the first beat after the queued notes');
  assert.equal(win[0].ev.m[0], 81, 'with pattern B (A5), not the hit');
  assert.equal(player.target, 'calm', 'win plays once, then hands over to calm');
});

test('setIntensity turns layers on and off', () => {
  const { player, runTo } = fakes();
  player.load(score);
  player.play('calm', { intensity: 0 });
  runTo(0.2);
  const run = [...player.runs][0];
  assert.equal(run.sess.ch[1].input.gain.value, 0, 'layer 1 starts silent');
  assert.equal(run.sess.ch[0].input.gain.value, 0.8, 'layer 0 plays');
  player.setIntensity(1, { fade: 0.5 });
  assert.equal(run.sess.ch[1].input.gain.target, 0.8);
  player.setIntensity(0, { at: 'bar' });
  assert.equal(run.sess.ch[1].input.gain.target, 0);
  assert.ok(Math.abs(run.sess.ch[1].input.gain.at - 2.1) < 1e-9, 'fade starts on the bar line');
});

test('events and state report what is audible', () => {
  const { player, runTo } = fakes();
  player.load(score);
  const seen = [];
  player.on('cue', d => seen.push('cue:' + d.cue));
  player.on('pattern', d => seen.push('pattern:' + d.pattern));
  player.play('win');
  runTo(1.0);
  assert.deepEqual(player.state.cue, 'win');
  assert.equal(player.state.bar, 1);
  runTo(2.5);
  assert.equal(player.state.cue, 'calm');
  assert.equal(player.state.pattern, 'A');
  assert.deepEqual(seen, ['cue:win', 'pattern:B', 'cue:calm', 'pattern:A']);
});

test('load rejects scores with errors', () => {
  const { player } = fakes();
  assert.throws(() => player.load('voice a flute\npattern A\na | C5:3 |'), e => e.errors.length === 1);
});

test('the demo score plays every cue', () => {
  const { player, played, runTo } = fakes();
  player.load(readFileSync(new URL('../scores/demo/tide-caves.scrim', import.meta.url), 'utf8'));
  player.play();
  runTo(6);
  player.goto('combat');
  runTo(20);
  player.goto('victory');
  runTo(30);
  assert.equal(player.target, 'explore');
  assert.ok(new Set(played.map(p => p.session)).size >= 3);
});

test('play can start part of the way into a cue, picking up notes that are still sounding', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm', { part: 'loop', time: 2.5 }); // half a second into the G5 of bar 2
  runTo(1);
  const lead = played.filter(p => p.voice === 'lead');
  assert.equal(lead.length, 1);
  assert.deepEqual(lead[0].ev.m, [79]);
  assert.ok(Math.abs(lead[0].t - 0.1) < 1e-9, 'the held note starts at once');
  const full = compile(score).cues.calm.loop.events.find(e => e.m && e.m[0] === 79);
  assert.ok(Math.abs(lead[0].ev.d - (full.d - 0.5)) < 1e-9, 'with only what is left of it');
  const kicks = played.filter(p => p.voice === 'drum');
  // hits at 2.5, 3 and 3.5 s into the loop; the one at 2 s is before the start point
  assert.deepEqual(kicks.map(p => +p.t.toFixed(6)), [0.1, 0.6, 1.1], 'drum hits before the start point are skipped');
  const st = player.state;
  assert.equal(st.part, 'loop');
  assert.equal(st.bar, 2);
  assert.ok(Math.abs(st.time - 3.4) < 1e-9);
  assert.equal(st.length, 4);
});

test('seek jumps within the part playing and keeps the same pass', () => {
  const { player, played, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(1);
  const sections = player.state.sections;
  player.seek(0.5);
  assert.equal(player.state.time, 0.5, 'the position moves at once');
  runTo(1.5);
  const fresh = played.filter(p => p.session === 2);
  assert.ok(fresh.length > 0, 'a new run plays from the seek point');
  assert.ok(Math.abs(fresh[0].t - 1.1) < 1e-9);
  assert.deepEqual(fresh.filter(p => Math.abs(p.t - 1.1) < 1e-9).map(p => p.voice).sort(), ['drum', 'lead']);
  assert.equal(player.state.sections, sections, 'the same pass');
  assert.equal(player.target, 'calm');
});

test('state counts the passes through a loop', () => {
  const { player, runTo } = fakes();
  player.load(score);
  player.play('calm');
  runTo(1);
  assert.equal(player.state.pass, 1);
  runTo(9);
  assert.equal(player.state.pass, 3);
  player.stop();
  assert.equal(player.state.playing, false);
  assert.equal(player.state.cue, null);
});
