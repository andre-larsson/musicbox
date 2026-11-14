import { MusicPlayer } from '../src/player.js';
import { compile } from '../src/score.js';
import { analyze } from '../src/analyze.js';
import { scoreLink, scoreCode, decodeScore } from '../src/link.js';
import { createTimeline, formatTime } from './timeline.js';
import { createMaster } from './master.js';
import { createDynamics } from './dynamics.js';
import { setMixLine, setMasterLine, formatMaster, withoutMasteringLines } from './mastertext.js';

const $ = s => document.querySelector(s);
const ui = {
  file: $('#file'), play: $('#play'), playPath: $('#playPath'), playLabel: $('#playLabel'), stop: $('#stop'),
  prev: $('#prev'), next: $('#next'), cues: $('#cues'), intensity: $('#intensity'),
  intensityVal: $('#intensityVal'), volume: $('#volume'), status: $('#status'), score: $('#score'),
  problems: $('#problems'), analysis: $('#analysis'), note: $('#note'), hint: $('#hint'), share: $('#share'),
  mixer: $('#mixer'), track: $('#track'), tNow: $('#tNow'), tEnd: $('#tEnd'),
  chain: { gain: $('#cGain'), highpass: $('#cHighpass'), eq: $('#cEq'), comp: $('#cComp'), limit: $('#cLimit') },
  masterLine: $('#masterLine'), masterReset: $('#masterReset')
};

const player = new MusicPlayer({ volume: +ui.volume.value });
let song = null;         // last compiled score (may have errors)
let playable = null;     // last compiled score without errors
let appliedText = null;  // the text `playable` was compiled from
let current = null;      // path of the file being edited
let viewCue = null;      // the cue the timeline shows while stopped
let heard = {};          // "cue:part" -> sections of the last pass heard, random picks and all

const ICON = { play: 'M4 2.5v11l9.5-5.5z', pause: 'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z' };
const paused = () => !!(player.ctx && player.ctx.state === 'suspended' && player.state.playing);

function show(s) {
  ui.problems.innerHTML = '';
  const items = s.errors.map(e => ({ ...e, kind: 'error' })).concat(s.warnings.map(w => ({ ...w, kind: 'warning' })));
  if (!items.length) {
    const li = document.createElement('li'); li.className = 'ok'; li.textContent = 'No problems.'; ui.problems.append(li);
  }
  for (const p of items) {
    const li = document.createElement('li');
    li.className = p.kind;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `line ${p.line}: ${p.msg}`;
    b.onclick = () => jumpTo(p.line);
    li.append(b);
    ui.problems.append(li);
  }
  ui.analysis.textContent = s.errors.length ? '' : analyze(s).text;
}

function jumpTo(line) {
  const lines = ui.score.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
  ui.score.focus();
  ui.score.setSelectionRange(start, start + (lines[line - 1] || '').length);
  const lh = parseFloat(getComputedStyle(ui.score).lineHeight) || 18;
  ui.score.scrollTop = Math.max(0, (line - 5) * lh);
}

function renderCues() {
  ui.cues.innerHTML = '';
  const s = playable;
  if (!s) return;
  for (const name of s.cueOrder) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.cue = name;
    b.title = player.seg ? `Switch to ${name}` : `Play ${name}`;
    b.onclick = async () => {
      viewCue = name;
      await player.unlock();
      if (player.song !== playable) player.load(playable);
      if (player.seg) player.goto(name); else player.play(name, { intensity: +ui.intensity.value });
    };
    ui.cues.append(b);
  }
  // Lowering max clamps the slider's value without an input event, so read the value back after.
  // A slider at the top stays at the top, so every layer still plays in a score with more of them.
  const layers = Math.max(0, ...s.voices.map(v => v.layer || 0), ...(s.beds || []).map(b => b.layer || 0));
  const atTop = +ui.intensity.value >= +ui.intensity.max;
  ui.intensity.max = String(Math.max(1, layers));
  if (atTop || +ui.intensity.value > layers) ui.intensity.value = String(layers);
  ui.intensityVal.textContent = ui.intensity.value;
  player.setIntensity(+ui.intensity.value);
  ui.intensity.disabled = layers === 0;
  renderMixer();
}

