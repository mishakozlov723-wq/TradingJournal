"use strict";
// GitHub release/account + TLS is the existing trust model. SHA512 detects
// corruption, not a malicious release publisher. Do not invent a signing anchor.
async function requireUpdatePublisher(updater, installedPolicy = 'github') {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  if (!['github','authenticode'].includes(installedPolicy)) throw Error('Unsupported installed updater policy');
  const config = await updater.configOnDisk.value;
  if (!config || config.provider !== 'github' || config.owner !== 'mishakozlov723-wq' || config.repo !== 'syter-releases') throw Error('Unexpected installed updater repository');
  if (typeof updater.verifyUpdateCodeSignature !== 'function') throw Error('Built-in update signature checking was disabled');
  const names = Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName];
  if (installedPolicy === 'authenticode' && (!names.length || names.some(name => typeof name !== 'string' || !name.trim()))) throw Error('Signed-mode installed publisher identity is missing');
  return installedPolicy === 'authenticode' ? names : [];
}
module.exports = { requireUpdatePublisher };
