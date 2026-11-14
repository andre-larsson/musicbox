// The timeline strip: a cue's intro and loop as blocks, one per pattern, with bar lines, a
// playhead, and click, drag and arrow keys to move through the music. Positions snap to bars.
//
//   const tl = createTimeline(el, { onSeek(part, time) {} });
//   tl.update({ parts: [{ kind: 'intro'|'loop', sections, dur, choices? }], then, pos, label })
//
// `pos` is seconds from the start of the strip (null hides the playhead). `choices[i]` lists the
// patterns a randomly picked section was picked from.

const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
};
export const formatTime = fmt;

const secLabel = s => s.name + (s.trans ? (s.trans > 0 ? '+' : '') + s.trans : '');

export function createTimeline(el, { onSeek }) {
  el.innerHTML = `<div class="tl-parts"></div><div class="tl-secs"></div>
    <div class="tl-ghost" hidden></div><div class="tl-head" hidden></div><div class="tl-tip" hidden></div>`;
  const partsEl = el.querySelector('.tl-parts'), secsEl = el.querySelector('.tl-secs');
  const ghost = el.querySelector('.tl-ghost'), head = el.querySelector('.tl-head'), tip = el.querySelector('.tl-tip');
  let view = { parts: [], pos: null }, flat = [], total = 0, sig = '', dragging = false;

  // every section with its part, its start on the strip and its index within its part
  function layout(v) {
    flat = []; total = 0;
    for (const p of v.parts) {
      p.sections.forEach((s, i) => flat.push({ part: p.kind, s, i, at: total + s.start, choices: p.choices && p.choices[i] }));
      total += p.dur;
    }
  }

  function render(v) {
    partsEl.innerHTML = ''; secsEl.innerHTML = '';
    if (!total) { el.classList.add('empty'); return; }
    el.classList.remove('empty');
    let off = 0;
    for (const p of v.parts) {
      const lab = document.createElement('span');
      lab.className = 'tl-part ' + p.kind;
      lab.style.left = (off / total * 100) + '%';
      lab.style.maxWidth = (p.dur / total * 100) + '%';
      lab.textContent = p.kind === 'loop' ? 'Loop ↻' : 'Intro';
      lab.title = p.kind === 'loop' ? 'The loop: it repeats until the cue changes' : 'The intro: it plays once';
      partsEl.append(lab);
      off += p.dur;
    }
    if (v.then) {
      const lab = document.createElement('span');
      lab.className = 'tl-part then';
      lab.textContent = `then ${v.then} →`;
      partsEl.append(lab);
    }
    for (const f of flat) {
      const d = document.createElement('div');
      d.className = `tl-sec ${f.part}` + (f.choices ? ' rnd' : '') + (f.i === 0 && f.part === 'loop' && off > 0 ? ' first' : '');
      d.style.left = (f.at / total * 100) + '%';
      d.style.width = (f.s.dur / total * 100) + '%';
      d.style.setProperty('--bars', f.s.bars);
      const name = document.createElement('span');
      name.textContent = secLabel(f.s);
      d.append(name);
      if (f.choices) { const alt = document.createElement('small'); alt.textContent = `from ${f.choices.join(', ')}`; d.append(alt); }
      d.title = `${f.part === 'loop' ? 'Loop' : 'Intro'}: pattern ${secLabel(f.s)}, ${f.s.bars} bar${f.s.bars > 1 ? 's' : ''}` +
        (f.choices ? ` (picked at random from ${f.choices.join(', ')})` : '');
      secsEl.append(d);
    }
  }

  // the bar under strip position x (seconds): its part, the time into that part, and a label
  function barAt(x) {
    if (!flat.length) return null;
    x = Math.max(0, Math.min(total - 1e-6, x));
    let f = flat[0];
    for (const g of flat) if (g.at <= x + 1e-9) f = g;
    const into = x - f.at;
    const bar = Math.min(f.s.bars - 1, Math.max(0, Math.floor(into / f.s.barDur + 1e-6)));
    return { part: f.part, time: f.s.start + bar * f.s.barDur, at: f.at + bar * f.s.barDur, label: `${secLabel(f.s)} · bar ${bar + 1}`, f };
  }

  // one bar or one pattern either way from the playhead. Forward from the end of a loop goes
  // round to its start, as the music does.
  function step(dir, unit) {
    if (!flat.length) return;
    const pos = view.pos != null ? view.pos : 0;
    const cur = barAt(pos);
    const loop = flat.find(f => f.part === 'loop');
    let target;
    if (unit === 'pattern') {
      const k = flat.indexOf(cur.f);
      // back: to the start of this pattern, or the one before when already near its start
      if (dir < 0) target = pos - cur.f.at > Math.min(1.5, cur.f.s.dur / 2) ? cur.f.at : flat[Math.max(0, k - 1)].at;
      else target = k + 1 < flat.length ? flat[k + 1].at : loop ? loop.at : null;
    } else {
      if (dir < 0) target = pos - cur.at > Math.min(0.75, cur.f.s.barDur / 2) ? cur.at : cur.at - 1e-3;
      else target = cur.at + cur.f.s.barDur + 1e-3;
      if (target >= total) target = loop ? loop.at : null;
    }
    if (target == null) return;
    const b = barAt(Math.max(0, target));
    if (b) onSeek(b.part, b.time);
  }

  function xToTime(clientX) {
    const r = secsEl.getBoundingClientRect();
    return (clientX - r.left) / r.width * total;
  }

  function showGhost(b) {
    if (!b) { ghost.hidden = true; tip.hidden = true; return; }
    const pct = b.at / total * 100;
    ghost.hidden = false; ghost.style.left = pct + '%';
    tip.hidden = false; tip.textContent = `${b.label} · ${fmt(b.at)}`;
    tip.style.left = `clamp(0px, calc(${pct}% - ${tip.offsetWidth / 2}px), calc(100% - ${tip.offsetWidth}px))`;
  }

  el.addEventListener('pointermove', e => {
    if (!total) return;
    showGhost(barAt(xToTime(e.clientX)));
  });
  el.addEventListener('pointerleave', () => { if (!dragging) showGhost(null); });
  el.addEventListener('pointerdown', e => {
    if (!total || e.button > 0) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    showGhost(barAt(xToTime(e.clientX)));
  });
  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    const b = barAt(xToTime(e.clientX));
    if (e.pointerType !== 'mouse') showGhost(null);
    if (b) onSeek(b.part, b.time);
  });
  el.addEventListener('pointercancel', () => { dragging = false; showGhost(null); });
  el.addEventListener('keydown', e => {
    const unit = e.shiftKey ? 'pattern' : 'bar';
    if (e.key === 'ArrowLeft') step(-1, unit);
    else if (e.key === 'ArrowRight') step(1, unit);
    else if (e.key === 'PageUp') step(-1, 'pattern');
    else if (e.key === 'PageDown') step(1, 'pattern');
    else if (e.key === 'Home' && flat.length) onSeek(flat[0].part, 0);
    else if (e.key === 'End' && flat.length) { const f = flat[flat.length - 1]; onSeek(f.part, f.s.start); }
    else return;
    e.preventDefault();
  });

  return {
    step,
    get total() { return total; },
    update(v) {
      const s = v.parts.map(p => p.kind + ':' + p.sections.map(x => secLabel(x) + '/' + x.dur.toFixed(4)).join(',') +
        ':' + (p.choices || []).map(c => c ? c.join(' ') : '').join(',')).join('|') + '>' + (v.then || '');
      if (s !== sig) { sig = s; layout(v); render(v); }
      view = v;
      if (v.pos == null || !total) head.hidden = true;
      else { head.hidden = false; head.style.left = Math.min(100, v.pos / total * 100) + '%'; }
      el.style.setProperty('--progress', v.pos == null || !total ? '0%' : Math.min(100, v.pos / total * 100) + '%');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.round(total)));
      el.setAttribute('aria-valuenow', String(Math.round(v.pos || 0)));
      el.setAttribute('aria-valuetext', v.label || 'stopped');
    }
  };
}
