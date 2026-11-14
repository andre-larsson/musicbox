// Web Audio synthesizer: every instrument is built from oscillators, noise and
// filters at play time. No samples.
//
// Forked from the Scrimshaw jukebox synth by Simon Willison
// (https://tools.simonwillison.net/scrimshaw-jukebox), Apache License 2.0.
// Modified: converted to an ES module; musicbox extensions are marked "musicbox:".

import { createRng, realize, pass } from './random.js'; // musicbox

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

/* --------------------------------------------------------------- helpers */
function G(S, v = 0) { const g = S.ctx.createGain(); g.gain.value = v; return g; }
function F(S, type, f, q = 0.7, gainDb) {
  const b = S.ctx.createBiquadFilter(); b.type = type;
  b.frequency.value = clamp(f, 10, S.nyq * 0.95); b.Q.value = q;
  if (gainDb != null) b.gain.value = gainDb;
  return b;
}
function O(S, type, f, t, stop, p, ratio = 1, detune = 0) {
  const o = S.ctx.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  const ff = clamp(f * ratio, 1, S.nyq * 0.98);
  if (p && p.from) {
    o.frequency.setValueAtTime(clamp(p.from * ratio, 1, S.nyq * 0.98), t);
    o.frequency.exponentialRampToValueAtTime(ff, t + p.glide);
  } else o.frequency.setValueAtTime(ff, t);
  const dc = detune + (p && p.cents ? p.cents : 0); // musicbox: p.cents, the note's own tuning
  if (dc) o.detune.value = dc;
  o.start(t); o.stop(stop);
  return o;
}
// musicbox: louder notes are brighter. p.dyn is the note's written dynamic: 0.8 plain, 1 with !,
// 0.48 with ?. Returns about 1 for a plain note, so a plain note sounds as it did before.
const dynB = p => 0.45 + 0.7 * (p && p.dyn != null ? p.dyn : 0.8);
// sustained envelope; returns time when the voice is silent
function adsr(param, t, d, { a = 0.01, dc = 0.1, s = 1, r = 0.1, peak = 1 }) {
  const tOn = t + a, tOff = Math.max(t + d, tOn + 0.003);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, tOn);
  if (s < 1) param.setTargetAtTime(peak * s, tOn, Math.max(0.002, dc / 3));
  param.setTargetAtTime(0, tOff, Math.max(0.002, r / 4));
  return tOff + r * 1.8 + 0.03;
}
// struck envelope; optional damping time
function perc(param, t, { a = 0.002, tau = 0.3, peak = 1, damp = null, dampTau = 0.06 }) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, Math.max(0.002, tau));
  let end = t + a + tau * 7;
  if (damp != null && damp + dampTau * 7 < end) {
    const td = Math.max(damp, t + a + 0.002);
    param.setTargetAtTime(0, td, dampTau);
    end = td + dampTau * 7;
  }
  return end;
}
function partial(S, out, t, f, opt) {
  if (f >= S.nyq * 0.9) return;
  const g = G(S); g.connect(out);
  const end = perc(g.gain, t, opt);
  const o = O(S, opt.type || 'sine', f, t, end);
  if (opt.bend) { o.frequency.setValueAtTime(f * opt.bend, t); o.frequency.setTargetAtTime(f, t, opt.bendTau || 0.02); }
  o.connect(g);
  return end;
}
function noise(S, out, t, { type = 'bandpass', f = 2000, q = 1, a = 0.001, tau = 0.01, peak = 0.1 }) {
  const src = S.ctx.createBufferSource(); src.buffer = S.noise; src.loop = true;
  const fl = F(S, type, f, q);
  const g = G(S);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(0, t + a, Math.max(0.001, tau));
  src.connect(fl).connect(g).connect(out);
  src.start(t, Math.random() * (S.noise.duration - 0.5));
  src.stop(t + a + tau * 7 + 0.01);
  return { src, fl, g };
}
function noiseSrc(S, t, stop) {
  const src = S.ctx.createBufferSource(); src.buffer = S.noise; src.loop = true;
  src.start(t, Math.random() * (S.noise.duration - 0.5)); src.stop(stop);
  return src;
}
// musicbox: no two notes have quite the same vibrato: the speed, width and onset vary, and the
// speed rises a little as it starts, as a player's does. `wander` adds a slow random drift of about
// that many cents, since a held pitch is never dead steady. `amp` puts the same wobble into the
// loudness (a flute's vibrato is mostly breath); it returns a gain node to put in the signal path.
function vibrato(S, t, stop, targets, { rate = 5, depth = 10, delay = 0.2, rise = 0.3, wander = 0, amp = 0 }) {
  const lfo = S.ctx.createOscillator();
  const r = rate * (0.9 + Math.random() * 0.2);
  depth *= 0.8 + Math.random() * 0.4;
  delay *= 0.75 + Math.random() * 0.5;
  lfo.frequency.setValueAtTime(r * 0.88, t);
  lfo.frequency.linearRampToValueAtTime(r, t + delay + rise + 0.4);
  const g = G(S);
  g.gain.setValueAtTime(0, t);
  g.gain.setValueAtTime(0, t + delay);
  g.gain.linearRampToValueAtTime(depth, t + delay + rise);
  lfo.connect(g);
  targets.forEach(o => g.connect(o.detune));
  lfo.start(t); lfo.stop(stop);
  if (wander) { const wg = G(S, wander); drift(S, t, stop).connect(wg); targets.forEach(o => wg.connect(o.detune)); }
  if (!amp) return null;
  const trem = G(S, 1), ag = G(S);
  ag.gain.setValueAtTime(0, t);
  ag.gain.setValueAtTime(0, t + delay);
  ag.gain.linearRampToValueAtTime(amp, t + delay + rise);
  lfo.connect(ag).connect(trem.gain);
  return trem;
}
// musicbox: a slow random wobble (mostly 0.5 to 4 Hz) with an RMS of 1 and a seamless loop point,
// shared by every note; each note reads it from a random place at a slightly different speed
function wobble(S) {
  if (S.wobble) return S.wobble;
  const sr = S.ctx.sampleRate, len = sr * 6, fade = Math.floor(sr * 0.5);
  const x = new Float32Array(len + fade), k = 1 - Math.exp(-2 * Math.PI * 2.5 / sr);
  let a = 0, b = 0;
  for (let i = 0; i < x.length + sr; i++) { a += k * ((Math.random() * 2 - 1) - a); b += k * (a - b); if (i >= sr) x[i - sr] = b; }
  const buf = S.ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  let mean = 0, ms = 0;
  for (let i = 0; i < len; i++) { y[i] = i < fade ? x[i] * Math.sqrt(i / fade) + x[len + i] * Math.sqrt(1 - i / fade) : x[i]; mean += y[i]; }
  mean /= len;
  for (let i = 0; i < len; i++) { y[i] -= mean; ms += y[i] * y[i]; }
  const g = 1 / Math.sqrt(ms / len || 1);
  for (let i = 0; i < len; i++) y[i] *= g;
  return (S.wobble = buf);
}
function drift(S, t, stop) {
  const src = S.ctx.createBufferSource(); src.buffer = wobble(S); src.loop = true;
  src.playbackRate.value = 0.75 + Math.random() * 0.6;
  src.start(t, Math.random() * (src.buffer.duration - 0.5)); src.stop(stop);
  return src;
}
// musicbox: bow or breath pressure is never quite even; a gain that wobbles by about ±depth
function press(S, t, stop, depth) {
  const g = G(S, 1), wg = G(S, depth);
  drift(S, t, stop).connect(wg).connect(g.gain);
  return g;
}
// musicbox: where player i of n sits in a section, -spread (left) to +spread (right), give or take
function seat(S, i, n, spread) {
  if (!S.ctx.createStereoPanner) return G(S, 1);
  const pn = S.ctx.createStereoPanner();
  pn.pan.value = clamp((n > 1 ? (i / (n - 1)) * 2 - 1 : 0) * spread + (Math.random() - .5) * .1, -1, 1);
  return pn;
}
// musicbox: the pitch starts a little flat and settles, as a player finds the note
function scoop(oscs, t, cents, tau, p) {
  if (p && p.from) return; // already sliding into it
  const c = cents * (0.6 + Math.random() * 0.8);
  for (const o of oscs) { const base = o.detune.value; o.detune.setValueAtTime(base - c, t); o.detune.setTargetAtTime(base, t, tau); }
}
function metal(S, out, t, stop, mult = 1) {
  const sum = G(S, 0.16); sum.connect(out);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) O(S, 'square', f * mult, t, stop).connect(sum);
  return sum;
}