// Mute and solo. Click a voice or bed to mute it; S plays it alone (solo several to hear them
// together). Names stay muted or soloed across edits and reloads while the page is open.
const muted = new Set(), soloed = new Set();
let usedBy = {};   // cue name -> set of voice indexes that play in it
let unmuteAll = null;

function voicesByCue(s) {
  const out = {};
  for (const [name, c] of Object.entries(s.cues)) {
    const set = new Set();
    const tls = [c.intro, c.loop, ...[].concat(...(c.introSlots || []), ...(c.loopSlots || []))];
    for (const tl of tls) if (tl) for (const e of tl.events) set.add(e.v);
    out[name] = set;
  }
  return out;
}

function applyMix() {
  if (!playable) return;
  for (const n of playable.voices.map(v => v.name).concat((playable.beds || []).map(b => b.name))) {
    const off = muted.has(n) || (soloed.size > 0 && !soloed.has(n));
    if (off !== player.muted.has(n)) player.mute(n, off);
  }
}

function renderMixer() {
  ui.mixer.innerHTML = '';
  const s = playable;
  if (!s) return;
  usedBy = voicesByCue(s);
  const add = (label, items) => {
    if (!items.length) return;
    const l = document.createElement('span'); l.className = 'label'; l.textContent = label; ui.mixer.append(l);
    for (const { name, kind, layer } of items) {
      const chip = document.createElement('span');
      chip.className = 'chip'; chip.dataset.name = name; chip.dataset.layer = layer || 0;
      const m = document.createElement('button'); m.className = 'name';
      m.textContent = name;
      if (kind && kind !== name) { const k = document.createElement('small'); k.textContent = kind; m.append(k); }
      m.onclick = () => { if (muted.has(name)) muted.delete(name); else muted.add(name); applyMix(); };
      const so = document.createElement('button'); so.className = 'solo'; so.textContent = 'S';
      so.title = `Solo ${name}: hear it alone (solo others to add them)`;
      so.onclick = () => { if (soloed.has(name)) soloed.delete(name); else soloed.add(name); applyMix(); };
      chip.append(m, so);
      ui.mixer.append(chip);
    }
  };
  add('Voices', s.voices.map(v => ({ name: v.name, kind: v.inst, layer: v.layer })));
  add('Beds', (s.beds || []).map(b => ({ name: b.name, kind: b.inst, layer: b.layer })));
  const reset = document.createElement('button'); reset.textContent = 'Unmute all';
  reset.title = 'Unmute every voice and bed, and clear the solos';
  reset.onclick = () => { muted.clear(); soloed.clear(); applyMix(); };
  const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'Click a name to mute it, S to solo it';
  ui.mixer.append(reset, hint);
  unmuteAll = reset;
  applyMix();
}

// Dim the voices that can't be heard right now: not in the cue playing, or above the intensity
function updateMixer(st) {
  if (!playable) return;
  if (unmuteAll) unmuteAll.disabled = !muted.size && !soloed.size;
  const cue = st.playing ? (st.cue || st.target) : null, c = cue && playable.cues[cue];
  const bedIdx = new Map((playable.beds || []).map(b => [b.name, b]));
  playable.voices.forEach((v, i) => mark(v.name, c && !usedBy[cue].has(i) ? `${v.name} doesn't play in ${cue}` :
    st.playing && (v.layer || 0) > +ui.intensity.value ? `${v.name} plays from intensity ${v.layer}` : null));
  for (const [name, b] of bedIdx) mark(name, c && c.beds && !c.beds[name] ? `${name} isn't in ${cue}` :
    st.playing && (b.layer || 0) > +ui.intensity.value ? `${name} plays from intensity ${b.layer}` : null);
  function mark(name, why) {
    const chip = ui.mixer.querySelector(`.chip[data-name="${name}"]`); if (!chip) return;
    const off = muted.has(name) || (soloed.size > 0 && !soloed.has(name));
    chip.classList.toggle('idle', !!why);
    chip.classList.toggle('off', off);
    chip.classList.toggle('soloed', soloed.has(name));
    const m = chip.querySelector('.name');
    m.title = (why ? why + ' · ' : '') + (muted.has(name) ? `Unmute ${name}` : `Mute ${name}`);
    m.setAttribute('aria-pressed', String(muted.has(name)));
    chip.querySelector('.solo').setAttribute('aria-pressed', String(soloed.has(name)));
  }
}

