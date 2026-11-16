import { parse } from '../src/score.js';

export const LIBRARY_KEY = 'musicbox.editor.library.v1';
const empty = () => ({ version: 1, scores: [], selected: null });

export function scoreInfo(text, fallback = 'Untitled') {
  const { song } = parse(text);
  const hasTitle = /^\s*title\s+\S/im.test(text);
  return { title: hasTitle ? song.title : fallback, composer: song.composer, about: song.about,
    tempo: song.tempo, key: song.key?.name || '', beats: song.beats, steps: song.steps };
}

// Accept a raw score or one Markdown code block copied from a chat. Keep score contents intact.
export function importText(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const fenced = [...text.matchAll(/^```(?:scrim|scrimshaw|musicbox|text)?[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim)];
  if (fenced.length > 1) throw new Error('Paste one complete score at a time.');
  const result = fenced.length ? fenced[0][1] : text;
  if (!result.trim()) throw new Error('Choose a score file or paste a score first.');
  return result;
}

export const NEW_SCORE = `title Untitled
tempo 96
beats 4
steps 4
key A minor

voice tune flute
voice bass fretless

pattern A
harmony | Am | F |
tune    | A4:8 C5:8 | F5:8 A5:8 |
bass    | A1:16 | F1:16 |

cue explore
loop A
`;

// Only this editor's key is written or removed: other apps may share the same origin.
// Failed writes keep the score in memory and expose an error instead of claiming it was saved.
export function createScoreLibrary(storage, { makeId = () => 'local:' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)), now = () => new Date().toISOString() } = {}) {
  let state = empty(), error = '', readFailed = false;
  try {
    if (!storage) throw new Error('Storage unavailable');
    const raw = storage.getItem(LIBRARY_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.scores) ||
        data.scores.some(s => !s || typeof s.id !== 'string' || !s.id.startsWith('local:') || typeof s.text !== 'string' || typeof s.name !== 'string') ||
        new Set(data.scores.map(s => s.id)).size !== data.scores.length) throw new Error('Invalid library');
      state = { version: 1, scores: data.scores, selected: typeof data.selected === 'string' ? data.selected : null };
    }
  } catch {
    readFailed = true;
    error = 'Could not read browser storage. Changes stay in this tab; use Copy link to keep a copy.';
  }
  const write = () => {
    if (readFailed) return;
    try { storage.setItem(LIBRARY_KEY, JSON.stringify(state)); error = ''; }
    catch { error = 'Could not save in this browser. Changes stay in this tab; use Copy link to keep a copy.'; }
  };
  return {
    get scores() { return state.scores.map(s => ({ ...s })); },
    get selected() { return state.selected; },
    get error() { return error; },
    get(id) { const s = state.scores.find(s => s.id === id); return s ? { ...s } : null; },
    save({ id, text, name = 'Untitled', source = null }) {
      const previous = state.scores.find(s => s.id === id);
      const stamp = now();
      const record = { id: previous?.id || makeId(), text, name, source: previous ? previous.source : source,
        createdAt: previous?.createdAt || stamp, updatedAt: stamp };
      state.scores = previous ? state.scores.map(s => s.id === record.id ? record : s) : [...state.scores, record];
      state.selected = record.id;
      write();
      return { ...record };
    },
    select(id) { if (state.selected === id) return; state.selected = id; if (state.scores.length) write(); },
    reset() {
      if (storage) storage.removeItem(LIBRARY_KEY); // If removal fails, leave the in-memory library intact too.
      state = empty();
      readFailed = !storage;
      error = storage ? '' : 'Browser storage is unavailable. Changes can only stay in this tab.';
    }
  };
}