/* -------------------------------------------------------------- waveforms */
const WAVES = {
  organ: [1, .8, .5, .42, 0, .25, 0, .2],
  pipe: [1, .55, .32, .4, .08, .18, 0, .2, 0, .07, 0, .06],
  clarinet: [1, .05, .72, .04, .45, .02, .26, 0, .12, 0, .06],
  oboe: [.5, 1, .85, .5, .36, .22, .15, .1, .06],
  bassoon: [.45, 1, .78, .56, .42, .3, .22, .14, .1, .06],
  reed: [1, .55, .45, .32, .3, .22, .18, .13, .11, .08, .06, .05],
  horn: [1, .5, .3, .18, .1, .05]
};
function wave(S, name) {
  if (!S.waves[name]) {
    const h = WAVES[name], n = h.length + 1;
    const re = new Float32Array(n), im = new Float32Array(n);
    h.forEach((a, i) => { im[i + 1] = a; });
    S.waves[name] = S.ctx.createPeriodicWave(re, im);
  }
  return S.waves[name];
}

/* -------------------------------------------- plucked strings (Karplus-Strong) */
function ks(S, f, cfg) {
  const sr = S.ctx.sampleRate;
  const N = Math.max(2, Math.floor(sr / f - cfg.b));
  const key = cfg.id + ':' + N;
  let e = S.ks[key];
  if (!e) {
    const len = Math.floor(sr * cfg.dur);
    const buf = S.ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += (1 - cfg.color) * ((Math.random() * 2 - 1) - lp); y[i] = lp; mean += lp; }
    mean /= N;
    let pk = 1e-6;
    for (let i = 0; i < N; i++) { y[i] -= mean; pk = Math.max(pk, Math.abs(y[i])); }
    for (let i = 0; i < N; i++) y[i] /= pk;
    const b = cfg.b, dk = cfg.decay;
    for (let i = N; i < len; i++) y[i] = dk * ((1 - b) * y[i - N] + b * (i - N - 1 >= 0 ? y[i - N - 1] : 0));
    const fade = Math.floor(len * 0.25);
    for (let i = 0; i < fade; i++) { const k = i / fade; y[len - fade + i] *= (1 - k) * (1 - k); }
    e = S.ks[key] = { buf, f0: sr / (N + b) };
  }
  return e;
}
function pluck(S, out, t, d, f, v, cfg, chain) {
  const e = ks(S, f, cfg);
  const src = S.ctx.createBufferSource(); src.buffer = e.buf;
  const rate = f / e.f0; src.playbackRate.value = rate;
  const g = G(S);
  const end = perc(g.gain, t, { a: 0.001, tau: 50, peak: v, damp: t + d + cfg.hang, dampTau: cfg.dampTau });
  let node = src;
  for (const n of chain) { node.connect(n); node = n; }
  node.connect(g).connect(out);
  src.start(t); src.stop(Math.min(end, t + e.buf.duration / rate));
}

const PLUCK = {
  harp: { id: 'harp', b: .45, decay: .9985, color: .55, dur: 2.8, hang: 1.4, dampTau: .25 },
  guitar: { id: 'gtr', b: .38, decay: .997, color: .4, dur: 1.9, hang: .2, dampTau: .06 },
  banjo: { id: 'banjo', b: .18, decay: .988, color: .05, dur: 1.1, hang: .1, dampTau: .05 },
  harpsichord: { id: 'hpsi', b: .14, decay: .994, color: 0, dur: 1.6, hang: .12, dampTau: .05 },
  pizz: { id: 'pizz', b: .5, decay: .982, color: .6, dur: .8, hang: .15, dampTau: .05 },
  upright: { id: 'upr', b: .5, decay: .996, color: .7, dur: 1.7, hang: .04, dampTau: .07 }
};

/* ----------------------------------- musicbox: piano (additive, one buffer per key) */
// Stiff strings make each partial a little sharp; a hammer struck about a seventh of the way
// along the string weakens the 7th and 8th partials; two strings per key, a fraction of a cent
// apart, beat slowly; higher partials die away first, and the tone decays in two stages.
function pianoTone(S, f) {
  const key = Math.round(12 * Math.log2(f / 440) + 69);
  const id = 'pno:' + key;
  if (S.ks[id]) return S.ks[id];
  const sr = S.ctx.sampleRate, f0 = 440 * Math.pow(2, (key - 69) / 12);
  const dur = clamp(4.6 * Math.pow(262 / f0, 0.45), 1.6, 7);
  const len = Math.floor(sr * dur);
  const buf = S.ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const B = clamp(0.00013 * Math.pow(f0 / 130, 0.75), 0.00005, 0.0025);
  const tau = clamp(1.4 * Math.pow(262 / f0, 0.6), 0.22, 4);
  const top = Math.min(S.nyq * 0.85, 11000);
  let seed = key * 7919 + 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 1; n <= 40; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > top) break;
    let a = Math.pow(n, -0.95) * (0.18 + 0.82 * Math.abs(Math.sin(Math.PI * n / 7.3)));
    a /= 1 + Math.pow(fn / 3800, 2);
    if (a < 0.004) continue;
    const tn = tau / (1 + 0.2 * (n - 1));
    const strings = n <= 14 ? [-1, 1] : [0];
    const cents = 0.25 + 0.45 * rnd();
    for (const s of strings) {
      const w = 2 * Math.PI * fn * Math.pow(2, s * cents / 1200) / sr;
      const c2 = 2 * Math.cos(w), ph = rnd() * 2 * Math.PI, amp = a / strings.length;
      let y1 = Math.sin(ph - w), y2 = Math.sin(ph - 2 * w);
      const kf = Math.exp(-1 / (sr * tn)), ks2 = Math.exp(-1 / (sr * tn * 4.5));
      let ef = 0.78 * amp, es = 0.22 * amp;
      for (let i = 0; i < len; i++) {
        const x = c2 * y1 - y2; y2 = y1; y1 = x;
        y[i] += x * (ef + es); ef *= kf; es *= ks2;
        if (ef + es < 1e-5) break;
      }
    }
  }
  // the hammer's knock: a short burst of low-passed noise
  let lp = 0;
  const knock = Math.floor(sr * 0.03), kc = clamp(f0 * 4 / sr, 0.02, 0.5);
  for (let i = 0; i < knock; i++) { lp += kc * ((rnd() * 2 - 1) - lp); y[i] += lp * 0.5 * Math.exp(-i / (sr * 0.006)); }
  const att = Math.floor(sr * 0.0015);
  for (let i = 0; i < att; i++) y[i] *= i / att;
  let pw = 0; const win = Math.min(len, Math.floor(sr * 0.3));
  for (let i = 0; i < win; i++) pw += y[i] * y[i];
  const g = 0.3 * Math.pow(262 / f0, 0.12) / Math.sqrt(pw / win + 1e-12);
  const fade = Math.floor(len * 0.25);
  for (let i = 0; i < len; i++) { y[i] *= g; if (i >= len - fade) { const k = (i - len + fade) / fade; y[i] *= (1 - k) * (1 - k); } }
  return (S.ks[id] = { buf, f0 });
}

