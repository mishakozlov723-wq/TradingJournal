'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function load(name, end, document) {
  const start = source.indexOf('  function ' + name + '() {');
  assert.notEqual(start, -1);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start);
  const context = { document };
  vm.createContext(context);
  vm.runInContext(source.slice(start, stop), context);
  return context[name];
}
function classes(...values) {
  const set = new Set(values);
  return { contains: n => set.has(n), remove: n => set.delete(n),
    toggle(n, enabled) { enabled ? set.add(n) : set.delete(n); } };
}
function scrollbar(open, overflow = true) {
  const elements = {
    assetFilterControl: {classList: classes(...(open ? ['open'] : []))},
    assetFilterMenu: {clientWidth:100, scrollWidth:overflow ? 400 : 100, scrollLeft:100},
    assetFilterScrollbar: {classList:classes('is-visible'), clientWidth:200},
    assetFilterScrollbarThumb: {style:{}, offsetWidth:50}
  };
  const document = {getElementById:id => elements[id]};
  const run = load('syncAssetFilterScrollbar', '  (function initAssetFilterScrollbar()', document);
  return {elements, run};
}
test('closed asset filter performs no geometry reads and hides stale scrollbar', () => {
  const {elements, run} = scrollbar(false);
  for (const id of ['assetFilterMenu','assetFilterScrollbar','assetFilterScrollbarThumb']) {
    for (const prop of ['clientWidth','scrollWidth','scrollLeft','offsetWidth']) {
      Object.defineProperty(elements[id],prop,{get(){throw Error('Hidden geometry read: '+prop);}});
    }
  }
  run();
  assert.equal(elements.assetFilterScrollbar.classList.contains('is-visible'),false);
});
test('open overflowing filter keeps scrollbar geometry and scroll tracking', () => {
  const {elements, run} = scrollbar(true);run();
  assert.equal(elements.assetFilterScrollbar.classList.contains('is-visible'),true);
  assert.equal(elements.assetFilterScrollbarThumb.style.width,'28%');
  assert.equal(elements.assetFilterScrollbarThumb.style.transform,'translateX(50px)');
});
test('open nonoverflowing filter hides scrollbar', () => {
  const {elements, run} = scrollbar(true,false);run();
  assert.equal(elements.assetFilterScrollbar.classList.contains('is-visible'),false);
});
test('missing asset filter control does not measure or throw', () => {
  const {elements, run} = scrollbar(false);delete elements.assetFilterControl;run();
});
for (const active of [[], ['backtest-workspace-mode'], ['backtest-detail-mode']]) {
  test('inactive backtest panel skips DOM measurements: '+active.join(','), () => {
    const document={body:{classList:classes(...active)},
      querySelector(){throw Error('Hidden builder lookup');},
      getElementById(){throw Error('Hidden panel lookup');}};
    load('syncBacktestPanelPosition', "  window.addEventListener('resize', syncBacktestPanelPosition);", document)();
  });
}
test('active backtest panel still follows its builder', () => {
  const elements={backtestInputPanel:{style:{}},backtestDrawerOpenTab:{style:{}}};
  const document={body:{classList:classes('backtest-workspace-mode','backtest-detail-mode')},
    querySelector:()=>({getBoundingClientRect:()=>({top:100})}),getElementById:id=>elements[id]};
  load('syncBacktestPanelPosition', "  window.addEventListener('resize', syncBacktestPanelPosition);", document)();
  assert.equal(elements.backtestInputPanel.style.top,'100px');
  assert.equal(elements.backtestInputPanel.style.maxHeight,'calc(100vh - 120px)');
  assert.equal(elements.backtestDrawerOpenTab.style.top,'100px');
});
