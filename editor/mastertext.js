// The score's mastering lines as text, `eq mix` and `master`: the master panel edits them and
// writes them back here. Eq bands are { type, f, gain, q }, the shape the compiler gives in
// song.mixEq; the master is { gain, highpass: { f, slope, q }, comp: { threshold, ratio },
// limit: { threshold } }, with null for a stage that is off, as in song.master.

import { masterDefaults } from '../src/score.js';

export const BAND_TYPES = ['peak', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];
export const HAS_GAIN = { peak: true, lowshelf: true, highshelf: true };
export const HAS_Q = { peak: true, highpass: true, lowpass: true, notch: true };
export const DEFAULT_Q = { highpass: 0.707, lowpass: 0.707, notch: 2, peak: 1, lowshelf: 0.707, highshelf: 0.707 };
export const LIMITS = { f: [20, 20000], gain: [-24, 24], q: [0.1, 20] };

const clamp = (x, [a, b]) => Math.max(a, Math.min(b, x));

/** 80, 2.5k, 12.3k: what the score format reads back as the same frequency. */
export function formatFreq(f) {
  if (Math.round(f) < 1000) return String(Math.round(f));
  const k = f / 1000;
  return String(k >= 10 ? Math.round(k * 10) / 10 : Math.round(k * 100) / 100) + 'k';
}

/** A band rounded to what its text says, so the panel and the score agree. */
export function roundBand(b) {
  const type = BAND_TYPES.includes(b.type) ? b.type : 'peak';
  const fs = formatFreq(clamp(+b.f || 1000, LIMITS.f));
  const f = fs.endsWith('k') ? parseFloat(fs) * 1000 : +fs;
  const gain = HAS_GAIN[type] ? Math.round(clamp(+b.gain || 0, LIMITS.gain) * 10) / 10 : 0;
  let q = DEFAULT_Q[type];
  if (HAS_Q[type] && b.q != null && isFinite(b.q)) {
    const v = clamp(+b.q, LIMITS.q);
    q = Math.abs(v - DEFAULT_Q[type]) < 1e-9 ? DEFAULT_Q[type] : Math.round(v * 100) / 100;
  }
  return { type, f: Math.round(f * 1000) / 1000, gain, q };
}

/** peak=80,-6,1.4  highshelf=8k,+2  highpass=40 */
export function formatBand(band) {
  const b = roundBand(band);
  let s = `${b.type}=${formatFreq(b.f)}`;
  if (HAS_GAIN[b.type]) s += ',' + (b.gain >= 0 ? '+' : '') + b.gain;
  if (HAS_Q[b.type] && b.q !== DEFAULT_Q[b.type]) s += ',' + b.q;
  return s;
}

const MIX_LINE = /^(\s*)eq\s+mix(?=\s|$)[^#]*?(\s*#.*)?$/i;
const MASTER_LINE = /^(\s*)master(?=\s|$)[^#]*?(\s*#.*)?$/i;
const AFTER = [/^(voice|bed|eq|master)\s/i, /^(title|composer|about|tempo|key|reverb|beats|steps|swing)\s/i];

/**
 * The score with its `eq mix` lines replaced by one line holding `bands` (in place of the first,
 * keeping its comment), or with them removed when there are no bands. A score without one gets
 * it after its last voice, bed, eq or master line. Returns { text, line } (1-based; 0 when removed).
 */
export function setMixLine(text, bands) {
  return setLine(text, MIX_LINE, bands.length ? 'eq mix ' + bands.map(formatBand).join(' ') : null);
}

/** The same for the `master` line, which is left out when every setting is the default. */
export function setMasterLine(text, m) {
  return setLine(text, MASTER_LINE, formatMaster(m));
}

function setLine(text, re, body) {
  const lines = text.split('\n');
  const at = [];
  lines.forEach((l, i) => { if (re.test(l)) at.push(i); });
  if (at.length) {
    const [, indent, comment] = re.exec(lines[at[0]]);
    for (let k = at.length - 1; k >= 1; k--) lines.splice(at[k], 1);
    if (body) lines[at[0]] = indent + body + (comment || '');
    else lines.splice(at[0], 1);
    return { text: lines.join('\n'), line: body ? at[0] + 1 : 0 };
  }
  if (!body) return { text, line: 0 };
  let after = -1;
  for (const re of AFTER) {
    lines.forEach((l, i) => { if (re.test(l)) after = i; });
    if (after >= 0) break;
  }
  lines.splice(after + 1, 0, body);
  return { text: lines.join('\n'), line: after + 2 };
}

/** The score with its `eq mix` and `master` lines taken out, to tell a mastering edit from other edits. */
export function withoutMasteringLines(text) {
  return text.split('\n').filter(l => !MIX_LINE.test(l) && !MASTER_LINE.test(l)).join('\n');
}

export const MASTER_LIMITS = { gain: [-24, 24], highpass: [20, 1000], resonance: [0.5, 6], compThreshold: [-60, 0], ratio: [1, 20], limitThreshold: [-24, 0] };
export const SLOPES = [12, 24, 36, 48];
const r1 = x => Math.round(x * 10) / 10;

/** Master settings rounded and clamped to what the score format takes. */
export function roundMaster(m) {
  const L = MASTER_LIMITS, c = (x, [a, b]) => Math.max(a, Math.min(b, +x || 0));
  const d = Object.assign(masterDefaults(), m || {});
  return {
    gain: r1(c(d.gain, L.gain)),
    highpass: d.highpass ? {
      f: Math.round(c(d.highpass.f, L.highpass)),
      slope: SLOPES.reduce((a, b) => (Math.abs(b - d.highpass.slope) < Math.abs(a - d.highpass.slope) ? b : a)),
      q: Math.abs(d.highpass.q - 0.707) < 0.005 ? 0.707 : Math.round(c(d.highpass.q, L.resonance) * 100) / 100
    } : null,
    comp: d.comp ? { threshold: r1(c(d.comp.threshold, L.compThreshold)), ratio: r1(c(d.comp.ratio, L.ratio)) } : null,
    limit: d.limit ? { threshold: r1(c(d.limit.threshold, L.limitThreshold)) } : null
  };
}

/** master gain=-3 comp=-18,4 limit=off — only the settings that differ from the default, or null. */
export function formatMaster(m) {
  const r = roundMaster(m), d = masterDefaults(), out = [];
  const sg = x => (x > 0 ? '+' : '') + x;
  if (r.gain !== d.gain) out.push(`gain=${sg(r.gain)}`);
  const hp = r.highpass, dh = d.highpass;
  if (!hp) out.push('highpass=off');
  else if (hp.f !== dh.f || hp.slope !== dh.slope || hp.q !== dh.q) {
    // write the slope and Q only as far as they differ from the default
    out.push(`highpass=${hp.f}` + (hp.slope !== dh.slope || hp.q !== dh.q ? `,${hp.slope}` : '') + (hp.q !== dh.q ? `,${hp.q}` : ''));
  }
  if (!r.comp) out.push('comp=off');
  else if (r.comp.threshold !== d.comp.threshold || r.comp.ratio !== d.comp.ratio) out.push(`comp=${r.comp.threshold},${r.comp.ratio}`);
  if (!r.limit) out.push('limit=off');
  else if (r.limit.threshold !== d.limit.threshold) out.push(`limit=${r.limit.threshold}`);
  return out.length ? 'master ' + out.join(' ') : null;
}
