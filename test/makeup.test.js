import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, masterDefaults } from '../src/score.js';
import { createSynth } from '../src/synth.js';
import { formatMaster, roundMaster, setMasterLine } from '../editor/mastertext.js';
import { analyze } from '../src/analyze.js';

const score = 'voice a flute\npattern A\na | C5:16 |\nloop A\n';

test('limiter make-up gain round-trips through the score and defaults to unity', () => {
  assert.equal(masterDefaults().limit.makeup, 0);
  assert.deepEqual(compile('master limit=-6\n' + score).master.limit, { threshold: -6, makeup: 0 });
  for (const makeup of [-24, -1.5, 0, 2.5, 24]) {
    const m = { limit: { threshold: -6, makeup } };
    const compiled = compile(setMasterLine(score, m).text);
    assert.deepEqual(compiled.errors, []);
    assert.deepEqual(compiled.master, roundMaster(m));
  }
  assert.equal(formatMaster({ limit: { threshold: -3, makeup: 2 } }), 'master limit=-3,+2');
  assert.match(analyze(compile('master limit=-3,+2\n' + score)).text, /make-up \+2 dB/);
  for (const value of ['-3,25', '-3,nope', '-3,2,4', '-3,']) assert.ok(compile('master limit=' + value + '\n' + score).errors.length, value);
});

// A graph and AudioParam boundary fake checks node order and smoothed dB-to-gain changes.
function audioContext() {
  const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connections: [], connect(target) { this.connections.push(target); return target; }, disconnect() { this.connections = []; } });
  const withParams = names => Object.assign(node(), Object.fromEntries(names.map(name => [name, parameter()])));
  return {
    currentTime: 0, sampleRate: 1000,
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createGain: () => withParams(['gain']),
    createBiquadFilter: () => withParams(['frequency', 'Q', 'gain']),
    createDynamicsCompressor: () => withParams(['threshold', 'knee', 'ratio', 'attack', 'release']),
    createAnalyser: node, createConvolver: node
  };
}

test('make-up gain sits after the limiter, before volume and metering, and bypasses at unity', () => {
  const synth = createSynth(audioContext(), {});
  assert.ok(synth.limiter.connections.includes(synth.limitMakeup));
  assert.ok(synth.limitMakeup.connections.includes(synth.out));
  assert.equal(synth.limitMakeup.gain.value, 1);
  synth.setMaster({ limit: { threshold: -6, makeup: 6 } });
  assert.equal(synth.limiter.threshold.value, -6);
  assert.ok(Math.abs(synth.limitMakeup.gain.value - Math.pow(10, 6 / 20)) < 1e-12);
  synth.setMaster({ limit: null });
  assert.equal(synth.limitMakeup.gain.value, 1);
  assert.equal(synth.limiter.ratio.value, 1);
  synth.setMaster({ limit: { threshold: -3 } });
  assert.equal(synth.limitMakeup.gain.value, 1, 'old settings without make-up remain at unity');
});
