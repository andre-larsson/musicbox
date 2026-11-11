// Runtime music player for browser games.
//
//   const music = new MusicPlayer();
//   music.load(scoreText);                 // throws if the score has errors
//   button.onclick = () => music.play('explore');   // first play must follow a user gesture
//   music.goto('combat');                  // switches on the next bar (or as the score's switch line says)
//   music.setIntensity(2);                 // fades layers in and out, keeping everything in sync
//   music.on('cue', ({ cue }) => ...);     // fires when a cue becomes audible
//
// Scheduling: notes are queued on the AudioContext a short lookahead in advance. A cue
// switch happens on a musical boundary after everything already queued, so nothing has to
// be cancelled: the old cue stops at the boundary and fades over `fade` seconds while the
// new cue starts exactly on it. Each switch opens a new synth session (its own bus), which
// is what lets the old music fade independently.
//
// Random parts ({…} notes, chance=, jitter=, {B C} pattern choices) are rolled here, as notes
// are queued, from a seeded generator: play(cue, { seed }) repeats the same music.
// Beds (sea, wind, rain, drone) belong to the player, not to a run: they keep going across
// cue switches and only change level.

import { compile } from './score.js';
import { createSynth } from './synth.js';
import { createRng, randomSeed, realize, pass } from './random.js';

export const AT = ['now', 'beat', 'bar', 'pattern', 'loop'];

// Seconds from the start of timeline `tl` to the first `at` boundary at or after `t`.
// Never later than the end of the timeline.
export function boundaryAfter(tl, t, at) {
  if (at === 'now') return Math.max(0, Math.min(t, tl.dur));
  if (at === 'loop') return tl.dur;
  const eps = 1e-6;
  for (const s of tl.sections) {
    const end = s.start + s.dur;
    if (end <= t + eps) continue;
    if (at === 'pattern') return end;
    const unit = at === 'beat' ? s.barDur / s.beats : s.barDur;
    const k = Math.max(0, Math.ceil((t - s.start) / unit - eps));
    return Math.min(s.start + k * unit, end);
  }
  return tl.dur;
}

const DEFAULTS = {
  lookahead: 0.3,        // seconds of notes queued ahead while the tab is visible
  hiddenLookahead: 1.6,  // background tabs only get timer ticks about once a second
  interval: 25,          // scheduler tick, ms
  volume: 0.8,
  intensity: 9,          // plays every layer until the game says otherwise
  layerFade: 1,          // seconds for setIntensity fades
  switchFade: 0.3,       // seconds the old cue takes to fade after a switch, unless the score says otherwise
  bedFade: 2,            // seconds beds take to fade in, and at least this long to change level on a switch
  seed: null,            // a number for repeatable dice; null picks a new seed on every play()
  autoTick: true         // false: call tick() yourself (tests, custom loops)
};

export class MusicPlayer {
  constructor(opts = {}) {
    this.opts = Object.assign({}, DEFAULTS, opts);
    this.ctx = opts.context || null;
    this.ownsContext = !opts.context;
    this.destination = opts.destination || null;
    this.syn = opts.synth || null;
    this.song = null;
    this.intensity = this.opts.intensity;
    this.muted = new Set();
    this.seg = null;          // the segment being scheduled now
    this.history = [];        // recent segments, for `state` while the lookahead runs ahead
    this.runs = new Set();    // runs whose synth sessions are still connected
    this.runCount = 0;
    this.target = null;       // the cue we're playing, or heading to
    this.until = 0;           // everything up to this AudioContext time is queued
    this.timer = null;
    this.listeners = {};
    this.notices = [];
    this.warmed = new WeakSet();
    this.seed = null;
    this.rng = createRng(1);
    this.beds = new Map();    // bed name -> { key, def, node }
    this.bedCue = null;       // the cue whose bed levels are set
  }

  static compile(text) { return compile(text); }

