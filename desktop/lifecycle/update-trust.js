'use strict';
// The installed, signed application's configuration anchors publisher identity.
// Never learn the expected signer from downloaded release metadata.
async function requireUpdatePublisher(updater) {
  const config = await updater.configOnDisk.value;
  const names = Array.isArray(config && config.publisherName) ? config.publisherName : [config && config.publisherName];
  if (!names.length || names.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('Automatic updates disabled: installed publisher identity is missing. Install a verified signed build.');
  }
  if (updater.verifyUpdateCodeSignature === false) throw new Error('Automatic updates disabled: signature checking was disabled.');
  return names;
}
module.exports = { requireUpdatePublisher };