/* ------------------------------------------------------------ instruments */
// play(S, out, t, dur, freq, vel, p) ; p = {from, glide, bright, att, rel, dyn, cents}
// musicbox: optional per instrument: cents (how far a player's tuning strays, note to note) and
// loose (how much of the human timing and loudness it gets; 0 for plain synths)
const INST = {
  steeldrum: { rev: 0.22, level: 0.66, play(S, out, t, d, f, v, p) {
    const tau = clamp(0.5 * Math.pow(440 / f, 0.45), 0.15, 1.1);
    const lp = F(S, 'lowpass', 5200 * p.bright, 0.5); lp.connect(out);
    const damp = t + d + 0.9;
    [[1, 1, 1, .002], [1.0035, .32, 1.1, .002], [2, .52, .55, .016], [3, .17, .32, .004], [4.07, .06, .18, .002]]
      .forEach(([r, a, tm, at]) => partial(S, lp, t, f * r, { a: at, tau: tau * tm, peak: v * a * 0.5, damp }));
    noise(S, lp, t, { f: 2600, q: .8, tau: .006, peak: v * .05 });
  } },
  marimba: { rev: 0.18, level: 0.5, play(S, out, t, d, f, v, p) {
    const tau = clamp(0.26 * Math.sqrt(330 / f), 0.08, 0.6);
    partial(S, out, t, f, { a: .002, tau, peak: v * .8 });
    partial(S, out, t, f * 3.98, { a: .001, tau: tau * .18, peak: v * .22 * p.bright });
    partial(S, out, t, f * 9.9, { a: .001, tau: tau * .05, peak: v * .05 * p.bright });
    noise(S, out, t, { f: f * 2.5, q: 1.2, tau: .004, peak: v * .06 });
  } },
  vibes: { rev: 0.35, level: 0.4, play(S, out, t, d, f, v, p) {
    const trem = G(S, 0.82); trem.connect(out);
    const tau = clamp(1.1 * Math.pow(440 / f, 0.3), 0.4, 1.8);
    const end = t + Math.min(tau * 7, d + 2.2);
    const lfo = S.ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = G(S, 0.18); lfo.connect(lg).connect(trem.gain); lfo.start(t); lfo.stop(end);
    partial(S, trem, t, f, { a: .002, tau, peak: v * .7, damp: t + d + 1.2, dampTau: .2 });
    partial(S, trem, t, f * 4, { a: .001, tau: .18, peak: v * .14 * p.bright });
    noise(S, trem, t, { f: f * 3, q: 1, tau: .004, peak: v * .03 });
  } },
  celesta: { rev: 0.35, level: 0.63, play(S, out, t, d, f, v, p) {
    const tau = clamp(0.55 * Math.pow(440 / f, 0.3), 0.2, 0.9);
    partial(S, out, t, f, { a: .002, tau, peak: v * .7 });
    partial(S, out, t, f * 2, { a: .001, tau: tau * .4, peak: v * .14 });
    partial(S, out, t, f * 4.02, { a: .001, tau: tau * .12, peak: v * .1 * p.bright * dynB(p) }); // musicbox: dynB
    noise(S, out, t, { f: 5000, q: 1, tau: .003, peak: v * .04 });
  } },
  glock: { rev: 0.35, level: 0.53, play(S, out, t, d, f, v, p) {
    partial(S, out, t, f, { a: .001, tau: .7, peak: v * .6 });
    partial(S, out, t, f * 2.76, { a: .001, tau: .22, peak: v * .25 * p.bright });
    partial(S, out, t, f * 5.4, { a: .001, tau: .07, peak: v * .14 * p.bright });
    partial(S, out, t, f * 8.93, { a: .001, tau: .03, peak: v * .06 * p.bright });
  } },
  xylophone: { rev: 0.2, level: 0.72, play(S, out, t, d, f, v, p) {
    const tau = clamp(0.13 * Math.sqrt(440 / f), 0.05, 0.25);
    partial(S, out, t, f, { a: .001, tau, peak: v * .75 });
    partial(S, out, t, f * 3, { a: .001, tau: tau * .4, peak: v * .35 * p.bright });
    partial(S, out, t, f * 6, { a: .001, tau: tau * .15, peak: v * .1 * p.bright });
    noise(S, out, t, { f: 4000, q: 1, tau: .004, peak: v * .1 });
  } },
  musicbox: { rev: 0.4, level: 0.64, play(S, out, t, d, f, v, p) {
    partial(S, out, t, f, { a: .001, tau: .5, peak: v * .7 });
    partial(S, out, t, f * 3, { a: .001, tau: .12, peak: v * .12 });
    partial(S, out, t, f * 5.2, { a: .001, tau: .05, peak: v * .06 * p.bright });
    noise(S, out, t, { f: 7000, q: 2, tau: .002, peak: v * .05 });
  } },
  bell: { rev: 0.45, level: 0.71, play(S, out, t, d, f, v, p) {
    const damp = t + d + 3;
    [[.5, .35, 3.5], [1, 1, 2.4], [1.19, .55, 1.7], [1.5, .38, 1.4], [2, .45, 1.1], [2.52, .22, .8], [3.01, .16, .55], [4.1, .08, .35]]
      .forEach(([r, a, tau]) => partial(S, out, t, f * r, { a: .002, tau, peak: v * a * .35 * (r > 1.6 ? Math.pow(dynB(p), 1.5) : 1), damp, dampTau: .4 })); // musicbox: dynB
    noise(S, out, t, { f: f * 4, q: 1, tau: .01, peak: v * .05 });
  } },
  piano: { rev: 0.3, level: 1, play(S, out, t, d, f, v, p) { // musicbox
    const e = pianoTone(S, f);
    const src = S.ctx.createBufferSource(); src.buffer = e.buf;
    const rate = f / e.f0;
    if (p.from) {
      src.playbackRate.setValueAtTime(p.from / e.f0, t);
      src.playbackRate.exponentialRampToValueAtTime(rate, t + p.glide);
    } else src.playbackRate.value = rate;
    const vv = clamp(v, 0.05, 1.4);
    const lp = F(S, 'lowpass', clamp(f * 1.5 + (600 + 5600 * vv * vv) * p.bright, 300, 16000), 0.5);
    const g = G(S);
    const dampTau = p.rel ? p.rel / 4 : clamp(0.05 * Math.pow(262 / f, 0.5), 0.025, 0.14);
    const end = perc(g.gain, t, { a: 0.001, tau: 60, peak: v * 0.5, damp: t + d, dampTau });
    src.connect(lp).connect(g).connect(out);
    src.start(t); src.stop(Math.min(end, t + e.buf.duration / rate));
  } },
  organ: { loose: 0.5, rev: 0.15, level: 0.98, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', 5500 * p.bright, 0.5);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .005, r: p.rel || .06, peak: v * .5 });
    const o = O(S, wave(S, 'organ'), f, t, end, p); o.connect(lp);
    vibrato(S, t, end, [o], { rate: 6.3, depth: 5, delay: 0, rise: .05 });
    noise(S, out, t, { type: 'lowpass', f: 2500, q: .5, tau: .002, peak: v * .1 });
  } },
  pipe: { rev: 0.55, level: 1.01, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', 4200 * p.bright, 0.5);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .06, r: p.rel || .28, peak: v * .38 });
    O(S, wave(S, 'pipe'), f, t, end, p).connect(lp);
    const sub = G(S, .45); sub.connect(lp); O(S, 'sine', f, t, end, p, .5).connect(sub);
    noise(S, out, t, { f: f * 3, q: 2, a: .01, tau: .02, peak: v * .04 });
  } },
  strings: { rev: 0.4, level: 2.57, cents: 2, body(S, out) { // musicbox: the violin family's body
    const body = F(S, 'peaking', 2600, 1.2, 3), body2 = F(S, 'peaking', 320, 1.4, 2.5);
    body.connect(body2).connect(out);
    return body;
  }, play(S, out, t, d, f, v, p) {
    // musicbox: a section of four players across the stereo field, each a few cents from the others,
    // each with their own vibrato and coming in a moment apart
    const g = G(S); const lp = F(S, 'lowpass', Math.min(9000, (1300 + f * 2.6) * p.bright * dynB(p)), 0.6);
    const end = adsr(g.gain, t, d, { a: p.att || .16, dc: .3, s: .9, r: p.rel || .38, peak: v * .5 });
    lp.connect(press(S, t, end, .04)).connect(g).connect(out);
    for (let i = 0; i < 4; i++) {
      const o = O(S, 'sawtooth', f, t, end, p, 1, (Math.random() * 2 - 1) * 9);
      const og = G(S); og.gain.setValueAtTime(0, t); og.gain.setTargetAtTime(.19, t + Math.random() * .035, .015);
      o.connect(og).connect(seat(S, i, 4, .5)).connect(lp);
      scoop([o], t, 10, .05, p);
      vibrato(S, t, end, [o], { rate: 5.3, depth: 8, delay: .15, rise: .4, wander: 3 });
    }
  } },
  pad: { rev: 0.5, level: 2.18, loose: 0.5, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', (600 + f * 1.4) * p.bright, 0.9);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .5, r: p.rel || 1.0, peak: v * .45 });
    [-12, 0, 11].forEach(c => { const og = G(S, .24); O(S, 'sawtooth', f, t, end, p, 1, c).connect(og).connect(lp); });
  } },
  choir: { rev: 0.5, level: 2.02, cents: 2, body(S, out, vo, onStop) { return vowel(S, out, vo, [[730, 7, 1], [1090, 8, .55], [2440, 10, .25]], onStop); }, play: choirVoice },
  voices: { rev: 0.5, level: 2.01, cents: 2, body(S, out, vo, onStop) { return vowel(S, out, vo, [[380, 6, 1], [820, 8, .35], [2500, 10, .1]], onStop); }, play: choirVoice },
  brass: { rev: 0.25, level: 0.72, cents: 2, play(S, out, t, d, f, v, p) {
    // musicbox: three players, each lipping up to the note from a little below and a moment apart;
    // louder notes open the filter further, so a forte is brassy and a piano is mellow
    const g = G(S); const lp = F(S, 'lowpass', f, 1.3);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .03, dc: .2, s: .85, r: p.rel || .12, peak: v * .42 });
    const pk = Math.min(11000, (f * 5 + 700) * p.bright * (0.19 + 0.9 * (p.dyn != null ? p.dyn : 0.8)));
    lp.frequency.setValueAtTime(f * 1.1, t);
    lp.frequency.linearRampToValueAtTime(pk, t + .06);
    lp.frequency.setTargetAtTime(f * 1.2 + (pk - f) * .5, t + .06, .2);
    for (let i = 0; i < 3; i++) {
      const o = O(S, 'sawtooth', f, t, end, p, 1, (Math.random() * 2 - 1) * 7);
      const og = G(S); og.gain.setValueAtTime(0, t); og.gain.setTargetAtTime(.82, t + Math.random() * .02, .006);
      o.connect(og).connect(seat(S, i, 3, .35)).connect(lp);
      scoop([o], t, 22, .025, p);
      vibrato(S, t, end, [o], { rate: 5.2, depth: 5, delay: .35, rise: .3, wander: 2 });
    }
  } },
  trumpet: { cents: 4, rev: 0.25, level: 1.17, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', f, 1.6);
    const pk2 = F(S, 'peaking', 1400, 1, 5);
    lp.connect(pk2).connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .02, dc: .15, s: .8, r: p.rel || .09, peak: v * .4 });
    const pk = Math.min(12000, (f * 7 + 900) * p.bright * (0.5 + 0.5 * v));
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(pk, t + .04);
    lp.frequency.setTargetAtTime(f * 2 + (pk - f) * .45, t + .04, .15);
    const o = O(S, 'sawtooth', f, t, end, p); o.connect(lp);
    scoop([o], t, 20, .025, p); // musicbox
    vibrato(S, t, end, [o], { rate: 5.6, depth: 11, delay: .25, rise: .25, wander: 3 });
  } },
  horn: { rev: 0.4, level: 0.7, cents: 4, play(S, out, t, d, f, v, p) {
    // musicbox: the lips slur up onto the note with a short buzz, the tone flares and settles,
    // and louder notes are much brassier
    const g = G(S); const lp = F(S, 'lowpass', f * 2, 0.8);
    const end = adsr(g.gain, t, d, { a: p.att || .06, dc: .3, s: .9, r: p.rel || .2, peak: v * .5 });
    const db = dynB(p), top = Math.min(7000, (f * 3 + 300) * p.bright * db * db);
    lp.frequency.setValueAtTime(f * 1.1, t);
    lp.frequency.linearRampToValueAtTime(Math.min(8000, top * 1.3), t + .07);
    lp.frequency.setTargetAtTime(top, t + .07, .15);
    const o1 = O(S, 'sawtooth', f, t, end, p); const g1 = G(S, .5); o1.connect(g1).connect(lp);
    const o2 = O(S, wave(S, 'horn'), f, t, end, p, 1, 4); o2.connect(lp);
    scoop([o1, o2], t, 26, .03, p);
    const trem = vibrato(S, t, end, [o1, o2], { rate: 4.8, depth: 4, delay: .4, rise: .4, wander: 3, amp: .02 });
    lp.connect(trem).connect(press(S, t, end, .03)).connect(g).connect(out);
    noise(S, out, t, { f: Math.min(f * 4, 6000), q: 1.2, a: .004, tau: .02, peak: v * .05 * db });
  } },
  tuba: { cents: 3, rev: 0.2, level: 0.7, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', (f * 3 + 150) * p.bright, 1.0);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .035, dc: .2, s: .8, r: p.rel || .1, peak: v * .55 });
    O(S, 'sawtooth', f, t, end, p).connect(lp);
    const sg = G(S, .5); O(S, 'sine', f, t, end, p).connect(sg).connect(lp);
  } },
  flute: { rev: 0.38, level: 1.18, cents: 4, play(S, out, t, d, f, v, p) {
    // musicbox: nearly a sine, with harmonics that grow with the dynamic. Each note starts with a
    // puff of air and a flicker of the octave above (the "chiff"), breath runs through it, and the
    // vibrato is mostly in the breath
    const g = G(S), sum = G(S, 1);
    const end = adsr(g.gain, t, d, { a: p.att || .06, dc: .15, s: .85, r: p.rel || .1, peak: v * .48 });
    const b = p.bright * dynB(p);
    const o1 = O(S, 'sine', f, t, end, p); const g1 = G(S, .78); o1.connect(g1).connect(sum);
    const o2 = O(S, 'sine', f, t, end, p, 2); const g2 = G(S); o2.connect(g2).connect(sum);
    g2.gain.setValueAtTime(.34 * b, t); g2.gain.setTargetAtTime(.12 * b, t + .02, .04);
    const o3 = O(S, 'sine', f, t, end, p, 3); const g3 = G(S, .05 * b * b); o3.connect(g3).connect(sum);
    const o4 = O(S, 'sine', f, t, end, p, 4); const g4 = G(S, .018 * b * b); o4.connect(g4).connect(sum);
    const os = [o1, o2, o3, o4];
    scoop(os, t, 10, .025, p);
    const trem = vibrato(S, t, end, os, { rate: 5, depth: 8, delay: .22, rise: .35, wander: 3, amp: .1 });
    sum.connect(trem).connect(press(S, t, end, .04)).connect(g).connect(out);
    // breath
    const n = noiseSrc(S, t, end); const hp = F(S, 'bandpass', Math.min(f * 2.2, 9000), 0.7); const ng = G(S);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(v * .07, t + .02);
    ng.gain.setTargetAtTime(v * .016, t + .02, .05); ng.gain.setTargetAtTime(0, Math.max(t + d, t + .04), .03);
    n.connect(hp).connect(ng).connect(out);
  } },
  clarinet: { rev: 0.3, level: 1.16, cents: 3, play(S, out, t, d, f, v, p) {
    // musicbox: the reed speaks dull and opens up, louder notes are brighter, and breath runs
    // under the tone. Little vibrato, as a classical player would, but never quite still
    const g = G(S);
    const top = Math.min(9000, (700 + 2300 * dynB(p)) * p.bright);
    const lp = F(S, 'lowpass', top, 0.6);
    lp.frequency.setValueAtTime(clamp(f * 1.5, 300, top), t); lp.frequency.setTargetAtTime(top, t, .03);
    const end = adsr(g.gain, t, d, { a: p.att || .035, dc: .2, s: .9, r: p.rel || .08, peak: v * .42 });
    const o = O(S, wave(S, 'clarinet'), f, t, end, p); o.connect(lp);
    scoop([o], t, 8, .02, p);
    const trem = vibrato(S, t, end, [o], { rate: 4.6, depth: 4, delay: .45, rise: .4, wander: 3, amp: .015 });
    lp.connect(trem).connect(press(S, t, end, .035)).connect(g).connect(out);
    noise(S, out, t, { f: f * 3, q: 1, a: .01, tau: .02, peak: v * .02 });
    const n = noiseSrc(S, t, end); const nb = F(S, 'bandpass', Math.min(f * 3, 8000), 1); const ng = G(S);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(v * .006, t + .03);
    ng.gain.setTargetAtTime(0, Math.max(t + d, t + .04), .03);
    n.connect(nb).connect(ng).connect(out);
  } },
  oboe: { cents: 3, rev: 0.3, level: 1.98, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', Math.min(9000, 3800 * p.bright), 0.6);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .03, dc: .2, s: .9, r: p.rel || .08, peak: v * .36 });
    const o = O(S, wave(S, 'oboe'), f, t, end, p); o.connect(lp);
    scoop([o], t, 10, .025, p); // musicbox
    vibrato(S, t, end, [o], { rate: 5.5, depth: 8, delay: .25, rise: .3, wander: 3 });
  } },
  bassoon: { cents: 3, rev: 0.25, level: 1.72, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', Math.min(6000, 1700 * p.bright), 0.7);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .04, dc: .2, s: .85, r: p.rel || .08, peak: v * .45 });
    const o = O(S, wave(S, 'bassoon'), f, t, end, p); o.connect(lp);
    scoop([o], t, 10, .025, p); // musicbox
    vibrato(S, t, end, [o], { rate: 5, depth: 5, delay: .35, rise: .3, wander: 3 });
  } },
  accordion: { rev: 0.22, level: 2.06, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', Math.min(9000, (2600 + f) * p.bright), 0.7);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .025, dc: .2, s: .92, r: p.rel || .07, peak: v * .4 });
    [0, 15, -13].forEach((c, i) => { const og = G(S, i ? .28 : .36); O(S, wave(S, 'reed'), f, t, end, p, 1, c).connect(og).connect(lp); });
  } },
  fiddle: { rev: 0.3, level: 1.32, cents: 4, body(S, out) {
    // musicbox: the resonances of a violin body. The vibrato sweeps each note's harmonics across
    // them, so the tone shimmers as a real violin's does
    const hp = F(S, 'highpass', 180, .7);
    let node = hp;
    for (const [ff, q, db] of [[290, 5, 6], [460, 4, 4], [1100, 2.5, 2], [2500, 1.5, 6], [3500, 2.5, 3]]) { const r = F(S, 'peaking', ff, q, db); node.connect(r); node = r; }
    node.connect(out);
    return hp;
  }, play(S, out, t, d, f, v, p) {
    // musicbox: one bowed string (a sawtooth). Bow noise runs through the note, strongest as the
    // bow bites, and the pitch settles onto the note
    const g = G(S), lp = F(S, 'lowpass', Math.min(10000, 5600 * p.bright * dynB(p)), 0.6);
    const end = adsr(g.gain, t, d, { a: p.att || .07, dc: .25, s: .85, r: p.rel || .16, peak: v * .3 });
    const o = O(S, 'sawtooth', f, t, end, p); o.connect(lp);
    scoop([o], t, 16, .03, p);
    const trem = vibrato(S, t, end, [o], { rate: 5.8, depth: 14, delay: .18, rise: .25, wander: 3, amp: .03 });
    lp.connect(trem).connect(press(S, t, end, .06)).connect(g).connect(out);
    const n = noiseSrc(S, t, end); const nb = F(S, 'bandpass', clamp(f * 4, 1800, 8000), .5); const ng = G(S);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(v * .06, t + .012);
    ng.gain.setTargetAtTime(v * .014, t + .012, .04); ng.gain.setTargetAtTime(0, Math.max(t + d, t + .05), .04);
    n.connect(nb).connect(ng).connect(out);
  } },
  harp: { rev: 0.45, level: 1.07, play(S, out, t, d, f, v, p) {
    pluck(S, out, t, d, f, v * .55, PLUCK.harp, [F(S, 'lowpass', 3500 * p.bright * dynB(p), .5)]); // musicbox: dynB
    partial(S, out, t, f, { a: .003, tau: .9, peak: v * .12 });
  } },
  guitar: { rev: 0.25, level: 1.53, play(S, out, t, d, f, v, p) {
    pluck(S, out, t, d, f, v * .55, PLUCK.guitar, [F(S, 'lowpass', 4200 * p.bright * dynB(p), .5), F(S, 'peaking', 220, 1, 3)]);
  } },
  banjo: { rev: 0.18, level: 1.18, play(S, out, t, d, f, v, p) {
    pluck(S, out, t, d, f, v * .5, PLUCK.banjo, [F(S, 'highpass', 250, .5), F(S, 'peaking', 2500, 1.5, 5)]);
  } },
  harpsichord: { rev: 0.3, level: 1.74, play(S, out, t, d, f, v, p) {
    const hp = F(S, 'highpass', 180, .5);
    pluck(S, out, t, d, f, v * .42, PLUCK.harpsichord, [hp]);
    pluck(S, out, t, d, f * 2, v * .16 * p.bright, PLUCK.harpsichord, [F(S, 'highpass', 400, .5)]);
  } },
  pizz: { rev: 0.35, level: 1.21, play(S, out, t, d, f, v, p) {
    pluck(S, out, t, d, f, v * .6, PLUCK.pizz, [F(S, 'lowpass', 2400 * p.bright * dynB(p), .6)]); // musicbox: dynB
    partial(S, out, t, f, { a: .002, tau: .12, peak: v * .18 });
  } },
  upright: { rev: 0.15, level: 0.72, play(S, out, t, d, f, v, p) {
    pluck(S, out, t, d, f, v * .5, PLUCK.upright, [F(S, 'lowpass', 1400 * p.bright * dynB(p), .6)]);
    partial(S, out, t, f, { a: .004, tau: .5, peak: v * .45, damp: t + d + .04, dampTau: .07 });
    noise(S, out, t, { type: 'lowpass', f: 900, q: .5, tau: .01, peak: v * .12 });
  } },
  fretless: { cents: 3, rev: 0.12, level: 0.69, play(S, out, t, d, f, v, p) {
    // musicbox: the string's harmonics (a sawtooth) through a filter that opens as the finger plucks
    // and settles around the 4th harmonic, with the fretless "mwah", a resonance near the 3rd. A
    // high-pass that follows the note trims the fundamental: a real bass's weight is in its 2nd to
    // 5th harmonics; a sine-heavy bass booms on a subwoofer and sounds thin in the upper bass.
    const g = G(S), hp = F(S, 'highpass', f * 1.2, .7), lp = F(S, 'lowpass', 300, .7), lp2 = F(S, 'lowpass', 300, .7), mwah = F(S, 'peaking', f * 2.5 + 120, 1.5, 2.5);
    hp.connect(lp).connect(lp2).connect(mwah).connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .012, dc: .6, s: .72, r: p.rel || .08, peak: v * .6 });
    const db = dynB(p), top = Math.min(4000, (f * 5 + 250) * p.bright * db), rest = Math.min(2500, (f * 3 + 120) * p.bright * db);
    for (const l of [lp, lp2]) { // two stages: a steep slope above the 4th harmonic
      l.frequency.setValueAtTime(f * 2 + 100, t);
      l.frequency.linearRampToValueAtTime(top, t + .02);
      l.frequency.setTargetAtTime(rest, t + .02, .25);
    }
    const o1 = O(S, 'sawtooth', f, t, end, p); o1.connect(hp);
    // a fretless player slides into some notes; a soft thump of the finger on the string
    scoop([o1], t, Math.random() < .3 ? 35 : 6, .04, p);
    vibrato(S, t, end, [o1], { rate: 4.5, depth: 6, delay: .3, rise: .4, wander: 2 });
    noise(S, out, t, { type: 'lowpass', f: 700, q: .7, tau: .012, peak: v * .1 });
  } },
  synbass: { loose: 0.3, rev: 0.08, level: 0.76, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', 300, 5);
    lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .003, dc: .35, s: .55, r: p.rel || .06, peak: v * .5 });
    lp.frequency.setValueAtTime(Math.min(5000, 2600 * p.bright * v), t);
    lp.frequency.setTargetAtTime(f * 2 + 80, t, .07);
    O(S, 'sawtooth', f, t, end, p).connect(lp);
    const sq = G(S, .5); O(S, 'square', f, t, end, p, 1, -6).connect(sq).connect(lp);
  } },
  timpani: { rev: 0.45, level: 0.53, play(S, out, t, d, f, v, p) {
    const damp = t + Math.max(d, .15) + .5;
    partial(S, out, t, f, { a: .004, tau: .55, peak: v * .85, bend: 1.035, bendTau: .05, damp, dampTau: .15 });
    partial(S, out, t, f * 1.505, { a: .003, tau: .35, peak: v * .32, damp, dampTau: .15 });
    partial(S, out, t, f * 1.99, { a: .003, tau: .25, peak: v * .2, damp, dampTau: .15 });
    partial(S, out, t, f * 2.44, { a: .002, tau: .15, peak: v * .1 });
    noise(S, out, t, { type: 'lowpass', f: 500 * dynB(p), q: .7, tau: .03, peak: v * .5 }); // musicbox: dynB
  } },
  chip: { loose: 0, rev: 0.15, level: 1.17, play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', 6000 * p.bright, .5); lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .003, dc: .1, s: .8, r: p.rel || .04, peak: v * .3 });
    const o = O(S, 'square', f, t, end, p); o.connect(lp);
    vibrato(S, t, end, [o], { rate: 6, depth: 12, delay: .25, rise: .1 });
  } }
};
['sine', 'square', 'saw', 'triangle'].forEach(w => {
  INST[w] = { loose: 0, rev: 0.2, level: ({ sine: 0.94, triangle: 1.15, square: 0.78, saw: 1.35 })[w], play(S, out, t, d, f, v, p) {
    const g = G(S); const lp = F(S, 'lowpass', 8000 * p.bright, .5); lp.connect(g).connect(out);
    const end = adsr(g.gain, t, d, { a: p.att || .008, dc: .2, s: .85, r: p.rel || .08, peak: v * .4 });
    O(S, w === 'saw' ? 'sawtooth' : w, f, t, end, p).connect(lp);
  } };
});

