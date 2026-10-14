'use strict';
// A private integration hook for the future site UI, not an access-control gate.
// The website must authorize preview access before responding to this event.
const EVENT = 'syter:interface-preview-toggle';
const SCRIPT = `window.dispatchEvent(new CustomEvent(${JSON.stringify(EVENT)}));void 0`;
function handlePreviewInput(event, input, contents, isAppUrl) {
  if (input.type !== 'keyDown' || !input.control || !input.shift || input.alt || input.meta) return false;
  const zero = input.code === 'Digit0' || input.code === 'Numpad0' ||
    (!input.code && ['0', ')'].includes(String(input.key)));
  if (!zero || !contents || contents.isDestroyed() || !isAppUrl(contents.getURL())) return false;
  event.preventDefault();
  if (!input.isAutoRepeat) {
    // No reload, URL change, storage, draft reset or new window. With no site
    // listener installed yet the event is intentionally a harmless no-op.
    contents.executeJavaScript(SCRIPT).catch(error =>
      console.warn('Interface preview hook unavailable:', error.message));
  }
  return true;
}
module.exports = { EVENT, SCRIPT, handlePreviewInput };