  /** Load a score (text or a compile() result). Throws an Error with `.errors` if it has errors. */
  load(source) {
    const song = typeof source === 'string' ? compile(source) : source;
    if (song.errors && song.errors.length) {
      const e = new Error('The score has errors:\n' + song.errors.map(x => `  line ${x.line}: ${x.msg}`).join('\n'));
      e.errors = song.errors;
      throw e;
    }
    this.song = song;
    if (this.syn) this.warm(song);
    return song;
  }

  get cues() { return this.song ? this.song.cueOrder.slice() : []; }
  get layers() { return this.song ? Math.max(0, ...this.song.voices.map(v => v.layer || 0), ...(this.song.beds || []).map(b => b.layer || 0)) : 0; }

  /** Create and resume the AudioContext. Call it from a click or key handler the first time. */
  unlock() {
    this.ensureContext();
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
  }

  /** Start a cue from its beginning, cutting whatever is playing. */
  play(cue, opts = {}) {
    if (!this.song) throw new Error('Load a score before playing it.');
    const name = cue || this.song.defaultCue;
    this.checkCue(name);
    this.ensureContext();
    if (this.ctx.state !== 'running' && this.ctx.resume) this.ctx.resume();
    if (opts.intensity != null) this.intensity = opts.intensity;
    this.seed = opts.seed != null ? opts.seed : this.opts.seed != null ? this.opts.seed : randomSeed();
    this.rng = createRng(this.seed);
    if (this.seg) this.halt(0.08);
    const item = this.cueStart(this.newRun(), name);
    if (!item) return;
    this.target = name;
    this.until = this.ctx.currentTime;
    this.begin(item, this.ctx.currentTime + 0.1, null);
    if (this.opts.autoTick && !this.timer) this.timer = setInterval(() => this.tick(), this.opts.interval);
    this.tick();
  }

  /**
   * Move to another cue on a musical boundary. Options override the score's switch line:
   *   at: 'now' | 'beat' | 'bar' | 'pattern' | 'loop'   (default: the switch line, else 'bar')
   *   fade: seconds for the old cue to fade out          (default: the switch line, else 0.3)
   *   via: false to skip the switch line's transition pattern
   *   restart: true to restart the cue even if it's already the one playing
   */
  goto(cue, opts = {}) {
    if (!this.song) throw new Error('Load a score before switching cues.');
    this.checkCue(cue);
    if (!this.seg) return this.play(cue, opts);
    if (cue === this.target && !opts.restart) return;
    const seg = this.seg;
    const from = seg.cue;
    const rule = this.findRule(from, cue);
    const at = opts.at || (rule && rule.at) || 'bar';
    if (!AT.includes(at)) throw new Error(`at must be one of ${AT.join(', ')}`);
    const fade = opts.fade != null ? opts.fade : (rule && rule.fade != null ? rule.fade : this.opts.switchFade);
    const via = opts.via === false ? null : (rule && rule.via && rule.via.dur ? rule.via : null);
    const run = this.newRun();
    const target = this.cueStart(run, cue);
    if (!target) return;
    seg.cut = this.boundaryTime(at);
    seg.next = via ? { kind: 'via', cue, tl: via, run, after: target } : target;
    seg.fadeOut = fade;
    this.target = cue;
  }

  /** Layers with layer <= n play. Fades over `fade` seconds, starting now or on the next `at` boundary. Same value: no-op. */
  setIntensity(n, opts = {}) {
    if (n === this.intensity) return; // safe to call every frame
    this.intensity = n;
    if (!this.ctx || !this.syn) return;
    const fade = opts.fade != null ? opts.fade : this.opts.layerFade;
    const t = opts.at ? this.boundaryTime(opts.at) : null;
    for (const run of this.runs) this.applyGains(run, fade, t);
    this.levelBeds(this.bedCue, t, fade);
  }