// musicbox: the vowel, once per voice: formant filters that sway a little, as a choir's vowel does
function vowel(S, out, vo, formants, onStop) {
  const into = G(S, 1), t = S.ctx.currentTime;
  const sway = S.ctx.createOscillator(); sway.frequency.value = .15 + Math.random() * .2; sway.start(t);
  if (onStop) onStop(() => sway.stop());
  for (const [ff, q, a] of formants) {
    const fc = ff * (vo.bright > 1 ? 1.1 : 1), bp = F(S, 'bandpass', fc, q), fg = G(S, a);
    const sg = G(S, fc * .03); sway.connect(sg).connect(bp.frequency);
    into.connect(bp).connect(fg).connect(out);
  }
  return into;
}
// musicbox: three singers per note, each a few cents from the others, finding the note from a
// little below, coming in a moment apart, each with their own vibrato; breath through the vowel
function choirVoice(S, out, t, d, f, v, p) {
  const g = G(S); g.connect(out);
  const end = adsr(g.gain, t, d, { a: p.att || .28, dc: .3, s: .95, r: p.rel || .6, peak: v * 1.6 });
  for (let i = 0; i < 3; i++) {
    const o = O(S, 'sawtooth', f, t, end, p, 1, (Math.random() * 2 - 1) * 10);
    const og = G(S); og.gain.setValueAtTime(0, t); og.gain.setTargetAtTime(.41, t + Math.random() * .06, .03);
    o.connect(og).connect(seat(S, i, 3, .45)).connect(g);
    scoop([o], t, 14, .05, p);
    vibrato(S, t, end, [o], { rate: 5.1, depth: 11, delay: .2, rise: .5, wander: 4 });
  }
  const n = noiseSrc(S, t, end); const ng = G(S, v * .1); n.connect(ng).connect(g);
}

