'use strict';
// Desktop overview column: .wrap max-width 1016px + body padding 19px each.
// CSS pixels, converted to Electron DIPs through webContents.getZoomFactor().
const DEFAULT_CSS_MINIMUM = 1016 + 19 * 2;
const PAGE_MINIMUM_SCRIPT = `(() => {
  const root = document.getElementById('appRoot');
  if (!root || document.body.classList.contains('mobile-mode')) return null;
  const column = parseFloat(getComputedStyle(root).maxWidth);
  if (!Number.isFinite(column) || column <= 0) return null;
  const body = getComputedStyle(document.body);
  const px = key => parseFloat(body[key]) || 0;
  return Math.ceil(column + px('paddingLeft') + px('paddingRight') + px('marginLeft') + px('marginRight'));
})()`;
function createWindowWidthPolicy({getWindow,getContents,screen,isMini=()=>false}) {
  let cssMinimum = DEFAULT_CSS_MINIMUM;
  function minimum(bounds) {
    const win = getWindow();
    const area = screen.getDisplayMatching(bounds).workArea;
    let zoom = 1;
    const contents = getContents();
    if (contents && !contents.isDestroyed() && typeof contents.getZoomFactor === 'function') zoom = contents.getZoomFactor();
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
    const outer = win.getBounds().width;
    const content = win.getContentSize()[0];
    const frame = Math.max(0,outer-content);
    // Never create an inaccessible window wider than the monitor work area.
    return {width:Math.min(area.width,Math.ceil(cssMinimum*zoom+frame)),area};
  }
  function constrain(bounds) {
    const {width:floor,area} = minimum(bounds);
    const width = Math.min(area.width,Math.max(bounds.width,floor));
    return {...bounds,width,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width))};
  }
  function refresh({grow=true}={}) {
    const win = getWindow();
    if (!win || win.isDestroyed() || isMini()) return;
    const bounds=win.getBounds(), next=minimum(bounds);
    const current=win.getMinimumSize ? win.getMinimumSize() : null;
    if (!current || current[0]!==next.width || current[1]!==500) win.setMinimumSize(next.width,500);
    // OS tracking limits restrict user drags. Explicit setBounds() must also
    // be clamped at startup/restore, as Electron intentionally permits bypass.
    if (grow && !win.isMaximized() && !win.isFullScreen() && bounds.width<next.width)
      win.setBounds(constrain(bounds));
  }
  function updateCssMinimum(value) {
    if (Number.isFinite(value) && value>0 && value<10000) cssMinimum=Math.ceil(value);
    refresh();
  }
  return {refresh,constrain,updateCssMinimum,minimum};
}
module.exports={DEFAULT_CSS_MINIMUM,PAGE_MINIMUM_SCRIPT,createWindowWidthPolicy};
