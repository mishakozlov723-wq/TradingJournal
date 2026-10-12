/* Viewport-positioned panels, independent of clipped cards and table wrappers. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),settings=$('versionPanel'),wrap=$('settingsWrap'),button=$('settingsBtn'),note=$('notePanel');
  let anchor=null,frame=0,settingsAnimation=null;
  document.body.append(settings,note);
  settings.classList.add('tj-floating-settings');
  if(settings.showPopover)settings.setAttribute('popover','manual');
  function bounds(){return {w:document.documentElement.clientWidth,h:window.innerHeight};}
  function positionSettings(){
    if(!wrap.classList.contains('open'))return;
    const {w,h}=bounds(),r=button.getBoundingClientRect();
    settings.style.width=Math.min(226,w-16)+'px';settings.style.maxHeight=Math.max(80,h-16)+'px';
    const height=settings.offsetHeight;
    settings.style.left=Math.max(8,Math.min(w-settings.offsetWidth-8,r.right-settings.offsetWidth))+'px';
    settings.style.top=Math.max(8,Math.min(h-height-8,r.bottom+8))+'px';
  }
  function syncSettings(){
    const open=wrap.classList.contains('open');
    if(open&&settings.showPopover&&!settings.matches(':popover-open'))settings.showPopover();
    const wasOpen=settings.classList.contains('tj-open');
    settings.classList.toggle('tj-open',open);
    if(open&&!wasOpen&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(settingsAnimation)settingsAnimation.cancel();
      settingsAnimation=settings.animate([{opacity:0,transform:'translateY(-6px) scale(.985)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});
    }
    if(!open&&settingsAnimation){settingsAnimation.cancel();settingsAnimation=null;}
    if(!open&&settings.hidePopover&&settings.matches(':popover-open'))settings.hidePopover();
    positionSettings();
  }
  new MutationObserver(syncSettings).observe(wrap,{attributes:true,attributeFilter:['class']});
  function positionNote(){
    if(!anchor||!anchor.isConnected)return;
    const {w,h}=bounds(),r=anchor.getBoundingClientRect(),gap=12;
    const leftSpace=r.left-gap-8,rightSpace=w-r.right-gap-8;
    const left=leftSpace>=220||leftSpace>=rightSpace;
    const space=left?leftSpace:rightSpace;
    const width=Math.min(360,w-16,space>=220?space:360);
    note.classList.add('tj-anchored-note');note.style.width=width+'px';note.style.maxHeight=(h-16)+'px';
    const x=left?r.left-gap-width:r.right+gap;
    note.style.left=Math.max(8,Math.min(w-width-8,x))+'px';
    const y=Math.max(8,Math.min(h-note.offsetHeight-8,r.top+r.height/2-note.offsetHeight/2));
    note.style.top=y+'px';note.style.setProperty('--note-origin',(left?'right ':'left ')+Math.max(0,Math.min(note.offsetHeight,r.top+r.height/2-y))+'px');
    note.style.setProperty('--note-from',left?'12px':'-12px');
  }
  new ResizeObserver(()=>{positionSettings();if(note.classList.contains('open'))positionNote();}).observe(note);
  new ResizeObserver(positionSettings).observe(settings);
  function schedule(e){if(e&&e.type==='scroll'&&(note.contains(e.target)||settings.contains(e.target)))return;if(frame)return;frame=requestAnimationFrame(()=>{frame=0;positionSettings();if(note.classList.contains('open'))positionNote();});}
  window.addEventListener('resize',schedule);// Keep the open preview stationary while the page scrolls; only the settings follow their button.
  document.addEventListener('scroll',e=>{if(note.contains(e.target)||settings.contains(e.target))return;positionSettings();},true);
  window.TJPanels={anchorNote(element){anchor=element;if(!anchor)return;note.classList.remove('open');positionNote();void note.offsetWidth;}};
  new MutationObserver(()=>{
    if($('fullscreenImgOverlay').classList.contains('open'))wrap.classList.remove('open');
  }).observe($('fullscreenImgOverlay'),{attributes:true,attributeFilter:['class']});
  syncSettings();
})();