// Compile the editor text. If it's clean and music is playing, swap it in on the next bar.
function apply(reason) {
  song = compile(ui.score.value);
  show(song);
  if (song.errors.length) { say('Not applied: fix the errors in Problems first'); markEdited(); return; }
  playable = song;
  appliedText = ui.score.value;
  markEdited();
  heard = {};
  if (!viewCue || !playable.cues[viewCue]) viewCue = playable.defaultCue;
  master.setBands(playable.mixEq);
  dyn.set(playable.master);
  master.setHighpass(playable.master.highpass);
  renderChain();
  renderCues();
  if (player.seg) {
    const cue = playable.cues[player.target] ? player.target : playable.defaultCue;
    player.load(playable);
    player.goto(cue, { restart: true, at: 'bar', via: false });
  }
  say(reason ? `${reason} · ${new Date().toLocaleTimeString()}` : '');
}

// Messages show as a toast at the bottom of the window, so they are seen wherever the page is
// scrolled. The element is a live region that stays in place, so screen readers announce them too.
let noteTimer = 0;
function say(msg) {
  clearTimeout(noteTimer);
  ui.note.classList.toggle('show', !!msg);
  if (!msg) { noteTimer = setTimeout(() => { ui.note.textContent = ''; }, 300); return; }
  ui.note.textContent = msg;
  noteTimer = setTimeout(() => say(''), Math.min(10000, 3000 + msg.length * 50));
}

// The score card's hint says when the text has edits the music isn't playing yet.
let baseHint = ui.hint.textContent;
function markEdited() {
  const edited = appliedText != null && ui.score.value !== appliedText;
  ui.hint.classList.toggle('edited', edited);
  ui.hint.textContent = edited ? 'Edits not applied yet · Ctrl+Enter applies them' : baseHint;
}

// `reason` is the message to show; '' loads quietly.
async function openFile(path, reason = `Loaded ${path}`) {
  const res = await fetch('../' + path, { cache: 'no-store' });
  if (!res.ok) { say(`Can't load ${path} (${res.status})`); return; }
  current = path;
  viewCue = null;
  ui.score.value = await res.text();
  ui.file.value = path;
  const url = new URL(location.href);
  url.searchParams.set('score', path);
  url.hash = '';
  history.replaceState(null, '', url);
  apply(reason);
}

// A static build (GitHub Pages) lists its scores in scores/index.json, written by
// `npm run build`. Without one, the dev server lists them live and pushes reloads. URLs stay relative
// so the editor works under a sub-path such as /musicbox/.
async function listFiles() {
  try {
    const r = await fetch('../scores/index.json', { cache: 'no-store' });
    if (r.ok) return { files: await r.json(), dev: false };
  } catch { /* not a build */ }
  try {
    const r = await fetch('../__scores', { cache: 'no-store' });
    if (r.ok) return { files: await r.json(), dev: true };
  } catch { /* no dev server either */ }
  return { files: [], dev: false };
}

// A listen link carries the whole score in the hash (#score=…); see src/link.js.
async function openLink(code) {
  let text;
  try { text = await decodeScore(code); } catch { say("Can't read the score in this link. It may have been cut short when it was copied."); return false; }
  current = null;
  viewCue = null;
  let o = ui.file.querySelector('option[data-link]');
  if (!o) { o = document.createElement('option'); o.dataset.link = '1'; o.disabled = true; o.textContent = '(score from a link)'; ui.file.prepend(o); }
  o.selected = true;
  ui.score.value = text;
  apply('Loaded the score from the link');
  return true;
}

