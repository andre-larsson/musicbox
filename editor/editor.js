import { MusicPlayer } from '../src/player.js';
import { compile } from '../src/score.js';
import { analyze } from '../src/analyze.js';
import { scoreLink, scoreCode, decodeScore } from '../src/link.js';

const $ = s => document.querySelector(s);
const ui = {
  file: $('#file'), play: $('#play'), stop: $('#stop'), cues: $('#cues'), intensity: $('#intensity'),
  intensityVal: $('#intensityVal'), volume: $('#volume'), status: $('#status'), score: $('#score'),
  problems: $('#problems'), analysis: $('#analysis'), note: $('#note'), hint: $('#hint'), share: $('#share')
};

const player = new MusicPlayer({ volume: +ui.volume.value });
let song = null;         // last compiled score (may have errors)
let playable = null;     // last compiled score without errors
let current = null;      // path of the file being edited

function show(s) {
  ui.problems.innerHTML = '';
  const items = s.errors.map(e => ({ ...e, kind: 'error' })).concat(s.warnings.map(w => ({ ...w, kind: 'warning' })));
  if (!items.length) {
    const li = document.createElement('li'); li.className = 'ok'; li.textContent = 'No problems.'; ui.problems.append(li);
  }
  for (const p of items) {
    const li = document.createElement('li');
    li.className = p.kind;
    li.textContent = `line ${p.line}: ${p.msg}`;
    li.onclick = () => jumpTo(p.line);
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
      await player.unlock();
      if (player.song !== playable) player.load(playable);
      if (player.seg) player.goto(name); else player.play(name, { intensity: +ui.intensity.value });
    };
    ui.cues.append(b);
  }
  const layers = Math.max(0, ...s.voices.map(v => v.layer || 0), ...(s.beds || []).map(b => b.layer || 0));
  ui.intensity.max = String(Math.max(1, layers));
  if (+ui.intensity.value > layers) { ui.intensity.value = String(layers); ui.intensityVal.textContent = String(layers); }
  ui.intensity.disabled = layers === 0;
}

// Compile the editor text. If it's clean and music is playing, swap it in on the next bar.
function apply(reason) {
  song = compile(ui.score.value);
  show(song);
  if (song.errors.length) { ui.note.textContent = `${reason ? reason + ' · ' : ''}not applied: fix the errors first`; return; }
  playable = song;
  renderCues();
  if (player.seg) {
    const cue = playable.cues[player.target] ? player.target : playable.defaultCue;
    player.load(playable);
    player.goto(cue, { restart: true, at: 'bar', via: false });
  }
  ui.note.textContent = reason ? `${reason} · ${new Date().toLocaleTimeString()}` : '';
}

async function openFile(path, reason) {
  const res = await fetch('../' + path, { cache: 'no-store' });
  if (!res.ok) { ui.note.textContent = `Can't load ${path} (${res.status})`; return; }
  current = path;
  ui.score.value = await res.text();
  ui.file.value = path;
  const url = new URL(location.href);
  url.searchParams.set('score', path);
  url.hash = '';
  history.replaceState(null, '', url);
  apply(reason || `Loaded ${path}`);
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
  try { text = await decodeScore(code); } catch { ui.note.textContent = "Can't read the score in this link. It may have been cut short when it was copied."; return false; }
  current = null;
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
  ui.hint.textContent = dev ? 'Ctrl+Enter applies edits · files reload when saved' : 'Ctrl+Enter applies edits';
  for (const f of files) {
    const o = document.createElement('option'); o.value = f; o.textContent = f.replace(/^scores\//, ''); ui.file.append(o);
  }
  const wanted = new URL(location.href).searchParams.get('score');
  const first = files.includes(wanted) ? wanted : (files.includes('scores/demo/tide-caves.scrim') ? 'scores/demo/tide-caves.scrim' : files[0]);
  ui.file.value = first;
  const code = scoreCode(location.hash);
  if (!code || !(await openLink(code))) await openFile(first);
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
ui.play.onclick = async () => {
  if (!playable) return;
  await player.unlock();
  player.load(playable);
  player.play(player.target && playable.cues[player.target] ? player.target : playable.defaultCue, { intensity: +ui.intensity.value });
};
ui.stop.onclick = () => player.stop(0.4);
ui.share.onclick = async () => {
  const url = await scoreLink(ui.score.value, location.origin + location.pathname);
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); ui.note.textContent = 'Copied a link to this score (with any unapplied edits)'; }
  catch { ui.note.textContent = 'The link to this score is in the address bar'; }
};
ui.intensity.oninput = () => {
  ui.intensityVal.textContent = ui.intensity.value;
  player.setIntensity(+ui.intensity.value);
};
ui.volume.oninput = () => player.setVolume(+ui.volume.value);
ui.score.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply('Applied edits'); }
});

function tick() {
  const st = player.state;
  if (!st.playing) ui.status.textContent = 'stopped';
  else if (!st.cue) ui.status.textContent = `starting ${st.target || ''}…`;
  else {
    const part = st.part === 'via' ? 'transition' : st.part;
    ui.status.innerHTML = `<b>${st.cue}</b> ${part} · ${st.pattern} · bar ${st.bar}.${st.beat}${st.chord ? ' · ' + st.chord : ''}` +
      (st.target && st.target !== st.cue ? ` → ${st.target}` : '') + ` · seed ${st.seed}`;
  }
  for (const b of ui.cues.querySelectorAll('button')) {
    b.classList.toggle('on', st.playing && b.dataset.cue === (st.cue || st.target));
    b.title = st.playing ? `Switch to ${b.dataset.cue}` : `Play ${b.dataset.cue}`;
  }
  requestAnimationFrame(tick);
}

init();
tick();
