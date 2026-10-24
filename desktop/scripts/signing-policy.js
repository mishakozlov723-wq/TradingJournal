'use strict';
// Default builds are free/manual. Supplying a half-configured signing identity
// must fail, never downgrade an explicitly requested signed release.
function signingConfiguration(env = process.env) {
  const mode = env.SYTER_SIGNED_RELEASE || 'false';
  if (!['true','false'].includes(mode)) throw new Error('SYTER_SIGNED_RELEASE must be true or false');
  if (mode === 'false') return {forceCodeSigning:false,win:{verifyUpdateCodeSignature:true},extraMetadata:{syterUpdatePolicy:'manual'}};
  const publisher = String(env.SYTER_PUBLISHER_NAME || '').trim();
  if (!publisher || !env.CSC_LINK) throw new Error('Signed builds require SYTER_PUBLISHER_NAME and CSC_LINK. No unsigned signed-mode fallback is permitted.');
  return {forceCodeSigning:true,win:{publisherName:[publisher],verifyUpdateCodeSignature:true},extraMetadata:{syterUpdatePolicy:'authenticode'}};
}
module.exports = {signingConfiguration};