/* ----------------------------------------------------------------- drums */
const DRUM = {
  kick: { rev: 0.05, level: 0.95, hit(S, out, t, v) {
    const g = G(S); g.connect(out);
    const end = perc(g.gain, t, { a: .003, tau: .13, peak: v * 1.0 });
    const o = O(S, 'sine', 150, t, end); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(46, t + .11);
    o.connect(g);
    noise(S, out, t, { type: 'lowpass', f: 3000, q: .5, tau: .003, peak: v * .28 });
  } },
  snare: { rev: 0.25, level: 1.12, hit(S, out, t, v) {
    noise(S, out, t, { type: 'highpass', f: 1100, q: .5, tau: .055, peak: v * .6 });
    noise(S, out, t, { type: 'bandpass', f: 4500, q: .8, tau: .03, peak: v * .25 });
    partial(S, out, t, 185, { type: 'triangle', a: .001, tau: .035, peak: v * .5, bend: 1.25, bendTau: .02 });
  } },
  rim: { rev: 0.2, level: 1.66, hit(S, out, t, v) {
    partial(S, out, t, 1650, { a: .001, tau: .007, peak: v * .5 });
    partial(S, out, t, 520, { a: .001, tau: .016, peak: v * .4 });
    noise(S, out, t, { f: 3200, q: 2, tau: .008, peak: v * .55 });
  } },
  hat: { rev: 0.1, level: 0.79, hit(S, out, t, v) { cymbal(S, out, t, v, .02, 7500, .5); } },
  ohat: { rev: 0.15, level: 0.56, hit(S, out, t, v) { cymbal(S, out, t, v, .13, 7000, .45); } },
  ride: { rev: 0.25, level: 1.65, hit(S, out, t, v) {
    const g = G(S); const bp = F(S, 'bandpass', 5500, .8); bp.connect(g).connect(out);
    const end = perc(g.gain, t, { a: .001, tau: .38, peak: v * .5 });
    metal(S, bp, t, end, 1.5);
    noise(S, out, t, { type: 'highpass', f: 8000, q: .5, tau: .2, peak: v * .07 });
  } },
  crash: { rev: 0.3, level: 0.75, hit(S, out, t, v) {
    noise(S, out, t, { type: 'highpass', f: 3500, q: .5, a: .002, tau: .55, peak: v * .4 });
    const g = G(S); const bp = F(S, 'bandpass', 4500, .7); bp.connect(g).connect(out);
    const end = perc(g.gain, t, { a: .002, tau: .45, peak: v * .35 });
    metal(S, bp, t, end, 1.1);
  } },
  shaker: { rev: 0.1, level: 1.21, hit(S, out, t, v) { noise(S, out, t, { f: 6500, q: 1.4, a: .012, tau: .025, peak: v * .55 }); } },
  tamb: { rev: 0.15, level: 0.76, hit(S, out, t, v) {
    noise(S, out, t, { type: 'highpass', f: 6500, q: .7, a: .002, tau: .05, peak: v * .45 });
    noise(S, out, t + .013, { f: 9000, q: 2, a: .001, tau: .06, peak: v * .25 });
  } },
  conga: { rev: 0.18, level: 0.84, hit(S, out, t, v) { hand(S, out, t, v, 340, .11); } },
  tumba: { rev: 0.18, level: 0.76, hit(S, out, t, v) { hand(S, out, t, v, 235, .15); } },
  bongo: { rev: 0.15, level: 0.91, hit(S, out, t, v) { hand(S, out, t, v, 520, .055); } },
  bongolo: { rev: 0.15, level: 0.82, hit(S, out, t, v) { hand(S, out, t, v, 395, .07); } },
  clave: { rev: 0.25, level: 0.83, hit(S, out, t, v) {
    partial(S, out, t, 2450, { a: .001, tau: .022, peak: v * .6 });
    noise(S, out, t, { f: 2450, q: 8, tau: .01, peak: v * .2 });
  } },
  block: { rev: 0.25, level: 0.98, hit(S, out, t, v) {
    partial(S, out, t, 880, { a: .001, tau: .028, peak: v * .6 });
    partial(S, out, t, 1460, { a: .001, tau: .014, peak: v * .25 });
    noise(S, out, t, { f: 900, q: 6, tau: .015, peak: v * .25 });
  } },
  cowbell: { rev: 0.2, level: 0.54, hit(S, out, t, v) {
    const g = G(S); const bp = F(S, 'bandpass', 820, 1.6); bp.connect(g).connect(out);
    const end = perc(g.gain, t, { a: .001, tau: .085, peak: v * .7 });
    O(S, 'square', 545, t, end).connect(bp); O(S, 'square', 815, t, end).connect(bp);
  } },
  guiro: { rev: 0.15, level: 3.85, hit(S, out, t, v) {
    for (let i = 0; i < 10; i++) noise(S, out, t + i * .016, { f: 2900, q: 2, tau: .004, peak: v * .32 * (.55 + .45 * i / 9) });
  } },
  tomlo: { rev: 0.25, level: 0.74, hit(S, out, t, v) { tom(S, out, t, v, 92); } },
  tommid: { rev: 0.25, level: 0.79, hit(S, out, t, v) { tom(S, out, t, v, 132); } },
  tomhi: { rev: 0.25, level: 0.83, hit(S, out, t, v) { tom(S, out, t, v, 182); } },
  bodhran: { rev: 0.2, level: 0.76, hit(S, out, t, v) {
    partial(S, out, t, 78, { a: .003, tau: .13, peak: v * .9, bend: 1.5, bendTau: .02 });
    partial(S, out, t, 128, { a: .002, tau: .05, peak: v * .25 });
    noise(S, out, t, { f: 420, q: 1, tau: .025, peak: v * .4 });
  } },
  timbale: { rev: 0.25, level: 0.74, hit(S, out, t, v) {
    partial(S, out, t, 430, { a: .001, tau: .2, peak: v * .5, bend: 1.08 });
    partial(S, out, t, 655, { a: .001, tau: .12, peak: v * .25 });
    noise(S, out, t, { type: 'highpass', f: 2000, q: .5, tau: .03, peak: v * .35 });
  } },
  tri: { rev: 0.4, level: 0.44, hit(S, out, t, v) {
    partial(S, out, t, 2650, { a: .001, tau: .7, peak: v * .22 });
    partial(S, out, t, 4140, { a: .001, tau: .4, peak: v * .1 });
    partial(S, out, t, 6320, { a: .001, tau: .22, peak: v * .07 });
  } },
  clap: { rev: 0.3, level: 3.57, hit(S, out, t, v) {
    [0, .011, .022].forEach(o => noise(S, out, t + o, { f: 1300, q: 1, tau: .006, peak: v * .5 }));
    noise(S, out, t + .03, { f: 1200, q: .8, tau: .07, peak: v * .4 });
  } },
  gong: { rev: 0.6, level: 0.46, hit(S, out, t, v) {
    [[1, 1, 4], [1.48, .7, 3.2], [1.97, .6, 2.6], [2.34, .5, 2.2], [2.9, .35, 1.6], [3.6, .3, 1.3], [4.4, .2, 1]]
      .forEach(([r, a, tau], i) => partial(S, out, t, 72 * r, { a: i ? .25 : .02, tau, peak: v * a * .4 }));
    noise(S, out, t, { type: 'lowpass', f: 2000, q: .5, tau: .4, peak: v * .12 });
  } },
  thunder: { rev: 0.5, level: 2.38, hit(S, out, t, v) {
    const n = noiseSrc(S, t, t + 9); const lp = F(S, 'lowpass', 220, .5); const g = G(S);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 1.2, t + .35);
    g.gain.setTargetAtTime(v * .5, t + .35, .4); g.gain.setTargetAtTime(0, t + 1.6, 1.2);
    lp.frequency.setValueAtTime(600, t); lp.frequency.setTargetAtTime(160, t + .2, .8);
    n.connect(lp).connect(g).connect(out);
    noise(S, out, t + .05, { type: 'lowpass', f: 1400, q: .5, a: .01, tau: .2, peak: v * .35 });
  } },
  surf: { rev: 0.5, level: 1.42, hit(S, out, t, v) {
    const n = noiseSrc(S, t, t + 7); const lp = F(S, 'lowpass', 300, .4); const g = G(S);
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1500, t + 1.5); lp.frequency.linearRampToValueAtTime(450, t + 4.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * .55, t + 1.5); g.gain.setTargetAtTime(0, t + 1.6, .9);
    n.connect(lp).connect(g).connect(out);
  } }
};
function cymbal(S, out, t, v, tau, hpf, pk) {
  const g = G(S); const hp = F(S, 'highpass', hpf, .6); const pkf = F(S, 'peaking', 10000, 1, 4);
  hp.connect(pkf).connect(g).connect(out);
  const end = perc(g.gain, t, { a: .001, tau, peak: v * pk });
  const n = noiseSrc(S, t, end); n.connect(hp);
  metal(S, hp, t, end, 1.0);
}
function hand(S, out, t, v, f, tau) {
  const slap = v > 0.95;
  partial(S, out, t, f, { a: .002, tau: slap ? tau * .6 : tau, peak: v * .8, bend: 1.12, bendTau: .012 });
  partial(S, out, t, f * 1.52, { a: .001, tau: tau * .3, peak: v * .15 });
  noise(S, out, t, { f: slap ? 2600 : 1600, q: 1, tau: slap ? .02 : .008, peak: v * (slap ? .5 : .18) });
}
function tom(S, out, t, v, f) {
  partial(S, out, t, f, { a: .002, tau: .2, peak: v * .85, bend: 1.55, bendTau: .025 });
  partial(S, out, t, f * 1.6, { a: .001, tau: .06, peak: v * .15 });
  noise(S, out, t, { type: 'lowpass', f: 1600, q: .5, tau: .02, peak: v * .2 });
}

