// Dice for scores: {…} note choices, chance= and jitter= on voices, and {B C} pattern choices.
// The compiler keeps every choice; the player rolls them each time the music comes round.
// The same seed gives the same music for the same sequence of calls.

import { assemble } from './score.js';

/** A seeded random number generator (mulberry32). Returns a function giving numbers in [0, 1). */
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() { return Math.floor(Math.random() * 2 ** 31); }

/**
 * Roll one compiled event for `voice`. Returns null when it doesn't sound this time, or
 * { ev, dt }: the event to play (with a concrete note list) and how many seconds late to play it.
 */
export function realize(ev, voice, rng) {
  if (voice && voice.chance < 1 && rng() >= voice.chance) return null;
  let out = ev;
  if (ev.pick) {
    const choice = ev.pick[Math.floor(rng() * ev.pick.length)];
    if (!choice || !choice.length) return null;
    out = Object.assign({}, ev, { m: choice });
    delete out.pick;
  }
  const dt = voice && voice.jitter > 0 ? rng() * voice.jitter : 0;
  return { ev: out, dt };
}

/** The timeline for one pass through a cue's intro or loop, picking one pattern per {…} slot. */
export function pass(cue, kind, rng) {
  const slots = kind === 'intro' ? cue.introSlots : cue.loopSlots;
  if (!slots) return kind === 'intro' ? cue.intro : cue.loop;
  return assemble(slots.map(sl => sl[Math.floor(rng() * sl.length)]));
}
