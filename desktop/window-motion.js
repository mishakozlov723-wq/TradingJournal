'use strict';
// Animate frozen pictures, never live native bounds. The real journal stays alive.
function createWindowMotion({getWindow,getView,createOverlay,onFrame=()=>{},duration=340,timeout=3000,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  let task=null;
  const available=w=>w&&!w.isDestroyed();
  const active=t=>task===t&&available(getWindow());
  const paintScript=`new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));})`;
  function restore(t){
    const w=getWindow();if(available(w)){try{w.setOpacity(t.opacity);}catch(_){}}
    for(const wc of t.throttled){try{if(!wc.isDestroyed())wc.setBackgroundThrottling(true);}catch(_){}}
    t.throttled.length=0;
  }
  function cancel(){
    if(!task)return;const t=task;task=null;clearTimeout(t.watchdog);t.abort();restore(t);
    try{if(available(t.overlay))t.overlay.destroy();}catch(_){}
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
    const images=await bounded(t,Promise.all([v.webContents.capturePage(),
      top?w.webContents.capturePage({x:0,y:0,width:rect.width,height:top}):null]));
    if(!active(t)||!images||images[0].isEmpty())return null;
    return {rect,top,body:'data:image/jpeg;base64,'+images[0].toJPEG(90).toString('base64'),
      title:images[1]&&!images[1].isEmpty()?images[1].toDataURL():''};
  }
  async function prepare(target,animate=true){
    cancel();const w=getWindow(),v=getView();
    if(!animate||!available(w)||!w.isVisible()||!v||!createOverlay)return false;
    const from=w.getContentBounds(),x=Math.min(from.x,target.x)-12,y=Math.min(from.y,target.y)-12;
    const union={x,y,width:Math.max(from.x+from.width,target.x+target.width)-x+12,
      height:Math.max(from.y+from.height,target.y+target.height)-y+12};
    if(union.width*union.height>14000000)return false;
    let abort;
    const t={opacity:w.getOpacity(),overlay:null,throttled:[],union,
      aborted:new Promise(resolve=>{abort=resolve;}),abort:()=>abort(null)};
    task=t;t.watchdog=setTimeout(()=>{if(task===t)cancel();},timeout);t.watchdog.unref?.();
    try{
      for(const wc of [w.webContents,v.webContents])if(typeof wc.setBackgroundThrottling==='function'){
        wc.setBackgroundThrottling(false);t.throttled.push(wc);
      }
      t.overlay=createOverlay(union);
      const results=await bounded(t,Promise.all([capture(t),t.overlay.ready]));
      const source=results&&results[0];
      if(!source||!active(t)){if(task===t)cancel();return false;}
      if(!active(t)||!available(t.overlay))return false;
      await bounded(t,t.overlay.webContents.executeJavaScript(`window.syterTransition.prepare(${JSON.stringify({source,union})})`));
      if(!active(t))return false;t.overlay.showInactive();await bounded(t,sleep(34));
      if(!active(t)||!w.isVisible()){if(task===t)cancel();return false;}
      w.setOpacity(0);return true;
    }catch(err){if(task===t)cancel();console.warn('Transition cover unavailable:',err.message);return false;}
  }
  async function move(target,animate=true,applyNative){
    const w=getWindow();if(!available(w)){cancel();return false;}
    const t=task;if(!animate)cancel();
    try{
      if(applyNative)applyNative();else w.setBounds(target);onFrame();
      if(!animate||!t||!active(t))return true;
      await paint(t);const destination=await capture(t);
      if(!destination||!active(t)){if(task===t)cancel();return false;}
      await bounded(t,t.overlay.webContents.executeJavaScript(`window.syterTransition.play(${JSON.stringify({destination,duration})})`));
      if(!active(t))return false;restore(t);await bounded(t,sleep(50));
      if(task===t)cancel();return true;
    }catch(err){if(task===t)cancel();console.warn('Transition failed; keeping the live journal:',err.message);return false;}
  }
  return {prepare,move,cancel,isActive:()=>!!task};
}
module.exports={createWindowMotion};
