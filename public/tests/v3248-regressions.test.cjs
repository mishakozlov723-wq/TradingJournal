const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const html = require('./assembled-html.cjs')();
const accounts = fs.readFileSync(path.join(root, 'public', 'accounts-space.js'), 'utf8');

// These are focused guardrails for the fixes discovered in the v3.24.8 final audit.

test('manual journal statistics are booked by close date and period detail tables follow close order', () => {
  assert.match(html, /var raw = trade && \(trade\.closeDT \|\| trade\.openDT\)/);
  assert.match(html, /useStatsDateOrder = tbodyId === 'monthTradesBody' \|\| tbodyId === 'weekTradesBody'/);
  assert.match(html, /useStatsDateOrder \? \(tradeStatsDate\(b\) - tradeStatsDate\(a\)\)/);
  assert.match(html, /TRADE_CURVE_FIELDS = \['r', 'riskPercent', 'closeDT', 'asset'\]/);
});

test('manual journal rejects an impossible close-before-open trade', () => {
  assert.match(html, /function validateTradeDateOrder\(/);
  assert.match(html, /validateTradeDateOrder\(openDT, closeDT\)/);
  assert.match(html, /Close date cannot be earlier than open date\./);
});

test('mobile model navigation does not steal taps while the Model column is in edit mode', () => {
  assert.match(html, /activeEditCol === 'model' && link\.closest\('td\[data-col="model"\]'\)/);
  assert.match(html, /window\.location\.assign\(url\)/);
  assert.match(html, /body\.mobile-mode #modelCreateOverlay input \{ font-size: 16px; \}/);
});

test('Accounts list/detail async responses are bound to the Firebase user that started them', () => {
  assert.match(accounts, /listRequestSeq/);
  assert.match(accounts, /requestUid=accCurrentUid\(\)/);
  assert.match(accounts, /accCurrentUid\(\)!==requestUid/);
  assert.match(accounts, /accLoadCachedHistory\(id,requestUid\)/);
  assert.match(accounts, /accSaveCachedHistory\(id,merged,requestUid,cached\.remote\)/);
  assert.match(accounts, /accConnectionToken\(requestUid\)/);
});

test('Accounts UI keeps the requested cleanup and explanation behavior', () => {
  assert.match(accounts, /Загрузка данных аккаунта…/);
  assert.match(accounts, /ACCOUNTS_STAT_INFO/);
  assert.doesNotMatch(accounts, /accounts-stat-help/);
  const chart = accounts.slice(accounts.indexOf('function accRenderChart'), accounts.indexOf('function accRenderDetail'));
  assert.doesNotMatch(chart, /floatingPL|equityPts|equityPath/);
  assert.doesNotMatch(accounts, /50\s+(?:last|послед|операц)/i);
});

test('old-user disconnect completion cannot wipe a newly authenticated user view', () => {
  assert.match(accounts, /if\(accCurrentUid\(\)!==disconnectUid\)\{ accountsState\.connecting=false; return; \}/);
  assert.match(accounts, /accountsState\.loadingList=false; accountsState\.loadingDetail=false/);
  assert.match(accounts, /accountsState\.connecting=false;\n\s*accountsState\.accounts=\[\]/);
});
