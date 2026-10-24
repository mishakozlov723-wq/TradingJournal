(function(){
  'use strict';

  var ACCOUNTS_CACHE_VERSION = 1;
  var ACCOUNTS_REMOTE_COLLECTION = 'accountSnapshots';
  var accountsState = {
    mode:false,
    accounts:[],
    listLoaded:false,
    selectedId:null,
    details:null,
    loadingList:false,
    loadingDetail:false,
    lastLocalRefresh:null,
    chartObserver:null,
    chartSignature:null,
    chartResizeFrame:null,
    connectionPanelOpen:false,
    connecting:false,
    statInfoTrigger:null,
    listRequestSeq:0,
    detailRequestSeq:0,
    loadingDetailId:null
  };

  function accEl(id){ return document.getElementById(id); }
  function accText(id,value){ var el=accEl(id); if(el) el.textContent=String(value == null ? '—' : value); return el; }
  function accEscape(value){
    return String(value == null ? '' : value).replace(/[&<>'"]/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];
    });
  }
  function accNum(value){ var n=Number(value); return isFinite(n)?n:0; }
  function accSigned(value,digits){
    var n=accNum(value), d=digits == null ? 2 : digits;
    return (n>0?'+':'')+n.toFixed(d);
  }
  function accMoney(value,currency){
    var n=Number(value); if(!isFinite(n)) return '—';
    var code=String(currency||'USD').toUpperCase();
    try { return new Intl.NumberFormat('en-US',{style:'currency',currency:code,minimumFractionDigits:2,maximumFractionDigits:2}).format(n); }
    catch(_){ return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  }
  function accChartMoney(value,currency){
    var n=Number(value); if(!isFinite(n)) return '—';
    var abs=Math.abs(n), scaled=n, suffix='';
    if(abs>=1000000){scaled=n/1000000;suffix='m';}
    else if(abs>=1000){scaled=n/1000;suffix='k';}
    var code=String(currency||'USD').toUpperCase(), symbol=code==='USD'?'$':(code==='EUR'?'€':(code==='GBP'?'£':code+' '));
    var digits=Math.abs(scaled)>=100?0:(Math.abs(scaled)>=10?1:2);
    return symbol+scaled.toFixed(digits)+suffix;
  }
  function accNumber(value,digits){
    var n=Number(value); if(!isFinite(n)) return '—';
    return n.toLocaleString('en-US',{minimumFractionDigits:digits||0,maximumFractionDigits:digits == null ? 2 : digits});
  }
  function accPercent(value){ var n=Number(value); return isFinite(n)?((n>0?'+':'')+n.toFixed(2)+'%'):'—'; }
  function accTone(value){ var n=Number(value); return n>0?'positive':(n<0?'negative':''); }
  function accDate(value){
    if(!value) return '—';
    var d=accParseMyfxDate(value);
    if(!d || isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace(',','');
  }
  function accShortDate(value){
    var d=accParseMyfxDate(value); if(!d || isNaN(d.getTime())) return String(value||'');
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  }
  function accParseMyfxDate(value){
    if(value instanceof Date) return value;
    var s=String(value||'').trim();
    if(!s) return null;
    var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if(m) return new Date(Number(m[3]),Number(m[1])-1,Number(m[2]),Number(m[4]||0),Number(m[5]||0));
    var d=new Date(s); return isNaN(d.getTime())?null:d;
  }
  function accFlatten(input,out){
    out=out||[];
    if(Array.isArray(input)){ input.forEach(function(v){ accFlatten(v,out); }); }
    else if(input && typeof input==='object') out.push(input);
    return out;
  }
  var ACCOUNTS_API_URL_KEY='tjAccountsApiUrl';
  function accEndpoint(){
    var configured=window.TJ_ACCOUNTS_CONFIG && window.TJ_ACCOUNTS_CONFIG.apiUrl;
    var endpoint=String(configured||'').trim().replace(/\/+$/,''); // Deployment configuration is authoritative; localStorage cannot redirect credentials.
    if(endpoint && !/^https:\/\//i.test(endpoint)) return '';
    return endpoint;
  }
  function accSaveEndpoint(value){
    var endpoint=String(value||'').trim().replace(/\/+$/,'');
    if(endpoint && endpoint!==accEndpoint())throw new Error('Accounts endpoint must match the trusted deployment configuration.');
    try { if(endpoint)localStorage.setItem(ACCOUNTS_API_URL_KEY,endpoint); else localStorage.removeItem(ACCOUNTS_API_URL_KEY); } catch(_) {}
    return endpoint;
  }
  var ACCOUNTS_CONNECTION_KEY_PREFIX='tjMyfxbookConnectionV1:';
  function accCurrentUid(){
    try { var u=firebase.auth().currentUser; return u?u.uid:null; } catch(_){ return null; }
  }
  function accConnectionStorageKey(uid){
    uid=uid||accCurrentUid(); return uid?ACCOUNTS_CONNECTION_KEY_PREFIX+uid:'';
  }
  function accConnectionToken(uid){
    var key=accConnectionStorageKey(uid); if(!key)return '';
    try { return String(localStorage.getItem(key)||'').trim(); } catch(_){ return ''; }
  }
  function accSaveConnectionToken(token,uid){
    var key=accConnectionStorageKey(uid); if(!key)return;
    try { if(token)localStorage.setItem(key,String(token)); else localStorage.removeItem(key); } catch(_) {}
  }
  function accCanUseAccounts(){
    return !!accCurrentUid();
  }
  function accPopulateSetup(){
    var connected=!!accConnectionToken(), card=accEl('accountsSetupCard'), form=accEl('accountsConnectForm'), actions=accEl('accountsConnectedActions');
    if(card)card.classList.toggle('is-connected',connected);
    if(form)form.hidden=connected;
    if(actions)actions.hidden=!connected;
    accText('accountsSetupTitle',connected?'Myfxbook подключён':'Подключить Myfxbook');
    accText('accountsSetupCopy',connected?
      'Для этого пользователя Trading Journal подключён свой Myfxbook. Отключение здесь ничего не меняет в FundedNext или Myfxbook.':
      'Каждый пользователь Trading Journal один раз подключает свой профиль Myfxbook. Пароль передаётся только на сервер по HTTPS и не хранится в коде журнала.');
    var btn=accEl('accountsConnectionBtn'); if(btn)btn.classList.toggle('is-connected',connected);
  }
  function accSetError(message){
    var el=accEl('accountsError'); if(!el)return;
    el.textContent=message||''; el.classList.toggle('is-visible',!!message);
  }
  function accSetWarning(message){
    var el=accEl('accountsWarning'); if(!el)return;
    el.textContent=message||''; el.classList.toggle('is-visible',!!message);
  }
  function accSetRefreshBusy(busy){
    var btn=accEl('accountsRefreshBtn'); if(!btn)return;
    btn.disabled=!!busy; btn.classList.toggle('is-loading',!!busy);
  }
  function accSyncCopy(text){ accText('accountsSyncCopy',text||''); }
  function accRestartViewAnimation(el){
    if(!el)return; el.classList.remove('accounts-view-enter');
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void el.offsetWidth; el.classList.add('accounts-view-enter');
    setTimeout(function(){ if(el)el.classList.remove('accounts-view-enter'); },900);
  }

  async function accApi(action,id,options){
    options=options||{};
    var endpoint=accEndpoint();
    if(!endpoint){ var e=new Error('Accounts API is not configured yet.'); e.code='NOT_CONFIGURED'; throw e; }
    var user=firebase.auth().currentUser;
    if(!user){ var authErr=new Error('Sign in to open Accounts.'); authErr.code='FIREBASE_AUTH'; throw authErr; }
    var requestUid=user.uid;
    // Never hang here: a stuck Firebase token request used to leave "Connecting..." on screen forever.
    var firebaseToken=await new Promise(function(resolve,reject){
      var t=setTimeout(function(){ var te=new Error('Step 1/2 failed: Firebase token request timed out (15 s). Reload the app and sign in again.'); te.code='FIREBASE_TOKEN_TIMEOUT'; reject(te); },15000);
      user.getIdToken().then(function(v){ clearTimeout(t); resolve(v); },function(e){ clearTimeout(t); reject(e); });
    });
    if(accCurrentUid()!==requestUid){ var changedErr=new Error('Firebase account changed during the request.'); changedErr.code='FIREBASE_AUTH_CHANGED'; throw changedErr; }
    var url=endpoint+(endpoint.indexOf('?')>=0?'&':'?')+'action='+encodeURIComponent(action);
    if(id!=null) url+='&id='+encodeURIComponent(id);
    var method=options.method||'GET', headers={'Accept':'application/json','Authorization':'Bearer '+firebaseToken};
    var connection=accConnectionToken(requestUid);
    if(options.connection!==false){
      if(!connection){ var ce=new Error('Connect Myfxbook for this Trading Journal user first.'); ce.code='MYFXBOOK_NOT_CONNECTED'; throw ce; }
      headers['X-TJ-Accounts-Connection']=connection;
    }
    var fetchOptions={method:method,headers:headers,cache:'no-store'};
    if(options.body!==undefined){
      headers['Content-Type']='application/json';
      fetchOptions.body=JSON.stringify(options.body||{});
    }
    var controller=typeof AbortController!=='undefined'?new AbortController():null;
    var timer=controller?setTimeout(function(){ controller.abort(); },30000):null;
    if(controller)fetchOptions.signal=controller.signal;
    try {
      var response;
      try { response=await fetch(url,fetchOptions); }
      catch(netErr){
        var ne=new Error(netErr&&netErr.name==='AbortError'
          ? 'Step 2/2 failed: Accounts server did not answer in 30 s ('+endpoint.replace(/^https:\/\//,'').split('/')[0]+').'
          : 'Step 2/2 failed: cannot reach the Accounts server ('+endpoint.replace(/^https:\/\//,'').split('/')[0]+'): '+((netErr&&netErr.message)||'network error'));
        ne.code='ACCOUNTS_NETWORK'; throw ne;
      }
      var text=await response.text(), data=null;
      try { data=JSON.parse(text); } catch(_) { throw new Error('Accounts API returned an invalid response.'); }
      if(!response.ok || !data || data.ok===false){
        var err=new Error((data&&data.error)||('Accounts API error '+response.status));
        err.code=(data&&data.code)||'ACCOUNTS_API';
        err.status=response.status;
        throw err;
      }
      return data;
    } finally { if(timer)clearTimeout(timer); }
  }

  async function accConnectMyfxbook(){
    if(accountsState.connecting)return;
    var connectUid=accCurrentUid();
    if(!connectUid){ accSetError('Sign in to connect Myfxbook.'); return; }
    var email=String((accEl('accountsMyfxEmailInput')||{}).value||'').trim();
    var password=String((accEl('accountsMyfxPasswordInput')||{}).value||'');
    if(!email||!password){ accSetError('Enter the Myfxbook email and password.'); return; }
    accountsState.connecting=true; accSetError(''); accSetWarning('');
    var card=accEl('accountsSetupCard'),btn=accEl('accountsMyfxConnectBtn');
    if(card)card.classList.add('accounts-connect-busy'); if(btn)btn.textContent='Connecting…';
    try{
      var data=await accApi('connect',null,{method:'POST',connection:false,body:{email:email,password:password}});
      if(!data.connectionToken)throw new Error('Accounts API did not return a connection token.');
      if(accCurrentUid()!==connectUid)throw new Error('Firebase account changed while Myfxbook was connecting.');
      accSaveConnectionToken(data.connectionToken,connectUid);
      var pass=accEl('accountsMyfxPasswordInput'); if(pass)pass.value='';
      accountsState.accounts=Array.isArray(data.accounts)?data.accounts:[];
      accountsState.listLoaded=true; accountsState.connectionPanelOpen=false;
      accPopulateSetup(); accRenderSetup(false); accRenderAccounts(); accRenderSkeleton(false);
      accSyncCopy('Myfxbook подключён');
    }catch(err){
      if(accCurrentUid()!==connectUid)return;
      accSetError(err.message||'Could not connect Myfxbook.');
      accRenderSetup(true);
    }finally{
      accountsState.connecting=false; if(card)card.classList.remove('accounts-connect-busy'); if(btn)btn.textContent='Connect Myfxbook';
    }
  }
  async function accDisconnectMyfxbook(){
    if(accountsState.connecting)return;
    var disconnectUid=accCurrentUid();
    accountsState.connecting=true; accSetError(''); accSetWarning('');
    try{
      var result=await accApi('disconnect',null,{method:'POST',connection:false,body:{}});
      if(!result.revoked)throw new Error('Server did not confirm token revocation. Update the Accounts proxy and retry.');
    }catch(err){
      if(accCurrentUid()===disconnectUid)accSetError('Could not revoke Myfxbook connection: '+err.message);
      accountsState.connecting=false;return;
    }
    if(disconnectUid)accSaveConnectionToken('',disconnectUid);
    if(accCurrentUid()!==disconnectUid){ accountsState.connecting=false; return; }
    accountsState.listRequestSeq++; accountsState.detailRequestSeq++; accountsState.loadingList=false; accountsState.loadingDetail=false; accountsState.loadingDetailId=null; accSetRefreshBusy(false);
    accountsState.accounts=[]; accountsState.listLoaded=false; accountsState.selectedId=null; accountsState.details=null; accountsState.connectionPanelOpen=true;
    accRenderAccounts(); accPopulateSetup(); accRenderSetup(true); accSyncCopy('Myfxbook не подключён');
    accountsState.connecting=false;
  }

  function accHistoryKey(accountId,uid){ return 'tjMyfxHistoryV'+ACCOUNTS_CACHE_VERSION+':'+String(uid||accCurrentUid()||'')+':'+String(accountId); }
  function accHistoryFingerprint(accountId,t){
    // Provider IDs are preferred. Without one, preserve per-snapshot multiplicity
    // using execution fields only; mutable profit/fees must not append a correction.
    return 'mfb_'+String(accountId)+'_anonymous_'+encodeURIComponent(JSON.stringify([t.openTime,t.closeTime,t.symbol,t.action,t.sizing&&t.sizing.value,t.openPrice,t.closePrice]));
  }
  function accCompactHistory(accountId,list){
    function clean(v){ return v===undefined?null:v; }
    var occurrences=Object.create(null);
    return (list||[]).map(function(t){
      return {
        _id:(function(){
          var sourceId=t.id!=null?t.id:t.ticket!=null?t.ticket:t.orderId!=null?t.orderId:t.tradeId;
          if(sourceId!=null&&String(sourceId)!=='')return 'mfb_'+accountId+'_source_'+encodeURIComponent(String(sourceId));
          if(t._id&&String(t._id).indexOf('mfb_'+accountId+'_source_')===0)return t._id;
          var key=accHistoryFingerprint(accountId,t);occurrences[key]=(occurrences[key]||0)+1;
          return key+'_occ_'+occurrences[key];
        })(),openTime:t.openTime||'',closeTime:t.closeTime||'',symbol:t.symbol||'',action:t.action||'',
        sizing:t.sizing&&typeof t.sizing==='object'?{type:t.sizing.type||'lots',value:clean(t.sizing.value)}:null,
        openPrice:clean(t.openPrice),closePrice:clean(t.closePrice),tp:clean(t.tp),sl:clean(t.sl),pips:clean(t.pips),profit:clean(t.profit),interest:clean(t.interest),commission:clean(t.commission),swap:clean(t.swap),comment:t.comment||''
      };
    });
  }
  function accHistorySignature(accountId,list){
    return JSON.stringify(accCompactHistory(accountId,list||[]).map(function(t){return JSON.stringify(t);}).sort());
  }
  function accHistoryConflict(accountId,previous,incoming,message){
    var error=new Error(message||'История без ID изменилась. Автоматическое объединение остановлено: невозможно отличить исправление от новой сделки.');
    error.code='HISTORY_CONFLICT';error.accountId=String(accountId);error.previous=accCompactHistory(accountId,previous);error.incoming=accCompactHistory(accountId,incoming);return error;
  }
  function accHistoryIdentified(accountId,t){return String(t._id||'').indexOf('mfb_'+accountId+'_source_')===0;}
  function accHistoryProposal(accountId,a,b,replaceAnonymous){
    var left=accCompactHistory(accountId,a||[]),right=accCompactHistory(accountId,b||[]),map=Object.create(null),out=[];
    [left,right].forEach(function(list){
      var seen=Object.create(null);list.forEach(function(t){if(accHistoryIdentified(accountId,t)){
        var text=JSON.stringify(t);if(seen[t._id]&&seen[t._id]!==text)throw accHistoryConflict(accountId,a,b,'Один provider ID содержит разные сделки. Исправьте исходный экспорт; автоматическое решение запрещено.');seen[t._id]=text;
        if(map[t._id]!==undefined)out[map[t._id]]=t;else{map[t._id]=out.length;out.push(t);}
      }});
    });
    (replaceAnonymous?right:left).forEach(function(t){if(!accHistoryIdentified(accountId,t))out.push(t);});
    out.sort(function(x,y){return (accParseMyfxDate(x.closeTime)||accParseMyfxDate(x.openTime)||0)-(accParseMyfxDate(y.closeTime)||accParseMyfxDate(y.openTime)||0);});return out;
  }
  function accMergeHistory(accountId,a,b){
    var left=accCompactHistory(accountId,a||[]),right=accCompactHistory(accountId,b||[]);
    var anonA=left.filter(function(t){return !accHistoryIdentified(accountId,t);}),anonB=right.filter(function(t){return !accHistoryIdentified(accountId,t);});
    // No fuzzy identity inference, even for a profit correction or an increased
    // count of identical executions. Quarantine BOTH snapshots before any write.
    if(left.length&&right.length&&(anonA.length||anonB.length)&&accHistorySignature(accountId,left)!==accHistorySignature(accountId,right))throw accHistoryConflict(accountId,left,right);
    return accHistoryProposal(accountId,left,right,!left.length);
  }
  async function accLoadCachedHistory(accountId,uid){
    var local=[];uid=uid||accCurrentUid();
    try{var raw=JSON.parse(localStorage.getItem(accHistoryKey(accountId,uid))||'[]');if(Array.isArray(raw))local=raw;}catch(_){}
    if(!uid||typeof db==='undefined')throw Error('Для безопасного импорта нужно подключение к облачному снимку.');
    // A failed cloud read is NOT an empty baseline that may overwrite history.
    var pending;
    try{pending=JSON.parse(localStorage.getItem(accHistoryKey(accountId,uid)+':conflict')||'null');}catch(_){}
    if(pending&&pending.status!=='dismissed'&&pending.status!=='resolved'&&Array.isArray(pending.previous)&&Array.isArray(pending.incoming)){
      var preserved=accHistoryConflict(accountId,pending.previous,pending.incoming,'Остался неразрешённый импорт. Оба снимка восстановлены из локального архива.');preserved.remoteExpected=pending.remoteExpected||[];throw preserved;
    }
    var doc=await db.collection(ACCOUNTS_REMOTE_COLLECTION).doc('mfb_'+uid+'_'+String(accountId)).get({source:'server'});
    var remote=doc.exists&&Array.isArray(doc.data().history)?doc.data().history:[];
    try{return {history:accMergeHistory(accountId,local,remote),remote:remote};}
    catch(error){error.remoteExpected=remote;throw error;}
  }
  async function accSaveCachedHistory(accountId,history,uid,expected,backup){
    var compact=accCompactHistory(accountId,history);uid=uid||accCurrentUid();
    if(!uid||accCurrentUid()!==uid||typeof db==='undefined')throw Error('Account changed; import cancelled.');
    var ref=db.collection(ACCOUNTS_REMOTE_COLLECTION).doc('mfb_'+uid+'_'+String(accountId));
    var archive=backup?db.collection('accountHistoryBackups').doc():null;
    await db.runTransaction(async function(tx){
      var doc=await tx.get(ref),remote=doc.exists&&Array.isArray(doc.data().history)?doc.data().history:[];
      if(accCurrentUid()!==uid)throw Error('Account changed while reading history; no import written.');
      if(accHistorySignature(accountId,remote)!==accHistorySignature(accountId,expected||[])){
        var conflict=accHistoryConflict(accountId,remote,compact,'Другой клиент изменил историю. Обновите снимки и выберите решение заново.');conflict.remoteExpected=remote;throw conflict;
      }
      if(archive)tx.set(archive,{uid:uid,accountId:String(accountId),previous:backup.previous,incoming:backup.incoming,cloudBefore:remote,chosen:compact,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      tx.set(ref,{uid:uid,accountId:String(accountId),source:'myfxbook',history:compact,historyRevision:(doc.exists?Number(doc.data().historyRevision)||0:0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    });
    try{localStorage.setItem(accHistoryKey(accountId,uid),JSON.stringify(compact));}catch(error){accSetWarning('Облако сохранило историю, локальный кэш недоступен: '+error.message);}
    return compact;
  }
  function accShowHistoryConflict(error,uid){
    var host=accEl('accountsDetailContent');if(!host)return;
    var old=accEl('accountsHistoryConflict');if(old)old.remove();
    var panel=document.createElement('section');panel.id='accountsHistoryConflict';panel.className='card';panel.setAttribute('role','alert');
    var heading=document.createElement('h3');heading.textContent='История требует решения — импорт не сохранён';panel.appendChild(heading);
    var description=document.createElement('p');description.textContent=error.message+' Сохранено: '+error.previous.length+', входящий снимок: '+error.incoming.length+'. Новые/изменённые строки не участвуют в статистике до решения.';panel.appendChild(description);
    var payload={accountId:error.accountId,previous:error.previous,incoming:error.incoming,remoteExpected:error.remoteExpected||[]};
    var pendingKey=accHistoryKey(error.accountId,uid)+':conflict';
    try{localStorage.setItem(pendingKey,JSON.stringify(payload));}catch(_){description.textContent+=' Локальный архив недоступен: скачайте оба снимка до закрытия окна.';}
    var preview=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Сравнить оба снимка (JSON)';pre.textContent=JSON.stringify(payload,null,2);pre.style.cssText='max-height:300px;overflow:auto;white-space:pre-wrap';preview.append(summary,pre);panel.appendChild(preview);
    var exported=false;
    function button(label,action){var el=document.createElement('button');el.type='button';el.textContent=label;el.addEventListener('click',action);panel.appendChild(el);return el;}
    button('Скачать оба снимка',function(){var url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='myfxbook-history-conflict-'+error.accountId+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);exported=true;});
    button('Оставить сохранённую историю (без записи)',function(){try{localStorage.setItem(pendingKey,JSON.stringify(Object.assign({},payload,{status:'dismissed'})));}catch(_){}panel.remove();accSetWarning('Импорт отклонён. Сохранённая история не изменена; снимки доступны в локальном архиве/скачанном файле.');});
    var accept=button('Принять входящий снимок с архивом',async function(){
      if(!exported){accSetError('Сначала скачайте оба снимка для сравнения и резервной копии.');return;}
      if(accCurrentUid()!==uid||String(accountsState.selectedId)!==error.accountId){accSetError('Аккаунт изменён. Откройте конфликт заново.');return;}
      if(!window.confirm('Входящий снимок может быть неполным. Заменить ВСЕ строки без provider ID входящим набором, а совпадающие provider ID обновить входящими значениями? Остальные provider ID сохранятся. Обе версии будут атомарно архивированы в облаке. Это явное решение, не автоматическое сопоставление сделок.'))return;
      Array.prototype.forEach.call(panel.querySelectorAll('button'),function(b){b.disabled=true;});
      try{
        var chosen=accHistoryProposal(error.accountId,error.previous,error.incoming,true);
        await accSaveCachedHistory(error.accountId,chosen,uid,error.remoteExpected||[],payload);
        if(accCurrentUid()!==uid||String(accountsState.selectedId)!==error.accountId)return;
        try{if(JSON.stringify(JSON.parse(localStorage.getItem(pendingKey)||'null'))===JSON.stringify(payload))localStorage.setItem(pendingKey,JSON.stringify(Object.assign({},payload,{status:'resolved'})));}catch(_){}
        if(!panel.isConnected)return;
        panel.remove();if(accountsState.details){accountsState.details.mergedHistory=chosen;accRenderDetail(accountsState.details);}else accRenderHistory(chosen,'USD');
        accSyncCopy('Решение сохранено; обе исходные версии в архиве');
      }catch(failure){
        if(accCurrentUid()!==uid||String(accountsState.selectedId)!==error.accountId||!panel.isConnected)return;
        if(failure.code==='HISTORY_CONFLICT')accShowHistoryConflict(failure,uid);
        accSetError(failure.message||'Не сохранено. Оба снимка сохранены, повторите загрузку.');
      }
      finally{Array.prototype.forEach.call(panel.querySelectorAll('button'),function(b){b.disabled=false;});}
    });
    accountsState.details={account:accFindAccount(error.accountId)||{currency:'USD',name:'Account '+error.accountId},mergedHistory:error.previous,openTrades:[],daily:[]};accRenderDetail(accountsState.details);
    host.prepend(panel);
  }

  function accIsTrade(t){ return !!(t && String(t.symbol||'').trim() && /buy|sell/i.test(String(t.action||''))); }
  function accNet(t){ return accNum(t&&t.profit)+accNum(t&&t.interest)+accNum(t&&t.commission)+accNum(t&&t.swap); }
  function accHistoryStats(history,account){
    var trades=(history||[]).filter(accIsTrade), wins=[],losses=[],longs=[],shorts=[],grossWin=0,grossLoss=0,lots=0;
    trades.forEach(function(t){
      var net=accNet(t); if(net>0){wins.push(t);grossWin+=net;} else if(net<0){losses.push(t);grossLoss+=Math.abs(net);}
      if(/buy/i.test(String(t.action||'')))longs.push(t); if(/sell/i.test(String(t.action||'')))shorts.push(t);
      lots+=accNum(t.sizing&&t.sizing.value);
    });
    function avg(list){ return list.length?list.reduce(function(s,t){return s+accNet(t);},0)/list.length:0; }
    function winRate(list){ return list.length?list.filter(function(t){return accNet(t)>0;}).length/list.length*100:0; }
    var nets=trades.map(accNet), pf=Number(account&&account.profitFactor);
    if(!isFinite(pf) || pf<0)pf=grossLoss?grossWin/grossLoss:(grossWin?Infinity:0);
    return {
      trades:trades,wins:wins.length,losses:losses.length,winRate:trades.length?wins.length/trades.length*100:0,
      avgWin:avg(wins),avgLoss:avg(losses),best:nets.length?Math.max.apply(null,nets):0,worst:nets.length?Math.min.apply(null,nets):0,
      lots:lots,longWin:winRate(longs),shortWin:winRate(shorts),longs:longs.length,shorts:shorts.length,profitFactor:pf,
      expectancy:trades.length?nets.reduce(function(a,b){return a+b;},0)/trades.length:0
    };
  }

  var ACCOUNTS_STAT_INFO={
    winRate:{
      title:'Win rate',
      description:'Доля закрытых сделок, которые закончились с положительным чистым результатом.',
      detail:function(value){return value==='—'?'Сейчас для этой метрики недостаточно данных.':value+' означает, какая часть всех сохранённых закрытых сделок была прибыльной.';}
    },
    profitFactor:{
      title:'Profit factor',
      description:'Соотношение общей прибыли прибыльных сделок к абсолютной сумме убытков убыточных сделок.',
      detail:function(value){return value==='—'?'Сейчас для этой метрики недостаточно данных.':'Значение '+value+': выше 1.00 — суммарная прибыль больше суммарных убытков; 2.00 — примерно вдвое больше.';}
    },
    avgWin:{
      title:'Average Win',
      description:'Средний чистый результат одной прибыльной закрытой сделки. В расчёт попадают только сделки с итоговым плюсом.',
      detail:function(value){return value==='—'?'Пока нет прибыльных закрытых сделок для расчёта.':value+' — столько в среднем приносит одна выигрышная закрытая сделка на этом аккаунте.';}
    },
    avgLoss:{
      title:'Average Loss',
      description:'Средний чистый результат одной убыточной закрытой сделки. В расчёт попадают только сделки с итоговым минусом.',
      detail:function(value){return value==='—'?'Пока нет убыточных закрытых сделок для расчёта.':value+' — средний результат одной проигрышной закрытой сделки на этом аккаунте.';}
    },
    bestTrade:{
      title:'Best Trade',
      description:'Самый большой чистый плюс среди сохранённых закрытых сделок аккаунта.',
      detail:function(value){return value==='—'?'Закрытых сделок для сравнения пока нет.':value+' — лучший результат одной закрытой сделки в сохранённой истории.';}
    },
    worstTrade:{
      title:'Worst Trade',
      description:'Самый большой чистый минус среди сохранённых закрытых сделок аккаунта.',
      detail:function(value){return value==='—'?'Закрытых сделок для сравнения пока нет.':value+' — худший результат одной закрытой сделки в сохранённой истории.';}
    },
    longWin:{
      title:'Longs Won',
      description:'Процент прибыльных BUY / Long сделок среди всех сохранённых закрытых Long-сделок.',
      detail:function(value){return value==='—'?'Закрытых Long-сделок для расчёта пока нет.':value+' — доля ваших закрытых Long-сделок, завершившихся в плюс.';}
    },
    shortWin:{
      title:'Shorts Won',
      description:'Процент прибыльных SELL / Short сделок среди всех сохранённых закрытых Short-сделок.',
      detail:function(value){return value==='—'?'Закрытых Short-сделок для расчёта пока нет.':value+' — доля ваших закрытых Short-сделок, завершившихся в плюс.';}
    },
    lots:{
      title:'Total Lots',
      description:'Суммарный торговый объём всех сохранённых закрытых сделок, выраженный в лотах.',
      detail:function(value){return value==='—'?'Данных об объёме пока нет.':value+' — сумма размеров позиций по закрытым сделкам. Это не средний лот и не размер текущей позиции.';}
    },
    expectancy:{
      title:'Expectancy',
      description:'Средний чистый результат одной закрытой сделки с учётом и прибыльных, и убыточных сделок.',
      detail:function(value){return value==='—'?'Закрытых сделок для расчёта пока нет.':value+' — столько одна закрытая сделка в среднем добавляла или отнимала от результата аккаунта.';}
    },
    drawdown:{
      title:'Drawdown',
      description:'Показатель просадки аккаунта, который отдаёт Myfxbook: насколько счёт снижался относительно предыдущего максимума.',
      detail:function(value){return value==='—'?'Myfxbook пока не передал значение просадки.':value+' — величина просадки в процентах. Чем ниже этот показатель, тем мягче исторические снижения счёта.';}
    },
    pips:{
      title:'Pips',
      description:'Суммарный результат в пипсах — единицах движения цены. Он не равен прибыли в долларах и не учитывает размер позиции так, как денежный P/L.',
      detail:function(value){return value==='—'?'Myfxbook пока не передал суммарный результат в пипсах.':value+' — суммарное движение в пипсах по данным Myfxbook. Поэтому, например, +12 000 pips не означает +$12 000.';}
    }
  };
  function accStatInfoOpen(){ var overlay=accEl('accountsStatInfoOverlay'); return !!(overlay&&overlay.classList.contains('open')); }
  function accOpenStatInfo(key,value,trigger){
    var info=ACCOUNTS_STAT_INFO[key],overlay=accEl('accountsStatInfoOverlay'); if(!info||!overlay)return;
    accountsState.statInfoTrigger=trigger||document.activeElement||null;
    accText('accountsStatInfoTitle',info.title);
    accText('accountsStatInfoValue',value||'—');
    accText('accountsStatInfoDescription',info.description);
    accText('accountsStatInfoDetail',info.detail(value||'—'));
    var valueEl=accEl('accountsStatInfoValue');
    if(valueEl){
      valueEl.classList.remove('positive','negative');
      var sourceValue=trigger&&trigger.querySelector?trigger.querySelector('.accounts-stat-tile-value'):null;
      if(sourceValue&&sourceValue.classList.contains('positive'))valueEl.classList.add('positive');
      if(sourceValue&&sourceValue.classList.contains('negative'))valueEl.classList.add('negative');
    }
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false');
    var close=accEl('accountsStatInfoClose'); if(close)setTimeout(function(){try{close.focus({preventScroll:true});}catch(_){close.focus();}},0);
  }
  function accCloseStatInfo(restoreFocus){
    var overlay=accEl('accountsStatInfoOverlay'); if(!overlay)return;
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true');
    if(restoreFocus!==false&&accountsState.statInfoTrigger&&typeof accountsState.statInfoTrigger.focus==='function'){
      var trigger=accountsState.statInfoTrigger; setTimeout(function(){try{trigger.focus({preventScroll:true});}catch(_){try{trigger.focus();}catch(__){}}},0);
    }
    accountsState.statInfoTrigger=null;
  }

  function accRenderSkeleton(show){
    var sk=accEl('accountsSkeletonGrid'), grid=accEl('accountsGrid');
    if(sk)sk.classList.toggle('is-visible',!!show); if(grid)grid.style.display=show?'none':'grid';
  }
  function accRenderSetup(show){
    var el=accEl('accountsSetupCard'); if(el)el.classList.toggle('is-visible',!!show);
    if(show)accPopulateSetup();
  }
  function accAccountMeta(account){
    var parts=[]; if(account&&account.server&&account.server.name)parts.push(account.server.name); parts.push(account&&account.demo?'Демо':'Реальный'); if(account&&account.currency)parts.push(account.currency); return parts.join(' · ');
  }
  function accRenderAccounts(){
    var grid=accEl('accountsGrid'); if(!grid)return;
    if(!accountsState.accounts.length){ grid.innerHTML='<div class="card" style="grid-column:1/-1;margin:0"><div class="empty-state">Пока нет подключённых аккаунтов Myfxbook.</div></div>'; return; }
    grid.innerHTML=accountsState.accounts.map(function(a){
      var profit=accNum(a.profit), equity=accNum(a.equity), balance=accNum(a.balance), currency=a.currency||'USD';
      return '<button type="button" class="account-card" data-account-id="'+accEscape(a.id)+'">'+
        '<div class="account-card-head"><div style="min-width:0"><div class="account-card-name">'+accEscape(a.name||('Account '+a.accountId))+'</div><div class="account-card-meta">'+accEscape(accAccountMeta(a))+'</div></div><div class="account-status"><span class="account-status-dot"></span><span>Connected</span></div></div>'+
        '<div><span class="account-card-balance mono">'+accEscape(accMoney(balance,currency))+'</span></div>'+
        '<div class="account-card-stats">'+
          '<div class="account-card-stat"><div class="account-card-stat-label">Profit</div><div class="account-card-stat-value mono '+accTone(profit)+'">'+accEscape(accMoney(profit,currency))+'</div></div>'+
          '<div class="account-card-stat"><div class="account-card-stat-label">Equity</div><div class="account-card-stat-value mono">'+accEscape(accMoney(equity,currency))+'</div></div>'+
          '<div class="account-card-stat"><div class="account-card-stat-label">Gain</div><div class="account-card-stat-value mono '+accTone(a.gain)+'">'+accEscape(accPercent(a.gain))+'</div></div>'+
        '</div><span class="account-card-arrow" aria-hidden="true"><svg class="tj-ui-icon" data-icon="arrow-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span></button>';
    }).join('');
  }

  async function accRefreshAccounts(force){
    if(accountsState.loadingList)return;
    var requestSeq=++accountsState.listRequestSeq, requestUid=accCurrentUid();
    accountsState.loadingList=true; accSetRefreshBusy(true); accSetError(''); accSetWarning('');
    var endpoint=accEndpoint();
    if(!endpoint){
      accRenderSkeleton(false); accRenderSetup(true); accSyncCopy('Accounts API unavailable'); accountsState.loadingList=false; accSetRefreshBusy(false); return;
    }
    if(!accConnectionToken()){
      accRenderSkeleton(false); accountsState.accounts=[]; accountsState.listLoaded=false; accRenderAccounts(); accRenderSetup(true); accSyncCopy('Подключите Myfxbook'); accountsState.loadingList=false; accSetRefreshBusy(false); return;
    }
    accRenderSetup(!!accountsState.connectionPanelOpen); if(!accountsState.listLoaded)accRenderSkeleton(true);
    try {
      var data=await accApi('accounts');
      if(requestSeq!==accountsState.listRequestSeq || accCurrentUid()!==requestUid || !accountsState.mode)return;
      accountsState.accounts=Array.isArray(data.accounts)?data.accounts:[];
      accountsState.listLoaded=true; accountsState.lastLocalRefresh=new Date(); accRenderAccounts(); accRenderSkeleton(false); accPopulateSetup();
      accSyncCopy('Обновлено '+accountsState.lastLocalRefresh.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
      if(force && accountsState.selectedId)await accRefreshDetail(accountsState.selectedId,true);
    } catch(err){
      if(requestSeq!==accountsState.listRequestSeq || accCurrentUid()!==requestUid || !accountsState.mode)return;
      accRenderSkeleton(false);
      if(err&&err.code==='NOT_CONFIGURED')accRenderSetup(true);
      else if(err&&(err.code==='MYFXBOOK_NOT_CONNECTED'||err.code==='CONNECTION_INVALID')){
        accSaveConnectionToken(''); accountsState.accounts=[];accountsState.listLoaded=false;accRenderAccounts();accRenderSetup(true);accPopulateSetup();accSetError(err.message||'Reconnect Myfxbook.');
      } else accSetError(err.message||'Could not load Accounts.');
      accSyncCopy('Не удалось обновить');
    } finally { if(requestSeq===accountsState.listRequestSeq){ accountsState.loadingList=false; accSetRefreshBusy(false); } }
  }

  function accFindAccount(id){ return accountsState.accounts.filter(function(a){return String(a.id)===String(id);})[0]||null; }
  function accSetValue(id,text,value){ var el=accText(id,text); if(el){el.classList.remove('positive','negative'); var tone=accTone(value); if(tone)el.classList.add(tone);} }
  function accRenderStatTiles(stats,currency,account){
    var el=accEl('accountsStatGrid'); if(!el)return;
    var tiles=[
      ['winRate','Win rate',stats.winRate.toFixed(1)+'%'],['profitFactor','Profit factor',isFinite(stats.profitFactor)?stats.profitFactor.toFixed(2):'∞'],
      ['avgWin','Average win',stats.wins?accMoney(stats.avgWin,currency):'—',stats.avgWin],['avgLoss','Average loss',stats.losses?accMoney(stats.avgLoss,currency):'—',stats.avgLoss],
      ['bestTrade','Best trade',stats.trades.length?accMoney(stats.best,currency):'—',stats.best],['worstTrade','Worst trade',stats.trades.length?accMoney(stats.worst,currency):'—',stats.worst],
      ['longWin','Longs won',stats.longs?stats.longWin.toFixed(0)+'%':'—'],['shortWin','Shorts won',stats.shorts?stats.shortWin.toFixed(0)+'%':'—'],
      ['lots','Total lots',accNumber(stats.lots,2)],['expectancy','Expectancy',stats.trades.length?accMoney(stats.expectancy,currency):'—',stats.expectancy],
      ['drawdown','Drawdown',account&&account.drawdown!=null?accNum(account.drawdown).toFixed(2)+'%':'—'],['pips','Pips',account&&account.pips!=null?accSigned(account.pips,1):'—',account&&account.pips]
    ];
    el.innerHTML=tiles.map(function(t){
      return '<button type="button" class="accounts-stat-tile" data-stat-key="'+accEscape(t[0])+'" data-stat-value="'+accEscape(t[2])+'" aria-label="'+accEscape(t[1])+' — подробнее">'+
        '<div class="accounts-stat-tile-label">'+accEscape(t[1])+'</div><div class="accounts-stat-tile-value mono '+(t.length>3?accTone(t[3]):'')+'">'+accEscape(t[2])+'</div></button>';
    }).join('');
  }
  function accRenderOpenTrades(list,currency){
    var body=accEl('accountsOpenTradesBody'), count=accEl('accountsOpenTradesCount'); if(!body)return;
    list=accFlatten(list||[]); if(count)count.textContent=list.length+' open';
    if(!list.length){ body.innerHTML='<tr><td class="accounts-empty-row" colspan="7">В последней синхронизации Myfxbook открытых позиций нет</td></tr>'; return; }
    body.innerHTML=list.map(function(t){
      var action=String(t.action||'—'), side=/buy/i.test(action)?'buy':(/sell/i.test(action)?'sell':'');
      return '<tr><td>'+accEscape(accDate(t.openTime))+'</td><td class="mono">'+accEscape(t.symbol||'—')+'</td><td><span class="account-action"><span class="accounts-direction-dot '+side+'"></span>'+accEscape(action)+'</span></td><td class="mono">'+accEscape(t.sizing&&t.sizing.value!=null?t.sizing.value:'—')+'</td><td class="mono">'+accEscape(t.openPrice==null?'—':t.openPrice)+'</td><td class="mono '+accTone(t.profit)+'">'+accEscape(accMoney(t.profit,currency))+'</td><td class="mono">'+accEscape(t.pips==null?'—':accSigned(t.pips,1))+'</td></tr>';
    }).join('');
  }
  function accRenderHistory(history,currency){
    var body=accEl('accountsHistoryBody'), count=accEl('accountsHistoryCount'); if(!body)return;
    var trades=(history||[]).filter(accIsTrade).slice().sort(function(a,b){return (accParseMyfxDate(b.closeTime)||0)-(accParseMyfxDate(a.closeTime)||0);});
    if(count)count.textContent=trades.length+' saved trades';
    if(!trades.length){ body.innerHTML='<tr><td class="accounts-empty-row" colspan="8">Закрытые сделки пока не сохранены</td></tr>'; return; }
    body.innerHTML=trades.map(function(t,i){
      var action=String(t.action||'—'), side=/buy/i.test(action)?'buy':(/sell/i.test(action)?'sell':''); var net=accNet(t);
      return '<tr><td class="mono">'+(trades.length-i)+'</td><td>'+accEscape(accDate(t.openTime))+'</td><td>'+accEscape(accDate(t.closeTime))+'</td><td class="mono">'+accEscape(t.symbol||'—')+'</td><td><span class="account-action"><span class="accounts-direction-dot '+side+'"></span>'+accEscape(action)+'</span></td><td class="mono">'+accEscape(t.sizing&&t.sizing.value!=null?t.sizing.value:'—')+'</td><td class="mono '+accTone(net)+'">'+accEscape(accMoney(net,currency))+'</td><td class="mono '+accTone(t.pips)+'">'+accEscape(t.pips==null?'—':accSigned(t.pips,1))+'</td></tr>';
    }).join('');
  }

  function accRenderChart(daily,currency){
    var svg=accEl('accountsChartSvg'), empty=accEl('accountsChartEmpty'); if(!svg||!empty)return;
    var data=accFlatten(daily||[]).filter(function(d){return d&&d.balance!=null;});
    if(data.length<2){ svg.innerHTML=''; svg.style.display='none'; empty.style.display='flex'; accountsState.chartSignature=null; return; }
    svg.style.display='block'; empty.style.display='none';
    var wrap=svg.parentElement,W=Math.max(560,wrap.clientWidth||800),H=Math.max(220,wrap.clientHeight||310),pL=58,pR=12,pT=12,pB=31;
    var values=data.map(function(d){return accNum(d.balance);});
    var min=Math.min.apply(null,values),max=Math.max.apply(null,values); if(min===max){min-=1;max+=1;} var pad=Math.max((max-min)*.1,1); min-=pad; max+=pad;
    function xp(i){return pL+i/Math.max(1,data.length-1)*(W-pL-pR);} function yp(v){return pT+(H-pT-pB)-(v-min)/(max-min)*(H-pT-pB);}
    var balancePts=data.map(function(d,i){return{x:xp(i),y:yp(accNum(d.balance))};});
    var pathFn=typeof window.smoothPath==='function'?window.smoothPath:function(points){return points.map(function(p,i){return(i?'L':'M')+p.x+' '+p.y;}).join(' ');};
    var grid='',labels='',ticks=4;
    for(var i=0;i<=ticks;i++){var val=min+(i/ticks)*(max-min), y=yp(val); grid+='<line class="chart-grid-line" x1="'+pL+'" y1="'+y+'" x2="'+(W-pR)+'" y2="'+y+'" />'; labels+='<text x="4" y="'+(y+4)+'" fill="#7d8798" font-size="11" font-family="TJ Digits, TJ Text, sans-serif">'+accEscape(accChartMoney(val,currency))+'</text>';}
    var xLabels='',xTicks=Math.min(5,data.length-1);
    for(var j=0;j<=xTicks;j++){var pos=Math.round(j/Math.max(1,xTicks)*(data.length-1));xLabels+='<text x="'+xp(pos)+'" y="'+(H-7)+'" fill="#7d8798" font-size="10" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">'+accEscape(accShortDate(data[pos].date))+'</text>';}
    var sig=data.map(function(d){return d.date+':'+d.balance;}).join('|'), noDraw=sig===accountsState.chartSignature?' no-draw':''; accountsState.chartSignature=sig;
    var color=(typeof window.curveColor==='string'&&/^#[0-9a-f]{6}$/i.test(window.curveColor))?window.curveColor:'#34d399';
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    svg.innerHTML=grid+labels+'<path class="accounts-chart-path'+noDraw+'" d="'+pathFn(balancePts)+'" pathLength="1" fill="none" stroke="'+color+'" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>'+xLabels;
    if(!accountsState.chartObserver && typeof ResizeObserver!=='undefined'){
      accountsState.chartObserver=new ResizeObserver(function(){
        if(!accountsState.mode||!accountsState.details)return; if(accountsState.chartResizeFrame)return;
        accountsState.chartResizeFrame=requestAnimationFrame(function(){accountsState.chartResizeFrame=null; accRenderChart(accountsState.details.daily,accountsState.details.account.currency);});
      }); accountsState.chartObserver.observe(wrap);
    }
  }

  function accRenderDetail(details){
    if(!details||!details.account)return;
    var a=details.account,currency=a.currency||'USD',history=details.mergedHistory||[],stats=accHistoryStats(history,a);
    accText('accountsDetailName',a.name||('Account '+a.accountId));
    accText('accountsDetailMeta',accAccountMeta(a)+' · Обновлено в Myfxbook: '+(a.lastUpdateDate?accDate(a.lastUpdateDate):'—'));
    accSetValue('accountsBalance',accMoney(a.balance,currency),a.balance); accText('accountsBalanceSub','Balance · '+currency);
    accSetValue('accountsEquity',accMoney(a.equity,currency),a.equity- a.balance); accText('accountsEquitySub','Equity · '+(a.equityPercent!=null?Number(a.equityPercent).toFixed(1)+'%':'current'));
    accSetValue('accountsProfit',accMoney(a.profit,currency),a.profit); accText('accountsProfitSub',accPercent(a.gain)+' gain');
    accText('accountsTradeCount',stats.trades.length+' trades');
    accRenderStatTiles(stats,currency,a); accRenderOpenTrades(details.openTrades,currency); accRenderHistory(history,currency); accRenderChart(details.daily,currency);
  }

  function accPrepareDetailSwitch(id){
    var conflict=accEl('accountsHistoryConflict');if(conflict)conflict.remove();
    var account=accFindAccount(id), content=accEl('accountsDetailContent'), loading=accEl('accountsDetailLoading');
    accountsState.details=null; accountsState.chartSignature=null;
    if(content){ content.classList.remove('is-loading'); content.classList.add('is-account-switch'); }
    if(loading){ loading.textContent='Загрузка данных аккаунта…'; loading.classList.add('is-visible'); }
    accText('accountsDetailName',account?(account.name||('Account '+account.accountId)):'Account');
    accText('accountsDetailMeta',account?accAccountMeta(account):'—');
  }

  async function accRefreshDetail(id,force){
    id=String(id);
    if(accountsState.loadingDetail && accountsState.loadingDetailId===id && !force)return;
    var requestSeq=++accountsState.detailRequestSeq, requestUid=accCurrentUid();
    accountsState.loadingDetail=true; accountsState.loadingDetailId=id; accSetRefreshBusy(true); accSetError(''); accSetWarning('');
    var content=accEl('accountsDetailContent'), loading=accEl('accountsDetailLoading');
    if(content)content.classList.add('is-loading'); if(loading)loading.classList.add('is-visible');
    try {
      var account=accFindAccount(id);
      if(accountsState.selectedId===id && account){ accText('accountsDetailName',account.name||'Account'); accText('accountsDetailMeta',accAccountMeta(account)); }
      var cached=await accLoadCachedHistory(id,requestUid);
      if(requestSeq!==accountsState.detailRequestSeq || accCurrentUid()!==requestUid || accountsState.selectedId!==id || !accountsState.mode)return;
      var data=await accApi('details',id);
      if(requestSeq!==accountsState.detailRequestSeq || accCurrentUid()!==requestUid || accountsState.selectedId!==id || !accountsState.mode)return;
      var fresh=accFlatten(data.history||[]),merged;
      try{merged=accMergeHistory(id,cached.history,fresh);}catch(conflict){conflict.remoteExpected=cached.remote;throw conflict;}
      try{await accSaveCachedHistory(id,merged,requestUid,cached.remote);}catch(failure){if(failure.code==='HISTORY_CONFLICT')throw failure;var unsaved=accHistoryConflict(id,cached.history,fresh,'Сервер не подтвердил импорт: '+failure.message);unsaved.remoteExpected=cached.remote;throw unsaved;}
      if(requestSeq!==accountsState.detailRequestSeq || accCurrentUid()!==requestUid || accountsState.selectedId!==id || !accountsState.mode)return;
      var details={account:data.account||account,history:fresh,mergedHistory:merged,openTrades:accFlatten(data.openTrades||[]),daily:accFlatten(data.daily||[]),partialErrors:data.partialErrors||[]};
      accountsState.details=details; accRenderDetail(details); accountsState.lastLocalRefresh=new Date();
      if(content)content.classList.remove('is-account-switch');
      accSyncCopy('Обновлено '+accountsState.lastLocalRefresh.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
      if(details.partialErrors&&details.partialErrors.length)accSetWarning('Часть данных Myfxbook задерживается или временно недоступна: '+details.partialErrors.join(' · '));
    } catch(err){
      if(requestSeq!==accountsState.detailRequestSeq || accCurrentUid()!==requestUid || accountsState.selectedId!==id || !accountsState.mode)return;
      if(err&&(err.code==='MYFXBOOK_NOT_CONNECTED'||err.code==='CONNECTION_INVALID')){
        accSaveConnectionToken(''); accountsState.accounts=[];accountsState.listLoaded=false;accountsState.selectedId=null;accountsState.details=null;accountsState.connectionPanelOpen=true;
        accBackToList();accRenderAccounts();accRenderSetup(true);accPopulateSetup();
      } else if(content)content.classList.remove('is-account-switch');
      if(err&&err.code==='HISTORY_CONFLICT')accShowHistoryConflict(err,requestUid);
      accSetError(err.message||'Could not load account statistics.'); accSyncCopy('Не удалось обновить');
    }
    finally {
      if(requestSeq===accountsState.detailRequestSeq){
        accountsState.loadingDetail=false; accountsState.loadingDetailId=null; accSetRefreshBusy(false);
        if(content)content.classList.remove('is-loading'); if(loading)loading.classList.remove('is-visible');
      }
    }
  }

  function accOpenAccount(id){
    id=String(id);
    accountsState.selectedId=id;
    document.body.classList.add('accounts-detail-mode');
    var list=accEl('accountsListView'),detail=accEl('accountDetailView'),content=accEl('accountsDetailContent');
    accPrepareDetailSwitch(id);
    if(list)list.style.display='none'; if(detail)detail.style.display='block';
    accRestartViewAnimation(detail); accRefreshDetail(id,false);
  }
  function accBackToList(){
    accCloseStatInfo(false);
    document.body.classList.remove('accounts-detail-mode');
    accountsState.detailRequestSeq++;
    accountsState.selectedId=null; accountsState.details=null; accountsState.chartSignature=null; accountsState.loadingDetail=false; accountsState.loadingDetailId=null;
    var content=accEl('accountsDetailContent'),loading=accEl('accountsDetailLoading');
    if(content)content.classList.remove('is-loading','is-account-switch'); if(loading)loading.classList.remove('is-visible');
    accSetRefreshBusy(false);
    var list=accEl('accountsListView'),detail=accEl('accountDetailView'); if(detail)detail.style.display='none'; if(list)list.style.display='block'; accRestartViewAnimation(list);
  }
  function accEnterWorkspace(){
    if(!accCanUseAccounts())return;
    if(typeof window.exitNotesWorkspace==='function'&&document.body.classList.contains('notes-workspace-mode'))window.exitNotesWorkspace(true);
    document.body.classList.remove('backtest-workspace-mode','backtest-detail-mode','backtest-input-panel-collapsed');
    var sw=accEl('settingsWrap'); if(sw)sw.classList.remove('open'); var sb=accEl('settingsBtn'); if(sb)sb.setAttribute('aria-expanded','false'); if(typeof window.setSecondaryActions==='function')window.setSecondaryActions(false);
    accountsState.mode=true; document.body.classList.remove('accounts-detail-mode'); document.body.classList.add('accounts-workspace-mode'); var ws=accEl('accountsWorkspace'); if(ws)ws.setAttribute('aria-hidden','false');
    accBackToList(); accRestartViewAnimation(ws); accRefreshAccounts(false);
  }
  function accExitWorkspace(){
    accCloseStatInfo(false);
    accountsState.mode=false; accountsState.listRequestSeq++; accountsState.detailRequestSeq++; accountsState.loadingList=false; accountsState.loadingDetail=false; accountsState.loadingDetailId=null; accSetRefreshBusy(false);
    document.body.classList.remove('accounts-workspace-mode','accounts-detail-mode'); var ws=accEl('accountsWorkspace'); if(ws)ws.setAttribute('aria-hidden','true'); accSetError(''); accSetWarning('');
  }
  function accSyncMenuVisibility(){
    var allowed=accCanUseAccounts(), row=accEl('openAccountsWorkspaceBtn');
    if(row)row.style.display=allowed?'flex':'none';
    if(!allowed&&accountsState.mode)accExitWorkspace();
    accPopulateSetup();
  }

  function accBind(){
    var open=accEl('openAccountsWorkspaceBtn'); if(open)open.addEventListener('click',function(e){e.stopPropagation();accEnterWorkspace();});
    var exit=accEl('exitAccountsWorkspaceBtn'); if(exit)exit.addEventListener('click',accExitWorkspace);
    var back=accEl('accountsBackToListBtn'); if(back)back.addEventListener('click',accBackToList);
    var refresh=accEl('accountsRefreshBtn'); if(refresh)refresh.addEventListener('click',function(){ if(accountsState.selectedId)accRefreshDetail(accountsState.selectedId,true); else accRefreshAccounts(true); });
    var connectionBtn=accEl('accountsConnectionBtn');
    if(connectionBtn)connectionBtn.addEventListener('click',function(){
      accountsState.connectionPanelOpen=!accountsState.connectionPanelOpen;
      accRenderSetup(accountsState.connectionPanelOpen||!accConnectionToken());
    });
    var connectBtn=accEl('accountsMyfxConnectBtn'),disconnectBtn=accEl('accountsMyfxDisconnectBtn'),passwordInput=accEl('accountsMyfxPasswordInput');
    if(connectBtn)connectBtn.addEventListener('click',accConnectMyfxbook);
    if(disconnectBtn)disconnectBtn.addEventListener('click',accDisconnectMyfxbook);
    if(passwordInput)passwordInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();accConnectMyfxbook();}});
    var grid=accEl('accountsGrid'); if(grid)grid.addEventListener('click',function(e){var card=e.target.closest('.account-card'); if(card&&grid.contains(card))accOpenAccount(card.getAttribute('data-account-id'));});
    var statGrid=accEl('accountsStatGrid'); if(statGrid)statGrid.addEventListener('click',function(e){var tile=e.target.closest('.accounts-stat-tile'); if(tile&&statGrid.contains(tile))accOpenStatInfo(tile.getAttribute('data-stat-key'),tile.getAttribute('data-stat-value')||'—',tile);});
    var statOverlay=accEl('accountsStatInfoOverlay'),statClose=accEl('accountsStatInfoClose');
    if(statClose)statClose.addEventListener('click',function(){accCloseStatInfo(true);});
    if(statOverlay)statOverlay.addEventListener('click',function(e){if(e.target===statOverlay)accCloseStatInfo(true);});
    document.addEventListener('keydown',function(e){ if(e.key!=='Escape'||!accountsState.mode)return; if(accStatInfoOpen()){e.preventDefault();accCloseStatInfo(true);return;} if(accountsState.selectedId)accBackToList(); else accExitWorkspace(); });
    if(typeof firebase!=='undefined'&&firebase.auth&&firebase.auth().onAuthStateChanged)firebase.auth().onAuthStateChanged(function(){
      var conflict=accEl('accountsHistoryConflict');if(conflict)conflict.remove();
      accountsState.listRequestSeq++; accountsState.detailRequestSeq++; accountsState.loadingList=false; accountsState.loadingDetail=false; accountsState.loadingDetailId=null; accountsState.connecting=false;
      accountsState.accounts=[];accountsState.listLoaded=false;accountsState.selectedId=null;accountsState.details=null;accountsState.connectionPanelOpen=false;
      accSetRefreshBusy(false); accSyncMenuVisibility(); if(accountsState.mode)accRefreshAccounts(false);
    });
    accSyncMenuVisibility();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',accBind); else accBind();

  window.TJAccounts={
    enter:accEnterWorkspace,exit:accExitWorkspace,refresh:function(){return accountsState.selectedId?accRefreshDetail(accountsState.selectedId,true):accRefreshAccounts(true);},
    state:accountsState
  };
})();
