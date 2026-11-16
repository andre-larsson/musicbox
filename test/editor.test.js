import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEffectTabs } from '../editor/effects.js';
import { createFormatGuide } from '../editor/guide.js';
import { compile } from '../src/score.js';

const html = readFileSync(new URL('../editor/index.html', import.meta.url), 'utf8');
const instructions = readFileSync(new URL('../docs/PROMPT.md', import.meta.url), 'utf8');

// Small DOM boundary fakes: exercise the real event handlers and the actual HTML tab wiring.
class Element {
  constructor(attrs = {}) { this.attrs = attrs; this.events = {}; this.value = ''; this.textContent = ''; }
  getAttribute(name) { return this.attrs[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function effectFixture() {
  const tabs = [...html.matchAll(/<button ([^>]*role="tab"[^>]*)>/g)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const tab = new Element(attrs);
    tab.dataset = { stage: attrs['data-stage'] };
    return tab;
  });
  const panels = Object.fromEntries(tabs.map(tab => ['#' + tab.getAttribute('aria-controls'), new Element()]));
  const root = {
    querySelectorAll: () => tabs,
    querySelector: selector => panels[selector] || new Element()
  };
  return { tabs, panels, effects: createEffectTabs(root) };
}

test('effect tabs show one panel, keep its controls, and support keyboard navigation', () => {
  const { tabs, panels, effects } = effectFixture();
  assert.equal(tabs.length, 5);
  const selected = () => tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.stage);
  const visible = () => Object.entries(panels).filter(([, panel]) => !panel.hidden).map(([id]) => id);
  assert.deepEqual(selected(), ['eq']);
  assert.deepEqual(visible(), ['#stEq']);
  panels['#stHighpass'].value = 'saved cutoff';
  tabs[1].events.click();
  assert.deepEqual(visible(), ['#stHighpass']);
  let prevented = false;
  tabs[1].events.keydown({ key: 'End', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(selected(), ['limit']);
  assert.ok(tabs[4].focused);
  tabs[4].events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.deepEqual(selected(), ['gain']);
  tabs[0].events.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.deepEqual(selected(), ['limit']);
  tabs[4].events.keydown({ key: 'Home', preventDefault() {} });
  assert.deepEqual(selected(), ['gain']);
  effects.select('highpass');
  assert.equal(panels['#stHighpass'].value, 'saved cutoff');
  assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
});

function guideFixture(t, clipboard) {
  const parts = Object.fromEntries(['copyAgent', 'agentMarkdown', 'agentCopyStatus', 'closeFormat', 'agentInstructions', 'body'].map(id => [id, new Element()]));
  const dialog = new Element();
  dialog.querySelector = selector => parts[selector === '.formatBody' ? 'body' : selector.slice(1)];
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.events.close(); };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
    dialog.close();
  });
  const button = new Element();
  createFormatGuide(button, dialog);
  return { parts, dialog, button };
}

test('Format opens in-page and Copy for AI copies the entire Markdown source', async t => {
  let copied = '';
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '../docs/PROMPT.md', 'works under the Pages project path');
    return new Response(instructions);
  });
  const { parts, dialog, button } = guideFixture(t, { async writeText(text) { copied = text; } });
  await button.onclick();
  assert.ok(dialog.open);
  assert.equal(parts.copyAgent.disabled, false);
  assert.equal(parts.agentMarkdown.value, instructions);
  await parts.copyAgent.onclick();
  assert.equal(copied, instructions);
  assert.equal(parts.copyAgent.textContent, 'Copied');
  parts.closeFormat.onclick();
  assert.equal(dialog.open, false);
  assert.equal(parts.copyAgent.textContent, 'Copy for AI');
});

test('clipboard denial exposes and selects the full Markdown for manual copying', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(instructions));
  const { parts, button } = guideFixture(t, { async writeText() { throw new Error('denied'); } });
  await button.onclick();
  await parts.copyAgent.onclick();
  assert.ok(parts.agentInstructions.open);
  assert.ok(parts.agentMarkdown.selected);
  assert.equal(parts.agentMarkdown.value, instructions);
  assert.match(parts.agentCopyStatus.textContent, /Copy the selected Markdown/);
});

test('a failed guide fetch disables copying and retries when Format is reopened', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('', { status: 503 }) : new Response(instructions));
  const { parts, dialog, button } = guideFixture(t, {});
  await button.onclick();
  assert.ok(parts.copyAgent.disabled);
  assert.match(parts.agentCopyStatus.textContent, /Could not load/);
  dialog.close();
  await button.onclick();
  assert.equal(calls, 2);
  assert.equal(parts.copyAgent.disabled, false);
});

test('the guide example compiles, ids are unique, and Scrimshaw is credited only in the footer', () => {
  const example = /<code id="guideExample">([\s\S]*?)<\/code>/.exec(html)[1];
  const score = compile(example);
  assert.deepEqual(score.errors, []);
  assert.deepEqual(score.warnings, []);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(html.slice(html.indexOf('<header>'), html.indexOf('</header>')), /scrimshaw|github[^"\s]*PROMPT/i);
  assert.match(html, /<footer>[^\n]*scrimshaw-jukebox#guide/);
});
