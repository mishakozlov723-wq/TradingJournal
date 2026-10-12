/* Shared multi-image drafts, private image documents and in-window gallery. */
(function () {
  'use strict';
  // SVG paths from the project Lucide pack (icons/LICENSE-lucide.txt).
  const icons = {"chevron-left":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m15 18-6-6 6-6\"/></svg>","chevron-right":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m9 18 6-6-6-6\"/></svg>","x":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/></svg>","plus":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 12h14\"/><path d=\"M12 5v14\"/></svg>","calendar-days":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M8 13h.01\"/><path d=\"M12 13h.01\"/><path d=\"M16 13h.01\"/><path d=\"M8 17h.01\"/><path d=\"M12 17h.01\"/><path d=\"M16 17h.01\"/></svg>"};
  const $ = id => document.getElementById(id), MAX = 10;
  let draft = [], revision = 0, queue = Promise.resolve(), busy = 0;
  const cache = new Map();
  function remember(id,data){cache.delete(id);cache.set(id,data);while(cache.size>40)cache.delete(cache.keys().next().value);}
  const field = $('tradeScreenshotField');
  const strip = document.createElement('div'); strip.className = 'tj-image-strip';
  const actions = document.createElement('div'); actions.className = 'tj-image-actions';
  actions.innerHTML = '<button type="button" class="ghost-btn" id="tjImageAdd" title="Добавить изображения">＋</button><span id="tjImageCount"></span><span id="tjImageStatus" role="status"></span>';
  field.append(strip, actions);
  $('tjImageAdd').innerHTML=icons.plus;
  document.querySelectorAll('.datetime-calendar-trigger').forEach(b=>{b.innerHTML=icons['calendar-days'];b.classList.add('tj-calendar-icon');});
  $('screenshotInput').multiple = true;
  $('tjImageAdd').onclick = () => $('screenshotInput').click();
  function message(text) { $('tjImageStatus').textContent = text || ''; }
  function draw() {
    currentScreenshot = draft[0] ? draft[0].data : null;
    strip.replaceChildren();
    draft.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'tj-image-item';
      const img = document.createElement('img'); img.src = item.data; img.alt = 'График ' + (index + 1);
      img.onclick = () => gallery(draft.map(x => x.data), index);
      card.append(img);
      [['←','Левее',-1],['→','Правее',1],['×','Удалить',0]].forEach(([text,title,delta]) => {
        const button = document.createElement('button'); button.type='button'; button.innerHTML=icons[delta===0?'x':delta<0?'chevron-left':'chevron-right']; button.setAttribute('aria-label',title); button.title=title;
        button.disabled = busy > 0 || (delta && (index+delta<0 || index+delta>=draft.length));
        button.onclick=()=>{if(delta) [draft[index],draft[index+delta]]=[draft[index+delta],draft[index]];else draft.splice(index,1);draw();};card.append(button);
      });
      strip.append(card);
    });
    $('tjImageCount').textContent = draft.length ? draft.length + ' / ' + MAX : '';
    $('screenshotPreviewWrap').style.display='none';
    document.dispatchEvent(new CustomEvent('tj:images-changed'));
  }
  function reset(items) { revision++; draft = (items || []).map(data=>({data})); draw(); }
  async function encode(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type) || file.size > 25*1024*1024) throw Error('Нужно изображение до 25 МБ.');
    let size=2274, quality=.9;
    for(let i=0;i<7;i++) { const data=await compressImage(file,size,quality);if(data.length<650000)return data;size=Math.round(size*.86);quality-=.04; }
    throw Error('Изображение слишком большое.');
  }
  function add(files) {
    const token=revision, owner=viewingUser; busy++; message('Подготовка…');
    queue=queue.catch(()=>{}).then(async()=>{
      for(const file of files) {
        if(token!==revision || owner!==viewingUser)return;
        if(draft.length>=MAX)throw Error('В одной позиции максимум 10 изображений.');
        const data=await encode(file);
        if(token!==revision || owner!==viewingUser)return;
        if(!draft.some(x=>x.data===data))draft.push({data});
        draw();
      }
    }).catch(err=>{if(token===revision)message(err.message);}).finally(()=>{busy--;if(!busy){draw();if($('tjImageStatus').textContent==='Подготовка…')message('');}});
    return queue;
  }
  async function addData(data) { const owner=viewingUser,token=revision;const blob=await (await fetch(data)).blob();if(owner!==viewingUser||token!==revision)return;return add([new File([blob],'TradingView.png',{type:blob.type})]); }
  function snapshot() { return draft.map(x=>x.data); }
  async function prepare(trade) {
    if(!Array.isArray(trade._images))return [];
    const docs=[];
    for(let data of trade._images) {
      if(typeof data!=='string'||!data.startsWith('data:image/'))throw Error('Недопустимое изображение.');
      if(data.length>=650000){const blob=await(await fetch(data)).blob();data=await encode(blob);}
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const id=trade.id+'_'+hash.slice(0,32); docs.push({id,uid:trade.uid,tradeId:trade.id,data});
    }
    if(docs.length>MAX)throw Error('Слишком много изображений.');
    trade.images=docs.map(x=>({id:x.id}));
    trade.chart=null;
    if(docs.length){const blob=await(await fetch(docs[0].data)).blob();trade.chart=await compressImage(blob,800,.72);}
    delete trade._images;
    return docs;
  }
  async function write(collection,trade,fields,isNew) {
    const record=Object.assign({},trade), docs=await prepare(record), batch=db.batch();
    docs.forEach(doc=>batch.set(db.collection('tradeImages').doc(doc.id),doc));
    if(Array.isArray(trade._images)) (trade.images||[]).forEach(ref=>{if(!record.images.some(x=>x.id===ref.id))batch.delete(db.collection('tradeImages').doc(ref.id));});
    const payload=fields ? Object.fromEntries(fields.filter(k=>k in record).map(k=>[k,record[k]])) : record;
    if(docs.length || Array.isArray(trade._images)){payload.images=record.images;payload.chart=record.chart;}
    batch.set(db.collection(collection).doc(record.id),payload,{merge:!isNew});
    await batch.commit();
    // Apply only after the entire image+trade transaction has succeeded.
    if(Array.isArray(trade._images)){trade.images=record.images;trade.chart=record.chart;delete trade._images;}
    docs.forEach(doc=>remember(doc.id,doc.data));
    return record;
  }
  async function sources(trade) {
    if(!Array.isArray(trade.images)||!trade.images.length)return trade.chart?[trade.chart]:[];
    return Promise.all(trade.images.map(async ref=>{
      if(cache.has(ref.id))return cache.get(ref.id);
      const snap=await db.collection('tradeImages').doc(ref.id).get();
      if(!snap.exists)throw Error('Не удалось найти изображение.');
      const data=snap.data().data;remember(ref.id,data);return data;
    }));
  }
  let galleryToken=0, galleryItems=[], galleryIndex=0;
  const nav=document.createElement('div');nav.className='tj-gallery-nav';
  nav.innerHTML='<button type="button" aria-label="Предыдущее">'+icons['chevron-left']+'</button><span></span><button type="button" aria-label="Следующее">'+icons['chevron-right']+'</button>';
  $('fullscreenImgOverlay').append(nav);
  function show(){ $('fullscreenImg').src=galleryItems[galleryIndex]||'';nav.querySelector('span').textContent=(galleryIndex+1)+' / '+galleryItems.length;nav.hidden=galleryItems.length<2; }
  nav.children[0].onclick=e=>{e.stopPropagation();galleryIndex=(galleryIndex+galleryItems.length-1)%galleryItems.length;show();};
  nav.children[2].onclick=e=>{e.stopPropagation();galleryIndex=(galleryIndex+1)%galleryItems.length;show();};
  async function gallery(trade,index) {
    const token=++galleryToken, owner=viewingUser;galleryItems=[];nav.hidden=true;
    $('fullscreenImg').src=Array.isArray(trade)?trade[index||0]:(trade.chart||'');$('fullscreenImgOverlay').classList.add('open');
    try {const items=Array.isArray(trade)?trade:await sources(trade);if(token!==galleryToken||owner!==viewingUser)return;galleryItems=items;galleryIndex=Math.min(index||0,Math.max(0,items.length-1));show();}
    catch(err){if(token===galleryToken){nav.hidden=false;nav.querySelector('span').textContent=err.message;}}
  }
  document.addEventListener('keydown',e=>{if(!$('fullscreenImgOverlay').classList.contains('open')||!galleryItems.length)return;if(e.key==='ArrowLeft')nav.children[0].click();if(e.key==='ArrowRight')nav.children[2].click();});
  $('screenshotInput').addEventListener('change',e=>{e.stopImmediatePropagation();add(Array.from(e.target.files||[]));e.target.value='';},true);
  document.addEventListener('paste',e=>{if(!$('modalOverlay').classList.contains('open'))return;const files=Array.from(e.clipboardData?.items||[]).filter(x=>x.kind==='file'&&x.type.startsWith('image/')).map(x=>x.getAsFile());if(files.length){e.preventDefault();e.stopImmediatePropagation();add(files);}},true);
  field.addEventListener('dragover',e=>e.preventDefault());field.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();add(Array.from(e.dataTransfer.files||[]));});
  async function edit(trade,save) {
    const owner=viewingUser;
    try {const data=await sources(trade);if(owner!==viewingUser)return;
      const box=document.createElement('dialog');box.className='tj-media-editor';box.innerHTML='<h3>Изображения позиции</h3><div class="tj-editor-items"></div><input type="file" accept="image/*" multiple><p role="status"></p><button type="button">Сохранить</button><button type="button">Отмена</button>';document.body.append(box);
      let working=data.slice(), loading=false;const items=box.querySelector('div'),buttons=box.querySelectorAll('button');
      function paint(){items.replaceChildren();working.forEach((src,i)=>{const row=document.createElement('div');row.className='tj-image-item';const img=document.createElement('img');img.src=src;row.append(img);for(const delta of [-1,1,0]){const b=document.createElement('button');b.innerHTML=icons[delta===0?'x':delta<0?'chevron-left':'chevron-right'];b.setAttribute('aria-label',delta===0?'Удалить':delta<0?'Левее':'Правее');b.disabled=loading||!!(delta&&(i+delta<0||i+delta>=working.length));b.onclick=()=>{if(delta)[working[i],working[i+delta]]=[working[i+delta],working[i]];else working.splice(i,1);paint();};row.append(b);}items.append(row);});}
      box.querySelector('input').onchange=async e=>{loading=true;buttons[0].disabled=true;try{for(const f of e.target.files){if(working.length>=MAX)throw Error('Максимум 10 изображений.');const d=await encode(f);if(!working.includes(d))working.push(d);}}catch(err){box.querySelector('p').textContent=err.message;}finally{loading=false;buttons[0].disabled=false;paint();}};
      buttons[1].onclick=()=>box.close();box.onclose=()=>box.remove();
      box.addEventListener('paste',async e=>{const files=Array.from(e.clipboardData?.items||[]).filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile());if(!files.length)return;e.preventDefault();loading=true;buttons[0].disabled=true;try{for(const f of files){if(working.length>=MAX)throw Error('Максимум 10 изображений.');const data=await encode(f);if(!working.includes(data))working.push(data);}}catch(err){box.querySelector('p').textContent=err.message;}finally{loading=false;buttons[0].disabled=false;paint();}});
      buttons[0].onclick=async()=>{if(loading||owner!==viewingUser)return;buttons[0].disabled=true;try{const next=Object.assign({},trade,{_images:working});await write(trade.backtestId?'backtestTrades':'trades',next,['images','chart'],false);if(owner===viewingUser){trade.images=next.images;trade.chart=next.chart;if(!trade.backtestId&&typeof tjServerTrades!=='undefined'){const base=tjServerTrades[trade.id]||{};base.images=next.images;base.chart=next.chart;tjServerTrades[trade.id]=base;}save();}box.close();}catch(err){box.querySelector('p').textContent='Не сохранено: '+err.message;buttons[0].disabled=false;}};
      paint();box.showModal();
    }catch(err){alert(err.message);}
  }
  window.TJMedia={reset,add,addData,snapshot,prepare,write,sources,gallery,edit,get revision(){return revision;},get busy(){return busy>0;},clearCache(){cache.clear();galleryToken++;}};
  // Desktop markup arrives after the site loads. These cosmetic changes are
  // served with the site, so installed desktop 1.2.1 needs no replacement.
  function polishDesktop() {
    const capture=$('syterCaptureImages'), expand=$('syterMiniExpand'), mini=document.querySelector('.syter-to-mini');
    if(!capture||!expand||!mini)return false;
    expand.textContent='Развернуть';mini.textContent='Мини-журнал';
    const label=capture.closest('label');
    if(label)label.addEventListener('click',e=>{if(e.target!==capture)e.preventDefault();});
    const state=$('syterCaptureState');
    function sync(){state.dataset.on=state.textContent.includes('включено')?'true':'false';}
    sync();new MutationObserver(sync).observe(state,{childList:true,characterData:true,subtree:true});
    return true;
  }
  if(!polishDesktop()&&window.syterDesktop){const observer=new MutationObserver(()=>{if(polishDesktop())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});}
  draw();
})();