/* ------------------------------------------------------------------ beds */
// musicbox: beds are continuous sounds that run under every cue. Each one starts silent;
// the player sets the level of `input`. `swell` is the seconds per slow rise and fall.

// brown noise with a seamless loop point (the end crossfades into the start)
function brown(S) {
  if (S.brown) return S.brown;
  const sr = S.ctx.sampleRate, len = sr * 8, fade = Math.floor(sr * 0.5);
  const x = new Float32Array(len + fade);
  let last = 0;
  for (let i = 0; i < x.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = last * 3.5; }
  const buf = S.ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  for (let i = 0; i < len; i++) y[i] = i < fade ? x[i] * Math.sqrt(i / fade) + x[len + i] * Math.sqrt(1 - i / fade) : x[i];
  return (S.brown = buf);
}
function loopSrc(S, buf, t) {
  const src = S.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.start(t, Math.random() * (buf.duration - 0.5));
  return src;
}
// a slow sine wobble added to `param`
function lfo(S, rate, depth, param, t, phase = 0) {
  const o = S.ctx.createOscillator(); o.frequency.value = rate;
  const g = G(S, depth); o.connect(g).connect(param);
  o.start(t + phase / rate);
  return o;
}
const BED = {
  sea: { rev: 0.35, level: 0.85, swell: 12, make(S, out, t, p) {
    const src = loopSrc(S, brown(S), t);
    const lp = F(S, 'lowpass', 380 * p.bright, 0.5);
    const g = G(S, 0.6);
    src.connect(lp).connect(g).connect(out);
    // the swell: louder and brighter together, like a wave coming in
    return [src, lfo(S, 1 / p.swell, 0.4, g.gain, t), lfo(S, 1 / p.swell, 170 * p.bright, lp.frequency, t)];
  } },
  wind: { rev: 0.4, level: 1.7, swell: 9, make(S, out, t, p) {
    const src = loopSrc(S, S.noise, t);
    const bp = F(S, 'bandpass', 650 * p.bright, 1.1);
    const g = G(S, 0.55);
    src.connect(bp).connect(g).connect(out);
    return [src, lfo(S, 1 / p.swell, 380 * p.bright, bp.frequency, t), lfo(S, 1.7 / p.swell, 0.35, g.gain, t, 0.3),
      lfo(S, 0.31, 60 * p.bright, bp.frequency, t)];
  } },
  rain: { rev: 0.3, level: 0.47, swell: 15, make(S, out, t, p) {
    const src = loopSrc(S, S.noise, t);
    const hp = F(S, 'highpass', 1400, 0.5), lp = F(S, 'lowpass', 6000 * p.bright, 0.5);
    const g = G(S, 0.75);
    src.connect(hp).connect(lp).connect(g).connect(out);
    const body = loopSrc(S, brown(S), t); const bg = G(S, 0.35);
    body.connect(F(S, 'lowpass', 450, 0.5)).connect(bg).connect(out);
    return [src, body, lfo(S, 1 / p.swell, 0.2, g.gain, t)];
  } },
  drone: { rev: 0.5, level: 0.38, swell: 16, make(S, out, t, p) {
    const f = mtof(p.note);
    const lp = F(S, 'lowpass', (220 + f * 1.6) * p.bright, 0.8);
    const g = G(S, 0.65);
    lp.connect(g).connect(out);
    const srcs = [];
    // musicbox: the sine an octave down only when it is above 40 Hz; lower, it is rumble, not pitch
    const subR = f * 0.5 >= 40 ? 0.5 : 1, subA = f * 0.5 >= 40 ? 0.45 : 0.3;
    for (const [type, ratio, detune, amp] of [['sawtooth', 1, -7, 0.22], ['sawtooth', 1, 7, 0.22], ['triangle', 2, 3, 0.18], ['sine', subR, 0, subA]]) {
      const o = S.ctx.createOscillator(); o.type = type;
      o.frequency.value = clamp(f * ratio, 1, S.nyq * 0.9); o.detune.value = detune;
      const og = G(S, amp); o.connect(og).connect(lp); o.start(t); srcs.push(o);
    }
    srcs.push(lfo(S, 1 / p.swell, (120 + f * 0.8) * p.bright, lp.frequency, t), lfo(S, 0.6 / p.swell, 0.25, g.gain, t, 0.25));
    return srcs;
  } }
};

