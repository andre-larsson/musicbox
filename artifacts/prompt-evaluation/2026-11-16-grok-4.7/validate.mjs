import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { compile } from '../../../src/score.js';
import { analyze } from '../../../src/analyze.js';
import { MusicPlayer } from '../../../src/player.js';
const run = resolve(process.argv[2]);
const names = ['waltz', 'adaptive', 'ambient'];
const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; } });
function exercise(song) {
  const runs = [];
  const layers = Math.max(0, ...song.voices.map(v => v.layer || 0), ...song.beds.map(b => b.layer || 0));
  for (const cue of song.cueOrder) for (let intensity = 0; intensity <= layers; intensity++) {
    const ctx = { currentTime: 0, state: 'running' };
    let events = 0;
    const synth = { out: { gain: param() }, warm() {}, session() { return {
      bus: { gain: param(), disconnect() {} }, sendBus: { gain: param(), disconnect() {} },
      ch: song.voices.map(v => ({ v, def: { level: 1 }, input: { gain: param() } })), play() { events++; }, stop() {}
    }; }, bed() { return { input: { gain: param() }, level: 1, stop() {} }; } };
    const player = new MusicPlayer({ context: ctx, synth, autoTick: false });
    player.load(song); player.play(cue, { intensity, seed: 42 });
    for (let t = 0; t < 30; t += 0.025) { ctx.currentTime = t; player.tick(); }
    runs.push({ cue, intensity, scheduled_events: events, final_cue: player.state.cue });
    player.stop();
  }
  return runs;
}
const summary = [];
for (const name of names) {
  const dir = join(run, name), file = join(dir, 'song.scrim');
  if (!existsSync(file)) { summary.push({ name, available: false }); continue; }
  const text = readFileSync(file, 'utf8'), song = compile(text), analysis = analyze(song, { limit: 10000 });
  writeFileSync(join(dir, 'analysis.txt'), analysis.text + '\n');
  const bars = Object.fromEntries(song.cueOrder.map(c => [c, song.cues[c].loop.sections.reduce((n,s) => n+s.bars,0)]));
  const layerSet = [...new Set([0, ...song.voices.map(v=>v.layer||0), ...song.beds.map(b=>b.layer||0)])].sort();
  const choices = song.cueOrder.some(c => [...(song.cues[c].loopSlots || []), ...(song.cues[c].introSlots || [])].some(slot => slot.length > 1));
  const timelines = Object.values(song.cues).flatMap(c => [c.intro, c.loop, ...(c.introSlots || []).flat(), ...(c.loopSlots || []).flat()]);
  const picks = timelines.some(timeline => timeline.events.some(event => event.pick));
  const checks = {
    no_errors: song.errors.length === 0, no_warnings: song.warnings.length === 0,
    no_range_findings: analysis.findings.range.length === 0, no_random_clashes: analysis.findings.pick.length === 0,
    loops_at_least_16_bars: Object.entries(bars).filter(([c])=>c!=='victory').every(([,n])=>n>=16)
  };
  if (name === 'waltz') Object.assign(checks, { requested_meter: song.beats===3&&song.steps===2, requested_key: song.key?.name==='C major', requested_tempo: song.tempo===84, requested_instruments: ['piano','clarinet','upright'].every(inst=>song.voices.some(v=>v.inst===inst)), no_layers_or_beds: layerSet.length===1&&song.beds.length===0, requested_cues: song.cueOrder.join(',')==='main' });
  if (name === 'adaptive') Object.assign(checks, { requested_cues: song.cueOrder.join(',')==='explore,combat,victory', layers_0_1_2: layerSet.join(',')==='0,1,2', bed_present: song.beds.some(b=>['sea','wind'].includes(b.inst)), victory_returns: song.cues.victory?.then==='explore', transition_fill: song.transitions.some(t=>t.from==='explore'&&t.to==='combat'&&t.via), limiter_makeup: song.master.limit?.makeup===1 });
  if (name === 'ambient') Object.assign(checks, { requested_cues: song.cueOrder.join(',')==='quiet,alert', requested_key: song.key?.name==='D dorian', random_pattern_choices: choices, layer_1: layerSet.includes(1), random_notes: picks, harp_arpeggiator: song.voices.some(v=>v.inst==='harp'&&v.arp), beds: song.beds.some(b=>b.inst==='rain')&&song.beds.some(b=>b.inst==='drone') });
  let runtime = [], runtimeError = null;
  if (!song.errors.length) try { runtime = exercise(song); } catch (error) { runtimeError = String(error.stack); }
  checks.runtime = runtime.length > 0 && !runtimeError && runtime.every(r=>r.scheduled_events>0);
  const report = { name, title:song.title, checks, errors:song.errors, warnings:song.warnings, loops:bars, layers:layerSet, findings:analysis.findings, runtime, runtimeError };
  writeFileSync(join(dir, 'validation.json'), JSON.stringify(report, null, 2));
  summary.push({ name, title:song.title, checks, harmony_findings:analysis.findings.harmony.length, key_findings:analysis.findings.key.length });
}
writeFileSync(join(run, 'validation-summary.json'), JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
