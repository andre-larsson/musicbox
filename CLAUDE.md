# musicbox

A text score format and a Web Audio player for adaptive browser game music, forked from Scrimshaw (see NOTICE). Plain ES modules, no dependencies, no build step. Node 18+ for the CLI and tests.

## Commands

- `npm run check -- <file.scrim>`: compiles a score and prints errors and warnings with line numbers, then an analysis. Run it after every edit to a score.
- `npm test`: node:test suite. It covers format compatibility, the extensions, the analyzer, the player's scheduling (with a fake AudioContext), and the scores in the docs.
- `npm run dev`: editor at http://127.0.0.1:5178/editor/. It reloads a score when its file is saved.
- `npm run build` / `npm run preview`: the static site in `dist/`, and a local server for it. Pushing to `main` deploys it to https://a403.space/musicbox/ through `.github/workflows/pages.yml`. After a push, check the Actions run and the live page.
- The editor must work from a sub-path with no dev server, so keep its URLs relative. On Pages it reads `scores/index.json`, which the build writes.

## Composing a score

Read `docs/PROMPT.md` first. It is the format reference and the composing process.

1. Agree the brief with the user: the scene, mood, tempo, key, the cues the game needs, what each intensity layer adds, and how cues hand over.
2. Write `scores/<set>/<name>.scrim`. Plan the harmony lines before the notes, and use `:N` for any note longer than about four steps. For ambient or long-running cues, use the random parts (`{…}`, `chance=`, `jitter=`, `arp=`, `loop A {B C}`) and beds so the music doesn't repeat note for note.
3. Run `npm run check -- <file>` until there are no errors and no warnings you didn't intend. Read the analysis. It lists out-of-range notes, strong-beat notes outside the chord, random choices that rub against the chord, and notes outside both the key and the chord. Fix the ones that aren't deliberate.
4. Ask the user to listen in the editor and to try every cue and intensity level. Revise one pattern at a time from their notes. Don't regenerate the whole score.

`scores/scrimshaw/` holds the upstream examples. They are regression fixtures, so don't edit them.

## Code

- `src/score.js`: parser and compiler. It's derived from upstream, so mark changes with `musicbox:`. Any Scrimshaw score must compile to exactly the same events; `test/score.test.js` checks hashes of the upstream output.
- `src/synth.js`: instruments (`INST`, `DRUM`) and `createSynth().session(song)`. A session is one bus with per-voice gain, pan and reverb send.
- `src/player.js`: `MusicPlayer`. Notes are queued a lookahead ahead (0.3 s). A cue switch happens at the first boundary after everything already queued, so nothing needs cancelling. Each switch opens a new session, so the old cue can fade on its own bus. Layers are per-voice gains. Beds belong to the player, not to a session, so they carry on across switches; `syncBeds` replaces only beds whose definition changed.
- `src/random.js`: randomness is resolved at play time, never in the compiler. Compiled events keep every choice (`pick`), and cues with `{B C}` keep `loopSlots`/`introSlots`; `realize` and `pass` roll them with a seeded generator. `cue.intro`/`cue.loop` hold the first choices, for tools that need one timeline. The arpeggiator is the exception: it's expanded in the compiler (`arpeggiate`), and `arp=random` becomes `pick` events.
- `src/analyze.js`: the report used by the CLI and the editor. Random sets are checked with `rubs()`: a semitone above a chord note, or a minor third against a major third. Other non-chord notes count as colour.
- Every `scrim` code block in `README.md` and `docs/PROMPT.md` must compile cleanly (`test/docs.test.js`).