async function init() {
  let { files, dev } = await listFiles();
  if (!files.length) files = ['scores/demo/tide-caves.scrim'];
  baseHint = dev ? 'Ctrl+Enter applies edits · files reload when saved' : 'Ctrl+Enter applies edits';
  markEdited();
  for (const f of files) {
    const o = document.createElement('option'); o.value = f; o.textContent = f.replace(/^scores\//, ''); ui.file.append(o);
  }
  const wanted = new URL(location.href).searchParams.get('score');
  const first = files.includes(wanted) ? wanted : (files.includes('scores/demo/tide-caves.scrim') ? 'scores/demo/tide-caves.scrim' : files[0]);
  ui.file.value = first;
  const code = scoreCode(location.hash);
  if (!code || !(await openLink(code))) await openFile(first, '');
  addEventListener('hashchange', () => { const c = scoreCode(location.hash); if (c) openLink(c); });

  if (dev) try {
    const es = new EventSource('../__watch');
    es.onmessage = ev => {
      const { file } = JSON.parse(ev.data);
      if (file === current) openFile(file, `Reloaded ${file}`);
      else if (![...ui.file.options].some(o => o.value === file)) {
        const o = document.createElement('option'); o.value = file; o.textContent = file.replace(/^scores\//, ''); ui.file.append(o);
      }
    };
  } catch { /* no live reload without the dev server */ }
}

ui.file.onchange = () => openFile(ui.file.value);

/* ------------------------------------------------------------ transport and timeline */

// Pause holds the whole audio clock still, so the music (beds too) carries on exactly where it was.
async function togglePlay() {
  if (!playable) return;
  if (paused()) { await player.ctx.resume(); return; }
  if (player.state.playing) { await player.ctx.suspend(); return; }
  await player.unlock();
  player.load(playable);
  player.play(playable.cues[viewCue] ? viewCue : playable.defaultCue, { intensity: +ui.intensity.value });
}
ui.play.onclick = togglePlay;
ui.stop.onclick = async () => {
  if (paused()) await player.ctx.resume();
  player.stop(0.4);
};

// Move to `time` seconds into the intro or loop of the cue on the timeline. While paused it stays paused.
async function seek(part, time) {
  if (!playable) return;
  if (player.state.playing && player.song === playable) { player.seek(time, part); return; }
  await player.unlock();
  player.load(playable);
  player.play(playable.cues[viewCue] ? viewCue : playable.defaultCue, { part, time, intensity: +ui.intensity.value });
}
const timeline = createTimeline(ui.track, { onSeek: seek });
ui.prev.onclick = () => timeline.step(-1, 'pattern');
ui.next.onclick = () => timeline.step(1, 'pattern');

addEventListener('keydown', e => {
  if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest && e.target.closest('textarea, input, select, button, a, [contenteditable]')) return;
  e.preventDefault();
  togglePlay();
});

// Which patterns a randomly picked section could have been: `loop A {B C}` gives B its choices.
const choiceCache = new WeakMap();
function choicesFor(sections, slots) {
  if (!slots || !sections) return null;
  if (choiceCache.has(sections)) return choiceCache.get(sections);
  const name = s => s.name + (s.trans ? (s.trans > 0 ? '+' : '') + s.trans : '');
  const label = tl => { const ns = tl.sections.map(name); return ns.every(x => x === ns[0]) && ns.length > 1 ? `${ns[0]}×${ns.length}` : ns.join(' '); };
  const out = [];
  let i = 0;
  for (const slot of slots) {
    let k = slot.findIndex(tl => tl.sections.every((s, j) => sections[i + j] && sections[i + j].name === s.name && sections[i + j].trans === s.trans));
    if (k < 0) k = 0;
    const opts = slot.length > 1 ? [...new Set(slot.map(label))] : null;
    for (let j = 0; j < slot[k].sections.length; j++) out.push(opts);
    i += slot[k].sections.length;
  }
  choiceCache.set(sections, out);
  return out;
}

// What the timeline shows: the cue playing (or the one picked while stopped), its intro and its
// loop as they are being heard, and where the music is in them.
function timelineView(st) {
  if (!playable) return { parts: [], pos: null };
  if (st.cue && st.sections && st.part !== 'via') heard[st.cue + ':' + st.part] = st.sections;
  let cue = st.playing ? (st.cue || st.target) : viewCue;
  if (!cue || !playable.cues[cue]) cue = playable.defaultCue;
  if (st.playing) viewCue = cue;
  const c = playable.cues[cue];
  const parts = [];
  for (const kind of ['intro', 'loop']) {
    if (!c[kind].dur) continue;
    const sections = (st.cue === cue && st.part === kind && st.sections) || heard[cue + ':' + kind] || c[kind].sections;
    const last = sections[sections.length - 1];
    parts.push({ kind, sections, dur: last ? last.start + last.dur : 0, choices: choicesFor(sections, kind === 'intro' ? c.introSlots : c.loopSlots) });
  }
  let pos = null;
  if (st.cue === cue && (st.part === 'intro' || st.part === 'loop')) {
    pos = st.time + (st.part === 'loop' && parts[0] && parts[0].kind === 'intro' ? parts[0].dur : 0);
  }
  const label = st.playing && st.cue ? `${cue}, ${st.part === 'via' ? 'transition' : st.part}, pattern ${st.pattern}, bar ${st.bar}, ${formatTime(pos || 0)}` : `${cue}, stopped`;
  return { cue, parts, then: !c.loop.dur && c.then ? c.then : null, pos, label };
}

/* ------------------------------------------------------------ master */

// The master panel edits the score's `eq mix` and `master` lines. While a band or a slider moves,
// only the sound changes; when the change is done, the line is written into the score. If the
// score has no other edits waiting, that counts as applied; otherwise the music keeps the old score
// with the new mastering until Ctrl+Enter.
const master = createMaster({
  canvas: $('#scope'), list: $('#bands'), add: $('#addBand'), bypass: $('#bypass'), line: $('#eqLine'), note: $('#scopeNote'),
  meters: {
    loud: meterEls('#mLoud'), peak: [meterEls('#mPeakL'), meterEls('#mPeakR')], comp: meterEls('#mComp'), lim: meterEls('#mLim')
  }
}, {
  onChange(bands, commit) {
    if (player.syn) player.syn.setMixEq(bands);
    renderChain(bands);
    if (commit) writeMastering({ mixEq: bands });
  },
  onBypass(on) {
    if (player.syn) player.syn.bypassMixEq(on);
    say(on ? 'Bypassing the mix eq: you hear the mix without it' : '');
  }
});
function meterEls(sel) { const m = $(sel); return { bar: m.querySelector('.mbar'), out: m.querySelector('output'), sub: m.querySelector('.sub') }; }

const dyn = createDynamics($('#dynamics'), {
  onChange(m, commit) {
    if (player.syn) player.syn.setMaster(m);
    master.setHighpass(m.highpass);
    renderChain(null, m);
    if (commit) writeMastering({ master: m });
  }
});
ui.masterReset.onclick = () => dyn.reset();

// The chain at the top of the panel: each stage's settings at a glance, and a way to its controls.
let chainBands = [];
function renderChain(bands, m) {
  if (bands) chainBands = bands;
  m = m || dyn.value;
  const minus = s => String(s).replace('-', '−');
  const set = (k, text, off) => { ui.chain[k].textContent = text; ui.chain[k].parentElement.classList.toggle('off', !!off); };
  set('gain', minus(`${m.gain > 0 ? '+' : ''}${m.gain} dB`));
  const hp = m.highpass;
  set('highpass', hp ? `${hp.f} Hz` + (hp.slope !== 24 ? ` · ${hp.slope} dB` : '') + (hp.q !== 0.707 ? ` · Q ${hp.q}` : '') : 'off', !hp);
  set('eq', chainBands.length ? `${chainBands.length} band${chainBands.length > 1 ? 's' : ''}` : 'neutral');
  set('comp', m.comp ? minus(`${m.comp.threshold} dB · ${m.comp.ratio}:1`) : 'off', !m.comp);
  set('limit', m.limit ? minus(`${m.limit.threshold} dB`) : 'off', !m.limit);
  ui.masterLine.textContent = formatMaster(m) || 'No master line: the default chain.';
}
for (const b of document.querySelectorAll('.chain button')) {
  b.onclick = () => {
    const stage = { gain: 'stGain', highpass: 'stHighpass', eq: 'stEq', comp: 'stComp', limit: 'stLimit' }[b.dataset.stage];
    const el = $('#' + stage);
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (b.dataset.stage === 'eq') ($('#bands input') || $('#addBand')).focus({ preventScroll: true });
    else dyn.focus(b.dataset.stage);
  };
}

// Write a mastering change ({ mixEq } or { master }) into the score.
function writeMastering(change) {
  const before = ui.score.value;
  const { text, line } = change.mixEq ? setMixLine(before, change.mixEq) : setMasterLine(before, change.master);
  if (text === before) return;
  const what = change.mixEq ? 'Mix eq' : 'Master';
  const onlyMastering = appliedText != null && withoutMasteringLines(before) === withoutMasteringLines(appliedText);
  replaceScore(text);
  if (onlyMastering) {
    const s = compile(text);
    if (!s.errors.length) {
      song = s; playable = s; appliedText = text;
      show(s);
      if (player.song) player.load(playable);
      markEdited();
      say(line ? `${what} written to line ${line}` : `${what} line removed: the default`);
      return;
    }
  }
  if (playable) {
    playable = Object.assign({}, playable, change);
    if (player.song) player.load(playable);
  }
  markEdited();
  say(`${what} written${line ? ` to line ${line}` : ''}. Your other edits aren't applied yet: Ctrl+Enter applies them`);
}

// Change the score text with as small an edit as possible, through the browser's own editing, so
// Ctrl+Z in the score undoes it. The caret and scroll position stay where they were. On a touch
// screen, focusing the score would bring up the keyboard, so the text is set directly there.
function replaceScore(next) {
  const ta = ui.score, prev = ta.value;
  if (matchMedia('(pointer: coarse)').matches && document.activeElement !== ta) { ta.value = next; return; }
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  const focus = document.activeElement, ss = ta.selectionStart, se = ta.selectionEnd, top = ta.scrollTop;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(a, prev.length - b);
  let ok = false;
  try { ok = document.execCommand('insertText', false, next.slice(a, next.length - b)); } catch { ok = false; }
  if (!ok || ta.value !== next) ta.value = next;
  const shift = next.length - prev.length, fix = p => (p <= a ? p : Math.max(a, p + shift));
  ta.setSelectionRange(fix(ss), fix(se));
  ta.scrollTop = top;
  if (focus && focus !== ta && focus.focus) focus.focus({ preventScroll: true }); else if (focus !== ta) ta.blur();
}
let shareTimer = 0;
ui.share.onclick = async () => {
  const url = await scoreLink(ui.score.value, location.origin + location.pathname);
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    ui.share.textContent = 'Copied';
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => { ui.share.textContent = 'Copy link'; }, 2000);
    say('Copied a link to this score, with any unapplied edits');
  } catch { say('The link to this score is in the address bar'); }
};
ui.intensity.oninput = () => {
  ui.intensityVal.textContent = ui.intensity.value;
  player.setIntensity(+ui.intensity.value);
};
ui.volume.oninput = () => player.setVolume(+ui.volume.value);
ui.score.addEventListener('input', markEdited);
ui.score.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply('Applied edits'); }
});

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let lastStatus = '', lastPlayState = '';

