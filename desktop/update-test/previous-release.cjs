'use strict';
// CI only: finds the newest PUBLISHED desktop release older than this build and
// downloads its updater installer, verified against that release's latest.yml.
// Replaces hand-pinned baseline versions/digests in the transition test.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const REPO = 'mishakozlov723-wq/syter-releases';
const VERSION = /^\d+\.\d+\.\d+$/;

function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// Public, non-draft, non-prerelease vX.Y.Z releases only.
function publishedVersions(releases) {
  if (!Array.isArray(releases)) throw Error('Unexpected GitHub releases response');
  return releases.filter(r => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' &&
    /^v\d+\.\d+\.\d+$/.test(r.tag_name)).map(r => ({ version: r.tag_name.slice(1), release: r }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function pickPrevious(releases, current) {
  if (!VERSION.test(current)) throw Error('Invalid current version: ' + current);
  const published = publishedVersions(releases);
  if (!published.length) throw Error('No published desktop release found in ' + REPO);
  const previous = published.find(p => compareVersions(p.version, current) < 0);
  if (!previous) throw Error('No published release older than ' + current);
  return { previous, latest: published[0].version };
}

// Minimal reader for electron-builder's latest.yml (flat keys + files list).
function parseLatestYml(text) {
  const out = { files: [] }; let file = null, inFiles = false;
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let m;
    if ((m = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(raw))) {
      inFiles = m[1] === 'files'; file = null;
      if (!inFiles) out[m[1]] = m[2].replace(/^'(.*)'$/, '$1');
    } else if (inFiles && (m = /^\s*-\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(raw))) {
      file = { [m[1]]: m[2] }; out.files.push(file);
    } else if (inFiles && file && (m = /^\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(raw))) file[m[1]] = m[2];
    else throw Error('Unexpected latest.yml line: ' + raw.slice(0, 80));
  }
  for (const f of out.files) if (f.size !== undefined) f.size = Number(f.size);
  return out;
}

function installerEntry(latest, version) {
  const name = 'SYTER-Setup-' + version + '.exe';
  if (latest.version !== version) throw Error('latest.yml version ' + latest.version + ' does not match ' + version);
  const entry = latest.files.find(f => f.url === name);
  if (!entry || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512 || '') || !Number.isSafeInteger(entry.size) || entry.size <= 0)
    throw Error('latest.yml has no verifiable entry for ' + name);
  if (latest.path !== name || latest.sha512 !== entry.sha512) throw Error('latest.yml top-level installer does not match its files entry');
  return { name, sha512: entry.sha512, size: entry.size };
}

async function request(url, token, accept) {
  const headers = { 'User-Agent': 'syter-transition-test', Accept: accept };
  let response = await fetch(url, { headers: token ? { ...headers, Authorization: 'Bearer ' + token } : headers, redirect: 'follow' });
  // A repository-scoped CI token may be refused for another repository; the releases are public.
  if (token && [401, 403, 404].includes(response.status)) response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw Error('GET ' + url + ' failed: HTTP ' + response.status);
  return response;
}

async function download(url, file) {
  const response = await request(url, null, 'application/octet-stream');
  const sha512 = crypto.createHash('sha512'), sha256 = crypto.createHash('sha256'); let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, done) { sha512.update(chunk); sha256.update(chunk); size += chunk.length; done(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file));
  return { size, sha512: sha512.digest('base64'), sha256: sha256.digest('hex') };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const out = path.resolve(root, process.argv[2] || 'baseline');
  const current = require(path.join(root, 'package.json')).version;
  const token = process.env.SYTER_RELEASES_READ_TOKEN || process.env.GH_TOKEN || '';
  const list = await (await request('https://api.github.com/repos/' + REPO + '/releases?per_page=100', token, 'application/vnd.github+json')).json();
  const { previous, latest } = pickPrevious(list, current);
  const asset = name => {
    const found = (previous.release.assets || []).find(a => a.name === name);
    if (!found || !found.browser_download_url) throw Error('Release v' + previous.version + ' has no asset ' + name);
    return found;
  };
  const metadata = parseLatestYml(await (await request(asset('latest.yml').browser_download_url, null, 'application/octet-stream')).text());
  const expected = installerEntry(metadata, previous.version), installerAsset = asset(expected.name);
  if (installerAsset.size !== expected.size) throw Error('Release asset size differs from latest.yml');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, expected.name);
  const actual = await download(installerAsset.browser_download_url, file);
  if (actual.size !== expected.size || actual.sha512 !== expected.sha512) throw Error('Downloaded ' + expected.name + ' does not match its published latest.yml');
  if (installerAsset.digest && installerAsset.digest !== 'sha256:' + actual.sha256) throw Error('Downloaded ' + expected.name + ' does not match the GitHub asset digest');
  const receipt = { version: previous.version, latest, current, installer: path.relative(root, file).split(path.sep).join('/'), size: actual.size, sha256: actual.sha256 };
  fs.writeFileSync(path.join(out, 'previous-release.json'), JSON.stringify(receipt, null, 2));
  console.log('Previous published release: ' + previous.version + ' (latest published: ' + latest + ', this build: ' + current + ')');
  console.log('Verified ' + expected.name + ': ' + actual.size + ' bytes, sha256 ' + actual.sha256);
}

module.exports = { compareVersions, publishedVersions, pickPrevious, parseLatestYml, installerEntry };
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
