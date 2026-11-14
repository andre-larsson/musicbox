# Composing in the musicbox score format

You are composing game music in the musicbox score format. A score is plain text that a web page plays through a Web Audio synthesizer. There are no samples: every instrument is synthesized. A game switches between the score's **cues** (explore, combat…) and turns **layers** up and down with an intensity level. The music stays in sync the whole time.

The format extends [Scrimshaw](https://tools.simonwillison.net/scrimshaw-jukebox), and any Scrimshaw score is also a musicbox score. This document is derived from Scrimshaw's composing prompt (Apache License 2.0).

The most common mistake is a bar with the wrong number of steps. Count every bar, and prefer `:N` lengths over long runs of dashes.

## How to work

- **In this repository:** write the score to `scores/<set>/<name>.scrim`, then run `npm run check -- <file>`. Fix every error, act on the warnings, and read the analysis before you call the score done. The user listens in the editor (`npm run dev`).
- **In another project:** check with `npx -y github:andre-larsson/musicbox check FILE.scrim`, then give the user a link that opens the score in the online editor, ready to play: `npx -y github:andre-larsson/musicbox link FILE.scrim`. If the user sends a link back with edits, `link --decode LINK` prints its score.
- **In a chat:** reply with one complete score in a single fenced code block, followed by no more than a couple of sentences. If error messages are pasted back, fix the lines they point to and reply with the whole corrected score.

Use only the keywords, instruments, chord names and symbols described here.

## Composing process

1. **Brief.** Settle the scene, the mood, the tempo, and the key and mode. Decide how the game will use the music: which cues it needs, what each layer adds, and how cues hand over to each other.
2. **Form.** Each cue gets a short intro that plays once, then a loop of 16 to 48 bars built from two to four patterns, so the music develops before it repeats. The end of a loop must lead back smoothly to its start.
3. **Harmony first.** Write the `harmony` line of every pattern before any notes. The bass usually plays chord roots on the strong beats.
4. **Motif.** Write a one- or two-bar idea and develop it: repeat it, sequence it, invert it, extend it. Put chord tones on strong beats and passing notes between them.
5. **Parts.** Write the bass, then the drums, then the accompaniment (`[*]` follows the harmony line), then counter-lines.
6. **Layers.** Layer 0 must sound complete by itself, because it's what plays at the lowest intensity. Each higher layer adds energy: percussion, arpeggios, countermelodies. A voice's layer applies in every cue.
7. **Variation.** Music that plays for a long time, such as ambient or exploration cues, shouldn't repeat note for note. Let the player vary it: random notes, notes that only sometimes play, and patterns picked at random (see Random parts). Add a bed (sea, wind, rain or a drone) for a continuous background.
8. **Transitions.** Write `switch` lines so that every cue change the game makes lands musically. A one-bar `via` pattern (a drum fill or a stab) helps when the tempo or mood jumps.
9. **Check and revise.** Run the checker, read the analysis, fix one pattern at a time, and listen.

## Layout

A score is read from top to bottom, one statement per line, in this order:

1. Settings for the whole song
2. `bed` lines (optional) and `voice` lines, declaring each part and its instrument
3. `pattern` blocks: a pattern line followed by its music lines
4. The arrangement: `cue`, `play`, `loop`, `then`, `beds` and `switch` lines (always last)

A `#` at the start of a word begins a comment that runs to the end of the line. `F#4` is still a note because its `#` is inside a word. Blank lines are ignored.

## Settings

```
title    The Name of the Piece
composer Your Name   # optional
about    One or two sentences. The first sentence is shown as a caption while it plays.
tempo    100         # beats per minute, 20 to 400 (default 120)
beats    4           # beats per bar, 1 to 16 (default 4)
steps    4           # steps per beat, 1 to 12 (default 4)
swing    0.12        # delays every other step, 0 to 0.75 (default 0)
reverb   0.3         # overall reverb, 0 to 1 (default 0.3)
key      D dorian    # optional; the checker uses it to point out notes outside the key
```

A step is the smallest unit of rhythm. Every bar holds exactly beats × steps steps:

- `beats 4` `steps 4`: 4/4 in sixteenth notes, 16 steps per bar
- `beats 4` `steps 2`: 4/4 in eighth notes, 8 steps per bar
- `beats 3` `steps 2`: a 3/4 waltz in eighths, 6 steps per bar
- `beats 2` `steps 3`: a 6/8 jig, 6 steps per bar (tempo counts dotted quarters)
- `beats 4` `steps 3`: a 12/8 shuffle, 12 steps per bar

Swing only works when steps is even. 0.1 to 0.15 is a light lilt; 0.33 gives a triplet shuffle.

A key is a tonic (A to G, optionally followed by `#` or `b`) and a mode: `major minor dorian phrygian lydian mixolydian locrian harmonic` (harmonic is harmonic minor). `key Am` is short for `key A minor`.

## Voices

```
voice NAME INSTRUMENT key=value key=value ...
```

Names use letters, digits and underscores, and each is declared once. Every voice used in a pattern must be declared. `harmony` is reserved for the chord line. There is no drum kit instrument: give each drum sound its own voice (one for the kick, one for the snare, one for the hat, and so on).

Voice options:

- `vol=0.8` level, 0 to 2 (default 0.8)
- `pan=-0.3` stereo position, -1 left to 1 right (default 0)
- `rev=0.4` reverb send, 0 to 1
- `oct=-1` shift by whole octaves
- `trans=3` shift by semitones
- `gate=0.5` sound each note for this fraction of its written length, 0.05 to 1 (default 1). 0.4 to 0.6 gives short, detached chords
- `center=A4` the pitch that chord names are voiced around (default D4)
- `glide=0.1` slide time in seconds for `~` notes (default 0.07)
- `bright=1.5` tone brightness, 0.1 to 4 (default 1)
- `att=0.05` attack time in seconds
- `rel=0.5` release time in seconds
- `layer=1` the lowest intensity at which this voice plays, 0 to 9 (default 0, which always plays)
- `chance=0.7` each note or hit plays only this fraction of the time, rolled again every time it comes round (default 1)
- `jitter=0.2` plays each note up to this many seconds late, at random, for a loose, unquantized feel (default 0)
- `human=0.5` how loosely the player plays (default 1). Each note lands a few milliseconds either side of the beat and a little louder or softer, and on winds, bowed strings and voices it is a few cents off. `0` plays exactly as written; `2` is twice as loose. The plain synths (`sine square saw triangle chip`) always play exactly
- `arp=up` turns every chord this voice plays (`[*]`, `[Dm]`, `C4+E4+G4`) into an arpeggio: `up`, `down`, `updown` or `random`. Single notes play as written. See Random parts.
- `rate=2` the arpeggio plays one note every this many steps (default 1)
- `span=2` the arpeggio covers this many octaves, 1 to 4 (default 1)
- `pool=scale` the arpeggio uses the key's notes from the chord's lowest note up an octave, instead of the chord's notes (default `chord`)

Melodic instruments:

- Mallets and bells: steeldrum marimba vibes celesta glock xylophone musicbox bell
- Keyboards: piano organ pipe harpsichord
- Strings: strings pizz fiddle harp guitar banjo upright
- Winds and brass: flute clarinet oboe bassoon accordion trumpet brass horn tuba
- Voices and pads: choir voices pad
- Bass and timpani: fretless synbass timpani
- Plain synths: chip sine square saw triangle

Drum instruments, one sound per voice:

- Kit: kick snare rim hat ohat ride crash clap
- Hand percussion: conga tumba bongo bongolo timbale bodhran shaker tamb clave block cowbell guiro tri
- Toms and effects: tomlo tommid tomhi gong thunder surf

A `piano` note rings until its written length ends, like a key held down, so give notes their full length (`:N`) where a pianist would hold them or use the pedal. Some of these names are short. `pipe` is a pipe organ, `pizz` is pizzicato strings, `upright` is an upright bass, and `chip` is a square-wave game console lead. `ohat` is an open hi-hat, `tamb` a tambourine, and `tri` a triangle. `thunder` is a long thunder roll and `surf` is a wave breaking on a beach; both last several seconds.

## Patterns

```
pattern NAME
harmony | chord | chord | chord | chord |
VOICE   | bar | bar | bar | bar |
VOICE   | bar | bar | bar | bar |
```

Pattern names use letters, digits and underscores, like `A`, `B2` or `intro`. A music line is a voice name followed by bars separated by `|`. There must be a `|` straight after the voice name; the closing `|` is optional. A bar can't be empty: write `_` for a silent bar.

- A voice can have several lines in one pattern; they join end to end. Keep lines to about four bars.
- Voices left out of a pattern are silent during it.
- A pattern lasts as long as its longest line, so give every voice in it the same number of bars. The checker warns when one is shorter.
- `pattern A2 from A` starts as a copy of pattern A. A voice written in A2 replaces that voice's whole part from A; the other voices, and the harmony line, carry over unchanged.
- `mute NAME` inside a pattern silences that voice (handy after `from`).
- A `tempo`, `beats`, `steps`, `swing` or `key` line inside a pattern changes only that pattern. All but `key` can also go on the pattern line: `pattern fight tempo=132 swing=0`.

## The harmony line

`harmony` is not a voice and makes no sound. It names the chord in each bar, so that `[*]` can play it and the checker can compare notes against it.

- One chord name fills the bar: `| Dm |`
- Several chords with no lengths share the bar evenly: `| Bb C |` is 8 steps each in a 16-step bar.
- Or give every chord a length: `| Dm:12 A7:4 |`. Don't mix chords with and without lengths in one bar.
- `%` repeats the previous bar's chords, `=` holds the last chord through this bar, and `_` means no chord.

Chord names are a root (A to G, optionally followed by `#` or `b`) and then one of these suffixes, or no suffix for a major triad:

m 7 m7 maj7 mmaj7 6 m6 9 m9 maj9 add9 madd9 sus2 sus4 7sus4 dim dim7 m7b5 aug 5 7b9

Examples: `C` `Am` `F#m7` `Ebmaj7` `Dsus4` `G7b9` `Bdim` `Em/G`. A slash adds a bass note.

## Melodic bars

A melodic bar is a row of tokens separated by spaces. Each token takes up a number of steps, and together they must add up to exactly beats × steps.

- **Note:** a letter A to G, an optional accidental (`#` `##` `b` `bb`), then an octave 0 to 8. `C4` is middle C, `B3` is just below it, and `A4` is 440 Hz. Examples: `D5` `F#4` `Bb3`. A note lasts one step.
- **Length:** each dash after a note adds a step (`D5---` lasts four steps). Or write the length as a number: `D5:4` also lasts four steps. Use dashes for short notes and `:N` for anything longer than about four steps; `D5:12` is much easier to count than `D5-----------`.
- **Rest:** `.` is one step of silence. `....` and `.---` are 4 steps, and `.:8` is 8.
- **Hold:** a token of dashes on its own (`-` or `---`), or `-:8`, keeps the previous note sounding for that many more steps. Use it to tie a note across a bar line.
- **Notes struck together** are joined with `+` and no spaces: `C4+E4+G4`. The length goes at the end: `C4+E4+G4---` or `C4+E4+G4:4`.
- **A chord by name** in square brackets is voiced close to the voice's `center`: `[Dm]` `[G7]` `[Bbmaj7]`. A slash adds a bass note below: `[C/E]` `[D/F#]`. Lengths work as for notes: `[Dm]---` or `[Dm]:16`.
- **The current chord:** `[*]` plays whatever the harmony line says at that step. `.:2 [*]:2 .:2 [*]:2 .:2 [*]:2 .:2 [*]:2` is an offbeat comp that follows the chords, and `%` on the following bars keeps the rhythm while the chord changes.
- **Dynamics:** `!` after a note makes it louder and `?` makes it softer. Stack them for more: `D5!!` `A2??`. They go right after the note, or after its length: `[Dm]?---`, `D5!:4` or `D5:4!`.
- **Slide:** `~` before a note glides into it from that voice's previous note: `~A2--`.
- **Random note:** notes in curly braces play one of them, picked again every time the music comes round: `{A4 C5 E5}`. A `.` inside is a choice of silence, so `{A4 C5 .}` is silent a third of the time. Repeat a note to make it more likely: `{A4 A4 C5}`. `{chord}` picks a note of the current chord and `{scale}` a note of the key, both in the octave around the voice's `center`. Lengths and dynamics go after the closing brace: `{A4 C5 E5}:4`, `{chord}?:8`.

Symbols that fill a whole bar must stand alone between the bar lines:

- `%` repeats the previous bar
- `_` is a silent bar
- `=` holds the note that was sounding at the end of the previous bar through this whole bar

## Drum bars

A voice played by a drum instrument reads one character per step:

- `x` a hit
- `X` an accented hit
- `o` a quiet ghost note
- `.` nothing

Spaces are ignored, so group the characters by beat. With 16 steps per bar: `x... ..x. x... ..x.`. With 6 steps per bar: `X.x x.x`. The whole-bar symbols `%` and `_` work in drum lines too. A drum bar still needs exactly beats × steps characters, not counting spaces.

## Arrangement: cues

```
cue explore
play intro            # patterns played once, in order
loop A A2 B*2 A2+2    # patterns that then repeat until the game switches cue

cue victory
play fanfare
then explore          # when a cue with no loop finishes, go on to this cue

switch explore -> combat at bar via hit fade 0.5
switch combat -> explore at pattern fade 2
switch * -> victory at beat
```

- `cue NAME` starts a cue. The `play`, `loop` and `then` lines below it belong to it. The first cue is the one that plays by default.
- A score without any `cue` line has a single cue called `main`, made from its `play` and `loop` lines. With no `play` or `loop` lines at all, every pattern loops in the order it was written.
- `B*2` plays a pattern twice. `A+5` or `A-2` transposes a pattern up or down by that many semitones, and its harmony line follows. Drums are not affected. Both can be combined: `A+2*2`.
- `then CUE` only applies to a cue without a `loop`. Use it for stingers and fanfares that hand back to the music underneath.
- `loop A {B C}` plays A, then B or C, picked at random every time round. Repeat a name to make it more likely (`{B C C}`); repeats and transpositions go inside the braces (`{B*2 C+2}`). `play` lines take choices too.
- `beds sea wind=0.5` inside a cue says which beds play in it, and how loud (a level multiplier, default 1). `beds none` silences them all. A cue with no `beds` line plays every bed.
- `switch FROM -> TO` tells the player how to change cue when the game asks. FROM and TO can be `*` for any cue; the most specific line wins. The options are:
  - `at now|beat|bar|pattern|loop`: where the change happens. The default is `bar`. `pattern` waits for the end of the pattern that's playing, and `loop` waits for the end of the intro or loop.
  - `via PATTERN`: a pattern played once in between, such as a fill, a stab or a pickup.
  - `fade SECONDS`: how long the old cue takes to fade after the change. The default is 0.3. Use a longer fade when held notes would clash with the new cue.
- Every pattern should be used by a cue or a `via`. The checker warns about patterns that nothing plays.

## Random parts

The score keeps every choice, and the player rolls the dice as the music plays, so every pass through a loop can differ. The game can pass a seed to repeat a performance exactly.

- **Random notes:** `{A4 C5 E5}:4` plays one of the notes; `{chord}:4` one of the current chord's notes; `{scale}:4` one of the key's. A `.` inside is a choice of silence.
- **Chance:** `chance=0.7` on a voice plays each of its notes 70% of the time. It works for drums too: `chance=0.8` on a shaker drops a hit now and then.
- **Looseness:** `jitter=0.15` plays each note up to 0.15 s late.
- **The arpeggiator:** a voice with `arp=` plays its chords one note at a time, one note every `rate` steps. `[*]:16 | % | % | %` with `arp=updown rate=2` arpeggiates the harmony line for four bars, following its chord changes. `arp=random` picks a random chord note each time. With `pool=scale` it picks from the key instead.
- **Pattern choices:** `loop A {B C}` picks B or C each time round.

```
voice pluck celesta center=A5 chance=0.7 jitter=0.2
voice harp  harp    center=E4 arp=updown rate=2 span=2

pattern A
harmony | Am | F | C | G |
harp    | [*]:16 | % | % | % |
pluck   | {chord}:4 .:4 {A5 C6 D6 E6 .}:8 | % | % | % |
```

The checker tests every choice against the harmony line. It lists random notes that rub against the chord: a semitone above a chord note (C over a G chord's B), or a minor third against a major chord's third (G over E major). Other notes outside the chord, such as 6ths, 7ths, 9ths and 11ths, are colour and aren't listed. Keep each set to notes that suit every chord it plays over, or split it: write a different set for the bars where the chord changes character. `{chord}` and arpeggios without `pool=scale` always fit.

## Beds

A bed is a continuous sound under the music: the sea, wind, rain or a drone. It isn't written in bars. It starts when the music starts, keeps going across cue switches (only its level changes), and fades out when the music stops.

```
bed NAME INSTRUMENT key=value ...
```

- Instruments: `sea` (slow swells of low surf), `wind` (a breathy, wandering whistle), `rain` (a steady hiss with a low body) and `drone` (a held low note, which needs `note=`).
- Options: `vol=` (default 0.8, which sits under the music), `pan=`, `rev=`, `layer=` (as for voices), `bright=` (0.1 to 4), `swell=` (seconds per slow rise and fall), and `note=D2` for a drone.
- Bed names share the voice names' rules, and a bed can't have the same name as a voice.
- A cue's `beds` line chooses its beds; without one, a cue plays every bed. Bed levels change over the switch's fade, and over at least one second.

## Count every bar before you finish

A note or chord counts 1 plus its dashes, or its `:N`. A rest counts its dots plus its dashes, or its `:N`. A lone hold counts its dashes, or its `:N`. A drum bar counts its characters, ignoring spaces. Worked examples at 16 steps per bar:

```
E5-- G5-- B5- A5 G5 F#5 E5 D5---       3+3+2+1+1+1+1+4 = 16
E5:6 C5:2 A4:8                         6+2+8 = 16
.:2 [*]:2 .:2 [*]:2 .:2 [*]:2 .:2 [*]:2   8 × 2 = 16
A5:8 .:4 D5 E5 F#5! G5!                8+4+1+1+1+1 = 16
{A4 C5 E5}:4 .:4 {chord}:8             4+4+8 = 16 (a set of notes counts once)
x... .... x... x.x.                    16 characters
```

## Example score

```scrim
title    Lantern Market
composer musicbox
about    A night market in the rain. Intensity 1 adds shaker and congas; a fight brings war drums and brass.
tempo    104
beats    4
steps    4        # 16 steps per bar
swing    0.1
key      A minor

voice lead   clarinet vol=0.9  pan=-0.15
voice keys   vibes    vol=0.6  pan=0.25 center=E4 gate=0.6
voice bass   upright  vol=0.9
voice hat    shaker   vol=0.35 pan=0.4  layer=1
voice conga  conga    vol=0.5  pan=-0.3 layer=1
voice drum   tomlo    vol=0.8
voice brass  brass    vol=0.6  center=G4

pattern A
harmony | Am | F | C | E7 |
lead    | E5:6 C5:2 A4:8 | F5:6 E5:2 C5:8 | G5:4 E5:4 C5:4 E5:4 | G#4:12 .:4 |
keys    | .:2 [*]:2 .:2 [*]:2 .:2 [*]:2 .:2 [*]:2 | % | % | % |
bass    | A2:6 E2:2 A2:8 | F2:6 C3:2 F2:8 | C3:6 G2:2 C3:8 | E2:6 B1:2 E2:4 G#2:4 |
hat     | x.o. x.ox x.o. x.oo | % | % | % |
conga   | ..x. .o.x ..x. .o.. | % | % | % |

pattern fight tempo=132 swing=0
harmony | Am | Am | F | E7 |
bass    | A1- A1- A1- A1- A2- A1- A1- A1- | % | F1- F1- F1- F1- F2- F1- F1- F1- | E1- E1- E1- E1- E2- E1- G#1- B1- |
brass   | [*]!:2 .:6 [*]:2 .:2 [*]:4 | % | % | [*]!:2 .:2 [*]:2 .:2 [*]!:8 |
drum    | X... x.x. X... x.xx | % | % | X.x. X.x. XxXx XXXX |

# one bar between exploring and fighting
pattern hit tempo=132 swing=0
harmony | E7 |
drum    | x.x. x.x. xxxx XXXX |
brass   | .:12 [*]!!:4 |

cue explore
loop A

cue combat
loop fight

switch explore -> combat at bar via hit
switch combat -> explore at pattern fade 2
```

An ambient example, with beds, an arpeggio, random notes and a random second half of the loop:

```scrim
title  Tidepool
about  Ambient music for a quiet shore. The plucks and the second half of the loop change every time round.
tempo  60
beats  4
steps  2         # 8 steps per bar
key    D dorian

bed   sea   sea    vol=0.7
bed   hum   drone  vol=0.5 note=D2

voice pad    pad      vol=0.4 center=F4 att=2 rel=3
voice harp   harp     vol=0.6 center=D4 arp=updown span=2
voice pluck  celesta  vol=0.5 center=A5 chance=0.6 jitter=0.15
voice bass   fretless vol=0.6

pattern A
harmony | Dm7 | G | Dm7 | Cmaj7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
pluck   | {chord}:4 {D5 E5 A5 .}:4 | % | % | % |
bass    | D2:8 | G1:8 | D2:8 | C2:8 |

pattern B from A
harmony | Fmaj7 | Em7 | Dm7 | Dm7 |
bass    | F2:8 | E2:8 | D2:8 | = |

pattern C from A
harmony | Cmaj7 | G | Am7 | Dm7 |
bass    | C2:8 | G1:8 | A1:8 | D2:8 |

cue shore
loop A {B C}
```

Longer examples are in `scores/demo/`: `tide-caves.scrim` (three cues, three layers and a victory fanfare), `night-ferry.scrim` (every random part, and beds that change between cues) and `brinelight.scrim` (a generative pad-and-pluck score over the sea).

## Composing tips

- Typical ranges: bass in octaves 1 and 2, chords and pads centred in octave 4 (`center=E4` or `center=G4`), and melodies in octaves 4 to 6. The checker flags notes outside each instrument's usual range.
- Balance levels with `vol`: pads and percussion around 0.3 to 0.7, the lead around 0.9 to 1.1.
- Use `pattern X2 from X` to vary a section with a counter-melody or a different drum part without rewriting it.
- Use `%` for repeated bars, especially in drum parts and `[*]` accompaniment, to keep the score short.
- Keep tempos related between cues that switch `at bar`, or put a `via` pattern in between, so the change doesn't lurch.
- The checker lists strong-beat notes that aren't in the chord. Suspensions and appoggiaturas are fine; anything you didn't mean is a wrong note.
- For ambient music: a slow tempo, long attacks and releases on pads (`att=1.5 rel=3`), a bed, and only a few notes per bar with `chance=` 0.5 to 0.8 and a little `jitter`. Leave space; silence is part of it.
- `{scale}` and `pool=scale` pick notes outside the chord. They suit major 7th, minor 7th and sus chords, and rub against dominant 7th and diminished chords. Use `{chord}` over those, and read the checker's list of rubs.

Compose the piece described below. If none is described, compose an original piece in a style of your choice.