  /** Silence a voice or a bed by name, or bring it back. */
  mute(voice, on = true) {
    if (on) this.muted.add(voice); else this.muted.delete(voice);
    if (this.ctx && this.syn) for (const run of this.runs) this.applyGains(run, 0.03, null);
    this.levelBeds(this.bedCue, null, 0.1);
  }

  setVolume(v) {
    this.opts.volume = v;
    if (this.syn) this.syn.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Fade everything out over `fade` seconds and stop. */
  stop(fade = 0.5) {
    if (!this.ctx) return;
    this.halt(fade);
    this.stopBeds(fade);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  close() {
    this.stop(0);
    if (this.ownsContext && this.ctx && this.ctx.close) this.ctx.close();
    this.ctx = null; this.syn = null;
  }

  /** Subscribe to 'cue' {cue}, 'pattern' {cue, part, pattern, bars} or 'end' {}. Returns an unsubscribe function. */
  on(type, fn) {
    (this.listeners[type] = this.listeners[type] || new Set()).add(fn);
    return () => this.listeners[type].delete(fn);
  }

  /** What is audible right now. */
  get state() {
    const base = { playing: !!this.seg, cue: null, target: this.target, part: null, pattern: null, bar: 0, beat: 0, chord: null, intensity: this.intensity, seed: this.seed };
    if (!this.ctx || !this.seg) return base;
    const now = this.ctx.currentTime;
    for (const seg of [this.seg, ...this.history.slice().reverse()]) {
      const end = Math.min(seg.t0 + seg.tl.dur, seg.cut);
      if (now < seg.t0 || now >= end) continue;
      const rel = now - seg.t0;
      const secs = seg.tl.sections;
      const sec = secs.find(s => rel >= s.start && rel < s.start + s.dur) || secs[secs.length - 1];
      if (!sec) break;
      const inSec = rel - sec.start;
      const h = (sec.harmony || []).find(x => inSec >= x.t && inSec < x.t + x.d);
      return Object.assign(base, {
        cue: seg.cue, part: seg.kind, pattern: sec.name,
        bar: Math.min(sec.bars, Math.floor(inSec / sec.barDur) + 1),
        beat: Math.floor((inSec % sec.barDur) / (sec.barDur / sec.beats)) + 1,
        chord: h ? h.sym : null
      });
    }
    return base;
  }

  /* --------------------------------------------------------------- internals */

  ensureContext() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) throw new Error('This browser has no Web Audio.');
      this.ctx = new AC({ latencyHint: 'playback' });
    }
    if (!this.syn) {
      this.syn = createSynth(this.ctx, this.destination || this.ctx.destination);
      this.syn.out.gain.value = this.opts.volume;
    }
    if (this.song) this.warm(this.song);
    return this.ctx;
  }

  warm(song) {
    if (this.warmed.has(song) || !this.syn || !this.syn.warm) return;
    this.warmed.add(song);
    this.syn.warm(song);
  }

  checkCue(name) {
    if (!this.song.cues[name]) throw new Error(`No cue called "${name}". Cues: ${this.song.cueOrder.join(', ')}`);
  }

  findRule(from, to) {
    const ts = this.song.transitions || [];
    // most specific first: calm -> fight, * -> fight, calm -> *, * -> *
    return ts.find(t => t.from === from && t.to === to) || ts.find(t => t.from === '*' && t.to === to)
      || ts.find(t => t.from === from && t.to === '*') || ts.find(t => t.from === '*' && t.to === '*') || null;
  }

  newRun() { return { id: ++this.runCount, song: this.song, sess: null }; }

  cueStart(run, name, depth = 0) {
    const c = run.song.cues[name];
    if (!c || depth > 8) return null;
    if (c.intro.dur) return { kind: 'intro', cue: name, tl: pass(c, 'intro', this.rng), run };
    if (c.loop.dur) return { kind: 'loop', cue: name, tl: pass(c, 'loop', this.rng), run };
    if (c.then) return this.cueStart(run, c.then, depth + 1);
    return null;
  }

  follow(seg) {
    const c = seg.run.song.cues[seg.cue];
    if (seg.kind === 'loop') return { kind: 'loop', cue: seg.cue, tl: pass(c, 'loop', this.rng), run: seg.run };
    if (seg.kind === 'intro') {
      if (c.loop.dur) return { kind: 'loop', cue: seg.cue, tl: pass(c, 'loop', this.rng), run: seg.run };
      if (c.then) return this.cueStart(seg.run, c.then);
    }
    return null;
  }

  // The first `at` boundary after everything already queued.
  boundaryTime(at) {
    const tmin = Math.max(this.until, this.ctx.currentTime) + 0.001;
    const seg = this.seg;
    if (!seg || at === 'now') return tmin;
    const end = Math.min(seg.t0 + seg.tl.dur, seg.cut);
    if (tmin >= end) return end;
    return Math.min(end, seg.t0 + boundaryAfter(seg.tl, tmin - seg.t0, at));
  }

  tick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.flushNotices(now);
    if (!this.seg) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const horizon = now + (hidden ? this.opts.hiddenLookahead : this.opts.lookahead);
    let guard = 0;
    while (this.seg && guard++ < 20000) {
      const seg = this.seg, evs = seg.tl.events;
      if (seg.i < evs.length) {
        const t = seg.t0 + evs[seg.i].t;
        if (t < seg.cut) {
          if (t > horizon) break;
          if (t >= now - 0.03) {
            const ev = evs[seg.i];
            const r = realize(ev, seg.run.song.voices[ev.v], this.rng); // musicbox: roll the dice
            if (r) seg.run.sess.play(r.ev, Math.max(t + r.dt, now + 0.005));
          }
          seg.i++;
          continue;
        }
      }
      const end = Math.min(seg.t0 + seg.tl.dur, seg.cut);
      if (end > horizon) break;
      this.advance(seg, end);
    }
    this.until = Math.max(this.until, horizon);
  }

  advance(seg, end) {
    const item = seg.next || this.follow(seg);
    if (!seg.next && item) this.target = item.cue; // a "then" moved us on
    this.history.push(seg);
    if (this.history.length > 4) this.history.shift();
    if (!item) {
      this.seg = null;
      this.notify(end, 'end', {});
      this.disposeLater(seg.run, end + 8);
      this.stopBeds(this.opts.bedFade, end);
      return;
    }
    this.begin(item, end, seg);
  }

  begin(item, t0, prev) {
    const run = item.run;
    if (!run.sess) this.openRun(run);
    const seg = { kind: item.kind, cue: item.cue, tl: item.tl, run, t0, i: 0, cut: Infinity, next: item.after || null, fadeOut: 0 };
    this.seg = seg;
    if (seg.kind !== 'via' && (!prev || prev.run !== run || prev.cue !== seg.cue || prev.kind === 'via')) this.notify(t0, 'cue', { cue: seg.cue }, seg);
    if (!prev || prev.cue !== seg.cue || prev.run !== run) this.syncBeds(run.song, seg.cue, t0, Math.max(this.opts.bedFade / 2, prev ? prev.fadeOut : this.opts.bedFade));
    for (const s of seg.tl.sections) this.notify(t0 + s.start, 'pattern', { cue: seg.cue, part: seg.kind, pattern: s.name, bars: s.bars }, seg);
    if (prev && prev.run !== run) {
      this.fadeOut(prev.run, t0, prev.fadeOut);
      this.disposeLater(prev.run, t0 + prev.fadeOut * 2 + 1);
    }
  }

  openRun(run) {
    run.sess = this.syn.session(run.song);
    this.runs.add(run);
    this.applyGains(run, 0, null);
  }

  fadeOut(run, at, fade) {
    const tau = Math.max(0.005, fade / 3);
    for (const g of [run.sess.bus.gain, run.sess.sendBus.gain]) g.setTargetAtTime(0, at, tau);
  }

  disposeLater(run, at) {
    const ms = Math.max(0, at - this.ctx.currentTime) * 1000 + 3000; // let release and reverb tails finish
    setTimeout(() => {
      try { run.sess.bus.disconnect(); run.sess.sendBus.disconnect(); } catch (e) { /* already gone */ }
      this.runs.delete(run);
    }, ms);
  }

  halt(fade) {
    for (const run of this.runs) if (run.sess) run.sess.stop(Math.max(0.005, fade / 3));
    this.runs.clear();
    this.seg = null;
    this.target = null;
    this.notices = [];
  }

  levelOf(run, vi) {
    const v = run.song.voices[vi], c = run.sess.ch[vi];
    const on = (v.layer || 0) <= this.intensity && !this.muted.has(v.name);
    return on ? v.vol * c.def.level : 0;
  }

  applyGains(run, fade, at) {
    if (!run.sess) return;
    const now = this.ctx.currentTime;
    run.sess.ch.forEach((c, vi) => {
      const g = c.input.gain, lvl = this.levelOf(run, vi);
      g.cancelScheduledValues(now);
      if (fade <= 0 && at == null) { g.setValueAtTime(lvl, now); return; }
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(lvl, at == null ? now : Math.max(now, at), Math.max(0.01, fade / 3));
    });
  }

  /* beds */

  // Start the beds `song` declares (keeping ones that haven't changed), stop the rest, and set
  // their levels for `cue` from time `t`, fading over `fade` seconds.
  syncBeds(song, cue, t, fade) {
    if (!this.syn || !this.syn.bed) return;
    const defs = song.beds || [];
    const keep = new Set();
    for (const def of defs) {
      const key = JSON.stringify(Object.assign({}, def, { ln: 0 }));
      const cur = this.beds.get(def.name);
      if (cur && cur.key === key) { cur.def = def; keep.add(def.name); continue; }
      if (cur) cur.node.stop(fade, t);
      this.beds.set(def.name, { key, def, node: this.syn.bed(def, song) });
      keep.add(def.name);
    }
    for (const [name, b] of this.beds) if (!keep.has(name)) { b.node.stop(fade, t); this.beds.delete(name); }
    this.bedSong = song;
    this.levelBeds(cue, t, fade);
  }

  bedLevel(b, cue) {
    const c = cue && this.bedSong && this.bedSong.cues[cue];
    const sel = c && c.beds ? (c.beds[b.def.name] || 0) : 1;
    const on = (b.def.layer || 0) <= this.intensity && !this.muted.has(b.def.name);
    return on ? sel * b.def.vol * b.node.level : 0;
  }

  levelBeds(cue, at, fade) {
    if (!this.ctx || !this.beds.size) return;
    this.bedCue = cue;
    const now = this.ctx.currentTime, t = at == null ? now : Math.max(now, at);
    for (const b of this.beds.values()) {
      const g = b.node.input.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(this.bedLevel(b, cue), t, Math.max(0.01, fade / 3));
    }
  }

  stopBeds(fade, at = null) {
    for (const b of this.beds.values()) b.node.stop(fade, at);
    this.beds.clear();
    this.bedCue = null;
  }

  notify(time, type, detail, seg = null) { this.notices.push({ time, type, detail, seg }); }

  flushNotices(now) {
    if (!this.notices.length) return;
    const due = this.notices.filter(n => n.time <= now).sort((a, b) => a.time - b.time);
    if (!due.length) return;
    this.notices = this.notices.filter(n => n.time > now);
    for (const n of due) {
      if (n.seg && n.time >= n.seg.cut) continue; // cut off by a switch before it was heard
      const set = this.listeners[n.type];
      if (set) for (const fn of set) { try { fn(n.detail); } catch (e) { console.error(e); } }
    }
  }
}

export { compile };
