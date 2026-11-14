# musicbox

Adaptive game music for the browser, written as plain text. Scores use a compact format that a language model can write and check. They play through a Web Audio synthesizer, with no samples and no build step. A game switches between **cues** on musical boundaries and fades **layers** in and out with an intensity level. For ambient and long-running music, a score can leave parts to chance (random notes, arpeggios, patterns picked each time round) and lay continuous **beds** (sea, wind, rain, a drone) underneath.

**Try it: [a403.space/musicbox](https://a403.space/musicbox/)**, the editor with the demo scores.

musicbox is a fork of [Scrimshaw](https://tools.simonwillison.net/scrimshaw-jukebox) by Simon Willison. Every Scrimshaw score plays unchanged; see [NOTICE](NOTICE).

## Quick start

Requires Node 18 or later. There are no dependencies to install.

```sh
npm run dev                                   # editor at http://127.0.0.1:5178/editor/
npm run check -- scores/demo/tide-caves.scrim # errors, warnings and an analysis report
npm test
npm run build                                 # the static site, in dist/
npm run preview                               # build, then serve dist/ the way GitHub Pages does
```

Pushing to `main` runs the tests, builds the site and deploys it to GitHub Pages (`.github/workflows/pages.yml`).

The editor plays any score in `scores/`. It has a button for each cue, a slider for intensity, and mute and solo for each voice and bed (voices that can't be heard in the cue or at the intensity playing are dimmed), and it reloads the music when a `.scrim` file is saved. That makes it the listening side of the loop when an agent is writing the score. The status line shows the seed of the current performance.

Demos in `scores/demo/`: `tide-caves` (cues, layers, a fill and a fanfare), `night-ferry` (every random part, and beds that change between cues) and `brinelight` (a port of the generative pad-and-pluck score from the browser game [Brinelight](https://andre-larsson.github.io/brinelight/)).

## In a game

```js
import { MusicPlayer } from './musicbox/src/player.js';

const music = new MusicPlayer();
music.load(await (await fetch('music/tide-caves.scrim')).text()); // throws if the score has errors

// Browsers keep audio locked until the player clicks or presses a key.
addEventListener('pointerdown', () => {
  music.unlock();
  if (!music.state.playing) music.play('explore');
}, { once: true });

// Drive it from game state. Both calls do nothing when the value hasn't changed.
function update(game) {
  music.goto(game.inCombat ? 'combat' : 'explore'); // switches as the score's switch lines say
  music.setIntensity(game.danger);                  // 0, 1, 2…: fades layers in and out
}

music.on('cue', ({ cue }) => console.log('now playing', cue));
```

| Method | What it does |
|---|---|
| `load(text)` | Compiles a score. Throws an error with `.errors` (line and message) if it doesn't compile. |
| `unlock()` | Creates and resumes the AudioContext. Call it from a user gesture. |
| `play(cue?, {intensity, seed}?)` | Starts a cue from its beginning. Without a name, starts the score's first cue. The same `seed` gives the same random choices; without one, every play differs. |
| `goto(cue, {at, fade, via, restart}?)` | Switches cue on the next `now`/`beat`/`bar`/`pattern`/`loop` boundary. The defaults come from the score's `switch` lines. Does nothing if that cue is already playing. |
| `setIntensity(n, {fade, at}?)` | Voices with `layer <= n` play. Fades over `fade` seconds (1 by default). |
| `mute(name, on)`, `setVolume(v)`, `stop(fade)`, `close()` | What their names say. `mute` takes a voice or a bed. |
| `state` | The cue, part, pattern, bar, beat and chord that are audible now, plus the target cue, the intensity and the seed. |
| `on('cue' \| 'pattern' \| 'end', fn)` | Fires when that moment becomes audible, accurate to about 25 ms. Returns a function that unsubscribes. |

To share one AudioContext with your game's sound effects, pass `new MusicPlayer({ context, destination })`.

## The format

A score is settings, voices, patterns of bars, and an arrangement. Each bar has a fixed number of steps, and the checker counts them for you:

```scrim
title  Small Loop
tempo  100
key    D minor
voice lead  flute
voice pad   strings  center=E4 vol=0.4
voice bass  fretless
voice kick  kick  layer=1

pattern A
harmony | Dm | Bb | C | A7 |
lead    | D5:4 F5:4 A5:8 | Bb5:6 A5:2 F5:8 | G5:4 E5:4 C5:8 | C#5:12 .:4 |
pad     | [*]?:16 | % | % | % |
bass    | D2:8 A1:8 | Bb1:8 F2:8 | C2:8 G2:8 | A1:8 E2:8 |
kick    | x... ..x. x... .... | % | % | x... x... x.x. xxxx |

cue main
loop A
```

What musicbox adds to Scrimshaw:

- **`:N` lengths.** `D5:12` instead of `D5-----------`. A language model counts a number much more reliably than a run of characters.
- **A harmony line, and `[*]`.** Name the chords once per pattern; `[*]` plays the current chord, and the checker compares notes against it.
- **`key`.** Settable per song and per pattern; the checker uses it to find notes outside the scale.
- **Cues, `then`, and `switch` lines.** Several pieces of music in one score, with musical transitions between them (at a beat, bar, pattern or loop end, optionally via a fill pattern, with a fade). `switch * -> *` sets a default for every change.
- **`layer=N` on voices.** Vertical layering for intensity.
- **Random parts.** `{A4 C5 E5}` plays one of the notes, `{chord}` and `{scale}` pick from the harmony or the key, `chance=0.7` and `jitter=0.2` on a voice make it sparse and loose, and `loop A {B C}` picks a pattern each time round. The player rolls the dice as it plays; a seed repeats a performance.
- **An arpeggiator.** `arp=up|down|updown|random` with `rate=`, `span=` and `pool=chord|scale` turns `[*]` into an arpeggio that follows the harmony line.
- **Beds.** `bed sea sea`, `bed hum drone note=D2`: continuous sounds that keep going across cue switches. A cue's `beds` line sets which play and how loud.
- **Instruments that play like people.** Notes land a few milliseconds off the beat and vary a little in loudness, louder notes are brighter, winds, bowed strings and voices find each note from a little below and drift a few cents, and no two notes have the same vibrato. The violin, flute, clarinet, horn, brass, string section and choir are rebuilt around this (a violin body, breath and bow noise, sections of separate players). `human=` on a voice sets how loose; `human=0` plays exactly as written.
- **More checks.** Warnings for parts shorter than their pattern and for patterns nothing plays. Errors in unplayed patterns still show up. Errors point at the line that holds the bad bar. Random note sets are checked against the chord, and the ones that rub are listed.

[docs/PROMPT.md](docs/PROMPT.md) is the full reference. It's written so that you can paste it into any LLM to compose scores.

## Composing with an agent

1. Give the agent a brief: the scene, mood, cues, what each intensity level should add, and how cues hand over.
2. The agent follows [docs/PROMPT.md](docs/PROMPT.md), writes `scores/…/name.scrim`, and runs `npm run check` until there are no errors. Then it reads the analysis: ranges, strong-beat notes outside the chord, notes outside the key.
3. The agent gives you a listen link (`musicbox link FILE.scrim`). It opens the score in the editor, ready to play. You try the cues and intensity levels and give notes in musical terms ("bar 5 of B stalls", "combat needs more low end"). The agent revises one pattern at a time.

## Listen links

A listen link carries a whole score in its hash (`#score=…`), compressed. Nothing is uploaded; the page decodes it in the browser. Agents in any project can use the checker and the links without installing anything:

```sh
npx -y github:andre-larsson/musicbox check music/theme.scrim
npx -y github:andre-larsson/musicbox link music/theme.scrim         # prints https://a403.space/musicbox/editor/#score=…
npx -y github:andre-larsson/musicbox link --decode 'https://…'     # the score inside a link
```

In the editor, **Copy link** makes a link to the score as it stands, including your edits, so you can send changes back to the agent.

## Layout

```
src/score.js     parser and compiler: text → timelines of note events (no audio; runs in Node)
src/synth.js     Web Audio instruments and effects
src/player.js    runtime player: scheduling, cues, transitions, layers, beds, events
src/random.js    seeded dice: random notes, chance, jitter, pattern choices
src/analyze.js   text report used by the checker and the editor
bin/musicbox.js  `musicbox check` and `musicbox link`
bin/serve.js     dev server with live reload; --static serves a build
bin/build.js     builds the static site into dist/
src/link.js      listen links: a score inside a URL
editor/          the editor page
scores/          demo/ (musicbox features) and scrimshaw/ (the upstream examples, used as regression fixtures)
docs/PROMPT.md   format reference and composing guide
```

## License

Apache License 2.0. musicbox is derived from Scrimshaw, which uses the same license; [NOTICE](NOTICE) lists the derived files.
