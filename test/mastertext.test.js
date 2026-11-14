import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/score.js';
import { formatBand, roundBand, setMixLine, setMasterLine, formatMaster, roundMaster, withoutMasteringLines } from '../editor/mastertext.js';

const base = `tempo 100
voice lead flute
voice bass fretless
eq bass peak=80,-3
pattern A
lead | C5:16 |
bass | C2:16 |
`;

test('a band written by the editor reads back as the same band', () => {
  const bands = [
    { type: 'peak', f: 81.4, gain: -6.04, q: 1.4 }, { type: 'highshelf', f: 8000, gain: 2, q: 0.707 },
    { type: 'highpass', f: 40, gain: 0, q: 0.707 }, { type: 'lowpass', f: 12345, gain: 0, q: 1.2 },
    { type: 'notch', f: 2468, gain: 0, q: 2 }, { type: 'lowshelf', f: 999.7, gain: 24, q: 0.707 }
  ];
  const { text } = setMixLine(base, bands);
  const s = compile(text);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.mixEq, bands.map(roundBand));
  assert.equal(formatBand(bands[0]), 'peak=81,-6,1.4');
  assert.equal(formatBand(bands[1]), 'highshelf=8k,+2');
  assert.equal(formatBand(bands[3]), 'lowpass=12.3k,1.2');
  assert.equal(formatBand(bands[5]), 'lowshelf=1k,+24');
});

test('setMixLine replaces the mix lines in place, keeps the first comment, and leaves other eq alone', () => {
  const text = base.replace('eq bass peak=80,-3\n', 'eq bass peak=80,-3\neq mix highshelf=8k,+2   # air\neq mix lowshelf=100,-1\n');
  const out = setMixLine(text, [{ type: 'peak', f: 300, gain: -2, q: 1 }]);
  assert.equal(out.line, 5);
  assert.match(out.text, /^eq bass peak=80,-3\neq mix peak=300,-2   # air\npattern A$/m);
  assert.equal(compile(out.text).mixEq.length, 1);
  const none = setMixLine(text, []);
  assert.doesNotMatch(none.text, /eq mix/);
  assert.match(none.text, /eq bass/);
  assert.equal(withoutMasteringLines(text), withoutMasteringLines(out.text));
});

test('setMixLine adds a line after the voices and eq lines when there is none', () => {
  const out = setMixLine(base, [{ type: 'highpass', f: 30 }]);
  assert.equal(out.line, 5);
  assert.equal(out.text.split('\n')[4], 'eq mix highpass=30');
  assert.deepEqual(compile(out.text).errors, []);
  assert.equal(setMixLine(base, []).text, base);
});

test('a master line written by the editor reads back as the same settings', () => {
  for (const m of [
    { gain: -3.04, highpass: { f: 40.4, slope: 24, q: 0.707 }, comp: { threshold: -18, ratio: 4 }, limit: null },
    { gain: 2.5, highpass: null, comp: null, limit: { threshold: -1 } },
    { gain: 0, highpass: { f: 32, slope: 48, q: 0.707 }, comp: { threshold: -15, ratio: 3.2 }, limit: { threshold: -6 } },
    { gain: 0, highpass: { f: 120, slope: 12, q: 1.234 }, comp: { threshold: -15, ratio: 3.2 }, limit: { threshold: -3 } }
  ]) {
    const s = compile(setMasterLine(base, m).text);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.master, roundMaster(m));
  }
  assert.equal(formatMaster({ gain: -3, highpass: { f: 32, slope: 24, q: 0.707 }, comp: { threshold: -18, ratio: 4 }, limit: null }), 'master gain=-3 comp=-18,4 limit=off');
  assert.equal(formatMaster({ highpass: { f: 60, slope: 24, q: 0.707 } }), 'master highpass=60');
  assert.equal(formatMaster({ highpass: { f: 32, slope: 12, q: 0.707 } }), 'master highpass=32,12');
  assert.equal(formatMaster({ highpass: { f: 80, slope: 24, q: 1.5 } }), 'master highpass=80,24,1.5');
  assert.equal(formatMaster({ highpass: null }), 'master highpass=off');
  assert.equal(formatMaster(compile(base).master), null, 'the default master needs no line');
});

test('setMasterLine replaces the master line, goes after the eq lines, and goes away at the defaults', () => {
  const out = setMasterLine(base, { gain: -2 });
  assert.equal(out.text.split('\n')[out.line - 1], 'master gain=-2');
  assert.equal(out.line, 5, 'after eq bass');
  const again = setMasterLine(out.text.replace('master gain=-2', 'master gain=-2  # quieter'), { gain: -4, limit: null });
  assert.match(again.text, /^master gain=-4 limit=off  # quieter$/m);
  assert.equal(setMasterLine(again.text, compile(base).master).text.includes('master'), false);
  assert.equal(withoutMasteringLines(again.text), withoutMasteringLines(base));
});

test('the master line explains what it cannot read', () => {
  const bad = l => compile(`master ${l}\n` + base).errors.map(e => e.msg).join(' ');
  assert.match(bad('highpass=10'), /from 20 to 1000/);
  assert.match(bad('highpass=40,18'), /12, 24, 36 or 48/);
  assert.match(bad('highpass=40,24,9'), /0.5 to 6/);
  assert.match(bad('rumble=40'), /Unknown master setting "rumble"/);
  assert.match(bad('comp=-70'), /from -60 to 0/);
  assert.deepEqual(compile('master highpass=0.1k,36dB,1\n' + base).master.highpass, { f: 100, slope: 36, q: 1 });
});
