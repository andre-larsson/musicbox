// A plain-text report on a compiled score, written so a language model (or a person)
// can see what the music does without hearing it: structure, layers, ranges, and
// notes that clash with the harmony line or sit outside the key.

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NEUTRAL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

// spelling: 'sharp', 'flat', or 'neutral' (the usual names when the key has no sharps or flats)
// musicbox: an eq as text: "peak 80 Hz -4 dB Q1.2, highshelf 10 kHz +2 dB"
function eqText(bands) {
  const hz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${f} Hz`;
  const db = g => `${g > 0 ? '+' : ''}${g} dB`;
  return bands.map(b => [b.type, hz(b.f), /shelf|peak/.test(b.type) ? db(b.gain) : null, /pass|notch|peak/.test(b.type) ? `Q${b.q}` : null].filter(Boolean).join(' ')).join(', ');
}

function table(spell) { return spell === 'flat' ? FLAT : spell === 'sharp' ? SHARP : NEUTRAL; }
export function pcName(pc, spell = 'neutral') { return table(spell)[((pc % 12) + 12) % 12]; }
export function noteName(m, spell = 'neutral') {
  return pcName(m, spell) + (Math.floor(m / 12) - 1);
}
function spellingOf(key) { return key ? key.spell : 'neutral'; }

// Comfortable ranges (MIDI note numbers). Notes outside still play, but tend to sound
// unlike the instrument. Synths and pads have no limits.
export const RANGES = {
  flute: [60, 96], clarinet: [50, 91], oboe: [58, 91], bassoon: [34, 75],
  trumpet: [54, 84], horn: [41, 77], brass: [40, 84], tuba: [26, 62],
  fiddle: [55, 100], strings: [36, 96], pizz: [36, 88], harp: [24, 103],
  guitar: [40, 83], banjo: [48, 84], upright: [28, 67], fretless: [28, 67], synbass: [24, 60],
  timpani: [38, 60], marimba: [45, 96], vibes: [53, 89], xylophone: [65, 108], glock: [79, 108],
  celesta: [60, 108], musicbox: [60, 96], bell: [55, 96], steeldrum: [55, 88],
  choir: [40, 81], voices: [40, 81], accordion: [41, 93], harpsichord: [29, 89],
  organ: [24, 96], pipe: [24, 96], piano: [21, 108]
};

const fmtSec = s => s.toFixed(1) + ' s';
const orList = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1];

// A non-chord note that clashes: a semitone above a chord note (a minor 9th against it, like
// C over B), or a semitone below a major third (a minor third against it, like G over E major).
// Other non-chord notes (6ths, 7ths, 9ths, 11ths) are colour, not clashes.
function rubs(pc, h) {
  if (h.pcs.includes(pc)) return false;
  if (h.pcs.includes((pc + 11) % 12)) return true;
  return h.pcs.includes((h.root + 4) % 12) && pc === (h.root + 3) % 12;
}

const secName = s => s.name + (s.trans ? (s.trans > 0 ? '+' : '') + s.trans : '');
function describeTimeline(tl) {
  const bars = tl.sections.reduce((a, s) => a + s.bars, 0);
  return { bars, names: tl.sections.map(secName).join(' '), dur: tl.dur };
}
// a play or loop line with {B C} choices: names with braces, and the shortest and longest pass
function describeSlots(slots) {
  const names = [], lo = { bars: 0, dur: 0 }, hi = { bars: 0, dur: 0 };
  for (const sl of slots) {
    const ds = sl.map(describeTimeline);
    const uniq = [...new Set(ds.map(d => d.names))];
    names.push(sl.length > 1 ? `{${ds.map(d => d.names).join(' ')}}` : uniq[0]);
    lo.bars += Math.min(...ds.map(d => d.bars)); hi.bars += Math.max(...ds.map(d => d.bars));
    lo.dur += Math.min(...ds.map(d => d.dur)); hi.dur += Math.max(...ds.map(d => d.dur));
  }
  const bars = lo.bars === hi.bars ? `${lo.bars}` : `${lo.bars}–${hi.bars}`;
  const dur = Math.abs(lo.dur - hi.dur) < 0.05 ? fmtSec(lo.dur) : `${lo.dur.toFixed(1)}–${fmtSec(hi.dur)}`;
  return { names: names.join(' '), bars, dur };
}
function describePart(tl, slots) {
  if (slots) return describeSlots(slots);
  const d = describeTimeline(tl);
  return { names: d.names, bars: `${d.bars}`, dur: fmtSec(d.dur) };
}

function limited(items, limit, render) {
  const out = items.slice(0, limit).map(render);
  if (items.length > limit) out.push(`…and ${items.length - limit} more`);
  return out;
}

export function analyze(song, { limit = 12 } = {}) {
  const lines = [];
  const findings = { range: [], harmony: [], pick: [], key: [] };
  const spell = spellingOf(song.key);
  const nn = m => noteName(m, spell);

  const meter = `${song.beats} beats × ${song.steps} steps (${song.beats * song.steps} per bar)`;
  lines.push(`"${song.title}" · ${meter} · ${song.tempo} bpm${song.key ? ' · key ' + song.key.name : ''}`);
  if (song.mixEq && song.mixEq.length) lines.push(`Mix eq: ${eqText(song.mixEq)}`); // musicbox

  /* cues */
  lines.push('', 'Cues');
  const w = Math.max(...song.cueOrder.map(n => n.length + (n === song.defaultCue ? 10 : 0)));
  for (const name of song.cueOrder) {
    const c = song.cues[name];
    const parts = [];
    if (c.intro.dur) { const d = describePart(c.intro, c.introSlots); parts.push(`play ${d.names} (${d.bars} bars, ${d.dur})`); }
    if (c.loop.dur) { const d = describePart(c.loop, c.loopSlots); parts.push(`loop ${d.names} (${d.bars} bars, ${d.dur})`); }
    else if (c.then) parts.push(`then ${c.then}`);
    else if (c.intro.dur) parts.push('then stop');
    const label = name + (name === song.defaultCue ? ' (default)' : '');
    lines.push(`  ${label.padEnd(w)}  ${parts.join(' → ')}`);
  }
  if (song.transitions.length) {
    lines.push('', 'Switches');
    for (const tr of song.transitions) {
      let s = `  ${tr.from} -> ${tr.to}  at ${tr.at}`;
      if (tr.via) { const d = describeTimeline(tr.via); s += ` via ${d.names} (${d.bars} bar${d.bars === 1 ? '' : 's'})`; }
      if (tr.fade != null) s += ` fade ${tr.fade}`;
      lines.push(s);
    }
  }

  /* beds */
  const beds = song.beds || [];
  if (beds.length) {
    lines.push('', 'Beds (continuous; they keep going across cue switches)');
    const bw = Math.max(...beds.map(b => b.name.length));
    for (const b of beds) {
      const where = song.cueOrder.map(n => {
        const sel = song.cues[n].beds;
        const lvl = sel ? sel[b.name] || 0 : 1;
        return lvl ? n + (lvl !== 1 ? ` ×${lvl}` : '') : null;
      }).filter(Boolean);
      let s = `  ${b.name.padEnd(bw)}  ${b.inst}${b.note != null ? ' ' + nn(b.note) : ''}  vol ${b.vol}`;
      s += where.length === song.cueOrder.length && where.every(w => !w.includes('×')) ? '  in every cue' : where.length ? `  in ${where.join(', ')}` : '  in no cue';
      lines.push(s);
    }
  }

  /* layers */
  const maxLayer = Math.max(0, ...song.voices.map(v => v.layer || 0), ...beds.map(b => b.layer || 0));
  if (maxLayer > 0) {
    lines.push('', `Layers (intensity N plays layers 0 to N)`);
    for (let l = 0; l <= maxLayer; l++) {
      const vs = song.voices.concat(beds).filter(v => (v.layer || 0) === l).map(v => v.name);
      lines.push(`  ${l}: ${vs.length ? vs.join(' ') : '(none)'}`);
    }
  }

  /* voices: sounding range across every cue and transition */
  const timelines = song.cueOrder.flatMap(n => {
    const c = song.cues[n];
    return [c.intro, c.loop, ...[].concat(...(c.introSlots || []), ...(c.loopSlots || []))];
  }).concat(song.transitions.filter(t => t.via).map(t => t.via));
  const stats = song.voices.map(() => ({ lo: Infinity, hi: -Infinity, n: 0 }));
  for (const tl of timelines) for (const e of tl.events) {
    const st = stats[e.v]; st.n++;
    for (const m of e.m || (e.pick ? e.pick.flat() : [])) { st.lo = Math.min(st.lo, m); st.hi = Math.max(st.hi, m); }
  }
  lines.push('', 'Voices');
  const nw = Math.max(...song.voices.map(v => v.name.length), 4);
  const iw = Math.max(...song.voices.map(v => v.inst.length), 4);
  song.voices.forEach((v, i) => {
    const st = stats[i];
    let s = `  ${v.name.padEnd(nw)}  ${v.inst.padEnd(iw)}`;
    if (maxLayer > 0) s += `  layer ${v.layer || 0}`;
    const dice = [v.arp ? `arp ${v.arp}${v.pool === 'scale' ? ' over the scale' : ''}, every ${v.rate} step${v.rate === 1 ? '' : 's'}` : null,
      v.chance < 1 ? `chance ${v.chance}` : null, v.jitter > 0 ? `jitter ${v.jitter} s` : null,
      v.human != null && v.human !== 1 ? `human ${v.human}` : null, v.eq && v.eq.length ? `eq ${eqText(v.eq)}` : null].filter(Boolean); // musicbox: human, eq
    if (v.drum) s += `  ${st.n} hits`;
    else if (st.n) {
      s += `  ${(nn(st.lo) + '–' + nn(st.hi)).padEnd(8)}  ${st.n} notes`;
      const r = RANGES[v.inst];
      if (r && (st.lo < r[0] || st.hi > r[1])) {
        const out = [st.lo < r[0] ? `${nn(st.lo)} is below` : null, st.hi > r[1] ? `${nn(st.hi)} is above` : null].filter(Boolean).join(', ');
        s += `  ← ${out} the usual ${v.inst} range (${nn(r[0])}–${nn(r[1])})`;
        findings.range.push({ voice: v.name, inst: v.inst, lo: st.lo, hi: st.hi, usual: r });
      }
    } else s += '  (never plays)';
    if (dice.length) s += `  (${dice.join(', ')})`;
    lines.push(s);
  });

  /* patterns */
  const pats = Object.values(song.patterns);
  if (pats.length) {
    lines.push('', 'Patterns');
    const pw = Math.max(...pats.map(p => p.name.length));
    for (const p of pats) {
      let s = `  ${p.name.padEnd(pw)}  ${String(p.bars).padStart(2)} bar${p.bars === 1 ? ' ' : 's'}`;
      if (p.key && (!song.key || p.key.name !== song.key.name)) s += `  key ${p.key.name}`;
      if (p.beats !== song.beats || p.steps !== song.steps) s += `  ${p.beats}×${p.steps}`;
      if (p.tempo !== song.tempo) s += `  ${p.tempo} bpm`;
      s += `  voices: ${Object.keys(p.perVoice).join(' ') || '(none)'}`;
      lines.push(s);
      if (p.harmony.length) {
        const bars = [];
        for (let b = 0; b < p.bars; b++) {
          const lo = b * p.barSteps, hi = lo + p.barSteps;
          const syms = p.harmony.filter(h => h.step < hi && h.step + h.len > lo)
            .map(h => (h.step < lo ? '(' + h.sym + ')' : h.sym));
          bars.push(syms.join(' ') || '-');
        }
        const shown = bars.slice(0, 16).join(' | ') + (bars.length > 16 ? ' | …' : '');
        lines.push(`  ${' '.repeat(pw)}  harmony: | ${shown} |`);
      }
    }
  }

  /* harmony check: notes on strong beats that aren't in the chord */
  for (const p of pats) {
    if (!p.harmony.length) continue;
    const chordAt = step => p.harmony.find(h => step >= h.step && step < h.step + h.len);
    for (const vName in p.perVoice) {
      const v = song.voices.find(x => x.name === vName);
      if (!v || v.drum) continue;
      for (const e of p.perVoice[vName]) {
        if (e.star) continue;
        if (e.pick) continue; // random choices are checked below
        const onBeat = e.step % p.steps === 0;
        const strong = onBeat && (e.step % p.barSteps === 0 || e.len >= p.steps);
        if (!strong) continue;
        const h = chordAt(e.step);
        if (!h) continue;
        const bad = e.notes.map(n => n + v.trans).filter(m => !h.pcs.includes(((m % 12) + 12) % 12));
        if (bad.length) findings.harmony.push({
          pattern: p.name, voice: vName, bar: Math.floor(e.step / p.barSteps) + 1,
          beat: Math.floor((e.step % p.barSteps) / p.steps) + 1, notes: bad.map(nn), chord: h.sym
        });
      }
    }
  }
  if (findings.harmony.length) {
    lines.push('', 'Strong-beat notes that are not in the chord (fine as passing notes or suspensions; a mistake if unintended)');
    lines.push(...limited(findings.harmony, limit, f => `  ${f.pattern} bar ${f.bar} beat ${f.beat}: ${f.voice} ${f.notes.join('+')} over ${f.chord}`));
  }

  /* random choices ({…}, arp=random) that rub against the chord. Other notes outside the
     chord (a 6th, 7th, 9th or 11th) are colour; these are the ones that sound like a clash. */
  findings.pick = [];
  for (const p of pats) {
    if (!p.harmony.length) continue;
    for (const vName in p.perVoice) {
      const v = song.voices.find(x => x.name === vName);
      if (!v || v.drum) continue;
      for (const e of p.perVoice[vName]) {
        if (!e.pick) continue;
        const h = p.harmony.find(x => e.step >= x.step && e.step < x.step + x.len);
        if (!h) continue;
        const all = [...new Set(e.pick.flat())].sort((a, b) => a - b).map(n => n + v.trans);
        const bad = all.filter(m => rubs(((m % 12) + 12) % 12, h));
        if (!bad.length) continue;
        const bar = Math.floor(e.step / p.barSteps) + 1;
        if (findings.pick.some(f => f.pattern === p.name && f.voice === vName && f.bar === bar && f.chord === h.sym)) continue;
        findings.pick.push({ pattern: p.name, voice: vName, bar, chord: h.sym, notes: bad.map(nn), of: all.length });
      }
    }
  }
  if (findings.pick.length) {
    lines.push('', 'Random choices that rub against the chord (a semitone above a chord note, or a minor third against a major one)');
    lines.push(...limited(findings.pick, limit, f => `  ${f.pattern} bar ${f.bar}: ${f.voice} can pick ${orList(f.notes)} over ${f.chord} (${f.notes.length} of ${f.of} choices)`));
  }

  /* key check: notes that fit neither the key nor the chord sounding at the time */
  const keyRows = [];
  for (const p of pats) {
    if (!p.key) continue;
    const ps = spellingOf(p.key);
    const chordAt = step => p.harmony.find(h => step >= h.step && step < h.step + h.len);
    const outside = new Map();
    for (const vName in p.perVoice) {
      const v = song.voices.find(x => x.name === vName);
      if (!v || v.drum) continue;
      for (const e of p.perVoice[vName]) for (const n of e.pick ? [...new Set(e.pick.flat())] : e.notes) {
        const pc = (((n + v.trans) % 12) + 12) % 12;
        if (p.key.pcs.includes(pc)) continue;
        const h = chordAt(e.step);
        if (h && h.pcs.includes(pc)) continue;
        const name = pcName(pc, ps);
        const r = outside.get(name) || { count: 0, voices: new Set(), bars: new Set() };
        r.count++; r.voices.add(vName); r.bars.add(Math.floor(e.step / p.barSteps) + 1);
        outside.set(name, r);
      }
    }
    for (const [name, r] of outside) {
      const bars = [...r.bars].sort((a, b) => a - b);
      const row = { pattern: p.name, note: name, count: r.count, voices: [...r.voices], bars, key: p.key.name };
      findings.key.push(row);
      keyRows.push(`  ${p.name}: ${name} ×${r.count} in ${row.voices.join(', ')} (bar${bars.length > 1 ? 's' : ''} ${bars.slice(0, 6).join(', ')}${bars.length > 6 ? ', …' : ''}), outside ${p.key.name} and not in the chord`);
    }
    const chordOut = [], seenSym = new Set();
    for (const h of p.harmony) {
      const out = h.pcs.filter(pc => !p.key.pcs.includes(pc));
      if (out.length && !seenSym.has(h.sym)) { seenSym.add(h.sym); chordOut.push(`${h.sym} (${out.map(pc => pcName(pc, ps)).join(' ')})`); }
    }
    if (chordOut.length) keyRows.push(`  ${p.name}: chords borrowed from outside ${p.key.name}: ${chordOut.join(', ')}`);
  }
  if (keyRows.length) {
    lines.push('', 'Key (borrowed chords are normal; check notes outside both the key and the chord)');
    lines.push(...limited(keyRows, limit, r => r));
  }

  return { text: lines.join('\n'), findings };
}
