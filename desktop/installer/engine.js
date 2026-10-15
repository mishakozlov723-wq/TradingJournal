'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
async function verifyPayload(file, expected, progress = () => {}) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid installer manifest');
  const size = (await fs.promises.stat(file)).size;
  const hash = crypto.createHash('sha256'); let read = 0, last = -1;
  for await (const data of fs.createReadStream(file)) {
    hash.update(data); read += data.length;
    const percent = size ? Math.floor(read / size * 100) : 0;
    if (percent !== last) { last = percent; progress(percent); }
  }
  if (hash.digest('hex') !== expected) throw Error('Installer verification failed');
}
function parseInstallProgress(stdout, sessionId) {
  const data = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s+(Session|Stage|Total|Extracted|Copied|Location)\s+REG_SZ\s+(.*?)\s*$/);
    if (m) data[m[1]] = m[2];
  }
  if (data.Session !== sessionId) return null; // never reuse stale/reinstall status
  const total = Number(data.Total), extracted = Number(data.Extracted), copied = Number(data.Copied);
  if (![total,extracted,copied].every(Number.isSafeInteger) || total < 0 || total > 1073741823 || extracted < 0 || copied < 0 || extracted > total || copied > total) return null;
  const phase = ['finalizing','installed'].includes(data.Stage) ? 'finalizing' : 'installing';
  const complete = extracted + copied;
  return { phase, stage:data.Stage, percent:total ? complete / (2 * total) * 100 : null,
    processed:complete, workTotal:2 * total, location:data.Location || '' };
}
async function readInstallProgress(sessionId) {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const { stdout } = await promisify(execFile)(reg, ['query','HKCU\\Software\\SYTER\\Installer','/reg:64'], {windowsHide:true,timeout:3000});
  return parseInstallProgress(stdout,sessionId);
}
function runSilent(file, spawnImpl = spawn, { sessionId = '', onProgress = () => {}, readProgress = readInstallProgress } = {}) {
  if (sessionId && !/^[a-f0-9-]{36}$/.test(sessionId)) return Promise.reject(Error('Invalid install session'));
  return new Promise((resolve, reject) => {
    let timer, polling = false, stopped = false;
    async function poll() {
      if (polling || stopped) return;
      polling = true;
      try { const progress = await readProgress(sessionId); if (progress && !stopped) onProgress(progress); } catch (_) {} finally { polling = false; }
    }
    const child = spawnImpl(file, ['/S', ...(sessionId ? ['--syter-session=' + sessionId] : [])], { shell: false, windowsHide: true, stdio: 'ignore' });
    if (sessionId) { timer = setInterval(poll, 200); poll(); }
    child.once('error', error => { stopped = true; clearInterval(timer); reject(error); });
    child.once('exit', async (code, signal) => {
      clearInterval(timer);
      if (code === 0 && sessionId) {
        try { const progress = await readProgress(sessionId); if (progress) onProgress(progress); } catch (_) {}
      }
      stopped = true;
      code === 0 ? resolve() : reject(Error(`Installation did not finish (${signal || code}).`));
    });
  });
}
async function installedExecutable(version) {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const query = async value => {
    const { stdout } = await promisify(execFile)(reg, ['query', 'HKCU\\Software\\SYTER\\Desktop', '/v', value, '/reg:64'], { windowsHide: true });
    const match = stdout.match(new RegExp('\\s' + value + '\\s+REG_SZ\\s+([^\\r\\n]+)'));
    if (!match) throw Error('Install location not found'); return match[1].trim();
  };
  if (await query('Version') !== version) throw Error('Installed version could not be verified');
  const location = await query('InstallLocation');
  if (!path.win32.isAbsolute(location) || location.startsWith('\\\\')) throw Error('Invalid install location');
  const exe = path.join(location, 'SYTER.exe');
  if (!(await fs.promises.stat(exe)).isFile()) throw Error('Installed app not found');
  return exe;
}
module.exports = { verifyPayload, runSilent, installedExecutable, parseInstallProgress };
