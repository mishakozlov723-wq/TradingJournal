const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'replay-space.js'), 'utf8');
const start = source.indexOf('  /* TradingView-style timeframe entry');
const end = source.indexOf('  function lowerBound', start);
assert.ok(start >= 0 && end > start);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);

test('plain minute shortcuts normalize to supported resolutions', () => {
  assert.equal(ctx.normalizeTfInput('3'), '3m');
  assert.equal(ctx.normalizeTfInput('5'), '5m');
  assert.equal(ctx.normalizeTfInput('15'), '15m');
  assert.equal(ctx.normalizeTfInput('30m'), '30m');
});

test('hour, day, week and month suffixes normalize like TradingView', () => {
  assert.equal(ctx.normalizeTfInput('1h'), '1h');
  assert.equal(ctx.normalizeTfInput('60'), '1h');
  assert.equal(ctx.normalizeTfInput('4h'), '4h');
  assert.equal(ctx.normalizeTfInput('1d'), '1D');
  assert.equal(ctx.normalizeTfInput('1w'), '1W');
  assert.equal(ctx.normalizeTfInput('1M'), '1M');
  assert.equal(ctx.normalizeTfInput('3M'), '3M');
});

test('invalid values are rejected without guessing', () => {
  for (const value of ['', '0', '2h', '7x', 'm', '1234567']) assert.equal(ctx.normalizeTfInput(value), null, value);
});

test('3m availability reads the nested published M3 metadata', () => {
  const fnStart = source.indexOf('  function isTfAvailable');
  const fnEnd = source.indexOf('  function updateTfButtons', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const availabilityCtx = { S: {} };
  vm.createContext(availabilityCtx);
  vm.runInContext(
    `var S = { sess: {
      d: { m3: { m3Start: 100 }, T: [200] },
      cur: 0
    } };\n${source.slice(fnStart, fnEnd)}`,
    availabilityCtx
  );
  assert.equal(availabilityCtx.isTfAvailable('3m'), true);
});
