'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const opened = [], loaded = [], handlers = {};
  let windowOpen;
  const wc = {
    setWindowOpenHandler: cb => { windowOpen = cb; },
    on: (name, cb) => { handlers[name] = cb; },
    loadURL: url => { loaded.push(url); },
  };
  const context = {
    require(name) {
      if (name === 'electron') return {
        app: { requestSingleInstanceLock: () => true, on() {},
          whenReady: () => ({ then() {} }), setAppUserModelId() {} },
        ipcMain: { handle() {} }, globalShortcut: {},
        shell: { openExternal: url => { opened.push(url); return Promise.resolve(); } },
      };
      if (name === 'electron-updater') return { autoUpdater: {} };
      if (name.startsWith('./')) return require(path.join(__dirname, '..', name));
      return require(name);
    },
    __dirname: path.resolve(__dirname, '..'), URL, console, setInterval, clearInterval, setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') +
    '\nglobalThis.testLinks = { installLinkHandlers, isSharedNoteUrl };', context);
  context.testLinks.installLinkHandlers(wc);
  return { opened, loaded, classify: context.testLinks.isSharedNoteUrl,
    open: url => windowOpen({ url }),
    navigate(url) {
      let prevented = false;
      handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, url);
      return prevented;
    },
  };
}

const token = 'AbCd0123456789Ef';
for (const host of ['retocker.web.app', 'retocker.firebaseapp.com']) {
  test(`new-tab model link on ${host} goes outside without replacing the journal`, () => {
    const s = setup(), url = `https://${host}/?note=${token}`;
    assert.equal(s.open(url).action, 'deny');
    assert.deepEqual(s.opened, [url]);
    assert.deepEqual(s.loaded, []);
  });
  test(`same-tab model link on ${host} is prevented and goes outside`, () => {
    const s = setup(), url = `https://${host}/?note=${token}`;
    assert.equal(s.navigate(url), true);
    assert.deepEqual(s.opened, [url]);
    assert.deepEqual(s.loaded, []);
  });
}
test('ordinary journal navigation remains inside for both navigation methods', () => {
  const s = setup(), url = 'https://retocker.web.app/?space=notes';
  assert.equal(s.open(url).action, 'deny');
  assert.deepEqual(s.loaded, [url]);
  assert.equal(s.navigate(url), false);
  assert.deepEqual(s.opened, []);
});
test('shared viewer on index.html with other query parameters is also external', () => {
  const s = setup(), url = `https://retocker.web.app/index.html?v=123&note=${token}#details`;
  s.open(url); assert.deepEqual(s.opened, [url]); assert.deepEqual(s.loaded, []);
});
test('even a broken/empty shared link cannot strand the user inside the viewer', () => {
  const s = setup(), url = 'https://retocker.web.app/?note=';
  assert.equal(s.navigate(url), true);
  assert.deepEqual(s.opened, [url]);
});
test('a similar query name or hash does not count as a shared-note route', () => {
  const s = setup();
  assert.equal(s.classify('https://retocker.web.app/?notebook=test'), false);
  assert.equal(s.classify(`https://retocker.web.app/#note=${token}`), false);
  assert.equal(s.classify('not a URL'), false);
});
test('ordinary external websites still use the system browser', () => {
  const s = setup(), url = 'https://www.tradingview.com/chart/';
  assert.equal(s.navigate(url), true);
  assert.deepEqual(s.opened, [url]);
  assert.deepEqual(s.loaded, []);
});
test('mailto links retain their previous system handling', () => {
  const s = setup(), url = 'mailto:test@example.com';
  s.open(url); assert.deepEqual(s.opened, [url]);
});
test('dangerous protocols never reach the OS shell and cannot create child windows', () => {
  const s = setup();
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/untrusted.exe', 'ms-settings:privacy']) {
    assert.equal(s.open(url).action, 'deny');
  }
  assert.deepEqual(s.opened, []); assert.deepEqual(s.loaded, []);
});
test('local offline-page navigation keeps its existing behavior', () => {
  const s = setup();
  assert.equal(s.navigate(require('node:url').pathToFileURL(path.resolve(__dirname, '../offline.html')).href), false);
  assert.deepEqual(s.opened, []);
});
test('similar-looking hosts never become trusted journal pages', () => {
  const s = setup(), url = `https://retocker.web.app.example.com/?note=${token}`;
  assert.equal(s.classify(url), false);
  s.open(url); assert.deepEqual(s.opened, [url]); assert.deepEqual(s.loaded, []);
});
test('same-tab file navigation trusts only the exact bundled offline document', () => {
 const s=setup();
 for(const url of ['file:///app/offline.html','file:///tmp/offline.html','file:///tmp/untrusted.html','file:///etc/passwd','file://untrusted-host/app/offline.html'])assert.equal(s.navigate(url),true);
 const bundled=require('node:url').pathToFileURL(path.resolve(__dirname,'../offline.html')).href;
 assert.equal(s.navigate(bundled+'#retry'),false);
 assert.equal(s.navigate(bundled+'?untrusted=1'),true);
 assert.deepEqual(s.opened,[]);
});
