'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handlePreviewInput, SCRIPT } = require('../interface-preview-shortcut');
function run(overrides = {}, url = 'https://retocker.web.app/') {
  let prevented = 0;
  const scripts = [];
  const input = { type: 'keyDown', code: 'Digit0', key: ')', control: true, shift: true, ...overrides };
  const result = handlePreviewInput({ preventDefault() { prevented++; } }, input,
    { isDestroyed: () => false, getURL: () => url,
      executeJavaScript(script) { scripts.push(script); return Promise.resolve(); } },
    url => url.startsWith('https://retocker.web.app/'));
  return { result, prevented, scripts };
}
test('Ctrl+Shift+0 emits exactly one private site event and consumes zoom reset', () => {
  assert.deepEqual(run(), { result: true, prevented: 1, scripts: [SCRIPT] });
  assert.deepEqual(run({ code: 'Numpad0', key: '0' }), { result: true, prevented: 1, scripts: [SCRIPT] });
  assert.equal(run({ code: undefined, key: '0' }).result, true);
});
test('holding shortcut does not repeatedly toggle the UI', () => {
  assert.deepEqual(run({ isAutoRepeat: true }), { result: true, prevented: 1, scripts: [] });
});
test('ordinary zoom reset and unrelated shortcuts are unaffected', () => {
  for (const input of [{ shift: false }, { control: false }, { alt: true }, { meta: true },
    { type: 'keyUp' }, { code: 'Digit9', key: '(' }]) {
    assert.deepEqual(run(input), { result: false, prevented: 0, scripts: [] });
  }
});
test('no preview event on offline or external pages', () => {
  for (const url of ['file:///offline.html', 'https://external.example/', 'https://retocker.web.app.evil/']) {
    assert.deepEqual(run({}, url), { result: false, prevented: 0, scripts: [] });
  }
});