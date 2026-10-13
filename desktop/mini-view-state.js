/* Shared by the modern and legacy form adapters. In-memory state only. */
(()=>{
  'use strict';
  const overlay=document.getElementById('modalOverlay'),root=document.getElementById('appRoot');
  if(!overlay||!root||window.syterJournalView)return;
  let entry=null,parkedOwner=null;
  function scrolls(){return [...root.querySelectorAll('*')].filter(el=>el.scrollTop||el.scrollLeft)
    .map(el=>({el,top:el.scrollTop,left:el.scrollLeft}));}
  function restoreScroll(){
    if(!entry||document.body.classList.contains('syter-mini'))return;
    for(const p of entry.scrolls)if(p.el.isConnected){p.el.scrollTop=p.top;p.el.scrollLeft=p.left;}
    window.scrollTo(entry.x,entry.y);
  }
  const state=window.syterJournalView={
    begin(owner){entry={owner,modalOpen:overlay.classList.contains('open'),
      x:window.scrollX,y:window.scrollY,scrolls:scrolls(),focus:document.activeElement};},
    openDraft(owner,fresh){
      if(overlay.classList.contains('open'))return;
      if(parkedOwner===owner){parkedOwner=null;overlay.classList.add('open');}
      else{parkedOwner=null;fresh();}
    },
    leave(owner){
      if(!entry||entry.owner!==owner){this.invalidate();return;}
      if(!entry.modalOpen){parkedOwner=owner;overlay.classList.remove('open');}
      restoreScroll();
    },
    finish(owner){
      if(!entry||entry.owner!==owner){this.invalidate();return;}
      restoreScroll();
      if(entry.focus&&entry.focus.isConnected&&!overlay.classList.contains('open'))entry.focus.focus({preventScroll:true});
      entry=null;
    },
    isParked(){return parkedOwner!==null&&!overlay.classList.contains('open');},
    invalidate(discard=false){
      entry=null;parkedOwner=null;
      if(discard)document.dispatchEvent(new Event('syter:parked-draft-discarded'));
    },
  };
  window.addEventListener('resize',restoreScroll);
  document.addEventListener('click',e=>{
    const button=e.target.closest&&e.target.closest('#openAddModal,#openAddModalMonth,#openAddModalWeek');
    if(!button||!state.isParked())return;
    const owner=typeof viewingUser==='undefined'?null:viewingUser;
    if(owner!==parkedOwner||typeof currentUser==='undefined'||!currentUser){state.invalidate();return;}
    e.preventDefault();e.stopImmediatePropagation();state.openDraft(owner,()=>{});
  },true);
  setInterval(()=>{
    const owner=typeof viewingUser==='undefined'?null:viewingUser;
    if(parkedOwner!==null&&(owner!==parkedOwner||typeof currentUser==='undefined'||!currentUser||root.style.display==='none')){
      state.invalidate(true);const form=document.getElementById('tradeForm');if(form)form.reset();
      const notes=document.getElementById('syterTradeNotes');if(notes)notes.value='';
      if(window.TJMedia)window.TJMedia.reset();if(typeof currentScreenshot!=='undefined')currentScreenshot=null;
      const image=document.getElementById('screenshotPreview');if(image)image.removeAttribute('src');
      const wrap=document.getElementById('screenshotPreviewWrap');if(wrap)wrap.style.display='none';
    }
  },250);
})();
