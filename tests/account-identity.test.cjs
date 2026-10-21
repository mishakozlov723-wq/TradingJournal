// Run with: node --test tests/account-identity.test.cjs
// Uses the production functions with an in-memory Firestore fixture; no credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.TJ_APP_SOURCE || path.join(__dirname, '../public/app.js'), 'utf8');

function productionFunction(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const tail = source.slice(start);
  const end = tail.search(/^  }\r?$/m);
  assert.ok(end >= 0, name + ' closing brace');
  return tail.slice(0, end + 3);
}

function fixture({ stale = true, missing = false, unavailable = false } = {}) {
  const profiles = {
    admin: { login: 'Retocker', email: 'retocker@journal.local', role: 'admin', uid: 'admin' },
    'limon-current': { login: 'Limon', email: 'limon@journal.local', uid: stale ? 'limon-old' : 'limon-current' },
    other: { login: 'Other', email: 'other@journal.local', uid: 'other' }
  };
  if (missing) delete profiles['limon-current'].uid;
  const records = {};
  ['trades', 'backtests', 'backtestTrades'].forEach(collection => {
    records[collection] = [
      { id: collection + '-limon', uid: 'limon-current', r: 1 },
      { id: collection + '-other', uid: 'other', r: 2 }
    ];
  });
  const reads = [], subscriptions = [];
  const snapshot = entries => ({
    forEach: fn => entries.forEach(([id, data]) => fn({ id, exists: true, data: () => data }))
  });
  const db = { runTransaction: fn => fn({ get: () => Promise.resolve({ exists: false }) }), collection(name) {
    return {
      doc(id) { return {
        get() {
          if (unavailable) return Promise.reject(new Error('Offline fixture'));
          return Promise.resolve({ exists: !!profiles[id], data: () => profiles[id] });
        },
        onSnapshot(callback) { const sub = { name, id, callback, active: true }; subscriptions.push(sub); return () => { sub.active = false; }; }
      }; },
      get() { return Promise.resolve(snapshot(Object.entries(profiles))); },
      where(field, op, uid) {
        assert.equal(field, 'uid'); assert.equal(op, '==');
        return {
          get() { reads.push({ name, uid }); return Promise.resolve(snapshot(records[name].filter(r => r.uid === uid).map(r => [r.id, r]))); },
          onSnapshot(callback) { const sub = { name, uid, callback, active: true }; subscriptions.push(sub); return () => { sub.active = false; }; }
        };
      }
    };
  } };
  const context = {
    window: {},
    db, console: { warn() {}, error(e) { throw e; } }, clearTimeout,
    firebase: { auth: () => ({ currentUser: adminAuth }) },
    document: { body: { classList: { remove() {} } }, activeElement: null, getElementById: () => ({ style: {} }) },
    tjBacktestOutbox:()=>[],tjFlushBacktestOutbox:()=>Promise.resolve(),tjBacktestActiveLoads:{},tjOverlayBacktestOutbox:records=>records,localStorage:{getItem:()=>null,setItem(){}},tjDataGeneration: 0, tjBacktestLoadGeneration: 0,
    tjServerTrades: {}, tjLive: { unsubs: [], timer: null, generation: 0 },
    currentUser: null, viewingUser: null, trades: [], backtests: [], allBacktestTrades: [], backtestTrades: [],
    tradingModels: [], activeBacktestId: null,
    readTradingModelsDocument: () => Promise.resolve({ exists: false }),
    normalizeAssetDefinitions: () => [], normalizeTradeRisk: x => x,
    readBacktestLocal: () => [], migrateFromLocalStorage: () => Promise.resolve(),
    idbGetAllForUser: () => Promise.resolve([]),
    tjClone: x => JSON.parse(JSON.stringify(x))
  };
  ['flushNotePanelSave', 'closeBestTrade', 'flushBacktestRRDraft', 'closeModelCreatePanel',
    'closeModal', 'renderTradeModelControl', 'showOverviewSkeleton', 'renderAssetControls',
    'updateCurveColorUI', 'tjApplyChartHeight', 'tjApplyBacktestChartHeight',
    'invalidateTradeNumbers', 'saveBacktestLocal', 'tjScheduleLiveRender'].forEach(name => { context[name] = () => {}; });
  vm.createContext(context);
  const directory = source.slice(source.indexOf('  var USERS = [];'), source.indexOf('  var currentUser = null;'));
  vm.runInContext(directory + '\n' + ['tjLoadIsCurrent', 'stopLiveSync', 'tjApplyLive', 'loadData', 'loadBacktests', 'startLiveSync'].map(productionFunction).join('\n'), context);
  return { context, profiles, reads, subscriptions };
}

