// The master panel: a live spectrum of the mastered output with the score's mix eq drawn over it,
// meters (loudness, peaks, and how hard the compressor and limiter work), and the mix eq bands,
// which can be dragged on the scope or typed in. The editor writes the bands back to the score.
//
//   const m = createMaster(elements, { onChange(bands, commit) {}, onBypass(on) {} });
//   m.setBands(song.mixEq);     // after every compile
//   m.attach(synth, ctx);       // once the player has a synth
//   m.frame(playing);           // every animation frame

import { BAND_TYPES, HAS_GAIN, HAS_Q, DEFAULT_Q, LIMITS, roundBand, formatBand, formatFreq } from './mastertext.js';
import { biquadQ, highpassStages } from '../src/synth.js';

const FMIN = 20, FMAX = 20000, LMIN = Math.log10(FMIN), LSPAN = Math.log10(FMAX) - LMIN;
const EQ_DB = 18;                  // the scope shows the eq from -18 to +18 dB
const SPEC_LO = -96, SPEC_HI = -18; // and the spectrum (after its tilt) in this range of dBFS
const TILT = 3;                    // dB per octave around 1 kHz, so a balanced mix reads level
const AVG_SECONDS = 3;
const SMOOTH_OCT = 1 / 6;          // the average line is smoothed over a sixth of an octave, the now fill over a 24th
const METER_LO = -48;              // the level meters show -48 to 0 dB
const GR_MAX = 12;                 // and gain reduction 0 to 12 dB
const EQ_TYPE = { highpass: 'highpass', lowpass: 'lowpass', lowshelf: 'lowshelf', highshelf: 'highshelf', peak: 'peaking', notch: 'notch' };
const TYPE_NAME = { peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf', highpass: 'High-pass', lowpass: 'Low-pass', notch: 'Notch' };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const fx = f => (Math.log10(f) - LMIN) / LSPAN;           // frequency -> 0..1 across
const xf = x => Math.pow(10, LMIN + x * LSPAN);             // and back
const db = x => 20 * Math.log10(Math.max(1e-9, x));
const noteOf = f => { const m = Math.round(69 + 12 * Math.log2(f / 440)); return NOTE[(m % 12 + 12) % 12] + (Math.floor(m / 12) - 1); };
const hz = f => f >= 1000 ? formatFreq(f).replace('k', ' kHz') : Math.round(f) + ' Hz';
const snapF = f => { const t = formatFreq(f); return t.endsWith('k') ? parseFloat(t) * 1000 : +t; };
const dbText = (v, digits = 1) => { const t = Math.abs(v).toFixed(digits); return (+t === 0 ? '' : v > 0 ? '+' : '−') + t; };

export function createMaster(els, { onChange, onBypass }) {
  const { canvas, list, add, bypass, line, meters, note } = els;
  const g = canvas.getContext('2d');
  let bands = [], selected = -1, hoverX = null, drag = null;
  let W = 0, H = 0, dpr = 1, n = 0, freqs = null, bins = null;
  let bandCurves = [], sumCurve = null, hpCurve = null, highpass = null, probe = null, probeRate = 48000;
  let au = null; // the analysers, once attached
  let spec = null, avg = null, lastT = 0, lastText = 0, colors = null, visible = true, dirty = true;
  let bypassed = false;

  /* ------------------------------------------------------------ layout */

  const PAD = { l: 6, r: 34, t: 8, b: 18 };
  const plotW = () => W - PAD.l - PAD.r, plotH = () => H - PAD.t - PAD.b;
  const X = x01 => PAD.l + x01 * plotW();
  const eqY = d => PAD.t + plotH() / 2 - d / EQ_DB * (plotH() / 2);
  const specY = d => PAD.t + (1 - (d - SPEC_LO) / (SPEC_HI - SPEC_LO)) * plotH();

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = Math.max(200, Math.round(r.width)); H = Math.max(120, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    n = Math.max(64, Math.floor(plotW() / 2) + 1); // a point every two pixels
    freqs = new Float32Array(n);
    for (let i = 0; i < n; i++) freqs[i] = xf(i / (n - 1));
    spec = new Float32Array(n).fill(-200); avg = new Float32Array(n).fill(0);
    bins = null; computeCurves(); dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(canvas);
  const readColors = () => {
    const cs = getComputedStyle(canvas);
    const v = k => cs.getPropertyValue(k).trim();
    colors = { ink: v('--ink'), muted: v('--muted'), line: v('--line'), accent: v('--accent'), eq: v('--eq'), panel: v('--panel'), err: v('--err') };
    dirty = true;
  };
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(readColors, 0));

  /* ------------------------------------------------------------ eq curves */

  // Real BiquadFilterNodes give the curve, set up the way the synth sets its own, so the drawing
  // matches what plays exactly. The master's high pass filter is drawn with the eq.
  function computeCurves() {
    if (!freqs) return;
    if (!probe || probe.sampleRate !== probeRate) {
      try { probe = new OfflineAudioContext(1, 128, probeRate); } catch { probe = null; }
    }
    const mag = new Float32Array(n), ph = new Float32Array(n);
    const response = (type, f0, q, gain) => {
      const c = new Float32Array(n);
      if (!probe) return c;
      const f = probe.createBiquadFilter();
      f.type = type; f.frequency.value = f0; f.Q.value = biquadQ(type, q); f.gain.value = gain || 0;
      f.getFrequencyResponse(freqs, mag, ph);
      for (let i = 0; i < n; i++) c[i] = isFinite(mag[i]) ? db(mag[i]) : 0;
      return c;
    };
    hpCurve = new Float32Array(n);
    for (const st of highpassStages(highpass)) { const c = response('highpass', st.f, st.q); for (let i = 0; i < n; i++) hpCurve[i] += c[i]; }
    sumCurve = new Float32Array(n);
    bandCurves = bands.map(b => { const c = response(EQ_TYPE[b.type], b.f, b.q, b.gain); for (let i = 0; i < n; i++) sumCurve[i] += c[i]; return c; });
    dirty = true;
  }

  // Where a band's handle sits: at its gain, or on the curve for filters without one.
  function handle(i) {
    const b = bands[i];
    const x = X(fx(b.f));
    let d = HAS_GAIN[b.type] ? b.gain : 0;
    if (b.type === 'lowshelf' || b.type === 'highshelf') d = b.gain / 2; // shelves turn over halfway, at f
    return { x, y: eqY(Math.max(-EQ_DB, Math.min(EQ_DB, d))) };
  }

  /* ------------------------------------------------------------ the band list */

  const showLine = () => { line.textContent = bands.length ? 'eq mix ' + bands.map(formatBand).join(' ') : 'No mix eq: the master is neutral.'; };
  function changed(commit) {
    computeCurves();
    syncInputs(commit);
    onChange(bands.map(b => Object.assign({}, b)), commit);
    showLine();
  }

  function renderList() {
    list.innerHTML = '';
    if (!bands.length) {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = 'No bands. Add one, or double-click the scope where you want it.';
      list.append(p);
    }
    bands.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'band' + (i === selected ? ' sel' : '');
      row.dataset.i = i;
      const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1;
      const type = document.createElement('select');
      type.setAttribute('aria-label', `Band ${i + 1} type`);
      for (const t of BAND_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = TYPE_NAME[t]; type.append(o); }
      type.value = b.type;
      type.onchange = () => {
        bands[i] = roundBand({ type: type.value, f: bands[i].f, gain: bands[i].gain, q: DEFAULT_Q[type.value] });
        renderList(); changed(true);
      };
      const field = (key, label, unit, step, enabled) => {
        const wrap = document.createElement('label'); wrap.className = 'fld' + (enabled ? '' : ' off');
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = step; inp.dataset.key = key; inp.inputMode = 'decimal';
        inp.min = LIMITS[key][0]; inp.max = LIMITS[key][1];
        inp.setAttribute('aria-label', `Band ${i + 1} ${label}`);
        inp.disabled = !enabled;
        const u = document.createElement('small'); u.textContent = unit;
        const set = commit => {
          const v = parseFloat(inp.value);
          if (!isFinite(v)) return;
          const nb = Object.assign({}, bands[i], { [key]: v });
          if (commit) bands[i] = roundBand(nb);
          else bands[i] = Object.assign(nb, { [key]: Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], v)) });
          changed(commit);
        };
        inp.oninput = () => set(false);
        inp.onchange = () => set(true);
        wrap.append(inp, u);
        return wrap;
      };
      const rm = document.createElement('button');
      rm.className = 'remove'; rm.type = 'button'; rm.textContent = '×';
      rm.setAttribute('aria-label', `Remove band ${i + 1}`); rm.title = 'Remove this band';
      rm.onclick = () => { bands.splice(i, 1); selected = -1; renderList(); changed(true); };
      row.append(num, type, field('f', 'frequency in Hz', 'Hz', 'any', true),
        field('gain', 'gain in dB', 'dB', 0.5, !!HAS_GAIN[b.type]), field('q', 'Q', 'Q', 0.05, !!HAS_Q[b.type]), rm);
      row.addEventListener('focusin', () => select(i));
      list.append(row);
    });
    syncInputs();
  }

  // put the band values in the inputs, except the one being typed in (until it is committed)
  function syncInputs(all) {
    for (const row of list.querySelectorAll('.band')) {
      const b = bands[+row.dataset.i]; if (!b) continue;
      for (const inp of row.querySelectorAll('input')) {
        if (inp === document.activeElement && !all) continue;
        const k = inp.dataset.key;
        if (k === 'gain' && !HAS_GAIN[b.type]) { inp.value = ''; inp.placeholder = '—'; continue; }
        if (k === 'q' && !HAS_Q[b.type]) { inp.value = ''; inp.placeholder = '—'; continue; }
        inp.value = k === 'f' ? Math.round(b.f) : k === 'gain' ? Math.round(b.gain * 10) / 10 : Math.round(b.q * 100) / 100;
      }
    }
  }

  function select(i) {
    if (selected === i) return;
    selected = i; dirty = true;
    for (const row of list.querySelectorAll('.band')) row.classList.toggle('sel', +row.dataset.i === i);
  }

  function addBand(f = 1000, gain = 0) {
    if (bands.length >= 8) return;
    bands.push(roundBand({ type: 'peak', f, gain, q: 1 }));
    selected = bands.length - 1;
    renderList(); changed(true);
    const row = list.querySelector(`.band[data-i="${selected}"] input`);
    if (row) row.focus();
  }
  add.onclick = () => {
    // a free spot: the largest gap between the bands already there
    const xs = [0, ...bands.map(b => fx(b.f)).sort((a, b) => a - b), 1];
    let best = 0.5, gap = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > gap) { gap = xs[i] - xs[i - 1]; best = (xs[i] + xs[i - 1]) / 2; }
    addBand(xf(best), 0);
  };
  bypass.onclick = () => {
    bypassed = !bypassed;
    bypass.setAttribute('aria-pressed', String(bypassed));
    bypass.classList.toggle('on', bypassed);
    canvas.classList.toggle('bypassed', bypassed);
    onBypass(bypassed); dirty = true;
  };

  /* ------------------------------------------------------------ dragging on the scope */

  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(p) {
    let best = -1, bd = 18;
    bands.forEach((b, i) => { const h = handle(i); const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // on a touch screen the page still scrolls over the scope, unless the touch starts on a handle
  canvas.addEventListener('touchstart', e => { if (e.touches.length === 1 && hit(local(e.touches[0])) >= 0) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('pointerdown', e => {
    const p = local(e), i = hit(p);
    if (i < 0) return;
    select(i);
    const h = handle(i);
    drag = { i, dx: p.x - h.x, dy: p.y - h.y, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    hoverX = p.x >= PAD.l && p.x <= W - PAD.r ? p.x : null;
    dirty = true;
    if (!drag) { canvas.style.cursor = hit(p) >= 0 ? 'grab' : 'crosshair'; return; }
    canvas.style.cursor = 'grabbing';
    const b = bands[drag.i];
    const x01 = Math.max(0, Math.min(1, (p.x - drag.dx - PAD.l) / plotW()));
    const nb = Object.assign({}, b, { f: Math.max(LIMITS.f[0], Math.min(LIMITS.f[1], xf(x01))) });
    if (HAS_GAIN[b.type]) {
      let d = (PAD.t + plotH() / 2 - (p.y - drag.dy)) / (plotH() / 2) * EQ_DB;
      if (b.type === 'lowshelf' || b.type === 'highshelf') d *= 2;
      nb.gain = Math.round(Math.max(-EQ_DB, Math.min(EQ_DB, d)) * 2) / 2; // half-dB steps
    }
    nb.f = snapF(nb.f);
    bands[drag.i] = nb;
    changed(false);
  });
  const endDrag = () => { if (!drag) return; bands[drag.i] = roundBand(bands[drag.i]); drag = null; canvas.style.cursor = 'grab'; changed(true); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hoverX = null; dirty = true; } });
  canvas.addEventListener('dblclick', e => {
    const p = local(e);
    if (hit(p) >= 0 || p.x < PAD.l || p.x > W - PAD.r) return;
    const d = (PAD.t + plotH() / 2 - p.y) / (plotH() / 2) * EQ_DB;
    addBand(xf((p.x - PAD.l) / plotW()), Math.round(Math.max(-EQ_DB, Math.min(EQ_DB, d)) * 2) / 2);
  });

  /* ------------------------------------------------------------ analysers */

  function attach(syn, ctx) {
    if (au) return;
    const src = syn.limiter; // the mastered signal, before the editor's volume
    const split = ctx.createChannelSplitter(2);
    src.connect(split);
    const spectrum = ctx.createAnalyser();
    spectrum.fftSize = 8192; spectrum.smoothingTimeConstant = 0.55;
    src.connect(spectrum);
    const chan = ch => {
      const a = ctx.createAnalyser(); a.fftSize = 2048; split.connect(a, ch);
      // K-weighting for loudness (ITU-R BS.1770): a high shelf, then a high-pass. Web Audio reads a
      // high-pass Q in dB; -6 dB is a Q of 0.5.
      const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = -6;
      const k = ctx.createAnalyser(); k.fftSize = 16384; // about 0.35 s: near the 0.4 s momentary window
      split.connect(shelf, ch); shelf.connect(hp).connect(k);
      return { a, k, td: new Float32Array(a.fftSize), kd: new Float32Array(k.fftSize), peak: -Infinity, hold: -Infinity, holdT: 0 };
    };
    au = { syn, ctx, spectrum, fd: new Float32Array(spectrum.frequencyBinCount), ch: [chan(0), chan(1)], st: [] };
    probeRate = ctx.sampleRate; computeCurves();
    if (bypassed) onBypass(true);
    note.textContent = 'Spectrum of the master output, tilted 3 dB per octave so a balanced mix reads level.';
  }

  // which analyser bins each scope point averages, or the fractional bin to read between
  function mapBins() {
    const binHz = au.ctx.sampleRate / au.spectrum.fftSize, nb = au.spectrum.frequencyBinCount;
    bins = [];
    for (let i = 0; i < n; i++) {
      const lo = xf(Math.max(0, (i - 0.5) / (n - 1))) / binHz, hi = xf(Math.min(1, (i + 0.5) / (n - 1))) / binHz;
      const a = Math.ceil(lo), b = Math.min(nb - 1, Math.floor(hi));
      bins.push(b >= a ? [a, b] : [freqs[i] / binHz]);
    }
  }

  function readSpectrum(dt) {
    if (!bins) mapBins();
    au.spectrum.getFloatFrequencyData(au.fd);
    const fd = au.fd, k = 1 - Math.exp(-dt / AVG_SECONDS);
    for (let i = 0; i < n; i++) {
      const m = bins[i];
      let p;
      if (m.length === 2) { p = 0; for (let j = m[0]; j <= m[1]; j++) p += Math.pow(10, fd[j] / 10); p /= (m[1] - m[0] + 1); }
      else { const j = Math.floor(m[0]), t = m[0] - j; p = Math.pow(10, ((fd[j] || -200) * (1 - t) + (fd[j + 1] || -200) * t) / 10); }
      p *= Math.pow(10, TILT * Math.log2(freqs[i] / 1000) / 10);
      spec[i] = 10 * Math.log10(Math.max(1e-20, p));
      avg[i] += (p - avg[i]) * k;
    }
  }

  function readMeters(now, dt, showText) {
    let ms = 0;
    for (const c of au.ch) {
      c.a.getFloatTimeDomainData(c.td);
      let pk = 0, sq = 0;
      for (const v of c.td) { const a = Math.abs(v); if (a > pk) pk = a; sq += v * v; }
      c.peak = db(pk); c.rms = db(Math.sqrt(sq / c.td.length));
      // the peak readout holds for 1.5 s, then falls 20 dB a second
      if (c.peak >= c.hold) { c.hold = c.peak; c.holdT = now; }
      else if (now - c.holdT > 1.5) c.hold = Math.max(c.peak, c.hold - 20 * dt);
      c.k.getFloatTimeDomainData(c.kd);
      let s = 0; for (const v of c.kd) s += v * v;
      ms += s / c.kd.length;
    }
    const momentary = -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
    au.st.push([now, ms]);
    while (au.st.length && now - au.st[0][0] > 3) au.st.shift();
    const short = -0.691 + 10 * Math.log10(Math.max(1e-12, au.st.reduce((a, x) => a + x[1], 0) / au.st.length));
    const red = node => { const r = node.reduction; return typeof r === 'number' ? r : (r && r.value) || 0; };
    const gr = { comp: red(au.syn.comp), lim: red(au.syn.limiter) };

    const bar = (m, v, lo, hi) => { m.style.setProperty('--fill', Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100 + '%'); };
    bar(meters.loud.bar, short, METER_LO, 0);
    meters.loud.bar.style.setProperty('--mark', Math.max(0, Math.min(1, (momentary - METER_LO) / -METER_LO)) * 100 + '%');
    au.ch.forEach((c, i) => {
      const m = meters.peak[i];
      bar(m.bar, c.rms, METER_LO, 0);
      m.bar.style.setProperty('--mark', Math.max(0, Math.min(1, (c.hold - METER_LO) / -METER_LO)) * 100 + '%');
      m.bar.classList.toggle('hot', c.hold > -1);
    });
    bar(meters.comp.bar, -gr.comp, 0, GR_MAX);
    bar(meters.lim.bar, -gr.lim, 0, GR_MAX);
    if (!showText) return;
    const quiet = short < -70;
    meters.loud.out.innerHTML = quiet ? '—' : `${dbText(short)} <small>LUFS</small>`;
    meters.loud.sub.textContent = quiet ? 'short-term, 3 s' : `momentary ${dbText(momentary)}`;
    au.ch.forEach((c, i) => { meters.peak[i].out.innerHTML = c.hold < -90 ? '—' : `${dbText(c.hold)} <small>dB</small>`; });
    meters.comp.out.innerHTML = `${dbText(gr.comp)} <small>dB</small>`;
    meters.lim.out.innerHTML = `${dbText(gr.lim)} <small>dB</small>`;
  }

  /* ------------------------------------------------------------ drawing */

  // a moving average k points either side
  function smooth(a, k) {
    if (k < 1) return a;
    const out = new Float32Array(a.length);
    let sum = 0, cnt = 0;
    for (let i = 0; i < Math.min(k, a.length); i++) { sum += a[i]; cnt++; }
    for (let i = 0; i < a.length; i++) {
      if (i + k < a.length) { sum += a[i + k]; cnt++; }
      if (i - k - 1 >= 0) { sum -= a[i - k - 1]; cnt--; }
      out[i] = sum / cnt;
    }
    return out;
  }

  function draw() {
    const c = colors;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';

    // grid: octaves-ish frequency lines and eq gain lines
    g.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(X(fx(f))) + 0.5;
      g.strokeStyle = c.line; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, H - PAD.b); g.stroke();
      g.globalAlpha = 1; g.fillStyle = c.muted; g.textAlign = 'center';
      g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x, H - PAD.b / 2);
    }
    g.textAlign = 'left';
    for (const d of [-12, -6, 0, 6, 12]) {
      const y = Math.round(eqY(d)) + 0.5;
      g.strokeStyle = c.line; g.globalAlpha = d === 0 ? 1 : 0.5;
      g.setLineDash(d === 0 ? [] : [2, 3]);
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(W - PAD.r, y); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = c.muted;
      g.fillText((d > 0 ? '+' : '') + d, W - PAD.r + 5, y);
    }

    // the spectrum: what is playing now (filled) and the last few seconds on average (a line),
    // both smoothed across frequency (in power) so the shape reads rather than every harmonic
    if (au && spec) {
      const xs = i => X(i / (n - 1)), perOct = (n - 1) / (LSPAN * Math.log2(10));
      const now = smooth(spec.map(d => Math.pow(10, d / 10)), Math.round(perOct * SMOOTH_OCT / 8));
      const av = smooth(avg, Math.round(perOct * SMOOTH_OCT / 2));
      const y = p => Math.max(PAD.t, Math.min(H - PAD.b, specY(10 * Math.log10(Math.max(1e-20, p)))));
      g.beginPath(); g.moveTo(xs(0), H - PAD.b);
      for (let i = 0; i < n; i++) g.lineTo(xs(i), y(now[i]));
      g.lineTo(xs(n - 1), H - PAD.b); g.closePath();
      g.fillStyle = c.accent; g.globalAlpha = 0.2; g.fill(); g.globalAlpha = 1;
      g.beginPath();
      for (let i = 0; i < n; i++) { if (i) g.lineTo(xs(i), y(av[i])); else g.moveTo(xs(i), y(av[i])); }
      g.strokeStyle = c.accent; g.lineWidth = 1.5; g.stroke();
    }

    // the eq: the selected band's own shape, then the whole curve and the handles
    const eqAlpha = bypassed ? 0.35 : 1;
    if (selected >= 0 && bandCurves[selected]) {
      g.beginPath(); g.moveTo(X(0), eqY(0));
      for (let i = 0; i < n; i++) g.lineTo(X(i / (n - 1)), eqY(Math.max(-EQ_DB - 2, Math.min(EQ_DB + 2, bandCurves[selected][i]))));
      g.lineTo(X(1), eqY(0)); g.closePath();
      g.fillStyle = c.eq; g.globalAlpha = 0.14 * eqAlpha; g.fill(); g.globalAlpha = 1;
    }
    if (sumCurve && hpCurve) {
      // what plays: the high pass filter and, unless it is bypassed, the eq; bypassed, the eq's
      // part shows dashed
      const curve = (withEq, alpha, dash) => {
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const y = eqY(Math.max(-EQ_DB - 2, Math.min(EQ_DB + 2, hpCurve[i] + (withEq ? sumCurve[i] : 0))));
          if (i) g.lineTo(X(i / (n - 1)), y); else g.moveTo(X(0), y);
        }
        g.strokeStyle = c.eq; g.lineWidth = 2; g.globalAlpha = alpha; g.setLineDash(dash);
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      };
      g.save(); g.beginPath(); g.rect(PAD.l, PAD.t - 2, plotW(), plotH() + 4); g.clip();
      if (bypassed && bands.length) curve(true, 0.35, [5, 4]);
      curve(!bypassed, 1, []);
      g.restore();
    }
    g.textAlign = 'center';
    g.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    bands.forEach((b, i) => {
      const h = handle(i), on = i === selected;
      g.beginPath(); g.arc(h.x, h.y, on ? 9 : 8, 0, Math.PI * 2);
      g.fillStyle = on ? c.eq : c.panel; g.fill();
      g.strokeStyle = c.eq; g.lineWidth = 2; g.stroke();
      g.fillStyle = on ? c.panel : c.ink;
      g.fillText(String(i + 1), h.x, h.y + 0.5);
    });

    // what frequency, and which note, is under the pointer
    if (hoverX != null) {
      const f = xf((hoverX - PAD.l) / plotW());
      g.strokeStyle = c.muted; g.globalAlpha = 0.6; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(hoverX) + 0.5, PAD.t); g.lineTo(Math.round(hoverX) + 0.5, H - PAD.b); g.stroke();
      g.globalAlpha = 1;
      const label = `${hz(f)} · ${noteOf(f)}`;
      g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      const w = g.measureText(label).width + 10;
      const lx = Math.max(PAD.l, Math.min(W - PAD.r - w, hoverX + 6));
      g.fillStyle = c.panel; g.globalAlpha = 0.9; g.fillRect(lx, PAD.t, w, 16); g.globalAlpha = 1;
      g.fillStyle = c.ink; g.textAlign = 'left'; g.fillText(label, lx + 5, PAD.t + 8);
    }
  }

  return {
    get attached() { return !!au; },
    /** The master's high pass filter ({ f, slope, q } or null), to draw with the eq. */
    setHighpass(hp) {
      if (JSON.stringify(hp) === JSON.stringify(highpass)) return;
      highpass = hp ? Object.assign({}, hp) : null;
      computeCurves();
    },
    attach,
    setBands(next) {
      const nb = (next || []).map(roundBand);
      if (JSON.stringify(nb) === JSON.stringify(bands) && list.children.length) return;
      bands = nb;
      if (selected >= bands.length) selected = -1;
      renderList(); computeCurves(); showLine();
    },
    /** mode: 'playing', 'paused' (the picture holds still) or 'stopped' (it fades away) */
    frame(mode) {
      const now = performance.now() / 1000, dt = Math.min(0.2, now - (lastT || now));
      lastT = now;
      if (au && mode === 'playing') {
        if (visible) readSpectrum(dt || 1 / 60);
        const showText = now - lastText > 0.12;
        if (showText) lastText = now;
        readMeters(now, dt, showText);
        dirty = true;
      } else if (au && mode === 'stopped' && avg && avg.some(v => v > 1e-12)) {
        // stopped or paused: let the picture fade instead of freezing
        for (let i = 0; i < n; i++) { spec[i] -= 60 * dt; avg[i] *= Math.exp(-dt * 2); }
        if (now - lastText > 0.12) { lastText = now; readMeters(now, dt, true); }
        dirty = true;
      }
      if (visible && dirty) { draw(); dirty = false; }
    }
  };
}
