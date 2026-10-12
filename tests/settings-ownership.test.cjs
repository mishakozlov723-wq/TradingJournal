// node --test tests/settings-ownership.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.TJ_APP_SOURCE || path.join(__dirname, '../public/app.js'), 'utf8');
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const tail = source.slice(start), end = tail.search(/^  }\r?$/m);
  return tail.slice(0, end + 3);
}
function fixture() {
  const data = {
    Limon: { uid: 'limon-old', usage: { sessions: 4, totalMs: 72000 }, tradingModels: { a: 'model' }, notesWorkspaceMeta: { pageIds: ['page1'] } },
    Other: { uid: 'other', curveColor: '#ffffff' }
  };
  const profiles = [{ login: 'Limon', uid: 'limon-current' }, { login: 'Other', uid: 'other' }, { login: 'New', uid: 'new' }];
  const auth = { currentUser: { uid: 'admin' } }, writes = [], warnings = [], labels = {};
  function denied() { return Object.assign(new Error('Denied by ownership rules'), { code: 'permission-denied' }); }
  function read(ref) {
    const root = data[ref.id];
    if (root && auth.currentUser.uid !== 'admin' && root.uid !== auth.currentUser.uid) return Promise.reject(denied());
    return Promise.resolve({ exists: !!root, data: () => structuredClone(root) });
  }
  function write(ref, patch, kind) {
    writes.push({ id: ref.id, patch, kind });
    const root = data[ref.id];
    if (auth.currentUser.uid !== 'admin' && (root ? root.uid !== auth.currentUser.uid || (patch.uid && patch.uid !== root.uid) : patch.uid !== auth.currentUser.uid)) return Promise.reject(denied());
    data[ref.id] = { ...root, ...patch };
    return Promise.resolve();
  }
  const db = {
    collection(name) {
      assert.equal(name, 'titles');
      return { doc(id) { const ref = { id }; return Object.assign(ref, { get: () => read(ref), set: patch => write(ref, patch, 'set') }); } };
    },
    runTransaction(callback) {
      const pending = [];
      return callback({ get: read, update: (ref, patch) => pending.push([ref, patch, 'update']), set: (ref, patch) => pending.push([ref, patch, 'set']) })
        .then(() => Promise.all(pending.map(args => write(...args))));
    }
  };
  const firebase = { auth: () => auth, firestore: { FieldValue: { serverTimestamp: () => 123 } } };
  const c = { db, firebase, tjAdminUid: 'admin', document: { hidden: false },
    console: { warn: (...args) => warnings.push(args) },
    setInterval: () => 1, clearInterval() {},
    usageProfileForUid: uid => profiles.find(p => p.uid === uid),
    usageTracker: { uid: null, started: false, saving: Promise.resolve() },
    setUsageText: (id, value) => { labels[id] = value; },
    toUsageDate: value => value, refreshUsageStats: () => Promise.resolve()
  };
  vm.createContext(c);
  vm.runInContext(['queueUsageWrite', 'usageDoc', 'startUsageTracking'].map(fn).join('\n'), c);
  // Older source has no helper; preserve old behavior for the regression run.
  if (source.includes('  function tjRepairSettingsOwners(')) vm.runInContext(fn('tjRepairSettingsOwners'), c);
  else c.tjRepairSettingsOwners = () => Promise.resolve();
  return { c, auth, profiles, data, writes, warnings, labels };
}

test('admin repairs the stale settings UID and preserves all existing content', async () => {
  const { c, auth, profiles, data, writes } = fixture();
  const before = structuredClone(data.Limon);
  await c.tjRepairSettingsOwners(auth.currentUser, profiles);
  assert.deepEqual(data.Limon, { ...before, uid: 'limon-current' });
  assert.equal(writes.length, 1, 'correct and missing roots do not need writes');
  assert.deepEqual(Object.keys(writes[0].patch), ['uid']);
  await c.tjRepairSettingsOwners(auth.currentUser, profiles);
  assert.equal(writes.length, 1, 'repair is idempotent');
});

test('student login after admin repair saves usage without a rejected write', async () => {
  const { c, auth, profiles, data, warnings } = fixture();
  await c.tjRepairSettingsOwners(auth.currentUser, profiles);
  auth.currentUser = { uid: 'limon-current' };
  c.tjAdminUid = null;
  await c.startUsageTracking();
  assert.equal(data.Limon.usage.sessions, 5);
  assert.equal(data.Limon.usage.totalMs, 72000);
  assert.equal(c.usageTracker.started, true);
  assert.equal(warnings.length, 0);
});

test('unrepaired permission-denied read does not trigger a forbidden write and reports usage unavailable', async () => {
  const { c, auth, writes, labels, data } = fixture();
  auth.currentUser = { uid: 'limon-current' };
  c.tjAdminUid = null;
  await c.startUsageTracking();
  assert.equal(writes.length, 0, 'must not attempt to claim unreadable data');
  assert.equal(data.Limon.uid, 'limon-old');
  assert.equal(c.usageTracker.started, false);
  assert.match(labels.usageLastVisit, /unavailable/);
});

test('ordinary account cannot run an admin ownership repair', async () => {
  const { c, auth, profiles, writes } = fixture();
  auth.currentUser = { uid: 'limon-current' };
  c.tjAdminUid = null;
  await c.tjRepairSettingsOwners(auth.currentUser, profiles);
  assert.equal(writes.length, 0);
});

test('new student still gets settings initialized on first login', async () => {
  const { c, auth, data } = fixture();
  auth.currentUser = { uid: 'new' };
  c.tjAdminUid = null;
  await c.startUsageTracking();
  assert.equal(data.New.uid, 'new');
  assert.equal(data.New.usage.sessions, 1);
  assert.equal(c.usageTracker.started, true);
});

test('logging out during the repair read prevents a metadata write', async () => {
  const { c, auth, profiles, writes } = fixture();
  const job = c.tjRepairSettingsOwners(auth.currentUser, profiles);
  auth.currentUser = null;
  await job;
  assert.equal(writes.length, 0);
});