const adminAuth = { uid: 'admin', email: 'retocker@journal.local' };
const limonAuth = { uid: 'limon-current', email: 'limon@journal.local' };

test('admin and direct sign-in resolve the same student despite a stale profile uid', async () => {
  const { context: c, profiles } = fixture();
  await c.tjLoadUserDirectory(adminAuth);
  const adminTarget = c.findUser('Limon');
  c.tjResetUserDirectory();
  const direct = await c.tjLoadUserDirectory(limonAuth);
  assert.equal(adminTarget.uid, direct.uid);
  assert.equal(adminTarget.uid, 'limon-current');
  assert.equal(profiles['limon-current'].uid, 'limon-old', 'source document must not be rewritten');
});

for (const options of [{ stale: false }, { missing: true }]) {
  test('directory works with ' + (options.missing ? 'absent' : 'correct') + ' legacy uid', async () => {
    const { context: c } = fixture(options);
    const own = await c.tjLoadUserDirectory(adminAuth);
    assert.equal(own.uid, 'admin');
    assert.equal(c.findUser('Limon').uid, 'limon-current');
    assert.equal(c.findUser('other@journal.local').uid, 'other');
    assert.equal(c.USERS.length, 3);
  });
}

test('ordinary sign-in exposes only its own profile', async () => {
  const { context: c } = fixture();
  await c.tjLoadUserDirectory(limonAuth);
  assert.equal(c.USERS.length, 1);
  assert.equal(c.tjAdminUid, null);
  assert.equal(c.findUser('Other'), null);
});

test('unavailable own profile falls back to authenticated identity', async () => {
  const { context: c } = fixture({ unavailable: true });
  const own = await c.tjLoadUserDirectory(limonAuth);
  assert.equal(own.uid, 'limon-current');
  assert.equal(own.role, 'user');
});

test('admin switch loads existing trades and backtests and subscribes to the same UID', async () => {
  const { context: c, reads, subscriptions } = fixture();
  c.currentUser = await c.tjLoadUserDirectory(adminAuth);
  c.viewingUser = 'Limon';
  const load = await c.loadData();
  await load.backtestsReady;
  assert.equal(c.trades[0]?.id, 'trades-limon');
  assert.equal(c.backtests[0]?.id, 'backtests-limon');
  assert.equal(c.allBacktestTrades[0]?.id, 'backtestTrades-limon');
  assert.equal(reads.length, 3);
  assert.ok(reads.every(r => r.uid === 'limon-current'));
  c.startLiveSync(load);
  const live = subscriptions.filter(s => s.uid);
  assert.equal(live.length, 3);
  assert.ok(live.every(s => s.uid === 'limon-current'));
  live.find(s => s.name === 'trades').callback({ docChanges: () => [{ type: 'added', doc: {
    id: 'new-trade', metadata: {}, data: () => ({ id: 'new-trade', uid: 'limon-current', r: 3 })
  } }] });
  assert.equal(c.trades.length, 2, 'live student update is received');
});

test('switching to another student cancels and ignores previous subscriptions', async () => {
  const { context: c, subscriptions } = fixture();
  c.currentUser = await c.tjLoadUserDirectory(adminAuth);
  c.viewingUser = 'Limon';
  const limonLoad = await c.loadData(); await limonLoad.backtestsReady; c.startLiveSync(limonLoad);
  const old = subscriptions.slice();
  c.viewingUser = 'Other';
  const otherLoad = await c.loadData(); await otherLoad.backtestsReady; c.startLiveSync(otherLoad);
  assert.ok(old.every(s => !s.active));
  old.find(s => s.name === 'trades').callback({ docChanges: () => { throw new Error('stale callback used'); } });
  assert.equal(c.trades.length, 1);
  assert.equal(c.trades[0].uid, 'other');
  assert.ok(subscriptions.filter(s => s.active && s.uid).every(s => s.uid === 'other'));
});

test('an authoritative empty server journal offers legacy export without recreating old records',async()=>{
 const {context:c}=fixture();await c.tjLoadUserDirectory(adminAuth);c.currentUser=c.findUser('Retocker');c.viewingUser='Retocker';
 const collection=c.db.collection.bind(c.db);c.db.collection=name=>{const col=collection(name);if(name==='trades')col.where=()=>({get:()=>Promise.resolve({forEach(){}})});return col;};
 c.idbGetAllForUser=()=>Promise.resolve([{id:'deleted-before',uid:'admin',r:99}]);let offered;c.tjOfferLegacyRecovery=records=>offered=records;
 await c.loadData();assert.equal(c.trades.length,0);assert.equal(offered[0].id,'deleted-before');
});
