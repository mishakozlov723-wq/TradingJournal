'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMiniShortcut, ACCELERATOR } = require('../mini-shortcut');

function setup(result = true) {
  let callback, tick = 0, toggles = 0, warnings = 0;
  const registered = [], unregistered = [];
  const shortcut = createMiniShortcut({
    globalShortcut: {
      register(key, cb) { registered.push(key); callback = cb; return result; },
      unregister(key) { unregistered.push(key); },
    },
    now: () => tick,
    onToggle: () => toggles++,
    onUnavailable: () => warnings++,
  });
  return { shortcut, registered, unregistered, fire: () => callback(),
    advance: ms => { tick += ms; }, toggles: () => toggles, warnings: () => warnings };
}

test('registers the Windows OEM_3 accelerator, not a Cyrillic character', () => {
  const s = setup();
  assert.equal(s.shortcut.register(), true);
  assert.equal(ACCELERATOR, 'Control+Shift+`');
  assert.deepEqual(s.registered, [ACCELERATOR]);
});
test('one callback toggles; repeat events during the transition are suppressed', () => {
  const s = setup(); s.shortcut.register();
  s.fire(); s.fire(); s.advance(399); s.fire();
  assert.equal(s.toggles(), 1);
  s.advance(1); s.fire();
  assert.equal(s.toggles(), 2);
});
test('registration is idempotent and only its own shortcut is unregistered', () => {
  const s = setup(); s.shortcut.register(); s.shortcut.register();
  assert.equal(s.registered.length, 1);
  s.shortcut.dispose(); s.shortcut.dispose();
  assert.deepEqual(s.unregistered, [ACCELERATOR]);
  s.fire(); assert.equal(s.toggles(), 0);
  assert.equal(s.shortcut.register(), false);
});
test('occupied global shortcut warns and allows a physical-key focused fallback', () => {
  const s = setup(false); let prevented = 0;
  assert.equal(s.shortcut.register(), false);
  assert.equal(s.warnings(), 1);
  for (const key of ['Ё', '~']) {
    const used = s.shortcut.handleFocusedInput({ preventDefault: () => prevented++ },
      { type: 'keyDown', code: 'Backquote', key, control: true, shift: true });
    assert.equal(used, true); s.advance(400);
  }
  assert.equal(s.toggles(), 2);
  assert.equal(prevented, 2);
});
test('focused fallback does not duplicate a successful global registration', () => {
  const s = setup(); s.shortcut.register();
  assert.equal(s.shortcut.handleFocusedInput({ preventDefault: () => assert.fail() },
    { type: 'keyDown', code: 'Backquote', control: true, shift: true }), false);
  assert.equal(s.toggles(), 0);
});
test('fallback ignores wrong modifiers, other physical keys, key-up and repeats', () => {
  const s = setup(false); s.shortcut.register();
  const valid = { type: 'keyDown', code: 'Backquote', control: true, shift: true };
  for (const change of [{ control: false }, { shift: false }, { alt: true },
    { meta: true }, { code: 'KeyE' }, { type: 'keyUp' }, { isAutoRepeat: true }]) {
    assert.equal(s.shortcut.handleFocusedInput({ preventDefault: () => assert.fail() }, { ...valid, ...change }), false);
  }
  assert.equal(s.toggles(), 0);
});
test('native registration exceptions do not crash startup', () => {
  let warning;
  const s = createMiniShortcut({
    globalShortcut: { register() { throw Error('unsupported'); } },
    onToggle() { assert.fail(); }, onUnavailable: err => { warning = err; },
  });
  assert.equal(s.register(), false);
  assert.equal(warning.message, 'unsupported');
});