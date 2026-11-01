'use strict';
// First-launch geometry. A saved normal rectangle is reused only while its
// title strip (the part the user drags) is still on a connected display;
// otherwise, e.g. after a monitor was unplugged, the window is centered on
// the primary work area instead of opening invisibly off-screen.
const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_SIZE = { width: 380, height: 500 };

const finite = value => typeof value === 'number' && Number.isFinite(value);
const validArea = area => !!area && ['x', 'y', 'width', 'height'].every(key => finite(area[key])) &&
  area.width > 0 && area.height > 0;

function overlap(a, b) {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

function titleStripReachable(rect, areas, titlebarHeight) {
  const strip = { x: rect.x, y: rect.y, width: rect.width, height: Math.min(titlebarHeight, rect.height) };
  const needWidth = Math.min(160, strip.width), needHeight = Math.min(20, strip.height);
  return areas.some(area => {
    const visible = overlap(strip, area);
    return visible.width >= needWidth && visible.height >= needHeight;
  });
}

function workAreas(screen) {
  try { return (screen.getAllDisplays() || []).map(display => display && display.workArea).filter(validArea); }
  catch (_) { return []; }
}

function primaryArea(screen, areas) {
  try {
    const area = screen.getPrimaryDisplay().workArea;
    if (validArea(area)) return area;
  } catch (_) { /* fall through */ }
  return areas[0] || null;
}

function initialWindowBounds(saved, screen, options = {}) {
  const titlebarHeight = options.titlebarHeight || 36;
  const min = options.minSize || MIN_SIZE, fallback = options.defaultSize || DEFAULT_SIZE;
  const source = saved && typeof saved === 'object' ? saved : {};
  const size = key => finite(source[key]) && source[key] > 0 ? Math.round(source[key]) : fallback[key];
  let width = size('width'), height = size('height');
  const areas = workAreas(screen);
  if (finite(source.x) && finite(source.y)) {
    const rect = { x: Math.round(source.x), y: Math.round(source.y), width, height };
    if (titleStripReachable(rect, areas, titlebarHeight)) return rect;
  }
  const area = primaryArea(screen, areas);
  if (!area) return { width, height };
  width = Math.max(Math.min(width, area.width), Math.min(min.width, area.width));
  height = Math.max(Math.min(height, area.height), Math.min(min.height, area.height));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width, height,
  };
}

module.exports = { initialWindowBounds, titleStripReachable };
