// Score parser and compiler. No audio, so it runs in the browser and in Node.
//
// Forked from the Scrimshaw score format by Simon Willison
// (https://tools.simonwillison.net/scrimshaw-jukebox), Apache License 2.0.
// Modified: converted to an ES module; musicbox extensions are marked "musicbox:".
// Every valid Scrimshaw score is a valid musicbox score and compiles to the same events.

const MELODIC = ['steeldrum', 'marimba', 'vibes', 'celesta', 'glock', 'xylophone', 'musicbox', 'bell',
  'organ', 'pipe', 'strings', 'pad', 'choir', 'voices', 'brass', 'trumpet', 'horn', 'tuba',
  'flute', 'clarinet', 'oboe', 'bassoon', 'accordion', 'fiddle',
  'harp', 'guitar', 'banjo', 'harpsichord', 'pizz', 'upright', 'fretless', 'synbass', 'timpani',
  'chip', 'sine', 'square', 'saw', 'triangle', 'piano']; // musicbox: piano
const DRUMS = ['kick', 'snare', 'rim', 'hat', 'ohat', 'ride', 'crash', 'shaker', 'tamb',
  'conga', 'tumba', 'bongo', 'bongolo', 'clave', 'block', 'cowbell', 'guiro',
  'tomlo', 'tommid', 'tomhi', 'bodhran', 'timbale', 'tri', 'clap', 'gong', 'thunder', 'surf'];
// musicbox: beds are continuous sounds that run under every cue
const BEDS = ['sea', 'wind', 'rain', 'drone'];
const ARPS = ['up', 'down', 'updown', 'random'];

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOTE_RE = /^([A-Ga-g])(##|bb|#|b)?([0-8])$/;
const ACC = { '': 0, '#': 1, '##': 2, b: -1, bb: -2 };

function noteToMidi(s) {
  const m = NOTE_RE.exec(s);
  if (!m) return null;
  return 12 * (+m[3] + 1) + PC[m[1].toLowerCase()] + ACC[m[2] || ''];
}

const CHORDS = {
  '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7],
  '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], mmaj7: [0, 3, 7, 11],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], '+': [0, 4, 8],
  '5': [0, 7], '7b9': [0, 4, 7, 10, 13]
};

function pcOf(letter, acc) { return (PC[letter.toLowerCase()] + ACC[acc || ''] + 12) % 12; }
function placeNear(pc, lo) { return lo + (((pc - lo) % 12) + 12) % 12; }

const CHORD_RE = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/;

// [Dm7] or [C/E] -> midi notes voiced in a window around `center`
function chordToMidis(sym, center) {
  const m = CHORD_RE.exec(sym);
  if (!m || !(m[3] in CHORDS)) return null;
  const root = pcOf(m[1], m[2]);
  const lo = center - 6;
  const set = new Set(CHORDS[m[3]].map(iv => placeNear((root + iv) % 12, lo)));
  if (m[4]) set.add(placeNear(pcOf(m[4], m[5]), lo - 12));
  return [...set].sort((a, b) => a - b);
}

// musicbox: pitch classes of a chord symbol, for the harmony line and the analyzer
function chordInfo(sym) {
  const m = CHORD_RE.exec(sym);
  if (!m || !(m[3] in CHORDS)) return null;
  const root = pcOf(m[1], m[2]);
  const pcs = CHORDS[m[3]].map(iv => (root + iv) % 12);
  const bass = m[4] ? pcOf(m[4], m[5]) : root;
  if (!pcs.includes(bass)) pcs.push(bass);
  return { root, bass, pcs };
}

// musicbox: chord symbols follow the arrangement's transposition (A+2 turns Dm into Em)
const SPELL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function transposeChord(sym, n) {
  if (!n) return sym;
  const m = CHORD_RE.exec(sym);
  if (!m) return sym;
  const sh = (l, a) => SPELL[(pcOf(l, a) + n + 120) % 12];
  return sh(m[1], m[2]) + m[3] + (m[4] ? '/' + sh(m[4], m[5]) : '');
}

// musicbox: keys, used by the analyzer to point out notes outside the scale
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11]
};
// how far the mode's tonic sits above its relative major, to pick sharps or flats
const MODE_OFFSET = { major: 0, ionian: 0, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, minor: 9, aeolian: 9, harmonic: 9, locrian: 11 };

