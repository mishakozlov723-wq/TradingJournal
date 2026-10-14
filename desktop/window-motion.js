'use strict';
// Animate frozen pictures, never live native bounds. The real journal stays alive.
function createWindowMotion({getWindow,getView,createOverlay,onFrame=()=>{},onStage=()=>{},duration=340,timeout=3000,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  let task=null,cover=null,coverReady=null;
  const available=w=>w&&!w.isDestroyed();
  const active=t=>task===t&&available(getWindow());
  const paintScript=`new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));})`;
  function restore(t){
    if(t.restored)return;t.restored=true;
    const w=getWindow();if(available(w)){try{w.setOpacity(t.opacity);}catch(_){}}
    for(const wc of t.throttled){try{if(!wc.isDestroyed())wc.setBackgroundThrottling(true);}catch(_){}}
    t.throttled.length=0;
  }
  function clearCover(){
    if(available(cover))cover.webContents.executeJavaScript('window.syterTransition?.clear()').catch(()=>{});
  }
  function cancel(dispose=false){
    const t=task;
    if(t){task=null;clearTimeout(t.watchdog);t.abort();restore(t);onStage('closed');}
    clearCover();
    if(dispose){try{if(available(cover))cover.destroy();}catch(_){}cover=null;coverReady=null;}
  }
  async function warm(bounds){
    if(!createOverlay)return null;
    if(available(cover))return coverReady;
    let candidate;
    try{
      candidate=createOverlay(bounds||getWindow().getContentBounds());
      cover=candidate;
      coverReady=(async()=>{
        await candidate.ready;
        if(!available(candidate))return null;
        // Show ONE empty, click-through surface ahead of time. Windows may
        // animate a newly shown HWND independently of the page's rAF/paint.
        // It must finish doing so while the journal is still fully visible,
        // never while its screenshot is replacing the live window.
        candidate.showInactive();
        await sleep(250);
        return available(candidate)?candidate:null;
      })();
      return await coverReady;
    }catch(err){
      if(available(candidate))candidate.destroy();
      if(cover===candidate){cover=null;coverReady=null;}
      console.warn('Transition compositor unavailable:',err.message);return null;
    }
  }
  const bounded=(t,promise)=>Promise.race([promise,t.aborted]);
  async function paint(t){
    const v=getView(),w=getWindow();if(!active(t)||!v||v.webContents.isDestroyed())return;
    await bounded(t,v.webContents.executeJavaScript(paintScript));
    if(active(t))await bounded(t,w.webContents.executeJavaScript(paintScript));
  }
  async function capture(t){
    const w=getWindow(),v=getView();if(!active(t)||!v||v.webContents.isDestroyed())return null;
    const rect=w.getContentBounds(),top=w.isFullScreen()?0:36;
    const images=await bounded(t,Promise.all([
      v.webContents.capturePage().then(image=>{onStage('body-captured');return image;}),
      top?w.webContents.capturePage({x:0,y:0,width:rect.width,height:top})
        .then(image=>{onStage('title-captured');return image;}):null]));
    if(!active(t)||!images||images[0].isEmpty())return null;
    return {rect,top,maximized:typeof w.isMaximized==='function'&&w.isMaximized(),fullscreen:w.isFullScreen(),
      // A handoff must not change text contrast/color through JPEG artifacts.
      body:images[0].toDataURL(),
      title:images[1]&&!images[1].isEmpty()?images[1].toDataURL():''};
  }
  async function prepare(target,animate=true){
    cancel();const w=getWindow(),v=getView();
    if(!animate||!available(w)||!w.isVisible()||!v||!createOverlay){onStage('skipped');return false;}
    const from=w.getContentBounds(),x=Math.min(from.x,target.x),y=Math.min(from.y,target.y);
    // No artificial shadow/padding: an oversized constructor viewport can be
    // clamped to the work area on Windows, clipping the destination by 12 px.
    const union={x,y,width:Math.max(from.x+from.width,target.x+target.width)-x,
      height:Math.max(from.y+from.height,target.y+target.height)-y};
    if(union.width*union.height>14000000)return false;
    let abort;
    const t={opacity:w.getOpacity(),overlay:null,throttled:[],union,
      aborted:new Promise(resolve=>{abort=resolve;}),abort:()=>abort(null)};
    task=t;t.watchdog=setTimeout(()=>{if(task===t){onStage('watchdog');cancel(true);}},timeout);t.watchdog.unref?.();
    try{
      for(const wc of [w.webContents,v.webContents])if(typeof wc.setBackgroundThrottling==='function'){
        wc.setBackgroundThrottling(false);t.throttled.push(wc);
      }
      t.overlay=await bounded(t,warm(union));
      if(!active(t)||!available(t.overlay)){if(task===t)cancel();return false;}
      // The persistent surface is empty while its viewport is repositioned.
      t.overlay.setBounds(union);
      onStage('capturing-source');
      const source=await capture(t);
      if(!source||!active(t)){if(task===t)cancel();return false;}
      onStage('source-and-cover-ready');
      if(!active(t)||!available(t.overlay))return false;
      await bounded(t,t.overlay.webContents.executeJavaScript(`window.syterTransition.prepare(${JSON.stringify({source,union})})`));
      onStage('cover-painted');
      if(!active(t))return false;t.overlay.moveTop?.();
      // No show(), new native window or whole-pane opacity animation here.
      // Present an opaque picture on the already-visible compositor.
      await bounded(t,t.overlay.webContents.executeJavaScript('window.syterTransition.reveal()'));
      if(!active(t)||!w.isVisible()){if(task===t)cancel();return false;}
      await bounded(t,onStage('cover-presented',{overlay:t.overlay,source,union}));
      if(!active(t))return false;
      w.setOpacity(0);onStage('live-concealed');return true;
    }catch(err){if(task===t)cancel(true);console.warn('Transition cover unavailable:',err.message);return false;}
  }
  async function move(target,animate=true,applyNative){
    const w=getWindow();if(!available(w)){cancel();return false;}
    const t=task;if(!animate)cancel();
    try{
      if(applyNative)applyNative();else w.setBounds(target);onFrame();
      onStage('native-settled');
      if(!animate||!t||!active(t))return true;
      // Pinning the mini journal changes HWND z-order on Windows. Keep the
      // cover above it until the live destination is ready for the handoff.
      t.overlay.moveTop?.();
      await paint(t);const destination=await capture(t);
      onStage('destination-captured');
      if(!destination||!active(t)){if(task===t)cancel();return false;}
      await bounded(t,t.overlay.webContents.executeJavaScript(`window.syterTransition.play(${JSON.stringify({destination,duration})})`));
      onStage('playback-completed');
      if(!active(t))return false;
      // play() finishes on an unscaled, pixel-aligned destination picture.
      await bounded(t,onStage('destination-presented',{overlay:t.overlay,destination,union:t.union}));
      if(!active(t))return false;restore(t);await paint(t);
      if(!active(t))return false;
      await bounded(t,t.overlay.webContents.executeJavaScript('window.syterTransition.release()'));
      onStage('live-presented');
      if(task===t)cancel();return true;
    }catch(err){if(task===t)cancel(true);console.warn('Transition failed; keeping the live journal:',err.message);return false;}
  }
  return {prepare,move,cancel,warm,isActive:()=>!!task};
}
module.exports={createWindowMotion};
