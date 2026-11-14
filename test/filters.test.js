import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biquadQ, highpassStages } from '../src/synth.js';
import { compile } from '../src/score.js';

// The magnitude of a Web Audio BiquadFilterNode, from the formulas in the Web Audio spec. A
// highpass or lowpass reads its Q in dB; peaking takes the usual Q.
function mag(type, f0, Q, f, fs = 48000) {
  const w0 = 2 * Math.PI * f0 / fs, c = Math.cos(w0), s = Math.sin(w0);
  let b, a;
  if (type === 'highpass' || type === 'lowpass') {
    const al = s / (2 * Math.pow(10, Q / 20));
    b = type === 'highpass' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
    a = [1 + al, -2 * c, 1 - al];
  } else throw new Error(type);
  const w = 2 * Math.PI * f / fs;
  const ev = k => Math.hypot(k[0] + k[1] * Math.cos(w) + k[2] * Math.cos(2 * w), k[1] * Math.sin(w) + k[2] * Math.sin(2 * w));
  return ev(b) / ev(a);
}
const dB = x => 20 * Math.log10(x);
const highpass = (hp, f) => dB(highpassStages(hp).reduce((g, st) => g * mag('highpass', st.f, biquadQ('highpass', st.q), f), 1));

test('the default high pass filter is a flat 24 dB per octave Butterworth at 32 Hz', () => {
  const hp = compile('voice a flute\npattern A\na | C5:16 |').master.highpass;
  assert.deepEqual(hp, { f: 32, slope: 24, q: 0.707 });
  assert.ok(Math.abs(highpass(hp, 32) + 3) < 0.1, '-3 dB at the cutoff');
  for (const f of [40, 50, 64, 100, 200]) assert.ok(highpass(hp, f) <= 0.01, `no boost at ${f} Hz`);
  assert.ok(highpass(hp, 64) > -0.1, 'flat an octave up');
  assert.ok(Math.abs(highpass(hp, 16) + 24) < 1, 'about -24 dB an octave down');
});

test('every slope is flat, and falls 12 dB per octave per section', () => {
  for (const slope of [12, 24, 36, 48]) {
    const hp = { f: 100, slope, q: 0.707 };
    assert.equal(highpassStages(hp).length, slope / 12);
    assert.ok(Math.abs(highpass(hp, 100) + 3) < 0.1, `${slope}: -3 dB at the cutoff`);
    assert.ok(Math.max(...[110, 150, 200, 400].map(f => highpass(hp, f))) < 0.01, `${slope}: no peak`);
    const fall = highpass(hp, 25) - highpass(hp, 12.5);
    assert.ok(Math.abs(fall - slope) < 1.5, `${slope}: falls ${fall.toFixed(1)} dB an octave`);
  }
});

test('resonance lifts the cutoff by the same amount at every slope', () => {
  for (const slope of [12, 24, 36, 48]) {
    const lift = highpass({ f: 100, slope, q: 2 }, 100) - highpass({ f: 100, slope, q: 0.707 }, 100);
    assert.ok(Math.abs(lift - dB(2 / Math.SQRT1_2)) < 0.1, `${slope}: +${lift.toFixed(1)} dB`);
  }
});

test('an eq band takes the usual Q: highpass=200 is flat above its cutoff', () => {
  const q = biquadQ('highpass', 0.707);
  assert.ok(Math.abs(dB(mag('highpass', 200, q, 200)) + 3) < 0.1);
  assert.ok(dB(mag('highpass', 200, q, 300)) <= 0.01);
  assert.equal(biquadQ('peaking', 1.4), 1.4);
});
