'use strict';
// The installed, signed application's configuration anchors publisher identity.
// Never learn the expected signer from downloaded release metadata.
async function requireUpdatePublisher(updater, installedPolicy = 'manual') {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  if (installedPolicy !== 'authenticode') throw new Error('Automatic updates disabled: this free/manual build has no independent update signature. Use the manual installer after verifying its source.');
  const config = await updater.configOnDisk.value;
  const names = Array.isArray(config && config.publisherName) ? config.publisherName : [config && config.publisherName];
  if (!names.length || names.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('Automatic updates disabled: installed publisher identity is missing. Install a verified signed build.');
  }
  if (typeof updater.verifyUpdateCodeSignature !== 'function') throw new Error('Automatic updates disabled: signature checking was disabled.');
  return names;
}
module.exports = { requireUpdatePublisher };