function tick() {
  const st = player.state, hold = paused();
  const mode = !st.playing ? 'stopped' : hold ? 'paused' : 'playing';

  if (mode !== lastPlayState) {
    lastPlayState = mode;
    ui.playPath.setAttribute('d', mode === 'playing' ? ICON.pause : ICON.play);
    ui.playLabel.textContent = mode === 'playing' ? 'Pause' : mode === 'paused' ? 'Resume' : 'Play';
    ui.play.title = (mode === 'playing' ? 'Pause' : mode === 'paused' ? 'Resume' : 'Play') + ' (Space)';
  }
  ui.play.disabled = !playable;

  const view = timelineView(st);
  timeline.update(view);
  ui.tNow.textContent = formatTime(view.pos || 0);
  ui.tEnd.textContent = formatTime(timeline.total);

  let status;
  if (!st.playing) status = playable ? `<b>${esc(view.cue)}</b> · stopped · click the timeline to start anywhere` : 'stopped';
  else if (!st.cue) status = `starting ${esc(st.target || '')}…`;
  else {
    const part = st.part === 'via' ? `transition (${esc(st.pattern)})` : st.part + (st.part === 'loop' && st.pass > 1 ? ` ×${st.pass}` : '');
    status = (hold ? 'paused · ' : '') + `<b>${esc(st.cue)}</b> · ${part}` +
      (st.part === 'via' ? '' : ` · pattern ${esc(st.pattern)} · bar ${st.bar}.${st.beat}`) + (st.chord ? ' · ' + esc(st.chord) : '') +
      (st.target && st.target !== st.cue ? ` → ${esc(st.target)}` : '') + ` · seed ${st.seed}`;
  }
  if (status !== lastStatus) { ui.status.innerHTML = status; lastStatus = status; }

  if (player.syn && !master.attached) master.attach(player.syn, player.ctx);
  master.frame(mode);

  for (const b of ui.cues.querySelectorAll('button')) {
    const on = String(!!st.playing && b.dataset.cue === (st.cue || st.target));
    if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    b.title = st.playing ? `Switch to ${b.dataset.cue}` : `Play ${b.dataset.cue}`;
  }
  updateMixer(st);
  requestAnimationFrame(tick);
}

init();
tick();
