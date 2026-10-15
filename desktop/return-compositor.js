'use strict';
const path = require('node:path');
const {opaqueSnapshotMatcher,armPresentation} = require('./cover-presentation');
// Shared by BOTH directions. This surface is empty/click-through at rest.
function createReturnCompositor({BrowserWindow,nativeImage},bounds) {
  const cover = new BrowserWindow({...bounds,show:false,frame:false,transparent:true,
    backgroundColor:'#00000000',hasShadow:false,thickFrame:false,focusable:false,
    skipTaskbar:true,alwaysOnTop:true,resizable:false,movable:false,
    minimizable:false,maximizable:false,fullscreenable:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  cover.setIgnoreMouseEvents(true);
  cover.ready = cover.loadFile(path.join(__dirname,'mode-transition.html'));
  cover.armPresentation = (source,union) => armPresentation(cover.webContents,
    opaqueSnapshotMatcher(source,union,data=>nativeImage.createFromDataURL(data)),{timeout:1800});
  return cover;
}
module.exports={createReturnCompositor};