/* ----------------------------------------------------------------- engine */
// musicbox: parametric eq. A band is { type, f, gain, q }: highpass, lowpass, lowshelf, highshelf,
// peak or notch, the filters a DAW's eq uses. Returns the first and last filter, or null.
const EQ_TYPE = { highpass: 'highpass', lowpass: 'lowpass', lowshelf: 'lowshelf', highshelf: 'highshelf', peak: 'peaking', notch: 'notch' };
function eqChain(S, bands) {
  if (!bands || !bands.length) return null;
  const fs = bands.map(b => F(S, EQ_TYPE[b.type], b.f, b.q, b.gain || 0));
  for (let i = 1; i < fs.length; i++) fs[i - 1].connect(fs[i]);
  return [fs[0], fs[fs.length - 1]];
}
function makeIR(ctx, seconds, decayPow) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const y = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const a = 0.9 - 0.75 * x; // darker as it decays
      lp += a * ((Math.random() * 2 - 1) - lp);
      y[i] = lp * Math.pow(1 - x, decayPow);
    }
    // a few early reflections
    for (const [ms, amp] of [[11, .6], [19, .4], [27, .32], [37, .22], [53, .15]]) {
      const k = Math.floor(sr * (ms + ch * 2.3) / 1000); if (k < len) y[k] += amp * (Math.random() < .5 ? -1 : 1);
    }
  }
  return buf;
}

