// The master chain's settings as controls: the level into the chain, the high pass filter
// (cutoff, slope and resonance), the compressor and the limiter. Sliders change the sound as they
// move; letting go of one (or switching a stage on or off) writes the score's `master` line.
// Double-click a slider to put it back to its default. A stage that is switched off keeps its
// settings for when it comes back.
//
//   const dyn = createDynamics(root, { onChange(master, commit) {} });
//   dyn.set(song.master);   // after every compile
//   dyn.value               // { gain, highpass, comp, limit }, null for a stage that is off

import { masterDefaults } from '../src/score.js';
import { roundMaster } from './mastertext.js';

const minus = s => String(s).replace('-', '−');
const sg = x => (x > 0 ? '+' : '') + x;

export function createDynamics(root, { onChange }) {
  const $ = id => root.querySelector('#' + id);
  const D = masterDefaults();
  // a slider's position <-> its value; ratio and frequency move on a log scale
  const log = (lo, hi) => ({ to: v => Math.log(v / lo) / Math.log(hi / lo) * 1000, from: p => lo * Math.pow(hi / lo, p / 1000) });
  const lin = { to: v => v, from: p => p };
  const ctl = {
    gain: { el: $('mGain'), out: $('mGainOut'), map: lin, def: D.gain, fmt: v => `${minus(sg(v.toFixed(1)))} dB` },
    hpF: { el: $('mHpF'), out: $('mHpFOut'), on: $('mHpOn'), map: log(20, 1000), def: D.highpass.f, fmt: v => `${Math.round(v)} Hz` },
    hpQ: { el: $('mHpQ'), out: $('mHpQOut'), on: $('mHpOn'), map: log(0.5, 6), def: D.highpass.q,
      fmt: v => (Math.abs(v - 0.707) < 0.005 ? 'none' : `Q ${v.toFixed(2)}`) },
    compT: { el: $('mCompT'), out: $('mCompTOut'), on: $('mCompOn'), map: lin, def: D.comp.threshold, fmt: v => `${minus(v.toFixed(1))} dB` },
    ratio: { el: $('mRatio'), out: $('mRatioOut'), on: $('mCompOn'), map: log(1, 20), def: D.comp.ratio, fmt: v => `${(Math.round(v * 10) / 10).toFixed(1)}:1` },
    limitT: { el: $('mLimT'), out: $('mLimTOut'), on: $('mLimOn'), map: lin, def: D.limit.threshold, fmt: v => `${minus(v.toFixed(1))} dB` }
  };
  const val = k => ctl[k].map.from(+ctl[k].el.value);
  const put = (k, v) => { ctl[k].el.value = String(ctl[k].map.to(v)); };
  const slopes = [...root.querySelectorAll('input[name=mSlope]')];
  const slope = () => +(slopes.find(r => r.checked) || { value: D.highpass.slope }).value;
  const putSlope = v => { for (const r of slopes) r.checked = +r.value === v; };
  // the resonance slider snaps to "none" near it, so flat is easy to find again
  ctl.hpQ.el.addEventListener('input', () => { if (Math.abs(+ctl.hpQ.el.value - ctl.hpQ.map.to(0.707)) < 12) put('hpQ', 0.707); }, true);

  function read() {
    return roundMaster({
      gain: val('gain'),
      highpass: ctl.hpF.on.checked ? { f: val('hpF'), slope: slope(), q: val('hpQ') } : null,
      comp: ctl.compT.on.checked ? { threshold: val('compT'), ratio: val('ratio') } : null,
      limit: ctl.limitT.on.checked ? { threshold: val('limitT') } : null
    });
  }
  function show() {
    for (const k in ctl) {
      const c = ctl[k];
      c.out.textContent = c.fmt(val(k));
      const off = c.on && !c.on.checked;
      c.el.disabled = off;
      c.el.closest('.ctl').classList.toggle('off', off);
    }
    for (const r of slopes) r.disabled = !ctl.hpF.on.checked;
    slopes[0].closest('.ctl').classList.toggle('off', !ctl.hpF.on.checked);
    $('mSlopeOut').textContent = `${slope()} dB/oct`;
    for (const s of root.querySelectorAll('.stage[data-switch]')) s.classList.toggle('off', !$(s.dataset.switch).checked);
  }
  const emit = commit => { show(); onChange(read(), commit); };

  for (const k in ctl) {
    const c = ctl[k];
    c.el.addEventListener('input', () => emit(false));
    c.el.addEventListener('change', () => emit(true));
    c.el.addEventListener('dblclick', () => { put(k, c.def); emit(true); });
    c.el.title = 'Double-click for the default';
  }
  for (const on of new Set([ctl.hpF.on, ctl.compT.on, ctl.limitT.on])) on.addEventListener('change', () => emit(true));
  for (const r of slopes) r.addEventListener('change', () => emit(true));

  return {
    get value() { return read(); },
    /** Show the score's settings. A stage that is off keeps the slider where it was. */
    set(m) {
      const r = roundMaster(m);
      put('gain', r.gain);
      ctl.hpF.on.checked = !!r.highpass;
      if (r.highpass) { put('hpF', r.highpass.f); put('hpQ', r.highpass.q); putSlope(r.highpass.slope); }
      else if (!slopes.some(x => x.checked)) { put('hpF', D.highpass.f); put('hpQ', D.highpass.q); putSlope(D.highpass.slope); }
      ctl.compT.on.checked = !!r.comp; if (r.comp) { put('compT', r.comp.threshold); put('ratio', r.comp.ratio); }
      ctl.limitT.on.checked = !!r.limit; if (r.limit) put('limitT', r.limit.threshold);
      show();
    },
    reset() { this.set(masterDefaults()); emit(true); },
    focus(stage) { const c = { gain: ctl.gain, highpass: ctl.hpF.on, comp: ctl.compT.on, limit: ctl.limitT.on }[stage]; if (c) (c.el || c).focus(); }
  };
}
