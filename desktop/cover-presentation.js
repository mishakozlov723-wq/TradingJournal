'use strict';
// rAF acknowledges JavaScript scheduling, not an opaque submitted frame.
// Verify the captured compositor frame before allowing the live app to vanish.
function opaqueSnapshotMatcher(source, union, decodeImage) {
  const expected = decodeImage(source.body), size = expected.getSize();
  const padding = 8, bodyHeight = source.rect.height - source.top;
  if (expected.isEmpty() || source.rect.width <= 2 * padding || bodyHeight <= 2 * padding)
    throw Error('Invalid transition snapshot');
  const expectedPixels = expected.crop({
    x: Math.round(padding * size.width / source.rect.width),
    y: Math.round(padding * size.height / bodyHeight),
    width: Math.round((source.rect.width - 2 * padding) * size.width / source.rect.width),
    height: Math.round((bodyHeight - 2 * padding) * size.height / bodyHeight),
  }).resize({width: 64, height: 64, quality: 'good'}).toBitmap();
  return image => {
    if (!image || image.isEmpty()) return false;
    const frame = image.getSize(), sx = frame.width / union.width, sy = frame.height / union.height;
    const crop = {
      x: Math.round((source.rect.x - union.x + padding) * sx),
      y: Math.round((source.rect.y - union.y + source.top + padding) * sy),
      width: Math.round((source.rect.width - 2 * padding) * sx),
      height: Math.round((bodyHeight - 2 * padding) * sy),
    };
    if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > frame.width ||
        crop.y + crop.height > frame.height || crop.width < 1 || crop.height < 1) return false;
    const pixels = image.crop(crop).resize({width: 64, height: 64, quality: 'good'}).toBitmap();
    if (pixels.length !== expectedPixels.length || !pixels.length) return false;
    let difference = 0, mismatched = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 254) return false; // empty/stale/partly transparent surface
      let delta = 0;
      for (let c = 0; c < 3; c++) delta += Math.abs(pixels[i + c] - expectedPixels[i + c]);
      difference += delta;
      if (delta > 60) mismatched++;
    }
    return difference / (pixels.length / 4 * 3) < 2 && mismatched < pixels.length / 4 * .02;
  };
}
function armPresentation(contents, matches, {timeout = 1000} = {}) {
  let finished = false, subscribed = false, timer, resolve;
  const promise = new Promise(r => { resolve = r; });
  function finish(accepted) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    if (subscribed && !contents.isDestroyed()) {
      try { contents.endFrameSubscription(); } catch (_) {}
    }
    resolve(accepted);
  }
  try {
    subscribed = true;
    contents.beginFrameSubscription(false, image => {
      try { if (matches(image)) finish(true); } catch (_) { finish(false); }
    });
    if (!finished) timer = setTimeout(() => finish(false), timeout);
  } catch (_) { finish(false); }
  return {promise, cancel: () => finish(false)};
}
module.exports = {opaqueSnapshotMatcher, armPresentation};