/* Notes Database Table. Data only lives in its Notes block; persistence/history are supplied by Notes. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotesDatabase = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const TYPES = {text:['Text','type'], date:['Date','calendar'], number:['Number','hash'], checkbox:['Checkbox','square-check'], select:['Select','chevron-down'], status:['Status','circle-dot']};
  const GROUPS = ['Not started','In progress','Complete'];
  const COLORS = {white:'#f5f7fa',black:'#0b0c0f',gray:'#9aa0aa',brown:'#b58f72',orange:'#e79a52',yellow:'#dfbf55',green:'#63c58f',blue:'#6fa9eb',purple:'#a38ce8',pink:'#dc86b6',red:'#e77979',brightRed:'#ff3b30',brightOrange:'#ff8a2a',brightYellow:'#ffd60a',brightGreen:'#20d66b',brightCyan:'#22d3ee',brightBlue:'#3b82f6',brightPurple:'#b56cff',brightPink:'#ff4da6'};
  const FORMATS = ['Number','Percent','USD','EUR','R','RR'];
  const FONT_SIZES = {small:['Small',12],default:['Default',15],large:['Large',17],xlarge:['Extra large',19]};
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = prefix => prefix+'_'+(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
  const string = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const width = v => Math.max(96,Math.min(640,Number(v)||180));
  function normalizeIconFields(target) {
    const icon=string(target.icon).trim().slice(0,128);
    if(!icon){delete target.icon;delete target.iconType;delete target.iconColor;return target;}
    target.icon=icon;target.iconType=target.iconType==='icon'?'icon':'emoji';target.iconColor=string(target.iconColor||'default').trim().slice(0,32)||'default';return target;
  }
  function number(v) {
    if (v == null || String(v).trim() === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(',','.');
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
  }
  function date(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v+'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v ? v : null;
  }
  function options(p) { return Array.isArray(p.config.options) ? p.config.options : []; }
  function label(v,p) {
    if (p.type === 'select' || p.type === 'status') return (options(p).find(o=>o.id===v)||{}).name || '';
    return string(v);
  }
  function value(v,p,createOption) {
    if (p.type==='text') return string(v);
    if (p.type==='number') return number(v);
    if (p.type==='date') return date(v);
    if (p.type==='checkbox') return v===true || v===1 || /^(true|yes|1|да)$/i.test(string(v).trim());
    if (v==null || v==='') return null;
    const list=options(p), found=list.find(o=>o.id===v)||list.find(o=>o.name.toLocaleLowerCase()===string(v).toLocaleLowerCase());
    if (found) return found.id;
    if (!createOption) return null;
    const o={id:uid('opt'),name:string(v),color:'gray',fillColor:'gray',textColor:'gray'};
    if(p.type==='status') o.group=0;
    p.config.options=list;list.push(o);return o.id;
  }
  function property(name='Property',type='text') {
    const p={id:uid('prop'),name,type,width:type==='text'?220:160,config:{}};
    if(type==='number') p.config.format='Number';
    if(type==='select') p.config.options=[];
    if(type==='status') p.config.options=GROUPS.map((name,group)=>{const color=['gray','blue','green'][group];return {id:uid('opt'),name:group===2?'Done':name,color,fillColor:color,textColor:color,group};});
    return p;
  }
  function create() {const primary=property('Name');return {schemaVersion:2,primaryPropertyId:primary.id,properties:[primary,property()],rows:[newRow()],view:{sort:null,layout:'full',fontSize:'default',openMode:'side'}};}
  function newRow(){return {id:uid('row'),cells:{},page:{blocks:[]}};}
  function primary(b){return b.properties.find(p=>p.id===b.primaryPropertyId);}
  function duplicateRow(r){const copy=clone(r);copy.id=uid('row');if(copy.page&&Array.isArray(copy.page.blocks))copy.page.blocks.forEach(block=>{block.id=uid('b');if(block.syncKey)delete block.syncKey;});return copy;}
  function moveProperty(b,id,targetId){const p=b.properties.find(p=>p.id===id),target=b.properties.find(p=>p.id===targetId);if(!p||!target||p===target)return;const to=b.properties.indexOf(target);b.properties.splice(b.properties.indexOf(p),1);b.properties.splice(to,0,p);}

  function normalize(source) {
    const b=clone(object(source)), used=new Set(), mappings=[];
    b.schemaVersion=2;
    b.properties=(Array.isArray(b.properties)&&b.properties.length?b.properties:[property('Name'),property()]).map(raw=>{
      const p={...object(raw)},old=string(p.id);
      p.id=old && !used.has(old) && !['__proto__','constructor','prototype'].includes(old)?old:uid('prop');used.add(p.id);
      mappings.push([p.id,old]);p.name=string(p.name)||'Property';p.type=own(TYPES,p.type)?p.type:'text';p.width=width(p.width);p.config={...object(p.config)};normalizeIconFields(p);
      if(p.type==='number'&&!FORMATS.includes(p.config.format))p.config.format='Number';
      if(p.type==='select'||p.type==='status'){
        const seen=new Set();
        p.config.options=(Array.isArray(p.config.options)?p.config.options:property('',p.type).config.options).map(rawOption=>{
          const o={...object(rawOption)};o.id=typeof o.id==='string'&&o.id&&!seen.has(o.id)?o.id:uid('opt');seen.add(o.id);
          o.name=string(o.name)||'Option';o.color=own(COLORS,o.color)?o.color:'gray';o.fillColor=own(COLORS,o.fillColor)?o.fillColor:o.color;o.textColor=own(COLORS,o.textColor)?o.textColor:o.color;normalizeIconFields(o);
          if(p.type==='status')o.group=[0,1,2].includes(o.group)?o.group:0;
          return o;
        });
      }
      return p;
    });
    let title=b.properties.find(p=>p.id===b.primaryPropertyId);
    if(!title)title=b.properties.find(p=>p.type==='text');
    if(!title){title=property('Name');b.properties.unshift(title);mappings.unshift([title.id,title.id]);}
    // Identity, never physical index, defines the title column. Preserve data on malformed legacy primary types.
    if(title.type!=='text'){const old=clone(title);(Array.isArray(b.rows)?b.rows:[]).forEach(r=>{if(r&&r.cells)r.cells[title.id]=label(r.cells[title.id],old);});title.type='text';}
    b.primaryPropertyId=title.id;b.properties.forEach(p=>{delete p.primary;delete p.isPrimary;});
    const rowIds=new Set();
    b.rows=(Array.isArray(b.rows)?b.rows:[{cells:{}}]).map(raw=>{
      const r={...object(raw)},original=object(r.cells);r.cells={...original};
      r.id=typeof r.id==='string'&&r.id&&!rowIds.has(r.id)?r.id:uid('row');rowIds.add(r.id);
      b.properties.forEach((p,i)=>{
        let v=own(original,mappings[i][1])?original[mappings[i][1]]:original[p.id];
        if(i===0 && (typeof raw!=='object'||Array.isArray(raw)))v=raw;
        // Recover orphan labels as shared options instead of discarding them on load.
        r.cells[p.id]=value(v,p,true);
      });
      r.page={...object(r.page)};normalizeIconFields(r.page);
      if(!Array.isArray(r.page.blocks))r.page.blocks=typeof r.page.blocks==='string'?[{id:uid('b'),type:'text',text:r.page.blocks}]:[];
      return r;
    });
    b.view={...object(b.view)};
    b.view.layout=b.view.layout==='compact'?'compact':'full';
    b.view.fontSize=own(FONT_SIZES,b.view.fontSize)?b.view.fontSize:'default';
    b.view.openMode=['side','full','tab'].includes(b.view.openMode)?b.view.openMode:'side';
    const sort=object(b.view.sort);
    b.view.sort=b.properties.some(p=>p.id===sort.propertyId)&&['asc','desc'].includes(sort.direction)?{propertyId:sort.propertyId,direction:sort.direction}:null;
    return b;
  }
  function changeType(b,id,type) {
    if(!own(TYPES,type)||id===b.primaryPropertyId)return;
    const p=b.properties.find(p=>p.id===id);if(!p||p.type===type)return;
    const old=clone(p);p.type=type;p.config=property('',type).config;
    b.rows.forEach(r=>{r.cells[id]=value(label(r.cells[id],old),p,true);});
  }
  function sorted(b) {
    const sort=b.view&&b.view.sort,p=sort&&b.properties.find(p=>p.id===sort.propertyId);
    if(!p)return b.rows.slice();
    const key=v=>p.type==='status'?(options(p).find(o=>o.id===v)||{}):v;
    return b.rows.slice().sort((a,b)=>{
      let av=a.cells[p.id],bv=b.cells[p.id];
      const ae=av==null||av==='',be=bv==null||bv==='';if(ae||be)return ae===be?0:ae?1:-1;
      let c=0;
      if(p.type==='number'||p.type==='checkbox')c=Number(av)-Number(bv);
      else if(p.type==='status')c=(key(av).group-key(bv).group)||label(av,p).localeCompare(label(bv,p));
      else c=label(av,p).localeCompare(label(bv,p),undefined,{numeric:false,sensitivity:'base'});
      return sort.direction==='desc'?-c:c;
    });
  }
  function formatted(v,p) {
    if(v==null||v==='')return '';
    if(p.type==='number'){
      const n=number(v);if(n===null)return '';
      const f=p.config.format,s=new Intl.NumberFormat(undefined,{maximumFractionDigits:12}).format(n);
      return f==='USD'||f==='EUR'?new Intl.NumberFormat(undefined,{style:'currency',currency:f,maximumFractionDigits:12}).format(n):f==='Percent'?s+'%':f==='R'?s+'R':f==='RR'?s+' RR':s;
    }
    if(p.type==='date'&&date(v))return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'));
    return label(v,p);
  }
  // TSV parser keeps quoted Excel cells (tabs, line breaks and doubled quotes) intact.
  function parseGrid(text) {
    const rows=[[]];let cell='',quoted=false;
    text=String(text).replace(/\r\n?/g,'\n');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'&&(quoted||cell==='')) {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&(c==='\t'||c==='\n')){rows[rows.length-1].push(cell);cell='';if(c==='\n')rows.push([]);}
      else cell+=c;
    }
    rows[rows.length-1].push(cell);
    if(rows.length>1&&rows[rows.length-1].length===1&&rows[rows.length-1][0]==='')rows.pop();
    return rows;
  }
  function paste(b,rowId,propId,text) {
    const grid=parseGrid(text),order=sorted(b),start=order.findIndex(r=>r.id===rowId),col=b.properties.findIndex(p=>p.id===propId);
    if(start<0||col<0)return;
    const count=Math.max(...grid.map(r=>r.length));
    while(b.properties.length<col+count)b.properties.push(property());
    while(order.length<start+grid.length){const r=newRow();b.rows.push(r);order.push(r);}
    grid.forEach((cells,i)=>cells.forEach((v,j)=>{const p=b.properties[col+j];order[start+i].cells[p.id]=value(v,p,true);}));
  }

  let activePopup=null, activeResize=null;
  function close(restore=false) {if(activePopup)activePopup(restore);if(activeResize)activeResize();}
  function el(tag,cls,text) {const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function button(text,fn,cls='') {const b=el('button','ndb-button '+cls,text);b.type='button';b.addEventListener('click',fn);return b;}
  function input(value,label) {const n=el('input','ndb-input');n.value=value;n.setAttribute('aria-label',label);return n;}
  function mount(host,b,bridge) {
    let wrapper,table,focusCell=null,returnFocus=null;
    const readOnly=bridge.readOnly;
    function icon(name){const s=el('span','ndb-icon');s.setAttribute('aria-hidden','true');bridge.icon(s,'line:'+name,'icon','gray');return s;}
    function dataIcon(data,fallback){
      if(data&&data.icon){const s=el('span','ndb-icon ndb-custom-icon');s.setAttribute('aria-hidden','true');bridge.icon(s,data.icon,data.iconType||'emoji',data.iconColor||'default');return s;}
      return fallback?icon(fallback):null;
    }
    function setIcon(data,pick){if(pick&&pick.value){data.icon=pick.value;data.iconType=pick.type==='icon'?'icon':'emoji';data.iconColor=pick.color||'default';}else{delete data.icon;delete data.iconType;delete data.iconColor;}}
    function action(text,name,fn){const n=button('',fn);if(name)n.append(icon(name));n.append(el('span','ndb-label',text));return n;}
    function dataAction(text,data,fallback,fn){const n=button('',fn),ico=dataIcon(data,fallback);if(ico)n.append(ico);n.append(el('span','ndb-label',text));return n;}
    function chooseIcon(anchor,data,after){if(!bridge.openIconPicker)return;bridge.openIconPicker(anchor,{value:data.icon||'',type:data.iconType||'emoji',color:data.iconColor||'default'},pick=>{if(!bridge.valid())return;commit(()=>setIcon(data,pick));if(after)after();});}
    function commit(fn,repaint=true,typing=false){if(!bridge.valid()||readOnly)return false;if(bridge.change(fn,typing)===false)return false;if(repaint){render();if(!activePopup&&returnFocus){if(returnFocus.row&&b.rows.some(r=>r.id===returnFocus.row)&&b.properties.some(p=>p.id===returnFocus.prop))focus(returnFocus.row,returnFocus.prop);else findHeader(b.properties.some(p=>p.id===returnFocus.prop)?returnFocus.prop:b.properties[0].id).focus({preventScroll:true});}}return true;}
    function focus(row,prop){focusCell={row,prop};const n=Array.from(host.querySelectorAll('.ndb-cell')).find(e=>e.dataset.row===row&&e.dataset.property===prop);if(n)n.focus({preventScroll:true});}
    function popup(anchor,title,build){
      if(readOnly||!bridge.valid())return;
      close();bridge.closeMenus();
      returnFocus=anchor.dataset.property?{row:anchor.dataset.row,prop:anchor.dataset.property}:focusCell;
      const panel=el('div','ndb-popup');panel.dataset.fontSize=b.view&&own(FONT_SIZES,b.view.fontSize)?b.view.fontSize:'default';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);panel.tabIndex=-1;
      const originalFocus=focusCell&&{...focusCell};let gone=false;
      function dismiss(restore){if(gone)return;gone=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);observer.disconnect();panel.remove();if(activePopup===dismiss)activePopup=null;if(restore){if(anchor.isConnected)anchor.focus({preventScroll:true});else if(originalFocus)focus(originalFocus.row,originalFocus.prop);}}
      panel._notesNativeDismiss=function(){dismiss(false);};
      function outside(e){if(!panel.contains(e.target)&&!anchor.contains(e.target)){if(document.body.classList.contains('mobile-mode')&&panel._notesMobileDismiss)panel._notesMobileDismiss();else dismiss(false);}}
      function key(e){if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dismiss(true);return;}if(!panel.contains(e.target))return;
        if(e.key==='Tab'){const items=Array.from(panel.querySelectorAll('button:not(:disabled),input,textarea'));if(items.length){const i=items.indexOf(document.activeElement);e.preventDefault();items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();}}
        if(/^Arrow/.test(e.key)){e.stopPropagation();if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;e.preventDefault();const items=Array.from(panel.querySelectorAll('button:not(:disabled)'));const i=items.indexOf(document.activeElement);if(items.length)items[(i+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)+items.length)%items.length].focus();}}
      function place(){if(!anchor.isConnected&&anchor.dataset.property){const previous=anchor;anchor=Array.from(host.querySelectorAll('.ndb-cell,.ndb-header')).find(n=>n.dataset.property===previous.dataset.property&&n.dataset.row===previous.dataset.row)||previous;}if(!anchor.isConnected||!bridge.valid()){dismiss(false);return;}const r=anchor.getBoundingClientRect();panel.style.maxHeight=Math.max(80,innerHeight-20)+'px';const pr=panel.getBoundingClientRect();panel.style.left=Math.max(10,Math.min(r.left,innerWidth-pr.width-10))+'px';panel.style.top=Math.max(10,Math.min(r.bottom+5,innerHeight-pr.height-10))+'px';}
      function scroll(e){if(!panel.contains(e.target))place();}
      const observer=new MutationObserver(()=>{if(!host.isConnected||!bridge.valid())dismiss(false);});
      panel.addEventListener('keydown',e=>e.stopPropagation());
      panel.append(el('div','ndb-popup-title',title));build(panel,dismiss,place);if(gone)return;document.body.append(panel);activePopup=dismiss;place();if(gone)return;
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);window.addEventListener('scroll',scroll,{capture:true,passive:true});observer.observe(host.parentNode,{childList:true});
      (panel.querySelector('input,button')||panel).focus({preventScroll:true});
    }
    function pill(o,status){const p=el('span','ndb-pill');if(o){const fill=own(COLORS,o.fillColor)?o.fillColor:o.color,text=own(COLORS,o.textColor)?o.textColor:o.color;p.style.setProperty('--pill-fill',COLORS[fill]||COLORS.gray);p.style.setProperty('--pill-text',COLORS[text]||COLORS.gray);if(status)p.append(el('span','ndb-status-dot'));const ico=dataIcon(o,null);if(ico){ico.classList.add('ndb-option-icon');p.append(ico);}p.append(el('span','ndb-pill-label',o.name));}return p;}
    function menuProperty(p,anchor){popup(anchor,p.name,(panel,dismiss)=>{
      const rename=input(p.name,'Rename property');panel.append(rename);
      let composing=false;rename.addEventListener('compositionstart',()=>composing=true);rename.addEventListener('compositionend',()=>composing=false);
      const saveName=()=>{if(!composing&&rename.value.trim()&&rename.value!==p.name)commit(()=>p.name=rename.value.trim());};
      rename.addEventListener('change',saveName);rename.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){saveName();dismiss(true);}});
      if(bridge.openIconPicker)panel.append(dataAction(p.icon?'Change property icon':'Add property icon',p,TYPES[p.type][1],()=>{dismiss(false);chooseIcon(anchor,p);}));
      if(p.id!==b.primaryPropertyId)panel.append(action('Property type · '+TYPES[p.type][0],TYPES[p.type][1],()=>{dismiss(false);popup(anchor,'Property type',(sub,done)=>Object.entries(TYPES).forEach(([type,[label,name]])=>{const item=action(label+(p.type===type?' ✓':''),name,()=>{done(false);commit(()=>changeType(b,p.id,type));});item.setAttribute('aria-pressed',p.type===type?'true':'false');sub.append(item);}));}));
      if(p.type==='number')panel.append(action('Format · '+(p.config.format||'Number'),'hash',()=>{dismiss(false);popup(anchor,'Number format',(sub,done)=>FORMATS.forEach(f=>sub.append(button(f+(p.config.format===f?' ✓':''),()=>{done(false);commit(()=>p.config.format=f);}))))}));
      if(p.type==='select'||p.type==='status')panel.append(action('Edit options','sliders-horizontal',()=>{dismiss(false);menuOptions(p,null,anchor);}));
      panel.append(el('div','ndb-separator'));
      [['Sort ascending','arrow-up','asc'],['Sort descending','arrow-down','desc'],['Clear sort','list',null]].forEach(([label,name,direction])=>panel.append(action(label,name,()=>{dismiss(false);commit(()=>b.view.sort=direction?{propertyId:p.id,direction}:null);})));panel.append(el('div','ndb-separator'));
      [['Duplicate property','copy',()=>{const copy=clone(p);copy.id=uid('prop');copy.name+=' copy';b.properties.splice(b.properties.indexOf(p)+1,0,copy);b.rows.forEach(r=>r.cells[copy.id]=r.cells[p.id]??null);}],['Insert left','arrow-left',()=>b.properties.splice(b.properties.indexOf(p),0,property())],['Insert right','arrow-right',()=>b.properties.splice(b.properties.indexOf(p)+1,0,property())],['Delete property','trash-2',()=>{b.properties=b.properties.filter(x=>x!==p);b.rows.forEach(r=>delete r.cells[p.id]);if(b.view.sort&&b.view.sort.propertyId===p.id)b.view.sort=null;}]].forEach(([label,name,fn])=>{if(label==='Delete property'&&p.id===b.primaryPropertyId)return;const item=action(label,name,()=>{dismiss(false);commit(fn);});if(label==='Delete property'){item.classList.add('ndb-danger');item.disabled=b.properties.length===1;}panel.append(item);});
    });}
    function menuRow(r,anchor){popup(anchor,'Row actions',(panel,dismiss)=>{
      if(bridge.openRow)[['Side peek','panel-right','side'],['Full page','maximize-2','full'],['New tab','plus','tab']].forEach(([label,ico,mode])=>panel.append(action('Open in '+label.toLowerCase(),ico,()=>{dismiss(false);bridge.openRow(r.id,mode);})));
      [['Duplicate row','copy',()=>{const copy=duplicateRow(r);b.rows.splice(b.rows.indexOf(r)+1,0,copy);}],['Insert above','arrow-up',()=>b.rows.splice(b.rows.indexOf(r),0,newRow())],['Insert below','arrow-down',()=>b.rows.splice(b.rows.indexOf(r)+1,0,newRow())],['Delete row','trash-2',()=>b.rows.splice(b.rows.indexOf(r),1)]].forEach(([label,name,fn])=>panel.append(action(label,name,()=>{dismiss(false);if(label==='Delete row'&&bridge.confirm)bridge.confirm(()=>commit(fn));else commit(fn);})));if(b.view.sort)panel.append(el('div','ndb-hint','Sorted view: clear sort to see insertion order.'));
    });}
    function menuOptions(p,r,anchor){popup(anchor,p.type==='status'?'Status':'Select',(panel,dismiss,place)=>{
      const search=input('','Find or create option'),list=el('div','ndb-options');search.placeholder='Find or create…';panel.append(search,list);
      const choose=o=>{dismiss(false);if(r){commit(()=>r.cells[p.id]=o?o.id:null);focus(r.id,p.id);}};
      function draw(){list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();const filtered=options(p).filter(o=>o.name.toLocaleLowerCase().includes(q));
        (p.type==='status'?[0,1,2]:[null]).forEach(group=>{if(group!==null)list.append(el('div','ndb-group',GROUPS[group]));filtered.filter(o=>group===null||o.group===group).forEach(o=>{const line=el('div','ndb-option-line');const pick=button('',()=>r?choose(o):edit(o));pick.append(pill(o,p.type==='status'));if(r&&r.cells[p.id]===o.id)pick.append(el('span','ndb-checkmark','✓'));const editBtn=action('','ellipsis',()=>edit(o));editBtn.setAttribute('aria-label','Edit '+o.name);line.append(pick,editBtn);list.append(line);});});
        if(search.value.trim()&&!options(p).some(o=>o.name.toLocaleLowerCase()===q))list.append(action('Create “'+search.value.trim()+'”','plus',()=>{const name=search.value.trim();dismiss(false);let o;commit(()=>{o={id:uid('opt'),name,color:'gray',fillColor:'gray',textColor:'gray'};if(p.type==='status')o.group=0;p.config.options.push(o);if(r)r.cells[p.id]=o.id;});if(!r)menuOptions(p,null,findHeader(p.id));}));
        place();
      }
      function edit(o){dismiss(false);popup(anchor,'Edit option',(sub,done)=>{
        const name=input(o.name,'Option name');sub.append(name);
        if(bridge.openIconPicker)sub.append(dataAction(o.icon?'Change icon':'Add icon',o,'smile',()=>{done(false);chooseIcon(anchor,o,()=>menuOptions(p,r,findCellOrHeader(r,p)));}));
        const fillLabel=el('div','ndb-group','Fill color'),fillColors=el('div','ndb-colors');sub.append(fillLabel,fillColors);
        Object.keys(COLORS).forEach(c=>{const current=(o.fillColor||o.color||'gray')===c,btn=button(current?'✓':'',()=>{commit(()=>{o.fillColor=c;o.color=c;});Array.from(fillColors.children).forEach(n=>n.textContent=n.title===c?'✓':'');});btn.title=c;btn.setAttribute('aria-label',c);btn.style.background=COLORS[c];btn.style.color=['black','brown','green','blue','purple','red','brightRed','brightGreen','brightBlue','brightPurple','brightPink'].includes(c)?'#fff':'#0b0c0e';fillColors.append(btn);});
        const textLabel=el('div','ndb-group','Text color'),textColors=el('div','ndb-colors');sub.append(textLabel,textColors);
        Object.keys(COLORS).forEach(c=>{const current=(o.textColor||o.color||'gray')===c,btn=button(current?'✓':'',()=>{commit(()=>o.textColor=c);Array.from(textColors.children).forEach(n=>n.textContent=n.title===c?'✓':'');});btn.title=c;btn.setAttribute('aria-label','Text '+c);btn.style.background=COLORS[c];btn.style.color=['black','brown','green','blue','purple','red','brightRed','brightGreen','brightBlue','brightPurple','brightPink'].includes(c)?'#fff':'#0b0c0e';textColors.append(btn);});
        if(p.type==='status'){sub.append(el('div','ndb-group','Group'));const groups=el('div');GROUPS.forEach((g,i)=>{const btn=button(g+(o.group===i?' ✓':''),()=>{commit(()=>o.group=i);Array.from(groups.children).forEach((n,j)=>n.textContent=GROUPS[j]+(o.group===j?' ✓':''));});groups.append(btn);});sub.append(groups);}
        function save(){if(!name.value.trim())return;commit(()=>o.name=name.value.trim());done(false);menuOptions(p,r,findCellOrHeader(r,p));}
        name.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing)save();});sub.append(action('Save','check',save),action('Delete option','trash-2',()=>{done(false);commit(()=>{p.config.options=p.config.options.filter(x=>x!==o);b.rows.forEach(row=>{if(row.cells[p.id]===o.id)row.cells[p.id]=null;});});menuOptions(p,r,findCellOrHeader(r,p));}));
      });}
      search.addEventListener('input',draw);search.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){const first=list.querySelector('button');if(first){e.preventDefault();first.click();}}});if(r)panel.append(action('Clear value','x',()=>choose(null)));draw();
    });}
    function menuDatabase(anchor){popup(anchor,'Database table',(panel,dismiss)=>{
      const layout=b.view&&b.view.layout==='compact'?'compact':'full',fontSize=b.view&&own(FONT_SIZES,b.view.fontSize)?b.view.fontSize:'default';
      panel.append(el('div','ndb-group','Open pages in'));
      [['Side peek','side'],['Full page','full'],['New tab','tab']].forEach(([label,mode])=>panel.append(action(label+(b.view.openMode===mode?' ✓':''),'panel-right',()=>{dismiss(false);commit(()=>b.view.openMode=mode);}))); 
      panel.append(el('div','ndb-group','Layout'));
      panel.append(action('Full width'+(layout==='full'?' ✓':''),'maximize-2',()=>{dismiss(false);commit(()=>b.view.layout='full');}));
      panel.append(action('Compact'+(layout==='compact'?' ✓':''),'minimize-2',()=>{dismiss(false);commit(()=>b.view.layout='compact');}));
      panel.append(el('div','ndb-group','Text size'));
      Object.entries(FONT_SIZES).forEach(([key,[label]])=>panel.append(action(label+(fontSize===key?' ✓':''),'type',()=>{dismiss(false);commit(()=>b.view.fontSize=key);})));
      panel.append(el('div','ndb-separator'));
      panel.append(action('Add property','plus',()=>{dismiss(false);commit(()=>b.properties.push(property()));}));
      panel.append(action('Add row','rows-3',()=>{dismiss(false);commit(()=>b.rows.push(newRow()));}));
      if(b.view.sort)panel.append(action('Clear sort','x',()=>{dismiss(false);commit(()=>b.view.sort=null);}));
    });}
    function findHeader(id){return Array.from(host.querySelectorAll('.ndb-header')).find(n=>n.dataset.property===id)||host;}
    function findCellOrHeader(r,p){return r?Array.from(host.querySelectorAll('.ndb-cell')).find(n=>n.dataset.row===r.id&&n.dataset.property===p.id)||findHeader(p.id):findHeader(p.id);}
    function menuDate(p,r,anchor){popup(anchor,'Date',(panel,dismiss,place)=>{
      let current=date(r.cells[p.id])?new Date(r.cells[p.id]+'T12:00:00'):new Date(),y=current.getFullYear(),m=current.getMonth();
      const entry=input(r.cells[p.id]||'','Date YYYY-MM-DD');entry.placeholder='YYYY-MM-DD';const header=el('div','ndb-calendar-head'),calendar=el('div','ndb-calendar');panel.append(entry,header,calendar);
      function choose(v){dismiss(false);commit(()=>r.cells[p.id]=v);focus(r.id,p.id);}
      function draw(){header.replaceChildren();calendar.replaceChildren();header.append(action('','chevron-left',()=>{m--;if(m<0){m=11;y--;}draw();}),el('span','',new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(y,m,1))),action('','chevron-right',()=>{m++;if(m>11){m=0;y++;}draw();}));header.firstChild.setAttribute('aria-label','Previous month');header.lastChild.setAttribute('aria-label','Next month');
        ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d=>calendar.append(el('span','ndb-weekday',d)));
        for(let i=0;i<(new Date(y,m,1).getDay()+6)%7;i++)calendar.append(el('span'));
        for(let day=1;day<=new Date(y,m+1,0).getDate();day++){const iso=String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');const btn=button(day,()=>choose(iso),'ndb-day');btn.setAttribute('aria-label',iso);if(r.cells[p.id]===iso)btn.classList.add('selected');calendar.append(btn);}place();}
      entry.addEventListener('input',()=>entry.setAttribute('aria-invalid',entry.value&&!date(entry.value)?'true':'false'));entry.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!entry.value||date(entry.value))choose(entry.value||null);}});
      panel.append(action('Today','calendar',()=>{const d=new Date();choose(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));}),action('Clear date','x',()=>choose(null)));draw();
    });}
    function next(r,p,dir){const rows=bridge.rowId?[r]:sorted(b),i=rows.indexOf(r)*b.properties.length+b.properties.indexOf(p)+dir;
      if(i<0){if(!readOnly)findHeader(p.id).focus();return;}if(i>=rows.length*b.properties.length){const add=host.querySelector('.ndb-new');if(add)add.focus();return;}focus(rows[Math.floor(i/b.properties.length)].id,b.properties[i%b.properties.length].id);}
    function editText(cell,r,p){
      if(readOnly||cell.querySelector('textarea'))return;
      const area=el('textarea','ndb-editor');area.rows=1;area.value=string(r.cells[p.id]);area.setAttribute('aria-label',p.name);if(p.type==='number')area.inputMode='decimal';
      let composing=false,done=false;
      cell.replaceChildren(area);
      function size(){area.style.height='auto';area.style.height=Math.max(32,area.scrollHeight)+'px';}
      function save(){if(done||(composing&&p.type==='number'))return;const v=p.type==='number'?number(area.value):area.value;
        if(p.type==='number'&&v===null&&area.value.trim()){area.setAttribute('aria-invalid','true');area.title='Enter a number, or clear the cell';return false;}
        area.removeAttribute('aria-invalid');commit(()=>r.cells[p.id]=v,false,true);return true;
      }
      function finish(){if(done)return;if(!composing)save();done=true;if(!cell.isConnected)return;paintCell(cell,r,p);}
      area.addEventListener('compositionstart',()=>composing=true);area.addEventListener('compositionend',()=>{composing=false;save();size();});area.addEventListener('input',()=>{save();size();});
      area.addEventListener('blur',()=>{finish();if(b.view.sort&&bridge.valid()&&host.isConnected)setTimeout(()=>{if(bridge.valid()&&!host.querySelector('.ndb-editor')&&!activePopup)render();},0);});
      area.addEventListener('keydown',e=>{if(e.isComposing||composing)return;e.stopPropagation();if(e.key==='Tab'){e.preventDefault();if(save()===false)return;finish();next(r,p,e.shiftKey?-1:1);}else if(e.key==='Escape'||e.key==='Enter'&&(p.type==='number'||!e.shiftKey)){e.preventDefault();if(e.key==='Enter'&&save()===false)return;finish();cell.focus();}});
      area.focus();area.setSelectionRange(area.value.length,area.value.length);size();
    }
    function paintCell(cell,r,p){cell.replaceChildren();const v=r.cells[p.id];cell.removeAttribute('aria-checked');cell.setAttribute('aria-label',p.name+': '+(formatted(v,p)||'Empty'));
      if(p.type==='checkbox'){const check=button('',()=>{commit(()=>r.cells[p.id]=!r.cells[p.id],false);paintCell(cell,r,p);cell.focus();},'ndb-checkbox');check.setAttribute('role','checkbox');check.setAttribute('aria-checked',v===true?'true':'false');check.setAttribute('aria-label',p.name);check.tabIndex=-1;check.disabled=readOnly;if(v===true)check.append(icon('check'));cell.append(check);}
      else if(p.type==='select'||p.type==='status'){const o=options(p).find(o=>o.id===v);if(o)cell.append(pill(o,p.type==='status'));}
      else if(p.id===b.primaryPropertyId&&!bridge.rowId&&bridge.openRow){
        cell.classList.add('ndb-primary');const title=el('span','ndb-row-title');
        const pageIcon=dataIcon(r.page||{},'file-text');if(pageIcon)title.append(pageIcon);title.append(el('span','',formatted(v,p)||'Untitled'));
        const opened=!!(bridge.isRowOpen&&bridge.isRowOpen(r.id));
        const open=button(opened?'CLOSE':'OPEN',()=>{if(opened&&bridge.closeRow)bridge.closeRow();else bridge.openRow(r.id,b.view.openMode);},'ndb-open');open.setAttribute('aria-label',(opened?'Close ':'Open ')+(formatted(v,p)||'Untitled'));if(opened)open.classList.add('is-open');
        const edit=action('','pencil',()=>editText(cell,r,p));edit.classList.add('ndb-title-edit');edit.setAttribute('aria-label','Edit title');cell.append(title,edit,open);
      }else cell.append(el('span','ndb-value',formatted(v,p)));
    }
    function resize(e,p,col,handle){if(e.button!==0||readOnly)return;e.preventDefault();e.stopPropagation();close();let nextWidth=p.width;const start=e.clientX,old=p.width;handle.setPointerCapture(e.pointerId);handle.classList.add('resizing');
      function move(ev){nextWidth=width(old+ev.clientX-start);col.style.width=nextWidth+'px';table.style.width=(b.properties.reduce((sum,x)=>sum+(x===p?nextWidth:x.width),0)+70)+'px';}
      function finish(){handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('lostpointercapture',finish);handle.classList.remove('resizing');if(activeResize===finish)activeResize=null;if(bridge.valid()&&nextWidth!==old)commit(()=>p.width=nextWidth,false);}
      function cancel(){nextWidth=old;col.style.width=old+'px';table.style.width=(b.properties.reduce((sum,x)=>sum+x.width,0)+70)+'px';finish();}
      activeResize=finish;handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);handle.addEventListener('lostpointercapture',finish);
    }
    function makeCell(r,p){const cell=el('div','ndb-cell');cell.tabIndex=0;cell.dataset.row=r.id;cell.dataset.property=p.id;paintCell(cell,r,p);cell.addEventListener('focus',()=>focusCell={row:r.id,prop:p.id});
        function activate(){if(readOnly)return;if(p.type==='text'||p.type==='number')editText(cell,r,p);else if(p.type==='date')menuDate(p,r,cell);else if(p.type==='select'||p.type==='status')menuOptions(p,r,cell);else{commit(()=>r.cells[p.id]=!r.cells[p.id],false);paintCell(cell,r,p);}}
        cell.addEventListener('click',e=>{if(e.target.closest('button,textarea'))return;cell.focus();activate();});cell.addEventListener('keydown',e=>{if(e.target!==cell||e.isComposing)return;if(e.key==='Tab'){e.preventDefault();next(r,p,e.shiftKey?-1:1);}else if(e.key==='F2'){e.preventDefault();if(p.type==='text')editText(cell,r,p);}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&p.id===b.primaryPropertyId&&bridge.openRow){e.preventDefault();bridge.openRow(r.id,'full');}else if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(p.type==='text'||p.type==='number')){e.preventDefault();editText(cell,r,p);const area=cell.querySelector('textarea');if(area){area.value=e.key;area.dispatchEvent(new Event('input'));}}else if(['Backspace','Delete'].includes(e.key)&&!readOnly){e.preventDefault();commit(()=>r.cells[p.id]=value(null,p),false);paintCell(cell,r,p);}e.stopPropagation();});
        cell.addEventListener('paste',e=>{if(readOnly)return;const text=e.clipboardData&&e.clipboardData.getData('text/plain');if(text==null)return;e.stopPropagation();const editing=e.target.tagName==='TEXTAREA';if(editing&&!text.includes('\t'))return;e.preventDefault();if(bridge.rowId)commit(()=>r.cells[p.id]=value(p.type==='text'?text:text.trim(),p,true));else commit(()=>paste(b,r.id,p.id,text));focus(r.id,p.id);});
        cell.addEventListener('copy',e=>{if(e.target.tagName==='TEXTAREA')return;if(e.clipboardData){e.preventDefault();e.stopPropagation();e.clipboardData.setData('text/plain',label(r.cells[p.id],p));}});return cell;}
    function refresh(rowIds){
      const signature=JSON.stringify([b.properties,b.view]);
      if(host._dbSignature!==signature){render();return;}
      host.querySelectorAll('.ndb-cell').forEach(cell=>{if(rowIds&&!rowIds.includes(cell.dataset.row))return;const r=b.rows.find(r=>r.id===cell.dataset.row),p=b.properties.find(p=>p.id===cell.dataset.property);if(r&&p&&!cell.querySelector('textarea'))paintCell(cell,r,p);});
    }
    function render(){
      host._dbSignature=JSON.stringify([b.properties,b.view]);
      if(bridge.rowId){
        const row=b.rows.find(r=>r.id===bridge.rowId);host.replaceChildren();if(!row)return;
        b.properties.forEach(p=>{const line=el('div','notes-row-property'),label=dataAction(p.name,p,TYPES[p.type][1],()=>menuProperty(p,label));label.disabled=readOnly;label.classList.add('ndb-header');label.dataset.property=p.id;line.append(label,makeCell(row,p));host.append(line);});return;
      }
      const focused=document.activeElement&&document.activeElement.closest('.ndb-cell'),restore=focused&&host.contains(focused)?{row:focused.dataset.row,prop:focused.dataset.property}:null;
      const scroll=wrapper?wrapper.scrollLeft:0;host.replaceChildren();const root=el('div','ndb');root.dataset.fontSize=b.view&&own(FONT_SIZES,b.view.fontSize)?b.view.fontSize:'default';host.append(root);
      const layout=b.view&&b.view.layout==='compact'?'compact':'full',blockRow=host.closest&&host.closest('.notes-block[data-type="database"]');if(blockRow)blockRow.dataset.dbLayout=layout;
      const bar=el('div','ndb-toolbar');
      if(b.view.sort){const p=b.properties.find(p=>p.id===b.view.sort.propertyId);if(p){const sortBtn=action(p.name+' · '+(b.view.sort.direction==='asc'?'Ascending':'Descending')+' ×','arrow-up-down',()=>commit(()=>b.view.sort=null));sortBtn.classList.add('ndb-sort-chip');sortBtn.disabled=readOnly;bar.append(sortBtn);}}
      if(!readOnly){const more=action('','ellipsis',()=>menuDatabase(more));more.classList.add('ndb-view-menu');more.setAttribute('aria-label','Database table options');bar.append(more);}
      if(bar.childNodes.length)root.append(bar);
      wrapper=el('div','ndb-scroll');table=el('table','ndb-table');table.setAttribute('aria-label','Database table');const propertyWidth=b.properties.reduce((s,p)=>s+p.width,0);table.style.width='100%';table.style.minWidth=(propertyWidth+78)+'px';const cols=el('colgroup');const gutter=el('col');gutter.style.width='calc(var(--ndb-control,34px) + 8px)';cols.append(gutter);b.properties.forEach(p=>{const col=el('col');col.style.width=p.width+'px';cols.append(col);});const extra=el('col');cols.append(extra);table.append(cols);
      const head=el('thead'),hr=el('tr');hr.append(el('th'));b.properties.forEach((p,i)=>{const th=el('th');th.scope='col';const name=dataAction(p.name,p,TYPES[p.type][1],()=>menuProperty(p,name));name.classList.add('ndb-header');name.dataset.property=p.id;name.disabled=readOnly;th.append(name);if(!readOnly){name.draggable=true;name.addEventListener('dragstart',e=>{e.stopPropagation();e.dataTransfer.setData('application/x-notes-property',p.id);});th.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer.types).includes('application/x-notes-property')){e.preventDefault();e.stopPropagation();}});th.addEventListener('drop',e=>{const id=e.dataTransfer.getData('application/x-notes-property');if(id){e.preventDefault();e.stopPropagation();commit(()=>moveProperty(b,id,p.id));}});}if(!readOnly){const handle=el('div','ndb-resize');handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Resize '+p.name);handle.setAttribute('aria-valuenow',p.width);handle.setAttribute('aria-valuemin','96');handle.setAttribute('aria-valuemax','640');handle.tabIndex=0;handle.addEventListener('pointerdown',e=>resize(e,p,cols.children[i+1],handle));handle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();commit(()=>p.width=width(p.width+(e.key==='ArrowLeft'?-10:10)));findHeader(p.id).focus();}});th.append(handle);}hr.append(th);});const add=el('th');if(!readOnly){const btn=action('','plus',()=>commit(()=>b.properties.push(property())));btn.setAttribute('aria-label','Add property');add.append(btn);}hr.append(add);head.append(hr);table.append(head);
      const body=el('tbody');sorted(b).forEach(r=>{const tr=el('tr');tr.dataset.row=r.id;const control=el('td');if(!readOnly){const btn=action('','ellipsis',()=>menuRow(r,btn));btn.classList.add('ndb-row-control');btn.setAttribute('aria-label','Row actions');control.append(btn);}tr.append(control);b.properties.forEach(p=>{const td=el('td');const cell=makeCell(r,p);td.append(cell);tr.append(td);});tr.append(el('td'));body.append(tr);});table.append(body);wrapper.append(table);root.append(wrapper);wrapper.scrollLeft=scroll;
      if(!readOnly)root.append(action('New','plus',()=>{let r;commit(()=>{r=newRow();b.rows.push(r);});focus(r.id,b.properties[0].id);}));if(!readOnly)root.lastChild.classList.add('ndb-new');
      root.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||!['z','y','я','н'].includes(e.key.toLowerCase()))e.stopPropagation();});
      if(restore&&!activePopup)focus(restore.row,restore.prop);
    }
    render();return {render,refresh};
  }
  return {isPopupOpen:()=>!!activePopup,primary,newRow,duplicateRow,moveProperty,TYPES,GROUPS,FORMATS,FONT_SIZES,create,property,normalize,changeType,sorted,formatted,parseGrid,paste,value,date,number,mount,close};
});

(function() {
  'use strict';

  var notesWorkspaceMode = false;
  var notesPages = [];
  var notesGroups = [];   // v3.16: sidebar groups (replaces the static "Private" caption)
  var notesActivePageId = null;
  var notesLoadedFor = null;
  var notesSaveTimer = null;
  var notesDraggedPageId = null;
  var notesDraggedBlockId = null;
  var notesDraggedBlockPlacement = 'before';
  var notesTransitionTimer = null;
  var notesToastTimer = null;
  var notesCommandState = null;
  var notesMenuPanels = [];
  var notesLoadedRemote = false;   // true when notesPages belong to a Firestore owner
  var notesDirty = false;          // unsaved changes waiting for the debounce
  var notesLoadSeq = 0;            // guards against out-of-order async loads
  var NOTES_CLOUD_LIMIT = 900000;  // Firestore documents are capped at ~1 MiB
  var notesShareMode = false;      // true on public read-only links (?note=TOKEN)
  var notesHist = { undo:[], redo:[], base:null, open:false, timer:null, applying:false };
  var notesShareCache = {};        // token -> last JSON pushed to notesShares
  var notesCloudPageHashes = {};   // page id -> last cloud JSON; avoids rewriting unchanged pages
  var notesCloudPageIds = [];      // page ids currently known in cloud for cleanup
  var notesRemoteSaveInFlight = false; // serialize remote commits so an older save cannot land after a newer one
  var notesRemoteSaveOwner = null;
  var notesRemoteSavePending = false;
  var notesCloudRevision = '[0,null]';
  var notesCloudConflict = false;
  var notesIgnoreLocalOnce = false;
  var notesCloudIncomplete = false; // protects against destructive saves if a referenced page document is missing

  /* v3.20: Row Pages are owned by their database, never sidebar pages.
     The block engine below is reused under an event-scoped editing context. */
  var notesRowState=null, notesRowScope=null, notesRowTransaction=null, notesRowToken=0;
  var notesDBViews=[], notesTabs=null, notesTabsOwner=null, notesTabsSwitching=false, notesPendingPageNavigation=false;
  var NOTES_ROW_BYTES=150000, NOTES_ROW_BLOCKS=150, NOTES_PARENT_ROW_BYTES=850000;
  function notesHistoryContext(){var ctx=notesRowScope||(notesRowState&&document.activeElement&&document.activeElement.closest('#notesRowPanel')?notesRowState:null);return ctx?'row:'+ctx.pageId+':'+ctx.dbId+':'+ctx.rowId:'page:'+notesActivePageId;}
  function notesHistoryCanApply(snap){var current=notesHistoryContext();if(snap.context&&snap.context!==current&&(snap.context.startsWith('row:')||current.startsWith('row:'))){notesToast('Open the page where this change was made to undo it');return false;}return true;}
  function notesResolveRow(key){
    if(!key||(key.owner||'')!==(notesLoadedFor||'')||(!notesShareMode&&key.owner!==(notesOwner()||'local')))return null;
    var page=notesPageById(key.pageId),database=page&&page.blocks.find(function(b){return b.id===key.dbId&&b.type==='database';}),row=database&&database.rows.find(function(r){return r.id===key.rowId;});
    return row?{parent:page,database:database,row:row}:null;
  }
  function notesRowValid(ctx){return !!(ctx&&notesRowState&&ctx.token===notesRowState.token&&notesResolveRow(ctx)&&ctx.pageId===notesActivePageId);}
  function notesRowFacade(ctx){var x=notesResolveRow(ctx);if(!x)return null;return {id:'row:'+ctx.dbId+':'+ctx.rowId,get blocks(){return x.row.page.blocks;},set blocks(value){x.row.page.blocks=value;}};}
  function notesRowNormalize(database){
    database.rows.forEach(function(row){
      row.page=row.page&&typeof row.page==='object'?row.page:{blocks:[]};
      var seen={};row.page.blocks=(Array.isArray(row.page.blocks)?row.page.blocks:[]).map(function(block){
        // Nested databases and synced/page creation are not enabled in row editors.
        if(block&&['database','synced','page'].indexOf(block.type)>=0)return notesClone(block);
        var b=notesNormalizeBlock(block);if(seen[b.id])b.id=notesId('b');seen[b.id]=true;return b;
      });
    });return database;
  }
  function notesRowBegin(ctx){
    if(!notesRowValid(ctx))return false;
    if(notesRowScope===ctx)return true;
    var x=notesResolveRow(ctx);notesRowScope=ctx;
    if(notesHist.base&&notesHist.base.context!==notesHistoryContext())notesHistoryBreak();
    notesRowTransaction={row:notesClone(x.row),rowBytes:notesJsonBytes(x.row.page),parentBytes:notesJsonBytes(x.parent)};
    return true;
  }
  function notesRowPreflight(){
    if(!notesRowScope||!notesRowTransaction)return true;
    var x=notesResolveRow(notesRowScope);if(!x)return false;
    var tx=notesRowTransaction,newRowBytes=notesJsonBytes(x.row.page),newParentBytes=notesJsonBytes(x.parent);
    if((newRowBytes>NOTES_ROW_BYTES&&newRowBytes>tx.rowBytes)||(newParentBytes>NOTES_PARENT_ROW_BYTES&&newParentBytes>tx.parentBytes)||(x.row.page.blocks.length>NOTES_ROW_BLOCKS&&x.row.page.blocks.length>tx.row.page.blocks.length)){
      var restored=notesClone(tx.row);Object.keys(x.row).forEach(function(k){delete x.row[k];});Object.assign(x.row,restored);
      notesToast('Row page limit reached · previous content kept (150 KB / 150 blocks; parent 850 KB)');
      var ctx=notesRowScope;queueMicrotask(function(){if(notesRowValid(ctx))notesRowRender();});return false;
    }
    tx.row=notesClone(x.row);tx.rowBytes=newRowBytes;tx.parentBytes=newParentBytes;return true;
  }
  function notesRowRun(ctx,fn,readOnly){
    if(!notesRowValid(ctx)||(notesShareMode&&!readOnly))return;
    var previous=notesRowScope,transaction=notesRowTransaction;
    notesRowBegin(ctx);try{return fn();}finally{notesRowScope=previous;notesRowTransaction=transaction;}
  }
  function notesBound(fn,ctx){ctx=ctx||notesRowScope;if(!ctx)return fn;return function(){var args=arguments,self=this;return notesRowRun(ctx,function(){return fn.apply(self,args);});};}
  function notesListen(target,type,fn,options){target.addEventListener(type,notesBound(fn),options);}
  function notesRowBindHost(host,ctx){
    ['input','change','keydown','click','pointerdown','paste','drop','dragstart','dragend','dragover','focusin','compositionend'].forEach(function(type){
      host.addEventListener(type,function(e){
        if(!notesRowValid(ctx)){e.stopImmediatePropagation();return;}
        if(notesShareMode&&type!=='click'){e.preventDefault();e.stopImmediatePropagation();return;}
      },true);
    });
    host.addEventListener('dragstart',function(e){if(e.target.closest('.notes-block-grip'))e.stopPropagation();});
    host.addEventListener('keydown',notesBound(function(e){
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){var b=e.target.closest('.notes-block');if(b){e.preventDefault();e.stopPropagation();notesDuplicateBlock(b.dataset.id);}}
      if(e.altKey&&e.shiftKey&&!notesCommandState&&['ArrowUp','ArrowDown'].includes(e.key)){var b=e.target.closest('.notes-block');if(b){e.preventDefault();e.stopPropagation();notesMoveBlockStep(b.dataset.id,e.key==='ArrowUp'?-1:1);}}
    },ctx));
    host.addEventListener('paste',notesBound(function(e){
      var clip=e.clipboardData,file=clip&&Array.from(clip.items||[]).find(function(i){return i.kind==='file'&&/^image\//.test(i.type);});
      var block=e.target.closest('.notes-block');if(file&&block){e.preventDefault();e.stopPropagation();notesInsertPastedImage(file.getAsFile(),block.dataset.id);return;}
      if(e.target.isContentEditable&&clip){e.preventDefault();e.stopPropagation();document.execCommand('insertText',false,clip.getData('text/plain'));}
    },ctx));
  }
  function notesRowMenuItems(items,ctx){
    if(!ctx)return items;
    return items.filter(function(item){return !['Page','Database table','Database Table','Synced block','Move to','Copy link to block','Edit icon'].includes(item.label);}).map(function(item){
      var out=Object.assign({},item);if(out.action)out.action=notesBound(out.action,ctx);
      if(Array.isArray(out.submenu))out.submenu=notesRowMenuItems(out.submenu,ctx);
      else if(typeof out.submenu==='function'){var fn=out.submenu;out.submenu=function(){return notesRowMenuItems(fn(),ctx);};}
      return out;
    });
  }
  function notesRowTitle(x){return String(x.row.cells[x.database.primaryPropertyId]||'');}
  function notesRowInsertImage(ctx,data,name,afterId){
    // Compression may finish after navigation. Resolve the captured row, never the active row.
    var x=notesResolveRow(ctx);if(!x||notesShareMode)return;
    var historyBefore=notesHistorySnap();historyBefore.context='row:'+ctx.pageId+':'+ctx.dbId+':'+ctx.rowId;
    var before=notesClone(x.row.page),parentBytes=notesJsonBytes(x.parent),oldBytes=notesJsonBytes(before);
    var block=notesDefaultBlock('image');block.src=data;block.alt=name||'Pasted image';
    var i=x.row.page.blocks.findIndex(function(b){return b.id===afterId;});x.row.page.blocks.splice(i<0?x.row.page.blocks.length:i+1,0,block);
    if((notesJsonBytes(x.row.page)>NOTES_ROW_BYTES&&notesJsonBytes(x.row.page)>oldBytes)||(notesJsonBytes(x.parent)>NOTES_PARENT_ROW_BYTES&&notesJsonBytes(x.parent)>parentBytes)||x.row.page.blocks.length>NOTES_ROW_BLOCKS){x.row.page=before;notesToast('Image exceeds row page limit · previous content kept');return;}
    clearTimeout(notesHist.timer);notesHist.undo.push(historyBefore);if(notesHist.undo.length>120)notesHist.undo.shift();notesHist.redo=[];notesHist.open=false;notesHist.base=notesHistorySnap();
    var scope=notesRowScope;notesRowScope=null;notesScheduleSave();notesRowScope=scope;
    if(notesRowState&&notesRowState.pageId===ctx.pageId&&notesRowState.dbId===ctx.dbId&&notesRowState.rowId===ctx.rowId)notesRowRender();
    notesToast('Image added to row page');
    return block.id;
  }
  function notesRowButton(label,icon,fn){var b=document.createElement('button');b.type='button';b.className='notes-row-action';b.title=label;b.setAttribute('aria-label',label);var i=document.createElement('span');notesPaintIcon(i,'line:'+icon,'icon','gray');b.appendChild(i);b.addEventListener('click',fn);return b;}
  function notesDBBridge(block,host,page,owner,rowCtx){
    function valid(){return !notesShareMode&&notesWorkspaceMode&&notesLoadedFor===owner&&(notesOwner()||'local')===owner&&notesActivePageId===page.id&&notesBlockById(block.id,page)===block&&(!rowCtx||notesRowValid(rowCtx));}
    return {
      rowId:rowCtx&&rowCtx.rowId,readOnly:notesShareMode,valid:valid,icon:notesPaintIcon,closeMenus:notesCloseMenus,
      openIconPicker:function(anchor,current,onPick){notesOpenIconPicker(anchor,current,onPick);},
      openRow:function(rowId,mode){notesOpenRow({owner:owner,pageId:page.id,dbId:block.id,rowId:rowId},mode);},
      isRowOpen:function(rowId){return !!(notesRowState&&notesRowState.mode==='side'&&notesRowState.owner===owner&&notesRowState.pageId===page.id&&notesRowState.dbId===block.id&&notesRowState.rowId===rowId);},
      closeRow:function(){notesCloseMenus();notesCloseRow();},
      confirm:function(fn){notesConfirm({title:'Delete row and its page?',text:'The row properties and page content will be deleted. You can undo this change.',confirm:'Delete row',danger:true},function(){if(valid())fn();});},
      change:function(fn,typing){
        if(!valid())return false;
        var before=notesClone(block),size=notesJsonBytes(page);
        function apply(){if(!typing||(notesHist.base&&notesHist.base.context!==notesHistoryContext()))notesHistoryBreak();fn();if(notesJsonBytes(page)>NOTES_PARENT_ROW_BYTES&&notesJsonBytes(page)>size){Object.keys(block).forEach(function(k){delete block[k];});Object.assign(block,before);notesToast('Page limit reached · previous data kept');queueMicrotask(function(){if(valid())notesRender();});return false;}notesScheduleSave();if(!typing)notesHistoryBreak();return true;}
        var ok=rowCtx?notesRowRun(rowCtx,apply):apply();
        notesDatabaseChanged(block,host,rowCtx?[rowCtx.rowId]:undefined);return ok;
      }
    };
  }
  function notesDBMount(block,host,page,owner,rowCtx){
    notesDBViews=notesDBViews.filter(function(v){return v.host.isConnected&&v.host!==host;});
    var api=NotesDatabase.mount(host,block,notesDBBridge(block,host,page,owner,rowCtx));
    notesDBViews.push({host:host,block:block,api:api});return api;
  }
  function notesDatabaseChanged(block,source,rowIds){
    notesDBViews=notesDBViews.filter(function(v){return v.host.isConnected;});
    notesDBViews.forEach(function(v){if(v.block===block&&v.host!==source)v.api.refresh(rowIds);});
    if(notesRowState){var x=notesResolveRow(notesRowState);if(!x){notesCloseRow(true);return;}var title=document.getElementById('notesRowTitle');if(title&&document.activeElement!==title)title.value=notesRowTitle(x);}
    notesTabsPaint();
  }
  function notesOpenRow(key,mode){
    var x=notesResolveRow(key);if(!x)return;
    var previous=notesRowState&&notesResolveRow(notesRowState);
    notesHistoryBreak();notesCloseMenus();notesTabsCapture();
    mode=mode||x.database.view.openMode||'side';
    if(mode==='tab'){notesTabsAdd({kind:'row',pageId:key.pageId,dbId:key.dbId,rowId:key.rowId});return;}
    notesRowState=Object.assign({},key,{mode:mode,token:++notesRowToken});
    var tab=notesTabActive();if(tab){if(mode==='full'){tab.target={kind:'row',pageId:key.pageId,dbId:key.dbId,rowId:key.rowId};delete tab.peek;}else{tab.target={kind:'page',pageId:key.pageId};tab.peek={dbId:key.dbId,rowId:key.rowId};}}
    notesRowRender();if(previous&&previous.database!==x.database)notesDatabaseChanged(previous.database,null,[previous.row.id]);notesDatabaseChanged(x.database,null,previous&&previous.database===x.database?[previous.row.id,key.rowId]:[key.rowId]);notesTabsSave();notesTabsPaint();
  }
  function notesCloseRow(immediate){
    var previous=notesRowState,previousResolved=previous&&notesResolveRow(previous);notesRowState=null;notesRowScope=null;notesRowTransaction=null;notesRowToken++;
    var shell=document.querySelector('.notes-editor-shell'),panel=document.getElementById('notesRowPanel');
    if(shell){shell.classList.remove('has-row-peek','has-row-full');}
    if(panel){panel.removeAttribute('id');panel.querySelectorAll('[id]').forEach(function(node){node.removeAttribute('id');});if(immediate||notesReduceMotion)panel.remove();else{panel.classList.add('closing');setTimeout(function(){panel.remove();},230);}}
    var tab=notesTabActive();if(tab){delete tab.peek;if(tab.target.kind==='row')tab.target={kind:'page',pageId:tab.target.pageId};}
    if(previousResolved)notesDatabaseChanged(previousResolved.database,null,[previousResolved.row.id]);notesTabsSave();notesTabsPaint();if(previous)notesHistoryBreak();
  }
  function notesRowRender(){
    if(!notesRowState)return;
    var x=notesResolveRow(notesRowState);if(!x){notesCloseRow(true);return;}
    var shell=document.querySelector('.notes-editor-shell');if(!shell)return;
    var panel=document.getElementById('notesRowPanel'),fresh=!panel,scroll=panel&&panel.querySelector('.notes-row-scroll');var top=scroll?scroll.scrollTop:0;
    if(!panel){panel=document.createElement('section');panel.id='notesRowPanel';shell.appendChild(panel);}
    panel.className='notes-row-panel '+(notesRowState.mode==='full'?'full':'peek');panel.setAttribute('aria-label','Database row page');panel.replaceChildren();
    var topbar=shell.querySelector('.notes-editor-topbar');if(topbar)panel.style.top=(topbar.offsetTop+topbar.offsetHeight)+'px';
    shell.classList.toggle('has-row-peek',notesRowState.mode==='side');shell.classList.toggle('has-row-full',notesRowState.mode==='full');
    var ctx=Object.assign({},notesRowState,{token:++notesRowToken});notesRowState=ctx;
    var controls=document.createElement('div');controls.className='notes-row-controls';
    controls.appendChild(notesRowButton('Back to database','arrow-left',function(){notesCloseMenus();notesCloseRow();}));
    var name=document.createElement('span');name.textContent='Row page';controls.appendChild(name);
    controls.appendChild(notesRowButton('Open in side peek','panel-right',function(){notesOpenRow(ctx,'side');}));
    controls.appendChild(notesRowButton('Open in full page','maximize-2',function(){notesOpenRow(ctx,'full');}));
    if(!notesShareMode)controls.appendChild(notesRowButton('Open in new tab','plus',function(){notesOpenRow(ctx,'tab');}));
    controls.appendChild(notesRowButton('Close row page','x',function(){notesCloseMenus();notesCloseRow();}));panel.appendChild(controls);
    var content=document.createElement('div');content.className='notes-row-scroll';panel.appendChild(content);
    var inner=document.createElement('div');inner.className='notes-row-inner';content.appendChild(inner);
    var icon=notesRowButton('Change row page icon','file-text',function(){if(notesShareMode)return;notesOpenIconPicker(icon,{value:x.row.page.icon||'',type:x.row.page.iconType||'emoji',color:x.row.page.iconColor||'default'},notesBound(function(pick){x.row.page.icon=pick.value||'';x.row.page.iconType=pick.type||'emoji';x.row.page.iconColor=pick.color||'default';notesScheduleSave();notesDatabaseChanged(x.database,null,[x.row.id]);notesPaintIcon(icon,pick.value||'line:file-text',pick.value?pick.type:'icon',pick.color||'gray');},ctx));});
    icon.classList.add('notes-row-icon');notesPaintIcon(icon,x.row.page.icon||'line:file-text',x.row.page.icon?x.row.page.iconType:'icon',x.row.page.iconColor||'gray');inner.appendChild(icon);
    var title=document.createElement('textarea');title.id='notesRowTitle';title.className='notes-row-title';title.rows=1;title.placeholder='Untitled';title.value=notesRowTitle(x);title.setAttribute('aria-label','Row page title');title.readOnly=notesShareMode;inner.appendChild(title);
    title.addEventListener('input',notesBound(function(){x.row.cells[x.database.primaryPropertyId]=title.value;notesScheduleSave();notesDatabaseChanged(x.database,null,[x.row.id]);},ctx));
    var properties=document.createElement('div');properties.className='notes-row-properties';inner.appendChild(properties);notesDBMount(x.database,properties,x.parent,ctx.owner,ctx);
    var separator=document.createElement('hr');inner.appendChild(separator);
    var blocks=document.createElement('div');blocks.id='notesRowBlocks';blocks.className='notes-row-blocks';inner.appendChild(blocks);notesRowBindHost(blocks,ctx);
    notesRowRun(ctx,function(){notesRenderBlocks();},true);
    if(!notesShareMode){var add=notesRowButton('Add row page block','plus',notesBound(function(){notesInsertBlock('text',x.row.page.blocks.length?x.row.page.blocks[x.row.page.blocks.length-1].id:null);},ctx));add.appendChild(document.createTextNode(' Add block'));inner.appendChild(add);}
    var usage=document.createElement('div');usage.className='notes-row-usage';usage.textContent='Row content · '+Math.ceil(notesJsonBytes(x.row.page)/1024)+' / 146 KB';inner.appendChild(usage);
    content.scrollTop=top;
    if(notesShareMode)panel.querySelectorAll('[contenteditable],input,textarea').forEach(function(n){if(n.hasAttribute('contenteditable'))n.contentEditable='false';else n.disabled=true;});
  }

  /* Tabs are navigation only. Data remains exclusively in notesPages. */
  function notesTabActive(){return notesTabs&&notesTabs.items.find(function(t){return t.id===notesTabs.active;});}
  function notesTabsKey(){return 'tjNotesTabsV1:'+notesTabsOwner;}
  function notesTabValid(t){var p=t&&t.target&&notesPageById(t.target.pageId);if(!p)return false;if(t.target.kind==='row')return !!notesResolveRow(Object.assign({owner:notesLoadedFor},t.target));return t.target.kind==='page';}
  function notesTabsCapture(){
    var tab=notesTabActive();if(!tab)return;
    var wrap=document.getElementById('notesPageWrap');tab.scroll=wrap?wrap.scrollTop:0;tab.horizontal={};
    document.querySelectorAll('#notesBlocks .ndb-scroll').forEach(function(n){var block=n.closest('.notes-block');if(block)tab.horizontal[block.dataset.id]=n.scrollLeft;});
    var panel=document.querySelector('#notesRowPanel .notes-row-scroll');tab.rowScroll=panel?panel.scrollTop:0;
  }
  function notesTabsSave(){if(notesShareMode||!notesTabs||!notesTabsOwner)return;try{localStorage.setItem(notesTabsKey(),JSON.stringify(notesTabs));}catch(_){}}
  function notesTabsReset(){notesTabsCapture();notesTabsSave();notesTabs=null;notesCloseRow(true);notesTabsOwner=null;var tabs=document.getElementById('notesWorkspaceTabs');if(tabs)tabs.remove();}
  function notesTabsBeforeRender(){
    if(notesMobileLoading)return;
    if(notesShareMode||!notesLoadedFor)return;
    if(notesTabsOwner!==notesLoadedFor){notesTabsOwner=notesLoadedFor;notesTabs=null;try{notesTabs=JSON.parse(localStorage.getItem(notesTabsKey()));}catch(_){}if(!notesTabs||!Array.isArray(notesTabs.items))notesTabs={items:[],active:null};notesTabs.items=notesTabs.items.filter(notesTabValid).slice(0,30);
      if(!notesTabs.items.length&&notesActivePageId){var first={id:notesId('tab'),target:{kind:'page',pageId:notesActivePageId}};notesTabs.items.push(first);notesTabs.active=first.id;}
      if(!notesTabActive()&&notesTabs.items.length)notesTabs.active=notesTabs.items[0].id;
      var active=notesTabActive();if(active){notesActivePageId=active.target.pageId;notesTabsSwitching=true;}
    }
    var tab=notesTabActive();if(!tab&&notesActivePageId){tab={id:notesId('tab'),target:{kind:'page',pageId:notesActivePageId}};notesTabs.items.push(tab);notesTabs.active=tab.id;}
    if(tab&&!notesTabsSwitching&&(tab.target.pageId!==notesActivePageId||notesPendingPageNavigation)){
      notesTabsCapture();notesCloseRow(true);tab.target={kind:'page',pageId:notesActivePageId};tab.scroll=0;tab.horizontal={};delete tab.peek;notesPendingPageNavigation=false;notesHistoryBreak();
    }
    if(notesRowState&&notesRowState.pageId!==notesActivePageId)notesCloseRow(true);
  }
  function notesTabsAfterRender(){
    if(notesMobileLoading)return;
    var tab=notesTabActive();if(!tab){notesRowRender();return;}
    var switching=notesTabsSwitching;notesTabsSwitching=false;
    if(switching){var target=tab.target;if(target.kind==='row')notesRowState=Object.assign({owner:notesLoadedFor,mode:'full',token:++notesRowToken},target);else if(tab.peek)notesRowState=Object.assign({owner:notesLoadedFor,pageId:target.pageId,mode:'side',token:++notesRowToken},tab.peek);else notesRowState=null;}
    notesRowRender();notesTabsPaint();notesTabsSave();
    if(switching){var wrap=document.getElementById('notesPageWrap');if(wrap)wrap.scrollTop=Number(tab.scroll)||0;document.querySelectorAll('#notesBlocks .ndb-scroll').forEach(function(n){var block=n.closest('.notes-block');n.scrollLeft=Number(tab.horizontal&&tab.horizontal[block.dataset.id])||0;});var panel=document.querySelector('#notesRowPanel .notes-row-scroll');if(panel)panel.scrollTop=Number(tab.rowScroll)||0;}
  }
  function notesTabsSelect(id){
    if(!notesTabs)return;notesTabsCapture();notesCloseMenus();notesHistoryBreak();
    var tab=notesTabs.items.find(function(t){return t.id===id;});if(!tab)return;
    var old=notesRowState;notesRowState=null;var panel=document.getElementById('notesRowPanel');if(panel)panel.remove();var shell=document.querySelector('.notes-editor-shell');if(shell)shell.classList.remove('has-row-peek','has-row-full');
    notesTabs.active=id;notesActivePageId=tab.target.pageId;notesTabsSwitching=true;notesRender();notesTabsSave();
  }
  function notesTabsAdd(target){if(!notesTabs)return;notesTabsCapture();var t={id:notesId('tab'),target:target};notesTabs.items.push(t);notesTabsSelect(t.id);}
  function notesTabsClose(id){if(!notesTabs)return;var i=notesTabs.items.findIndex(function(t){return t.id===id;});if(i<0)return;var active=notesTabs.active===id;notesTabs.items.splice(i,1);if(!notesTabs.items.length){var page=notesPageById(notesActivePageId)||notesPages[0];if(page)notesTabs.items.push({id:notesId('tab'),target:{kind:'page',pageId:page.id}});}if(active&&notesTabs.items.length)notesTabsSelect(notesTabs.items[Math.min(i,notesTabs.items.length-1)].id);else{notesTabsPaint();notesTabsSave();}}
  function notesTabsPaint(){
    if(notesMobileLoading)return;
    if(notesShareMode||!notesTabs)return;var shell=document.querySelector('.notes-editor-shell');if(!shell)return;
    var tabs=document.getElementById('notesWorkspaceTabs');if(!tabs){tabs=document.createElement('div');tabs.id='notesWorkspaceTabs';tabs.className='notes-workspace-tabs';tabs.setAttribute('role','tablist');shell.insertBefore(tabs,shell.firstChild);}
    tabs.replaceChildren();notesTabs.items=notesTabs.items.filter(notesTabValid);
    notesTabs.items.forEach(function(tab){var p=notesPageById(tab.target.pageId),x=tab.target.kind==='row'?notesResolveRow(Object.assign({owner:notesLoadedFor},tab.target)):null;var info=x?x.row.page:p,title=x?notesRowTitle(x):p.title;
      var container=document.createElement('div');container.className='notes-workspace-tab'+(tab.id===notesTabs.active?' active':'');
      var select=document.createElement('button');select.type='button';select.setAttribute('role','tab');select.setAttribute('aria-selected',tab.id===notesTabs.active?'true':'false');select.title=title||'Untitled';var ico=document.createElement('span');notesPaintIcon(ico,info.icon||'line:file-text',info.icon?info.iconType:'icon',info.iconColor||'gray');select.appendChild(ico);var label=document.createElement('span');label.textContent=title||'Untitled';select.appendChild(label);select.addEventListener('click',function(){notesTabsSelect(tab.id);});
      var close=notesRowButton('Close tab '+(title||'Untitled'),'x',function(){notesTabsClose(tab.id);});container.append(select,close);tabs.appendChild(container);
    });
    var add=notesRowButton('New workspace tab','plus',function(){notesOpenMenu(add,notesPages.map(function(p){return {label:p.title||'Untitled',icon:p.icon||'line:file-text',action:function(){notesTabsAdd({kind:'page',pageId:p.id});}};}),{search:true,searchPlaceholder:'Open an existing page…'});});tabs.appendChild(add);
  }
  document.addEventListener('keydown',function(e){
    if(!notesRowState||e.isComposing)return;
    if(e.key==='Escape'){
      if(NotesDatabase.isPopupOpen())return;
      if(e.target&&e.target.closest&&e.target.closest('.ndb-editor'))return;
      var menu=document.getElementById('notesMenuLayer');if(menu&&menu.classList.contains('open')){e.preventDefault();e.stopImmediatePropagation();notesCloseMenus();return;}
      if(document.querySelector('.notes-confirm-overlay,.notes-image-viewer'))return;
      e.preventDefault();e.stopImmediatePropagation();notesCloseRow();
    }
  },true);
  window.addEventListener('pagehide',function(){notesTabsCapture();notesTabsSave();});

  /* ---------- Motion core ----------
     DOM is rebuilt on every render, so CSS transitions can't run on it. Instead we use FLIP:
     remember where rows were, rebuild, then animate each row from its old spot with a GPU-only
     transform. Rects are read from the *visual* position, so an animation interrupted by the next
     render continues from where it is: no jumps, no restarts. */
  var notesReduceMotion = false;
  try {
    var notesMotionMq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    notesReduceMotion = !!(notesMotionMq && notesMotionMq.matches);
    if (notesMotionMq && notesMotionMq.addEventListener) notesMotionMq.addEventListener('change', function(e){ notesReduceMotion = e.matches; });
  } catch (_) {}
  var NOTES_EASE = 'cubic-bezier(.16,1,.3,1)';
  var notesLastPageId = null;        // page shown by the previous notesRender()
  var notesLastBlocksPageId = null;  // page whose blocks are currently in the DOM
  var notesSidebarPrimed = false;    // sidebar has rendered once for the current owner
  var notesPendingToggle = null;     // toggle block that was just opened
  var notesPendingChevron = null;    // sidebar page whose children were just expanded/collapsed
  var notesMenuCloseTimer = null;
  function notesCanAnimate(el) { return !notesReduceMotion && notesWorkspaceMode && !!el && typeof el.animate === 'function'; }
  function notesAnimate(el, frames, opts) {
    if (!notesCanAnimate(el)) return null;
    var o = { duration:240, easing:NOTES_EASE };
    if (opts) for (var k in opts) o[k] = opts[k];
    try { return el.animate(frames, o); } catch (_) { return null; }
  }
  function notesSnapshotRects(nodes) {
    var map = {};
    Array.prototype.forEach.call(nodes, function(n){ var id = n.dataset && n.dataset.id; if (!id) return; var r = n.getBoundingClientRect(); if (r.height) map[id] = r.top; });
    return map;
  }
  function notesPlayFlip(nodes, before, opts) {
    opts = opts || {};
    var entered = [];
    Array.prototype.forEach.call(nodes, function(n){
      var id = n.dataset && n.dataset.id; if (!id) return;
      if (Object.prototype.hasOwnProperty.call(before, id)) {
        var dy = before[id] - n.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) notesAnimate(n, [{ transform:'translate3d(0,'+dy+'px,0)' }, { transform:'translate3d(0,0,0)' }], { duration:opts.duration || 260 });
      } else entered.push(n);
    });
    if (entered.length && entered.length <= (opts.maxEnter || 4)) entered.forEach(function(n){
      notesAnimate(n, [{ opacity:0, transform:'translate3d(0,'+(opts.enterY == null ? -4 : opts.enterY)+'px,0)' }, { opacity:1, transform:'translate3d(0,0,0)' }], { duration:opts.enterDuration || 240 });
    });
  }
  function notesAnimateOut(el, done, frames, duration) {
    done=notesBound(done);
    var a = el && notesAnimate(el, frames || [{ opacity:1, transform:'translate3d(0,0,0)' }, { opacity:0, transform:'translate3d(-6px,0,0)' }], { duration:duration || 130, easing:'cubic-bezier(.4,0,1,1)', fill:'forwards' });
    if (a) a.onfinish = done; else done();
  }
  function notesDots(el) {
    el.textContent = '';
    var wrap = document.createElement('span'); wrap.className = 'notes-more-dots';
    for (var i = 0; i < 3; i++) { var d = document.createElement('span'); d.className = 'notes-more-dot'; wrap.appendChild(d); }
    el.appendChild(wrap);
  }

  var NOTES_BLOCK_TYPES = ['text','h1','h2','h3','h4','bulleted','numbered','todo','toggle','toggleh1','toggleh2','toggleh3','toggleh4','code','quote','callout','equation','synced','image','divider','table','database','page','columns2','columns3','columns4','columns5'];
  var NOTES_TEXT_COLORS = {
    'default':'var(--textMain)', gray:'#a7abb3', brown:'#b7967c', orange:'#e6a15f', yellow:'#dfc46a',
    green:'#70c89b', blue:'#79aee8', purple:'#a996e8', pink:'#dd8fbe', red:'#e98282'
  };
  var NOTES_BG_COLORS = {
    'default':'transparent', gray:'rgba(148,163,184,.10)', brown:'rgba(180,128,89,.11)', orange:'rgba(234,142,66,.11)',
    yellow:'rgba(234,196,74,.10)', green:'rgba(74,191,128,.10)', blue:'rgba(76,139,217,.11)', purple:'rgba(139,105,214,.11)',
    pink:'rgba(211,94,158,.10)', red:'rgba(219,86,86,.10)'
  };
  var NOTES_EMOJI_GROUPS = {
    'Frequently used':'💡 📌 ✅ ⚠️ 🔥 🎯 📊 📈 📉 🧠 📝 📚 🔎 🧪 🧩 ⚙️ 💼 🏦 💰 💵 🪙 ⭐ ✨ 🚀 🧭 🗂️ 📁 🔒 🔓 🕒 📅',
    'Faces & people':'😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤔 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤭 🤫 🤥 😶 😐 😑 🙄 😬 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 👻 💀 🤖 👽 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤝 🙏 💪 🦾 👀 👁️ 👄 🫶',
    'Nature & animals':'🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🌾 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌵 🌲 🌳 🌴 🪴 🍄 🐚 🪨 🌍 🌎 🌏 🌕 🌙 🌛 ⭐ 🌟 💫 ☀️ ⛅ 🌤️ 🌧️ ⛈️ ❄️ ☃️ 🌈 ☁️ 🌊 💧 🔥 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦉 🦅 🦋 🐝 🐞 🐢 🐍 🐙 🦀 🐠 🐬 🦈 🐳',
    'Food & drink':'🍎 🍏 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥔 🍞 🥐 🥖 🥨 🥯 🧀 🥚 🍳 🥞 🧇 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍿 🍱 🍜 🍣 🍤 🍚 🍩 🍪 🎂 🍫 🍬 🍯 ☕ 🍵 🧃 🥤 🍷 🍸 🍺 🥂',
    'Travel & places':'🚗 🚕 🚌 🚎 🏎️ 🚓 🚑 🚒 🚚 🚲 🛴 🏍️ 🚂 🚆 🚇 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚢 ⚓ 🗺️ 🧭 🏖️ 🏝️ 🏔️ ⛰️ 🌋 🏕️ 🏠 🏡 🏢 🏦 🏛️ 🏗️ 🏭 🏰 🗼 🗽 🌉 🌃 🌆 🌇 🌌 🎡 🎢 🎠',
    'Objects & work':'⌚ 📱 💻 🖥️ ⌨️ 🖱️ 🖨️ 📷 📸 🎥 📺 📻 🎧 🎤 🎵 🎸 🎹 🥁 🎨 🖌️ 🖍️ 📚 📖 📕 📗 📘 📙 📝 📋 📌 📍 📎 🖇️ ✂️ 📐 📏 🧮 📊 📈 📉 🗂️ 📂 📁 🗃️ 🗄️ 🧾 💳 💸 💵 💶 💷 💰 🪙 💎 🔑 🔒 🔓 🔨 🛠️ ⚙️ 🧲 🔬 🔭 💡 🔦 🕯️ ⏰ ⏳ 📅 🗓️ 📦 🎁 🏷️ 📫 📬 ✉️ 📩 📧 📤 📥',
    'Symbols':'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ ☯️ ♻️ ⚠️ ⛔ 🚫 ❌ ✅ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔶 🔷 🔸 🔹 💠 🔔 🔕 📣 💬 🗨️ ❓ ❗ 💯 🔥 ✨ ⭐ 🌟 🎯 🏁 🚩 🏳️ 🏴 🔗 ↗️ ⬆️ ⬇️ ➡️ ⬅️ 🔄 ➕ ➖ ➗ ♾️'
  };
  // Unicode's emoji presentation property supplies the full pictographic range; keep
  // curated sequences as well for hearts, families, professions and flag combinations.
  var NOTES_EMOJI_ALIASES = {
    'сердце heart love':'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💕 💖 💗 💘',
    'улыбка smile face':'😀 😃 😄 😁 😊 🙂 😉 😎 🥰 😍',
    'огонь fire hot':'🔥 ❤️‍🔥',
    'рост график trading chart up':'📈 💹 💰 🪙 🚀',
    'падение chart down':'📉 🔻',
    'галочка done check':'✅ ✔️ ☑️',
    'звезда star':'⭐ 🌟 ✨',
    'деньги money coin':'💰 💵 💶 💷 💸 🪙',
    'идея idea light bulb':'💡 🧠',
    'папка folder file':'📁 📂 🗂️ 📄',
    'часы time clock':'⏰ ⌚ 🕒 ⏳',
    'кот cat':'🐱 🐈 🐈‍⬛',
    'собака dog':'🐶 🐕 🦮',
    'ракета rocket':'🚀',
    'флаг flag':'🏁 🚩 🏳️ 🏴',
    'россия russian russia ru':'🇷🇺',
    'сша america usa us':'🇺🇸',
    'германия germany de':'🇩🇪',
    'франция france fr':'🇫🇷',
    'китай china cn':'🇨🇳',
    'япония japan jp':'🇯🇵',
    'великобритания britain uk gb':'🇬🇧',
    'разнообразие skin tone hand руки':'👋🏻 👋🏼 👋🏽 👋🏾 👋🏿 👍🏻 👍🏼 👍🏽 👍🏾 👍🏿'
  };
  var NOTES_EMOJI_EXTRAS = '❤️‍🔥 ❤️‍🩹 😶‍🌫️ 😮‍💨 😵‍💫 🫨 🫠 🥹 🫣 🫢 🫡 🫥 🫤 🥷 🧑‍💻 👩‍💻 👨‍💻 🧑‍🔬 👩‍🔬 👨‍🔬 🧑‍🎨 👩‍🎨 👨‍🎨 🧑‍🚀 👩‍🚀 👨‍🚀 🧑‍🏫 👩‍🏫 👨‍🏫 🧑‍⚕️ 👩‍⚕️ 👨‍⚕️ 🧑‍🍳 👩‍🍳 👨‍🍳 👩‍❤️‍👨 👩‍❤️‍👩 👨‍❤️‍👨 👨‍👩‍👧 👨‍👩‍👦 👩‍👩‍👧 👨‍👨‍👦 🐈‍⬛ 🐕‍🦺 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️'.split(' ');
  var NOTES_EMOJI_SKIN_BASE = '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤝 🙏 💪 🫶'.split(' ');
  var NOTES_FLAG_CODES = 'RU US GB DE FR ES IT PT NL BE CH AT SE NO DK FI PL CZ SK HU RO BG GR TR UA BY KZ UZ GE AM AZ CN JP KR IN TH VN MY SG ID PH AU NZ CA MX BR AR CL CO PE ZA EG MA NG KE IL AE SA QA KW IR IQ PK BD LK NP MN TW HK IE IS EE LV LT SI HR RS BA ME AL MK CY MT LU LI AD MC SM VA MD'.split(' ');
  function notesFlag(code){return Array.from(code).map(function(ch){return String.fromCodePoint(0x1f1e6+ch.charCodeAt(0)-65);}).join('');}
  var NOTES_EMOJIS = (function(){
    var all=[],seen={};
    function add(value){if(value&&!seen[value]){seen[value]=true;all.push(value);}}
    Object.keys(NOTES_EMOJI_GROUPS).forEach(function(k){NOTES_EMOJI_GROUPS[k].split(' ').forEach(add);});
    NOTES_EMOJI_EXTRAS.forEach(add);
    // More than 1,200 Unicode emoji scalars, including the newer additions.
    try { var pictograph=new RegExp('\\p{Emoji_Presentation}','u');
      for(var cp=0x2000;cp<=0x1fbff;cp++){var char=String.fromCodePoint(cp);if(pictograph.test(char)&&cp!==0xfe0f&&cp!==0x200d&&!(cp>=0x1f3fb&&cp<=0x1f3ff)&&!(cp>=0x1f1e6&&cp<=0x1f1ff))add(char);}
    } catch(_){}
    NOTES_EMOJI_SKIN_BASE.forEach(function(base){['🏻','🏼','🏽','🏾','🏿'].forEach(function(tone){add(base.replace(/\ufe0f/g,'')+tone);});});
    NOTES_FLAG_CODES.forEach(function(code){add(notesFlag(code));});
    return all;
  })();
  var NOTES_EMOJI_SECTIONS = (function(){
    var sections={},known={};
    Object.keys(NOTES_EMOJI_GROUPS).forEach(function(group){sections[group]=NOTES_EMOJI_GROUPS[group].split(' ');sections[group].forEach(function(em){known[em]=true;});});
    sections['People & skin tones']=NOTES_EMOJI_SKIN_BASE.reduce(function(all,base){return all.concat(['🏻','🏼','🏽','🏾','🏿'].map(function(tone){return base.replace(/\ufe0f/g,'')+tone;}));},[]);
    sections['Flags']=NOTES_FLAG_CODES.map(notesFlag);
    sections['More emojis']=NOTES_EMOJIS.filter(function(em){return !known[em]&&sections['People & skin tones'].indexOf(em)<0&&sections['Flags'].indexOf(em)<0;});
    return sections;
  })();
  var NOTES_ICONS = ['✦','◆','◇','■','□','●','○','◈','◉','◎','→','↗','↳','✓','✕','+','−','⌁','⌂','⌘','⚙','☰','☷','☑','☐','⊕','⊙','◫','▦','▤','▥','▧','♟','♜','♞','♛','★','☆','✧','✎','⌕','⏱','⌚','☁','☀','☾','⚑','⚐'];
  // v3.15: Lucide icon set (1848 icons, ISC licence). Lives in icons/lucide-icons.json and is fetched
  // only when Notes actually needs an outline icon, then served from the browser cache.
  var NOTES_LINE_ICONS_URL = 'icons/lucide-icons.json?v=1.47.0';
  var NOTES_LINE_ICONS = {};            // name -> inner SVG markup
  var NOTES_LINE_ICON_LIST = [];        // [name, search words, category] in picker order
  // Old built-in names -> Lucide names, so icons chosen before v3.15 keep showing.
  var NOTES_LINE_ICON_LEGACY = {"message":"message-circle","file-chart":"file-chart-column","sort":"arrow-up-down","refresh":"refresh-cw","tree":"tree-deciduous","flask":"flask-conical","candlestick":"chart-candlestick","circle-dollar":"circle-dollar-sign","coins-stack":"coins","dice":"dice-5","puzzle-piece":"puzzle","target-arrow":"crosshair","palm-tree":"tree-palm","paw":"paw-print","volcano":"mountain","door":"door-open","eye-scan":"scan-eye","gantt":"chart-gantt","messages":"messages-square","dollar":"dollar-sign","badge-dollar":"badge-dollar-sign","chart-column-up":"chart-column-increasing","chart-column-down":"chart-column-decreasing","chart-no-axes":"chart-no-axes-column","trending-flat":"move-right","bull":"trending-up","bear":"trending-down","order-book":"book-open-text","stop-loss":"shield-x","take-profit":"circle-check-big","journal":"notebook-pen","stopwatch":"timer","star-4":"sparkle","spiral":"loader-pinwheel","cube":"box","flag-triangle":"flag-triangle-right","files-stack":"files","folder-star":"folder-heart","hand-pointer":"pointer","clap":"hand-heart","peace":"hand","yin-yang":"circle-dashed","ufo":"orbit","rocket-launch":"rocket","passport":"book-user","function":"square-function","pound":"pound-sterling","yen":"japanese-yen","ruble":"russian-ruble","bank":"landmark","lightning-bolt-circle":"circle-power","mountain-flag":"mountain-snow","pushpin":"pin","gift-card":"gift","dot-grid":"grip","heart-square":"heart","star-circle":"circle-star","home":"house","check-circle":"circle-check-big","circle-help":"circle-question-mark","grid":"grid-3x3","edit":"square-pen","columns":"columns-2","layout":"panels-top-left","filter":"funnel","plus-circle":"circle-plus","minus-circle":"circle-minus","x-circle":"circle-x","more-horizontal":"ellipsis","more-vertical":"ellipsis-vertical","check-square":"square-check-big","smile":"face-slightly-smiling","frown":"face-slightly-frowning","waves":"waves-horizontal","history":"rotate-ccw-clock","bar-chart-2":"chart-no-axes-column","line-chart-2":"chart-line","pie-chart-2":"chart-pie","bug-2":"bug","globe-2":"earth","user-circle":"circle-user","activity-square":"square-activity","fingerprint":"fingerprint-pattern","smile-plus":"face-slightly-smiling-plus","laugh":"face-grinning","meh":"face-neutral","angry":"face-angry","book-marked":"book-bookmark","align-left":"text-align-start","podcast":"mic-signal","sliders":"sliders-vertical","alert-triangle":"triangle-alert","alert-octagon":"octagon-alert","git-commit":"git-commit-horizontal","train":"tram-front","store-2":"store","compass-2":"compass","indent":"list-indent-increase","wrap-text":"text-wrap","file-json":"file-braces","file-audio":"file-headphone","file-video":"file-play","file-question":"file-question-mark","file-warning":"file-exclamation-point","trash-2":"trash","eraser-2":"eraser","thumbs-up-2":"thumbs-up","stars":"sparkles","atom-2":"atom","moon-2":"moon","leaf-2":"leaf","ice-cream":"ice-cream-cone","coffee-2":"coffee","brush-2":"brush","scissors-2":"scissors","trophy-2":"trophy","rocket-2":"rocket","map-2":"map","library-2":"library","glasses-2":"glasses","binary-2":"binary","chart-candlestick-2":"chart-candlestick","percent-circle":"circle-percent","calculator-2":"calculator","network-2":"network","target-2":"target","tag-2":"tag","hourglass-2":"hourglass","footprints-2":"footprints","crown-2":"crown","infinity-2":"infinity","hash-2":"hash","grid-2":"grid-3x3","at-sign-2":"at-sign","inbox-2":"inbox"};
  var notesLineIconsState = 'idle';     // idle | loading | ready | error
  var notesLineIconsWaiters = [], notesLineIconsPending = [];
  function notesLineIconName(name) {
    name = String(name || '');
    return NOTES_LINE_ICONS[name] ? name : (NOTES_LINE_ICON_LEGACY[name] || name);
  }
  function notesLoadLineIcons(cb) {
    if (notesLineIconsState === 'ready') { if (cb) cb(true); return; }
    if (cb) notesLineIconsWaiters.push(cb);
    if (notesLineIconsState === 'loading') return;
    notesLineIconsState = 'loading';
    function finish(ok) {
      notesLineIconsState = ok ? 'ready' : 'error';
      var pending = notesLineIconsPending; notesLineIconsPending = [];
      pending.forEach(function(it) { if (it.el.isConnected && it.el.dataset.lineIcon === it.value) notesPaintIcon(it.el, it.value, 'icon', it.color); });
      var waiters = notesLineIconsWaiters; notesLineIconsWaiters = [];
      waiters.forEach(function(fn) { try { fn(ok); } catch (err) { console.error(err); } });
    }
    fetch(NOTES_LINE_ICONS_URL).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(data) {
      var list = data && Array.isArray(data.icons) ? data.icons : [];
      list.forEach(function(it) {
        if (!Array.isArray(it) || typeof it[0] !== 'string' || typeof it[1] !== 'string' || !/^[a-z0-9-]+$/.test(it[0])) return;
        NOTES_LINE_ICONS[it[0]] = it[1];
        NOTES_LINE_ICON_LIST.push([it[0], String(it[2] || ''), String(it[3] || 'other')]);
      });
      finish(NOTES_LINE_ICON_LIST.length > 0);
    }).catch(function(err) { console.error('Icon set load failed:', err); finish(false); });
  }
  var NOTES_ICON_COLORS = {
    'default':'#f4f5f7', gray:'#9aa0aa', brown:'#b58f72', orange:'#e79a52', yellow:'#dfbf55',
    green:'#63c58f', blue:'#6fa9eb', purple:'#a38ce8', pink:'#dc86b6', red:'#e77979'
  };
  var NOTES_LANGUAGES = ['Plain text','JavaScript','TypeScript','Python','HTML','CSS','JSON','SQL','Bash','C++','Java','Pine Script'];

  function notesId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function notesClone(v) { return JSON.parse(JSON.stringify(v)); }
  function notesOwner() { return typeof viewingUser === 'string' && viewingUser ? viewingUser : (typeof currentUser !== 'undefined' && currentUser && currentUser.login ? currentUser.login : null); }
  function notesOwnerUid(ownerKey) {
    try { var profile = typeof findUser === 'function' ? findUser(ownerKey) : null; return profile && profile.uid ? profile.uid : null; } catch (_) { return null; }
  }
  function notesCanRepairOwnerRoot(ownerKey) {
    var targetUid = notesOwnerUid(ownerKey), authUid = notesAuthUid();
    if (!targetUid || !authUid) return false;
    if (authUid === targetUid) return true;
    try { return typeof isRetockerAuth === 'function' && isRetockerAuth(); } catch (_) { return false; }
  }
  function notesEnsureCloudOwner(ownerKey, snap) {
    var targetUid = notesOwnerUid(ownerKey);
    if (!targetUid || typeof db === 'undefined' || !notesCanRepairOwnerRoot(ownerKey)) return Promise.resolve(snap);
    var data = snap && snap.exists ? (snap.data() || {}) : {};
    if (data.uid === targetUid) return Promise.resolve(snap);
    var ref = db.collection('titles').doc(ownerKey);
    // A Notes page create is authorized through the root title document. Ensure that
    // root exists with the correct UID BEFORE the page batch runs, otherwise a user's
    // first Notes workspace can remain local-only on the device where it was created.
    return ref.set({ uid:targetUid }, { merge:true }).then(function(){
      return ref.get({ source:'server' });
    }).catch(function(err){
      console.warn('Could not repair Notes owner metadata:', err);
      return snap;
    });
  }
  var notesKnownOwnerRepairStarted = false;
  function notesRepairKnownOwnerRoots() {
    if (notesKnownOwnerRepairStarted || typeof db === 'undefined') return Promise.resolve();
    try { if (typeof isRetockerAuth !== 'function' || !isRetockerAuth()) return Promise.resolve(); } catch (_) { return Promise.resolve(); }
    var profiles = typeof USERS !== 'undefined' && Array.isArray(USERS) ? USERS.slice() : [];
    if (profiles.length < 2) return Promise.resolve(); // the admin list is not loaded yet
    notesKnownOwnerRepairStarted = true;
    return Promise.all(profiles.map(function(profile){
      if (!profile || !profile.login || !profile.uid) return Promise.resolve();
      var ref = db.collection('titles').doc(profile.login);
      return ref.get({ source:'server' }).then(function(snap){
        var data = snap && snap.exists ? (snap.data() || {}) : {};
        if (data.uid === profile.uid) return;
        return ref.set({ uid:profile.uid }, { merge:true });
      }).catch(function(err){ console.warn('Notes owner repair skipped for '+profile.login+':', err); });
    }));
  }
  function notesStorageKey(ownerKey) { return 'tjNotesWorkspaceV2:' + (ownerKey || notesOwner() || 'local'); }
  // contentEditable turns Enter into <div>/<br>; textContent drops those line breaks, innerText keeps them.
  function notesReadEditable(el) {
    if (!el) return '';
    var t = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    t = String(t || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
    var last = el.lastChild;
    if (t.slice(-1) === '\n' && last && last.nodeName === 'BR') t = t.slice(0, -1);
    return t === '\n' ? '' : t;
  }
  function notesClampText(value, max) { return String(value == null ? '' : value).slice(0, max || 20000); }
  function notesLastIconColor() { try { return notesSafeColor(localStorage.getItem('tjNotesLastIconColor') || 'default', NOTES_ICON_COLORS); } catch (_) { return 'default'; } }
  function notesSetLastIconColor(key) { try { localStorage.setItem('tjNotesLastIconColor', key); } catch (_) {} }
  function notesSafeColor(value, palette) { return Object.prototype.hasOwnProperty.call(palette, value) ? value : 'default'; }
  function notesPaintIcon(el,value,type,color) {
    if(!el)return;el.textContent=value||'';el.classList.toggle('notes-symbol-icon',type==='icon');el.style.color=type==='icon'?NOTES_ICON_COLORS[notesSafeColor(color||'default',NOTES_ICON_COLORS)]:'';
    el.classList.remove('notes-line-icon-pending');delete el.dataset.lineIcon;
    if(type==='icon' && typeof value==='string' && value.indexOf('line:')===0) {
      el.textContent='';el.dataset.lineIcon=value;var name=notesLineIconName(value.slice(5));
      if(NOTES_LINE_ICONS[name]){
        var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
        svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
        svg.setAttribute('aria-hidden','true');svg.innerHTML=NOTES_LINE_ICONS[name];el.appendChild(svg);
      } else if(notesLineIconsState!=='ready'&&notesLineIconsState!=='error') {
        // Icon set not loaded yet: keep the slot, paint it once the file arrives.
        el.classList.add('notes-line-icon-pending');notesLineIconsPending.push({el:el,value:value,color:color});notesLoadLineIcons();
      } else el.textContent='◇';
    }
  }
  function notesTypeAllowed(type) { return NOTES_BLOCK_TYPES.indexOf(type) >= 0 ? type : 'text'; }
  function notesStructuredBlock(type) { return type==='database'||type==='table'||type==='page'||type==='divider'||String(type||'').indexOf('columns')===0; }

  function notesDefaultBlock(type) {
    type = notesTypeAllowed(type || 'text');
    var b = { id:notesId('b'), type:type, text:'', color:'default', background:'default' };
    if (type === 'todo') b.checked = false;
    if (type === 'toggle' || type.indexOf('toggleh') === 0) { b.open = true; b.detail = ''; }
    if (type === 'code') { b.language = 'JavaScript'; b.wrap = true; b.caption = ''; }
    if (type === 'quote') b.quoteSize = 'small';
    if (type === 'callout') b.icon = '💡';
    if (type === 'synced') b.syncKey = notesId('sync');
    if (type === 'database') { Object.assign(b, NotesDatabase.create()); delete b.text; }
    if (type === 'table') b.rows = [['Column 1','Column 2'],['','']];
    if (type === 'page') b.linkedPageId = null;
    if (type.indexOf('columns') === 0) {
      var count = Math.max(2, Math.min(5, Number(type.replace('columns','')) || 2));
      b.columns = new Array(count).fill(0).map(function(){ return ''; });
    }
    if (type === 'divider') delete b.text;
    return b;
  }

  function notesNormalizeBlock(block) {
    block = block && typeof block === 'object' ? notesClone(block) : {};
    block.id = block.id || notesId('b');
    block.type = notesTypeAllowed(block.type || 'text');
    block.color = notesSafeColor(block.color || 'default', NOTES_TEXT_COLORS);
    block.background = notesSafeColor(block.background || 'default', NOTES_BG_COLORS);
    if (block.type === 'image') {
      block.src = notesValidImageSrc(block.src) ? block.src : '';
      block.alt = notesClampText(block.alt || 'Pasted image', 180);
      delete block.text;
      return block;
    }
    if (block.type === 'divider') return { id:block.id, type:'divider', color:block.color, background:block.background };
    if (block.type === 'database') { delete block.text; return notesRowNormalize(NotesDatabase.normalize(block)); }
    if (block.type === 'table') {
      if (!Array.isArray(block.rows) || !block.rows.length) block.rows = [['Column 1','Column 2'],['','']];
      var width = Math.max(1, Math.min(10, block.rows.reduce(function(m,r){ return Math.max(m, Array.isArray(r) ? r.length : 0); }, 0) || 2));
      block.rows = block.rows.slice(0, 120).map(function(row) {
        row = Array.isArray(row) ? row.slice(0, width) : [];
        while (row.length < width) row.push('');
        return row.map(function(cell){ return notesClampText(cell, 5000); });
      });
      delete block.text;
      return block;
    }
    if (block.type.indexOf('columns') === 0) {
      var count = Math.max(2, Math.min(5, Number(block.type.replace('columns','')) || 2));
      block.columns = Array.isArray(block.columns) ? block.columns.slice(0, count).map(function(x){return notesClampText(x,12000);}) : [];
      while (block.columns.length < count) block.columns.push('');
      block.columns = block.columns.slice(0,count);
      block.text = notesClampText(block.text, 12000);
      return block;
    }
    block.text = notesClampText(block.text, block.type === 'code' ? 40000 : 24000);
    if (block.type === 'todo') block.checked = !!block.checked;
    if (block.type === 'toggle' || block.type.indexOf('toggleh') === 0) { block.open = block.open !== false; block.detail = notesClampText(block.detail, 24000); }
    if (block.type === 'code') { block.language = NOTES_LANGUAGES.indexOf(block.language) >= 0 ? block.language : 'JavaScript'; block.wrap = block.wrap !== false; block.caption = notesClampText(block.caption, 3000); }
    if (block.type === 'quote') block.quoteSize = block.quoteSize === 'large' ? 'large' : 'small';
    if (block.type === 'callout') {
      block.icon = notesClampText(block.icon || '💡', 64);
      block.iconType = block.iconType === 'icon' || (!block.iconType && NOTES_ICONS.indexOf(block.icon)>=0) ? 'icon' : 'emoji';
      block.iconColor = notesSafeColor(block.iconColor || 'default', NOTES_ICON_COLORS);
    }
    if (block.type === 'synced') block.syncKey = typeof block.syncKey === 'string' && block.syncKey ? block.syncKey : notesId('sync');
    if (block.type === 'page') block.linkedPageId = typeof block.linkedPageId === 'string' ? block.linkedPageId : null;
    return block;
  }

  function notesNormalizeComments(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(-100).map(function(c){
      c = c && typeof c === 'object' ? c : {};
      return { id:c.id || notesId('c'), text:notesClampText(c.text,600), createdAt:Number(c.createdAt)||Date.now(), author:notesClampText(c.author||'',60) };
    }).filter(function(c){return c.text.trim();});
  }

  // v3.18: custom cover photo stays inline, but each Notes page now has its own Firestore document.
  var NOTES_COVER_MAX_CHARS = 650000;
  function notesValidCoverImage(v) { return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length <= NOTES_COVER_MAX_CHARS; }

  /* v3.38: Notes images live in their own Firestore documents (notesImages/{id}).
     Pages keep only a short "tjimg:<id>" reference, so a page can hold any number of images.
     If the upload is not possible (offline, local mode, missing rules) the old inline copy is kept. */
  var NOTES_IMG_REF = /^tjimg:[A-Za-z0-9]{16,64}$/;
  function notesIsImageRef(v) { return typeof v === 'string' && NOTES_IMG_REF.test(v); }
  function notesValidImageSrc(v) { return notesIsImageRef(v) || notesValidCoverImage(v); }
  var notesImgMem = Object.create(null), notesImgWait = Object.create(null), notesImgDbP = null;
  function notesImgToken() {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', out = '', arr = new Uint32Array(24);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) out += abc[arr[i] % abc.length];
    return out;
  }
  function notesImgDb() {
    if (notesImgDbP) return notesImgDbP;
    notesImgDbP = new Promise(function(res){
      try { var r = indexedDB.open('tjNotesImages', 1); r.onupgradeneeded = function(){ r.result.createObjectStore('img'); }; r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ res(null); }; }
      catch (_) { res(null); }
    });
    return notesImgDbP;
  }
  function notesImgCacheGet(id) {
    return notesImgDb().then(function(d){
      if (!d) return null;
      return new Promise(function(res){ try { var q = d.transaction('img','readonly').objectStore('img').get(id); q.onsuccess = function(){ res(typeof q.result === 'string' ? q.result : null); }; q.onerror = function(){ res(null); }; } catch (_) { res(null); } });
    });
  }
  function notesImgCachePut(id, data) { notesImgDb().then(function(d){ if (!d) return; try { d.transaction('img','readwrite').objectStore('img').put(data, id); } catch (_) {} }); }
  function notesImageResolve(src) {
    if (!notesIsImageRef(src)) return Promise.resolve(notesValidCoverImage(src) ? src : '');
    var id = src.slice(6);
    if (notesImgMem[id]) return Promise.resolve(notesImgMem[id]);
    if (notesImgWait[id]) return notesImgWait[id];
    var p = notesImgCacheGet(id).then(function(hit){
      if (hit) return hit;
      if (typeof db === 'undefined') throw new Error('offline');
      return db.collection('notesImages').doc(id).get().then(function(s){
        var d = s.exists ? s.data() : null, data = d && d.data;
        if (!notesValidCoverImage(data)) throw new Error('missing');
        notesImgCachePut(id, data); return data;
      });
    }).then(function(data){ notesImgMem[id] = data; delete notesImgWait[id]; return data; }, function(err){ delete notesImgWait[id]; throw err; });
    notesImgWait[id] = p; return p;
  }
  function notesImageUpload(data) {
    var uid = notesAuthUid();
    if (notesShareMode || !notesLoadedRemote || typeof db === 'undefined' || !uid) return Promise.reject(new Error('local'));
    if (!notesValidCoverImage(data)) return Promise.reject(new Error('invalid'));
    var id = notesImgToken();
    return db.collection('notesImages').doc(id).set({ uid:uid, data:data, createdAt:Date.now() }).then(function(){
      notesImgMem[id] = data; notesImgCachePut(id, data); return 'tjimg:' + id;
    });
  }
  // Upload when possible, otherwise keep the inline copy (exactly the previous behaviour).
  function notesStoreImage(data) {
    return notesImageUpload(data).catch(function(err){ if (!err || err.message !== 'local') console.warn('Image upload failed, keeping inline copy:', err); return data; });
  }
  function notesPaintImage(img, src, wrap) {
    if (!notesIsImageRef(src)) { if (src) img.src = src; return; }
    var id = src.slice(6);
    if (notesImgMem[id]) { img.src = notesImgMem[id]; return; }
    if (wrap) wrap.classList.add('is-loading');
    notesImageResolve(src).then(function(data){ img.src = data; if (wrap) wrap.classList.remove('is-loading'); })
      .catch(function(){ if (wrap) { wrap.classList.remove('is-loading'); wrap.classList.add('is-broken'); } });
  }
  function notesCoverBg(el, src) {
    if (!el) return;
    el.dataset.coverRef = src || '';
    function set(v) { if (el.style.backgroundImage !== v) el.style.backgroundImage = v; }
    if (!src) { set(''); return; }
    if (!notesIsImageRef(src)) { set('url("' + String(src).replace(/"/g, '%22') + '")'); return; }
    var id = src.slice(6);
    if (notesImgMem[id]) { set('url("' + notesImgMem[id] + '")'); return; }
    notesImageResolve(src).then(function(d){ if (el.dataset.coverRef === src) set('url("' + d + '")'); }).catch(function(){});
  }
  // Moves inline (legacy or offline-fallback) images out of pages, one upload at a time.
  var notesOffloadBusy = false, notesOffloadMap = new Map(), notesOffloadFailedAt = 0;
  function notesOffloadCan() { return !notesShareMode && notesLoadedRemote && !notesCloudIncomplete && !!notesLoadedFor && typeof db !== 'undefined' && !!notesAuthUid(); }
  function notesForEachImageSrc(fn) {
    function walk(blocks) {
      (blocks || []).forEach(function(b){
        if (!b || typeof b !== 'object') return;
        if (b.type === 'image' && typeof b.src === 'string') { var v = fn(b.src); if (v !== undefined) b.src = v; }
        if (b.type === 'database' && Array.isArray(b.rows)) b.rows.forEach(function(r){ if (r && r.page && Array.isArray(r.page.blocks)) walk(r.page.blocks); });
      });
    }
    notesPages.forEach(function(p){
      if (p.cover === 'image' && typeof p.coverImage === 'string') { var v = fn(p.coverImage); if (v !== undefined) p.coverImage = v; }
      walk(p.blocks);
    });
  }
  function notesInlineImages() { var list = []; notesForEachImageSrc(function(v){ if (notesValidCoverImage(v) && list.indexOf(v) < 0) list.push(v); }); return list; }
  function notesOffloadWanted() { return notesOffloadBusy || (notesOffloadCan() && Date.now() - notesOffloadFailedAt >= 60000 && notesInlineImages().length > 0); }
  function notesOffloadImages() {
    if (notesOffloadBusy || !notesOffloadCan() || Date.now() - notesOffloadFailedAt < 60000) return;
    var list = notesInlineImages(); if (!list.length) return;
    var owner = notesLoadedFor, i = 0, changed = false; notesOffloadBusy = true;
    function done() {
      notesOffloadBusy = false;
      if (notesLoadedFor !== owner) return;
      if (changed) notesForEachImageSrc(function(v){ return notesOffloadMap.has(v) ? notesOffloadMap.get(v) : undefined; });
      if (changed || notesDirty) notesScheduleSave();
    }
    function next() {
      if (notesLoadedFor !== owner || !notesOffloadCan()) { done(); return; }
      if (i >= list.length) { done(); return; }
      var data = list[i++];
      if (notesOffloadMap.has(data)) { changed = true; next(); return; }
      notesImageUpload(data).then(function(ref){ notesOffloadMap.set(data, ref); changed = true; next(); },
        function(err){ console.warn('Image upload failed:', err); notesOffloadFailedAt = Date.now(); done(); });
    }
    next();
  }
  function notesPickImages(afterId) {
    var ctx = notesRowScope;
    var old = document.getElementById('notesImagePickerInput'); if (old) old.remove();
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.id = 'notesImagePickerInput';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);
    input.addEventListener('change', function(){
      var files = Array.prototype.slice.call(input.files || []); input.remove();
      if (!files.length) return;
      var prev = afterId;
      files.reduce(function(p, f){
        return p.then(function(){ return notesBound(function(){ return notesInsertPastedImage(f, prev); }, ctx)(); })
          .then(function(id){ if (id) prev = id; });
      }, Promise.resolve());
    });
    input.addEventListener('cancel', function(){ input.remove(); });
    input.click();
  }

  /* v3.38: rich text (bold / italic / underline / strike / colour / highlight / links).
     block.text always keeps the plain text; block.textHtml keeps sanitized formatting and
     is only used while block.textHtmlFor still equals block.text (any other edit falls back to plain). */
  function notesRtEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function notesRtSafeHref(h) {
    h = String(h || '').trim(); if (!h) return '';
    if (/^(https?:\/\/|mailto:)/i.test(h)) return h.slice(0, 2000);
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(h)) return 'https://' + h.slice(0, 2000);
    return '';
  }
  function notesRtSerialize(root) {
    var out = '';
    function walk(n) {
      if (n.nodeType === 3) { out += notesRtEsc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName.toLowerCase();
      if (tag === 'br') { out += '<br>'; return; }
      if (/^(script|style|template|iframe|object|embed|img|svg|video|audio|input|textarea|select|button)$/.test(tag)) return;
      if (/^(div|p|li|h[1-6]|blockquote|pre)$/.test(tag) && out && !/<br>$/.test(out)) out += '<br>';
      var st = n.style || {}, open = '', close = '';
      function wrap(t, attrs) { open += '<' + t + (attrs || '') + '>'; close = '</' + t + '>' + close; }
      var fw = String(st.fontWeight || ''), td = String(st.textDecorationLine || st.textDecoration || '');
      if (tag === 'b' || tag === 'strong' || fw === 'bold' || Number(fw) >= 600) wrap('b');
      if (tag === 'i' || tag === 'em' || st.fontStyle === 'italic') wrap('i');
      if (tag === 'u' || /underline/.test(td)) wrap('u');
      if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(td)) wrap('s');
      var tc = n.getAttribute('data-tc'), bg = n.getAttribute('data-bg');
      if (tc && tc !== 'default' && Object.prototype.hasOwnProperty.call(NOTES_TEXT_COLORS, tc)) wrap('span', ' data-tc="' + tc + '"');
      if (bg && bg !== 'default' && Object.prototype.hasOwnProperty.call(NOTES_BG_COLORS, bg)) wrap('span', ' data-bg="' + bg + '"');
      if (tag === 'a') { var h = notesRtSafeHref(n.getAttribute('href')); if (h) wrap('a', ' href="' + notesRtEsc(h).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer"'); }
      out += open; for (var c = n.firstChild; c; c = c.nextSibling) walk(c); out += close;
    }
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
    var prev;
    do { prev = out; out = out.replace(/<(b|i|u|s)><\/\1>/g, '').replace(/<span data-(tc|bg)="[a-z]+"><\/span>/g, '').replace(/<a [^>]*><\/a>/g, ''); } while (prev !== out);
    return out;
  }
  function notesRtHasFormat(html) { return /<(b|i|u|s|a|span)[\s>]/.test(html); }
  function notesRtClean(html) {
    try { var doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html'); return notesRtSerialize(doc.body); }
    catch (_) { return ''; }
  }
  function notesRtCapture(el) { var h = notesRtSerialize(el); return notesRtHasFormat(h) && h.length <= 120000 ? h : ''; }
  function notesRtStore(b, field, html, value) {
    if (html) { b[field + 'Html'] = html; b[field + 'HtmlFor'] = value; }
    else { delete b[field + 'Html']; delete b[field + 'HtmlFor']; }
  }
  function notesRtApply(el, block, field) {
    var h = block[field + 'Html'];
    if (typeof h !== 'string' || !h || block[field + 'HtmlFor'] !== (block[field] || '')) return;
    var clean = notesRtClean(h); if (clean && notesRtHasFormat(clean)) el.innerHTML = clean;
  }
  (function notesRtStyles(){
    var css = '';
    Object.keys(NOTES_TEXT_COLORS).forEach(function(k){ if (k !== 'default') css += '[data-notes-field] [data-tc="' + k + '"],.notes-fmt-swatch[data-tc="' + k + '"]{color:' + NOTES_TEXT_COLORS[k] + ';}'; });
    Object.keys(NOTES_BG_COLORS).forEach(function(k){ if (k !== 'default') css += '[data-notes-field] [data-bg="' + k + '"]{background:' + NOTES_BG_COLORS[k].replace(/,\.1\d?\)$/, ',.32)') + ';border-radius:3px;padding:0 1px;}.notes-fmt-swatch[data-bg="' + k + '"]{background:' + NOTES_BG_COLORS[k].replace(/,\.1\d?\)$/, ',.38)') + ';}'; });
    var s = document.createElement('style'); s.id = 'notes-rich-text-colors'; s.textContent = css + '.notes-fmt-bar{position:fixed;top:-9999px;left:0;z-index:2147483000;display:flex;align-items:center;flex-wrap:wrap;gap:2px;max-width:min(300px,calc(100vw - 16px));padding:4px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(14,17,23,.985);box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(18px);opacity:0;pointer-events:none;transition:opacity .12s ease;font-family:inherit;user-select:none;-webkit-user-select:none}\n.notes-fmt-bar.open{opacity:1;pointer-events:auto}\n.notes-fmt-bar[data-mode=color]{width:252px;padding:6px 7px 8px}\n.notes-fmt-btn{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--textDim,#aab);font:inherit;font-size:14px;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}\n.notes-fmt-btn svg{width:17px;height:17px}\n.notes-fmt-btn:hover{background:rgba(255,255,255,.07);color:var(--textMain,#fff)}\n.notes-fmt-btn.active{background:rgba(255,255,255,.13);color:var(--textMain,#fff)}\n.notes-fmt-a{font-weight:700;font-size:15px;border-bottom:2px solid currentColor;line-height:1.05}\n.notes-fmt-sep{width:1px;height:20px;margin:0 3px;background:rgba(255,255,255,.1)}\n.notes-fmt-label{width:100%;padding:3px 2px 4px;color:rgba(255,255,255,.32);font-size:10.6px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}\n.notes-fmt-swatches{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;width:100%;margin-bottom:4px}\n.notes-fmt-swatch{height:30px;border:1px solid rgba(255,255,255,.09);border-radius:7px;background:rgba(255,255,255,.025);color:var(--textMain,#fff);font:inherit;font-weight:700;font-size:13px;cursor:pointer;padding:0}\n.notes-fmt-swatch:hover{border-color:rgba(255,255,255,.28)}\n.notes-fmt-linkform{display:flex;align-items:center;gap:3px;margin:0}\n.notes-fmt-input{width:170px;height:30px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(255,255,255,.03);color:var(--textMain,#fff);font:inherit;font-size:13px;padding:5px 8px;outline:0;user-select:text;-webkit-user-select:text}\n.notes-fmt-input:focus{border-color:rgba(255,255,255,.26)}\n.notes-fmt-input.invalid{border-color:#e98282}\n[data-notes-field] a[href]{color:#79aee8;text-decoration:underline;text-underline-offset:2px;cursor:pointer}\n[data-notes-field][contenteditable=true] a[href]{cursor:text}\n.notes-image-block.is-loading{min-height:120px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.07),rgba(255,255,255,.03));background-size:200% 100%;animation:notesImgPulse 1.2s ease infinite}\n@keyframes notesImgPulse{from{background-position:200% 0}to{background-position:-200% 0}}\n@media (pointer:coarse){.notes-fmt-btn{width:38px;height:38px}}\n'; document.head.appendChild(s);
  })();

  /* Floating format bar: appears above a text selection inside a Notes text block. */
  (function notesFormatToolbar(){
    var bar = null, ed = null, range = null, mode = 'main', hideTimer = null, raf = 0;
    function editableOf(node) {
      var el = node && (node.nodeType === 1 ? node : node.parentNode);
      el = el && el.closest ? el.closest('[contenteditable="true"][data-notes-field]') : null;
      if (!el || notesShareMode || !el.closest('.notes-block') || el.closest('.notes-equation,.notes-code')) return null;
      var f = el.dataset.notesField; return f === 'text' || f === 'detail' ? el : null;
    }
    function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
    var ICONS = {
      bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
      italic: svg('<path d="M19 5h-8"/><path d="M13 19H5"/><path d="M15 5 9 19"/>'),
      underline: svg('<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'),
      strike: svg('<path d="M16 6.5C15.2 5 13.7 4 11.8 4 9.3 4 7.5 5.5 7.5 7.5c0 1.6 1 2.6 2.7 3.3"/><path d="M4 12h16"/><path d="M8 17.3c.8 1.6 2.4 2.7 4.4 2.7 2.6 0 4.6-1.6 4.6-3.8 0-1-.4-1.8-1.1-2.4"/>'),
      link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>')
    };
    function build() {
      bar = document.createElement('div'); bar.className = 'notes-fmt-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Text formatting');
      bar.addEventListener('pointerdown', function(e){ if (e.target.closest('input')) return; e.preventDefault(); });
      bar.addEventListener('mousedown', function(e){ if (e.target.closest('input')) return; e.preventDefault(); });
      document.body.appendChild(bar);
    }
    function btn(cls, html, title, fn, active) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'notes-fmt-btn ' + cls + (active ? ' active' : ''); b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); fn(); }); return b;
    }
    function restore() { if (!range) return false; var s = window.getSelection(); s.removeAllRanges(); s.addRange(range); return true; }
    function commit() {
      if (!ed) return;
      ed.dispatchEvent(new Event('input', { bubbles:true }));
      var s = window.getSelection(); if (s.rangeCount) range = s.getRangeAt(0).cloneRange();
    }
    function state(cmd) { try { return document.queryCommandState(cmd); } catch (_) { return false; } }
    function linkAt() { var n = range && range.commonAncestorContainer; n = n && (n.nodeType === 1 ? n : n.parentNode); var a = n && n.closest ? n.closest('a[href]') : null; return a && ed && ed.contains(a) ? a : null; }
    function exec(cmd, val) { if (!restore()) return; try { document.execCommand('styleWithCSS', false, false); } catch (_) {} document.execCommand(cmd, false, val); commit(); paint(); }
    function wrapAttr(attr, key) {
      if (!restore()) return; var sel = window.getSelection(); if (!sel.rangeCount) return;
      var r = sel.getRangeAt(0); if (r.collapsed || !ed.contains(r.commonAncestorContainer)) return;
      var start = r.commonAncestorContainer; start = start.nodeType === 1 ? start : start.parentNode;
      var anc = start.closest('[' + attr + ']'); if (anc && !ed.contains(anc)) anc = null;
      var frag = r.extractContents();
      Array.prototype.forEach.call(frag.querySelectorAll('[' + attr + ']'), function(n){ n.removeAttribute(attr); if (n.nodeName === 'SPAN' && !n.attributes.length) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.parentNode.removeChild(n); } });
      var node = frag;
      if (key !== 'default') { node = document.createElement('span'); node.setAttribute(attr, key); node.appendChild(frag); }
      var first = node.nodeType === 11 ? node.firstChild : node, last = node.nodeType === 11 ? node.lastChild : node;
      if (anc) {
        // Split the coloured ancestor around the selection and keep inner formatting (bold, links…).
        var chain = [], p = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
        while (p && p !== anc) { chain.push(p); p = p.parentNode; }
        var tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(anc, anc.childNodes.length);
        var tailFrag = tail.extractContents(), clone = anc.cloneNode(false); clone.appendChild(tailFrag);
        anc.parentNode.insertBefore(clone, anc.nextSibling);
        var holder = node; chain.forEach(function(c){ var w = c.cloneNode(false); w.appendChild(holder); holder = w; });
        anc.parentNode.insertBefore(holder, clone);
        if (!anc.textContent) anc.parentNode.removeChild(anc);
        if (!clone.textContent) clone.parentNode.removeChild(clone);
      } else r.insertNode(node);
      if (first && last && first.parentNode && last.parentNode) { var nr = document.createRange(); nr.setStartBefore(first); nr.setEndAfter(last); sel.removeAllRanges(); sel.addRange(nr); }
      commit(); paint();
    }
    function place() {
      if (!bar || !range) return;
      var rect = range.getBoundingClientRect(); if (!rect || (!rect.width && !rect.height)) { var rs = range.getClientRects(); if (rs.length) rect = rs[0]; }
      var bw = bar.offsetWidth, bh = bar.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      var mobile = notesIsMobile() || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
      var top = mobile ? rect.bottom + 12 : rect.top - bh - 9;
      if (!mobile && top < 8) top = rect.bottom + 9;
      if (mobile && top + bh > vh - 8) top = rect.top - bh - 12;
      var left = rect.left + rect.width / 2 - bw / 2; left = Math.max(8, Math.min(vw - bw - 8, left));
      bar.style.top = Math.max(8, top) + 'px'; bar.style.left = left + 'px';
    }
    function paint() {
      if (!bar) build();
      bar.innerHTML = ''; bar.dataset.mode = mode;
      if (mode === 'main') {
        bar.appendChild(btn('b', ICONS.bold, 'Bold (Ctrl+B)', function(){ exec('bold'); }, state('bold')));
        bar.appendChild(btn('i', ICONS.italic, 'Italic (Ctrl+I)', function(){ exec('italic'); }, state('italic')));
        bar.appendChild(btn('u', ICONS.underline, 'Underline (Ctrl+U)', function(){ exec('underline'); }, state('underline')));
        bar.appendChild(btn('s', ICONS.strike, 'Strikethrough', function(){ exec('strikeThrough'); }, state('strikeThrough')));
        var sep = document.createElement('span'); sep.className = 'notes-fmt-sep'; bar.appendChild(sep);
        bar.appendChild(btn('color', '<span class="notes-fmt-a">A</span>', 'Text colour & highlight', function(){ mode = 'color'; paint(); place(); }));
        bar.appendChild(btn('link', ICONS.link, linkAt() ? 'Edit link' : 'Add link', function(){ mode = 'link'; paint(); place(); }, !!linkAt()));
      } else if (mode === 'color') {
        var mk = function(label, attr, palette){
          var l = document.createElement('div'); l.className = 'notes-fmt-label'; l.textContent = label; bar.appendChild(l);
          var row = document.createElement('div'); row.className = 'notes-fmt-swatches';
          Object.keys(palette).forEach(function(k){
            var b = document.createElement('button'); b.type = 'button'; b.className = 'notes-fmt-swatch'; b.setAttribute(attr, k); b.textContent = 'A'; b.title = k === 'default' ? 'Default' : k.charAt(0).toUpperCase() + k.slice(1); b.setAttribute('aria-label', label + ': ' + b.title);
            if (k === 'default') b.classList.add('is-default');
            b.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); wrapAttr(attr, k); });
            row.appendChild(b);
          });
          bar.appendChild(row);
        };
        mk('Text', 'data-tc', NOTES_TEXT_COLORS); mk('Highlight', 'data-bg', NOTES_BG_COLORS);
      } else if (mode === 'link') {
        var a = linkAt(), wrapEl = document.createElement('form'); wrapEl.className = 'notes-fmt-linkform';
        var inp = document.createElement('input'); inp.type = 'url'; inp.className = 'notes-fmt-input'; inp.placeholder = 'Paste link…'; inp.value = a ? a.getAttribute('href') : ''; inp.setAttribute('aria-label', 'Link address');
        wrapEl.appendChild(inp);
        wrapEl.appendChild(btn('ok', '✓', 'Apply link', function(){ apply(); }));
        if (a) {
          wrapEl.appendChild(btn('open', '↗', 'Open link', function(){ window.open(a.getAttribute('href'), '_blank', 'noopener'); }));
          wrapEl.appendChild(btn('unlink', '×', 'Remove link', function(){ if (!restore()) return; var nr = document.createRange(); nr.selectNodeContents(a); var s = window.getSelection(); s.removeAllRanges(); s.addRange(nr); range = nr; document.execCommand('unlink'); commit(); mode = 'main'; paint(); place(); }));
        }
        var apply = function(){
          var href = notesRtSafeHref(inp.value); if (!href) { inp.focus(); inp.classList.add('invalid'); return; }
          if (a) { a.setAttribute('href', href); commit(); } else exec('createLink', href);
          mode = 'main'; paint(); place();
        };
        wrapEl.addEventListener('submit', function(e){ e.preventDefault(); apply(); });
        inp.addEventListener('keydown', function(e){ if (e.key === 'Escape') { e.preventDefault(); mode = 'main'; restore(); paint(); place(); } });
        bar.appendChild(wrapEl);
        setTimeout(function(){ inp.focus(); }, 0);
      }
      bar.classList.add('open');
    }
    function hide() { if (bar) { bar.classList.remove('open'); bar.style.top = '-9999px'; } mode = 'main'; ed = null; range = null; }
    function check() {
      raf = 0;
      if (bar && bar.contains(document.activeElement)) return; // typing a link
      var s = window.getSelection();
      if (!s || !s.rangeCount || s.isCollapsed) { hide(); return; }
      var r = s.getRangeAt(0), a = editableOf(r.startContainer), b = editableOf(r.endContainer);
      if (!a || a !== b || !String(s.toString()).trim()) { hide(); return; }
      var same = ed === a && range && mode !== 'main';
      ed = a; range = r.cloneRange();
      if (!same) { mode = 'main'; paint(); }
      place();
    }
    // Small delay: the bar shows only after the selection stops changing (and the mouse is released),
    // so it does not pop up the moment a single letter gets selected.
    var showTimer = null, pressed = false, SHOW_DELAY = 450;
    function schedule() {
      clearTimeout(showTimer); if (raf) { cancelAnimationFrame(raf); raf = 0; }
      var s = window.getSelection();
      if (!s || !s.rangeCount || s.isCollapsed) { if (!(bar && bar.contains(document.activeElement))) hide(); return; }
      if (bar && bar.classList.contains('open')) { raf = requestAnimationFrame(check); return; }
      if (pressed) return;
      showTimer = setTimeout(check, SHOW_DELAY);
    }
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', function(e){ if (!(bar && bar.contains(e.target))) pressed = true; }, true);
    document.addEventListener('pointerup', function(){ if (!pressed) return; pressed = false; schedule(); }, true);
    document.addEventListener('pointercancel', function(){ pressed = false; }, true);
    window.addEventListener('scroll', function(){ if (bar && bar.classList.contains('open')) place(); }, { capture: true, passive: true });
    window.addEventListener('resize', function(){ if (bar && bar.classList.contains('open')) place(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && bar && bar.classList.contains('open')) hide(); });
    document.addEventListener('pointerdown', function(e){ if (bar && bar.classList.contains('open') && !bar.contains(e.target) && !editableOf(e.target)) { clearTimeout(hideTimer); hideTimer = setTimeout(function(){ var s = window.getSelection(); if (!s || s.isCollapsed) hide(); }, 0); } }, true);
    // Links: Ctrl/Cmd+click while editing, plain click on read-only (shared) pages.
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest ? e.target.closest('[data-notes-field] a[href]') : null; if (!a) return;
      var host = a.closest('[data-notes-field]'); var editing = host && host.isContentEditable;
      if (!editing || e.ctrlKey || e.metaKey) { e.preventDefault(); var h = notesRtSafeHref(a.getAttribute('href')); if (h) window.open(h, '_blank', 'noopener'); }
    });
  })();
  function notesNormalizePages(value) {
    if (!Array.isArray(value)) return [];
    var pages = value.slice(0, 180).map(function(page, i) {
      page = page && typeof page === 'object' ? page : {};
      return {
        id: page.id || notesId('p'),
        title: notesClampText(page.title || 'Untitled', 160),
        icon: notesClampText(page.icon || '', 64),
        iconType: page.iconType === 'icon' || (!page.iconType && NOTES_ICONS.indexOf(page.icon)>=0) ? 'icon' : 'emoji',
        iconColor: notesSafeColor(page.iconColor || 'default', NOTES_ICON_COLORS),
        cover: ['','graphite','ember','forest','ocean','violet','gold'].indexOf(page.cover) >= 0 ? page.cover : (page.cover === 'image' && notesValidImageSrc(page.coverImage) ? 'image' : ''),
        coverImage: page.cover === 'image' && notesValidImageSrc(page.coverImage) ? page.coverImage : '',
        parentId: typeof page.parentId === 'string' ? page.parentId : null,
        groupId: typeof page.groupId === 'string' ? page.groupId.slice(0, 64) : '',
        collapsed: !!page.collapsed,
        order: Number.isFinite(Number(page.order)) ? Number(page.order) : i,
        comments: notesNormalizeComments(page.comments),
        shareToken: typeof page.shareToken === 'string' && /^[A-Za-z0-9]{16,64}$/.test(page.shareToken) ? page.shareToken : '',
        blocks: Array.isArray(page.blocks) ? page.blocks.slice(0, 350).map(notesNormalizeBlock) : [notesDefaultBlock('text')]
      };
    });
    var byId = {};
    pages.forEach(function(p){
      if (byId[p.id]) p.id = notesId('p');
      byId[p.id] = p;
      var seenBlocks = {};
      p.blocks.forEach(function(b){ if (seenBlocks[b.id]) b.id = notesId('b'); seenBlocks[b.id] = true; });
    });
    pages.forEach(function(p){ if (!byId[p.parentId] || p.parentId === p.id) p.parentId = null; if (!p.blocks.length) p.blocks = [notesDefaultBlock('text')]; });
    // Break parent cycles (A -> B -> A): such pages were unreachable from the sidebar root.
    pages.forEach(function(p){
      var cur = byId[p.parentId], guard = 0;
      while (cur && guard++ < 400) { if (cur.id === p.id) { p.parentId = null; break; } cur = byId[cur.parentId]; }
    });
    return pages;
  }

  function notesCurrentPage() { if(notesRowScope)return notesRowValid(notesRowScope)?notesRowFacade(notesRowScope):null; return notesPages.filter(function(p){ return p.id === notesActivePageId; })[0] || null; }
  function notesPageById(id) { return notesPages.filter(function(p){ return p.id === id; })[0] || null; }
  function notesBlockById(id, page) { page = page || notesCurrentPage(); return page && page.blocks ? page.blocks.filter(function(b){return b.id===id;})[0] || null : null; }
  function notesPageChildren(parentId) { return notesPages.filter(function(p){return (p.parentId || null) === (parentId || null);}).sort(function(a,b){return a.order-b.order;}); }
  function notesHasChildren(pageId) { return notesPages.some(function(p){return p.parentId===pageId;}); }

  /* ---------- v3.16: sidebar groups ---------- */
  function notesDefaultGroups() { return [{ id:'g_private', name:'Private', icon:'', iconType:'emoji', iconColor:'default', collapsed:false, order:0 }]; }
  function notesNormalizeGroups(value) {
    var seen = {}, out = [];
    (Array.isArray(value) ? value.slice(0, 40) : []).forEach(function(g, i){
      if (!g || typeof g !== 'object') return;
      var id = typeof g.id === 'string' && g.id ? g.id.slice(0, 64) : notesId('g');
      if (seen[id]) id = notesId('g'); seen[id] = true;
      out.push({ id:id, name:notesClampText(String(g.name || '').trim() || 'Untitled group', 60), icon:notesClampText(g.icon || '', 64),
        iconType:g.iconType === 'icon' ? 'icon' : 'emoji', iconColor:notesSafeColor(g.iconColor || 'default', NOTES_ICON_COLORS),
        collapsed:!!g.collapsed, order:Number.isFinite(Number(g.order)) ? Number(g.order) : i });
    });
    out.sort(function(a,b){ return a.order - b.order; }); out.forEach(function(g,i){ g.order = i; });
    return out.length ? out : notesDefaultGroups();
  }
  function notesGroupById(id) { return notesGroups.filter(function(g){ return g.id === id; })[0] || null; }
  function notesSortedGroups() { return notesGroups.slice().sort(function(a,b){ return a.order - b.order; }); }
  // Every top-level page belongs to an existing group; orphans fall into the first one.
  function notesEnsurePageGroups() {
    if (!notesGroups.length) notesGroups = notesDefaultGroups();
    var first = notesSortedGroups()[0].id;
    notesPages.forEach(function(p){ if (!p.parentId && !notesGroupById(p.groupId)) p.groupId = first; });
  }
  function notesRootGroupOf(page) {
    var seen = {};
    while (page && page.parentId && !seen[page.id]) { seen[page.id] = true; page = notesPageById(page.parentId) || null; }
    return page && notesGroupById(page.groupId) ? page.groupId : (notesGroups.length ? notesSortedGroups()[0].id : '');
  }
  function notesAddPageToGroup(groupId) {
    var g = notesGroupById(groupId); if (g) g.collapsed = false;
    return notesAddPage(null, groupId);
  }
  function notesAddGroup() {
    var g = { id:notesId('g'), name:'New group', icon:'', iconType:'emoji', iconColor:'default', collapsed:false, order:notesGroups.length };
    notesGroups.push(g); notesRenderSidebar(); notesScheduleSave();
    requestAnimationFrame(function(){ notesRenameGroupInline(g.id); });
  }
  function notesRenameGroupInline(groupId) {
    notesCloseMenus();
    var g = notesGroupById(groupId), head = document.querySelector('.notes-group-header[data-group="'+groupId+'"]'); if (!g || !head) return;
    var nameEl = head.querySelector('.notes-group-name'); if (!nameEl) return;
    var input = document.createElement('input'); input.className = 'notes-group-name-input'; input.value = g.name; input.maxLength = 60;
    nameEl.replaceWith(input); input.focus(); input.select();
    ['click','mousedown','dblclick'].forEach(function(t){ input.addEventListener(t, function(e){ e.stopPropagation(); }); });
    var done = false;
    function commit(cancel){ if (done) return; done = true; if (!cancel) { var v = input.value.trim(); if (v && v !== g.name) { g.name = notesClampText(v, 60); notesScheduleSave(); } } notesRenderSidebar(); }
    input.addEventListener('blur', function(){ commit(false); });
    input.addEventListener('keydown', function(e){ e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(false); } if (e.key === 'Escape') { e.preventDefault(); commit(true); } });
  }
  function notesMoveGroup(groupId, delta) {
    var list = notesSortedGroups(), i = list.findIndex(function(g){ return g.id === groupId; }), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    var t = list[i]; list[i] = list[j]; list[j] = t; list.forEach(function(g,k){ g.order = k; });
    notesRenderSidebar(); notesScheduleSave();
  }
  function notesDeleteGroup(groupId) {
    var g = notesGroupById(groupId); if (!g || notesGroups.length < 2) return;
    var target = notesSortedGroups().filter(function(x){ return x.id !== groupId; })[0];
    var count = notesPages.filter(function(p){ return !p.parentId && p.groupId === groupId; }).length;
    function run(){
      notesHistoryBreak(); var before = notesHistorySnap();
      notesPages.forEach(function(p){ if (!p.parentId && p.groupId === groupId) p.groupId = target.id; });
      notesGroups = notesGroups.filter(function(x){ return x.id !== groupId; });
      notesSortedGroups().forEach(function(x,k){ x.order = k; });
      notesRenderSidebar(); notesScheduleSave(); notesUndoToast('Group deleted', before);
    }
    if (!count) { run(); return; }
    notesConfirm({ title:'Delete group “'+g.name+'”?', text:count+' page'+(count===1?'':'s')+' will move to “'+target.name+'”. No pages are deleted.', confirm:'Delete group', danger:true }, run);
  }
  function notesMovePageToGroup(pageId, groupId) {
    var page = notesPageById(pageId), g = notesGroupById(groupId); if (!page || !g) return;
    var oldParent = page.parentId;
    page.parentId = null; page.groupId = groupId; g.collapsed = false;
    if (oldParent) notesReindexSiblings(oldParent);
    var roots = notesPageChildren(null).filter(function(p){ return p.id !== pageId; }); roots.push(page); roots.forEach(function(p,i){ p.order = i; });
    notesRenderSidebar(); notesScheduleSave();
  }
  function notesOpenGroupMenu(g, anchor) {
    var first = notesSortedGroups()[0], last = notesSortedGroups()[notesGroups.length - 1];
    var items = [
      {label:'Rename', icon:'✎', action:function(){ notesRenameGroupInline(g.id); }},
      {label:g.icon ? 'Change icon' : 'Add icon', icon:'◉', action:function(){ setTimeout(function(){ notesOpenIconPicker(anchor, {value:g.icon||'', type:g.iconType||'emoji', color:g.iconColor||'default'}, function(pick){ g.icon = pick.value || ''; g.iconType = pick.type || 'emoji'; g.iconColor = pick.color || 'default'; notesRenderSidebar(); notesScheduleSave(); }); }, 0); }},
      {label:'New page', icon:'+', action:function(){ notesAddPageToGroup(g.id); }}
    ];
    if (g.icon) items.splice(2, 0, {label:'Remove icon', icon:'×', action:function(){ g.icon = ''; g.iconType = 'emoji'; g.iconColor = 'default'; notesRenderSidebar(); notesScheduleSave(); }});
    if (notesGroups.length > 1) {
      items.push({type:'sep'});
      if (g.id !== first.id) items.push({label:'Move up', icon:'↑', action:function(){ notesMoveGroup(g.id, -1); }});
      if (g.id !== last.id) items.push({label:'Move down', icon:'↓', action:function(){ notesMoveGroup(g.id, 1); }});
      items.push({label:'Delete group', icon:'×', danger:true, action:function(){ notesDeleteGroup(g.id); }});
    }
    notesOpenMenu(anchor, items, {wide:false});
  }
  function notesGroupHeader(g) {
    var head = document.createElement('div'); head.className = 'notes-group-header' + (g.collapsed ? ' collapsed' : ''); head.dataset.group = g.id;
    head.setAttribute('role','button'); head.tabIndex = 0; head.setAttribute('aria-expanded', g.collapsed ? 'false' : 'true');
    if (g.icon) { var ic = document.createElement('span'); ic.className = 'notes-group-icon'; notesPaintIcon(ic, g.icon, g.iconType, g.iconColor); head.appendChild(ic); }
    var name = document.createElement('span'); name.className = 'notes-group-name'; name.textContent = g.name; name.title = g.name; head.appendChild(name);
    var caret = document.createElement('span'); caret.className = 'notes-group-caret'; caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'; caret.setAttribute('aria-hidden','true'); head.appendChild(caret);
    var more = document.createElement('button'); more.type = 'button'; more.className = 'notes-group-btn notes-page-more'; notesDots(more); more.title = 'Group actions'; more.setAttribute('aria-label','Group actions');
    more.addEventListener('click', function(e){ e.stopPropagation(); notesOpenGroupMenu(g, more); }); head.appendChild(more);
    var add = document.createElement('button'); add.type = 'button'; add.className = 'notes-group-btn'; add.textContent = '+'; add.title = 'New page in this group'; add.setAttribute('aria-label','New page in '+g.name);
    add.addEventListener('click', function(e){ e.stopPropagation(); notesAddPageToGroup(g.id); }); head.appendChild(add);
    function toggle(){ g.collapsed = !g.collapsed; notesRenderSidebar(); notesScheduleSave(); }
    head.addEventListener('click', function(){ notesCloseMenus(); toggle(); });
    head.addEventListener('dblclick', function(e){ if (!e.target.closest('button')) notesRenameGroupInline(g.id); });
    head.addEventListener('keydown', function(e){ if (e.target !== head) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } if (e.key === 'F2') { e.preventDefault(); notesRenameGroupInline(g.id); } });
    head.addEventListener('dragover', function(e){ if (!notesDraggedPageId) return; e.preventDefault(); notesClearPageDropMarks(); head.classList.add('drop-into'); });
    head.addEventListener('dragleave', function(){ head.classList.remove('drop-into'); });
    head.addEventListener('drop', function(e){ if (!notesDraggedPageId) return; e.preventDefault(); head.classList.remove('drop-into'); var id = notesDraggedPageId; notesDraggedPageId = null; notesClearPageDropMarks(); if (notesPageById(id)) notesMovePageToGroup(id, g.id); });
    return head;
  }

  var notesSaveStatusExpanded = false;
  function notesSyncSaveStatus(reset) {
    var allowed=false;
    try { allowed=!notesShareMode&&typeof isRetockerAuth==='function'&&isRetockerAuth(); } catch(_) {}
    if(reset||!allowed)notesSaveStatusExpanded=false;
    var controls=document.getElementById('notesSaveControls'),toggle=document.getElementById('notesSaveToggle'),status=document.getElementById('notesSaveState');
    if(controls)controls.hidden=!allowed;
    if(status)status.hidden=!allowed||!notesSaveStatusExpanded;
    if(toggle){
      toggle.setAttribute('aria-expanded',String(allowed&&notesSaveStatusExpanded));
      var label=notesSaveStatusExpanded?'Hide save status':'Show save status';
      toggle.setAttribute('aria-label',label);toggle.title=label;
    }
  }
  var notesSaveToggle=document.getElementById('notesSaveToggle');
  if(notesSaveToggle)notesSaveToggle.addEventListener('click',function(){
    notesSaveStatusExpanded=!notesSaveStatusExpanded;notesSyncSaveStatus(false);
  });
  // Follow the signed-in Firebase account, never the journal selected for viewing.
  try { var notesStatusAuth=firebase.auth();if(notesStatusAuth.onAuthStateChanged)notesStatusAuth.onAuthStateChanged(function(){notesSyncSaveStatus(true);}); } catch(_) {}
  notesSyncSaveStatus(true);

  function notesSetState(text, cls) {
    var el = document.getElementById('notesSaveState');
    if (!el) return;
    el.textContent = text;el.title=text;
    notesSyncSaveStatus(false);
    el.classList.remove('saving','error');
    if (cls) el.classList.add(cls);
  }

  function notesScheduleSave() {
    if(notesMobileLoading)return;
    if(notesRowScope&&(!notesRowValid(notesRowScope)||!notesRowPreflight()))return;
    notesTabsPaint();
    if (notesShareMode || !notesWorkspaceMode || !notesLoadedFor) return;
    notesHistoryRecord();
    clearTimeout(notesSaveTimer);
    notesDirty = true;
    // Immediate local snapshot: closing the tab inside the debounce window no longer loses edits.
    notesSaveLocal(notesLoadedFor, { version:3, pages:notesPages, groups:notesGroups, updatedAt:Date.now() });
    notesSetState(notesCloudIncomplete ? 'Cloud recovery needed · saved locally' : 'Saving…', notesCloudIncomplete ? 'error' : 'saving');
    notesSaveTimer = setTimeout(notesSave, 420);
  }

  function notesSaveLocal(ownerKey, snapshot) {
    snapshot=Object.assign({},snapshot);
    if(ownerKey===notesLoadedFor&&notesLoadedRemote){snapshot.cloudBase=notesCloudRevision;snapshot.conflict=notesCloudConflict;}
    // Reuse the mobile cache JSON without delaying the durable local write.
    var serialized = ownerKey ? notesMobileCachePut(ownerKey,snapshot) : undefined;
    try { localStorage.setItem(notesStorageKey(ownerKey), serialized === undefined ? JSON.stringify(snapshot) : serialized); return true; }
    catch (e) { return false; }
  }

  // v3.18.1: each Notes page is a separate Firestore document in the existing
  // `titles` collection. Page writes + deletes + workspace metadata are committed
  // atomically in one batch, including the one-time v2 -> v3 migration.
  function notesPageCloudDocId(ownerKey, pageId) { return ownerKey + '__np__' + pageId; }
  function notesPageCloudRef(ownerKey, pageId) { return db.collection('titles').doc(notesPageCloudDocId(ownerKey, pageId)); }
  // Recovery path for older/broken Notes roots: page documents may still exist even
  // when titles/<owner>.notesWorkspaceMeta lost its pageIds. Because every split-page
  // document carries notesPageOwner, we can safely discover only this owner's pages
  // and rebuild the root index without touching another user's workspace.
  function notesRecoverOrphanCloudSnapshot(ownerKey) {
    if (!ownerKey || typeof db === 'undefined') return Promise.resolve({ pages:[], updatedAt:0 });
    // Do not swallow a failed server query here. A network/rules failure is not proof
    // that the workspace is empty; notesLoad() must route it through its protected
    // cloud-error path so a local snapshot cannot overwrite unseen cloud pages.
    return db.collection('titles').where('notesPageOwner','==',ownerKey).get({ source:'server' }).then(function(snapshot){
      var recovered=[], latestUpdatedAt=0;
      snapshot.forEach(function(doc){
        var d=doc.data()||{},raw=d.notesPage;
        if(!raw||typeof raw!=='object'||d.notesPageOwner!==ownerKey)return;
        latestUpdatedAt=Math.max(latestUpdatedAt,Number(d.updatedAt)||0);
        raw=notesClone(raw);
        // Prefer the embedded page id. Fall back to the split-document suffix for
        // very old snapshots that did not persist page.id consistently.
        if(!raw.id){
          var prefix=ownerKey+'__np__';
          raw.id=String(doc.id||'').indexOf(prefix)===0?String(doc.id).slice(prefix.length):'';
        }
        if(raw.id)recovered.push(raw);
      });
      return { pages:notesNormalizePages(recovered), updatedAt:latestUpdatedAt };
    });
  }
  function notesRecoverOrphanCloudPages(ownerKey) {
    return notesRecoverOrphanCloudSnapshot(ownerKey).then(function(recovery){ return recovery.pages; });
  }
  function notesMergeRecoveryPages(cloudPages, localPages, preferLocal) {
    var out=[], byId={};
    (cloudPages||[]).forEach(function(page){
      if(!page||!page.id||byId[page.id])return;
      byId[page.id]=notesClone(page);out.push(page.id);
    });
    (localPages||[]).forEach(function(page){
      if(!page||!page.id)return;
      if(!byId[page.id]){byId[page.id]=notesClone(page);out.push(page.id);return;}
      if(preferLocal)byId[page.id]=notesClone(page);
    });
    return notesNormalizePages(out.map(function(id){return byId[id];}));
  }
  function notesPageCloudHash(page) { try { return JSON.stringify(page); } catch (_) { return ''; } }
  function notesJsonBytes(value) {
    var json = ''; try { json = JSON.stringify(value); } catch (_) { return Infinity; }
    try { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : unescape(encodeURIComponent(json)).length; }
    catch (_) { return json.length; }
  }

  function notesRevision(meta) {
    return JSON.stringify([Number(meta&&meta.updatedAt)||0,(meta&&meta.revision)||null]);
  }
  function notesShowConflict(owner) {
    notesCloudConflict=true;notesCloudIncomplete=true;
    notesSetState('Conflict: local draft kept. Cloud was not overwritten.','error');
    notesToast('Notes changed on another device. Your draft is safe; export it before reloading cloud.');
    var panel=document.getElementById('notesConflictPanel');
    if(!panel){panel=document.createElement('div');panel.id='notesConflictPanel';panel.className='notes-callout';panel.style.cssText='padding:12px;border:1px solid #c88a42;margin:12px;border-radius:10px;flex:none;display:flex;flex-wrap:wrap;gap:8px';document.querySelector('.notes-editor-shell').insertBefore(panel,document.getElementById('notesPageWrap'));}
    panel.replaceChildren();panel.append(document.createTextNode('Cloud conflict. Your local draft has not been discarded. '));
    function download(){
      if(notesLoadedFor!==owner)return;
      var data={version:3,owner:owner,pages:notesClone(notesPages),groups:notesClone(notesGroups),updatedAt:Date.now()};
      var url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      var a=document.createElement('a');a.href=url;a.download='SYTER-Notes-local-recovery.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},10000);
    }
    var exportBtn=document.createElement('button');exportBtn.type='button';exportBtn.textContent='Export local draft';exportBtn.onclick=download;panel.append(exportBtn);
    var reload=document.createElement('button');reload.type='button';reload.textContent='Export draft & reload cloud';reload.onclick=function(){
      if(notesLoadedFor!==owner||!window.confirm('Download your local draft and load the latest cloud Notes? Keep the downloaded file to recover your edits.'))return;
      download();notesDirty=false;notesIgnoreLocalOnce=true;notesCloudConflict=false;panel.remove();notesLoad(true);
    };panel.append(reload);
  }

  function notesSave() {
    clearTimeout(notesSaveTimer); notesSaveTimer = null;
    if (notesMobileLoading || !notesDirty || !notesLoadedFor) return;

    var ownerKey = notesLoadedFor, remote = notesLoadedRemote;
    var now = Date.now();
    var snapshot = { version:3, pages:notesClone(notesPages), groups:notesClone(notesGroups), updatedAt:now };
    var okLocal = notesSaveLocal(ownerKey, snapshot);
    var localLabel = okLocal ? 'Saved locally' : 'Not saved';

    // Never overwrite cloud metadata while it references page documents that failed to load.
    // The local snapshot remains editable/recoverable, but remote sync stays blocked until reload/repair.
    if (notesCloudIncomplete) {
      notesSetState('Cloud recovery needed · ' + localLabel.toLowerCase(), 'error');
      return;
    }

    if (!remote || typeof db === 'undefined') {
      notesDirty = false;
      notesSetState(localLabel, okLocal ? '' : 'error');
      return;
    }

    // Only one remote Notes commit at a time. If the user keeps editing (or switches owner)
    // while a commit is in flight, keep the latest local snapshot dirty and flush it next.
    if (notesRemoteSaveInFlight) {
      notesRemoteSavePending = true;
      notesSetState('Saving…','saving');
      return;
    }

    // Each page gets its own size guard. Count UTF-8 bytes rather than JS characters so
    // Cyrillic/emoji-heavy pages do not accidentally exceed Firestore's document limit.
    var tooBig = null;
    for (var si=0; si<snapshot.pages.length; si++) {
      if (notesJsonBytes(snapshot.pages[si]) > NOTES_CLOUD_LIMIT) { tooBig = snapshot.pages[si]; break; }
    }
    if (tooBig && notesOffloadWanted()) {
      // Images are moving to their own storage; the save repeats automatically afterwards.
      notesSetState('Uploading images...', 'saving');
      notesOffloadImages();
      return;
    }
    if (tooBig) {
      notesSetState('Page too large for cloud · ' + localLabel.toLowerCase(), 'error');
      notesToast('This page is too large to sync. Trim large images on this page.');
      return;
    }
    if (notesOffloadCan()) setTimeout(notesOffloadImages, 0);

    notesDirty = false;
    notesRemoteSaveInFlight = true;
    notesRemoteSaveOwner = ownerKey;
    notesRemoteSavePending = false;
    var expectedRevision=notesCloudRevision;
    var currentIds = snapshot.pages.map(function(p){ return p.id; });
    var currentSet = {}; currentIds.forEach(function(id){ currentSet[id]=true; });
    var nextHashes = {};
    var changes=[];
    var opCount = 0;

    snapshot.pages.forEach(function(page){
      var h = notesPageCloudHash(page); nextHashes[page.id] = h;
      if (notesCloudPageHashes[page.id] === h) return;
      changes.push({ref:notesPageCloudRef(ownerKey,page.id),data:{ notesPageOwner:ownerKey, uid:notesOwnerUid(ownerKey), notesPage:page, updatedAt:now }});
      opCount++;
    });
    notesCloudPageIds.forEach(function(id){
      if (!currentSet[id]) { changes.push({ref:notesPageCloudRef(ownerKey,id),remove:true}); opCount++; }
    });

    // Root metadata is part of the SAME atomic transaction. The legacy all-in-one field is only
    // deleted if every page write succeeds, so migration cannot leave a half-split workspace.
    var meta = { version:3, pageIds:currentIds, groups:snapshot.groups, updatedAt:now, revision:now.toString(36)+'_'+Math.random().toString(36).slice(2) };
    var rootRef=db.collection('titles').doc(ownerKey);
    opCount++;

    if (opCount > 490) {
      notesRemoteSaveInFlight = false; notesRemoteSaveOwner = null;
      notesDirty = true;
      notesSetState('Too many page changes · ' + localLabel.toLowerCase(), 'error');
      notesToast('Too many pages changed at once to sync safely.');
      return;
    }

    // The root is the optimistic concurrency guard for every page write/delete.
    // A stale device never overwrites a newer index or silently wins a page conflict.
    return db.runTransaction(function(tx){
      return tx.get(rootRef).then(function(root){
        var live=root.exists?(root.data()||{}):{};
        if(notesRevision(live.notesWorkspaceMeta)!==expectedRevision)throw Object.assign(Error('Notes changed on another device'),{code:'notes-conflict'});
        changes.forEach(function(change){if(change.remove)tx.delete(change.ref);else tx.set(change.ref,change.data,{merge:false});});
        tx.set(rootRef,{ uid:notesOwnerUid(ownerKey), notesWorkspaceMeta:meta, notesWorkspace:firebase.firestore.FieldValue.delete() },{merge:true});
      });
    }).then(function(){
      // Never let an old owner's async completion overwrite the cache for the newly selected owner.
      if (notesLoadedFor === ownerKey) {
        notesCloudPageHashes = nextHashes;
        notesCloudPageIds = currentIds.slice();
        notesCloudRevision=notesRevision(meta);notesCloudConflict=false;
        if(!notesDirty)notesSaveLocal(ownerKey,Object.assign({},snapshot,{cloudBase:notesCloudRevision}));
        notesSyncShares(ownerKey);
      }
      notesRemoteSaveInFlight = false; notesRemoteSaveOwner = null;
      var pending = notesRemoteSavePending; notesRemoteSavePending = false;
      if (pending || (notesLoadedFor === ownerKey && notesDirty)) {
        // Flush edits made while this commit was running. setTimeout avoids deep promise recursion.
        setTimeout(function(){ notesSave(); }, 0);
      } else if (notesLoadedFor === ownerKey) notesSetState('Saved');
    }).catch(function(err){
      console.error('Notes save failed:',err);
      notesRemoteSaveInFlight = false; notesRemoteSaveOwner = null;
      var pending = notesRemoteSavePending; notesRemoteSavePending = false;
      // If the owner changed, their local snapshot will be reconciled the next time that owner loads.
      // Do not mark the new owner's workspace dirty because an old owner's request failed.
      if (notesLoadedFor === ownerKey) {
        notesDirty = true;
        if(err.code==='notes-conflict'){notesCloudConflict=true;notesSaveLocal(ownerKey,{version:3,pages:notesClone(notesPages),groups:notesClone(notesGroups),updatedAt:Date.now()});notesShowConflict(ownerKey);return;}
        notesSetState(localLabel,'error');
        if (pending) notesSetState('Saved locally · cloud retry needed','error');
      }
    });
  }

  /* v3.22.1 mobile notes cache: IndexedDB snapshot for fast mobile reopen. */
  var notesMobileCacheDbPromise = null;
  function notesMobileCacheEnabled(){ return document.body.classList.contains('mobile-mode'); }
  function notesMobileCacheOpen(){
    if (notesMobileCacheDbPromise) return notesMobileCacheDbPromise;
    notesMobileCacheDbPromise = new Promise(function(resolve){
      try {
        if (!window.indexedDB) return resolve(null);
        var req=indexedDB.open('TradingJournalNotesCache',1);
        req.onupgradeneeded=function(){ var db=req.result; if(!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots'); };
        req.onsuccess=function(){resolve(req.result);};
        req.onerror=function(){resolve(null);};
      } catch(e){resolve(null);}
    });
    return notesMobileCacheDbPromise;
  }
  function notesMobileCacheGet(key){
    if(!notesMobileCacheEnabled()) return Promise.resolve(null);
    return Promise.race([new Promise(function(resolve){setTimeout(function(){resolve(null);},180);}),notesMobileCacheOpen().then(function(db){
      if(!db)return null;
      return new Promise(function(resolve){
        try { var tx=db.transaction('snapshots','readonly'), r=tx.objectStore('snapshots').get(key); r.onsuccess=function(){
          var v=r.result;
          if(!v || Date.now()-Number(v.time||0)>7*24*60*60*1000) return resolve(null);
          resolve(v);
        }; r.onerror=function(){resolve(null);}; } catch(e){resolve(null);}
      });
    })]);
  }
  function notesMobileCachePut(key,data){
    if(!notesMobileCacheEnabled()) return;
    // Freeze the IndexedDB snapshot before yielding; share its encoding with localStorage.
    var serialized=JSON.stringify(data);
    data=JSON.parse(serialized);
    notesMobileCacheOpen().then(function(db){
      if(!db)return;
      try { var tx=db.transaction('snapshots','readwrite'); tx.objectStore('snapshots').put({time:Date.now(),data:data},key); } catch(e){}
    });
    return serialized;
  }

  function notesLoadLocal(ownerKey) {
    try {
      var raw = localStorage.getItem(notesStorageKey(ownerKey));
      if (!raw) return { pages:[], groups:notesDefaultGroups(), updatedAt:0 };
      var parsed = JSON.parse(raw);
      return { pages:notesNormalizePages(parsed && parsed.pages), groups:notesNormalizeGroups(parsed && parsed.groups), updatedAt:Number(parsed && parsed.updatedAt) || 0, cloudBase:parsed&&parsed.cloudBase, conflict:!!(parsed&&parsed.conflict) };
    } catch (e) { return { pages:[], groups:notesDefaultGroups(), updatedAt:0 }; }
  }

  function notesResetForOwnerSwitch() {
    var conflict=document.getElementById('notesConflictPanel');if(conflict)conflict.remove();
    notesCloudRevision='[0,null]';notesCloudConflict=false;
    notesSyncSaveStatus(true);
    notesMobileBusy(false);
    notesTabsReset();
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
    notesCloseMenus();
    notesLoadedFor = null;
    notesLoadedRemote = false;
    notesLoadSeq++;
    notesPages = [];
    notesGroups = [];
    notesCloudPageHashes = {}; notesCloudPageIds = [];
    notesCloudIncomplete = false;
    notesRemoteSavePending = false;
    notesActivePageId = null;
    notesSidebarPrimed = false;
    notesLastPageId = null;
    notesLastBlocksPageId = null;
    notesHistoryReset();
    notesRender();
  }

  function notesPickActivePage() {
    if (!notesActivePageId || !notesPageById(notesActivePageId)) notesActivePageId = notesPages.length ? notesPageChildren(null).concat(notesPages)[0].id : null;
  }


  function notesIsMobile(){ return document.body.classList.contains('mobile-mode'); }
  var notesMobileLoading = false;
  function notesMobileBusy(busy) {
    if (!notesIsMobile() && !notesMobileLoading) return;
    notesMobileLoading = busy;
    var ws=document.getElementById('notesWorkspace');
    if(!ws)return;
    ws.classList.toggle('notes-mobile-loading',busy);
    ws.setAttribute('aria-busy',String(busy));
    // Partial snapshots must never be editable or saved as a complete workspace.
    ['notesPage','notesEmptyState','notesPagesList','notesPageSearch','notesWorkspaceTabs','notesRowPanel','notesNewPageBtn','notesPageSettingsBtn'].forEach(function(id){
      var node=document.getElementById(id);if(node)node.inert=busy;
    });
    var status=document.getElementById('notesMobileLoadStatus');
    if(!status){status=document.createElement('div');status.id='notesMobileLoadStatus';status.setAttribute('role','status');ws.querySelector('.notes-editor-shell').prepend(status);}
    status.textContent=busy?'Загрузка заметок…':'';status.hidden=!busy;
  }
  function notesMobilePreview(pages,groups){
    notesPages=pages;notesGroups=groups;notesEnsurePageGroups();notesPickActivePage();
    notesMobileBusy(true);notesRender();notesMobileBusy(true);
  }
  // Keep the existing localStorage format; fetch pages in bounded groups on mobile.
  // All pages are still reconciled together before writes are enabled.
  function notesFetchMobilePages(owner,ids,seq,key,local,meta){
    var results=new Array(ids.length),next=0,previewed=local.pages.length>0,failed=false;
    var priority=ids.indexOf(notesActivePageId),order=ids.map(function(_,i){return i;});
    var hash=String(location.hash).match(/^#notes\/([^/]+)/);
    if(hash){try{priority=ids.indexOf(decodeURIComponent(hash[1]));}catch(_){}}
    if(priority>0){order.splice(priority,1);order.unshift(priority);}
    function worker(){
      if(failed||seq!==notesLoadSeq||key!==(notesOwner()||'local')||next>=order.length)return Promise.resolve();
      var index=order[next++];
      return notesPageCloudRef(owner,ids[index]).get({ source:'server' }).then(function(snap){
        results[index]=snap;
        if(failed||seq!==notesLoadSeq||key!==(notesOwner()||'local'))return;
        if(!previewed&&snap.exists){
          var raw=(snap.data()||{}).notesPage;
          if(raw&&typeof raw==='object'){
            raw=notesClone(raw);raw.id=ids[index];
            notesMobilePreview(notesNormalizePages([raw]),notesNormalizeGroups(meta.groups));
            previewed=true;
          }
        }
        return new Promise(function(resolve){setTimeout(resolve,0);}).then(worker);
      }).catch(function(err){failed=true;throw err;});
    }
    return Promise.all(Array.from({length:Math.min(4,ids.length)},worker)).then(function(){return results;});
  }

  function notesLoad(force) {
    var owner = notesOwner(), key = owner || 'local';
    // One admin Notes session repairs missing UID ownership metadata for every known
    // workspace. This is intentionally independent from the currently viewed user.
    notesRepairKnownOwnerRoots();
    if (!force && notesLoadedFor === key) return Promise.resolve();
    if (notesDirty) notesSave();
    var seq = ++notesLoadSeq;
    notesLoadedFor = null;
    notesSidebarPrimed = false; notesLastPageId = null; notesLastBlocksPageId = null;
    notesCloudPageHashes = {}; notesCloudPageIds = []; notesCloudIncomplete = false;
    notesSetState('Loading…','saving');
    var ignoreLocal=notesIgnoreLocalOnce;notesIgnoreLocalOnce=false;
    var local = ignoreLocal ? {pages:[],groups:notesDefaultGroups(),updatedAt:0} : notesLoadLocal(key);
    if(notesIsMobile()){notesMobilePreview(local.pages,local.groups);}
    if (!owner || typeof db === 'undefined') {
      notesPages = local.pages; notesGroups = local.groups; notesEnsurePageGroups(); notesLoadedFor = key; notesLoadedRemote = false; notesMobileBusy(false);
      notesPickActivePage(); notesHistoryReset(); notesRender(); notesSetState('Saved locally'); notesApplyHashTarget(); notesMobileBusy(false);
      return Promise.resolve();
    }
    var rootRequest=db.collection('titles').doc(owner).get({ source:'server' });
    if(notesIsMobile()&&!ignoreLocal)rootRequest=Promise.all([rootRequest,notesMobileCacheGet(key).then(function(value){
      if(seq!==notesLoadSeq||key!==(notesOwner()||'local'))return;
      var cached=value&&value.data;
      if(cached&&Array.isArray(cached.pages)&&(!local.pages.length||Number(cached.updatedAt)>local.updatedAt)){
        local={pages:notesNormalizePages(cached.pages),groups:notesNormalizeGroups(cached.groups),updatedAt:Number(cached.updatedAt)||0,cloudBase:cached.cloudBase,conflict:!!cached.conflict};
        notesMobilePreview(local.pages,local.groups);
      }
    })]).then(function(values){return values[0];});
    return rootRequest.then(function(snap) {
      if (seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return snap;
      return notesEnsureCloudOwner(owner, snap);
    }).then(function(snap) {
      if (!snap || seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return;
      var root = snap.exists ? (snap.data() || {}) : {};
      notesCloudRevision=notesRevision(root.notesWorkspaceMeta);notesCloudConflict=false;
      var meta = root.notesWorkspaceMeta && root.notesWorkspaceMeta.version >= 3 ? root.notesWorkspaceMeta : null;
      var legacy = root.notesWorkspace && typeof root.notesWorkspace === 'object' ? root.notesWorkspace : null;
      // A changed root also protects empty indexes and legacy/recovery paths. Never
      // auto-publish a stale draft merely because its device clock is ahead.
      var rootAt=Number(meta&&meta.updatedAt)||Number(legacy&&legacy.updatedAt)||0;
      if(local.conflict || (local.pages.length && local.cloudBase!==undefined && local.cloudBase!==notesCloudRevision && local.updatedAt>rootAt)){
        notesPages=local.pages;notesGroups=local.groups;notesEnsurePageGroups();notesLoadedFor=key;notesLoadedRemote=true;notesMobileBusy(false);
        notesPickActivePage();notesHistoryReset();notesRender();notesShowConflict(key);return;
      }


      if (meta) {
        var seenIds = {};
        var ids = Array.isArray(meta.pageIds) ? meta.pageIds.filter(function(x){
          if (typeof x !== 'string' || !x || seenIds[x]) return false;
          seenIds[x] = true; return true;
        }) : [];
        // A zero-length root index is only authoritative when there are truly no
        // split page documents. Always scan the server even when this device has a
        // local snapshot: otherwise stale local data can hide recoverable cloud pages.
        if (!ids.length) {
          return notesRecoverOrphanCloudSnapshot(owner).then(function(recovery){
            if (seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return;
            var orphanPages=recovery.pages||[], cloudAt=Math.max(Number(meta.updatedAt)||0,Number(recovery.updatedAt)||0);
            if (!orphanPages.length) {
              var useLocal=local.pages.length&&local.updatedAt>cloudAt;
              notesPages=useLocal?local.pages:[];notesGroups=useLocal?local.groups:notesNormalizeGroups(meta.groups);notesEnsurePageGroups();
              notesCloudPageHashes={};notesCloudPageIds=[];notesLoadedFor=key;notesLoadedRemote=true;notesCloudIncomplete=false;notesMobileBusy(false);
              notesPickActivePage();notesHistoryReset();notesRender();
              if(useLocal){notesSetState('Синхронизация локальной копии…','saving');notesDirty=true;notesSave();}
              else notesSetState('Saved');
              notesApplyHashTarget();return;
            }
            var preferLocal=local.pages.length&&local.updatedAt>cloudAt;
            notesPages=notesMergeRecoveryPages(orphanPages,local.pages,preferLocal);
            notesGroups=preferLocal?local.groups:notesNormalizeGroups(meta.groups);notesEnsurePageGroups();
            notesCloudPageHashes={};notesCloudPageIds=[];
            orphanPages.forEach(function(p){notesCloudPageHashes[p.id]=notesPageCloudHash(p);notesCloudPageIds.push(p.id);});
            notesLoadedFor=key;notesLoadedRemote=true;notesCloudIncomplete=false;notesMobileBusy(false);
            notesPickActivePage();notesHistoryReset();notesRender();
            notesSetState('Восстановление индекса заметок…','saving');
            // Save the recovered union. Cloud-only pages are never hidden by a stale
            // device cache, while genuinely newer/local-only pages are preserved too.
            notesDirty=true;notesSave();notesApplyHashTarget();
          });
        }
        return (notesIsMobile()?notesFetchMobilePages(owner,ids,seq,key,local,meta):Promise.all(ids.map(function(id){ return notesPageCloudRef(owner,id).get({ source:'server' }); }))).then(function(pageSnaps){
          if (seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return;
          var rawPages = [], missing = [];
          pageSnaps.forEach(function(ps, i){
            var expectedId = ids[i];
            if (!ps.exists) { missing.push(expectedId); return; }
            var d = ps.data() || {}, raw = d.notesPage;
            if (!raw || typeof raw !== 'object') { missing.push(expectedId); return; }
            raw = notesClone(raw); raw.id = expectedId; // document id is authoritative
            rawPages.push(raw);
          });
          // Normalize the full set together so duplicate block/page ids and parent cycles are repaired globally.
          var cloudPages = notesNormalizePages(rawPages);
          var hashes = {}; cloudPages.forEach(function(p){ hashes[p.id] = notesPageCloudHash(p); });
          var cloudAt = Number(meta.updatedAt)||0;
          var localIds = {}; local.pages.forEach(function(p){ localIds[p.id] = true; });
          var localCanRepair = !!(missing.length && local.pages.length && ids.every(function(id){ return localIds[id]; }));
          var staleDraft=local.pages.length && (local.conflict || (local.updatedAt>cloudAt && local.cloudBase!==notesCloudRevision));
          if(staleDraft){
            notesPages=local.pages;notesGroups=local.groups;notesEnsurePageGroups();notesLoadedFor=key;notesLoadedRemote=true;notesMobileBusy(false);
            notesCloudPageHashes=hashes;notesCloudPageIds=ids.slice();notesPickActivePage();notesHistoryReset();notesRender();notesShowConflict(key);return;
          }
          var useLocal = local.pages.length && (local.updatedAt > cloudAt || localCanRepair);

          notesPages = useLocal ? local.pages : cloudPages;
          notesGroups = useLocal ? local.groups : notesNormalizeGroups(meta.groups); notesEnsurePageGroups();
          notesCloudPageHashes = hashes; notesCloudPageIds = ids.slice();
          notesLoadedFor = key; notesLoadedRemote = true; notesMobileBusy(false);
          notesCloudIncomplete = missing.length > 0 && !localCanRepair;
          if(!useLocal||notesIsMobile())notesSaveLocal(key,{version:3,pages:notesPages,groups:notesGroups,updatedAt:useLocal?local.updatedAt:cloudAt});
          notesPickActivePage(); notesHistoryReset(); notesRender();

          if (localCanRepair) {
            notesSetState('Repairing cloud pages…','saving');
            notesDirty = true; notesCloudIncomplete = false; notesSave();
          } else if (notesCloudIncomplete) {
            notesSetState('Cloud copy incomplete · saved locally','error');
            notesToast('Some page files are missing in the cloud. Local data was kept safe.');
          } else {
            notesSetState('Saved');
            if (useLocal) { notesDirty=true; notesSave(); }
          }
          notesApplyHashTarget();
        });
      }

      // One-time migration from v2: load the old all-in-one field, then immediately
      // save it as separate page documents and remove the legacy field.
      var cloudPages = notesNormalizePages(legacy && legacy.pages), cloudAt = Number(legacy && legacy.updatedAt)||0;
      var useLocal = local.pages.length && (!legacy || local.updatedAt > cloudAt);
      // No root metadata/legacy snapshot does not necessarily mean an empty workspace:
      // split page documents can survive a damaged or overwritten root document. Scan
      // even when a local snapshot exists so that device-local state cannot mask cloud data.
      if (!legacy) {
        return notesRecoverOrphanCloudSnapshot(owner).then(function(recovery){
          if (seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return;
          var orphanPages=recovery.pages||[], cloudAt=Number(recovery.updatedAt)||0;
          if (orphanPages.length) {
            var preferLocal=local.pages.length&&local.updatedAt>cloudAt;
            notesPages=notesMergeRecoveryPages(orphanPages,local.pages,preferLocal);
            notesGroups=preferLocal?local.groups:notesDefaultGroups();notesEnsurePageGroups();
            notesCloudPageHashes={};notesCloudPageIds=[];
            orphanPages.forEach(function(p){notesCloudPageHashes[p.id]=notesPageCloudHash(p);notesCloudPageIds.push(p.id);});
            notesLoadedFor=key;notesLoadedRemote=true;notesCloudIncomplete=false;notesMobileBusy(false);
            notesPickActivePage();notesHistoryReset();notesRender();notesSetState('Восстановление индекса заметок…','saving');
            notesDirty=true;notesSave();notesApplyHashTarget();
            return;
          }
          if(local.pages.length){
            notesPages=local.pages;notesGroups=local.groups;notesEnsurePageGroups();notesLoadedFor=key;notesLoadedRemote=true;notesCloudIncomplete=false;notesMobileBusy(false);
            notesPickActivePage();notesHistoryReset();notesRender();notesSetState('Синхронизация локальной копии…','saving');
            notesDirty=true;notesSave();notesApplyHashTarget();return;
          }
          notesPages=[];notesGroups=notesDefaultGroups();notesEnsurePageGroups();notesLoadedFor=key;notesLoadedRemote=true;notesCloudIncomplete=false;notesMobileBusy(false);
          notesPickActivePage();notesHistoryReset();notesRender();notesSetState('Saved');notesApplyHashTarget();
        });
      }
      notesPages = useLocal ? local.pages : cloudPages;
      notesGroups = useLocal ? local.groups : notesNormalizeGroups(legacy && legacy.groups); notesEnsurePageGroups();
      notesLoadedFor = key; notesLoadedRemote = true; notesMobileBusy(false);
      notesPickActivePage(); notesHistoryReset(); notesRender();
      if (legacy || local.pages.length) {
        notesSetState(useLocal ? 'Синхронизация локальной копии…' : 'Migrating pages…','saving');
        notesDirty = true; notesSave();
      } else {
        notesSetState('Saved');
      }
      notesApplyHashTarget();
    }).catch(function(err) {
      if (seq !== notesLoadSeq || key !== (notesOwner() || 'local')) return;
      console.error('Notes load failed:',err);
      // A failed server read is NOT an empty cloud workspace. Keep any device-local
      // snapshot visible for recovery, but never allow it to masquerade as a complete
      // remote load or overwrite the cloud until a successful reload.
      notesCloudIncomplete = true;
      notesPages = local.pages; notesGroups = local.groups; notesEnsurePageGroups(); notesLoadedFor = key; notesLoadedRemote = false; notesMobileBusy(false);
      notesPickActivePage(); notesHistoryReset(); notesRender();
      notesSetState(notesPages.length ? 'Локальная копия · облако недоступно' : 'Не удалось загрузить заметки из облака','error');
      notesToast('Не удалось синхронизировать Notes с облаком. Данные на этом устройстве не будут затирать облачную копию.');
      notesApplyHashTarget();
    }).then(function(){
      if(seq===notesLoadSeq&&key===(notesOwner()||'local')){
        notesMobileBusy(false);
      }
    });
  }

  function notesReindexSiblings(parentId) {
    notesPageChildren(parentId).forEach(function(p,i){p.order=i;});
  }

  function notesCreatePageRecord(parentId,title,groupId) {
    parentId = notesPageById(parentId) ? parentId : null;
    var gid = parentId ? '' : (notesGroupById(groupId) ? groupId : notesRootGroupOf(notesCurrentPage()));
    var page = { id:notesId('p'), title:notesClampText(title || 'Untitled',160), icon:'', iconType:'emoji', iconColor:'default', cover:'', parentId:parentId, groupId:gid, collapsed:false, order:notesPageChildren(parentId).length, comments:[], blocks:[notesDefaultBlock('text')] };
    notesPages.push(page);
    if (parentId) { var parent=notesPageById(parentId); if(parent) parent.collapsed=false; }
    return page;
  }

  function notesAddPage(parentId, groupId) {
    var page = notesCreatePageRecord(parentId,'Untitled',groupId);
    notesActivePageId = page.id;
    notesRender(); notesScheduleSave();
    requestAnimationFrame(function(){ var t=document.getElementById('notesPageTitle'); if(t){t.focus();t.select();} });
    return page;
  }

  function notesDescendantIds(pageId) {
    var out=[];
    function walk(id){ notesPageChildren(id).forEach(function(p){out.push(p.id);walk(p.id);}); }
    walk(pageId); return out;
  }

  function notesDeletePage(pageId) {
    var page = notesPageById(pageId); if (!page) return;
    var descendants = notesDescendantIds(pageId);
    var msg = descendants.length ? 'Delete this page and its '+descendants.length+' subpage'+(descendants.length===1?'':'s')+'?' : 'Delete this page?';
    var sub = descendants.length ? 'All '+descendants.length+' subpage'+(descendants.length===1?'':'s')+' inside will be deleted too.' : '“'+(page.title||'Untitled')+'” will be removed from your notes.';
    notesConfirm({ title:msg, text:sub, confirm:'Delete', danger:true }, function(){
      var before = notesHistorySnap();
      var item = document.querySelector('.notes-page-item[data-id="'+pageId+'"]');
      notesAnimateOut(item, function(){ notesDeletePageNow(pageId); notesUndoToast('Page deleted', before); }, null, 150);
    });
  }

  function notesDeletePageNow(pageId) {
    var page = notesPageById(pageId); if (!page) return;
    notesHistoryBreak();
    var descendants = notesDescendantIds(pageId);
    var doomed = {}; doomed[pageId]=true; descendants.forEach(function(id){doomed[id]=true;});
    notesPages.forEach(function(p){if(doomed[p.id]&&p.shareToken)notesRememberShareDeletion(p.shareToken,notesLoadedFor,notesAuthUid());});
    notesPages = notesPages.filter(function(p){return !doomed[p.id];});
    notesPages.forEach(function(p){
      p.blocks = p.blocks.filter(function(b){ return !(b.type==='page' && doomed[b.linkedPageId]); });
      if (!p.blocks.length) p.blocks.push(notesDefaultBlock('text'));
    });
    notesReindexSiblings(page.parentId);
    if (doomed[notesActivePageId]) {
      var fallback = notesPageById(page.parentId) || notesPages[0] || null;
      notesActivePageId = fallback ? fallback.id : null;
    }
    notesRender(); notesScheduleSave();
  }

  function notesFreshBlockClone(block) {
    var c = notesClone(block);
    c.id = notesId('b');
    if(c.type==='database'&&Array.isArray(c.rows))c.rows=c.rows.map(NotesDatabase.duplicateRow);
    // Duplicated synced blocks intentionally stay in the same sync group.
    if (block.type === 'synced' && block.syncKey) c.syncKey = block.syncKey;
    return notesNormalizeBlock(c);
  }

  function notesDuplicatePage(pageId) {
    var page=notesPageById(pageId); if(!page)return;
    // Copy the whole subtree; previously the copy's page links pointed at the ORIGINAL subpages.
    var tree=[page].concat(notesDescendantIds(pageId).map(notesPageById).filter(Boolean));
    var map={}; tree.forEach(function(p){ map[p.id]=notesId('p'); });
    var copies=tree.map(function(p){
      var c=notesClone(p); c.id=map[p.id];
      if(p.id===pageId){ c.title=notesClampText((p.title||'Untitled')+' copy',160); c.order=p.order+1; c.collapsed=false; }
      else c.parentId=map[p.parentId]||c.parentId;
      c.comments=(c.comments||[]).map(function(x){ x.id=notesId('c'); return x; });
      c.blocks=(p.blocks||[]).map(function(b){ var nb=notesFreshBlockClone(b); if(nb.type==='page'&&map[nb.linkedPageId])nb.linkedPageId=map[nb.linkedPageId]; return nb; });
      return c;
    });
    notesPages.forEach(function(p){ if((p.parentId||null)===(page.parentId||null)&&p.order>page.order)p.order++; });
    notesPages=notesPages.concat(copies); notesReindexSiblings(page.parentId);
    notesActivePageId=map[pageId]; notesRender(); notesScheduleSave();
    if(copies.length>1)notesToast('Duplicated with '+(copies.length-1)+' subpage'+(copies.length===2?'':'s'));
  }

  function notesMovePageBefore(sourceId,targetId,placement) {
    if(!sourceId||!targetId||sourceId===targetId)return;
    var source=notesPageById(sourceId),target=notesPageById(targetId);if(!source||!target)return;
    if (notesDescendantIds(sourceId).indexOf(targetId)>=0) return;
    var oldParent=source.parentId; source.parentId=target.parentId; if(!target.parentId&&target.groupId)source.groupId=target.groupId;
    notesReindexSiblings(oldParent);
    var sib=notesPageChildren(target.parentId).filter(function(p){return p.id!==sourceId;});
    var idx=sib.findIndex(function(p){return p.id===targetId;}); if(idx<0)idx=sib.length; else if(placement==='after')idx++;
    sib.splice(idx,0,source); sib.forEach(function(p,i){p.order=i;});
    notesRenderSidebar(); notesScheduleSave();
  }

  function notesPagePath(page) {
    if(!page)return 'Notes';
    var parts=[],seen={};
    while(page && !seen[page.id]) { seen[page.id]=true; parts.unshift(page.title||'Untitled'); page=notesPageById(page.parentId); }
    return 'Notes / '+parts.join(' / ');
  }
  function notesRenderBreadcrumb(page) {
    var host=document.getElementById('notesBreadcrumb');if(!host)return;host.textContent='';
    var chain=[],seen={};while(page&&!seen[page.id]){seen[page.id]=true;chain.unshift(page);page=notesPageById(page.parentId);}
    var root=document.createElement('button');root.type='button';root.textContent='Notes';root.title='Back to first page';if(notesShareMode)root.textContent='Shared';root.addEventListener('click',function(){var first=notesPageChildren(null)[0];if(first){notesActivePageId=first.id;notesRender();}});host.appendChild(root);
    chain.forEach(function(p,i){var sep=document.createElement('span');sep.textContent='/';sep.setAttribute('aria-hidden','true');host.appendChild(sep);
      var crumb=document.createElement('button');crumb.type='button';crumb.textContent=p.title||'Untitled';crumb.title=p.title||'Untitled';if(i===chain.length-1)crumb.setAttribute('aria-current','page');
      else crumb.addEventListener('click',function(){notesActivePageId=p.id;notesRender();});host.appendChild(crumb);
    });
  }

  function notesRenamePageInline(pageId) {
    notesCloseMenus();
    var item=document.querySelector('.notes-page-item[data-id="'+pageId+'"]'); if(!item)return;
    var titleEl=item.querySelector('.notes-page-item-title'); if(!titleEl)return;
    var page=notesPageById(pageId); if(!page)return;
    var input=document.createElement('input');input.className='notes-page-item-title-input';input.value=page.title||'Untitled';
    titleEl.replaceWith(input);input.focus();input.select();
    var done=false;
    function commit(cancel){ if(done)return;done=true; if(!cancel){var v=input.value.trim();page.title=v?notesClampText(v,160):'Untitled';notesScheduleSave();} notesRender(); }
    input.addEventListener('blur',function(){commit(false);});
    input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();commit(false);}if(e.key==='Escape'){e.preventDefault();commit(true);}});
  }

  function notesRenderSidebar() {
    var list=document.getElementById('notesPagesList');if(!list)return;
    var search=document.getElementById('notesPageSearch'),query=search?search.value.trim().toLocaleLowerCase():'';
    var before=notesSidebarPrimed&&notesCanAnimate(list)?notesSnapshotRects(list.children):null;
    list.innerHTML='';
    if(query){
      var matches=notesPages.filter(function(p){return (p.title||'').toLocaleLowerCase().indexOf(query)>=0 || p.blocks.some(function(b){
        return [b.text,b.detail,b.caption].concat(b.columns||[]).concat((b.rows||[]).reduce(function(a,row){return a.concat(row);},[])).some(function(v){return String(v||'').toLocaleLowerCase().indexOf(query)>=0;});
      });}).sort(function(a,b){var x=(a.title||'').toLocaleLowerCase().indexOf(query),y=(b.title||'').toLocaleLowerCase().indexOf(query);return (x<0?999:x)-(y<0?999:y)||a.title.localeCompare(b.title);});
      matches.forEach(function(page){
        var item=document.createElement('button');item.type='button';item.className='notes-page-item notes-search-result'+(page.id===notesActivePageId?' active':'');
        var icon=document.createElement('span');icon.className='notes-page-icon';if(page.icon)notesPaintIcon(icon,page.icon,page.iconType,page.iconColor);else icon.hidden=true;
        var text=document.createElement('span');text.className='notes-search-result-text';var name=document.createElement('span');name.textContent=page.title||'Untitled';text.appendChild(name);
        var path=document.createElement('small');path.textContent=notesPagePath(page);text.appendChild(path);item.appendChild(icon);item.appendChild(text);
        item.addEventListener('click',function(){notesPendingPageNavigation=true;notesActivePageId=page.id;search.value='';notesRender();});list.appendChild(item);
      });
      if(!matches.length){var empty=document.createElement('div');empty.className='notes-search-empty';empty.textContent='No pages or blocks found';list.appendChild(empty);}
      notesSidebarPrimed=false;notesPositionActivePill();return;
    }
    function renderLevel(parentId,depth,groupId) {
      notesPageChildren(parentId).filter(function(page){return parentId||!groupId||page.groupId===groupId;}).forEach(function(page){
        var item=document.createElement('div');item.className='notes-page-item'+(page.id===notesActivePageId?' active':'')+(notesHasChildren(page.id)?' has-children':'');item.dataset.id=page.id;item.style.setProperty('--notes-depth',depth);item.setAttribute('role','button');item.tabIndex=0;item.draggable=true;
        var chev=document.createElement('button');chev.type='button';chev.className='notes-page-chevron'+(page.collapsed?' collapsed':'');chev.textContent=notesHasChildren(page.id)?'▾':'';chev.tabIndex=-1;chev.addEventListener('click',function(e){e.stopPropagation();if(!notesHasChildren(page.id))return;page.collapsed=!page.collapsed;notesPendingChevron=page.id;notesRenderSidebar();notesPendingChevron=null;notesScheduleSave();});
        if(notesPendingChevron===page.id)notesAnimate(chev,[{transform:page.collapsed?'rotate(0deg)':'rotate(-90deg)'},{transform:page.collapsed?'rotate(-90deg)':'rotate(0deg)'}],{duration:220});
        var icon=document.createElement('span');icon.className='notes-page-icon';if(page.icon)notesPaintIcon(icon,page.icon,page.iconType,page.iconColor);else icon.hidden=true;
        var title=document.createElement('span');title.className='notes-page-item-title';title.textContent=page.title||'Untitled';
        var more=document.createElement('button');more.type='button';more.className='notes-page-more';notesDots(more);more.title='Page actions';more.setAttribute('aria-label','Page actions');more.addEventListener('click',function(e){e.stopPropagation();notesOpenPageMenu(page,more);});
        item.appendChild(chev);item.appendChild(icon);item.appendChild(title);item.appendChild(more);
        item.addEventListener('click',function(){notesCloseMenus();notesPendingPageNavigation=true;notesActivePageId=page.id;notesRender();});
        item.addEventListener('dblclick',function(e){if(!e.target.closest('button'))notesRenamePageInline(page.id);});
        item.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();notesPendingPageNavigation=true;notesActivePageId=page.id;notesRender();}});
        item.addEventListener('dragstart',function(e){notesDraggedPageId=page.id;item.classList.add('dragging');try{e.dataTransfer.setData('application/x-tj-notes-page',page.id);e.dataTransfer.effectAllowed='move';}catch(_){}});
        item.addEventListener('dragend',function(){notesDraggedPageId=null;item.classList.remove('dragging');notesClearPageDropMarks();});
        item.addEventListener('dragover',function(e){
          if(notesDraggedBlockId){if(page.id===notesActivePageId)return;e.preventDefault();notesClearPageDropMarks();item.classList.add('drop-into');return;}
          if(!notesDraggedPageId||notesDraggedPageId===page.id)return;e.preventDefault();
          var r=item.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;item.dataset.dropPlacement=after?'after':'before';
          item.classList.toggle('drop-before',!after);item.classList.toggle('drop-after',after);
        });
        item.addEventListener('dragleave',function(){item.classList.remove('drop-before','drop-after','drop-into');});
        item.addEventListener('drop',function(e){
          e.preventDefault();var placement=item.dataset.dropPlacement||'before';notesClearPageDropMarks();
          if(notesDraggedBlockId){var bid=notesDraggedBlockId;notesDraggedBlockId=null;notesMoveBlockToPage(bid,page.id);return;}
          notesMovePageBefore(notesDraggedPageId,page.id,placement);
        });
        list.appendChild(item);
        if(!page.collapsed)renderLevel(page.id,depth+1);
      });
    }
    if(notesShareMode){renderLevel(null,0);}
    else{
      notesEnsurePageGroups();
      notesSortedGroups().forEach(function(g){
        list.appendChild(notesGroupHeader(g));
        if(g.collapsed)return;
        var count=list.children.length;renderLevel(null,0,g.id);
        if(list.children.length===count){var empty=document.createElement('div');empty.className='notes-group-empty';empty.textContent='No pages yet';list.appendChild(empty);}
      });
      var addGroup=document.createElement('button');addGroup.type='button';addGroup.className='notes-add-group';addGroup.innerHTML='<span aria-hidden="true">+</span><span>Add group</span>';
      addGroup.addEventListener('click',function(){notesCloseMenus();notesAddGroup();});list.appendChild(addGroup);
    }
    if(before)notesPlayFlip(list.children,before,{duration:300,maxEnter:40,enterY:-3});
    notesSidebarPrimed=notesWorkspaceMode;
    notesPositionActivePill();
  }

  // One highlight that glides between pages instead of blinking on/off per item.
  function notesPositionActivePill() {
    var scroll=document.querySelector('#notesWorkspace .notes-sidebar-scroll'),list=document.getElementById('notesPagesList');if(!scroll||!list)return;
    var pill=document.getElementById('notesActivePill'),fresh=false;
    if(!pill){pill=document.createElement('div');pill.id='notesActivePill';pill.className='notes-active-pill';pill.setAttribute('aria-hidden','true');scroll.insertBefore(pill,scroll.firstChild);scroll.classList.add('has-pill');fresh=true;}
    var item=list.querySelector('.notes-page-item.active');
    if(!item||!item.offsetHeight){pill.classList.remove('visible');return;}
    var instant=fresh||!pill.classList.contains('visible')||notesReduceMotion||!notesWorkspaceMode;
    if(instant)pill.style.transition='none';
    pill.style.width=item.offsetWidth+'px';pill.style.height=item.offsetHeight+'px';
    pill.style.transform='translate3d('+item.offsetLeft+'px,'+item.offsetTop+'px,0)';
    if(instant){void pill.offsetWidth;pill.style.transition='';}
    pill.classList.add('visible');
  }

  function notesClearPageDropMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('.notes-page-item.drop-before,.notes-page-item.drop-after,.notes-page-item.drop-into,.notes-group-header.drop-into'),function(n){n.classList.remove('drop-before','drop-after','drop-into');});
  }

  function notesUpdateBlock(blockId, fn) {
    var page=notesCurrentPage();if(!page)return;var b=notesBlockById(blockId,page);if(!b)return;fn(b);notesScheduleSave();
  }

  function notesFocusBlock(blockId, field) {
    requestAnimationFrame(function(){
      var selector='.notes-block[data-id="'+blockId+'"] ' + (field ? '[data-notes-field="'+field+'"]' : '.notes-editable');
      var el=document.querySelector(selector) || document.querySelector('.notes-block[data-id="'+blockId+'"] textarea');
      if(!el)return;el.focus();
      if(el.isContentEditable){var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);}else if(typeof el.setSelectionRange==='function'){el.setSelectionRange(el.value.length,el.value.length);}
    });
  }

  function notesDeleteBlock(blockId) {
    var page=notesCurrentPage();if(!page)return;notesHistoryBreak();
    var idx=page.blocks.findIndex(function(b){return b.id===blockId;});if(idx<0)return;
    var focusId=idx>0?page.blocks[idx-1].id:(page.blocks[idx+1]&&page.blocks[idx+1].id);
    page.blocks.splice(idx,1);if(!page.blocks.length){var fresh=notesDefaultBlock('text');page.blocks.push(fresh);focusId=fresh.id;}
    notesRenderBlocks();notesScheduleSave();if(focusId)notesFocusBlock(focusId);
  }

  function notesInsertBlock(type, afterId) {
    if(notesRowScope&&['database','synced','page'].includes(type))return;
    var page=notesCurrentPage();if(!page)return null;
    var block=notesDefaultBlock(type);var i=afterId?page.blocks.findIndex(function(b){return b.id===afterId;}):-1;
    if(type==='page') {
      var child=notesCreatePageRecord(page.id,'Untitled');
      block.linkedPageId=child.id;block.text=child.title;
    }
    if(i>=0)page.blocks.splice(i+1,0,block);else page.blocks.push(block);
    notesRender();notesScheduleSave();if(type!=='divider'&&type!=='page')notesFocusBlock(block.id);return block;
  }

  function notesCompressPastedImage(file) {
    var attempts = [[1600,.78],[1400,.70],[1200,.62],[1000,.54],[840,.46]];
    function tryOne(i) {
      if(i>=attempts.length)return Promise.reject(new Error('image-too-large'));
      return compressImage(file,attempts[i][0],attempts[i][1]).then(function(data){
        if(notesValidCoverImage(data))return data;
        return tryOne(i+1);
      });
    }
    return tryOne(0);
  }

  function notesOpenImageViewer(src,alt) {
    if(!src)return;
    var overlay=document.createElement('div');overlay.className='notes-image-viewer';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Image preview');
    var image=document.createElement('img');image.src=src;image.alt=alt||'Image preview';
    var close=document.createElement('button');close.type='button';close.className='notes-image-viewer-close';close.setAttribute('aria-label','Close image preview');close.textContent='×';
    function dismiss(){document.removeEventListener('keydown',onKey);overlay.classList.add('closing');setTimeout(function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);},150);}
    function onKey(e){return;}
    close.addEventListener('click',function(e){e.stopPropagation();dismiss();});overlay.addEventListener('click',function(e){if(e.target===overlay)dismiss();});image.addEventListener('click',function(e){e.stopPropagation();});
    overlay.appendChild(image);overlay.appendChild(close);document.body.appendChild(overlay);document.addEventListener('keydown',onKey);requestAnimationFrame(function(){overlay.classList.add('open');});
  }

  function notesInsertPastedImage(file, afterId) {
    var rowContext=notesRowScope,sourceOwner=notesLoadedFor;
    var page=notesCurrentPage();if(!page||!file)return Promise.resolve(null);
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)){notesToast('Use a JPG, PNG or WebP image');return Promise.resolve(null);}
    if(file.size>20*1024*1024){notesToast('Image is too big (max 20 MB)');return Promise.resolve(null);}
    notesToast('Compressing image\u2026');
    return notesCompressPastedImage(file).then(function(data){
      if(sourceOwner!==notesLoadedFor)return null;
      if(notesOffloadCan())notesToast('Uploading image\u2026');
      return notesStoreImage(data);
    },function(){notesToast('Could not compress this image');return null;}).then(function(src){
      if(!src||sourceOwner!==notesLoadedFor)return null;
      if(rowContext)return notesRowInsertImage(rowContext,src,file.name,afterId)||null;
      var block=notesDefaultBlock('image');block.src=src;block.alt=file.name||'Pasted image';
      var i=afterId?page.blocks.findIndex(function(b){return b.id===afterId;}):-1;
      if(i>=0)page.blocks.splice(i+1,0,block);else page.blocks.push(block);
      notesRender();notesScheduleSave();notesToast('Image added');
      return block.id;
    }).catch(function(err){console.warn('Image insert failed:',err);notesToast('Could not add this image');return null;});
  }

  function notesDuplicateBlock(blockId) {
    var page=notesCurrentPage();if(!page)return;var idx=page.blocks.findIndex(function(b){return b.id===blockId;});if(idx<0)return;
    var copy=notesFreshBlockClone(page.blocks[idx]);page.blocks.splice(idx+1,0,copy);notesRenderBlocks();notesScheduleSave();notesFocusBlock(copy.id);
  }

  function notesMoveBlock(sourceId,targetId,placement) {
    var page=notesCurrentPage();if(!page||!sourceId||!targetId||sourceId===targetId)return;
    var from=page.blocks.findIndex(function(b){return b.id===sourceId;}),to=page.blocks.findIndex(function(b){return b.id===targetId;});if(from<0||to<0)return;
    var item=page.blocks.splice(from,1)[0];to=page.blocks.findIndex(function(b){return b.id===targetId;});if(placement==='after')to++;page.blocks.splice(Math.max(0,to),0,item);notesRenderBlocks();notesScheduleSave();
  }

  function notesMoveBlockStep(blockId,dir) {
    var page=notesCurrentPage();if(!page)return;var i=page.blocks.findIndex(function(b){return b.id===blockId;}),j=i+dir;
    if(i<0||j<0||j>=page.blocks.length)return;notesMoveBlock(blockId,page.blocks[j].id,dir<0?'before':'after');notesFocusBlock(blockId);
  }

  function notesMoveBlockToPage(blockId,targetPageId) {
    var page=notesCurrentPage(),target=notesPageById(targetPageId);if(!page||!target||page.id===target.id)return;
    var idx=page.blocks.findIndex(function(b){return b.id===blockId;});if(idx<0)return;
    var linked=page.blocks[idx].type==='page'?notesPageById(page.blocks[idx].linkedPageId):null;
    if(linked&&(linked.id===target.id||notesDescendantIds(linked.id).indexOf(target.id)>=0)){notesToast('A page can’t be moved inside itself');return;}
    var block=page.blocks.splice(idx,1)[0];target.blocks.push(block);if(!page.blocks.length)page.blocks.push(notesDefaultBlock('text'));
    if(linked&&linked.parentId===page.id){linked.parentId=target.id;linked.order=notesPageChildren(target.id).length;notesReindexSiblings(page.id);}
    notesRender();notesScheduleSave();notesToast('Moved to '+(target.title||'Untitled'));
  }

  function notesTransformBlock(blockId,type) {
    if(notesRowScope&&['database','synced','page'].includes(type))return;
    var page=notesCurrentPage();if(!page)return;var idx=page.blocks.findIndex(function(b){return b.id===blockId;});if(idx<0)return;
    type=notesTypeAllowed(type);var old=page.blocks[idx];if(old.type===type){notesCloseMenus();return;}
    if(notesStructuredBlock(old.type)){notesCloseMenus();notesToast('This block keeps its structure. Add a new block to use another type.');return;}
    var text=old.text||'';var fresh=notesDefaultBlock(type);fresh.id=old.id;fresh.text=text;fresh.color=old.color||'default';fresh.background=old.background||'default';
    if(type==='database'){if(text)fresh.rows[0].cells[fresh.properties[0].id]=text;delete fresh.text;}
    if(type==='table'){fresh.rows=[[text||'Column 1','Column 2'],['','']];delete fresh.text;}
    if(type.indexOf('columns')===0){fresh.columns[0]=text;}
    if(type==='page') {
      var child=notesCreatePageRecord(page.id,text.trim()?notesClampText(text.trim(),160):'Untitled');fresh.linkedPageId=child.id;fresh.text=child.title;
    }
    if(type==='synced') fresh.syncKey=old.syncKey||notesId('sync');
    page.blocks[idx]=notesNormalizeBlock(fresh);notesRender();notesScheduleSave();if(type!=='divider'&&type!=='page')notesFocusBlock(blockId);
  }

  function notesTransformBlockToPageIn(blockId,parentPageId) {
    if(notesRowScope)return;
    var page=notesCurrentPage();if(!page)return;var idx=page.blocks.findIndex(function(b){return b.id===blockId;});if(idx<0)return;
    var old=page.blocks[idx],title=(old.text||'').trim()||'Untitled';var child=notesCreatePageRecord(parentPageId,title);var fresh=notesDefaultBlock('page');fresh.id=old.id;fresh.text=child.title;fresh.linkedPageId=child.id;fresh.color=old.color||'default';fresh.background=old.background||'default';page.blocks[idx]=fresh;notesRender();notesScheduleSave();
  }

  function notesNumberForBlock(page,index) {
    var n=1;for(var i=index-1;i>=0;i--){if(page.blocks[i].type!=='numbered')break;n++;}return n;
  }

  function notesTextEditable(block, field, placeholder, options) {
    options=options||{};field=field||'text';
    var el=document.createElement('div');el.className='notes-editable';el.contentEditable='true';el.spellcheck=true;el.dataset.placeholder=placeholder||'Type something…';el.dataset.notesField=field;el.textContent=block[field]||'';notesRtApply(el,block,field);
    notesListen(el,'input',function(){
      var value=notesClampText(notesReadEditable(el),24000),rich=notesRtCapture(el);
      if(field==='text' && block.type==='synced' && block.syncKey){
        // One edit updates every block that belongs to the same synced group.
        notesPages.forEach(function(pg){
          pg.blocks.forEach(function(b){if(b.type==='synced' && b.syncKey===block.syncKey){b.text=value;notesRtStore(b,'text',rich,value);}});
        });
        Array.prototype.forEach.call(document.querySelectorAll('.notes-block[data-sync-key="'+block.syncKey+'"] .notes-editable'),function(other){
          if(other===el)return;if(rich){if(other.innerHTML!==rich)other.innerHTML=rich;}else if(other.textContent!==value||other.children.length)other.textContent=value;
        });
        notesScheduleSave();
      }else{
        notesUpdateBlock(block.id,function(b){b[field]=value;notesRtStore(b,field,rich,value);});
      }
      if(field==='text'&&!options.disableSlash){
        if(value.indexOf('[[')===0)notesMaybePageLinkMenu(block.id,el);
        else notesMaybeSlashMenu(block.id,el);
      }
    });
    notesListen(el,'keydown',function(e){
      if(field!=='text'||options.multiline)return;
      if(e.isComposing||e.keyCode===229)return;
      if(notesCommandState&&notesCommandState.blockId===block.id){
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();notesCommandStep(e.key==='ArrowDown'?1:-1);return;}
        if(e.key==='Enter'){e.preventDefault();notesCommandChoose();return;}
        if(e.key==='Escape'){e.preventDefault();notesCloseMenus();return;}
      }
      if(e.key===' ' && block.type==='text' && !e.shiftKey && !e.ctrlKey && !e.metaKey){
        var shortcuts={'#':'h1','##':'h2','###':'h3','####':'h4','-':'bulleted','*':'bulleted','1.':'numbered','[]':'todo','[ ]':'todo','>':'quote','---':'divider','```':'code'};
        var typed=notesReadEditable(el);
        if(Object.prototype.hasOwnProperty.call(shortcuts,typed)){
          e.preventDefault();notesUpdateBlock(block.id,function(b){b.text='';});notesTransformBlock(block.id,shortcuts[typed]);return;
        }
      }
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        var current=notesBlockById(block.id);if(!current)return;
        if((current.type==='bulleted'||current.type==='numbered'||current.type==='todo')&&!el.textContent.trim()){notesTransformBlock(block.id,'text');return;}
        var next=(current.type==='bulleted'||current.type==='numbered'||current.type==='todo')?current.type:'text';notesInsertBlock(next,block.id);return;
      }
      if(e.key==='Backspace'&&!el.textContent){
        var currentBlock=notesBlockById(block.id);if(!currentBlock)return;
        if(currentBlock.type!=='text'){e.preventDefault();notesTransformBlock(block.id,'text');return;}
        var p=notesCurrentPage();if(p&&p.blocks.length>1){e.preventDefault();notesDeleteBlock(block.id);}
      }
    });
    return el;
  }

  function notesAutoSizeTextarea(ta) { ta.style.height='auto';ta.style.height=Math.max(76,Math.min(700,ta.scrollHeight+2))+'px'; }

  function notesRenderTable(block,host) {
    var wrap=document.createElement('div');wrap.className='notes-table-wrap';var table=document.createElement('table');table.className='notes-table';
    block.rows.forEach(function(row,ri){var tr=document.createElement('tr');row.forEach(function(cell,ci){var td=document.createElement('td');var ce=document.createElement('div');ce.className='notes-table-cell';ce.contentEditable='true';ce.spellcheck=true;ce.textContent=cell;notesListen(ce,'input',function(){notesUpdateBlock(block.id,function(b){if(b.rows[ri])b.rows[ri][ci]=notesClampText(notesReadEditable(ce),5000);});});notesListen(td,'click',function(e){if(e.target===td)ce.focus();});td.appendChild(ce);tr.appendChild(td);});table.appendChild(tr);});
    wrap.appendChild(table);host.appendChild(wrap);
    var actions=document.createElement('div');actions.className='notes-table-actions';
    [
      ['+ Row',function(){notesUpdateBlock(block.id,function(b){var cols=(b.rows[0]||['']).length;b.rows.push(new Array(cols).fill(''));});notesRenderBlocks();}],
      ['+ Column',function(){notesUpdateBlock(block.id,function(b){if((b.rows[0]||[]).length>=10)return;b.rows.forEach(function(r,i){r.push(i===0?'Column '+(r.length+1):'');});});notesRenderBlocks();}],
      ['− Row',function(){notesUpdateBlock(block.id,function(b){if(b.rows.length>1)b.rows.pop();});notesRenderBlocks();}],
      ['− Column',function(){notesUpdateBlock(block.id,function(b){if((b.rows[0]||[]).length>1)b.rows.forEach(function(r){r.pop();});});notesRenderBlocks();}]
    ].forEach(function(pair){var btn=document.createElement('button');btn.type='button';btn.textContent=pair[0];notesListen(btn,'click',pair[1]);actions.appendChild(btn);});host.appendChild(actions);
  }

  function notesApplyBlockStyle(row,block) {
    row.style.setProperty('--notes-block-text',NOTES_TEXT_COLORS[notesSafeColor(block.color,NOTES_TEXT_COLORS)]);
    var bg=NOTES_BG_COLORS[notesSafeColor(block.background,NOTES_BG_COLORS)] || 'transparent';
    row.style.setProperty('--notes-block-bg',bg);
  }

  var notesToolsAlignRaf=0;

  function notesBlockFirstLineAnchor(row) {
    if(!row)return null;
    return row.querySelector('.notes-toggle-row .notes-editable') ||
      row.querySelector('.notes-list-row .notes-editable') ||
      row.querySelector('.notes-todo-row .notes-editable') ||
      row.querySelector('.notes-callout .notes-editable') ||
      row.querySelector('.notes-quote .notes-editable') ||
      row.querySelector('.notes-equation .notes-editable') ||
      row.querySelector('.notes-synced .notes-editable') ||
      row.querySelector('.notes-columns .notes-editable') ||
      row.querySelector('.notes-table-cell') ||
      row.querySelector('.notes-page-link-title') ||
      row.querySelector('.notes-editable') ||
      row.querySelector('.notes-code-head') ||
      row.querySelector('.notes-divider') ||
      row.querySelector('.notes-block-body > *');
  }

  function notesAlignBlockTools(row) {
    if(!row || !row.isConnected)return;
    var tools=row.querySelector('.notes-block-tools');
    var anchor=notesBlockFirstLineAnchor(row);
    if(!tools || !anchor)return;
    var rr=row.getBoundingClientRect(),ar=anchor.getBoundingClientRect(),tr=tools.getBoundingClientRect();
    if(!rr.height || !ar.height)return;
    var cs=getComputedStyle(anchor);
    var lineHeight=parseFloat(cs.lineHeight);
    var fontSize=parseFloat(cs.fontSize)||16;
    var paddingTop=parseFloat(cs.paddingTop)||0;
    var borderTop=parseFloat(cs.borderTopWidth)||0;
    var firstLineCenter;
    if(anchor.classList && (anchor.classList.contains('notes-editable') || anchor.classList.contains('notes-table-cell') || anchor.classList.contains('notes-page-link-title'))) {
      if(!isFinite(lineHeight))lineHeight=fontSize*1.2;
      firstLineCenter=ar.top+borderTop+paddingTop+lineHeight/2;
    } else if(anchor.classList && anchor.classList.contains('notes-code-head')) {
      firstLineCenter=ar.top+ar.height/2;
    } else if(anchor.classList && anchor.classList.contains('notes-divider')) {
      firstLineCenter=ar.top+ar.height/2;
    } else {
      firstLineCenter=ar.top+Math.min(ar.height,28)/2;
    }
    var toolHeight=tr.height||24;
    var top=firstLineCenter-rr.top-toolHeight/2;
    var maxTop=Math.max(0,rr.height-toolHeight);
    top=Math.max(0,Math.min(maxTop,top));
    tools.style.top=(Math.round(top*2)/2)+'px';
  }

  function notesAlignAllBlockTools() {
    notesToolsAlignRaf=0;
    if(notesIsMobile()){document.querySelectorAll('#notesBlocks .notes-block:focus-within,#notesBlocks .notes-tools-pinned').forEach(notesAlignBlockTools);return;}
    Array.prototype.forEach.call(document.querySelectorAll('#notesBlocks .notes-block'),notesAlignBlockTools);
  }

  function notesScheduleBlockToolsAlignment() {
    if(notesToolsAlignRaf)cancelAnimationFrame(notesToolsAlignRaf);
    notesToolsAlignRaf=requestAnimationFrame(notesAlignAllBlockTools);
  }

  if(typeof window!=='undefined')window.addEventListener('resize',notesScheduleBlockToolsAlignment);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(notesScheduleBlockToolsAlignment).catch(function(){});


  // v3.18.7: attached-page preview opens directly below attached page links.
  var notesAttachedPreviewCard = null;
  var notesAttachedPreviewAnchor = null;
  function notesEnsureAttachedPreviewCard() {
    if (notesAttachedPreviewCard && notesAttachedPreviewCard.isConnected) return notesAttachedPreviewCard;
    var card = document.createElement('div');
    card.className = 'notes-attached-preview';
    card.setAttribute('aria-hidden', 'true');
    card.style.display = 'none';
    document.body.appendChild(card);
    notesAttachedPreviewCard = card;
    return card;
  }
  function notesAttachedPreviewText(page) {
    var lines = [], eyebrow = 'PAGE';
    (page && page.blocks || []).some(function(b) {
      if (!b || b.type === 'image' || b.type === 'divider' || b.type === 'page' || String(b.type || '').indexOf('columns') === 0) return false;
      var t = b.type === 'table' ? ((b.rows && b.rows[0] && b.rows[0][0]) || '') : (b.text || b.caption || b.detail || '');
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (!t) return false;
      if (eyebrow === 'PAGE' && t.length <= 30 && t === t.toUpperCase() && /[A-ZА-Я0-9]/.test(t)) { eyebrow = t; return false; }
      lines.push({text:t,strong:b.type==='h1'||b.type==='h2'||b.type==='h3'||b.type==='h4'||String(b.type||'').indexOf('toggleh')===0});
      return lines.length >= 3;
    });
    return {eyebrow:eyebrow,lines:lines};
  }
  function notesBuildAttachedPreview(page) {
    var card=notesEnsureAttachedPreviewCard(); card.innerHTML='';
    var hasCover=!!page.cover;card.classList.toggle('no-cover',!hasCover);
    if(hasCover){
      var cover=document.createElement('div');cover.className='notes-attached-preview-cover';cover.dataset.cover=page.cover||'';
      if(page.cover==='image'&&page.coverImage)notesCoverBg(cover,page.coverImage);
      var bi=document.createElement('span');bi.className='notes-attached-preview-cover-icon';
      if(page.icon)notesPaintIcon(bi,page.icon,page.iconType,page.iconColor);else bi.textContent='◇';
      cover.appendChild(bi);card.appendChild(cover);
    }
    var body=document.createElement('div');body.className='notes-attached-preview-body';var pv=notesAttachedPreviewText(page);
    var eb=document.createElement('div');eb.className='notes-attached-preview-eyebrow';eb.textContent=pv.eyebrow;body.appendChild(eb);
    var title=document.createElement('div');title.className='notes-attached-preview-title';title.textContent=page.title||'Untitled';body.appendChild(title);
    if(pv.lines.length){var lines=document.createElement('div');lines.className='notes-attached-preview-lines';pv.lines.forEach(function(x){var l=document.createElement('div');l.className='notes-attached-preview-line'+(x.strong?' strong':'');l.textContent=x.text;lines.appendChild(l);});body.appendChild(lines);}
    card.appendChild(body);return card;
  }
  function notesPlaceAttachedPreview(anchor){
    var card=notesAttachedPreviewCard;if(!card||!anchor||!anchor.isConnected)return;
    // v3.18.7: preview sits directly under the attached-page row, like Notion.
    var r=anchor.getBoundingClientRect(),gap=6,w=card.offsetWidth||286,left=r.left,top=r.bottom+gap,edge=12;
    if(left+w>window.innerWidth-edge)left=Math.max(edge,window.innerWidth-w-edge);
    if(left<edge)left=edge;
    card.style.left=Math.round(left)+'px';card.style.top=Math.round(top)+'px';
  }
  function notesShowAttachedPreview(anchor,page){
    if(!anchor||!page||!anchor.isConnected)return;notesAttachedPreviewAnchor=anchor;
    var card=notesBuildAttachedPreview(page);card.style.display='block';card.style.visibility='hidden';card.classList.add('open');
    notesPlaceAttachedPreview(anchor);card.style.visibility='visible';card.setAttribute('aria-hidden','false');
    requestAnimationFrame(function(){if(notesAttachedPreviewAnchor===anchor&&card.isConnected)notesPlaceAttachedPreview(anchor);});
  }
  function notesHideAttachedPreview(anchor){
    if(anchor&&notesAttachedPreviewAnchor&&anchor!==notesAttachedPreviewAnchor)return;notesAttachedPreviewAnchor=null;
    if(!notesAttachedPreviewCard)return;notesAttachedPreviewCard.classList.remove('open');notesAttachedPreviewCard.setAttribute('aria-hidden','true');notesAttachedPreviewCard.style.display='none';
  }
  window.addEventListener('scroll',function(){notesHideAttachedPreview();},{capture:true,passive:true});
  window.addEventListener('resize',function(){notesHideAttachedPreview();});

  function notesEnableMobileBlockDrag(row,grip,blockId){
    var state=null,hold=null,frame=null,suppressClick=false;
    function clear(){
      clearTimeout(hold);cancelAnimationFrame(frame);hold=null;frame=null;
      if(state&&state.active)row.classList.remove('dragging');
      if(state&&state.target)state.target.classList.remove('drop-before','drop-after');
      state=null;
    }
    function track(){
      if(!state||!state.active)return;
      if(!row.isConnected||!notesIsMobile()){clear();return;}
      var scroll=row.closest('.notes-row-scroll')||document.getElementById('notesPageWrap');
      if(scroll){var rect=scroll.getBoundingClientRect();if(state.y<rect.top+48)scroll.scrollTop-=9;else if(state.y>rect.bottom-48)scroll.scrollTop+=9;}
      var hit=document.elementFromPoint(state.x,state.y),target=hit&&hit.closest('.notes-block');
      if(state.target)state.target.classList.remove('drop-before','drop-after');
      state.target=null;
      if(target&&target!==row&&target.parentElement===row.parentElement){
        var r=target.getBoundingClientRect();state.placement=state.y<r.top+r.height/2?'before':'after';
        state.target=target;target.classList.add('drop-'+state.placement);
      }
      frame=requestAnimationFrame(track);
    }
    notesListen(grip,'pointerdown',function(e){
      if(!notesIsMobile()||!e.isPrimary||e.button!==0)return;
      clear();suppressClick=false;state={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false};
      grip.setPointerCapture(e.pointerId);
      hold=setTimeout(function(){if(!state||!row.isConnected){clear();return;}state.active=true;suppressClick=true;row.classList.add('dragging');track();},280);
    });
    notesListen(grip,'pointermove',function(e){
      if(!state||state.id!==e.pointerId)return;
      state.x=e.clientX;state.y=e.clientY;
      if(!state.active&&Math.hypot(state.x-state.startX,state.y-state.startY)>12){clear();return;}
      if(state.active)e.preventDefault();
    });
    notesListen(grip,'pointerup',function(e){
      if(!state||state.id!==e.pointerId)return;
      var target=state.active&&state.target,placement=state.placement;
      clear();if(target){notesMoveBlock(blockId,target.dataset.id,placement);notesFocusBlock(blockId);}
    });
    grip.addEventListener('pointercancel',clear);grip.addEventListener('lostpointercapture',clear);
    grip.addEventListener('click',function(e){if(suppressClick){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    grip.addEventListener('dragstart',function(e){if(notesIsMobile())e.preventDefault();});
  }

  function notesRenderBlocks() {
    NotesDatabase.close();
    var page=notesCurrentPage(),host=document.getElementById(notesRowScope?'notesRowBlocks':'notesBlocks');if(!host)return;
    var before=page&&notesLastBlocksPageId===page.id&&notesCanAnimate(host)?notesSnapshotRects(host.children):null;
    var freshMobilePage=host._notesRenderedPage!==page;host._notesRenderedPage=page;
    var renderToken={};host._notesRenderToken=renderToken;host.inert=false;host.removeAttribute('aria-busy');
    host.innerHTML='';notesLastBlocksPageId=page?page.id:null;if(!page)return;
    function buildBlock(block,index){
      if(notesRowScope&&['database','synced','page'].includes(block.type)){var unsupported=document.createElement('div');unsupported.className='notes-row-unsupported';unsupported.textContent='This nested block is preserved but is not editable in a row page.';host.appendChild(unsupported);return;}
      block=notesNormalizeBlock(block);page.blocks[index]=block;
      var row=document.createElement('div');row.className='notes-block';row.dataset.type=block.type;row.dataset.id=block.id;if(block.type==='quote')row.dataset.quoteSize=block.quoteSize||'small';notesApplyBlockStyle(row,block);
      var tools=document.createElement('div');tools.className='notes-block-tools';
      var plus=document.createElement('button');plus.type='button';plus.className='notes-block-plus';plus.title='Add block';plus.setAttribute('aria-label','Add block');var plusGlyph=document.createElement('span');plusGlyph.className='notes-plus-glyph';plusGlyph.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';plus.appendChild(plusGlyph);notesListen(plus,'click',function(e){e.stopPropagation();notesOpenInsertMenu(plus,block.id);row.classList.add('notes-tools-pinned');});
      var grip=document.createElement('button');grip.type='button';grip.className='notes-block-grip';grip.title='Block actions';grip.setAttribute('aria-label','Block actions');var gripDots=document.createElement('span');gripDots.className='notes-grip-dots';for(var gd=0;gd<6;gd++){var gripDot=document.createElement('span');gripDot.className='notes-grip-dot';gripDots.appendChild(gripDot);}grip.appendChild(gripDots);grip.draggable=true;notesListen(grip,'click',function(e){e.stopPropagation();notesOpenBlockMenu(block,grip);row.classList.add('notes-tools-pinned');});
      notesListen(grip,'dragstart',function(e){notesDraggedBlockId=block.id;row.classList.add('dragging');try{e.dataTransfer.setData('application/x-tj-notes-block',block.id);e.dataTransfer.effectAllowed='move';}catch(_){}});
      notesListen(grip,'dragend',function(){notesDraggedBlockId=null;row.classList.remove('dragging');notesClearPageDropMarks();Array.prototype.forEach.call(document.querySelectorAll('.notes-block.drop-before,.notes-block.drop-after'),function(n){n.classList.remove('drop-before','drop-after');});});
      notesEnableMobileBlockDrag(row,grip,block.id);
      tools.appendChild(plus);tools.appendChild(grip);row.appendChild(tools);
      var body=document.createElement('div');body.className='notes-block-body';row.appendChild(body);

      if(block.type==='image') {
        var imageWrap=document.createElement('figure');imageWrap.className='notes-image-block';
        var image=document.createElement('img');notesPaintImage(image,block.src,imageWrap);image.alt=block.alt||'Pasted image';image.loading='lazy';image.decoding='async';image.title='Click to view full size';
        notesListen(image,'error',function(){imageWrap.classList.add('is-broken');});
        notesListen(image,'click',function(){var u=image.currentSrc||image.src||'';if(u)notesOpenImageViewer(u,block.alt||'Pasted image');});
        imageWrap.appendChild(image);body.appendChild(imageWrap);
      }
      else if(block.type==='divider') { var hr=document.createElement('div');hr.className='notes-divider';body.appendChild(hr); }
      else if(block.type==='todo') {
        var todo=document.createElement('div');todo.className='notes-todo-row';var check=document.createElement('input');check.type='checkbox';check.className='notes-todo-check';check.checked=!!block.checked;notesListen(check,'change',function(){notesUpdateBlock(block.id,function(b){b.checked=check.checked;});check.classList.remove('pop');void check.offsetWidth;if(!notesReduceMotion)check.classList.add('pop');});todo.appendChild(check);todo.appendChild(notesTextEditable(block,'text','To-do'));body.appendChild(todo);
      }
      else if(block.type==='bulleted'||block.type==='numbered') {
        var listRow=document.createElement('div');listRow.className='notes-list-row';var marker=document.createElement('div');marker.className='notes-list-marker';marker.textContent=block.type==='bulleted'?'•':notesNumberForBlock(page,index)+'.';listRow.appendChild(marker);listRow.appendChild(notesTextEditable(block,'text','List item'));body.appendChild(listRow);
      }
      else if(block.type==='toggle' || block.type.indexOf('toggleh')===0) {
        if(block.type.indexOf('toggleh')===0)row.classList.add('notes-toggle-heading',block.type);
        var tr=document.createElement('div');tr.className='notes-toggle-row';var arrow=document.createElement('button');arrow.type='button';arrow.className='notes-toggle-arrow'+(block.open?'':' closed');arrow.textContent='▾';notesListen(arrow,'click',function(){
          if(arrow.dataset.busy)return;arrow.dataset.busy='1';
          var closing=!!block.open,det=body.querySelector('.notes-toggle-detail');
          var go=function(){notesPendingToggle=closing?null:block.id;notesUpdateBlock(block.id,function(b){b.open=!closing;});notesRenderBlocks();notesPendingToggle=null;};
          if(closing){arrow.classList.add('closed');notesAnimateOut(det,go,[{opacity:1,transform:'translate3d(0,0,0)'},{opacity:0,transform:'translate3d(0,-3px,0)'}],120);}else go();
        });
        if(notesPendingToggle===block.id)notesAnimate(arrow,[{transform:'rotate(-90deg)'},{transform:'rotate(0deg)'}],{duration:220});
        tr.appendChild(arrow);tr.appendChild(notesTextEditable(block,'text','Toggle'));body.appendChild(tr);
        if(block.open){var detail=notesTextEditable(block,'detail','Toggle content…',{multiline:true,disableSlash:true});detail.className='notes-toggle-detail';body.appendChild(detail);if(notesPendingToggle===block.id)notesAnimate(detail,[{opacity:0,transform:'translate3d(0,-4px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:260});}
      }
      else if(block.type==='quote') { var q=document.createElement('div');q.className='notes-quote';q.appendChild(notesTextEditable(block,'text','Quote'));body.appendChild(q); }
      else if(block.type==='callout') {
        var call=document.createElement('div');call.className='notes-callout';var ico=document.createElement('button');ico.type='button';ico.className='notes-callout-icon';notesPaintIcon(ico,block.icon||'💡',block.iconType,block.iconColor);notesListen(ico,'click',function(){notesOpenIconPicker(ico,{value:block.icon||'💡',type:block.iconType||'emoji',color:block.iconColor||'default'},function(pick){notesUpdateBlock(block.id,function(b){b.icon=pick.value||'💡';b.iconType=pick.type||'emoji';b.iconColor=pick.color||'default';});notesRenderBlocks();});});call.appendChild(ico);call.appendChild(notesTextEditable(block,'text','Callout'));body.appendChild(call);
      }
      else if(block.type==='equation') {
        var eq=document.createElement('div');eq.className='notes-equation';eq.appendChild(notesTextEditable(block,'text','Type an equation…'));body.appendChild(eq);
      }
      else if(block.type==='synced') {
        row.dataset.syncKey=block.syncKey||'';var syn=document.createElement('div');syn.className='notes-synced';var badge=document.createElement('div');badge.className='notes-synced-badge';badge.textContent='Synced';syn.appendChild(badge);var sed=notesTextEditable(block,'text','Synced block');syn.appendChild(sed);body.appendChild(syn);
      }
      else if(block.type==='code') {
        var code=document.createElement('div');code.className='notes-code'+(block.wrap?'':' nowrap');var head=document.createElement('div');head.className='notes-code-head';var sel=document.createElement('select');NOTES_LANGUAGES.forEach(function(lang){var o=document.createElement('option');o.value=lang;o.textContent=lang;if(lang===block.language)o.selected=true;sel.appendChild(o);});notesListen(sel,'change',function(){notesUpdateBlock(block.id,function(b){b.language=sel.value;});});var copy=document.createElement('button');copy.type='button';copy.textContent='Copy';notesListen(copy,'click',function(){notesCopyText(block.text||'');notesToast('Code copied');});var more=document.createElement('button');more.type='button';more.className='notes-code-more';more.title='More';more.setAttribute('aria-label','More');notesDots(more);notesListen(more,'click',function(){notesOpenBlockMenu(block,more);});head.appendChild(sel);head.appendChild(copy);head.appendChild(more);code.appendChild(head);var ta=document.createElement('textarea');ta.className='notes-code-area';ta.dataset.notesField='text';ta.spellcheck=false;ta.value=block.text||'';ta.wrap=block.wrap?'soft':'off';notesListen(ta,'input',function(){notesUpdateBlock(block.id,function(b){b.text=notesClampText(ta.value,40000);});notesAutoSizeTextarea(ta);});notesListen(ta,'keydown',function(e){if(e.key==='Tab'){e.preventDefault();var s=ta.selectionStart,en=ta.selectionEnd;ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(en);ta.selectionStart=ta.selectionEnd=s+2;ta.dispatchEvent(new Event('input'));}});code.appendChild(ta);if(block.caption){var cap=document.createElement('div');cap.className='notes-code-caption';cap.contentEditable='true';cap.textContent=block.caption;notesListen(cap,'input',function(){notesUpdateBlock(block.id,function(b){b.caption=notesClampText(notesReadEditable(cap),3000);});});code.appendChild(cap);}body.appendChild(code);requestAnimationFrame(function(){notesAutoSizeTextarea(ta);});
      }
      else if(block.type==='database') {
        notesDBMount(block,body,page,notesLoadedFor);
      }
      else if(block.type==='table') notesRenderTable(block,body);
      else if(block.type==='page') {
        var linked=notesPageById(block.linkedPageId);var link=document.createElement('div');link.className='notes-page-link-block';if(linked)link.dataset.pageId=linked.id;var li=document.createElement('span');li.className='notes-page-link-icon';notesPaintIcon(li,linked&&linked.icon?linked.icon:'◇',linked&&linked.icon?linked.iconType:'icon',linked&&linked.icon?linked.iconColor:'default');var lt=document.createElement('span');lt.className='notes-page-link-title';lt.textContent=linked?(linked.title||'Untitled'):(block.text||'Missing page');link.appendChild(li);link.appendChild(lt);if(linked){var previewShown=false;var showPreview=function(){if(!previewShown){previewShown=true;notesShowAttachedPreview(link,linked);}};notesListen(link,'mouseenter',showPreview);notesListen(link,'pointerenter',showPreview);notesListen(link,'mousemove',showPreview);notesListen(link,'mouseleave',function(){previewShown=false;notesHideAttachedPreview(link);});notesListen(link,'pointerleave',function(){previewShown=false;notesHideAttachedPreview(link);});}notesListen(link,'click',function(){notesHideAttachedPreview();if(linked){notesActivePageId=linked.id;notesRender();}});body.appendChild(link);
      }
      else if(block.type.indexOf('columns')===0) {
        var count=Math.max(2,Math.min(5,Number(block.type.replace('columns',''))||2));var cols=document.createElement('div');cols.className='notes-columns';cols.style.gridTemplateColumns='repeat('+count+',minmax(0,1fr))';for(var ci=0;ci<count;ci++){(function(colIndex){var col=document.createElement('div');col.className='notes-column';var ce=document.createElement('div');ce.className='notes-editable';ce.contentEditable='true';ce.spellcheck=true;ce.dataset.placeholder='Type in column…';ce.textContent=block.columns[colIndex]||'';notesListen(ce,'input',function(){notesUpdateBlock(block.id,function(b){b.columns[colIndex]=notesClampText(notesReadEditable(ce),12000);});});col.appendChild(ce);cols.appendChild(col);})(ci);}body.appendChild(cols);
      }
      else body.appendChild(notesTextEditable(block,'text',block.type==='h1'?'Heading 1':block.type==='h2'?'Heading 2':block.type==='h3'?'Heading 3':block.type==='h4'?'Heading 4':'Type something…'));

      notesListen(row,'dragover',function(e){if(!notesDraggedBlockId||notesDraggedBlockId===block.id)return;e.preventDefault();var r=row.getBoundingClientRect();notesDraggedBlockPlacement=e.clientY<r.top+r.height/2?'before':'after';row.classList.toggle('drop-before',notesDraggedBlockPlacement==='before');row.classList.toggle('drop-after',notesDraggedBlockPlacement==='after');});
      notesListen(row,'dragleave',function(){row.classList.remove('drop-before','drop-after');});
      notesListen(row,'drop',function(e){if(!notesDraggedBlockId)return;e.preventDefault();row.classList.remove('drop-before','drop-after');notesMoveBlock(notesDraggedBlockId,block.id,notesDraggedBlockPlacement);});
      host.appendChild(row);
    }
    if(notesIsMobile()&&!notesRowScope&&freshMobilePage&&page.blocks.length>40){
      var cursor=0,owner=notesOwner(),blocks=page.blocks;
      host.inert=true;host.setAttribute('aria-busy','true');
      function batch(){
        if(host._notesRenderToken!==renderToken||!host.isConnected||notesOwner()!==owner||notesCurrentPage()!==page)return;
        var stop=Math.min(cursor+24,blocks.length);
        for(;cursor<stop;cursor++)buildBlock(blocks[cursor],cursor);
        if(cursor<blocks.length)setTimeout(batch,0);
        else{host.inert=false;host.removeAttribute('aria-busy');notesScheduleBlockToolsAlignment();}
      }
      batch();return;
    }
    page.blocks.forEach(buildBlock);
    // Align gutter tools synchronously: the old rAF-only pass showed them at the wrong height for a frame.
    notesAlignAllBlockTools();
    if(before)notesPlayFlip(host.children,before,{maxEnter:3,enterY:-3});
    notesScheduleBlockToolsAlignment();
  }

  function notesCommentAuthorName() {
    var n=(typeof currentUser!=='undefined'&&currentUser&&currentUser.login)||(typeof viewingUser==='string'&&viewingUser)||'You';
    return String(n);
  }
  function notesAvatarLetter(name) { var ch=Array.from(String(name||'').trim())[0]||'?'; return ch.toLocaleUpperCase(); }
  function notesRelTime(ts) {
    var d=Date.now()-Number(ts||0);if(!(d>=0))d=0;
    if(d<60000)return 'Just now';if(d<3600000)return Math.floor(d/60000)+'m ago';if(d<86400000)return Math.floor(d/3600000)+'h ago';
    if(d<7*86400000)return Math.floor(d/86400000)+'d ago';
    try{return new Date(ts).toLocaleDateString(undefined,{day:'numeric',month:'short',year:new Date(ts).getFullYear()===new Date().getFullYear()?undefined:'numeric'});}catch(_){return '';}
  }
  function notesBuildComment(page,c) {
    var item=document.createElement('div');item.className='notes-comment';item.dataset.id=c.id;
    var author=c.author||notesCommentAuthorName();
    var rail=document.createElement('div');rail.className='notes-comment-rail';
    var av=document.createElement('span');av.className='notes-comment-avatar';av.textContent=notesAvatarLetter(author);rail.appendChild(av);
    var main=document.createElement('div');main.className='notes-comment-main';
    var head=document.createElement('div');head.className='notes-comment-head';
    var nm=document.createElement('span');nm.className='notes-comment-name';nm.textContent=author;
    var tm=document.createElement('span');tm.className='notes-comment-time';tm.textContent=notesRelTime(c.createdAt);try{tm.title=new Date(c.createdAt).toLocaleString();}catch(_){}
    head.appendChild(nm);head.appendChild(tm);
    var txt=document.createElement('div');txt.className='notes-comment-text';txt.textContent=c.text;
    main.appendChild(head);main.appendChild(txt);
    var del=document.createElement('button');del.type='button';del.className='notes-comment-delete';del.title='Delete comment';del.setAttribute('aria-label','Delete comment');del.textContent='×';
    del.addEventListener('click',function(){
      var h=item.offsetHeight;
      notesAnimateOut(item,function(){page.comments=page.comments.filter(function(x){return x.id!==c.id;});notesRenderComments(page);notesScheduleSave();},[{height:h+'px',opacity:1},{height:'0px',opacity:0}],200);
    });
    item.appendChild(rail);item.appendChild(main);item.appendChild(del);
    return item;
  }
  function notesQuickLabel(btn,text){var l=btn.querySelector('.notes-qa-label');if(l){if(l.textContent!==text)l.textContent=text;}else btn.textContent=text;}
  function notesRenderComments(page,enterId) {
    var tgl=document.getElementById('notesToggleCommentsBtn');if(tgl){var cnt=(page.comments||[]).length;notesQuickLabel(tgl,cnt?'Comments · '+cnt:'Add comment');}
    var ca=document.getElementById('notesComposeAvatar');if(ca)ca.textContent=notesAvatarLetter(notesCommentAuthorName());
    var list=document.getElementById('notesCommentsList');if(!list)return;list.innerHTML='';
    (page.comments||[]).forEach(function(c){list.appendChild(notesBuildComment(page,c));});
    if(enterId){var n=list.querySelector('.notes-comment[data-id="'+enterId+'"]');if(n){var h=n.offsetHeight;notesAnimate(n,[{height:'0px',opacity:0,transform:'translate3d(0,-4px,0)'},{height:h+'px',opacity:1,transform:'translate3d(0,0,0)'}],{duration:300});}}
  }

  function notesRender() {
    notesSyncSaveStatus(false);
    if(notesLoadedRemote&&!notesMobileLoading&&!notesCloudIncomplete&&notesLoadedFor&&notesShareDeletionList(notesLoadedFor,notesAuthUid()).length)notesSyncShares(notesLoadedFor);
    if(notesRowScope){notesRenderBlocks();return;}
    notesTabsBeforeRender();
    notesCloseMenus();notesRenderSidebar();var page=notesCurrentPage();var empty=document.getElementById('notesEmptyState'),panel=document.getElementById('notesPage');
    if(!page){if(empty){var wasHidden=empty.style.display==='none';empty.style.display='block';if(wasHidden)notesAnimate(empty,[{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:340});}if(panel)panel.style.display='none';notesLastPageId='__empty';var bc=document.getElementById('notesBreadcrumb');if(bc)bc.textContent='Notes';notesTabsPaint();return;}
    if(empty)empty.style.display='none';if(panel){panel.style.display='block';panel.classList.toggle('has-cover',!!page.cover);}
    var pageChanged=page.id!==notesLastPageId;
    if(pageChanged){
      // New page starts at the top (it used to inherit the previous page's scroll position).
      var pwrap=document.getElementById('notesPageWrap');if(pwrap)pwrap.scrollTop=0;
      if(panel&&notesLastPageId!==null)notesAnimate(panel,[{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:320});
    }
    notesLastPageId=page.id;
    var cover=document.getElementById('notesPageCover');if(cover){var prevCover=cover.style.display==='none'?'':(cover.dataset.cover||'');cover.style.display=page.cover?'block':'none';cover.dataset.cover=page.cover||'';notesCoverBg(cover,page.cover==='image'&&page.coverImage?page.coverImage:'');
      if(!pageChanged&&page.cover&&!prevCover)notesAnimate(cover,[{height:'0px',opacity:0},{height:'260px',opacity:1}],{duration:380});
      else if(!pageChanged&&page.cover&&(prevCover!==page.cover||page.cover==='image'&&cover.dataset.img!==String(page.coverImage.length)))notesAnimate(cover,[{opacity:.35},{opacity:1}],{duration:320,easing:'ease-out'});cover.dataset.img=page.cover==='image'?String((page.coverImage||'').length):'';}
    var title=document.getElementById('notesPageTitle');if(title&&document.activeElement!==title)title.value=page.title||'Untitled';
    notesRenderBreadcrumb(page);
    var iconBtn=document.getElementById('notesPageIconButton');if(iconBtn){var hadIcon=iconBtn.style.display!=='none';iconBtn.style.display=page.icon?'block':'none';if(!pageChanged&&page.icon&&!hadIcon)notesAnimate(iconBtn,[{opacity:0,transform:'scale(.7)'},{opacity:1,transform:'scale(1)'}],{duration:320,easing:'cubic-bezier(.34,1.56,.64,1)'});notesPaintIcon(iconBtn,page.icon||'',page.iconType,page.iconColor);}
    var iconQuick=document.getElementById('notesAddIconBtn');if(iconQuick)notesQuickLabel(iconQuick,page.icon?'Change icon':'Add icon');
    var coverQuick=document.getElementById('notesAddCoverBtn');if(coverQuick)notesQuickLabel(coverQuick,page.cover?'Change cover':'Add cover');
    notesRenderComments(page);
    if(pageChanged){var cp=document.getElementById('notesCommentsPanel');if(cp&&!cp.dataset.busy){if(cp.getAnimations)cp.getAnimations().forEach(function(a){a.cancel();});cp.style.display=(page.comments&&page.comments.length)?'block':'none';}}
    notesRenderBlocks();notesTabsAfterRender();
  }

  function notesRemoveCover(p) {
    var cover=document.getElementById('notesPageCover');if(!p)return;
    var finish=function(){p.cover='';p.coverImage='';notesRender();notesScheduleSave();};
    if(cover&&cover.style.display!=='none'&&p.id===notesActivePageId)notesAnimateOut(cover,finish,[{height:'260px',opacity:1},{height:'0px',opacity:0}],260);else finish();
  }

  // Comments panel opens/closes by height, so the page below glides instead of jumping.
  function notesSetCommentsOpen(open) {
    var p=document.getElementById('notesCommentsPanel');if(!p||p.dataset.busy)return;var isOpen=p.style.display!=='none';if(open===isOpen)return;
    if(open){
      p.style.display='block';var h=p.offsetHeight;
      notesAnimate(p,[{height:'0px',opacity:0,marginBottom:'0px'},{height:h+'px',opacity:1,marginBottom:'26px'}],{duration:280});
      var inp=document.getElementById('notesCommentInput');if(inp)setTimeout(function(){inp.focus({preventScroll:true});},30);
    }else{
      var h2=p.offsetHeight;p.dataset.busy='1';
      notesAnimateOut(p,function(){p.style.display='none';delete p.dataset.busy;if(p.getAnimations)p.getAnimations().forEach(function(a){a.cancel();});},[{height:h2+'px',opacity:1,marginBottom:'26px'},{height:'0px',opacity:0,marginBottom:'0px'}],220);
    }
  }

  function notesSyncCommentSend() { var i=document.getElementById('notesCommentInput'),b=document.getElementById('notesAddCommentBtn');if(i&&b)b.disabled=!i.value.trim(); }
  function notesAddComment() {
    var page=notesCurrentPage(),input=document.getElementById('notesCommentInput');if(!page||!input)return;var value=input.value.trim();if(!value)return;page.comments=page.comments||[];var nc={id:notesId('c'),text:notesClampText(value,600),createdAt:Date.now(),author:notesClampText(notesCommentAuthorName(),60)};page.comments.push(nc);input.value='';notesSyncCommentSend();notesRenderComments(page,nc.id);notesScheduleSave();
  }

  function notesToast(message) {
    var el=document.getElementById('notesToast');if(!el)return;clearTimeout(notesToastTimer);el.textContent=message;el.classList.add('show');notesToastTimer=setTimeout(function(){el.classList.remove('show');},1500);
  }

  function notesCopyText(text) {
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(String(text||'')).catch(function(){});return;}
    var ta=document.createElement('textarea');ta.value=String(text||'');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_){}document.body.removeChild(ta);
  }

  function notesCopyBlockLink(block) {
    var page=notesCurrentPage();if(!page)return;var base=location.href.split('#')[0];notesCopyText(base+'#notes/'+encodeURIComponent(page.id)+'/'+encodeURIComponent(block.id));notesToast('Link copied');
  }

  function notesApplyHashTarget() {
    var m=String(location.hash||'').match(/^#notes\/([^/]+)(?:\/([^/]+))?/);if(!m)return;var pid=decodeURIComponent(m[1]),bid=m[2]?decodeURIComponent(m[2]):null;if(!notesPageById(pid))return;notesActivePageId=pid;notesRender();if(bid)requestAnimationFrame(function(){var el=document.querySelector('.notes-block[data-id="'+bid+'"]');if(el){el.scrollIntoView({block:'center',behavior:'smooth'});el.style.boxShadow='0 0 0 1px rgba(255,255,255,.16) inset';setTimeout(function(){el.style.boxShadow='';},1200);}});
  }

  var notesLoadingRun = 0;
  function notesTransition(done) {
    notesLoadingRun++;
    var overlay=document.getElementById('notesTransitionOverlay');if(!overlay){done();return;}clearTimeout(notesTransitionTimer);overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');notesTransitionTimer=setTimeout(function(){done();requestAnimationFrame(function(){overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');});},310);
  }

  function notesLoadingTransition(begin) {
    var overlay=document.getElementById('notesTransitionOverlay');
    if(!overlay){begin(function(){});return;}
    /* Keep the transition outside #appRoot. The app shell is width-limited
       before notes-workspace-mode is applied, which used to clip the first
       900ms of the loading cover to the journal column. */
    if(overlay.parentNode!==document.body)document.body.appendChild(overlay);
    clearTimeout(notesTransitionTimer);
    var run=++notesLoadingRun, started=Date.now(), revealed=false, loadStarted=false, progressAnimation=null;
    overlay.classList.remove('open','loading','leaving','ready');
    void overlay.offsetWidth;
    overlay.classList.add('open','loading');
    overlay.setAttribute('aria-hidden','false');
    var progress=overlay.querySelector('.notes-loading-progress');
    if(progress){progress.style.animation='none';progress.style.transform='scaleX(0)';}
    function startLoading(){
      if(loadStarted||run!==notesLoadingRun)return;
      loadStarted=true;
      started=Date.now();
      if(progress){void progress.offsetWidth;progress.style.animation='notesLoadingProgress 4.2s cubic-bezier(.16,1,.3,1) forwards';}
      if(progress&&progress.getAnimations){
        progressAnimation=progress.getAnimations().filter(function(a){return a.animationName==='notesLoadingProgress';})[0]||null;
      }
      begin(reveal);
    }
    function reveal(){
      if(revealed||run!==notesLoadingRun)return;
      revealed=true;
      // The full branded intro has priority over cache/network readiness on every device.
      var wait=Math.max(0,4200-(Date.now()-started));
      notesTransitionTimer=setTimeout(function(){
        if(run!==notesLoadingRun)return;
        // Background tabs can pause CSS animation while wall-clock timers continue.
        // Wait for the actual animation as well as its minimum visible schedule.
        if(progressAnimation&&progressAnimation.playState!=='finished'){
          progressAnimation.finished.then(leave,leave);
        }else leave();
      },wait);
    }
    function leave(){
        if(run!==notesLoadingRun)return;
        overlay.classList.add('ready','leaving');
        setTimeout(function(){
          if(run!==notesLoadingRun)return;
          overlay.classList.remove('open','loading','ready','leaving');
          overlay.setAttribute('aria-hidden','true');
        },220);
    }
    /* Hold the cover over the old screen for a beat first. Notes does not
       mount or fetch during that beat, so its own loading state cannot flash
       through between two transitions. */
    notesTransitionTimer=setTimeout(startLoading,900);
  }

  function enterNotesWorkspace() {
    notesSyncSaveStatus(true);
    /* v3.22 mobile: Mobile mode opens the adapted Notes layout; desktop keeps its narrow-window guard. */
    if(!document.body.classList.contains('mobile-mode')&&window.innerWidth<=760)return;
    var sw=document.getElementById('settingsWrap');if(sw)sw.classList.remove('open');var sb=document.getElementById('settingsBtn');if(sb)sb.setAttribute('aria-expanded','false');if(typeof setSecondaryActions==='function')setSecondaryActions(false);
    notesLoadingTransition(function(reveal){notesWorkspaceMode=true;document.body.classList.remove('backtest-workspace-mode','backtest-detail-mode','backtest-input-panel-collapsed');document.body.classList.add('notes-workspace-mode');var ws=document.getElementById('notesWorkspace');if(ws)ws.setAttribute('aria-hidden','false');if(notesIsMobile()){notesMobileBusy(true);reveal();requestAnimationFrame(function(){setTimeout(function(){notesLoad(false).then(function(){notesMobileBusy(false);requestAnimationFrame(notesPositionActivePill);});},0);});}else{Promise.resolve(notesLoad(false)).then(function(){requestAnimationFrame(notesPositionActivePill);reveal();},function(){reveal();});}});
  }

  function exitNotesWorkspace(immediate) {
    notesCloseMenus();notesSave();var finish=function(){notesWorkspaceMode=false;document.body.classList.remove('notes-workspace-mode');var ws=document.getElementById('notesWorkspace');if(ws)ws.setAttribute('aria-hidden','true');};if(immediate)finish();else notesTransition(finish);
  }

  /* ---------- Menu system ---------- */
  function notesCloseMenus() {
    NotesDatabase.close();
    Array.prototype.forEach.call(document.querySelectorAll('.notes-block.notes-tools-pinned'),function(r){r.classList.remove('notes-tools-pinned');});
    notesCommandState=null;notesMenuPanels=[];var layer=document.getElementById('notesMenuLayer');if(!layer)return;
    Array.prototype.forEach.call(layer.querySelectorAll('.notes-icon-color-pop'),function(p){if(p.parentNode)p.parentNode.removeChild(p);});
    layer.classList.remove('open');layer.setAttribute('aria-hidden','true');clearTimeout(notesMenuCloseTimer);
    var panels=layer.querySelectorAll('.notes-menu:not(.closing)');
    if(!panels.length||notesReduceMotion){layer.innerHTML='';return;}
    // Fade menus out instead of deleting them mid-frame.
    var back=layer.querySelector('.notes-menu-backdrop');if(back)back.parentNode.removeChild(back);
    Array.prototype.forEach.call(panels,function(p){p.classList.add('closing');});
    notesMenuCloseTimer=setTimeout(function(){Array.prototype.forEach.call(layer.querySelectorAll('.notes-menu.closing'),function(p){if(p.parentNode)p.parentNode.removeChild(p);});},140);
  }

  function notesEnsureMenuLayer() {
    var layer=document.getElementById('notesMenuLayer');if(!layer)return null;clearTimeout(notesMenuCloseTimer);layer.innerHTML='';layer.classList.add('open');layer.setAttribute('aria-hidden','false');var back=document.createElement('div');back.className='notes-menu-backdrop';back.addEventListener('mousedown',function(e){if(e.target===back){var panels=layer.querySelectorAll('.notes-menu');var top=panels[panels.length-1];if(notesIsMobile()&&top&&top._notesMobileDismiss)top._notesMobileDismiss();else notesCloseMenus();}});layer.appendChild(back);return layer;
  }

  // Placement is measured synchronously: the old rAF pass drew the menu in one spot and moved it a frame later.
  function notesPlacePanel(panel,x,y,placeOpts) {
    placeOpts=placeOpts||{};var pad=10;panel.style.maxHeight=Math.max(180,window.innerHeight-pad*2)+'px';
    var w=panel.offsetWidth,h=panel.offsetHeight,nx=x,ny=y,up=false,left=false;
    if(nx+w>window.innerWidth-pad){if(Number.isFinite(placeOpts.anchorLeft)&&placeOpts.anchorLeft-w-4>=pad){nx=placeOpts.anchorLeft-w-4;left=true;}else nx=Math.max(pad,window.innerWidth-pad-w);}
    if(ny+h>window.innerHeight-pad){if(Number.isFinite(placeOpts.anchorTop)&&placeOpts.anchorTop-h-pad>=pad){ny=placeOpts.anchorTop-h-5;up=true;}else ny=Math.max(pad,window.innerHeight-pad-h);}
    if(nx<pad)nx=pad;if(ny<pad)ny=pad;
    panel.style.left=Math.round(nx)+'px';panel.style.top=Math.round(ny)+'px';panel.style.transformOrigin=(up?'bottom':'top')+' '+(left?'right':'left');
  }

  function notesRemoveSubmenusFrom(depth) {
    while(notesMenuPanels.length>depth){var p=notesMenuPanels.pop();if(p&&p.parentNode)p.parentNode.removeChild(p);}
    var parent=notesMenuPanels[notesMenuPanels.length-1];
    if(parent){parent.inert=false;parent.classList.remove('notes-submenu-covered');}
  }

  function notesBuildMenuPanel(items,x,y,opts,depth) {
    items=notesRowMenuItems(items,notesRowScope);
    opts=opts||{};depth=depth||0;var layer=document.getElementById('notesMenuLayer');if(!layer)return null;notesRemoveSubmenusFrom(depth);var panel=document.createElement('div');panel.className='notes-menu'+(opts.wide?' notes-menu-wide':'');panel.dataset.depth=depth;
    var filterable=[];
    if(notesIsMobile()&&depth>0){
      var parent=notesMenuPanels[depth-1];
      if(parent){parent.inert=true;parent.classList.add('notes-submenu-covered');}
      var back=document.createElement('button');back.type='button';back.className='notes-menu-item notes-submenu-back';back.innerHTML='<span class="notes-menu-icon" aria-hidden="true">‹</span><span class="notes-menu-text">Back</span>';back.setAttribute('aria-label','Back to previous menu');
      back.addEventListener('click',function(e){e.stopPropagation();var owner=panel._owner;notesRemoveSubmenusFrom(depth);if(owner&&owner.isConnected)owner.focus({preventScroll:true});});
      panel.appendChild(back);
    }
    if(opts.search){var sw=document.createElement('div');sw.className='notes-menu-search-wrap';var inp=document.createElement('input');inp.className='notes-menu-search';inp.type='text';inp.placeholder=opts.searchPlaceholder||'Search actions…';sw.appendChild(inp);panel.appendChild(sw);inp.addEventListener('input',function(){var q=inp.value.trim().toLowerCase();filterable.forEach(function(rec){rec.el.style.display=!q||rec.search.indexOf(q)>=0?'flex':'none';});Array.prototype.forEach.call(panel.querySelectorAll('.notes-menu-label,.notes-menu-sep'),function(n){n.style.display=q?'none':'';});});inp.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();notesCloseMenus();return;}if(e.key==='Enter'){e.preventDefault();var first=filterable.filter(function(rec){return rec.el.style.display!=='none'&&!rec.item.disabled;})[0];if(first)first.el.click();}});setTimeout(function(){if(!document.body.classList.contains('mobile-mode'))inp.focus();},0);}
    items.forEach(function(item){
      if(item.type==='sep'){var sep=document.createElement('div');sep.className='notes-menu-sep';panel.appendChild(sep);return;}
      if(item.type==='label'){var lab=document.createElement('div');lab.className='notes-menu-label';lab.textContent=item.label||'';panel.appendChild(lab);return;}
      var btn=document.createElement('button');btn.type='button';btn.className='notes-menu-item'+(item.danger?' danger':'')+(item.disabled?' disabled':'');
      if(item.swatch){var swatch=document.createElement('span');swatch.className='notes-color-swatch';swatch.style.setProperty('--swatch',item.swatch);btn.appendChild(swatch);}else{var icon=document.createElement('span');icon.className='notes-menu-icon';var menuIconValue=String(item.icon||'');if(menuIconValue.indexOf('line:')===0){notesPaintIcon(icon,menuIconValue,'icon',item.iconColor||'default');}else{icon.textContent=menuIconValue;if(menuIconValue.length>2)icon.classList.add('long');}btn.appendChild(icon);}
      var tx=document.createElement('span');tx.className='notes-menu-text';tx.textContent=item.label||'';btn.appendChild(tx);
      if(item.hotkey){var hk=document.createElement('span');hk.className='notes-menu-hotkey';hk.textContent=item.hotkey;btn.appendChild(hk);}
      if(item.submenu){var ar=document.createElement('span');ar.className='notes-menu-arrow';ar.textContent='›';btn.appendChild(ar);}
      if(opts.search)filterable.push({el:btn,search:String(item.label||'').toLowerCase(),item:item});
      if(!item.submenu)btn.addEventListener('mouseenter',function(){notesRemoveSubmenusFrom(depth+1);Array.prototype.forEach.call(panel.querySelectorAll('.submenu-open'),function(n){n.classList.remove('submenu-open');});});
      if(!item.disabled){
        if(item.submenu){var openSub=function(e){e.stopPropagation();var cur=notesMenuPanels[depth+1];if(cur&&cur._owner===btn&&cur.isConnected)return;Array.prototype.forEach.call(panel.querySelectorAll('.submenu-open'),function(n){n.classList.remove('submenu-open');});btn.classList.add('submenu-open');var br=btn.getBoundingClientRect();var sub=typeof item.submenu==='function'?item.submenu():item.submenu;var sp=notesBuildMenuPanel(sub,br.right+4,br.top,{wide:item.submenuWide,place:{anchorLeft:br.left}},depth+1);if(sp)sp._owner=btn;};btn.addEventListener('mouseenter',function(e){/* v3.22 mobile: a tap emits mouseenter before click; opening the sheet there let the same tap hit a submenu item. */if(document.body.classList.contains('mobile-mode'))return;openSub(e);});btn.addEventListener('click',openSub);}
        else btn.addEventListener('click',function(e){e.stopPropagation();notesCloseMenus();if(item.action)item.action();});
      }
      panel.appendChild(btn);
    });
    layer.appendChild(panel);notesMenuPanels[depth]=panel;notesPlacePanel(panel,x,y,opts.place);return panel;
  }

  function notesOpenMenu(anchor,items,opts) {
    var layer=notesEnsureMenuLayer();if(!layer)return null;var r=anchor.getBoundingClientRect();opts=opts||{};opts.place={anchorTop:r.top};return notesBuildMenuPanel(items,r.left,r.bottom+5,opts,0);
  }

  function notesTypeMenuItems(blockId) {
    return [
      {label:'Text',icon:'T',action:function(){notesTransformBlock(blockId,'text');}},
      {label:'Heading 1',icon:'H1',action:function(){notesTransformBlock(blockId,'h1');}},
      {label:'Heading 2',icon:'H2',action:function(){notesTransformBlock(blockId,'h2');}},
      {label:'Heading 3',icon:'H3',action:function(){notesTransformBlock(blockId,'h3');}},
      {label:'Heading 4',icon:'H4',action:function(){notesTransformBlock(blockId,'h4');}},
      {label:'Page',icon:'◇',action:function(){notesTransformBlock(blockId,'page');}},
      {label:'Page in',icon:'↳',submenu:function(){var arr=notesPages.slice(0,100).map(function(p){return {label:p.title||'Untitled',icon:p.icon||'◇',iconColor:p.iconColor||'default',action:function(){notesTransformBlockToPageIn(blockId,p.id);}};});return arr.length?arr:[{label:'No pages',disabled:true}];}},
      {type:'sep'},
      {label:'Bulleted list',icon:'•',action:function(){notesTransformBlock(blockId,'bulleted');}},
      {label:'Numbered list',icon:'1.',action:function(){notesTransformBlock(blockId,'numbered');}},
      {label:'To-do list',icon:'☑',action:function(){notesTransformBlock(blockId,'todo');}},
      {label:'Toggle list',icon:'▾',action:function(){notesTransformBlock(blockId,'toggle');}},
      {label:'Code',icon:'</>',action:function(){notesTransformBlock(blockId,'code');}},
      {label:'Quote',icon:'❝',action:function(){notesTransformBlock(blockId,'quote');}},
      {label:'Callout',icon:'💡',action:function(){notesTransformBlock(blockId,'callout');}},
      {label:'Block equation',icon:'∑',action:function(){notesTransformBlock(blockId,'equation');}},
      {label:'Synced block',icon:'↻',action:function(){notesTransformBlock(blockId,'synced');}},
      {label:'Divider',icon:'—',action:function(){notesTransformBlock(blockId,'divider');}},
      {label:'Table',icon:'▦',action:function(){notesTransformBlock(blockId,'table');}},
      {label:'Database Table',icon:'▦',action:function(){notesTransformBlock(blockId,'database');}},
      {type:'sep'},
      {label:'Toggle heading 1',icon:'▾H1',action:function(){notesTransformBlock(blockId,'toggleh1');}},
      {label:'Toggle heading 2',icon:'▾H2',action:function(){notesTransformBlock(blockId,'toggleh2');}},
      {label:'Toggle heading 3',icon:'▾H3',action:function(){notesTransformBlock(blockId,'toggleh3');}},
      {label:'Toggle heading 4',icon:'▾H4',action:function(){notesTransformBlock(blockId,'toggleh4');}},
      {label:'2 columns',icon:'▥',action:function(){notesTransformBlock(blockId,'columns2');}},
      {label:'3 columns',icon:'▥',action:function(){notesTransformBlock(blockId,'columns3');}},
      {label:'4 columns',icon:'▥',action:function(){notesTransformBlock(blockId,'columns4');}},
      {label:'5 columns',icon:'▥',action:function(){notesTransformBlock(blockId,'columns5');}}
    ];
  }

  function notesInsertMenuItems(afterId) {
    function ins(type){return function(){notesInsertBlock(type,afterId);};}
    return [
      {type:'label',label:'Basic blocks'},
      {label:'Text',icon:'T',action:ins('text')},{label:'Heading 1',icon:'H1',action:ins('h1')},{label:'Heading 2',icon:'H2',action:ins('h2')},{label:'Heading 3',icon:'H3',action:ins('h3')},{label:'Heading 4',icon:'H4',action:ins('h4')},
      {type:'sep'},{label:'Bulleted list',icon:'•',action:ins('bulleted')},{label:'Numbered list',icon:'1.',action:ins('numbered')},{label:'To-do list',icon:'☑',action:ins('todo')},{label:'Toggle list',icon:'▾',action:ins('toggle')},{label:'Toggle heading 1',icon:'▾H1',action:ins('toggleh1')},{label:'Toggle heading 2',icon:'▾H2',action:ins('toggleh2')},{label:'Toggle heading 3',icon:'▾H3',action:ins('toggleh3')},{label:'Toggle heading 4',icon:'▾H4',action:ins('toggleh4')},
      {type:'sep'},{label:'Code',icon:'</>',action:ins('code')},{label:'Quote',icon:'❝',action:ins('quote')},{label:'Callout',icon:'💡',action:ins('callout')},{label:'Block equation',icon:'∑',action:ins('equation')},{label:'Synced block',icon:'↻',action:ins('synced')},{label:'Divider',icon:'—',action:ins('divider')},{label:'Table',icon:'▦',action:ins('table')},{label:'Database Table',icon:'▦',action:ins('database')},{label:'Page',icon:'◇',action:ins('page')},
      {type:'label',label:'Layout'},{label:'2 columns',icon:'▥',action:ins('columns2')},{label:'3 columns',icon:'▥',action:ins('columns3')},{label:'4 columns',icon:'▥',action:ins('columns4')},{label:'5 columns',icon:'▥',action:ins('columns5')}
    ];
  }

  function notesOpenInsertMenu(anchor,afterId) { notesOpenMenu(anchor,notesInsertMenuItems(afterId),{search:true,searchPlaceholder:'Search blocks…',wide:true}); }

  function notesColorMenuItems(block) {
    var textItems=[{type:'label',label:'Text color'}];
    Object.keys(NOTES_TEXT_COLORS).forEach(function(k){textItems.push({label:k==='default'?'Default text':k.charAt(0).toUpperCase()+k.slice(1)+' text',swatch:k==='default'?'#c6c9cf':NOTES_TEXT_COLORS[k],action:function(){notesUpdateBlock(block.id,function(b){b.color=k;});notesRenderBlocks();}});});
    textItems.push({type:'sep'},{type:'label',label:'Background'});
    Object.keys(NOTES_BG_COLORS).forEach(function(k){textItems.push({label:k==='default'?'Default background':k.charAt(0).toUpperCase()+k.slice(1)+' background',swatch:k==='default'?'rgba(255,255,255,.03)':NOTES_BG_COLORS[k],action:function(){notesUpdateBlock(block.id,function(b){b.background=k;});notesRenderBlocks();}});});
    return textItems;
  }

  function notesLanguageMenu(block) { return NOTES_LANGUAGES.map(function(lang){return {label:lang,icon:block.language===lang?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.language=lang;});notesRenderBlocks();}};}); }
  function notesMoveToMenu(block) { var items=[];notesPages.filter(function(p){return p.id!==notesActivePageId;}).slice(0,100).forEach(function(p){items.push({label:p.title||'Untitled',icon:p.icon||'◇',iconColor:p.iconColor||'default',action:function(){notesMoveBlockToPage(block.id,p.id);}});});return items.length?items:[{label:'No other pages',icon:'',disabled:true}]; }

  function notesOpenBlockMenu(block,anchor) {
    var items=[];
    if(block.type==='code') {
      items.push({label:block.caption?'Hide caption':'Caption',icon:'▤',action:function(){notesUpdateBlock(block.id,function(b){b.caption=b.caption?'':' ';});notesRenderBlocks();if(!block.caption)requestAnimationFrame(function(){var c=document.querySelector('.notes-block[data-id="'+block.id+'"] .notes-code-caption');if(c){c.textContent='';c.focus();}});}});
      items.push({label:'Copy code',icon:'⧉',action:function(){notesCopyText(block.text||'');notesToast('Code copied');}});
      items.push({label:(block.wrap?'Disable':'Enable')+' wrap code',icon:'↵',action:function(){notesUpdateBlock(block.id,function(b){b.wrap=!b.wrap;});notesRenderBlocks();}});
      items.push({label:'Language',icon:'{}',submenu:function(){return notesLanguageMenu(block);}});items.push({type:'sep'});
    }
    if(block.type==='synced')items.push({label:'Unsync',icon:'↯',action:function(){notesUpdateBlock(block.id,function(b){b.type='text';delete b.syncKey;});notesRenderBlocks();}});
    if(block.type==='quote')items.push({label:'Quote size',icon:'❝',submenu:[{label:'Small',icon:block.quoteSize==='small'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.quoteSize='small';});notesRenderBlocks();}},{label:'Large',icon:block.quoteSize==='large'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.quoteSize='large';});notesRenderBlocks();}}]});
    if(block.type==='database'){
      var dbLayout=block.view&&block.view.layout==='compact'?'compact':'full';
      var dbFont=block.view&&block.view.fontSize&&NotesDatabase.FONT_SIZES[block.view.fontSize]?block.view.fontSize:'default';
      items.push({label:'Table width',icon:'line:columns-3',submenu:[{label:'Full width',icon:dbLayout==='full'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.layout='full';});notesRenderBlocks();}},{label:'Compact',icon:dbLayout==='compact'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.layout='compact';});notesRenderBlocks();}}]});
      items.push({label:'Table font size',icon:'line:type',submenu:[
        {label:'Small · 12px',icon:dbFont==='small'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.fontSize='small';});notesRenderBlocks();}},
        {label:'Default · 15px',icon:dbFont==='default'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.fontSize='default';});notesRenderBlocks();}},
        {label:'Large · 17px',icon:dbFont==='large'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.fontSize='large';});notesRenderBlocks();}},
        {label:'Extra large · 19px',icon:dbFont==='xlarge'?'✓':'',action:function(){notesUpdateBlock(block.id,function(b){b.view=b.view||{};b.view.fontSize='xlarge';});notesRenderBlocks();}}
      ]});
      items.push({type:'sep'});
    }
    if(!notesShareMode)items.push({label:'Add image',icon:'line:image',action:function(){notesPickImages(block.id);}});
    if(!notesStructuredBlock(block.type))items.push({label:'Turn into',icon:'↻',submenu:function(){return notesTypeMenuItems(block.id);},submenuWide:true});
    items.push({label:'Color',icon:'◉',submenu:function(){return notesColorMenuItems(block);},submenuWide:true});
    if(block.type==='callout')items.push({label:'Edit icon',icon:block.icon||'💡',iconColor:block.iconColor||'default',action:function(){setTimeout(function(){notesOpenIconPicker(anchor,{value:block.icon||'💡',type:block.iconType||'emoji',color:block.iconColor||'default'},function(pick){notesUpdateBlock(block.id,function(b){b.icon=pick.value||'💡';b.iconType=pick.type||'emoji';b.iconColor=pick.color||'default';});notesRenderBlocks();});},0);}});
    items.push({type:'sep'});
    items.push({label:'Copy link to block',icon:'↗',action:function(){notesCopyBlockLink(block);}});
    items.push({label:'Duplicate',icon:'⧉',hotkey:'Ctrl+D',action:function(){notesDuplicateBlock(block.id);}});
    items.push({label:'Move up',icon:'↑',hotkey:'Alt+Shift+↑',action:function(){notesMoveBlockStep(block.id,-1);}});
    items.push({label:'Move down',icon:'↓',hotkey:'Alt+Shift+↓',action:function(){notesMoveBlockStep(block.id,1);}});
    items.push({label:'Move to',icon:'→',submenu:function(){return notesMoveToMenu(block);}});
    items.push({label:'Delete',icon:'×',danger:true,action:function(){var row=document.querySelector('#notesBlocks .notes-block[data-id="'+block.id+'"]');notesAnimateOut(row,function(){notesDeleteBlock(block.id);});}});
    notesOpenMenu(anchor,items,{search:true,searchPlaceholder:'Search actions…',wide:true});
  }

  function notesOpenPageMenu(page,anchor) {
    var items=[
      {label:'Open in new tab',icon:'+',action:function(){notesTabsAdd({kind:'page',pageId:page.id});}},
      {label:'Rename',icon:'✎',action:function(){notesRenamePageInline(page.id);}},
      {label:'Add subpage',icon:'+',action:function(){notesAddPage(page.id);}},
      {label:'Change icon',icon:page.icon||'◇',iconColor:page.iconColor||'default',action:function(){setTimeout(function(){notesOpenIconPicker(anchor,{value:page.icon||'',type:page.iconType||'emoji',color:page.iconColor||'default'},function(pick){page.icon=pick.value||'';page.iconType=pick.type||'emoji';page.iconColor=pick.color||'default';notesRender();notesScheduleSave();});},0);}},
      {type:'sep'},
      {label:'Duplicate',icon:'⧉',action:function(){notesDuplicatePage(page.id);}},
      {label:'Delete',icon:'×',danger:true,action:function(){notesDeletePage(page.id);}}
    ];notesOpenMenu(anchor,items,{wide:false});
  }

  function notesOpenIconPicker(anchor,current,onPick) {
    onPick=notesBound(onPick);
    current=current&&typeof current==='object'?current:{value:String(current||''),type:'emoji',color:'default'};
    current.type=current.type==='icon'?'icon':'emoji';current.color=notesSafeColor(current.color||'default',NOTES_ICON_COLORS);
    var layer=notesEnsureMenuLayer();if(!layer)return;var r=anchor.getBoundingClientRect();var panel=document.createElement('div');panel.className='notes-menu notes-icon-picker';
    var tabs=document.createElement('div');tabs.className='notes-icon-picker-tabs';
    var emojiTab=document.createElement('button');emojiTab.type='button';emojiTab.textContent='Emoji';
    var iconTab=document.createElement('button');iconTab.type='button';iconTab.textContent='Icons';
    tabs.appendChild(emojiTab);tabs.appendChild(iconTab);panel.appendChild(tabs);
    var body=document.createElement('div');body.className='notes-icon-picker-body';panel.appendChild(body);
    var search=document.createElement('input');search.type='search';search.className='notes-picker-search';search.placeholder='Search or paste an emoji…';search.setAttribute('aria-label','Search emoji and icons');if(current.type==='icon')notesLoadLineIcons();panel.insertBefore(search,body);
    var footer=document.createElement('div');footer.className='notes-icon-picker-footer';var rm=document.createElement('button');rm.type='button';rm.className='notes-menu-item';rm.innerHTML='<span class="notes-menu-icon">×</span><span class="notes-menu-text">Remove icon</span>';rm.addEventListener('click',function(){notesCloseMenus();onPick({value:'',type:'emoji',color:'default'});});footer.appendChild(rm);panel.appendChild(footer);
    var active=current.type,filter='';
    function choose(value,type,color){closeColorPop();notesCloseMenus();onPick({value:value,type:type,color:color||'default'});}
    var iconGridColor='default';var colorPop=null;
    // Notion-style: clicking an icon opens a small popover previewing it in every colour.
    function closeColorPop(){if(colorPop&&colorPop.parentNode)colorPop.parentNode.removeChild(colorPop);colorPop=null;var sel=body.querySelector('.notes-icon-btn.pop-open');if(sel)sel.classList.remove('pop-open');}
    function openColorPop(btn,value){
      var reopen=colorPop&&colorPop._btn===btn;closeColorPop();if(reopen)return;
      btn.classList.add('pop-open');colorPop=document.createElement('div');colorPop.className='notes-icon-color-pop';colorPop._btn=btn;
      Object.keys(NOTES_ICON_COLORS).forEach(function(key){var c=document.createElement('button');c.type='button';c.className='notes-icon-btn notes-icon-color-opt'+(current.type==='icon'&&current.value===value&&current.color===key?' selected':'');c.title=key.charAt(0).toUpperCase()+key.slice(1);c.setAttribute('aria-label',c.title);
        if(value.indexOf('line:')===0)notesPaintIcon(c,value,'icon',key);else{c.classList.add('notes-symbol-icon');c.textContent=value;c.style.color=NOTES_ICON_COLORS[key];}
        c.addEventListener('click',function(e){e.stopPropagation();choose(value,'icon',key);});colorPop.appendChild(c);});
      colorPop.addEventListener('mousedown',function(e){e.stopPropagation();});
      layer.appendChild(colorPop);
      var br=btn.getBoundingClientRect(),w=colorPop.offsetWidth,h=colorPop.offsetHeight,pad=8;
      var x=br.left+br.width/2-w/2,y=br.bottom+4;
      if(y+h>window.innerHeight-pad)y=br.top-h-4;
      x=Math.max(pad,Math.min(x,window.innerWidth-pad-w));y=Math.max(pad,y);
      colorPop.style.left=Math.round(x)+'px';colorPop.style.top=Math.round(y)+'px';
    }
    panel.addEventListener('mousedown',function(e){if(e.target&&e.target.closest&&e.target.closest('.pop-open'))return;closeColorPop();});
    body.addEventListener('scroll',function(){closeColorPop();},{passive:true});
    function notesEmojiMatches(em,group){
      if(!filter)return true;
      if(em.indexOf(filter)>=0||group.toLocaleLowerCase().indexOf(filter)>=0)return true;
      return Object.keys(NOTES_EMOJI_ALIASES).some(function(alias){return alias.indexOf(filter)>=0&&NOTES_EMOJI_ALIASES[alias].split(' ').indexOf(em)>=0;});
    }
    function render(){
      closeColorPop();emojiTab.classList.toggle('active',active==='emoji');iconTab.classList.toggle('active',active==='icon');body.innerHTML='';
      body.onscroll=null;
      if(active==='emoji'){
        var found=false,shown={},foundCount=0;
        Object.keys(NOTES_EMOJI_SECTIONS).forEach(function(group){
          var entries=NOTES_EMOJI_SECTIONS[group].filter(function(em){return !shown[em]&&notesEmojiMatches(em,group);});
          entries.forEach(function(em){shown[em]=true;});
          if(!entries.length)return;found=true;foundCount+=entries.length;
          var lab=document.createElement('div');lab.className='notes-menu-label';lab.textContent=group;body.appendChild(lab);
          var grid=document.createElement('div');grid.className='notes-emoji-grid';body.appendChild(grid);
          var count=0,more=document.createElement('button');more.type='button';more.className='notes-picker-more';
          function append(){
            entries.slice(count,count+160).forEach(function(em){var b=document.createElement('button');b.type='button';b.className='notes-emoji-btn'+(current.type==='emoji'&&current.value===em?' selected':'');b.textContent=em;b.title=em;b.setAttribute('aria-label',em);b.addEventListener('click',function(){choose(em,'emoji','default');});grid.appendChild(b);});
            count=Math.min(count+160,entries.length);more.textContent='Show more';more.style.display=count<entries.length?'block':'none';
          }
          more.addEventListener('click',append);append();body.appendChild(more);
        });
        var validEmoji=false;try{validEmoji=new RegExp('\\p{Extended_Pictographic}','u').test(search.value);}catch(_){}
        if(filter && !found && validEmoji){var custom=document.createElement('button');custom.type='button';custom.className='notes-picker-custom';custom.textContent='Use “'+search.value.trim()+'” as emoji';custom.addEventListener('click',function(){choose(notesClampText(search.value.trim(),32),'emoji','default');});body.appendChild(custom);}
        else if(filter&&!found){var empty=document.createElement('div');empty.className='notes-search-empty';empty.textContent='No matching emojis';body.appendChild(empty);}
        emojiTab.textContent='Emoji';
      }else{
        if(notesLineIconsState!=='ready'){
          if(notesLineIconsState==='error')notesLineIconsState='idle';
          var loading=document.createElement('div');loading.className='notes-search-empty';loading.textContent='Loading icons…';body.appendChild(loading);
          notesLoadLineIcons(function(ok){if(!panel.isConnected||active!=='icon')return;if(ok)render();else loading.textContent='Could not load icons. Check the connection and reopen the picker.';});
        }else{
          var terms=filter.split(/\s+/).filter(Boolean);
          var icons=NOTES_LINE_ICON_LIST.filter(function(it){if(!terms.length)return true;var hay=it[0]+' '+it[1]+' '+it[2];return terms.every(function(t){return hay.indexOf(t)>=0;});});
          if(terms.length){var rank=function(it){var i=it[0].indexOf(terms[0]);return it[0]===terms[0]?0:i===0?1:i>0?2:3;};icons=icons.map(function(it,i){return [rank(it),i,it];}).sort(function(x,y){return x[0]-y[0]||x[1]-y[1];}).map(function(x){return x[2];});}
          if(icons.length){
            var selectedLine=current.type==='icon'&&typeof current.value==='string'&&current.value.indexOf('line:')===0?'line:'+notesLineIconName(current.value.slice(5)):'';
            var lineLab=document.createElement('div');lineLab.className='notes-menu-label';lineLab.textContent=terms.length?'Results · '+icons.length:'Icons · '+icons.length;body.appendChild(lineLab);
            var lines=document.createElement('div');lines.className='notes-icon-grid';body.appendChild(lines);
            var shown=0,moreIcons=document.createElement('button');moreIcons.type='button';moreIcons.className='notes-picker-more';
            var appendIcons=function(){
              icons.slice(shown,shown+192).forEach(function(it){var value='line:'+it[0];var b=document.createElement('button');b.type='button';b.className='notes-icon-btn'+(selectedLine===value?' selected':'');b.title=it[0].replace(/-/g,' ');b.setAttribute('aria-label',b.title);notesPaintIcon(b,value,'icon',iconGridColor);b.addEventListener('click',function(e){e.stopPropagation();openColorPop(b,value);});lines.appendChild(b);});
              shown=Math.min(shown+192,icons.length);moreIcons.textContent='Show more ('+(icons.length-shown)+')';moreIcons.style.display=shown<icons.length?'block':'none';
            };
            moreIcons.addEventListener('click',function(e){e.stopPropagation();appendIcons();});appendIcons();body.appendChild(moreIcons);
            // Render in chunks: the next batch appears as you scroll to the bottom.
            body.onscroll=function(){if(active==='icon'&&shown<icons.length&&body.scrollTop+body.clientHeight>body.scrollHeight-160)appendIcons();};
          }else{var none=document.createElement('div');none.className='notes-search-empty';none.textContent='No matching icons';body.appendChild(none);}
        }
      }
      notesPlacePanel(panel,r.left,r.bottom+6,{anchorTop:r.top});
    }
    emojiTab.addEventListener('click',function(){active='emoji';render();});iconTab.addEventListener('click',function(){active='icon';render();});
    search.addEventListener('input',function(){filter=search.value.trim().toLocaleLowerCase();render();});
    search.addEventListener('keydown',function(e){if(e.key==='Escape'){if(colorPop){e.preventDefault();closeColorPop();return;}notesCloseMenus();return;}if(e.key==='Enter'&&active==='emoji'&&filter&&!body.querySelector('.notes-emoji-btn')){e.preventDefault();choose(notesClampText(search.value.trim(),32),'emoji','default');}});
    layer.appendChild(panel);notesMenuPanels=[panel];render();notesPlacePanel(panel,r.left,r.bottom+6,{anchorTop:r.top});
  }

  function notesCompressCover(file, crop) {
    crop = crop || {x:.5,y:.5,zoom:1};
    return new Promise(function(resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w=img.naturalWidth,h=img.naturalHeight;if(!w||!h){reject(new Error('empty'));return;}
        var maxW=2400, attempt=0;
        function encode(){
          var ratio=5, cw=Math.max(1,maxW), ch=Math.max(1,Math.round(cw/ratio));
          var baseScale=Math.max(cw/w,ch/h), scale=baseScale*Math.max(1,Math.min(3,Number(crop.zoom)||1));
          var srcW=Math.min(w,cw/scale),srcH=Math.min(h,ch/scale);
          var maxX=Math.max(0,w-srcW),maxY=Math.max(0,h-srcH);
          var sx=maxX*Math.max(0,Math.min(1,Number(crop.x)||0));
          var sy=maxY*Math.max(0,Math.min(1,Number(crop.y)||0));
          var c=document.createElement('canvas');c.width=cw;c.height=ch;
          var ctx=c.getContext('2d');ctx.fillStyle='#0c0f14';ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          ctx.drawImage(img,sx,sy,srcW,srcH,0,0,cw,ch);
          var q=.94,data=c.toDataURL('image/webp',q);
          // Some browsers may not encode WebP; gracefully fall back to JPEG.
          var fmt=data.indexOf('data:image/webp')===0?'image/webp':'image/jpeg';
          if(fmt==='image/jpeg') data=c.toDataURL('image/jpeg',q);
          while(data.length>NOTES_COVER_MAX_CHARS&&q>.84){q-=.02;data=c.toDataURL(fmt,q);}
          if(data.length>NOTES_COVER_MAX_CHARS&&attempt<3){attempt++;maxW=Math.round(maxW*.90);encode();return;}
          if(!notesValidCoverImage(data)){reject(new Error('too large'));return;}resolve(data);
        }encode();
      };
      img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('decode'));};img.src=url;
    });
  }
  function notesOpenCoverCropper(page,file){
    if(!page||!file)return;
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)){notesToast('Use a JPG, PNG or WebP image');return;}
    if(file.size>15*1024*1024){notesToast('Image is too big (max 15 MB)');return;}
    var url=URL.createObjectURL(file),overlay=document.createElement('div');overlay.className='notes-cover-crop-overlay';
    var modal=document.createElement('div');modal.className='notes-cover-crop-modal';
    modal.innerHTML='<div class="notes-cover-crop-title">Position cover</div><div class="notes-cover-crop-sub">This preview matches the saved cover exactly</div><div class="notes-cover-crop-frame"><canvas></canvas><div class="notes-cover-crop-gridline h1"></div><div class="notes-cover-crop-gridline h2"></div><div class="notes-cover-crop-gridline v1"></div><div class="notes-cover-crop-gridline v2"></div></div><div class="notes-cover-crop-controls"><span>Zoom</span><input type="range" min="100" max="300" value="100"><button type="button" class="notes-cover-crop-reset">Reset</button><button type="button" class="notes-cover-crop-cancel">Cancel</button><button type="button" class="notes-cover-crop-apply">Apply</button></div>';
    overlay.appendChild(modal);document.body.appendChild(overlay);
    var frame=modal.querySelector('.notes-cover-crop-frame'),canvas=modal.querySelector('canvas'),range=modal.querySelector('input'),ctx=canvas.getContext('2d');
    var source=new Image(),x=.5,y=.5,zoom=1,drag=false,lastX=0,lastY=0,ready=false;
    function metrics(){
      var w=source.naturalWidth||1,h=source.naturalHeight||1,r=frame.getBoundingClientRect(),cw=Math.max(1,r.width),ch=Math.max(1,r.height);
      var baseScale=Math.max(cw/w,ch/h),scale=baseScale*zoom,srcW=Math.min(w,cw/scale),srcH=Math.min(h,ch/scale);
      return {w:w,h:h,cw:cw,ch:ch,srcW:srcW,srcH:srcH,maxX:Math.max(0,w-srcW),maxY:Math.max(0,h-srcH)};
    }
    function render(){if(!ready)return;var m=metrics(),dpr=Math.min(2,window.devicePixelRatio||1),pw=Math.round(m.cw*dpr),ph=Math.round(m.ch*dpr);if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}var sx=m.maxX*x,sy=m.maxY*y;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,m.cw,m.ch);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,sx,sy,m.srcW,m.srcH,0,0,m.cw,m.ch);}
    function close(){URL.revokeObjectURL(url);window.removeEventListener('resize',render);overlay.remove();}
    source.onload=function(){ready=true;render();};source.src=url;
    frame.addEventListener('pointerdown',function(e){if(!ready)return;drag=true;lastX=e.clientX;lastY=e.clientY;frame.setPointerCapture(e.pointerId);frame.classList.add('dragging');});
    frame.addEventListener('pointermove',function(e){if(!drag||!ready)return;var m=metrics(),dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;if(m.maxX>0)x=Math.max(0,Math.min(1,x-dx/m.cw*(m.srcW/m.maxX)));if(m.maxY>0)y=Math.max(0,Math.min(1,y-dy/m.ch*(m.srcH/m.maxY)));render();});
    function stop(){drag=false;frame.classList.remove('dragging');}frame.addEventListener('pointerup',stop);frame.addEventListener('pointercancel',stop);
    range.addEventListener('input',function(){zoom=Number(range.value)/100;render();});
    modal.querySelector('.notes-cover-crop-reset').onclick=function(){x=.5;y=.5;zoom=1;range.value='100';render();};
    modal.querySelector('.notes-cover-crop-cancel').onclick=close;
    overlay.addEventListener('mousedown',function(e){if(e.target===overlay){if(notesIsMobile()&&modal._notesMobileDismiss)modal._notesMobileDismiss();else close();}});
    window.addEventListener('resize',render);
    modal.querySelector('.notes-cover-crop-apply').onclick=function(){var apply=this;apply.disabled=true;apply.textContent='Saving…';notesCompressCover(file,{x:x,y:y,zoom:zoom}).then(function(data){if(!notesPageById(page.id)){close();return;}page.cover='image';page.coverImage=data;notesRender();notesScheduleSave();close();notesToast('Cover updated');}).catch(function(){apply.disabled=false;apply.textContent='Apply';notesToast('Could not process this image');});};
  }
  function notesApplyCoverFile(page,file){ notesOpenCoverCropper(page,file); }
  function notesCoverUploadEntry(panel, page) {
    var sep = document.createElement('div'); sep.className = 'notes-cover-sep'; panel.appendChild(sep);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'notes-menu-item notes-cover-upload-entry';
    btn.innerHTML = '<span class="notes-menu-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg></span><span class="notes-menu-text">Add image</span>';
    btn.addEventListener('click', function(e) { e.stopPropagation(); notesShowCoverUpload(panel, page); });
    panel.appendChild(btn);
  }
  function notesShowCoverUpload(panel, page) {
    panel.innerHTML = '';
    var head = document.createElement('div'); head.className = 'notes-cover-upload-head';
    var back = document.createElement('button'); back.type = 'button'; back.className = 'notes-cover-upload-back'; back.title = 'Back'; back.setAttribute('aria-label','Back');
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    var t = document.createElement('div'); t.className = 'notes-menu-label'; t.textContent = 'Upload cover image';
    head.appendChild(back); head.appendChild(t); panel.appendChild(head);
    var hint = document.createElement('div'); hint.className = 'notes-cover-upload-hint';
    hint.innerHTML = '<b>Best fit: 1500 × 300 px</b> (wide, about 5:1).<br>JPG, PNG or WebP, up to 15 MB. The picture is centred and cropped to the cover strip, so keep the important part in the middle.';
    panel.appendChild(hint);
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.style.display = 'none';
    var drop = document.createElement('button'); drop.type = 'button'; drop.className = 'notes-cover-drop';
    drop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg><span class="notes-cover-drop-main">Click to choose a file</span><span class="notes-cover-drop-sub">or drag and drop it here</span>';
    drop.addEventListener('click', function(e) { e.stopPropagation(); input.click(); });
    input.addEventListener('change', function() { var f = input.files && input.files[0]; notesCloseMenus(); notesApplyCoverFile(page, f); });
    ['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('dragging'); }); });
    ['dragleave','dragend'].forEach(function(ev){ drop.addEventListener(ev, function(){ drop.classList.remove('dragging'); }); });
    drop.addEventListener('drop', function(e) { e.preventDefault(); drop.classList.remove('dragging'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; notesCloseMenus(); notesApplyCoverFile(page, f); });
    back.addEventListener('click', function(e) { e.stopPropagation(); var a = document.getElementById('notesAddCoverBtn'); notesCloseMenus(); if (a) notesOpenCoverPicker(a); });
    panel.appendChild(drop); panel.appendChild(input);
    var pr = panel.getBoundingClientRect(); notesPlacePanel(panel, pr.left, pr.top);
  }
  function notesOpenCoverPicker(anchor) {
    var page=notesCurrentPage();if(!page)return;var layer=notesEnsureMenuLayer();if(!layer)return;var r=anchor.getBoundingClientRect();var panel=document.createElement('div');panel.className='notes-menu notes-menu-wide';var lab=document.createElement('div');lab.className='notes-menu-label';lab.textContent='Cover';panel.appendChild(lab);var grid=document.createElement('div');grid.className='notes-cover-grid';['graphite','ember','forest','ocean','violet','gold'].forEach(function(name){var b=document.createElement('button');b.type='button';b.className='notes-cover-option';b.dataset.cover=name;b.title=name;b.addEventListener('click',function(){notesCloseMenus();page.cover=name;page.coverImage='';notesRender();notesScheduleSave();});grid.appendChild(b);});panel.appendChild(grid);notesCoverUploadEntry(panel,page);if(page.cover){var rm=document.createElement('button');rm.type='button';rm.className='notes-menu-item';rm.innerHTML='<span class="notes-menu-icon">×</span><span class="notes-menu-text">Remove cover</span>';rm.addEventListener('click',function(){notesCloseMenus();notesRemoveCover(page);});panel.appendChild(rm);}layer.appendChild(panel);notesMenuPanels=[panel];notesPlacePanel(panel,r.left,r.bottom+5);
  }

  function notesCommandCatalog(blockId) {
    return [
      {label:'Text',icon:'T',type:'text'},{label:'Heading 1',icon:'H1',type:'h1'},{label:'Heading 2',icon:'H2',type:'h2'},{label:'Heading 3',icon:'H3',type:'h3'},{label:'Heading 4',icon:'H4',type:'h4'},
      {label:'Bulleted list',icon:'•',type:'bulleted'},{label:'Numbered list',icon:'1.',type:'numbered'},{label:'To-do list',icon:'☑',type:'todo'},{label:'Toggle list',icon:'▾',type:'toggle'},{label:'Toggle heading 1',icon:'▾H1',type:'toggleh1'},{label:'Toggle heading 2',icon:'▾H2',type:'toggleh2'},{label:'Toggle heading 3',icon:'▾H3',type:'toggleh3'},{label:'Toggle heading 4',icon:'▾H4',type:'toggleh4'},
      {label:'Code',icon:'</>',type:'code'},{label:'Quote',icon:'❝',type:'quote'},{label:'Callout',icon:'💡',type:'callout'},{label:'Block equation',icon:'∑',type:'equation'},{label:'Synced block',icon:'↻',type:'synced'},{label:'Divider',icon:'—',type:'divider'},{label:'Table',icon:'▦',type:'table'},{label:'Database Table',icon:'▦',type:'database'},{label:'Page',icon:'◇',type:'page'},
      {label:'2 columns',icon:'▥',type:'columns2'},{label:'3 columns',icon:'▥',type:'columns3'},{label:'4 columns',icon:'▥',type:'columns4'},{label:'5 columns',icon:'▥',type:'columns5'}
    ].filter(function(x){return !notesRowScope||!['database','synced','page'].includes(x.type);}).map(function(x){x.blockId=blockId;return x;});
  }

  function notesSetSyncedAwareText(block,value) {
    if(block.type==='synced'&&block.syncKey){notesPages.forEach(function(pg){pg.blocks.forEach(function(b){if(b.type==='synced'&&b.syncKey===block.syncKey)b.text=value;});});}
    else block.text=value;
  }

  function notesMaybeSlashMenu(blockId,el) {
    var text=notesReadEditable(el);if(text.charAt(0)!=='/'||text.indexOf('\n')>=0){if(notesCommandState&&notesCommandState.blockId===blockId)notesCloseMenus();return;}
    var query=text.slice(1).trim().toLowerCase();var all=notesCommandCatalog(blockId);var filtered=all.filter(function(x){return !query||x.label.toLowerCase().indexOf(query)>=0||x.type.indexOf(query)>=0;}).slice(0,12);if(!filtered.length){if(notesCommandState&&notesCommandState.blockId===blockId)notesCloseMenus();return;}
    var wasOpen=!!(notesCommandState&&notesCommandState.blockId===blockId);var layer=notesEnsureMenuLayer();if(!layer)return;var rect=el.getBoundingClientRect();var items=filtered.map(function(cmd){return {label:cmd.label,icon:cmd.icon,action:function(){var b=notesBlockById(blockId);if(!b)return;notesSetSyncedAwareText(b,'');if(b.type===cmd.type){notesRenderBlocks();notesScheduleSave();notesFocusBlock(blockId);return;}notesTransformBlock(blockId,cmd.type);}};});var panel=notesBuildMenuPanel(items,rect.left,rect.bottom+4,{wide:true,place:{anchorTop:rect.top}},0);if(wasOpen&&panel)panel.style.animation='none';notesCommandState={blockId:blockId,panel:panel,items:items,index:0};notesCommandPaint();
  }

  function notesMaybePageLinkMenu(blockId,el) {
    if(notesRowScope)return;
    var text=notesReadEditable(el),m=text.match(/^\[\[([^\]\n]*)$/);
    if(!m){if(notesCommandState&&notesCommandState.blockId===blockId)notesCloseMenus();return;}
    var query=m[1].trim().toLocaleLowerCase();
    var matches=notesPages.filter(function(p){return p.id!==notesActivePageId&&(!query||(p.title||'').toLocaleLowerCase().indexOf(query)>=0);}).slice(0,12);
    if(!matches.length){if(notesCommandState&&notesCommandState.blockId===blockId)notesCloseMenus();return;}
    var rect=el.getBoundingClientRect(),layer=notesEnsureMenuLayer();if(!layer)return;
    var items=matches.map(function(p){return {label:p.title||'Untitled',icon:p.icon||'◇',iconColor:p.iconColor||'default',action:function(){
      var block=notesBlockById(blockId);if(!block)return;block.type='page';block.text=p.title||'Untitled';block.linkedPageId=p.id;
      notesRenderBlocks();notesScheduleSave();
    }};});
    var panel=notesBuildMenuPanel(items,rect.left,rect.bottom+4,{wide:true,place:{anchorTop:rect.top}},0);
    notesCommandState={blockId:blockId,panel:panel,items:items,index:0};notesCommandPaint();
  }

  function notesCommandPaint() {
    if(!notesCommandState||!notesCommandState.panel)return;var buttons=notesCommandState.panel.querySelectorAll('.notes-menu-item');Array.prototype.forEach.call(buttons,function(b,i){b.classList.toggle('keyboard-active',i===notesCommandState.index);});var active=buttons[notesCommandState.index];if(active)active.scrollIntoView({block:'nearest'});
  }
  function notesCommandStep(delta) { if(!notesCommandState)return;var n=notesCommandState.items.length;if(!n)return;notesCommandState.index=(notesCommandState.index+delta+n)%n;notesCommandPaint(); }
  function notesCommandChoose() { if(!notesCommandState)return;var item=notesCommandState.items[notesCommandState.index];if(!item)return;var action=item.action;notesCloseMenus();if(action)action(); }

  /* ---------- Event wiring ---------- */
  var openBtn=document.getElementById('openNotesWorkspaceBtn');if(openBtn)openBtn.addEventListener('click',function(e){e.stopPropagation();enterNotesWorkspace();});
  var exitBtn=document.getElementById('exitNotesWorkspaceBtn');if(exitBtn)exitBtn.addEventListener('click',function(){exitNotesWorkspace(false);});
  var newBtn=document.getElementById('notesNewPageBtn');if(newBtn)newBtn.addEventListener('click',function(){notesAddPage(null);});
  var pageSettingsBtn=document.getElementById('notesPageSettingsBtn');if(pageSettingsBtn)pageSettingsBtn.addEventListener('click',function(e){e.stopPropagation();notesOpenSharePanel(pageSettingsBtn);});
  var emptyBtn=document.getElementById('notesEmptyCreateBtn');if(emptyBtn)emptyBtn.addEventListener('click',function(){notesAddPage(null);});
  var addText=document.getElementById('notesAddTextBtn');if(addText)addText.addEventListener('click',function(){var p=notesCurrentPage();notesInsertBlock('text',p&&p.blocks.length?p.blocks[p.blocks.length-1].id:null);});
  var pageSearch=document.getElementById('notesPageSearch');if(pageSearch){
    pageSearch.addEventListener('input',notesRenderSidebar);
    pageSearch.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();pageSearch.value='';notesRenderSidebar();pageSearch.blur();}else if(e.key==='Enter'){var first=document.querySelector('#notesPagesList .notes-search-result');if(first){e.preventDefault();first.click();}}});
  }

  var title=document.getElementById('notesPageTitle');if(title){
    title.addEventListener('input',function(){var p=notesCurrentPage();if(!p)return;p.title=notesClampText(title.value||'Untitled',160);notesRenderSidebar();notesRenderBreadcrumb(p);notesScheduleSave();});
    title.addEventListener('blur',function(){var p=notesCurrentPage();if(p&&!p.title.trim()){p.title='Untitled';title.value=p.title;notesRenderSidebar();notesScheduleSave();}});
    title.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var p=notesCurrentPage();if(p&&p.blocks.length)notesFocusBlock(p.blocks[0].id);}});
  }

  var addIcon=document.getElementById('notesAddIconBtn');if(addIcon)addIcon.addEventListener('click',function(){var p=notesCurrentPage();if(p)notesOpenIconPicker(addIcon,{value:p.icon||'',type:p.iconType||'emoji',color:p.iconColor||'default'},function(pick){p.icon=pick.value||'';p.iconType=pick.type||'emoji';p.iconColor=pick.color||'default';notesRender();notesScheduleSave();});});
  var bigIcon=document.getElementById('notesPageIconButton');if(bigIcon)bigIcon.addEventListener('click',function(){var p=notesCurrentPage();if(p)notesOpenIconPicker(bigIcon,{value:p.icon||'',type:p.iconType||'emoji',color:p.iconColor||'default'},function(pick){p.icon=pick.value||'';p.iconType=pick.type||'emoji';p.iconColor=pick.color||'default';notesRender();notesScheduleSave();});});
  var addCover=document.getElementById('notesAddCoverBtn');if(addCover)addCover.addEventListener('click',function(){notesOpenCoverPicker(addCover);});
  var changeCover=document.getElementById('notesChangeCoverBtn');if(changeCover)changeCover.addEventListener('click',function(){notesOpenCoverPicker(changeCover);});
  var removeCover=document.getElementById('notesRemoveCoverBtn');if(removeCover)removeCover.addEventListener('click',function(){notesRemoveCover(notesCurrentPage());});
  var toggleComments=document.getElementById('notesToggleCommentsBtn');if(toggleComments)toggleComments.addEventListener('click',function(){var p=document.getElementById('notesCommentsPanel');if(p)notesSetCommentsOpen(p.style.display==='none');});

  var addComment=document.getElementById('notesAddCommentBtn');if(addComment)addComment.addEventListener('click',notesAddComment);
  var ciSync=document.getElementById('notesCommentInput');if(ciSync)ciSync.addEventListener('input',notesSyncCommentSend);
  var mention=document.getElementById('notesMentionBtn');if(mention)mention.addEventListener('click',function(){var i=document.getElementById('notesCommentInput');if(!i)return;var v=i.value;i.value=v+(v&&!/\s$/.test(v)?' @':'@');i.focus();notesSyncCommentSend();});
  var commentInput=document.getElementById('notesCommentInput');if(commentInput)commentInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();notesAddComment();}});

  /* v3.22 mobile: phones fire height-only resizes (keyboard, URL bar); they must not close menus or exit Notes. */
  var notesMobileResizeWidth=window.innerWidth;
  window.addEventListener('load',function(){notesMobileResizeWidth=window.innerWidth;});
  window.addEventListener('resize',function(){if(notesShareMode)return;if(document.body.classList.contains('mobile-mode')){if(window.innerWidth===notesMobileResizeWidth)return;notesMobileResizeWidth=window.innerWidth;}else notesMobileResizeWidth=window.innerWidth;if(notesWorkspaceMode&&window.innerWidth<=760&&!document.body.classList.contains('mobile-mode'))exitNotesWorkspace(true);else if(document.getElementById('notesMenuLayer')&&document.getElementById('notesMenuLayer').classList.contains('open'))notesCloseMenus();});
  ['deviceMobileBtn'].forEach(function(id){var b=document.getElementById(id);if(b)b.addEventListener('click',function(){if(notesWorkspaceMode)setTimeout(function(){exitNotesWorkspace(true);},0);});});
  document.addEventListener('keydown',function(e){
    if(!notesWorkspaceMode)return;
    if(notesShareMode){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(pageSearch){pageSearch.focus();pageSearch.select();}}return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(pageSearch){pageSearch.focus();pageSearch.select();}return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){
      var focus=e.target.closest&&e.target.closest('.notes-block');if(focus){e.preventDefault();notesDuplicateBlock(focus.dataset.id);return;}
    }
    if(e.altKey&&e.shiftKey&&!notesCommandState&&(e.key==='ArrowUp'||e.key==='ArrowDown')){
      var mv=e.target.closest&&e.target.closest('.notes-block');if(mv){e.preventDefault();notesMoveBlockStep(mv.dataset.id,e.key==='ArrowUp'?-1:1);return;}
    }
    /* Escape is intentionally not a Notes shortcut. It must never kick the
       user back to the main space while they are editing. */
  });

  var adminSelect=document.getElementById('adminUserSelect');if(adminSelect)adminSelect.addEventListener('change',function(){notesSave();notesResetForOwnerSwitch();if(notesWorkspaceMode)notesLoad(true);});

  // Paste as plain text: rich HTML from the web/Notion used to land in the DOM and vanish after re-render.
  var notesWs=document.getElementById('notesWorkspace');
  if(notesWs){
    notesWs.addEventListener('paste',function(e){
      var clip=e.clipboardData||window.clipboardData;
      var blockEl=e.target&&e.target.closest&&e.target.closest('#notesBlocks .notes-block');
      var imageFile=null;
      if(clip&&clip.items){
        for(var pi=0;pi<clip.items.length;pi++){if(clip.items[pi].kind==='file'&&/^image\//.test(clip.items[pi].type)){imageFile=clip.items[pi].getAsFile();break;}}
      }
      if(imageFile&&blockEl){e.preventDefault();notesInsertPastedImage(imageFile,blockEl.dataset.id);return;}
      var ed=e.target&&e.target.closest&&e.target.closest('[contenteditable="true"]');if(!ed)return;
      var text=clip?clip.getData('text/plain'):'';e.preventDefault();
      if(!text)return;text=text.replace(/\r\n?/g,'\n');
      if(!document.execCommand||!document.execCommand('insertText',false,text)){var sel=window.getSelection();if(sel&&sel.rangeCount){var r=sel.getRangeAt(0);r.deleteContents();r.insertNode(document.createTextNode(text));r.collapse(false);}ed.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    notesWs.addEventListener('drop',function(e){if((notesDraggedPageId||notesDraggedBlockId)&&e.target.closest&&e.target.closest('[contenteditable="true"],textarea,input'))e.preventDefault();},true);
  }
  // Flush on tab hide/close so the last keystrokes reach the cloud.
  window.addEventListener('pagehide',function(){notesSave();});
  window.addEventListener('resize',function(){if(notesWorkspaceMode)notesPositionActivePill();});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')notesSave();});
  window.addEventListener('hashchange',function(){if(notesWorkspaceMode)notesApplyHashTarget();});
  /* ---------- v3.12: Ctrl + LMB marquee selection, Delete/Backspace removes selected blocks ---------- */
  (function(){
    var wrap=document.getElementById('notesPageWrap');if(!wrap)return;
    var selected={};var drag=null;var box=null;var scrollRaf=0;
    function rows(){return Array.prototype.slice.call(document.querySelectorAll('#notesBlocks .notes-block'));}
    function selectedRows(){return rows().filter(function(r){return r.classList.contains('notes-selected')&&selected[r.dataset.id];});}
    function clearSel(){selected={};rows().forEach(function(r){r.classList.remove('notes-selected');});}
    function setRow(r,on){if(on){selected[r.dataset.id]=true;r.classList.add('notes-selected');}else{delete selected[r.dataset.id];r.classList.remove('notes-selected');}}
    function point(e){var wr=wrap.getBoundingClientRect();return {x:e.clientX-wr.left+wrap.scrollLeft,y:e.clientY-wr.top+wrap.scrollTop};}
    function update(){
      if(!drag)return;
      var x1=Math.min(drag.sx,drag.cx),y1=Math.min(drag.sy,drag.cy),x2=Math.max(drag.sx,drag.cx),y2=Math.max(drag.sy,drag.cy);
      if(!drag.moved&&(x2-x1>4||y2-y1>4)){drag.moved=true;box=document.createElement('div');box.className='notes-marquee';wrap.appendChild(box);}
      if(!drag.moved)return;
      box.style.left=x1+'px';box.style.top=y1+'px';box.style.width=(x2-x1)+'px';box.style.height=(y2-y1)+'px';
      var wr=wrap.getBoundingClientRect();
      var cl=x1-wrap.scrollLeft+wr.left,ct=y1-wrap.scrollTop+wr.top,cr=x2-wrap.scrollLeft+wr.left,cb=y2-wrap.scrollTop+wr.top;
      rows().forEach(function(r){var b=r.getBoundingClientRect();var hit=b.right>cl&&b.left<cr&&b.bottom>ct&&b.top<cb;setRow(r,hit||!!drag.base[r.dataset.id]);});
    }
    function autoScroll(){
      scrollRaf=0;if(!drag||drag.lastY==null)return;
      var wr=wrap.getBoundingClientRect(),edge=48,dy=0;
      if(drag.lastY<wr.top+edge)dy=-Math.ceil((wr.top+edge-drag.lastY)/4);else if(drag.lastY>wr.bottom-edge)dy=Math.ceil((drag.lastY-(wr.bottom-edge))/4);
      if(dy){var before=wrap.scrollTop;wrap.scrollTop+=dy;drag.cy+=wrap.scrollTop-before;update();}
      scrollRaf=requestAnimationFrame(autoScroll);
    }
    wrap.addEventListener('mousedown',function(e){
      if(e.button!==0||notesShareMode)return;
      if(!(e.ctrlKey||e.metaKey)){
        if(Object.keys(selected).length&&!(e.target.closest&&e.target.closest('.notes-block-tools')))clearSel();
        return;
      }
      if(!notesCurrentPage())return;
      e.preventDefault();
      if(document.activeElement&&wrap.contains(document.activeElement))document.activeElement.blur();
      var sel=window.getSelection&&window.getSelection();if(sel&&sel.removeAllRanges)sel.removeAllRanges();
      var p=point(e);
      drag={sx:p.x,sy:p.y,cx:p.x,cy:p.y,moved:false,lastY:e.clientY,base:Object.assign({},selected),startRow:e.target.closest&&e.target.closest('#notesBlocks .notes-block')};
      document.body.classList.add('notes-marquee-active');
      if(!scrollRaf)scrollRaf=requestAnimationFrame(autoScroll);
    });
    document.addEventListener('mousemove',function(e){if(!drag)return;var p=point(e);drag.cx=p.x;drag.cy=p.y;drag.lastY=e.clientY;update();});
    document.addEventListener('mouseup',function(){
      if(!drag)return;
      if(!drag.moved&&drag.startRow)setRow(drag.startRow,!selected[drag.startRow.dataset.id]); // Ctrl+click toggles one block
      if(box&&box.parentNode)box.parentNode.removeChild(box);box=null;
      if(scrollRaf)cancelAnimationFrame(scrollRaf);scrollRaf=0;
      drag=null;document.body.classList.remove('notes-marquee-active');
    });
    document.addEventListener('keydown',function(e){
      if(!notesWorkspaceMode||notesShareMode)return;
      var live=selectedRows();if(!live.length){selected={};return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();clearSel();return;}
      if(e.key!=='Delete'&&e.key!=='Backspace')return;
      var ae=document.activeElement;if(ae&&(ae.isContentEditable||ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&!live.some(function(r){return r.contains(ae);})&&!wrap.contains(ae))return;
      e.preventDefault();e.stopPropagation();
      var page=notesCurrentPage();if(!page){clearSel();return;}
      notesHistoryBreak();var snapBefore=notesHistorySnap();
      var ids={};live.forEach(function(r){ids[r.dataset.id]=true;});
      var before=page.blocks.length;
      page.blocks=page.blocks.filter(function(b){return !ids[b.id];});
      var removed=before-page.blocks.length;
      if(!page.blocks.length)page.blocks.push(notesDefaultBlock('text'));
      selected={};notesRenderBlocks();notesScheduleSave();
      if(removed)notesUndoToast(removed===1?'Block deleted':removed+' blocks deleted',snapBefore);
    },true);
  })();

  /* ---------- v3.13: Undo / redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) ----------
     Snapshot history of the whole workspace. Typing is grouped: one undo step per pause (~700ms). */
  function notesHistorySnap() { return { context:notesHistoryContext(), pages: JSON.stringify(notesPages), groups: JSON.stringify(notesGroups), active: notesActivePageId }; }
  function notesHistoryReset() {
    clearTimeout(notesHist.timer); notesHist.undo=[]; notesHist.redo=[]; notesHist.open=false;
    notesHist.base = notesShareMode ? null : notesHistorySnap();
    if (!notesShareMode) setTimeout(notesOffloadImages, 1500);
  }
  function notesHistoryBreak() {
    // Close the current typing group so the next change becomes its own step.
    if (notesHist.applying || notesShareMode) return;
    clearTimeout(notesHist.timer);
    if (notesHist.open) { notesHist.open=false; }
    notesHist.base = notesHistorySnap();
  }
  function notesHistoryRecord() {
    if (notesHist.applying || notesShareMode) return;
    if (!notesHist.base) { notesHist.base = notesHistorySnap(); return; }
    if (!notesHist.open) {
      if (JSON.stringify(notesPages) === notesHist.base.pages && JSON.stringify(notesGroups) === notesHist.base.groups) return;
      notesHist.undo.push(notesHist.base); if (notesHist.undo.length > 120) notesHist.undo.shift();
      notesHist.redo = []; notesHist.open = true;
    }
    clearTimeout(notesHist.timer);
    var historyContext=notesHistoryContext();notesHist.timer = setTimeout(function(){ notesHist.open=false; notesHist.base=notesHistorySnap();notesHist.base.context=historyContext; }, 700);
  }
  function notesHistoryApply(snap) {
    notesRowScope=null;notesRowTransaction=null;
    var tokens = {}; notesPages.forEach(function(p){ if (p.shareToken) tokens[p.id] = p.shareToken; });
    var pages; try { pages = JSON.parse(snap.pages); } catch (_) { return; }
    pages.forEach(function(p){ p.shareToken = tokens[p.id] || ''; });   // sharing is not part of undo
    notesHist.applying = true;
    try {
      notesPages = pages;
      if (snap.groups) { try { notesGroups = notesNormalizeGroups(JSON.parse(snap.groups)); } catch (_) {} }
      notesEnsurePageGroups();
      notesActivePageId = notesPageById(snap.active) ? snap.active : notesActivePageId;
      notesPickActivePage(); notesRender(); notesScheduleSave();
    } finally { notesHist.applying = false; }
    notesHist.base = notesHistorySnap();
  }
  function notesUndo() {
    if(notesMobileLoading)return false;
    notesHistoryBreak();
    if (!notesHist.undo.length) { notesToast('Nothing to undo'); return false; }
    if(!notesHistoryCanApply(notesHist.undo[notesHist.undo.length-1]))return false;
    notesHist.redo.push(notesHistorySnap()); notesHistoryApply(notesHist.undo.pop()); return true;
  }
  function notesRedo() {
    if(notesMobileLoading)return false;
    notesHistoryBreak();
    if (!notesHist.redo.length) { notesToast('Nothing to redo'); return false; }
    if(!notesHistoryCanApply(notesHist.redo[notesHist.redo.length-1]))return false;
    notesHist.undo.push(notesHistorySnap()); notesHistoryApply(notesHist.redo.pop()); return true;
  }
  document.addEventListener('keydown', function(e){
    if (!notesWorkspaceMode || notesShareMode || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = String(e.key||'').toLowerCase(); var code = e.code;
    var isZ = k === 'z' || k === 'я' || code === 'KeyZ', isY = k === 'y' || k === 'н' || code === 'KeyY';
    if (!isZ && !isY) return;
    var t = e.target;
    // Comment box and sidebar search keep the browser's own undo.
    if (t && t.tagName === 'INPUT' && t.id !== 'notesPageTitle') return;
    if (t && t.closest && t.closest('.notes-menu-layer')) return;
    var ws = document.getElementById('notesWorkspace'); if (ws && t && t !== document.body && !ws.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    if (isY || (isZ && e.shiftKey)) notesRedo(); else notesUndo();
  }, true);

  /* ---------- v3.13: site confirm dialog (replaces window.confirm) ---------- */
  function notesConfirm(opts, onOk) {
    opts = opts || {};
    var old = document.getElementById('notesConfirmOverlay'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var ov = document.createElement('div'); ov.className = 'notes-confirm-overlay'; ov.id = 'notesConfirmOverlay';
    var box = document.createElement('div'); box.className = 'notes-confirm'; box.setAttribute('role','alertdialog'); box.setAttribute('aria-modal','true');
    var h = document.createElement('div'); h.className = 'notes-confirm-title'; h.textContent = opts.title || 'Are you sure?';
    var p = document.createElement('div'); p.className = 'notes-confirm-text'; p.textContent = opts.text || '';
    var row = document.createElement('div'); row.className = 'notes-confirm-actions';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'notes-confirm-btn'; cancel.textContent = opts.cancel || 'Cancel';
    var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'notes-confirm-btn primary' + (opts.danger ? ' danger' : ''); ok.textContent = opts.confirm || 'OK';
    row.appendChild(cancel); row.appendChild(ok); box.appendChild(h); if (opts.text) box.appendChild(p); box.appendChild(row); ov.appendChild(box);
    document.body.appendChild(ov);
    var prevFocus = document.activeElement, closed = false;
    function close(confirmed) {
      if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true);
      ov.classList.remove('open'); ov.classList.add('closing');
      setTimeout(function(){ if (ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
      if (confirmed) { if (onOk) onOk(); } else if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll:true }); } catch (_) {} }
    }
    function onKey(e) {
      if(notesIsMobile()&&e.target.closest&&e.target.closest('.notes-mobile-sheet-handle')&&e.key==='Enter')return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', function(){ close(false); });
    ok.addEventListener('click', function(){ close(true); });
    ov.addEventListener('mousedown', function(e){ if (e.target === ov){if(notesIsMobile()&&box._notesMobileDismiss)box._notesMobileDismiss();else close(false);} });
    requestAnimationFrame(function(){ ov.classList.add('open'); ok.focus({ preventScroll:true }); });
  }

  /* ---------- v3.13: "Deleted · Undo · countdown" toast ---------- */
  var notesUndoToastState = null;
  function notesUndoToast(message, snapBefore, seconds) {
    seconds = seconds || 8;
    var st = notesUndoToastState; if (st) { clearInterval(st.tick); clearTimeout(st.hide); if (st.el.parentNode) st.el.parentNode.removeChild(st.el); }
    var el = document.createElement('div'); el.className = 'notes-undo-toast';
    var R = 8, C = 2 * Math.PI * R;
    el.innerHTML = '<span class="notes-undo-ring"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="'+R+'" class="bg"/><circle cx="10" cy="10" r="'+R+'" class="fg" style="stroke-dasharray:'+C+';stroke-dashoffset:0"/></svg><b></b></span><span class="notes-undo-text"></span><button type="button" class="notes-undo-btn">Undo</button><button type="button" class="notes-undo-close" aria-label="Close">×</button>';
    el.querySelector('.notes-undo-text').textContent = message + ' permanently';
    document.body.appendChild(el);
    var num = el.querySelector('b'), fg = el.querySelector('.fg'), started = Date.now(), total = seconds * 1000, done = false;
    var state = { el:el, tick:null, hide:null }; notesUndoToastState = state;
    function paint() {
      var left = Math.max(0, total - (Date.now() - started));
      num.textContent = Math.ceil(left / 1000);
      fg.style.strokeDashoffset = String(C * (1 - left / total));
      if (left <= 0) finish(false);
    }
    function finish(undone) {
      if (done) return; done = true; clearInterval(state.tick);
      if (undone) el.querySelector('.notes-undo-text').textContent = 'Restored';
      else el.querySelector('.notes-undo-text').textContent = message.replace(/ deleted$/,'') + ' deleted forever';
      el.classList.add('finished');
      state.hide = setTimeout(function(){ el.classList.remove('show'); setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); if (notesUndoToastState === state) notesUndoToastState = null; }, 260); }, undone ? 900 : 1400);
    }
    el.querySelector('.notes-undo-btn').addEventListener('click', function(){
      if (done) return;
      notesHistoryBreak(); notesHist.undo.push(notesHistorySnap()); notesHist.redo = [];
      notesHistoryApply(snapBefore); finish(true);
    });
    el.querySelector('.notes-undo-close').addEventListener('click', function(){ finish(false); });
    state.tick = setInterval(paint, 100); paint();
    requestAnimationFrame(function(){ el.classList.add('show'); });
  }

  /* ---------- v3.13: public read-only share links ----------
     Firestore: notesShares/{token} = { uid, owner, rootId, pages:[root + all subpages], updatedAt }.
     The snapshot is refreshed on every save, so the link always shows the latest version. */
  function notesShareToken() {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', out = '', arr = new Uint32Array(24);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) out += abc[arr[i] % abc.length];
    return out;
  }
  function notesShareUrl(token) { return String(location.href).split(/[?#]/)[0] + '?note=' + encodeURIComponent(token); }
  function notesShareSubtree(page) {
    var ids = [page.id].concat(notesDescendantIds(page.id)), set = {}; ids.forEach(function(id){ set[id] = true; });
    return ids.map(notesPageById).filter(Boolean).map(function(p){
      var c = notesClone(p); delete c.shareToken; c.collapsed = false;
      if (p.id === page.id) c.parentId = null;
      return c;
    });
  }
  function notesAuthUid() { try { var u = firebase.auth().currentUser; return u ? u.uid : null; } catch (_) { return null; } }
  // Serialize mutations per token: a late publish must never undo a disable.
  var notesShareQueues=Object.create(null),notesShareOwners=Object.create(null),notesShareRevoking=Object.create(null),notesShareOperations=Object.create(null),notesShareErrors=Object.create(null);
  function notesShareDeletionList(owner,uid){
    try{var list=JSON.parse(localStorage.getItem('tj_share_deletions:'+JSON.stringify([uid,owner]))||'[]');return Array.isArray(list)?list.filter(function(t){return typeof t==='string'&&/^[A-Za-z0-9]{16,64}$/.test(t);}):[];}catch(_){return [];}
  }
  function notesShareDeletionStore(owner,uid,list){
    try{var key='tj_share_deletions:'+JSON.stringify([uid,owner]);if(list.length)localStorage.setItem(key,JSON.stringify(list));else localStorage.removeItem(key);}catch(_){}
  }
  function notesRememberShareDeletion(token,owner,uid){
    if(!owner||!uid)return;
    notesShareOwners[token]={owner:owner,uid:uid};if(!(token in notesShareCache))notesShareCache[token]=null;
    var list=notesShareDeletionList(owner,uid);if(list.indexOf(token)<0){list.push(token);notesShareDeletionStore(owner,uid,list);}
  }
  function notesShareContextValid(page,owner,uid){
    return !notesShareMode&&!!uid&&notesAuthUid()===uid&&notesLoadedFor===owner&&notesOwner()===owner&&notesPageById(page.id)===page;
  }
  function notesShareQueue(token,task){
    var job=(notesShareQueues[token]||Promise.resolve()).catch(function(){}).then(task);
    notesShareQueues[token]=job;
    function clean(){if(notesShareQueues[token]===job)delete notesShareQueues[token];}
    job.then(clean,clean);return job;
  }
  function notesWriteShare(page,ownerKey,force,candidate){
    var uid=notesAuthUid(),owner=ownerKey||notesLoadedFor,token=candidate||(page&&page.shareToken);
    if(!page||!token||typeof db==='undefined'||!notesShareContextValid(page,owner,uid)||notesShareRevoking[token])return Promise.resolve(false);
    var pages=notesShareSubtree(page),json=JSON.stringify(pages);
    var payload={uid:uid,owner:owner,rootId:page.id,title:page.title||'Untitled',pages:pages,updatedAt:Date.now()};
    if(notesJsonBytes(payload)>NOTES_CLOUD_LIMIT){notesShareErrors[token]='Shared page is too large to publish. Reduce its size and retry.';notesToast('Shared page is too large to publish');return Promise.resolve(false);}
    return notesShareQueue(token,function(){
      if(!notesShareContextValid(page,owner,uid)||notesShareRevoking[token]||(!candidate&&page.shareToken!==token))return false;
      if(!force&&notesShareCache[token]===json)return true;
      var ref=db.collection('notesShares').doc(token);
      // Updating an existing link must not recreate a document revoked elsewhere.
      return (candidate?ref.set(payload):ref.update(payload)).then(function(){
        notesShareCache[token]=json;notesShareOwners[token]={owner:owner,uid:uid};delete notesShareErrors[token];return true;
      });
    }).catch(function(err){console.error('Share publish failed:',err);notesShareErrors[token]='The latest changes were not published. The link may show an older version.';if(!candidate&&notesShareContextValid(page,owner,uid))notesToast('Could not update the public link. Retry in Share page.');return false;});
  }
  function notesDeleteShare(token,owner,uid,stillAllowed){
    notesShareRevoking[token]=true;
    return notesShareQueue(token,function(){
      if(notesAuthUid()!==uid||notesOwner()!==owner||!stillAllowed())return false;
      return db.collection('notesShares').doc(token).delete().then(function(){
        notesShareDeletionStore(owner,uid,notesShareDeletionList(owner,uid).filter(function(t){return t!==token;}));
        delete notesShareCache[token];delete notesShareOwners[token];delete notesShareErrors[token];return true;
      });
    }).catch(function(err){console.error('Share disable failed:',err);return false;}).then(function(ok){delete notesShareRevoking[token];return ok;});
  }
  function notesSyncShares(ownerKey){
    if(notesShareMode||!notesLoadedRemote||notesMobileLoading||notesCloudIncomplete||notesLoadedFor!==ownerKey||notesOwner()!==ownerKey)return;
    var uid=notesAuthUid(),live={};if(!uid)return;
    notesPages.forEach(function(p){if(p.shareToken){live[p.shareToken]=true;notesWriteShare(p,ownerKey,false);}});
    notesShareDeletionList(ownerKey,uid).forEach(function(token){
      if(live[token])notesShareDeletionStore(ownerKey,uid,notesShareDeletionList(ownerKey,uid).filter(function(t){return t!==token;}));
      else{notesShareOwners[token]={owner:ownerKey,uid:uid};if(!(token in notesShareCache))notesShareCache[token]=null;}
    });
    Object.keys(notesShareCache).forEach(function(token){
      var scope=notesShareOwners[token];
      if(live[token]||notesShareRevoking[token]||!scope||scope.owner!==ownerKey||scope.uid!==uid)return;
      // Failed deletion stays in the cache and is retried on the next save.
      notesDeleteShare(token,ownerKey,uid,function(){return notesLoadedFor===ownerKey&&!notesPages.some(function(p){return p.shareToken===token;});});
    });
  }
  function notesShareOperationKey(page,owner,uid){return JSON.stringify([uid,owner,page.id]);}
  function notesCommitShareState(){
    notesHist.applying=true;try{notesScheduleSave();}finally{notesHist.applying=false;}
    notesHist.base=notesHistorySnap();notesSave();
  }
  function notesGenerateShare(page,owner){
    var uid=notesAuthUid(),key=notesShareOperationKey(page,owner,uid),pending=notesShareOperations[key];
    if(pending)return pending.promise;
    if(!notesLoadedRemote||notesMobileLoading||notesCloudIncomplete||!notesShareContextValid(page,owner,uid))return Promise.resolve(false);
    if(page.shareToken)return Promise.resolve(true);
    var token;try{token=notesShareToken();}catch(err){notesToast('Could not generate a secure link');return Promise.resolve(false);}
    var state={kind:'generate'};notesShareOperations[key]=state;
    state.promise=notesWriteShare(page,owner,true,token).then(function(ok){
      if(!ok)return false;
      if(!notesShareContextValid(page,owner,uid)){
        // A page/account changed while publishing. Never attach the result to
        // the new workspace; retain its scope if cleanup must wait for login.
        notesRememberShareDeletion(token,owner,uid);
        return notesDeleteShare(token,owner,uid,function(){return true;}).then(function(){return false;});
      }
      page.shareToken=token;notesCommitShareState();return true;
    }).catch(function(err){console.error('Share generation failed:',err);return false;}).then(function(ok){
      if(notesShareOperations[key]===state)delete notesShareOperations[key];return ok;
    });
    return state.promise;
  }
  function notesDisableShare(page,owner){
    var uid=notesAuthUid(),key=notesShareOperationKey(page,owner,uid),pending=notesShareOperations[key];
    if(pending)return pending.promise;
    if(!page.shareToken||!notesShareContextValid(page,owner,uid))return Promise.resolve(false);
    var token=page.shareToken,state={kind:'disable'};notesShareOperations[key]=state;
    state.promise=notesDeleteShare(token,owner,uid,function(){return notesShareContextValid(page,owner,uid)&&page.shareToken===token;}).then(function(ok){
      if(ok&&notesShareContextValid(page,owner,uid)&&page.shareToken===token){page.shareToken='';notesCommitShareState();}
      return ok;
    }).catch(function(err){console.error('Could not save disabled-link state:',err);return false;}).then(function(ok){
      if(notesShareOperations[key]===state)delete notesShareOperations[key];return ok;
    });return state.promise;
  }
  function notesCopyShareLink(text){
    function fallback(){
      var area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(area);
      var previous=document.activeElement,ok=false;
      try{area.select();ok=!!document.execCommand('copy');}catch(_){}
      area.remove();if(previous&&previous.isConnected)previous.focus({preventScroll:true});return ok;
    }
    try{if(navigator.clipboard&&navigator.clipboard.writeText)return Promise.resolve(navigator.clipboard.writeText(text)).then(function(){return true;},fallback);}catch(_){}
    return Promise.resolve(fallback());
  }
  function notesOpenSharePanel(anchor){
    var page=notesCurrentPage(),owner=notesLoadedFor,uid=notesAuthUid();
    if(!page){notesToast('Open a page first');return;}
    if(!notesShareContextValid(page,owner,uid)){notesToast('Sign in to share this page');return;}
    var layer=notesEnsureMenuLayer();if(!layer)return;
    var panel=document.createElement('div');panel.className='notes-menu notes-share-panel';panel.dataset.depth=0;
    var key=notesShareOperationKey(page,owner,uid),message='',observed=null,verifying=!!page.shareToken&&!notesShareOperations[key];
    function valid(){return notesShareContextValid(page,owner,uid);}
    function visible(){return panel.isConnected&&valid()&&notesActivePageId===page.id;}
    function draw(){
      if(!valid())return;
      panel.innerHTML='';
      var head=document.createElement('div');head.className='notes-share-head';
      head.innerHTML='<div class="notes-share-title">Share page</div><div class="notes-share-sub"></div>';
      head.querySelector('.notes-share-sub').textContent='Anyone with the link can view “'+(page.title||'Untitled')+'” and its subpages. Read only.';panel.appendChild(head);
      if(verifying){var checking=document.createElement('button');checking.type='button';checking.className='notes-share-primary';checking.disabled=true;checking.textContent='Checking link…';panel.appendChild(checking);return;}
      var operation=notesShareOperations[key];
      if(operation){
        var busy=document.createElement('button');busy.type='button';busy.className='notes-share-primary';busy.disabled=true;busy.textContent=operation.kind==='disable'?'Disabling…':'Generating…';panel.appendChild(busy);
        if(observed!==operation){observed=operation;operation.promise.then(function(){if(visible())draw();});}
        return;
      }
      if(message){var status=document.createElement('div');status.className='notes-share-sub';status.setAttribute('role','status');status.textContent=message;panel.appendChild(status);}
      if(!page.shareToken){
        var gen=document.createElement('button');gen.type='button';gen.className='notes-share-primary';gen.textContent='Generate link';
        gen.addEventListener('click',function(){
          if(!valid()||notesShareOperations[key])return;
          message='';var promise=notesGenerateShare(page,owner);draw();
          promise.then(function(ok){
            if(!visible())return;
            if(!ok){message='Could not create the link. Check your connection and try again.';draw();return;}
            notesCopyShareLink(notesShareUrl(page.shareToken)).then(function(copied){if(visible()){message=copied?'Link created and copied.':'Link created. Select the URL below to copy it manually.';draw();}});
          });
        });panel.appendChild(gen);
      }else{
        if(notesShareErrors[page.shareToken]){
          var warning=document.createElement('div');warning.className='notes-share-sub';warning.setAttribute('role','status');warning.textContent=notesShareErrors[page.shareToken];panel.appendChild(warning);
          var retry=document.createElement('button');retry.type='button';retry.className='notes-share-primary';retry.textContent='Retry update';
          retry.addEventListener('click',function(){if(!valid())return;retry.disabled=true;retry.textContent='Updating…';notesWriteShare(page,owner,true).then(function(ok){if(visible()){message=ok?'Public link updated.':'';draw();}});});panel.appendChild(retry);
        }
        var row=document.createElement('div');row.className='notes-share-row';
        var inp=document.createElement('input');inp.type='text';inp.readOnly=true;inp.className='notes-share-input';inp.setAttribute('aria-label','Public Notes link');inp.value=notesShareUrl(page.shareToken);inp.addEventListener('focus',function(){inp.select();});
        var copy=document.createElement('button');copy.type='button';copy.className='notes-share-copy';copy.textContent='Copy';
        copy.addEventListener('click',function(){copy.disabled=true;notesCopyShareLink(inp.value).then(function(ok){if(!visible())return;copy.disabled=false;copy.textContent=ok?'Copied':'Copy';if(!ok){inp.focus();inp.select();notesToast('Select the link and copy it manually');}else setTimeout(function(){if(copy.isConnected)copy.textContent='Copy';},1200);});});
        row.appendChild(inp);row.appendChild(copy);panel.appendChild(row);
        var foot=document.createElement('div');foot.className='notes-share-foot';
        var open=document.createElement('a');open.href=inp.value;open.target='_blank';open.rel='noopener noreferrer';open.textContent='Open preview ↗';
        var off=document.createElement('button');off.type='button';off.className='notes-share-off';off.textContent='Disable link';
        off.addEventListener('click',function(){
          if(!valid()||notesShareOperations[key])return;
          message='';var promise=notesDisableShare(page,owner);draw();promise.then(function(ok){if(!visible())return;message=ok?'Link disabled.':'Could not disable the link. It may still be accessible; try again.';draw();});
        });foot.appendChild(open);foot.appendChild(off);panel.appendChild(foot);
      }
    }
    draw();layer.appendChild(panel);notesMenuPanels[0]=panel;
    var r=anchor.getBoundingClientRect();notesPlacePanel(panel,r.right-panel.offsetWidth,r.bottom+6,{anchorTop:r.top});
    if(verifying){
      var checkedToken=page.shareToken;
      db.collection('notesShares').doc(checkedToken).get({source:'server'}).then(function(snap){
        if(!valid()||page.shareToken!==checkedToken)return;
        if(!snap.exists){page.shareToken='';delete notesShareCache[checkedToken];delete notesShareOwners[checkedToken];delete notesShareErrors[checkedToken];notesCommitShareState();message='This link was disabled. You can generate a new one.';}
      }).catch(function(){message='Could not verify this link. Check your connection.';}).then(function(){verifying=false;if(visible())draw();});
    }
  }


  /* ---------- v3.13: public viewer (?note=TOKEN) ---------- */
  function notesStartShareView(token) {
    notesTabsReset();
    notesShareMode = true;
    document.body.classList.add('notes-share-mode', 'notes-workspace-mode');
    document.body.classList.remove('mobile-mode');
    var login = document.getElementById('loginScreen'); if (login) login.style.display = 'none';
    var app = document.getElementById('appRoot'); if (app) app.style.display = 'block';
    var ws = document.getElementById('notesWorkspace'); if (ws) ws.setAttribute('aria-hidden', 'false');
    notesWorkspaceMode = true; notesLoadedFor = null; notesLoadedRemote = false;
    var empty = document.getElementById('notesEmptyState');
    function showEmpty(title, sub) {
      notesPages = []; notesActivePageId = null; notesRender();
      if (empty) { empty.querySelector('.notes-empty-title').textContent = title; empty.querySelector('.notes-empty-sub').textContent = sub; }
    }
    showEmpty('Loading…', 'Opening shared notes');
    notesSetState('');
    // Lock every editable surface, including ones created by later re-renders.
    function lock(root) {
      Array.prototype.forEach.call(root.querySelectorAll('[contenteditable="true"]'), function(n){ n.setAttribute('contenteditable', 'false'); });
      Array.prototype.forEach.call(root.querySelectorAll('input:not(#notesPageSearch),textarea'), function(n){ n.readOnly = true; if (n.type === 'checkbox') n.disabled = true; });
      Array.prototype.forEach.call(root.querySelectorAll('[draggable="true"]'), function(n){ n.draggable = false; });
      Array.prototype.forEach.call(root.querySelectorAll('select'), function(n){ n.disabled = true; });
    }
    if (ws && window.MutationObserver) new MutationObserver(function(){ lock(ws); }).observe(ws, { childList:true, subtree:true, attributes:true, attributeFilter:['contenteditable','draggable'] });
    var BLOCKED = '.notes-block-tools,.notes-page-more,.notes-new-page,.notes-back-btn,#notesPageQuickActions,.notes-add-block,.notes-page-icon-large,.notes-cover-actions,.notes-comment-compose,.notes-comment-delete,.notes-table-actions,.notes-code-more,#notesPageSettingsBtn,#notesEmptyCreateBtn,.notes-todo-check,.notes-sidebar';
    ['click','mousedown','dblclick','contextmenu'].forEach(function(type){
      document.addEventListener(type, function(e){ if (e.target && e.target.closest && e.target.closest(BLOCKED)) { e.preventDefault(); e.stopPropagation(); } }, true);
    });
    ['beforeinput','paste','cut','drop','dragstart'].forEach(function(type){
      document.addEventListener(type, function(e){ if (e.target && e.target.id === 'notesPageSearch') return; e.preventDefault(); e.stopPropagation(); }, true);
    });
    if (typeof db === 'undefined') { showEmpty('Link unavailable', 'Could not connect. Try again later.'); return; }
    db.collection('notesShares').doc(token).get({source:'server'}).then(function(snap){
      if (!snap.exists) { showEmpty('Link unavailable', 'This link was disabled or the page was deleted.'); return; }
      var data = snap.data() || {};
      notesPages = notesNormalizePages(data.pages);
      if (!notesPages.length) { showEmpty('Link unavailable', 'This page is empty.'); return; }
      notesActivePageId = notesPageById(data.rootId) ? data.rootId : notesPages[0].id;
      notesHistoryReset(); notesRender(); lock(ws); notesApplyHashTarget();
      document.title = (notesPageById(notesActivePageId).title || 'Notes') + ' · Notes';
      requestAnimationFrame(notesPositionActivePill);
    }).catch(function(err){ console.error('Share load failed:', err); showEmpty('Link unavailable', 'Could not verify this link. Check your connection and try again.'); });
  }
  (function(){
    var token = null; try { token = new URLSearchParams(location.search).get('note'); } catch (_) {}
    if (token && /^[A-Za-z0-9]{16,64}$/.test(token)) notesStartShareView(token);
  })();

  /* Mobile sheet gestures use explicit dismissal callbacks so existing cleanup survives. */
  (function notesMobileSheets(){
    var selector='.notes-menu,.ndb-popup,.notes-confirm,.notes-cover-crop-modal';
    function attach(panel){
      if(!notesIsMobile()||panel.querySelector(':scope > .notes-mobile-sheet-handle'))return;
      panel.classList.add('notes-mobile-sheet');
      var handle=document.createElement('button');handle.type='button';handle.className='notes-mobile-sheet-handle';
      handle.setAttribute('aria-label','Закрыть панель');panel.prepend(handle);
      var gesture=null,closing=false,timer=null;
      function dismiss(){
        if(panel.matches('.notes-menu'))notesCloseMenus();
        else if(panel.matches('.ndb-popup')){if(panel._notesNativeDismiss)panel._notesNativeDismiss();else NotesDatabase.close();}
        else if(panel.matches('.notes-confirm')){var cancel=panel.querySelector('.notes-confirm-btn:not(.primary)');if(cancel)cancel.click();}
        else if(panel.matches('.notes-cover-crop-modal')){var cancel=panel.querySelector('.notes-cover-crop-cancel');if(cancel)cancel.click();}
        else{var wrap=document.getElementById('settingsWrap');if(wrap)wrap.classList.remove('open');var btn=document.getElementById('settingsBtn');if(btn)btn.setAttribute('aria-expanded','false');}
      }
      function settle(close){
        if(closing)return;closing=close;if(close)panel.inert=true;
        // Continue from the currently painted position, even during entry.
        var current=new DOMMatrixReadOnly(getComputedStyle(panel).transform);
        var x=gesture?gesture.x:current.m41;
        panel.style.setProperty('transform','translate3d('+x+'px,'+(current.m42||0)+'px,0)','important');
        panel.style.setProperty('animation','none','important');panel.classList.remove('sheet-dragging');
        void panel.offsetHeight;panel.classList.add('sheet-settling');
        panel.style.setProperty('transform','translate3d('+x+'px,'+(close?panel.getBoundingClientRect().height+40:0)+'px,0)','important');
        clearTimeout(timer);timer=setTimeout(function(){
          if(close){dismiss();return;}
          panel.classList.remove('sheet-settling');panel.style.removeProperty('transform');gesture=null;closing=false;
        },notesReduceMotion?0:230);
      }
      panel._notesMobileDismiss=function(){settle(true);};
      handle.addEventListener('pointerdown',function(e){
        if(!notesIsMobile()||closing||!e.isPrimary||e.button!==0)return;
        clearTimeout(timer);var m=new DOMMatrixReadOnly(getComputedStyle(panel).transform);
        gesture={id:e.pointerId,start:e.clientY,last:e.clientY,time:e.timeStamp,speed:0,dy:0,x:m.m41,originY:m.m42||0};
        panel.style.setProperty('transform','translate3d('+gesture.x+'px,'+gesture.originY+'px,0)','important');
        panel.style.setProperty('animation','none','important');panel.classList.remove('sheet-settling');panel.classList.add('sheet-dragging');
        handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
      });
      handle.addEventListener('pointermove',function(e){
        if(!gesture||gesture.id!==e.pointerId||closing)return;
        var dt=e.timeStamp-gesture.time;
        if(dt>0)gesture.speed=(e.clientY-gesture.last)/dt;
        gesture.last=e.clientY;gesture.time=e.timeStamp;gesture.dy=Math.max(0,e.clientY-gesture.start);
        panel.style.setProperty('transform','translate3d('+gesture.x+'px,'+(gesture.originY+gesture.dy)+'px,0)','important');
        e.preventDefault();
      });
      handle.addEventListener('pointerup',function(e){
        if(!gesture||gesture.id!==e.pointerId)return;
        var distance=gesture.dy,velocity=e.timeStamp-gesture.time<100?gesture.speed:0;
        settle(distance>Math.min(120,panel.offsetHeight*.25)||(distance>24&&velocity>.55));
      });
      handle.addEventListener('pointercancel',function(){if(gesture)settle(false);});
      handle.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(e.detail===0)settle(true);});
    }
    function scan(root){if(root.nodeType!==1)return;if(root.matches(selector))attach(root);root.querySelectorAll(selector).forEach(attach);}
    new MutationObserver(function(records){if(!notesIsMobile())return;records.forEach(function(r){if(r.target.matches&&r.target.matches(selector))attach(r.target);r.addedNodes.forEach(scan);});}).observe(document.body,{childList:true,subtree:true});
    new MutationObserver(function(){if(notesIsMobile())scan(document.body);}).observe(document.body,{attributes:true,attributeFilter:['class']});
    scan(document.body);
    document.addEventListener('focusin',function(e){if(notesIsMobile()){var row=e.target.closest('.notes-block');if(row)notesAlignBlockTools(row);}});
    // Visibility is the single source of truth for click and keyboard access.
    document.addEventListener('click',function(e){
      if(!notesIsMobile())return;var tool=e.target.closest('.notes-block-tools');
      if(tool&&(getComputedStyle(tool).visibility==='hidden'||getComputedStyle(tool).opacity==='0')){e.preventDefault();e.stopImmediatePropagation();}
    },true);
    document.addEventListener('pointerdown',function(e){
      if(!notesIsMobile())return;var tool=e.target.closest('.notes-block-tools');
      if(tool&&getComputedStyle(tool).visibility!=='hidden'){tool.parentElement.classList.add('notes-tools-pinned');e.preventDefault();}
    },true);
  })();
})();
