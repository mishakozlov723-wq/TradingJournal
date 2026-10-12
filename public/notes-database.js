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
    function icon(name){const s=el('span','ndb-icon');bridge.icon(s,'line:'+name,'icon','gray');return s;}
    function dataIcon(data,fallback){
      if(data&&data.icon){const s=el('span','ndb-icon ndb-custom-icon');bridge.icon(s,data.icon,data.iconType||'emoji',data.iconColor||'default');return s;}
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
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);observer.observe(host.parentNode,{childList:true});
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
