'use strict';
// Pure update state machine: renderer cannot pass URLs, paths or install options.
function notesText(notes) {
  const text = Array.isArray(notes) ? notes.map(n => n.note || '').join('\n') : String(notes || '');
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 6000).trim();
}
function createUpdateController({ updater, currentVersion, publish, reveal, dismiss, prepareQuit, restoreQuit = () => {}, log = () => {} }) {
  let state = { mode: 'update', phase: 'checking', currentVersion, version: '', notes: '', percent: null };
  let stopped = false, downloadPromise = null, checkPromise = null, reminder = null;
  const handlers = [];
  const send = patch => { state = { ...state, ...patch }; publish({ ...state }); };
  const on = (name, fn) => { updater.on(name, fn); handlers.push([name, fn]); };
  const fail = error => {
    log(error);
    if (state.phase === 'restarting') restoreQuit();
    if (stopped) return;
    const retry = state.phase === 'downloading' ? 'download' : state.phase === 'restarting' ? 'restart' : 'check';
    send({ phase: 'error', retry, error: 'Could not complete the update. Check your connection and try again.' });
    // Background check failures are logged; do not interrupt the journal.
  };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false; // "Later" never installs without consent.
  on('update-available', info => {
    if (['downloading', 'ready', 'restarting'].includes(state.phase)) return;
    send({ phase: 'available', version: String(info.version), notes: notesText(info.releaseNotes), percent: null });
    reveal();
  });
  on('update-not-available', () => {
    if (stopped || state.phase !== 'checking') return;
    send({ phase: 'current', version: currentVersion, notes: '', percent: null, error: '', retry: '' });
  });
  on('download-progress', p => {
    if (state.phase !== 'downloading') return;
    send({ percent: Math.max(0, Math.min(100, Number(p.percent) || 0)), transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
  });
  on('update-downloaded', info => {
    send({ phase: 'ready', version: String(info.version), percent: 100 }); reveal();
  });
  on('error', fail);
  async function download() {
    if (downloadPromise || !['available', 'error'].includes(state.phase)) return;
    send({ phase: 'downloading', percent: null, error: '' });
    downloadPromise = Promise.resolve().then(() => updater.downloadUpdate());
    try { await downloadPromise; } catch (error) { if (state.phase !== 'error') fail(error); }
    finally { downloadPromise = null; }
  }
  async function check() {
    if (stopped || ['available', 'downloading', 'ready', 'restarting'].includes(state.phase)) return;
    if (checkPromise) return checkPromise;
    send({ phase: 'checking', error: '' });
    checkPromise = Promise.resolve().then(() => updater.checkForUpdates());
    try { await checkPromise; } catch (error) { if (state.phase !== 'error') fail(error); }
    finally { checkPromise = null; }
  }
  function restart() {
    if (state.phase !== 'ready' && !(state.phase === 'error' && state.retry === 'restart')) return;
    send({ phase: 'restarting' });
    prepareQuit();
    try { updater.quitAndInstall(true, true); } catch (error) { fail(error); }
  }
  async function action(name) {
    if (stopped) return;
    if (name === 'download') await download();
    else if (name === 'restart') restart();
    else if (name === 'retry') {
      if (state.retry === 'download') await download();
      else if (state.retry === 'restart') restart();
      else await check();
    } else if (name === 'later' || name === 'close') {
      if (state.phase === 'restarting') return;
      dismiss();
      clearTimeout(reminder);
      reminder = setTimeout(() => { if (!stopped && ['available', 'ready', 'error'].includes(state.phase)) reveal(); }, 6 * 60 * 60 * 1000);
      reminder.unref?.();
    }
  }
  return { check, action, snapshot: () => ({ ...state }), stop() { stopped = true; clearTimeout(reminder); for (const [n, f] of handlers) updater.removeListener(n, f); } };
}
module.exports = { createUpdateController, notesText };
