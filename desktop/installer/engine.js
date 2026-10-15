'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
async function verifyPayload(file, expected, progress = () => {}) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid installer manifest');
  const size = (await fs.promises.stat(file)).size;
  const hash = crypto.createHash('sha256'); let read = 0;
  for await (const data of fs.createReadStream(file)) { hash.update(data); read += data.length; progress(size ? read / size * 100 : 0); }
  if (hash.digest('hex') !== expected) throw Error('Installer verification failed');
}
function runSilent(file, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, ['/S'], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`Installation did not finish (${signal || code}).`)));
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
module.exports = { verifyPayload, runSilent, installedExecutable };