function parseKey(str) {
  const m = /^([A-G])(#|b)?(m)?(?:\s+([A-Za-z]+))?$/.exec(String(str).trim());
  if (!m) return null;
  let mode = m[4] ? m[4].toLowerCase() : (m[3] ? 'minor' : 'major');
  if (m[3] && m[4]) return null;
  if (!MODES[mode]) return null;
  const tonic = pcOf(m[1], m[2]);
  const relMajor = (tonic - MODE_OFFSET[mode] + 12) % 12;
  // how to name notes: keys with at most one sharp or flat use the everyday names (C# Eb F# G# Bb)
  const spell = m[2] === 'b' ? 'flat' : m[2] === '#' ? 'sharp'
    : [0, 7, 5].includes(relMajor) ? 'neutral' : [10, 3, 8, 1].includes(relMajor) ? 'flat' : 'sharp';
  return { tonic, mode, pcs: MODES[mode].map(i => (tonic + i) % 12), spell, name: m[1] + (m[2] || '') + ' ' + mode };
}

const T_HOLD = /^-+$/;
const T_HOLD_N = /^-:(\d+)$/;          // musicbox: -:8 holds for 8 steps
const T_REST = /^(\.+)(-*)$/;
const T_REST_N = /^\.:(\d+)$/;         // musicbox: .:8 rests for 8 steps
const NOTE_SRC = '[A-Ga-g](?:##|bb|#|b)?[0-8]';
// musicbox: D5:8 / [Dm]?:16 give a length in steps instead of dashes
const T_NOTE = new RegExp('^(~?)(\\[[^\\]]+\\]|' + NOTE_SRC + '(?:\\+' + NOTE_SRC + ')*)([!?]*)(-*)(?::(\\d+))?([!?]*)$');
// musicbox: harmony line tokens: Dm  Dm:8  Dm-------  [Dm]
const T_HARM = /^\[?([A-G](?:#|b)?[^\s[\]:/-]*(?:\/[A-G](?:#|b)?)?)\]?(-*)(?::(\d+))?$/;
// musicbox: {A5 C6 D6}:4 plays one of the notes, picked each time it comes round
const T_PICK = /^\{([^{}]*)\}([!?]*)(-*)(?::(\d+))?([!?]*)$/;
const REF_RE = /^([A-Za-z_]\w*?)([+-]\d+)?(?:\*(\d+))?$/;
const NAME_RE = /^[A-Za-z_]\w*$/;
const AT_VALUES = ['now', 'beat', 'bar', 'pattern', 'loop'];
const HARMONY = 'harmony';

// musicbox: split on spaces, but keep {A5 C6 D6}:4 together
function tokens(s) { return s.match(/[^\s{]*\{[^}]*\}\S*|\S+/g) || []; }

// musicbox: the key's notes in the octave around `center`
function scaleNotes(key, center) {
  const out = [];
  for (let m = center - 6; m < center + 6; m++) if (key.pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

function velFrom(marks) {
  let v = 0.8;
  for (const ch of marks) v *= ch === '!' ? 1.25 : 0.6;
  return Math.min(1.35, v);
}

function num(s, lo, hi, def) {
  const n = parseFloat(s);
  if (!isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/* ------------------------------------------------------------------ parse */
function parse(text) {
  const errors = [];
  const warnings = [];
  const err = (ln, msg) => errors.push({ line: ln, msg });
  const song = {
    title: 'Untitled', composer: '', about: '', tempo: 120, beats: 4, steps: 4, swing: 0,
    reverb: 0.3, key: null, voices: [], voiceMap: {}, patterns: {}, patternOrder: [],
    cues: {}, cueOrder: [], transitions: [], beds: [], bedMap: {}
  };
  let cur = null;
  let curCue = null;
  const declaredCues = new Set();
  const lines = String(text).split(/\r?\n/);

  // musicbox: play/loop/then lines belong to the current cue, or to "main" before any cue line
  function getCue(name, ln) {
    if (!song.cues[name]) { song.cues[name] = { name, play: [], loop: [], then: null, beds: null, ln }; song.cueOrder.push(name); }
    return song.cues[name];
  }
  function parseRef(w, ln, what) {
    const m = REF_RE.exec(w);
    if (!m) { err(ln, `Can't read "${w}"${what}. Write a pattern name, optionally with +N/-N to transpose and *N to repeat.`); return null; }
    return { name: m[1], trans: m[2] ? parseInt(m[2], 10) : 0, times: m[3] ? Math.min(64, parseInt(m[3], 10)) : 1, ln };
  }
  // musicbox: {B C C} in a play or loop line picks one pattern each time round (C twice as often)
  function parseItem(w, ln) {
    if (w[0] !== '{') return parseRef(w, ln, '');
    const m = /^\{([^{}]*)\}$/.exec(w);
    if (!m) { err(ln, `Can't read "${w}". Write a choice of patterns in braces, like {B C}. Repeats and transpositions go inside: {B*2 C+2}.`); return null; }
    const choice = m[1].split(/[\s,]+/).filter(Boolean).map(x => parseRef(x, ln, ' inside {…}'));
    if (!choice.length) { err(ln, 'Empty braces. Put two or more pattern names inside, like {B C}.'); return null; }
    if (choice.some(r => !r)) return null;
    return { choice, ln };
  }

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) return;

    const pm = /^([A-Za-z_]\w*)\s*\|(.*)$/.exec(line);
    if (pm) {
      if (!cur) { err(ln, 'Music lines go inside a pattern. Add a "pattern NAME" line above this one.'); return; }
      const parts = pm[2].split('|').map(s => s.trim());
      while (parts.length && parts[parts.length - 1] === '') parts.pop();
      const bars = [];
      parts.forEach((b, k) => {
        if (b === '') err(ln, `Empty bar ${k + 1} in "${pm[1]}". Use _ for a silent bar.`);
        else bars.push(b);
      });
      (cur.raw[pm[1]] = cur.raw[pm[1]] || []).push({ bars, ln });
      if (!cur.voiceOrder.includes(pm[1])) cur.voiceOrder.push(pm[1]);
      return;
    }

    const words = line.split(/\s+/);
    const kw = words[0].toLowerCase();
    const restStr = line.slice(words[0].length).trim();
    const target = cur ? cur.opts : song;

    switch (kw) {
      case 'title': song.title = restStr || song.title; break;
      case 'composer': case 'by': song.composer = restStr; break;
      case 'about': song.about = restStr; break;
      case 'tempo': target.tempo = num(restStr, 20, 400, 120); break;
      case 'beats': target.beats = Math.round(num(restStr, 1, 16, 4)); break;
      case 'steps': target.steps = Math.round(num(restStr, 1, 12, 4)); break;
      case 'swing': target.swing = num(restStr, 0, 0.75, 0); break;
      case 'reverb': song.reverb = num(restStr, 0, 1, 0.3); break;
      case 'key': { // musicbox
        const k = parseKey(restStr);
        if (!k) err(ln, `Can't read the key "${restStr}". Write a tonic and a mode, like: key D minor, key F# dorian, key Bb major. Modes: ${Object.keys(MODES).join(' ')}.`);
        else target.key = k;
        break;
      }
      case 'voice': parseVoice(words.slice(1), ln); break;
      case 'pattern': {
        const name = words[1];
        if (!name || !NAME_RE.test(name)) { err(ln, 'Pattern names use letters, digits and _ (for example: pattern A2).'); cur = null; return; }
        if (song.patterns[name]) err(ln, `Pattern "${name}" is defined twice; the later one wins.`);
        cur = { name, ln, from: null, opts: {}, raw: {}, voiceOrder: [], mute: new Set() };
        for (let k = 2; k < words.length; k++) {
          const w = words[k];
          if (w.toLowerCase() === 'from') { cur.from = words[++k]; continue; }
          const kv = /^(\w+)=(.+)$/.exec(w);
          if (!kv) { err(ln, `Can't read "${w}" in the pattern line.`); continue; }
          const key = kv[1].toLowerCase();
          if (key === 'tempo') cur.opts.tempo = num(kv[2], 20, 400, 120);
          else if (key === 'beats') cur.opts.beats = Math.round(num(kv[2], 1, 16, 4));
          else if (key === 'steps') cur.opts.steps = Math.round(num(kv[2], 1, 12, 4));
          else if (key === 'swing') cur.opts.swing = num(kv[2], 0, 0.75, 0);
          else err(ln, `Unknown pattern option "${kv[1]}".`);
        }
        song.patterns[name] = cur;
        if (!song.patternOrder.includes(name)) song.patternOrder.push(name);
        break;
      }
      case 'mute':
        if (!cur) err(ln, '"mute" only works inside a pattern.');
        else words.slice(1).forEach(w => cur.mute.add(w));
        break;
      case 'cue': { // musicbox
        cur = null;
        const name = words[1];
        if (!name || !NAME_RE.test(name)) { err(ln, 'Cue names use letters, digits and _ (for example: cue explore).'); curCue = null; break; }
        if (words.length > 2) err(ln, 'A cue line holds only the cue name. Put play, loop and then on the lines below it.');
        if (declaredCues.has(name)) err(ln, `Cue "${name}" is declared twice.`);
        declaredCues.add(name);
        curCue = getCue(name, ln);
        break;
      }
      case 'play': case 'loop': {
        cur = null;
        const cue = curCue || getCue('main', ln);
        const list = kw === 'play' ? cue.play : cue.loop;
        for (const w of tokens(restStr)) { const r = parseItem(w, ln); if (r) list.push(r); }
        break;
      }
      case 'then': { // musicbox
        cur = null;
        const cue = curCue || getCue('main', ln);
        if (!words[1] || words.length > 2) err(ln, 'Write: then CUE (the cue to go to when this one has finished playing).');
        else cue.then = { name: words[1], ln };
        break;
      }
      case 'bed': parseBed(words.slice(1), ln); break; // musicbox
      case 'beds': { // musicbox: which beds sound in this cue, and how loud
        if (!curCue) { err(ln, '"beds" goes in a cue, below its cue line. Without a beds line, a cue plays every bed.'); break; }
        cur = null;
        const sel = {};
        for (const w of words.slice(1)) {
          if (w.toLowerCase() === 'none') continue;
          const m = /^([A-Za-z_]\w*)(?:=(.+))?$/.exec(w);
          if (!m) { err(ln, `Can't read "${w}". Write bed names, optionally with a level: beds sea wind=0.5`); continue; }
          sel[m[1]] = m[2] != null ? num(m[2], 0, 2, 1) : 1;
        }
        curCue.beds = { sel, ln };
        break;
      }
      case 'switch': { // musicbox
        cur = null;
        const [, from, arrow, to, ...rest] = words;
        if (!from || arrow !== '->' || !to) { err(ln, 'Write switches as: switch FROM -> TO [at now|beat|bar|pattern|loop] [via PATTERN] [fade SECONDS]. FROM and TO can be *.'); break; }
        const tr = { from, to, at: 'bar', via: null, fade: null, ln };
        for (let k = 0; k < rest.length; k += 2) {
          const key = rest[k].toLowerCase(), val = rest[k + 1];
          if (val == null) { err(ln, `"${rest[k]}" in the switch line needs a value.`); break; }
          if (key === 'at') {
            if (!AT_VALUES.includes(val.toLowerCase())) err(ln, `"at ${val}": use one of ${AT_VALUES.join(', ')}.`);
            else tr.at = val.toLowerCase();
          } else if (key === 'via') {
            if (val[0] === '{') { err(ln, 'via takes one pattern. A choice in braces only works in play and loop lines.'); break; }
            tr.via = parseRef(val, ln, ' after via');
          }
          else if (key === 'fade') tr.fade = num(val, 0, 30, 0);
          else err(ln, `Unknown switch option "${rest[k]}". Use at, via or fade.`);
        }
        song.transitions.push(tr);
        break;
      }
      default:
        err(ln, `Unknown line "${words[0]}". Lines start with a setting (title, tempo, key, voice, bed, pattern, play, loop, cue, switch…) or a voice name followed by |.`);
    }
  });

  function parseVoice(w, ln) {
    const [name, inst] = w;
    if (!name || !inst) { err(ln, 'Write voices as: voice NAME INSTRUMENT [options]'); return; }
    if (!NAME_RE.test(name)) { err(ln, `Voice name "${name}" should use letters, digits and _.`); return; }
    if (name.toLowerCase() === HARMONY) { err(ln, '"harmony" is the chord line inside patterns, not a voice. Give this voice another name.'); return; }
    const instL = inst.toLowerCase();
    const isDrum = DRUMS.includes(instL);
    if (!isDrum && !MELODIC.includes(instL)) { err(ln, `Unknown instrument "${inst}".`); return; }
    const v = {
      name, inst: instL, drum: isDrum, vol: 0.8, pan: 0, rev: null, trans: 0, glide: 0.07,
      gate: 1, center: 62, bright: 1, att: null, rel: null, layer: 0,
      chance: 1, jitter: 0, arp: null, rate: 1, pool: 'chord', span: 1, ln // musicbox
    };
    for (const opt of w.slice(2)) {
      const kv = /^(\w+)=(.+)$/.exec(opt);
      if (!kv) { err(ln, `Voice options look like key=value; got "${opt}".`); continue; }
      const k = kv[1].toLowerCase(), val = kv[2];
      switch (k) {
        case 'vol': v.vol = num(val, 0, 2, 0.8); break;
        case 'pan': v.pan = num(val, -1, 1, 0); break;
        case 'rev': v.rev = num(val, 0, 1, 0.2); break;
        case 'trans': v.trans = Math.round(num(val, -48, 48, 0)); break;
        case 'oct': v.trans += 12 * Math.round(num(val, -4, 4, 0)); break;
        case 'glide': v.glide = num(val, 0.005, 2, 0.07); break;
        case 'gate': v.gate = num(val, 0.05, 1, 1); break;
        case 'bright': v.bright = num(val, 0.1, 4, 1); break;
        case 'att': v.att = num(val, 0.001, 4, 0.01); break;
        case 'rel': v.rel = num(val, 0.005, 6, 0.1); break;
        case 'layer': v.layer = Math.round(num(val, 0, 9, 0)); break; // musicbox
        // musicbox: chance and looseness, rolled each time a note comes round
        case 'chance': v.chance = num(val, 0, 1, 1); break;
        case 'jitter': v.jitter = num(val, 0, 1, 0); break;
        // musicbox: arpeggiator for chords ([*], [Dm], C4+E4+G4)
        case 'arp': {
          const a = val.toLowerCase();
          if (!ARPS.includes(a)) err(ln, `arp= takes ${ARPS.join(', ')}; got "${val}".`);
          else if (isDrum) err(ln, `arp= only works on melodic voices; "${name}" is a ${instL}.`);
          else v.arp = a;
          break;
        }
        case 'rate': v.rate = Math.round(num(val, 1, 48, 1)); break;
        case 'span': v.span = Math.round(num(val, 1, 4, 1)); break;
        case 'pool': {
          const pl = val.toLowerCase();
          if (pl !== 'chord' && pl !== 'scale') err(ln, `pool= takes chord or scale; got "${val}".`); else v.pool = pl;
          break;
        }
        case 'center': {
          const m = noteToMidi(val);
          if (m == null) err(ln, `center= needs a note like E4; got "${val}".`); else v.center = m;
          break;
        }
        default: err(ln, `Unknown voice option "${kv[1]}".`);
      }
    }
    if (song.voiceMap[name]) err(ln, `Voice "${name}" is declared twice.`);
    else if (song.bedMap[name]) err(ln, `"${name}" is already a bed. Give the voice another name.`);
    else { song.voiceMap[name] = v; song.voices.push(v); }
  }

  // musicbox: bed NAME INSTRUMENT [vol= pan= rev= layer= bright= swell= note=]
  function parseBed(w, ln) {
    const [name, inst] = w;
    if (!name || !inst) { err(ln, `Write beds as: bed NAME INSTRUMENT [options]. Instruments: ${BEDS.join(' ')}.`); return; }
    if (!NAME_RE.test(name)) { err(ln, `Bed name "${name}" should use letters, digits and _.`); return; }
    const instL = inst.toLowerCase();
    if (!BEDS.includes(instL)) { err(ln, `Unknown bed "${inst}". Beds: ${BEDS.join(' ')}.`); return; }
    const b = { name, inst: instL, vol: 0.8, pan: 0, rev: null, layer: 0, bright: 1, swell: null, note: null, ln };
    for (const opt of w.slice(2)) {
      const kv = /^(\w+)=(.+)$/.exec(opt);
      if (!kv) { err(ln, `Bed options look like key=value; got "${opt}".`); continue; }
      const k = kv[1].toLowerCase(), val = kv[2];
      switch (k) {
        case 'vol': b.vol = num(val, 0, 2, 0.8); break;
        case 'pan': b.pan = num(val, -1, 1, 0); break;
        case 'rev': b.rev = num(val, 0, 1, 0.3); break;
        case 'layer': b.layer = Math.round(num(val, 0, 9, 0)); break;
        case 'bright': b.bright = num(val, 0.1, 4, 1); break;
        case 'swell': b.swell = num(val, 1, 120, 12); break;
        case 'note': {
          const m = noteToMidi(val);
          if (m == null) err(ln, `note= needs a note like A1; got "${val}".`); else b.note = m;
          break;
        }
        default: err(ln, `Unknown bed option "${kv[1]}". Use vol, pan, rev, layer, bright, swell or note.`);
      }
    }
    if (b.inst === 'drone' && b.note == null) err(ln, `A drone needs a pitch: bed ${name} drone note=A1`);
    if (b.inst !== 'drone' && b.note != null) err(ln, `note= only applies to drone beds.`);
    if (song.bedMap[name] || song.voiceMap[name]) err(ln, `"${name}" is already declared.`);
    else { song.bedMap[name] = b; song.beds.push(b); }
  }

  return { song, errors, warnings };
}

/* ------------------------------------------------------- pattern bodies */
function parseMelodicBars(bars, barSteps, voice, ctx) {
  const events = [];
  let last = null;
  const out = [];
  // musicbox: [*] plays whatever the harmony line says at that step
  const starNotes = step => {
    const h = ctx.chordAt(step);
    return h ? chordToMidis(h.sym, voice.center) : null;
  };
  // musicbox: the choices inside {…}; each is a list of notes, and [] is a rest
  const poolAt = (items, step, where) => {
    const out = [];
    for (const it of items) {
      if (it === '.') out.push([]);
      else if (it === 'chord') {
        const ns = starNotes(step);
        if (!ns) { ctx.err(`{chord} in ${where} picks from the current chord, but the pattern has no harmony line at that point.`); continue; }
        ns.forEach(n => out.push([n]));
      } else if (it === 'scale') {
        if (!ctx.key) { ctx.err(`{scale} in ${where} picks from the key, but there's no key. Add a key line (key A minor).`); continue; }
        scaleNotes(ctx.key, voice.center).forEach(n => out.push([n]));
      } else {
        const n = noteToMidi(it);
        if (n == null) { ctx.err(`Can't read "${it}" inside {…} in ${where}. Use notes like A5, . for silence, chord, or scale.`); continue; }
        out.push([n]);
      }
    }
    return out;
  };
  bars.forEach((barSrc, bi) => {
    const start = bi * barSteps;
    const where = `bar ${bi + 1} of "${voice.name}" in pattern ${ctx.pattern}`;
    const trimmed = barSrc.trim();
    if (trimmed === '%') {
      const prev = events.filter(e => e.step >= start - barSteps && e.step < start);
      if (bi === 0) ctx.err(`% in ${where} has no previous bar to repeat.`);
      prev.forEach(e => {
        const c = Object.assign({}, e, { step: e.step + barSteps });
        if (e.star) { c.notes = starNotes(c.step) || []; if (!c.notes.length) return; } // musicbox: follow the harmony
        if (e.items && e.items.includes('chord')) { c.pick = poolAt(e.items, c.step, where); if (!c.pick.some(o => o.length)) return; }
        events.push(c);
      });
      last = events.length ? events[events.length - 1] : null;
      return;
    }
    if (trimmed === '_') { last = null; return; }
    if (trimmed === '=') {
      if (last && last.step + last.len === start) last.len += barSteps;
      else ctx.err(`= in ${where} needs a note sounding right up to the bar line.`);
      return;
    }
    let pos = start;
    for (const tok of tokens(trimmed)) { // musicbox: tokens() keeps {…} together
      let m;
      if (T_HOLD.test(tok) || (m = T_HOLD_N.exec(tok))) {
        const n = m ? +m[1] : tok.length;
        if (m && n < 1) ctx.err(`"${tok}" in ${where} needs a length of at least 1.`);
        if (last && last.step + last.len === pos) last.len += n;
        pos += n;
      } else if ((m = T_REST.exec(tok))) {
        pos += m[1].length + m[2].length;
        last = null;
      } else if ((m = T_REST_N.exec(tok))) {
        if (+m[1] < 1) ctx.err(`"${tok}" in ${where} needs a length of at least 1.`);
        pos += +m[1];
        last = null;
      } else if ((m = T_NOTE.exec(tok))) {
        const head = m[2];
        let notes;
        let star = false;
        if (head === '[*]') {
          star = true;
          notes = starNotes(pos);
          if (!notes) { ctx.err(`[*] in ${where} plays the current chord, but the pattern has no harmony line at that point.`); notes = []; }
        } else if (head[0] === '[') {
          notes = chordToMidis(head.slice(1, -1), voice.center);
          if (!notes) { ctx.err(`Unknown chord "${head}" in ${where}.`); notes = []; }
        } else {
          notes = head.split('+').map(noteToMidi);
        }
        if (m[4] && m[5]) ctx.err(`"${tok}" in ${where} uses both dashes and :N. Use one of them.`);
        if (m[5] && +m[5] < 1) ctx.err(`"${tok}" in ${where} needs a length of at least 1.`);
        const len = m[5] ? Math.max(1, +m[5]) : 1 + m[4].length;
        last = { step: pos, len, notes, vel: velFrom(m[3] + m[6]), glide: m[1] === '~' };
        if (star) last.star = true;
        if (notes.length) events.push(last);
        pos += len;
      } else if ((m = T_PICK.exec(tok))) { // musicbox: {A5 C6 .}:4
        const items = m[1].split(/[\s,]+/).filter(Boolean);
        if (!items.length) ctx.err(`Empty braces in ${where}. Put notes inside, like {A5 C6 D6}.`);
        if (m[3] && m[4]) ctx.err(`"${tok}" in ${where} uses both dashes and :N. Use one of them.`);
        if (m[4] && +m[4] < 1) ctx.err(`"${tok}" in ${where} needs a length of at least 1.`);
        const len = m[4] ? Math.max(1, +m[4]) : 1 + m[3].length;
        const pick = poolAt(items, pos, where);
        last = { step: pos, len, notes: [], pick, items, vel: velFrom(m[2] + m[5]), glide: false };
        if (pick.some(o => o.length)) events.push(last);
        pos += len;
      } else if (tok === '%' || tok === '_' || tok === '=') {
        ctx.err(`"${tok}" must be alone in its bar (${where}).`);
      } else if (tok[0] === '{' || tok.includes('}')) {
        ctx.err(`Can't read "${tok}" in ${where}. Write a choice of notes as {A5 C6 D6}, with the length after the closing brace: {A5 C6 D6}:4.`);
      } else {
        ctx.err(`Can't read "${tok}" in ${where}. Notes look like D5, F#4, Bb3, chords like [Dm] or C4+E4+G4, lengths like D5--- or D5:4.`);
      }
    }
    const used = pos - start;
    if (used !== barSteps) {
      ctx.err(`${where[0].toUpperCase() + where.slice(1)} has ${used} steps; a bar here holds ${barSteps}.`);
      // clip anything spilling into the next bar so later bars stay aligned
      for (const e of events) if (e.step >= start + barSteps) e.len = 0;
      if (last && last.step + last.len > start + barSteps && used > barSteps) last.len = Math.max(1, start + barSteps - last.step);
    }
  });
  for (const e of events) if (e.len > 0) out.push(e);
  return out;
}

function parseDrumBars(bars, barSteps, voice, ctx) {
  const events = [];
  bars.forEach((barSrc, bi) => {
    const start = bi * barSteps;
    const where = `bar ${bi + 1} of "${voice.name}" in pattern ${ctx.pattern}`;
    const s = barSrc.replace(/\s+/g, '');
    if (s === '%') {
      if (bi === 0) ctx.err(`% in ${where} has no previous bar to repeat.`);
      events.filter(e => e.step >= start - barSteps && e.step < start)
        .forEach(e => events.push({ step: e.step + barSteps, len: 1, vel: e.vel }));
      return;
    }
    if (s === '_') return;
    let k = 0;
    for (const ch of s) {
      if (k < barSteps) {
        if (ch === 'x') events.push({ step: start + k, len: 1, vel: 0.8 });
        else if (ch === 'X') events.push({ step: start + k, len: 1, vel: 1.05 });
        else if (ch === 'o') events.push({ step: start + k, len: 1, vel: 0.42 });
        else if (ch !== '.' && ch !== '-') ctx.err(`Drum lanes use x X o and . — found "${ch}" in ${where}.`);
      }
      k++;
    }
    if (k !== barSteps) ctx.err(`${where[0].toUpperCase() + where.slice(1)} has ${k} steps; a bar here holds ${barSteps}.`);
  });
  return events;
}

// musicbox: the arpeggiator. A chord on a voice with arp= becomes one note every `rate`
// steps, in order (up, down, updown) or picked at random. [*] follows chord changes as it goes.
function arpeggiate(events, voice, ctx) {
  const out = [];
  let warned = false;
  for (const e of events) {
    if (!(e.notes.length > 1 || e.star)) { out.push(e); continue; }
    let k = 0;
    for (let s = e.step; s < e.step + e.len; s += voice.rate, k++) {
      let notes = e.notes;
      if (e.star) { const h = ctx.chordAt(s); if (h) notes = chordToMidis(h.sym, voice.center) || notes; }
      if (!notes.length) continue;
      let pool = notes;
      if (voice.pool === 'scale') {
        if (!ctx.key) { if (!warned) ctx.err(`"${voice.name}" has pool=scale, so it needs a key. Add a key line (key A minor).`); warned = true; }
        else { const lo = notes[0]; pool = []; for (let m = lo; m < lo + 12; m++) if (ctx.key.pcs.includes(((m % 12) + 12) % 12)) pool.push(m); }
      }
      const full = [];
      for (let o = 0; o < voice.span; o++) for (const n of pool) full.push(n + 12 * o);
      const n = full.length;
      const len = Math.min(voice.rate, e.step + e.len - s);
      const ne = { step: s, len, notes: [], vel: e.vel, glide: false, arp: voice.arp };
      if (voice.arp === 'random') { ne.pick = full.map(x => [x]); ne.items = null; }
      else {
        const period = Math.max(1, 2 * n - 2);
        const i = voice.arp === 'up' ? k % n : voice.arp === 'down' ? n - 1 - (k % n)
          : (n === 1 ? 0 : (k % period < n ? k % period : period - (k % period)));
        ne.notes = [full[i]];
      }
      out.push(ne);
    }
  }
  return out;
}

// musicbox: join timelines end to end (used for {B C} choices in play and loop lines)
function assemble(tls) {
  const events = [], sections = [];
  let t = 0;
  for (const tl of tls) {
    const so = sections.length;
    for (const sec of tl.sections) sections.push(Object.assign({}, sec, { start: sec.start + t }));
    for (const e of tl.events) events.push(Object.assign({}, e, { t: e.t + t, s: e.s + so }));
    t += tl.dur;
  }
  return { events, sections, dur: t };
}

// musicbox: the harmony line. Each bar holds chord names that either share the bar
// evenly (no lengths) or all carry a length (Dm:12 A7:4 or Dm----------- A7---).
function parseHarmonyBars(bars, barSteps, ctx) {
  const out = [];
  bars.forEach((barSrc, bi) => {
    const start = bi * barSteps;
    const where = `bar ${bi + 1} of the harmony line in pattern ${ctx.pattern}`;
    const s = barSrc.trim();
    if (s === '%' || s === '=') {
      if (bi === 0) { ctx.err(`${s} in ${where} has no previous bar.`); return; }
      if (s === '%') {
        out.filter(h => h.step >= start - barSteps && h.step < start)
          .forEach(h => out.push(Object.assign({}, h, { step: h.step + barSteps })));
      } else {
        const last = out[out.length - 1];
        if (last && last.step + last.len === start) last.len += barSteps;
        else ctx.err(`= in ${where} needs a chord sounding right up to the bar line.`);
      }
      return;
    }
    if (s === '_') return;
    const items = [];
    for (const tok of s.split(/\s+/)) {
      const m = T_HARM.exec(tok);
      if (!m) { ctx.err(`Can't read "${tok}" in ${where}. Write chord names like Dm, G7 or C/E, optionally with a length: Dm:8 or Dm-------.`); continue; }
      const info = chordInfo(m[1]);
      if (!info) { ctx.err(`Unknown chord "${m[1]}" in ${where}.`); continue; }
      if (m[2] && m[3]) ctx.err(`"${tok}" in ${where} uses both dashes and :N. Use one of them.`);
      const sized = !!(m[2] || m[3]);
      items.push({ sym: m[1], info, len: m[3] ? Math.max(1, +m[3]) : 1 + m[2].length, sized });
    }
    if (!items.length) return;
    if (items.every(it => !it.sized)) {
      if (barSteps % items.length) {
        ctx.err(`${where[0].toUpperCase() + where.slice(1)} shares ${barSteps} steps between ${items.length} chords, which doesn't divide evenly. Give each chord a length, like Dm:${Math.floor(barSteps / items.length)}.`);
        return;
      }
      items.forEach(it => { it.len = barSteps / items.length; });
    } else if (items.some(it => !it.sized)) {
      ctx.err(`In ${where}, give every chord a length or none of them.`);
      return;
    } else {
      const used = items.reduce((a, it) => a + it.len, 0);
      if (used !== barSteps) ctx.err(`${where[0].toUpperCase() + where.slice(1)} has ${used} steps; a bar here holds ${barSteps}.`);
    }
    let pos = start;
    for (const it of items) {
      if (pos >= start + barSteps) break;
      out.push({ step: pos, len: Math.min(it.len, start + barSteps - pos), sym: it.sym, root: it.info.root, bass: it.info.bass, pcs: it.info.pcs });
      pos += it.len;
    }
  });
  return out;
}

/* ---------------------------------------------------------------- compile */
function compile(text) {
  const { song, errors, warnings } = parse(text);
  const err = (ln, msg) => errors.push({ line: ln, msg });
  const warn = (ln, msg) => warnings.push({ line: ln, msg });

  const resolved = {};
  function resolve(name, stack) {
    if (resolved[name]) return resolved[name];
    const p = song.patterns[name];
    if (!p) return null;
    let raw = {}, opts = {}, order = [], mute = new Set();
    if (p.from) {
      if (stack.includes(p.from)) { err(p.ln, `Pattern "${name}" builds on itself through "from".`); }
      else {
        const base = resolve(p.from, stack.concat(name));
        if (!base) err(p.ln, `Pattern "${name}" builds on "${p.from}", which doesn't exist.`);
        else { raw = Object.assign({}, base.raw); opts = Object.assign({}, base.opts); order = base.order.slice(); mute = new Set(base.mute); }
      }
    }
    for (const v of p.voiceOrder) { raw[v] = p.raw[v]; mute.delete(v); if (!order.includes(v)) order.push(v); }
    p.mute.forEach(v => mute.add(v));
    Object.assign(opts, p.opts);
    return (resolved[name] = { name, ln: p.ln, raw, opts, order, mute });
  }

  const compiled = {};
  function compilePattern(name) {
    if (compiled[name]) return compiled[name];
    const r = resolve(name, []);
    if (!r) return null;
    const tempo = r.opts.tempo || song.tempo;
    const beats = r.opts.beats || song.beats;
    const steps = r.opts.steps || song.steps;
    const swing = r.opts.swing != null ? r.opts.swing : song.swing;
    const key = r.opts.key || song.key;
    const barSteps = beats * steps;
    const perVoice = {};
    const barCounts = {};
    let nBars = 0;
    // report errors on the specific line that holds the bar
    const ctxFor = lines => {
      const barLine = [];
      lines.forEach(l => l.bars.forEach(() => barLine.push(l.ln)));
      return {
        pattern: name,
        key, // musicbox: for {scale} and pool=scale
        chordAt: () => null,
        err: m => {
          const bm = /bar (\d+)/i.exec(m); // musicbox: /i, so "Bar 5 of …" points at the right line too
          err(bm ? barLine[+bm[1] - 1] || lines[0].ln : lines[0].ln, m);
        }
      };
    };
    // musicbox: read the harmony line first so [*] can look chords up
    let harmony = [];
    if (r.raw[HARMONY] && !r.mute.has(HARMONY)) {
      const lines = r.raw[HARMONY];
      const bars = [].concat(...lines.map(l => l.bars));
      harmony = parseHarmonyBars(bars, barSteps, ctxFor(lines));
      barCounts[HARMONY] = { bars: bars.length, ln: lines[0].ln };
      nBars = Math.max(nBars, bars.length);
    }
    const chordAt = step => harmony.find(h => step >= h.step && step < h.step + h.len) || null;
    for (const vName of r.order) {
      if (vName === HARMONY || r.mute.has(vName)) continue;
      const voice = song.voiceMap[vName];
      const lines = r.raw[vName];
      if (!voice) { err(lines[0].ln, `"${vName}" isn't a voice. Declare it first: voice ${vName} INSTRUMENT`); continue; }
      const bars = [].concat(...lines.map(l => l.bars));
      const ctx = ctxFor(lines);
      ctx.chordAt = chordAt;
      perVoice[vName] = voice.drum ? parseDrumBars(bars, barSteps, voice, ctx) : parseMelodicBars(bars, barSteps, voice, ctx);
      if (voice.arp) perVoice[vName] = arpeggiate(perVoice[vName], voice, ctx); // musicbox
      barCounts[vName] = { bars: bars.length, ln: lines[0].ln };
      nBars = Math.max(nBars, bars.length);
    }
    if (!nBars) err(r.ln, `Pattern "${name}" has no music lines.`);
    // musicbox: a short part is usually a mistake, so say so
    for (const vName in barCounts) {
      const n = barCounts[vName].bars;
      if (n < nBars) warn(barCounts[vName].ln, `"${vName}" has ${n} bar${n === 1 ? '' : 's'} in pattern ${name}, but the pattern is ${nBars} bars long, so it's silent for the last ${nBars - n}. Fill the gap with _ bars if that's intended.`);
    }
    return (compiled[name] = {
      name, ln: r.ln, tempo, beats, steps, swing, key, barSteps, bars: Math.max(1, nBars), perVoice, harmony, barCounts
    });
  }

  const voices = song.voices;
  const vIndex = {};
  voices.forEach((v, i) => { vIndex[v.name] = i; });
  const lastMidi = {};

  function timeline(refs) {
    const events = [], sections = [];
    let t = 0;
    for (const ref of refs) {
      const p = compilePattern(ref.name);
      if (!p) { err(ref.ln, `There's no pattern called "${ref.name}".`); continue; }
      const stepDur = 60 / p.tempo / p.steps;
      const sw = (p.steps % 2 === 0) ? p.swing : 0;
      const timeOf = s => (s + (s % 2 === 1 ? sw : 0)) * stepDur;
      const total = p.bars * p.barSteps;
      for (let rep = 0; rep < ref.times; rep++) {
        const sIdx = sections.length;
        sections.push({
          name: ref.name, trans: ref.trans, start: t, dur: total * stepDur, bars: p.bars,
          barDur: p.barSteps * stepDur, tempo: p.tempo, beats: p.beats, steps: p.steps,
          // musicbox: chord changes, in seconds from the section start, for players and editors
          harmony: p.harmony.map(h => ({ t: timeOf(h.step), d: timeOf(Math.min(total, h.step + h.len)) - timeOf(h.step), sym: transposeChord(h.sym, ref.trans) }))
        });
        const evs = [];
        for (const vName in p.perVoice) {
          const voice = song.voiceMap[vName];
          const vi = vIndex[vName];
          let prev = lastMidi[vi]; // musicbox: a `~` slides from this voice's previous note, even inside the pattern
          for (const e of p.perVoice[vName]) {
            if (e.step >= total) continue;
            const t0 = timeOf(e.step);
            let d = timeOf(Math.min(total, e.step + e.len)) - t0;
            const ev = { t: t + t0, d, v: vi, vel: e.vel, s: sIdx };
            if (!voice.drum) {
              if (e.pick) ev.pick = e.pick.map(o => o.map(n => n + voice.trans + ref.trans)); // musicbox: the player picks one
              else ev.m = e.notes.map(n => n + voice.trans + ref.trans);
              ev.d = Math.max(0.02, d * voice.gate);
              if (e.glide && prev != null) ev.g = prev + 0;
              if (ev.m && ev.m.length) prev = ev.m[ev.m.length - 1];
            }
            evs.push(ev);
          }
        }
        evs.sort((a, b) => a.t - b.t || a.v - b.v);
        for (const ev of evs) { if (ev.m) lastMidi[ev.v] = ev.m[ev.m.length - 1]; events.push(ev); }
        t += total * stepDur;
      }
    }
    return { events, sections, dur: t };
  }

  // musicbox: compile every pattern, so mistakes in ones that aren't played yet still show up
  song.patternOrder.forEach(compilePattern);

  // musicbox: cues. Scores without cue lines get one cue, "main", exactly like Scrimshaw.
  if (!song.cueOrder.length) {
    song.cues.main = {
      name: 'main', play: [], ln: 1, then: null,
      loop: song.patternOrder.map(n => ({ name: n, trans: 0, times: 1, ln: song.patterns[n].ln }))
    };
    song.cueOrder.push('main');
  }
  // musicbox: a play or loop line with {B C} choices compiles each choice once; the player
  // joins one per slot each time round. `intro` and `loop` hold the first choices, for tools.
  function cueParts(items) {
    if (!items.some(it => it.choice)) return { tl: timeline(items), slots: null };
    const cache = new Map();
    const one = r => {
      const k = `${r.name}${r.trans}*${r.times}`;
      if (!cache.has(k)) cache.set(k, timeline([r]));
      return cache.get(k);
    };
    const slots = items.map(it => (it.choice || [it]).map(one));
    return { tl: assemble(slots.map(sl => sl[0])), slots };
  }
  const cues = {};
  for (const name of song.cueOrder) {
    const c = song.cues[name];
    const intro = cueParts(c.play), loop = cueParts(c.loop);
    let beds = null;
    if (c.beds) {
      beds = c.beds.sel;
      for (const b in beds) if (!song.bedMap[b]) err(c.beds.ln, `"${b}" isn't a bed. Declare it with: bed ${b} INSTRUMENT`);
    }
    cues[name] = {
      name, ln: c.ln, intro: intro.tl, loop: loop.tl, then: c.then ? c.then.name : null,
      introSlots: intro.slots, loopSlots: loop.slots, beds
    };
  }
  for (const name of song.cueOrder) {
    const c = song.cues[name], cc = cues[name];
    if (c.then && !cues[c.then.name]) err(c.then.ln, `Cue "${name}" goes on to "${c.then.name}", which isn't a cue.`);
    if (c.then && cc.loop.dur) warn(c.then.ln, `Cue "${name}" loops forever, so its "then" never happens.`);
    if (!cc.intro.dur && !cc.loop.dur && !c.play.length && !c.loop.length) {
      if (song.cueOrder.length === 1 && !song.patternOrder.length) { if (!errors.length) err(1, 'Nothing to play yet. Add a pattern and a loop line.'); }
      else err(c.ln, `Cue "${name}" has nothing to play. Give it a play or loop line.`);
    }
  }
  const defaultCue = cues.main ? 'main' : song.cueOrder[0];

  const transitions = [];
  for (const tr of song.transitions) {
    if (tr.from !== '*' && !cues[tr.from]) err(tr.ln, `"${tr.from}" isn't a cue. Declare it with: cue ${tr.from}`);
    if (tr.to !== '*' && !cues[tr.to]) err(tr.ln, `"${tr.to}" isn't a cue. Declare it with: cue ${tr.to}`);
    transitions.push({ from: tr.from, to: tr.to, at: tr.at, fade: tr.fade, ln: tr.ln, via: tr.via ? timeline([tr.via]) : null, viaName: tr.via ? tr.via.name : null });
  }

  // musicbox: patterns that nothing plays are probably forgotten
  const used = new Set();
  for (const name of song.cueOrder) for (const it of song.cues[name].play.concat(song.cues[name].loop)) for (const r of it.choice || [it]) used.add(r.name);
  for (const tr of song.transitions) if (tr.via) used.add(tr.via.name);
  for (const n of song.patternOrder) if (song.patterns[n].from) used.add(song.patterns[n].from);
  for (const n of song.patternOrder) if (!used.has(n)) warn(song.patterns[n].ln, `Pattern "${n}" is never played. Add it to a play or loop line, or use it as a via.`);

  errors.sort((a, b) => a.line - b.line);
  warnings.sort((a, b) => a.line - b.line);
  return {
    title: song.title, composer: song.composer, about: song.about, tempo: song.tempo,
    beats: song.beats, steps: song.steps, reverb: song.reverb, key: song.key,
    voices, intro: cues[defaultCue].intro, loop: cues[defaultCue].loop,
    cues, cueOrder: song.cueOrder.slice(), defaultCue, transitions, beds: song.beds,
    patterns: compiled, errors, warnings, patternCount: song.patternOrder.length
  };
}

export {
  parse, compile, noteToMidi, chordToMidis, chordInfo, parseKey, transposeChord, assemble, scaleNotes,
  MELODIC, DRUMS, BEDS, ARPS, CHORDS, MODES
};
