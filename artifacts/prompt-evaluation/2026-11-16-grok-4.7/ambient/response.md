```scrim
title    Roots in the Archive
composer musicbox
about    Sparse humidity in an underground botanical archive. Intensity 1 adds a shy flute; alert is the same dark room, listening harder.
tempo    60
beats    4
steps    2
reverb   0.48
key      D dorian

bed rain rain  vol=0.38 bright=0.7 swell=12
bed hum  drone vol=0.28 note=D2 bright=0.45 swell=18 rev=0.35

voice pad    pad      vol=0.34 pan=-0.2  center=F4 att=2 rel=4 rev=0.65
voice harp   harp     vol=0.48 pan=0.22  center=D4 arp=updown rate=2 span=2 rev=0.4
voice pluck  celesta  vol=0.36 pan=0.4   center=A5 chance=0.55 jitter=0.16 rev=0.35
voice root   fretless vol=0.46           human=0.45 rev=0.15
voice breath flute    vol=0.28 pan=-0.35 layer=1 chance=0.8 att=0.06 rel=1.4 rev=0.5 human=0.6

eq hum  lowpass=300 peak=73,-4,1.5
eq mix  highshelf=9k,+1.5
master  gain=-5 comp=-20,2.2

pattern hush
harmony | Dm7 | Dm7 | Fmaj7 | Dm9 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | D2:8 | D2:8 | F2:8 | D2:8 |
pluck   | .:8 | .:8 | .:4 {chord}:4 | {chord}?:8 |
breath  | .:8 | .:8 | C5:8 | D5:8 |

pattern fern
harmony | Dm9 | Cmaj7 | Dm7 | Gsus2 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | D2:8 | C2:8 | D2:8 | G2:8 |
pluck   | {chord}:4 .:4 | .:2 {chord}:2 .:4 | {D5 F5 A5}:4 .:4 | .:4 {G5 A5 D5}:4 |
breath  | F5:8 | E5:6 .:2 | D5:4 A4:4 | D5:8 |

pattern vault
harmony | Fmaj7 | Em7 | Am7 | Dm7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | F2:8 | E2:8 | A2:8 | D2:4 A2:4 |
pluck   | .:4 {chord}:4 | {E5 G5 B5 .}:4 .:4 | .:8 | {chord}?:4 .:4 |
breath  | C5:8 | G4:4 B4:4 | E5:8 | F5:4 D5:4 |

pattern drip
harmony | Cmaj7 | Am7 | Gsus2 | Dm7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | C2:8 | A2:8 | G2:8 | D2:8 |
pluck   | {C5 E5 G5 B5}:4 .:4 | .:4 {A5 C6 E6 .}:4 | {G5 A5 D6}:4 .:4 | .:8 |
breath  | E5:8 | C5:4 E5:4 | A4:8 | D5:8 |

pattern loam
harmony | Am7 | Fmaj7 | Em7 | Dm9 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | A2:8 | F2:4 C2:4 | E2:8 | D2:8 |
pluck   | {A5 C6 E6 G5}:8 | .:4 {F5 A5 C6}:4 | .:2 {chord}:6 | {D5 F5 A5 E5 .}:4 .:4 |
breath  | G4:8 | A4:4 C5:4 | B4:8 | F5:4 D5:4 |

pattern stir
harmony | Dm7 | Fmaj7 | Am7 | Dm7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | D2:8 | F2:8 | A2:8 | D2:4 A2:4 |
pluck   | .:4 {chord}:4 | {chord}:4 .:4 | .:8 | {chord}?:4 .:4 |
breath  | D5:8 | C5:4 A4:4 | E5:8 | D5:8 |

pattern glass
harmony | Dm9 | Em7 | Fmaj7 | Cmaj7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | D2:4 A2:4 | E2:8 | F2:4 C2:4 | C2:8 |
pluck   | {D5 F5 A5 E5}:4 .:4 | .:4 {E5 G5 B5}:4 | {F5 A5 C6 .}:4 .:4 | .:4 {C5 E5 G5 B5}:4 |
breath  | A4:4 F5:4 | G4:8 | A4:4 E5:4 | G4:4 E5:4 |

pattern lamp
harmony | Am7 | Gsus2 | Dm7 | Dm7 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | A2:8 | G2:4 D2:4 | D2:8 | A2:4 D2:4 |
pluck   | {A5 C6 E6}:4 .:4 | .:4 {G5 A5 D6}:4 | {chord}:4 .:4 | .:4 {chord}?:4 |
breath  | C5:8 | D5:4 A4:4 | F5:8 | D5:4 A4:4 |

pattern spore
harmony | Fmaj7 | Dm9 | Cmaj7 | Gsus2 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | F2:8 | D2:8 | C2:4 G2:4 | G2:8 |
pluck   | .:4 {F5 A5 C6 E6}:4 | {D5 F5 A5 .}:8 | .:4 {chord}:4 | {G5 A5 D5}:4 .:4 |
breath  | F5:4 C5:4 | E5:8 | B4:4 G4:4 | D5:8 |

pattern vein
harmony | Em7 | Fmaj7 | Am7 | Dm9 |
pad     | [*]:8 | % | % | % |
harp    | [*]:8 | % | % | % |
root    | E2:8 | F2:8 | A2:4 E2:4 | D2:8 |
pluck   | {E5 G5 B5 D6}:4 .:4 | .:4 {chord}:4 | {A5 C6 E6 G5 .}:4 .:4 | {chord}?:8 |
breath  | B4:4 G4:4 | A4:8 | E5:4 C5:4 | D5:8 |

# one bar of the home chord between cues
pattern veil
harmony | Dm7 |
pad     | [*]:8 |
harp    | [*]:8 |
root    | D2:8 |
pluck   | .:8 |
breath  | D5:8 |

cue quiet
play hush
loop fern vault {drip loam} fern vault {drip loam}

cue alert
play stir
loop glass lamp {spore vein} glass lamp {spore vein}

switch quiet -> alert at bar via veil fade 4
switch alert -> quiet at bar via veil fade 4
```

The D2 drone stays a pedal while every chord keeps D as root, fifth, sixth, or ninth, and each random set is only that bar's chord tones. Gsus2 leaves out a bright major third, and both loops leave and return on D minor so the cues meet on one tonic.