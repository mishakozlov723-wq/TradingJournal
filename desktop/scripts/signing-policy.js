'use strict';
function signingConfiguration(env = process.env) {
  const publisher = String(env.SYTER_PUBLISHER_NAME || '').trim();
  if (!publisher || !env.CSC_LINK) throw new Error('Signed builds require SYTER_PUBLISHER_NAME and CSC_LINK. No unsigned release fallback is permitted.');
  return { forceCodeSigning: true, win: { publisherName: [publisher], verifyUpdateCodeSignature: true } };
}
module.exports = { signingConfiguration };