function createSynth(ctx, dest, opts = {}) {
  const S = { ctx, nyq: ctx.sampleRate / 2, waves: {}, ks: {} };
  const nlen = ctx.sampleRate * 3;
  S.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
  const nd = S.noise.getChannelData(0); for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

  const master = G(S, 0.72);
  // musicbox: mastering. A subsonic filter first: below about 32 Hz there is nothing musical, only
  // rumble that costs headroom and makes small subwoofers boom. Then the score's mix eq (eq mix ...).
  // Scrimshaw had a fixed +2 dB low shelf at 180 Hz and -2.5 dB high shelf at 7.5 kHz here, to warm
  // and soften raw oscillators; the instruments do that themselves now, so the master is neutral.
  const sub1 = F(S, 'highpass', 32, .54), sub2 = F(S, 'highpass', 32, 1.31);
  const mixIn = G(S, 1), mixOut = G(S, 1); mixIn.connect(mixOut);
  let mixKey = '[]', mixNodes = null;
  const setMixEq = bands => {
    const key = JSON.stringify(bands || []); if (key === mixKey) return; mixKey = key;
    mixIn.disconnect(); if (mixNodes) mixNodes[1].disconnect();
    mixNodes = eqChain(S, bands);
    if (mixNodes) { mixIn.connect(mixNodes[0]); mixNodes[1].connect(mixOut); } else mixIn.connect(mixOut);
  };
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.006; comp.release.value = 0.22;
  const out = G(S, 1);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  if (opts.raw) {
    // measurement chain: rough K-weighting, no compression
    master.connect(F(S, 'highpass', 60, .7)).connect(F(S, 'highshelf', 1500, .7, 4)).connect(out).connect(dest);
  } else { master.connect(sub1).connect(sub2).connect(mixIn); mixOut.connect(comp).connect(limiter).connect(out).connect(dest); }
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; out.connect(analyser);

  const verb = ctx.createConvolver(); verb.buffer = makeIR(ctx, 2.8, 3.4);
  const verbIn = F(S, 'highpass', 220, .6);
  const verbRet = G(S, 0.9);
  verbIn.connect(verb).connect(verbRet).connect(master);

  return {
    S, master, out, analyser, verbRet, comp, limiter, // musicbox: comp and limiter, for meters
    // a session bus lets "stop" silence everything already scheduled
    // build plucked-string buffers ahead of time, a few at a time
    warm(song, budgetMs = 12) {
      const todo = [];
      song.voices.forEach((v, vi) => {
        const cfg = PLUCK[v.inst] || (v.inst === 'piano' ? 'piano' : null); if (!cfg) return; // musicbox: piano
        const seen = new Set();
        // musicbox: warm every cue and transition, not just the default cue
        const tls = song.cues
          ? Object.values(song.cues).flatMap(c => [c.intro, c.loop, ...[].concat(...(c.introSlots || []), ...(c.loopSlots || []))])
            .concat((song.transitions || []).filter(x => x.via).map(x => x.via))
          : [song.intro, song.loop];
        for (const tl of tls) for (const e of tl.events) if (e.v === vi) for (const m of (e.m || e.pick.flat())) { // musicbox: every choice
          if (seen.has(m)) continue; seen.add(m);
          todo.push([mtof(m), cfg]);
          if (v.inst === 'harpsichord') todo.push([mtof(m) * 2, cfg]);
        }
      });
      let i = 0;
      const step = () => {
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        while (i < todo.length && (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 < budgetMs) { if (todo[i][1] === 'piano') pianoTone(S, todo[i][0]); else ks(S, todo[i][0], todo[i][1]); i++; }
        if (i < todo.length) setTimeout(step, 15);
      };
      step();
    },
    // musicbox: a bed: a continuous sound with its own level, starting silent
    bed(b, song) {
      const def = BED[b.inst];
      const input = G(S, 0);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const eqc = eqChain(S, b.eq), post = eqc ? (input.connect(eqc[0]), eqc[1]) : input; // musicbox: the bed's eq
      if (pan) { pan.pan.value = b.pan || 0; post.connect(pan).connect(master); } else post.connect(master);
      const send = G(S, b.rev != null ? b.rev : def.rev); post.connect(send).connect(verbIn);
      const t = ctx.currentTime + 0.02;
      const srcs = def.make(S, input, t, { bright: b.bright || 1, swell: b.swell || def.swell, note: b.note });
      let stopped = false;
      return {
        input, level: def.level,
        stop(fade = 1, at = null) {
          if (stopped) return; stopped = true;
          const t0 = Math.max(ctx.currentTime, at == null ? 0 : at);
          input.gain.cancelScheduledValues(t0);
          input.gain.setTargetAtTime(0, t0, Math.max(0.01, fade / 3));
          const end = t0 + Math.max(0.05, fade) * 2 + 0.1;
          for (const s of srcs) { try { s.stop(end); } catch (e) { } }
          setTimeout(() => { try { input.disconnect(); send.disconnect(); } catch (e) { } }, (end - ctx.currentTime) * 1000 + 500);
        }
      };
    },
    session(song) {
      if (Object.keys(S.ks).length > 160) S.ks = {};
      const bus = G(S, 1); bus.connect(master);
      const sendBus = G(S, 1); sendBus.connect(verbIn);
      verbRet.gain.setValueAtTime(0.25 + 1.6 * (song.reverb != null ? song.reverb : 0.3), ctx.currentTime);
      setMixEq(song.mixEq); // musicbox: the score's mix eq
      const stops = []; // musicbox: cleanups for voice bodies
      const ch = song.voices.map(v => {
        const def = v.drum ? DRUM[v.inst] : INST[v.inst];
        const input = G(S, v.vol * def.level);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        // musicbox: the voice's eq, before the pan and the reverb send
        const eqc = eqChain(S, v.eq), post = eqc ? (input.connect(eqc[0]), eqc[1]) : input;
        if (pan) { pan.pan.value = v.pan; post.connect(pan).connect(bus); } else post.connect(bus);
        const send = G(S, v.rev != null ? v.rev : def.rev); post.connect(send).connect(sendBus);
        // musicbox: an instrument's body (a violin's resonances, a choir's vowel) is built once per
        // voice, and every note plays into it
        const into = def.body ? def.body(S, input, v, fn => stops.push(fn)) : input;
        return { v, def, input, into };
      });
      return {
        bus, sendBus, ch,
        play(ev, t) {
          const c = ch[ev.v]; if (!c) return;
          try {
            // musicbox: players are not machines. Each note lands a few milliseconds either side
            // of the beat and a little louder or softer, and on instruments a player tunes as they
            // go, a few cents off. The voice's human= scales this; human=0 plays exactly as written.
            const hu = (c.v.human != null ? c.v.human : 1) * (c.def.loose != null ? c.def.loose : 1);
            const wob = () => hu * (Math.random() + Math.random() - 1);
            if (c.v.drum) { c.def.hit(S, c.input, t + wob() * .004, ev.vel * (1 + wob() * .1)); return; }
            const n = ev.m.length, dyn = ev.vel * (1 + wob() * .08), vs = dyn / Math.sqrt(n);
            ev.m.forEach((m, i) => {
              const p = { bright: c.v.bright, att: c.v.att, rel: c.v.rel, glide: c.v.glide, dyn,
                from: (ev.g != null && i === n - 1) ? mtof(ev.g) : null, cents: wob() * (c.def.cents || 0) };
              c.def.play(S, c.into, t + wob() * .008, ev.d, mtof(m), vs * (1 + wob() * .05), p);
            });
          } catch (e) { /* keep the music going if one note fails */ }
        },
        stop(fade = 0.06) {
          const now = ctx.currentTime;
          bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, fade);
          sendBus.gain.cancelScheduledValues(now); sendBus.gain.setTargetAtTime(0, now, fade);
          // musicbox: wait for long fades before disconnecting
          setTimeout(() => { try { bus.disconnect(); sendBus.disconnect(); } catch (e) { } stops.forEach(fn => { try { fn(); } catch (e) { } }); }, 1500 + fade * 5000);
        }
      };
    }
  };
}

// render a compiled song offline, scheduling in small chunks like the live player
async function renderOffline(song, seconds, sampleRate = 44100, opts = {}) { // musicbox: opts.seed, opts.cue
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const syn = createSynth(ctx, ctx.destination, opts);
  const sess = syn.session(song);
  // musicbox: roll the dice like the player does (opts.seed), and add the beds
  const rng = createRng(opts.seed != null ? opts.seed : 1);
  const cue = song.cues ? song.cues[opts.cue || song.defaultCue] : { intro: song.intro, loop: song.loop };
  const all = [];
  const add = (tl, off) => { for (const e of tl.events) { const r = realize(e, song.voices[e.v], rng); if (r) all.push([r.ev, e.t + r.dt + off + 0.05]); } };
  const intro = pass(cue, 'intro', rng);
  add(intro, 0);
  let off = intro.dur;
  while (cue.loop.dur > 0 && off < seconds) { const tl = pass(cue, 'loop', rng); add(tl, off); off += tl.dur; }
  all.sort((a, b) => a[1] - b[1]);
  for (const b of song.beds || []) {
    const sel = cue.beds ? (cue.beds[b.name] || 0) : 1;
    if (!sel) continue;
    const node = syn.bed(b, song);
    node.input.gain.setValueAtTime(sel * b.vol * node.level, 0);
  }
  const chunk = opts.chunk || 0.25;
  let idx = 0;
  const feed = (until) => { while (idx < all.length && all[idx][1] < until) { if (all[idx][1] < seconds) sess.play(all[idx][0], all[idx][1]); idx++; } };
  feed(chunk * 2);
  for (let t = chunk; t < seconds - chunk; t += chunk) {
    const tt = t;
    ctx.suspend(tt).then(() => { feed(tt + chunk * 2); ctx.resume(); });
  }
  return ctx.startRendering();
}


export { createSynth, renderOffline, INST, DRUM, BED, mtof };
