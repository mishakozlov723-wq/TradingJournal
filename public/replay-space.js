/* Trading Journal — Replay Space (v3: trading + Backtest Space bridge; fullscreen session, loading curtain, M5 for every year since 2013)
   Self-contained module (same pattern as accounts-space.js): builds its own workspace section,
   opens from Settings → Workspace → Replay.
   v1 scope: asset + date range selection, price loading (H1 since 2003, M5 for the last ~3 years),
   all timeframes, bar-by-bar replay, progress ("days tested"). Trading, rewind-cut, customisation,
   drawing tools and the Backtest Space bridge come in the next steps. */
(function(){
  'use strict';

  /* tier 1 — always visible; tier 2 — collapsible "Tier 2 assets" section, shown once the quotes site publishes them */
  var ASSETS = [
    { name:'EURUSD', color:'#a78bfa', label:'EUR / USD', tier:1 },
    { name:'GBPUSD', color:'#fbbf24', label:'GBP / USD', tier:1 },
    { name:'XAUUSD', color:'#22d3ee', label:'Gold', tier:1 },
    { name:'GER40',  color:'#f472b6', label:'DAX 40', tier:1 },
    { name:'USDJPY', color:'#60a5fa', label:'USD / JPY', tier:2 },
    { name:'XAGUSD', color:'#cbd5e1', label:'Silver', tier:2 },
    { name:'USDCAD', color:'#fb923c', label:'USD / CAD', tier:2 },
    { name:'NZDUSD', color:'#4ade80', label:'NZD / USD', tier:2 },
    { name:'USDCHF', color:'#e879f9', label:'USD / CHF', tier:2 }
  ];
  var TIER2_KEY = 'tj_replay_tier2_open';
  var DATA_BASE = window.TJ_REPLAY_DATA_BASE || 'replay-data/';
  if(DATA_BASE.charAt(DATA_BASE.length-1)!=='/') DATA_BASE+='/';
  var TFS = [
    { id:'5m',  label:'5m',  intraday:true },
    { id:'15m', label:'15m', intraday:true },
    { id:'30m', label:'30m', intraday:true },
    { id:'1h',  label:'1H' },
    { id:'4h',  label:'4H' },
    { id:'1D',  label:'1D' },
    { id:'1W',  label:'1W' },
    { id:'1M',  label:'1M' },
    { id:'3M',  label:'3M' }
  ];
  var STYLE_DEFAULT = {
    body:{ on:true, up:'#34d399', down:'#f87171' },
    border:{ on:false, up:'#34d399', down:'#f87171' },
    wick:{ on:true, up:'#34d399', down:'#f87171' },
    fvg:{ on:false, up:'rgba(52,211,153,0.20)', down:'rgba(248,113,113,0.20)', mid:{ on:false, color:'rgba(255,255,255,0.65)', width:1, style:'solid' } },
    currentPrice:{ line:{ on:true, color:'rgba(117,134,150,0.65)', width:1, style:'dashed' }, label:{ on:true, color:'rgba(52,211,153,0.90)', text:'#0c0e13' } },
    bg:'#0c0e13',
    gridV:{ on:true, color:'rgba(255,255,255,0.045)', style:'solid' },
    gridH:{ on:true, color:'rgba(255,255,255,0.045)', style:'solid' },
    cross:{ color:'#758696', width:1, style:'dashed' },
    scale:{ text:'#8b95a1', size:12, line:'rgba(255,255,255,0.08)' },
    /* Long / Short position boxes: stored apart from chart templates (see savePosStyle) */
    pos:{
      long:{ line:{ color:'rgba(220,226,235,0.85)', style:'solid', width:1 }, stop:'rgba(248,113,113,0.15)', target:'rgba(52,211,153,0.15)', text:{ color:'#0b0f14', size:11 } },
      short:{ line:{ color:'rgba(220,226,235,0.85)', style:'solid', width:1 }, stop:'rgba(248,113,113,0.15)', target:'rgba(52,211,153,0.15)', text:{ color:'#0b0f14', size:11 } }
    }
  };

  var S = {
    shown:{}, rewind:false, cut:null, anim:null, speed:1, stepTf:'auto', tz:'UTC', menuFor:null, menuPick:null, models:[],
    mode:false, meta:null, metaPromise:null, tl:null, selected:'XAUUSD',
    sess:null, chart:null, series:null, tf:'1D', playing:null, hideDate:false, style:JSON.parse(JSON.stringify(STYLE_DEFAULT)), built:false, set:null, save:null, profiles:[], profState:'ok', ctxOpen:false
  };

  var SPEEDS = [20,10,5,2,1,0.5];
  var SVG_A = '<svg class="rp-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">';
  var ICON_PLAY  = SVG_A+'<path fill="currentColor" d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/></svg>';
  var ICON_PAUSE = SVG_A+'<rect x="6" y="5" width="4.2" height="14" rx="1.1" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.1" fill="currentColor"/></svg>';
  var ICON_STEP  = SVG_A+'<path fill="currentColor" d="M4.5 5.1v13.8a.8.8 0 0 0 1.2.7l10.9-6.9a.8.8 0 0 0 0-1.4L5.7 4.4a.8.8 0 0 0-1.2.7z"/><rect x="18" y="5" width="2.4" height="14" rx="1" fill="currentColor"/></svg>';
  var ICON_CUT   = '<svg class="rp-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>';
  var ICON_CHEV  = '<svg class="rp-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
  var CTL_KEY = 'tj_replay_ctl';
  var TZS = [
    { id:'UTC', label:'UTC',       zone:'UTC' },
    { id:'NY',  label:'New York',  zone:'America/New_York' },
    { id:'TYO', label:'Tokyo',     zone:'Asia/Tokyo' },
    { id:'MSK', label:'Moscow',    zone:'Europe/Moscow' }
  ];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ---------- helpers ---------- */
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];}); }
  function uid(){ try { var u=firebase.auth().currentUser; return u?u.uid:null; } catch(_){ return null; } }
  function pad(n){ return (n<10?'0':'')+n; }
  function fmtDate(ts, withTime){
    var d=new Date(ts*1000);
    return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+(withTime?' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()):'');
  }
  function dateToTs(str){ return Math.floor(Date.parse(str+'T00:00:00Z')/1000); }
  /* ---- time zone of the clock / axis (only intraday bars are real instants; 1D+ bars are date labels and stay as is) ---- */
  var tzFmt={};
  function tzById(id){ for(var i=0;i<TZS.length;i++) if(TZS[i].id===id) return TZS[i]; return TZS[0]; }
  function tzParts(ts,zone){
    zone=zone||tzById(S.tz).zone;
    var f=tzFmt[zone]||(tzFmt[zone]=new Intl.DateTimeFormat('en-GB',{ timeZone:zone, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })), o={};
    f.formatToParts(new Date(ts*1000)).forEach(function(p){ o[p.type]=+p.value; });
    if(o.hour===24) o.hour=0;
    return o;
  }
  function tzTagFor(id,ts){
    if(id==='UTC') return 'UTC';
    var o=tzParts(ts,tzById(id).zone), off=Math.round((Date.UTC(o.year,o.month-1,o.day,o.hour,o.minute)/1000-Math.floor(ts/60)*60)/60), a=Math.abs(off);
    return 'UTC'+(off<0?'−':'+')+Math.floor(a/60)+(a%60?':'+pad(a%60):'');
  }
  function tzTag(ts){ return tzTagFor(S.tz,ts); }
  function fmtTz(ts,withTime){
    if(S.tz==='UTC') return fmtDate(ts,withTime);
    var o=tzParts(ts); return o.year+'-'+pad(o.month)+'-'+pad(o.day)+(withTime?' '+pad(o.hour)+':'+pad(o.minute):'');
  }
  function isIntra(tf){ return tf==='5m'||tf==='15m'||tf==='30m'||tf==='1h'||tf==='4h'; }
  function fmtAxis(t){ return isIntra(S.tf)?fmtTz(t,true):fmtDate(t,true); }
  function tickFmt(t){
    if(S.tz==='UTC'||!isIntra(S.tf)||typeof t!=='number') return null;
    var o=tzParts(t);
    if(o.hour===0&&o.minute===0){ if(o.month===1&&o.day===1) return String(o.year); if(o.day===1) return MON[o.month-1]; return String(o.day); }
    return pad(o.hour)+':'+pad(o.minute);
  }
  function assetInfo(name){ for(var i=0;i<ASSETS.length;i++) if(ASSETS[i].name===name) return ASSETS[i]; return ASSETS[0]; }
  function lowerBound(arr, v, n){ var lo=0, hi=(n==null?arr.length:n); while(lo<hi){ var m=(lo+hi)>>1; if(arr[m]<v) lo=m+1; else hi=m; } return lo; }

  /* ---------- data ---------- */
  function loadMeta(){
    if(S.metaPromise) return S.metaPromise;
    S.metaPromise = fetch(DATA_BASE+'meta.json',{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('meta'); return r.json(); }).then(function(m){
      if(!m||!m.instruments||!m.generated) throw new Error('Invalid quote data.');
      ASSETS.forEach(function(a){ var v=m.instruments[a.name]; if(!v&&a.tier===2) return; if(!v||!v.h1||!v.h1.n||!v.scale||!Array.isArray(v.m5Years)) throw new Error('Invalid quote data.'); });
      if(!S.meta||S.meta.generated!==m.generated){ rawCache={}; S.tl=null; }
      S.meta=m; return m;
    }).finally(function(){ S.metaPromise=null; });
    return S.metaPromise;
  }
  function fetchBin(url,expected,scale){
    return fetch(url,{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('Could not load quotes.'); return r.arrayBuffer(); }).then(function(buf){
      if(buf.byteLength<16) throw new Error('Corrupted quote file.');
      var h=new Int32Array(buf,0,4), n=h[0], sc=h[1], a=new Int32Array(buf,16);
      if(n<1||buf.byteLength!==16+n*20||sc!==scale||(expected&&(n!==expected.n||a[0]!==expected.first||a[n-1]!==expected.last))) throw new Error('Quotes were updated. Go back to Replay and open the period again.');
      var data={ n:n, sc:sc, t:a.subarray(0,n), o:a.subarray(n,2*n), h:a.subarray(2*n,3*n), l:a.subarray(3*n,4*n), c:a.subarray(4*n,5*n) };
      if(expected&&expected.sha256&&window.crypto&&window.crypto.subtle){
        return window.crypto.subtle.digest('SHA-256',buf).then(function(hash){
          var hex=Array.from(new Uint8Array(hash)).map(function(x){ return x.toString(16).padStart(2,'0'); }).join('');
          if(hex!==expected.sha256) throw new Error('Quotes were updated. Go back to Replay and open the period again.');
          return data;
        });
      }
      return data;
    });
  }
  var rawCache={};
  function getBin(asset,suffix){
    var file=asset.toLowerCase()+'_'+suffix+'.bin', m=instMeta(asset), version=S.meta&&S.meta.generated||'', expected=S.meta&&S.meta.files&&S.meta.files[file];
    if(!expected&&suffix==='h1') expected=m&&m.h1;
    var k=asset+':'+suffix+':'+version;
    if(!rawCache[k]) rawCache[k]=fetchBin(DATA_BASE+file+'?v='+encodeURIComponent(expected&&expected.sha256||version),expected,m&&m.scale).catch(function(e){ delete rawCache[k]; throw e; });
    return rawCache[k];
  }
  /* One mixed-resolution timeline: H1 bars until the first loaded M5 bar, M5 bars afterwards.
     M5 files are yearly, so only the years touched by the chosen period (plus ~60 days of context) are downloaded. */
  function loadSession(asset,startTs,endTs){
    var m=instMeta(asset), y0=new Date((startTs-60*86400)*1000).getUTCFullYear(), y1=new Date(endTs*1000).getUTCFullYear();
    var years=((m&&m.m5Years)||[]).filter(function(y){ return y>=y0&&y<=y1; });
    var key=asset+'|'+years.join(',')+'|'+(S.meta&&S.meta.generated||'');
    if(S.tl&&S.tl.key===key) return Promise.resolve(S.tl.d);
    return Promise.all([getBin(asset,'h1')].concat(years.map(function(y){ return getBin(asset,'m5_'+y); }))).then(function(r){
      var h1=r[0], m5=r.slice(1), sc=h1.sc, m5n=0; m5.forEach(function(x){ m5n+=x.n; });
      var cut = m5n ? lowerBound(h1.t, m5[0].t[0], h1.n) : h1.n, n=cut+m5n;
      var T=new Float64Array(n), O=new Float64Array(n), H=new Float64Array(n), L=new Float64Array(n), C=new Float64Array(n), D=new Uint16Array(n), i, k;
      for(i=0;i<cut;i++){ T[i]=h1.t[i]; O[i]=h1.o[i]/sc; H[i]=h1.h[i]/sc; L[i]=h1.l[i]/sc; C[i]=h1.c[i]/sc; D[i]=3600; }
      k=cut; m5.forEach(function(x){ for(var j=0;j<x.n;j++,k++){ T[k]=x.t[j]; O[k]=x.o[j]/sc; H[k]=x.h[j]/sc; L[k]=x.l[j]/sc; C[k]=x.c[j]/sc; D[k]=300; } });
      var d={ name:asset, n:n, T:T, O:O, H:H, L:L, C:C, D:D, m5Idx:cut, m5Start:m5n?m5[0].t[0]:null, buckets:{}, dp:(m&&m.dp)||2, shifted:null };
      S.tl={ key:key, d:d }; return d;
    });
  }

  /* ---------- time buckets ---------- */
  var dstCache={};
  function nyOff(ts){
    var y=new Date(ts*1000).getUTCFullYear(), c=dstCache[y];
    if(!c){
      var nth=function(m,dow,k){ var d=Date.UTC(y,m,1),cnt=0; for(;;){ if(new Date(d).getUTCDay()===dow && ++cnt===k) return d; d+=864e5; } };
      var last=function(m,dow){ var d=Date.UTC(y,m+1,0); while(new Date(d).getUTCDay()!==dow) d-=864e5; return d; };
      var st = y<2007 ? nth(3,0,1) : nth(2,0,2), en = y<2007 ? last(9,0) : nth(10,0,1);
      c=dstCache[y]=[st/1000+7*3600, en/1000+6*3600];
    }
    return (ts>=c[0] && ts<c[1]) ? 4 : 5;
  }
  /* trading day starts 17:00 New York */
  function shiftedTimes(d){
    if(d.shifted) return d.shifted;
    var s=new Float64Array(d.n);
    for(var i=0;i<d.n;i++) s[i]=d.T[i]-nyOff(d.T[i])*3600+25200;
    return d.shifted=s;
  }
  function buckets(d, tfId){
    if(d.buckets[tfId]) return d.buckets[tfId];
    var n=d.n, T=d.T, sh=shiftedTimes(d), F=[], La=[], Tm=[], b2=new Int32Array(n).fill(-1), prev=null;
    var intraday = tfId==='5m'||tfId==='15m'||tfId==='30m';
    var startI = intraday ? d.m5Idx : 0;
    for(var i=startI;i<n;i++){
      var s=sh[i], day=Math.floor(s/86400), key, tm, ymd;
      switch(tfId){
        case '5m':  key=T[i]; break;
        case '15m': key=Math.floor(T[i]/900); break;
        case '30m': key=Math.floor(T[i]/1800); break;
        case '1h':  key=Math.floor(T[i]/3600); break;
        case '4h':  key=day*6+Math.floor((s%86400)/14400); break;
        case '1D':  key=day; break;
        case '1W':  key=Math.floor((day+3)/7); break;
        case '1M':  ymd=new Date(day*864e5); key=ymd.getUTCFullYear()*12+ymd.getUTCMonth(); break;
        case '3M':  ymd=new Date(day*864e5); key=ymd.getUTCFullYear()*4+Math.floor(ymd.getUTCMonth()/3); break;
      }
      if(key!==prev){
        F.push(i); La.push(i); prev=key;
        switch(tfId){
          case '1D': tm=day*86400; break;
          case '1W': tm=(key*7-3)*86400; break;
          case '1M': tm=Date.UTC(Math.floor(key/12),key%12,1)/1000; break;
          case '3M': tm=Date.UTC(Math.floor(key/4),(key%4)*3,1)/1000; break;
          default:   tm=T[i];
        }
        Tm.push(tm);
      } else La[La.length-1]=i;
      b2[i]=F.length-1;
    }
    return d.buckets[tfId]={F:F,La:La,Tm:Tm,b2:b2};
  }
  function barAt(d,bk,b,cur){
    var a=bk.F[b], z=Math.min(bk.La[b],cur), h=d.H[a], l=d.L[a];
    for(var i=a+1;i<=z;i++){ if(d.H[i]>h) h=d.H[i]; if(d.L[i]<l) l=d.L[i]; }
    return { time:bk.Tm[b], open:d.O[a], high:h, low:l, close:d.C[z] };
  }

  /* ---------- UI build ---------- */
  function buildDom(){
    if(S.built) return; S.built=true;
    var anchor=$('accountsWorkspace');
    var sec=document.createElement('section');
    sec.className='replay-workspace'; sec.id='replayWorkspace'; sec.setAttribute('aria-hidden','true');
    sec.innerHTML=
      '<div class="rp-header"><div class="rp-identity">'+
        '<button class="back-link" id="exitReplayWorkspaceBtn" type="button" style="margin:0"><span class="back-arrow" style="font-size:15px;"><svg class="tj-ui-icon" data-icon="arrow-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></span> Back to Journal</button>'+
        '<div class="rp-title">Replay Space</div></div></div>'+
      '<div id="rpLobby" class="rp-view">'+
        '<div id="rpResume"></div>'+
        '<div class="rp-assets" id="rpAssets"></div>'+
        '<details class="rp-tier2" id="rpTier2" hidden><summary class="rp-tier2-head"><span>Tier 2 assets</span><span class="rp-tier2-count" id="rpTier2Count"></span>'+ICON_CHEV+'</summary>'+
        '<div class="rp-assets rp-assets-t2" id="rpAssets2"></div></details>'+
        '<div class="rp-card"><div class="rp-form-row">'+
          '<div class="rp-field"><label for="rpRangeBtn">Backtest period</label><button class="rp-input rp-range-btn" id="rpRangeBtn" type="button">Select dates…</button>'+
          '<input type="hidden" id="rpStart"><input type="hidden" id="rpEnd"></div>'+
          '<div class="rp-range-note" id="rpRangeNote"></div>'+
          '<button class="rp-primary" id="rpStartBtn" type="button">Start replay</button>'+
        '</div><div class="rp-error" id="rpError" role="status"></div>'+
        '</div>'+
      '</div>';
    if(anchor&&anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor.nextSibling); else document.body.appendChild(sec);

    /* Fullscreen session lives directly under <body> so no ancestor can clip or transform it. */
    var ses=document.createElement('div');
    ses.className='rp-session'; ses.id='rpSession'; ses.setAttribute('aria-hidden','true');
    ses.innerHTML=
      '<div class="rp-topbar">'+
        '<button class="rp-btn rp-back" id="rpExitBtn" type="button" title="Back to Replay Space (progress is saved)"><span class="back-arrow"><svg class="tj-ui-icon" data-icon="arrow-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></span> Replay Space</button>'+
        '<span class="rp-chip" id="rpAssetChip"><i></i><span></span></span>'+
        '<div class="rp-progress"><div class="rp-progress-text"><span id="rpDayText"></span><span id="rpDateText"></span></div><div class="rp-progress-track"><div class="rp-progress-fill" id="rpProgressFill"></div></div></div>'+
        '<div class="rp-seg" id="rpTfs"></div>'+
        '<span class="rp-spacer"></span>'+
        '<button class="rp-btn" id="rpSessBtn" type="button" title="Trading sessions on the chart (Asia, Frankfurt, London, New York)">Sessions</button>'+
        '<button class="rp-btn" id="rpFvgBtn" type="button" aria-pressed="false" title="Show three-candle imbalances (FVG)">imb-detector</button>'+
        '<button class="rp-btn" id="rpHideDate" type="button" title="Hide dates on the chart">Hide dates</button>'+
        '<button class="rp-btn" id="rpFsBtn" type="button" title="Browser full screen">⛶</button>'+
      '</div>'+
      '<div class="rp-chart-card"><div class="rp-legend" id="rpLegend"></div><div id="rpChart"></div><div class="rp-banner" id="rpBanner"></div><div class="rp-toast" id="rpToast"></div>'+
        '<div class="rp-trade" id="rpTrade">'+
          '<div class="rp-trade-head"><span>Trade</span><button class="rp-mini" id="rpTradeToggle" type="button" title="Collapse / expand"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5 5 6.5 8 3.5"/></svg></button></div>'+
          '<div class="rp-collapse is-open" id="rpPanelWrap"><div class="rp-collapse-in"><div class="rp-trade-body">'+
            '<div class="rp-trade-btns"><button class="rp-long" id="rpLong" type="button">Long</button><button class="rp-short" id="rpShort" type="button">Short</button></div>'+
            '<div class="rp-collapse" id="rpDraftWrap"><div class="rp-collapse-in"><div class="rp-draft" id="rpDraftBox">'+
              '<div class="rp-draft-title" id="rpDraftTitle"></div>'+
              '<div class="rp-draft-grid"><label>Entry<input class="rp-input" id="rpInEntry" type="text" inputmode="decimal" autocomplete="off"></label><label>SL<input class="rp-input" id="rpInSL" type="text" inputmode="decimal" autocomplete="off"></label><label>TP<input class="rp-input" id="rpInTP" type="text" inputmode="decimal" autocomplete="off"></label></div>'+
              '<div class="rp-muted rp-draft-info" id="rpDraftInfo"></div>'+
              '<div class="rp-draft-hint">Drag the entry / SL / TP lines on the chart</div><div class="rp-draft-hint" title="OHLC candles do not reveal the intrabar price sequence. A pending entry and its exit may use the same candle range.">OHLC simulation · SL wins if SL and TP touch in one candle · entry candle uses its full range</div>'+
              '<div class="rp-draft-actions"><button class="rp-primary" id="rpDraftOk" type="button">Open</button><button class="rp-btn" id="rpDraftCancel" type="button">Cancel</button></div>'+
            '</div></div></div>'+
            '<div class="rp-trade-row"><label for="rpRisk">Risk, %</label><input class="rp-input" id="rpRisk" type="text" inputmode="decimal" autocomplete="off" value="1"></div>'+
            '<div class="rp-trade-row" id="rpModelRow"><label for="rpModel">Model</label><button class="rp-input rp-dd" id="rpModelBtn" type="button"><span></span>'+ICON_CHEV+'</button><input type="hidden" id="rpModel" value=""></div>'+
            '<div class="rp-poslist" id="rpPosList"></div>'+
            '<div class="rp-stats" id="rpStats"></div>'+
          '</div></div></div></div>'+
      '</div>'+
      '<div class="rp-bottombar"><div class="rp-ctl">'+
        '<button class="rp-cbtn" id="rpBtnCut" type="button" title="Cut: hover a candle and click — the chart is cut there (Esc — cancel)">'+ICON_CUT+'<span>Cut</span></button>'+
        '<i class="rp-sep"></i>'+
        '<button class="rp-cbtn rp-ico" id="rpBtnPlay" type="button" title="Play / pause (Space)">'+ICON_PLAY+'</button>'+
        '<button class="rp-cbtn rp-ico" id="rpBtnStep" type="button" title="Step forward (→)">'+ICON_STEP+'</button>'+
        '<i class="rp-sep"></i>'+
        '<button class="rp-cbtn" id="rpSpeedBtn" type="button" title="Simulation speed"><span>1x</span></button>'+
        '<button class="rp-cbtn" id="rpStepBtn" type="button" title="Simulation step"><span>Auto</span></button>'+
      '</div>'+
      '<button class="rp-clock" id="rpClockBtn" type="button" title="Chart time · click to choose a time zone"><span>--:--</span></button>'+
      '</div>'+
      '<div class="rp-menu" id="rpMenu"></div>';
    document.body.appendChild(ses);

    /* Loading curtain — same look as the Notes space intro. */
    var cur=document.createElement('div');
    cur.className='rp-curtain'; cur.id='rpCurtain'; cur.setAttribute('aria-hidden','true');
    cur.innerHTML='<div class="rp-curtain-stack"><div class="rp-curtain-mark"><span>Your Replay Space</span></div><div class="rp-curtain-track" aria-hidden="true"><div class="rp-curtain-progress"></div></div></div>';
    document.body.appendChild(cur);

    var card=function(a){
      return '<button class="rp-asset" type="button" data-asset="'+a.name+'" style="--rp-color:'+a.color+'"><span class="rp-asset-dot"></span><div class="rp-asset-name">'+a.name+'</div><div class="rp-asset-meta" data-meta="'+a.name+'">'+a.label+'</div></button>';
    };
    $('rpAssets').innerHTML=ASSETS.filter(function(a){ return a.tier===1; }).map(card).join('');
    $('rpAssets2').innerHTML=ASSETS.filter(function(a){ return a.tier===2; }).map(card).join('');
    try { $('rpTier2').open=localStorage.getItem(TIER2_KEY)==='1'; } catch(_){}
    $('rpTier2').addEventListener('toggle',function(){ try { localStorage.setItem(TIER2_KEY,this.open?'1':'0'); } catch(_){} });
    $('rpTfs').innerHTML=TFS.map(function(t){ return '<button type="button" data-tf="'+t.id+'">'+t.label+'</button>'; }).join('');

    var pickAsset=function(e){ var b=e.target.closest('.rp-asset'); if(b&&!b.disabled){ S.selected=b.getAttribute('data-asset'); syncLobby(); getBin(S.selected,'h1').catch(function(){}); } };
    $('rpAssets').addEventListener('click',pickAsset);
    $('rpAssets2').addEventListener('click',pickAsset);
    $('rpStartBtn').addEventListener('click',startFromLobby);
    $('exitReplayWorkspaceBtn').addEventListener('click',function(){ exitWorkspace(false); });
    $('rpExitBtn').addEventListener('click',toLobby);
    $('rpRangeBtn').addEventListener('click',pickRange);
    bindResume(); bindTradeUi(); bindChartDrag(); bindDrawing(); bindContextMenu(); buildDrawDom();
    $('rpFsBtn').addEventListener('click',toggleBrowserFullscreen);
    $('rpTfs').addEventListener('click',function(e){ var b=e.target.closest('button[data-tf]'); if(b&&!b.disabled) setTF(b.getAttribute('data-tf')); });
    $('rpBtnStep').addEventListener('click',stepTF);
    $('rpBtnPlay').addEventListener('click',togglePlay);
    $('rpBtnCut').addEventListener('click',function(){ setRewind(!S.rewind); });
    $('rpSpeedBtn').addEventListener('click',openSpeedMenu);
    $('rpStepBtn').addEventListener('click',openStepMenu);
    $('rpModelBtn').addEventListener('click',openModelMenu);
    $('rpClockBtn').addEventListener('click',openTzMenu);
    $('rpMenu').addEventListener('click',function(e){ var it=e.target.closest('.rp-menu-item'); if(!it||it.disabled) return; var f=S.menuPick, v=it.getAttribute('data-v'); closeMenu(); if(f) f(v); });
    document.addEventListener('pointerdown',function(e){ if(S.menuFor&&!e.target.closest('#rpMenu,#rpSpeedBtn,#rpStepBtn,#rpModelBtn,#rpClockBtn')) closeMenu(); },true);
    window.addEventListener('resize',function(){ if(S.menuFor) closeMenu(); });
    loadCtl(); updateCtlButtons();
    $('rpFvgBtn').addEventListener('click',function(){ S.style.fvg.on=!S.style.fvg.on; setPref({ fvg:cloneStyle(S.style.fvg) }); updateSessBtn(); requestDraw(); });
    $('rpSessBtn').addEventListener('click',function(){ var cfg=sessCfg(); cfg.on=!cfg.on; setPref({ ind:cloneStyle(cfg) }); updateSessBtn(); requestDraw(); });
    $('rpHideDate').addEventListener('click',function(){ S.hideDate=!S.hideDate; $('rpHideDate').classList.toggle('is-on',S.hideDate); applyHideDate(); refreshHud(); });
    document.addEventListener('keydown',onKey);
    document.addEventListener('visibilitychange',function(){ if(document.hidden&&S.sess){ flushDays(); saveSession(); drFlush(); stFlush(); } });
    window.addEventListener('pagehide',function(){ if(S.sess){ flushDays(); saveSession(); drFlush(); stFlush(); } });
  }
  function toggleBrowserFullscreen(){
    try {
      if(document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch(_){}
  }

  /* ---------- curtain ---------- */
  var curtainRun=0, curtainTimer=null;
  function curtainFull(begin){
    var ov=$('rpCurtain'); if(!ov){ begin(function(){}); return; }
    var run=++curtainRun, started=0, revealed=false; clearTimeout(curtainTimer);
    ov.className='rp-curtain'; void ov.offsetWidth; ov.classList.add('open'); ov.setAttribute('aria-hidden','false');
    var prog=ov.querySelector('.rp-curtain-progress'); prog.style.animation='none'; prog.style.transform='scaleX(0)';
    function leave(){
      if(run!==curtainRun) return;
      ov.classList.add('ready','leaving');
      setTimeout(function(){ if(run!==curtainRun) return; ov.className='rp-curtain'; ov.setAttribute('aria-hidden','true'); },260);
    }
    function reveal(){
      if(revealed||run!==curtainRun) return; revealed=true;
      curtainTimer=setTimeout(leave, Math.max(0,1700-(Date.now()-started)));
    }
    function startLoading(){
      if(run!==curtainRun) return;
      ov.classList.add('loading'); started=Date.now(); void prog.offsetWidth;
      prog.style.animation='rpCurtainProgress 1.7s cubic-bezier(.16,1,.3,1) forwards';
      begin(reveal);
    }
    /* hold the cover for a beat so the old screen is fully hidden before the layout switches */
    curtainTimer=setTimeout(startLoading,420);
  }
  function curtainQuick(done){
    var ov=$('rpCurtain'); if(!ov){ done(); return; }
    var run=++curtainRun; clearTimeout(curtainTimer);
    ov.className='rp-curtain'; void ov.offsetWidth; ov.classList.add('open'); ov.setAttribute('aria-hidden','false');
    curtainTimer=setTimeout(function(){
      if(run!==curtainRun) return; done();
      requestAnimationFrame(function(){ if(run!==curtainRun) return; ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); });
    },300);
  }

  /* ---------- lobby ---------- */
  /* every unfinished backtest session is kept on this device under its own key, so several can wait to be continued */
  var SES_PREFIX='tj_replay_sess_';
  function sesPrefix(){ var u=uid(); return u?SES_PREFIX+u+'_':''; }
  function sesKey(sid){ var p=sesPrefix(); return p&&sid?p+sid:''; }
  function sessionDone(s){ return s.cur>=s.endIdx; }
  function sessionEmpty(s){ return s.cur<=s.startIdx&&!s.btId&&!(s.pos&&s.pos.length)&&!(s.drawings&&s.drawings.length); }
  function stateOf(s){ return { sid:s.sid, asset:s.asset, startTs:s.startTs, endTs:s.endTs, curT:s.d.T[s.cur], tf:S.tf, btId:s.btId||null, pos:s.pos||[], maxT:s.d.T[Math.max(s.maxIdx,s.cur)] }; }
  function saveSession(){
    var s=S.sess; if(!s) return; if(!s.sid) s.sid=newId();
    var k=sesKey(s.sid); if(!k) return;
    if(s.btId) stSchedule();
    /* a finished backtest, or one that has not moved at all, is not kept */
    if(sessionDone(s)||sessionEmpty(s)){ try { localStorage.removeItem(k); } catch(_){} return; }
    try { var st=stateOf(s); st.upd=Date.now(); st.drawings=S.dr&&S.dr.op&&S.dr.op.pre?JSON.parse(S.dr.op.pre):(s.drawings||[]); st.drawAt=s.drawAt||0; localStorage.setItem(k, JSON.stringify(st)); } catch(_){}
  }
  /* the same state is mirrored into the backtest document, so the card follows the backtest to other devices and is gone when the backtest is deleted */
  var ST_TM=null;
  function stSchedule(){ clearTimeout(ST_TM); ST_TM=setTimeout(stFlush,1500); }
  function stFlush(){
    clearTimeout(ST_TM); ST_TM=null;
    var s=S.sess, b=bridge(); if(!s||!s.btId||!b||!b.ready()||!b.isOwnAccount()) return;
    var bt=b.getBacktest(s.btId); if(!bt) return;
    if(sessionDone(s)){ if(bt.replayState){ b.updateBacktest(s.btId,{ replayState:'', replayEnd:Date.now() }); } s.stSig=''; return; }
    var st=stateOf(s), sig=JSON.stringify(st); if(sig===s.stSig&&bt.replayState) return;
    st.upd=Date.now(); s.stSig=sig;
    b.updateBacktest(s.btId,{ replayState:JSON.stringify(st) });
  }
  function readLocalSessions(){
    var p=sesPrefix(); if(!p) return [];
    var u=uid(), old='tj_replay_session_'+u;
    try {
      var o=localStorage.getItem(old);
      if(o){ var ov=JSON.parse(o); localStorage.removeItem(old); if(ov&&ov.asset&&ov.startTs){ ov.sid=ov.sid||('o'+newId()); ov.upd=ov.upd||Date.now(); localStorage.setItem(p+ov.sid,JSON.stringify(ov)); } }
    } catch(_){}
    var out=[];
    try {
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i); if(!k||k.indexOf(p)!==0) continue;
        try { var v=JSON.parse(localStorage.getItem(k)); if(v&&v.sid&&v.asset&&v.startTs&&v.endTs&&v.curT!=null) out.push(v); } catch(_){}
      }
    } catch(_){}
    return out;
  }
  /* all unfinished sessions of this user, newest first: this device + the backtest documents */
  function readSessions(){
    var local=readLocalSessions(), b=bridge(), own=!!(b&&b.ready()&&b.isOwnAccount()), loaded=own&&b.backtestsLoaded&&b.backtestsLoaded();
    var out=[], byBt={};
    local.sort(function(x,y){ return (y.upd||0)-(x.upd||0); }).forEach(function(e){
      if(e.btId){
        if(byBt[e.btId]){ clearSession(e.sid); return; } /* two local copies of one backtest: keep the newest */
        if(loaded){
          var bt=b.getBacktest(e.btId);
          if(!bt||(Number(bt.replayEnd)||0)>=(e.upd||0)){ clearSession(e.sid); return; } /* backtest deleted, or its card was finished / dropped elsewhere */
        }
        byBt[e.btId]=e;
      }
      out.push(e);
    });
    if(own&&b.listBacktests) b.listBacktests().forEach(function(bt){
      if(!bt.replayState) return; var r; try { r=JSON.parse(bt.replayState); } catch(_){ return; }
      if(!r||!r.asset||!r.startTs||!r.endTs||r.curT==null) return;
      r.btId=bt.id; r.sid=r.sid||('b'+bt.id);
      if(bt.replayEnd>=(r.upd||0)) return;
      var l=byBt[bt.id];
      if(!l){ out.push(r); return; }
      if((r.upd||0)>(l.upd||0)) out[out.indexOf(l)]=r;
    });
    return out.sort(function(x,y){ return (y.upd||0)-(x.upd||0); });
  }
  function clearSession(sid){ var k=sesKey(sid); if(k) try { localStorage.removeItem(k); } catch(_){} }

  function instMeta(name){ return S.meta&&S.meta.instruments&&S.meta.instruments[name]; }
  function syncLobby(){
    if(S.meta&&!instMeta(S.selected)) S.selected='XAUUSD';
    var t2=0;
    document.querySelectorAll('#rpAssets .rp-asset, #rpAssets2 .rp-asset').forEach(function(b){
      var on=b.getAttribute('data-asset')===S.selected; b.classList.toggle('is-selected',on);
      var m=instMeta(b.getAttribute('data-asset')), el=b.querySelector('[data-meta]'), tier2=assetInfo(b.getAttribute('data-asset')).tier===2;
      if(tier2){ b.hidden=!!S.meta&&!m; b.disabled=!m; if(m) t2++; }
    });
    var t2box=$('rpTier2');
    if(t2box){
      t2box.hidden=!t2; $('rpTier2Count').textContent=t2?String(t2):'';
      if(assetInfo(S.selected).tier===2&&instMeta(S.selected)) t2box.open=true;
    }
    syncRange();
  }
  function prettyDate(str){ var p=str.split('-'); return p[2]+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1]+' '+p[0]; }
  function pickRange(){
    var b=bridge(), m=instMeta(S.selected);
    if(!b||!b.pickRange) return showError('The journal calendar is unavailable.');
    b.pickRange(function(s,e){ $('rpStart').value=s; $('rpEnd').value=e; syncRange(); }, m&&m.h1?fmtDate(m.h1.first+14*86400):null, m&&m.h1?fmtDate(m.h1.last):null);
  }
  function syncRange(){
    var s=$('rpStart').value, e=$('rpEnd').value, note=$('rpRangeNote'); $('rpError').classList.remove('is-visible');
    $('rpRangeBtn').textContent=(s&&e)?prettyDate(s)+'  →  '+prettyDate(e):'Select dates…';
    if(s&&e&&e>=s){ var days=Math.round((dateToTs(e)-dateToTs(s))/86400)+1; note.innerHTML='Period: <b>'+days+'</b> days'; } else note.textContent='';
  }
  function showError(msg){ var el=$('rpError'); if(!el) return; el.textContent=msg; el.classList.toggle('is-visible',!!msg); }
  var resumeTry=0;
  function renderResume(){
    var list=readSessions(), box=$('rpResume');
    var bb=bridge(); clearTimeout(renderResume.t);
    if(bb&&bb.ready()&&bb.isOwnAccount()&&bb.backtestsLoaded&&!bb.backtestsLoaded()&&resumeTry++<20) renderResume.t=setTimeout(function(){ if(!S.sess&&S.mode) renderResume(); },700); else resumeTry=0;
    if(!list.length){ box.innerHTML=''; return; }
    box.innerHTML=list.map(function(r){
      return '<div class="rp-card rp-resume" data-sid="'+esc(r.sid)+'"><div><div class="rp-resume-title">Continue: '+esc(r.asset)+'</div><div class="rp-resume-sub">'+fmtDate(r.startTs)+' → '+fmtDate(r.endTs)+' · stopped at '+fmtDate(r.curT)+'</div></div><div style="display:flex;gap:8px"><button class="rp-btn" data-resume-drop="'+esc(r.sid)+'" type="button">Reset</button><button class="rp-primary" data-resume="'+esc(r.sid)+'" type="button">Continue</button></div></div>';
    }).join('');
  }
  function bindResume(){
    $('rpResume').addEventListener('click',function(e){
      var go=e.target.closest('[data-resume]'), dr=e.target.closest('[data-resume-drop]');
      if(dr){
        var dsid=dr.getAttribute('data-resume-drop'), de=readSessions().filter(function(x){ return x.sid===dsid; })[0]; clearSession(dsid);
        var bb=bridge(); if(de&&de.btId&&bb&&bb.ready()&&bb.isOwnAccount()&&bb.getBacktest(de.btId)) bb.updateBacktest(de.btId,{ replayState:'', replayEnd:Date.now() });
        renderResume(); return;
      }
      if(!go) return;
      var sid=go.getAttribute('data-resume'), r=readSessions().filter(function(x){ return x.sid===sid; })[0]; if(!r||!guardOwn()) return;
      startSession(r.asset,r.startTs,r.endTs,r.curT,r.tf,{ sid:r.sid, btId:r.btId, pos:r.pos, maxT:r.maxT, drawings:r.drawings, drawAt:r.drawAt });
    });
  }
  function showLobbyUI(){
    var ses=$('rpSession'); ses.style.display='none'; ses.setAttribute('aria-hidden','true');
    document.body.classList.remove('replay-fullscreen');
    if(document.fullscreenElement) { try { document.exitFullscreen(); } catch(_){} }
    var lobby=$('rpLobby'); lobby.style.display=''; restart(lobby); renderResume(); syncLobby();
  }
  function toLobby(){
    cancelAnim(); stopPlay(); if(S.rewind) setRewind(false); if(S.sess){ S.sess.draft=null; flushDays(); saveSession(); drFlush(); stFlush(); drCancel(); }
    curtainQuick(function(){ S.sess=null; showLobbyUI(); loadMeta().then(function(){ if(S.mode&&!S.sess) syncLobby(); }).catch(function(){ showError('Could not check for fresh quotes. Open Replay again.'); }); });
  }
  function guardOwn(){
    var b=bridge();
    if(b&&b.ready()&&!b.isOwnAccount()){ showError('A student journal is open ('+b.viewingLogin()+'). Switch to your own account to run Replay.'); return false; }
    return true;
  }
  function startFromLobby(){
    var s=$('rpStart').value, e=$('rpEnd').value;
    if(!s||!e) return showError('Set the start and end dates.');
    if(e<s) return showError('The end date is before the start date.');
    var m=instMeta(S.selected); if(!m) return showError('Data is not loaded yet.');
    var startTs=dateToTs(s), endTs=dateToTs(e);
    if(startTs<m.h1.first+14*86400) return showError('The start is too close to the beginning of history — leave at least 2 weeks of context.');
    if(endTs>m.h1.last) return showError('The end date is after the latest available data ('+fmtDate(m.h1.last)+').');
    if(!guardOwn()) return;
    showError(''); startSession(S.selected,startTs,endTs,null,null,null);
  }

  /* ---------- session ---------- */
  function startSession(asset,startTs,endTs,resumeT,tf,extra){
    S.selected=asset;
    curtainFull(function(reveal){
      /* everything below happens behind the curtain */
      var ses=$('rpSession'); ses.style.display='flex'; ses.setAttribute('aria-hidden','false');
      document.body.classList.add('replay-fullscreen'); restart(ses);
      ensureChart(); hideBanner();
      loadSession(asset,startTs,endTs).then(function(d){
        var startIdx=lowerBound(d.T,startTs,d.n)-1, endIdx=lowerBound(d.T,endTs+86400,d.n)-1;
        if(endIdx<=startIdx) throw new Error('No data in the selected range.');
        var cur=startIdx; if(resumeT!=null){ cur=Math.min(Math.max(lowerBound(d.T,resumeT,d.n),startIdx),endIdx); }
        S.sess={ sid:(extra&&extra.sid)||newId(), asset:asset, d:d, startTs:startTs, endTs:endTs, startIdx:startIdx, endIdx:endIdx, cur:cur, btId:null, pos:[], closed:[], draft:null, maxIdx:cur, drawings:[], drawAt:0 };
        drReset(); drLoad(extra); drSync(); drPlaceBars(); syncPrefs();
        if(extra&&extra.maxT!=null){ S.sess.maxIdx=Math.min(Math.max(lowerBound(d.T,extra.maxT,d.n),cur),endIdx); }
        S.rewind=false; S.shown={};
        var br=bridge();
        if(extra&&extra.btId&&br&&br.getBacktest(extra.btId)){
          S.sess.btId=extra.btId; S.sess.pos=(extra.pos||[]).filter(function(p){ return p&&p.entry!=null; });
          br.getTrades(extra.btId).forEach(function(t){ if(t.entry!=null&&t.openTs!=null) S.sess.closed.push({ id:t.id, dir:t.direction==='LONG'?1:-1, entry:t.entry, sl:t.sl, tp:t.tp, exit:t.exit, openT:t.openTs, closeT:t.closeTs, r:Number(t.r)||0, riskPct:t.riskPercent, reason:t.exitReason, ar:!!t.afterRewind, hid:!!t.hiddenOnChart }); });
        }
        modelOptions();
        var info=assetInfo(asset), chip=$('rpAssetChip'); chip.style.setProperty('--rp-color',info.color); chip.querySelector('span').textContent=asset;
        S.series.applyOptions({ priceFormat:{ type:'price', precision:d.dp, minMove:Math.pow(10,-d.dp) } });
        S.tf = tf || '1D'; if(S.tf==='5m'||S.tf==='15m'||S.tf==='30m'){ if(!(d.m5Start&&cur>=d.m5Idx)) S.tf='1D'; }
        updateTfButtons(); fullRefresh(false); saveSession(); reveal(); renderTrade(true);
      }).catch(function(err){
        S.sess=null; showLobbyUI(); showError((err&&err.message)||'Data loading error.'); reveal();
      });
    });
  }
  function restart(el){ if(!el) return; el.classList.remove('rp-view'); void el.offsetWidth; el.classList.add('rp-view'); }

  function ensureChart(){
    if(S.chart) return;
    var LW=window.LightweightCharts; if(!LW){ showError('The chart library failed to load.'); return; }
    var co=chartStyleOpts(S.style);
    S.chart=LW.createChart($('rpChart'),{
      autoSize:true,
      layout:Object.assign({ fontFamily:'Poppins, TJ Text, sans-serif' }, co.layout),
      grid:co.grid,
      rightPriceScale:co.rightPriceScale,
      timeScale:Object.assign({ timeVisible:true, rightOffset:14, secondsVisible:false, tickMarkFormatter:tickFmt }, co.timeScale),
      crosshair:Object.assign({ mode:0 }, co.crosshair),
      localization:{ timeFormatter:function(t){ return S.hideDate?'':fmtAxis(t); } }
    });
    S.series=S.chart.addSeries(LW.CandlestickSeries,seriesStyleOpts(S.style));
    S.prim=makePrimitive(); S.series.attachPrimitive(S.prim); updateSessBtn();
  }
  function applyHideDate(){
    if(!S.chart) return;
    S.chart.applyOptions({ timeScale:{ visible:!S.hideDate } });
  }

  function curBucket(){ var s=S.sess; return buckets(s.d,S.tf).b2[s.cur]; }
  function fullRefresh(keepView){
    var s=S.sess; if(!s) return;
    var bk=buckets(s.d,S.tf), b=bk.b2[s.cur];
    if(b<0){ S.tf='1h'; updateTfButtons(); bk=buckets(s.d,S.tf); b=bk.b2[s.cur]; }
    var lim=(S.tf==='5m'||S.tf==='15m'||S.tf==='30m')?3000:(S.tf==='1h'||S.tf==='4h')?3500:99999, from=Math.max(0,b-lim), data=[];
    for(var k=from;k<=b;k++) data.push(barAt(s.d,bk,k,s.cur));
    S.series.setData(data); S.dispFrom=from;
    if(!keepView){
      var vis={ '5m':220,'15m':200,'30m':200,'1h':200,'4h':180,'1D':160,'1W':110,'1M':70,'3M':45 }[S.tf]||160;
      S.chart.timeScale().setVisibleLogicalRange({ from:data.length-vis, to:data.length+16 });
    }
    refreshHud();
  }
  function stepRefresh(b0){
    var s=S.sess, bk=buckets(s.d,S.tf), b1=bk.b2[s.cur];
    if(b1<0||b0<0||b1-b0>40) return fullRefresh(true);
    for(var k=b0;k<=b1;k++) S.series.update(barAt(s.d,bk,k,s.cur));
    refreshHud();
  }
  function refreshHud(){
    var s=S.sess; if(!s) return;
    var d=s.d, i=s.cur, endT=d.T[i]+d.D[i];
    var days=Math.max(0,Math.floor((endT-s.startTs)/86400)), total=Math.round((s.endTs-s.startTs)/86400)+1;
    var mxT=d.T[Math.max(s.maxIdx,i)]+d.D[Math.max(s.maxIdx,i)], mxDays=Math.min(total,Math.max(0,Math.floor((mxT-s.startTs)/86400)));
    $('rpDayText').innerHTML='<b>'+Math.min(days,total)+'</b> of '+total+' days'+(s.maxIdx>i?' <span class="rp-warn">· max '+mxDays+'</span>':'');
    $('rpDateText').textContent=S.hideDate?'•••• – •• – ••':fmtTz(d.T[i],true)+' '+tzTag(d.T[i]);
    var done=(s.cur>=s.endIdx), pct=Math.min(100,Math.max(0,(endT-s.startTs)/(s.endTs+86400-s.startTs)*100));
    $('rpProgressFill').style.width=pct.toFixed(1)+'%';
    var bk=buckets(d,S.tf), b=bk.b2[i], bar=b>=0?barAt(d,bk,b,i):null, f=function(v){ return v.toFixed(d.dp); };
    $('rpLegend').innerHTML='<span><b>'+esc(s.asset)+'</b> · '+esc(S.tf)+'</span>'+(s.maxIdx>i?'<span class="rp-warn">After cut · already seen zone — new trades will be marked</span>':'')+(bar?'<span>O <b>'+f(bar.open)+'</b></span><span>H <b>'+f(bar.high)+'</b></span><span>L <b>'+f(bar.low)+'</b></span><span>C <b>'+f(bar.close)+'</b></span>':'');
    updateTfButtons(); updateClock();
    if(done){ showBanner('Backtest period complete — '+total+' days.'+(s.btId?' Results are in Backtest Space.':'')); stopPlay(); saveSession(); } else hideBanner();
    $('rpBtnStep').disabled=$('rpBtnPlay').disabled=done;
    if(done) pushDays(true); else pushDays(false);
    if(growBoxes()) saveSession();
    renderTrade(false); requestDraw();
  }
  function showBanner(t){ var b=$('rpBanner'); b.textContent=t; b.classList.add('is-visible'); }
  function hideBanner(){ var b=$('rpBanner'); if(b) b.classList.remove('is-visible'); }

  /* ---------- timeframes ---------- */
  function updateTfButtons(){
    var s=S.sess; var m5ok = !!(s && s.d.m5Start && s.cur>=s.d.m5Idx);
    document.querySelectorAll('#rpTfs button').forEach(function(b){
      var id=b.getAttribute('data-tf'), t=TFS.filter(function(x){return x.id===id;})[0];
      var off=t.intraday&&!m5ok;
      b.disabled=off; b.title=off?'5m / 15m / 30m are unavailable for this period (M5 data starts in 2013)':'';
      b.classList.toggle('is-on',id===S.tf);
    });
    updateStepBtn();
  }
  function setTF(id){
    var s=S.sess; if(!s) return; cancelAnim(); S.tf=id; updateTfButtons(); fullRefresh(false); saveSession();
  }

  /* ---------- stepping ---------- */
  function nextEnd(tfId){
    var s=S.sess, bk=buckets(s.d,tfId), b=bk.b2[s.cur];
    if(b<0) return s.cur+1;
    if(bk.La[b]<=s.cur) b++;
    return bk.La[Math.min(b,bk.La.length-1)];
  }
  function advanceTo(target){
    var s=S.sess; if(!s||s.cur>=s.endIdx) return; cancelAnim();
    var b0=curBucket(), to=Math.min(Math.max(target,s.cur+1),s.endIdx), stopAt=to, evs=null;
    if(s.pos.length){ for(var i=s.cur+1;i<=to;i++){ evs=processBar(i); if(evs){ stopAt=i; break; } } }
    s.cur=stopAt; if(s.cur>s.maxIdx) s.maxIdx=s.cur;
    if(s.cur>=s.endIdx) finishPeriod();
    stepRefresh(b0); saveSession();
    if(evs){ stopPlay(); toast(evs.join(' · '),/Stop:/.test(evs.join())?'bad':'ok'); }
  }
  function tfLabel(id){ for(var i=0;i<TFS.length;i++) if(TFS[i].id===id) return TFS[i].label; return id; }
  /* the step is independent of the chart timeframe; 'auto' follows it. Intraday steps fall back to 1H where there is no M5 data. */
  function stepTfEff(){
    var id=S.stepTf==='auto'?S.tf:S.stepTf, ss=S.sess;
    if((id==='5m'||id==='15m'||id==='30m')&&!(ss&&ss.d.m5Start&&ss.cur>=ss.d.m5Idx)) id='1h';
    return id;
  }
  function stepTF(){ var s=S.sess; if(s) advanceTo(nextEnd(stepTfEff())); }
  function setPlayIcon(on){
    var b=$('rpBtnPlay'); if(!b) return; b.innerHTML=on?ICON_PAUSE:ICON_PLAY; b.classList.toggle('is-on',!!on);
    b.title=on?'Pause (Space)':'Play / pause (Space)';
  }
  function stopPlay(){ if(S.playing){ clearInterval(S.playing); S.playing=null; } setPlayIcon(false); }
  function startPlay(){
    clearInterval(S.playing);
    S.playing=setInterval(function(){ stepTF(); if(!S.sess||S.sess.cur>=S.sess.endIdx) stopPlay(); }, Math.round(1000/S.speed));
  }
  function togglePlay(){
    if(S.playing){ stopPlay(); return; }
    var s=S.sess; if(!s||s.cur>=s.endIdx) return;
    setPlayIcon(true); startPlay();
  }

  /* speed / step settings + floating menus */
  /* speed / step / time zone are kept per account on this device (never shared between accounts of one browser) */
  var CTL_DEF=null;
  function ctlKey(){ var u=uid(); return u?CTL_KEY+'_'+u:''; }
  function loadCtl(){
    if(!CTL_DEF) CTL_DEF={ speed:S.speed, step:S.stepTf, tz:S.tz };
    S.speed=CTL_DEF.speed; S.stepTf=CTL_DEF.step; S.tz=CTL_DEF.tz;
    try {
      var k=ctlKey(), c=(k&&JSON.parse(localStorage.getItem(k)||'null'))||{};
      if(SPEEDS.indexOf(c.speed)>=0) S.speed=c.speed;
      if(c.step==='auto'||TFS.some(function(t){ return t.id===c.step; })) S.stepTf=c.step;
      if(TZS.some(function(t){ return t.id===c.tz; })) S.tz=c.tz;
    } catch(_){}
  }
  function saveCtl(){ var k=ctlKey(); if(!k) return; try { localStorage.setItem(k,JSON.stringify({ speed:S.speed, step:S.stepTf, tz:S.tz })); } catch(_){} }
  function updateStepBtn(){ var b=$('rpStepBtn'); if(b) b.firstChild.textContent=tfLabel(stepTfEff()); }
  function updateCtlButtons(){ var b=$('rpSpeedBtn'); if(b) b.firstChild.textContent=S.speed+'x'; updateStepBtn(); }
  function closeMenu(){
    var m=$('rpMenu'); if(m) m.classList.remove('is-open');
    ['rpSpeedBtn','rpStepBtn','rpModelBtn','rpClockBtn'].forEach(function(id){ var b=$(id); if(b) b.classList.remove('is-open'); });
    S.menuFor=null; S.menuPick=null;
  }
  function openMenu(kind,btn,title,items,pick){
    if(S.menuFor===kind){ closeMenu(); return; }
    closeMenu();
    var m=$('rpMenu'); if(!m||!btn) return;
    m.innerHTML=(title?'<div class="rp-menu-title">'+esc(title)+'</div>':'')+items.map(function(it){
      return '<button type="button" class="rp-menu-item'+(it.sel?' is-sel':'')+'" data-v="'+esc(it.v)+'"'+(it.disabled?' disabled':'')+(it.tip?' title="'+esc(it.tip)+'"':'')+'><span>'+esc(it.label)+'</span>'+(it.sub?'<small>'+esc(it.sub)+'</small>':'')+'</button>';
    }).join('');
    m.style.minWidth=Math.max(kind==='model'?0:150,Math.round(btn.getBoundingClientRect().width))+'px';
    m.classList.remove('is-down'); m.style.left='0px'; m.style.top='0px';
    var r=btn.getBoundingClientRect(), mw=m.offsetWidth, mh=m.offsetHeight, vw=window.innerWidth, vh=window.innerHeight;
    var left=Math.min(Math.max(8,r.left+r.width/2-mw/2),vw-mw-8), top=r.top-mh-8, down=false;
    if(top<8){ top=Math.min(r.bottom+8,vh-mh-8); down=true; }
    m.style.left=Math.round(left)+'px'; m.style.top=Math.round(top)+'px'; m.classList.toggle('is-down',down);
    S.menuFor=kind; S.menuPick=pick; btn.classList.add('is-open');
    void m.offsetWidth; m.classList.add('is-open');
    var sel=m.querySelector('.is-sel'); if(sel&&sel.scrollIntoView) { try { sel.scrollIntoView({ block:'nearest' }); } catch(_){} }
  }
  function openSpeedMenu(){
    openMenu('speed',$('rpSpeedBtn'),'Speed',SPEEDS.map(function(v){ return { v:String(v), label:v+'x', sel:v===S.speed }; }),function(v){
      S.speed=+v; saveCtl(); updateCtlButtons(); if(S.playing) startPlay();
    });
  }
  function openStepMenu(){
    var s=S.sess, m5ok=!!(s&&s.d.m5Start&&s.cur>=s.d.m5Idx);
    var items=[{ v:'auto', label:'Auto', sub:tfLabel(S.tf), sel:S.stepTf==='auto' }].concat(TFS.map(function(t){
      var off=t.intraday&&!m5ok; return { v:t.id, label:t.label, sel:S.stepTf===t.id, disabled:off, tip:off?'5m / 15m / 30m are unavailable for this period':'' };
    }));
    openMenu('step',$('rpStepBtn'),'Simulation step',items,function(v){ S.stepTf=v; saveCtl(); updateCtlButtons(); });
  }
  function updateClock(){
    var b=$('rpClockBtn'), s=S.sess; if(!b||!s) return;
    var ts=s.d.T[s.cur]+(s.d.D[s.cur]||0), o=tzParts(ts); // show the current moment (close of the last bar), not its open
    b.firstChild.textContent=(S.hideDate?'••:••':pad(o.hour)+':'+pad(o.minute))+' '+tzTag(ts);
  }
  function applyTz(){
    if(S.chart){ S.chart.applyOptions({ timeScale:{ tickMarkFormatter:tickFmt }, localization:{ timeFormatter:function(t){ return S.hideDate?'':fmtAxis(t); } } }); }
    updateClock(); if(S.sess) refreshHud();
  }
  function openTzMenu(){
    var s=S.sess, ts=s?s.d.T[s.cur]:Math.floor(Date.now()/1000);
    openMenu('tz',$('rpClockBtn'),'Time zone',TZS.map(function(z){ return { v:z.id, label:z.label, sub:z.id==='UTC'?'':tzTagFor(z.id,ts), sel:z.id===S.tz }; }),function(v){
      S.tz=v; saveCtl(); applyTz();
    });
  }
  function openModelMenu(){
    var cur=$('rpModel').value;
    openMenu('model',$('rpModelBtn'),'Model',(S.models||[]).map(function(m){ return { v:m.id, label:m.name, sel:m.id===cur }; }),function(v){ setModel(v); });
  }
  function setModel(id){
    var list=S.models||[], it=list.filter(function(m){ return m.id===id; })[0]||list[0]; if(!it) return;
    $('rpModel').value=it.id; var sp=$('rpModelBtn').querySelector('span'); if(sp) sp.textContent=it.name;
    if(prefKey()) setPref({ model:it.id });
  }
  function onKey(e){
    if(!S.mode||S.set||S.save) return;
    var tag=(e.target&&e.target.tagName)||''; if(/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    if(e.key==='Escape'){ if(S.menuFor) closeMenu(); else if(S.rewind) setRewind(false); else if(S.sess&&drEsc()){} else if(S.sess) cancelDraft(); else exitWorkspace(false); return; }
    if(!S.sess) return;
    if(drKey(e)) return;
    if(e.code==='Space'&&S.dr.tool!=='cursor'){ e.preventDefault(); if(!e.repeat) drPan(true); return; }
    if(e.key==='Enter'&&S.sess.draft){ e.preventDefault(); confirmDraft(); return; }
    if(e.code==='Space'){ e.preventDefault(); togglePlay(); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); stepTF(); }
  }

  /* ---------- trading (step 2) ---------- */
  /* risk % and the chosen model are per account and synced through the database (replayProfiles/prefs_<uid>); panel collapsed state is per account on this device */
  var PREF_KEY='tj_replay_pref', COLLAPSE_KEY='tj_replay_panel_collapsed', RISK_DEF=null, prefTm=null;
  function prefKey(){ var u=uid(); return u?PREF_KEY+'_'+u:''; }
  function readPref(){ try { var k=prefKey(), o=k&&JSON.parse(localStorage.getItem(k)||'null'); return (o&&typeof o==='object')?o:{}; } catch(_){ return {}; } }
  function writePref(o){ var k=prefKey(); if(!k) return; try { localStorage.setItem(k,JSON.stringify(o)); } catch(_){} }
  function setPref(patch){ var o=readPref(); for(var k in patch) o[k]=patch[k]; o.at=new Date().toISOString(); writePref(o); clearTimeout(prefTm); prefTm=setTimeout(pushPref,1000); }
  function pushPref(){
    var b=bridge(); clearTimeout(prefTm); if(!(b&&b.profileSave&&b.ready()&&b.isOwnAccount())) return;
    var o=readPref(); if(!o.at) return;
    b.profileSave({ id:'prefs', kind:'prefs', name:'prefs', style:{ risk:o.risk, model:o.model, ind:o.ind, fvg:normStyle({ fvg:o.fvg }).fvg }, updateOnly:true }).catch(function(err){ console.error('replay prefs save failed:',err); });
  }
  function syncPref(rem){
    var o=readPref();
    if(rem&&rem.style&&(!o.at||String(rem.updatedAt)>o.at)){
      var st=rem.style;
      if(typeof st.risk==='number'&&isFinite(st.risk)&&st.risk>=0) o.risk=st.risk;
      if(typeof st.model==='string') o.model=st.model;
      if(st.ind&&typeof st.ind==='object') o.ind=normSess(st.ind);
      if(st.fvg&&typeof st.fvg==='object') o.fvg=normStyle({ fvg:st.fvg }).fvg;
      o.at=String(rem.updatedAt); writePref(o); applyPref();
    } else if(o.at&&(!rem||o.at>String(rem.updatedAt))) pushPref();
  }
  function applyPref(){
    var r=$('rpRisk'); if(!r) return; if(RISK_DEF===null) RISK_DEF=r.value;
    var o=readPref();
    if(S.style&&!S.set&&o.ind){ var ns=normSess(o.ind); if(JSON.stringify(ns)!==JSON.stringify(S.style.sess)){ S.style.sess=ns; updateSessBtn(); requestDraw(); } }
    if(S.style&&!S.set){ var nf=normStyle({ fvg:o.fvg }).fvg; if(JSON.stringify(nf)!==JSON.stringify(S.style.fvg)){ S.style.fvg=nf; updateSessBtn(); requestDraw(); } }
    if(document.activeElement!==r) r.value=(typeof o.risk==='number'&&isFinite(o.risk)&&o.risk>=0)?o.risk:RISK_DEF;
    var t=$('rpTrade'); if(t){ var c=false; try { var k=COLLAPSE_KEY+(uid()?'_'+uid():''); c=!!uid()&&localStorage.getItem(k)==='1'; } catch(_){} t.classList.toggle('is-collapsed',c); }
    if(S.models&&S.models.length) modelOptions();
  }
  /* everything the panel remembers is re-read for the current account (also when the account changes without a reload) */
  function loadPrefs(){ loadCtl(); updateCtlButtons(); applyTz(); applyPref(); }
  function bridge(){ return window.TJReplayBridge||null; }
  function r2(x){ return Math.round(x*100)/100; }
  function fp(v){ return S.sess?(+v).toFixed(S.sess.d.dp):String(v); }
  function rnd(v){ return S.sess?+(+v).toFixed(S.sess.d.dp):v; }
  function curPrice(){ var s=S.sess; return s.d.C[s.cur]; }
  function nowT(){ var s=S.sess; return s.d.T[s.cur]+s.d.D[s.cur]; }
  function clampT(t){ var s=S.sess; return Math.min(Math.max(t,s.startTs),s.endTs+86399); }
  function dtStr(t){ var d=new Date(clampT(t)*1000); return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes()); }
  function newId(){ return Math.random().toString(36).slice(2,9); }
  function sgnR(v){ return (v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(2)+'R'; }
  function toast(msg,kind){
    var t=$('rpToast'); if(!t) return; t.textContent=msg; t.className='rp-toast is-visible'+(kind?' is-'+kind:'');
    clearTimeout(toast._t); toast._t=setTimeout(function(){ t.classList.remove('is-visible'); },3600);
  }
  function readRisk(){ var v=parseFloat(String($('rpRisk').value).replace(',','.')); return (isFinite(v)&&v>=0)?v:1; }

  function avgRange(){
    var s=S.sess, d=s.d, bk=buckets(d,S.tf), b=bk.b2[s.cur], sum=0, n=0;
    for(var k=Math.max(0,b-14);k<b;k++){
      var h=-1e18, l=1e18;
      for(var i=bk.F[k];i<=bk.La[k];i++){ if(d.H[i]>h) h=d.H[i]; if(d.L[i]<l) l=d.L[i]; }
      sum+=h-l; n++;
    }
    return n?sum/n:d.C[s.cur]*0.002;
  }
  function makeDraft(dir){
    var s=S.sess; if(!s) return;
    if(s.cur>=s.endIdx) return toast('Backtest period complete.','warn');
    var p=curPrice(), rg=Math.max(avgRange()*1.2, Math.pow(10,-s.d.dp)*5);
    s.draft={ dir:dir, entry:rnd(p), sl:rnd(p-dir*rg), tp:rnd(p+dir*rg*2), market:true, endT:newEndT() };
    renderTrade(true); requestDraw();
  }
  function cancelDraft(){ if(S.sess&&S.sess.draft){ S.sess.draft=null; renderTrade(true); requestDraw(); } }
  function ensureBacktest(){
    var s=S.sess, b=bridge();
    if(!b||!b.ready()) { toast('The journal is not ready yet — try again in a second.','warn'); return false; }
    if(!b.isOwnAccount()){ toast('A student journal is open — switch to your own account.','warn'); return false; }
    if(s.btId&&b.getBacktest(s.btId)) return true;
    var info=assetInfo(s.asset);
    var bt=b.createBacktest({ name:'Replay · '+s.asset, asset:s.asset, startYMD:fmtDate(s.startTs), endYMD:fmtDate(s.endTs), daysTested:currentDays() });
    if(!bt){ toast('Could not create the backtest.','warn'); return false; }
    s.btId=bt.id; s.closed=[]; saveSession(); if((s.drawings||[]).length){ s.drawAt=s.drawAt||Date.now(); drFlush(); } return true;
  }
  function confirmDraft(){
    var s=S.sess; if(!s||!s.draft) return; var dr=s.draft, price=curPrice();
    if(s.cur>=s.endIdx) return toast('Backtest period complete.','warn');
    var entry=dr.market?rnd(price):dr.entry;
    if(dr.sl==null||!isFinite(dr.sl)) return toast('Set a stop (SL).','warn');
    if(dr.dir>0?dr.sl>=entry:dr.sl<=entry) return toast(dr.dir>0?'For Long the stop must be below the entry.':'For Short the stop must be above the entry.','warn');
    if(dr.tp!=null&&(dr.dir>0?dr.tp<=entry:dr.tp>=entry)) return toast(dr.dir>0?'For Long the take profit must be above the entry.':'For Short the take profit must be below the entry.','warn');
    if(!ensureBacktest()) return;
    var kind=null, status='open';
    if(!dr.market&&Math.abs(entry-price)>=Math.pow(10,-s.d.dp)/2){
      status='pending';
      kind = dr.dir>0 ? (entry>price?'stop':'limit') : (entry<price?'stop':'limit');
    }
    var p={ id:newId(), dir:dr.dir, entry:entry, sl:dr.sl, tp:dr.tp, status:status, kind:kind, risk0:Math.abs(entry-dr.sl), riskPct:readRisk(), modelId:$('rpModel').value||'', placedT:nowT(), openT:status==='open'?nowT():null, endT:dr.endT!=null?dr.endT:newEndT(), ar:s.cur<s.maxIdx };
    s.pos.push(p); s.draft=null; saveSession(); renderTrade(true); requestDraw();
    toast((status==='open'?(dr.dir>0?'Long':'Short')+' opened at '+fp(entry):'Pending '+(kind==='stop'?'Stop':'Limit')+' order at '+fp(entry))+(p.ar?' · marked “after cut”':''),p.ar?'warn':'ok');
  }
  function posR(p,price){ return p.risk0>0?p.dir*(price-p.entry)/p.risk0:0; }
  function finishTrade(p,exitPrice,reason,closeT){
    var s=S.sess, b=bridge(), r=r2(posR(p,exitPrice));
    s.pos=s.pos.filter(function(x){ return x!==p; });
    var rec=null;
    /* the backtest was deleted in the journal while this session was open: create it again, so the trade is not lost */
    if(b&&s.btId&&b.ready()&&!b.getBacktest(s.btId)){ var keep=s.closed; s.btId=null; if(ensureBacktest()) s.closed=keep; else { s.closed=keep; s.btId=null; } }
    if(b&&s.btId){
      rec=b.addTrade(s.btId,{ asset:s.asset, direction:p.dir>0?'LONG':'SHORT', openDT:dtStr(p.openT), closeDT:dtStr(closeT), r:r, riskPercent:p.riskPct, modelId:p.modelId,
        source:'replay', entry:p.entry, sl:p.sl, tp:p.tp==null?null:p.tp, exit:exitPrice, exitReason:reason, openTs:p.openT, closeTs:closeT, afterRewind:!!p.ar, seenUntilTs:p.ar?(s.d.T[s.maxIdx]+s.d.D[s.maxIdx]):null });
    }
    s.closed.push({ id:rec?rec.id:newId(), dir:p.dir, entry:p.entry, sl:p.sl, tp:p.tp, exit:exitPrice, openT:p.openT, closeT:closeT, r:r, riskPct:p.riskPct, reason:reason, ar:!!p.ar, hid:false });
    pushDays(true);
    return r;
  }
  /* returns an event description when something happened on bar i */
  function processBar(i){
    var s=S.sess, d=s.d, H=d.H[i], L=d.L[i], T=d.T[i], E=T+d.D[i], ev=[];
    s.pos.slice().forEach(function(p){
      if(p.status==='pending'){
        var hit = p.dir>0 ? (p.kind==='stop'?H>=p.entry:L<=p.entry) : (p.kind==='stop'?L<=p.entry:H>=p.entry);
        if(!hit) return;
        p.status='open'; p.openT=T; p.risk0=Math.abs(p.entry-p.sl)||Math.pow(10,-d.dp);
        ev.push((p.dir>0?'Long':'Short')+' filled at '+fp(p.entry));
      }
      var slHit = p.dir>0 ? L<=p.sl : H>=p.sl;
      var tpHit = p.tp!=null && (p.dir>0 ? H>=p.tp : L<=p.tp);
      if(slHit){ var r1=finishTrade(p,p.sl,'SL',E); ev.push('Stop: '+sgnR(r1)); }
      else if(tpHit){ var r2_=finishTrade(p,p.tp,'TP',E); ev.push('Take: '+sgnR(r2_)); }
    });
    return ev.length?ev:null;
  }
  function closeManual(id){
    var s=S.sess; if(!s) return; var p=s.pos.filter(function(x){ return x.id===id; })[0]; if(!p) return;
    if(p.status==='pending'){ s.pos=s.pos.filter(function(x){ return x!==p; }); saveSession(); renderTrade(true); requestDraw(); return toast('Order cancelled.'); }
    var r=finishTrade(p,curPrice(),'Manual',nowT());
    saveSession(); renderTrade(true); requestDraw(); toast('Closed manually: '+sgnR(r),r>=0?'ok':'bad');
  }
  function finishPeriod(){
    var s=S.sess; if(!s||!s.pos.length) return;
    var n=0; s.pos.slice().forEach(function(p){
      if(p.status==='pending') s.pos=s.pos.filter(function(x){ return x!==p; });
      else { finishTrade(p,curPrice(),'End of period',nowT()); n++; }
    });
    if(n) toast('Period complete — open trades were closed at market.','warn');
  }

  /* days tested → Backtest */
  function currentDays(){
    var s=S.sess; if(!s) return 0; var endT=s.d.T[s.cur]+s.d.D[s.cur], total=Math.round((s.endTs-s.startTs)/86400)+1;
    return Math.min(total,Math.max(0,Math.floor((endT-s.startTs)/86400)));
  }
  var daysTimer=null;
  function pushDays(now){
    var s=S.sess, b=bridge(); if(!s||!s.btId||!b) return;
    clearTimeout(daysTimer);
    var run=function(){ var bt=b.getBacktest(s.btId); var dn=currentDays(); if(bt&&dn>(bt.daysTested||0)) b.updateBacktest(s.btId,{ daysTested:dn }); else if(bt&&now) b.updateBacktest(s.btId,{}); };
    if(now) run(); else daysTimer=setTimeout(run,1500);
  }
  function flushDays(){ pushDays(true); }

  /* panel */
  function modelOptions(){
    var b=bridge(), list=(b?b.models():[{id:'',name:'No model'}]).map(function(m){ return m.id?m:{ id:'', name:'No model' }; }), saved=readPref().model||'';
    S.models=list; var id=list.some(function(m){ return m.id===saved; })?saved:(list[0]?list[0].id:'');
    var it=list.filter(function(m){ return m.id===id; })[0]; $('rpModel').value=id; var sp=$('rpModelBtn').querySelector('span'); if(sp) sp.textContent=it?it.name:'';
    var wrap=$('rpModelRow'); if(wrap) wrap.style.display=list.length>1?'':'none';
  }
  function cleanOnly(){ var b=bridge(), s=S.sess; var bt=(b&&s&&s.btId)?b.getBacktest(s.btId):null; return !!(bt&&bt.cleanOnly); }
  function tradeStats(){
    var c=S.sess.closed.filter(function(t){ return !(cleanOnly()&&t.ar); }), w=0, tot=0, pct=0; c.forEach(function(t){ if(t.r>0) w++; tot+=t.r; pct+=t.r*(t.riskPct==null?1:t.riskPct); });
    return { n:c.length, wr:c.length?w/c.length*100:0, r:tot, pct:pct };
  }
  function renderTrade(full){
    var s=S.sess; if(!s||!$('rpPosList')) return;
    var price=curPrice(), dr=s.draft;
    $('rpDraftWrap').classList.toggle('is-open',!!dr);
    $('rpLong').classList.toggle('is-on',!!dr&&dr.dir>0); $('rpShort').classList.toggle('is-on',!!dr&&dr.dir<0);
    if(dr){
      $('rpDraftTitle').textContent=(dr.dir>0?'Long':'Short')+(dr.market?' · market':' · pending');
      [['rpInEntry',dr.market?price:dr.entry],['rpInSL',dr.sl],['rpInTP',dr.tp]].forEach(function(x){ var el=$(x[0]); if(document.activeElement!==el) el.value=x[1]==null?'':fp(x[1]); });
      var rk=Math.abs((dr.market?price:dr.entry)-dr.sl), rw=dr.tp!=null&&rk>0?Math.abs(dr.tp-(dr.market?price:dr.entry))/rk:null;
      $('rpDraftInfo').textContent=rw!=null?'Risk : reward = 1 : '+rw.toFixed(2):'No take profit';
    }
    var html=s.pos.map(function(p){
      var pending=p.status==='pending', r=pending?null:posR(p,price);
      var isNew=!S.shown[p.id]; S.shown[p.id]=1;
      return '<div class="rp-pos'+(isNew?' is-new':'')+'"><div class="rp-pos-info"><div class="rp-pos-l1"><span class="rp-pos-dir '+(p.dir>0?'long':'short')+'">'+(p.dir>0?'LONG':'SHORT')+'</span>'+(pending?'<span class="rp-pos-kind">'+(p.kind==='stop'?'Stop':'Limit')+'</span>':'')+'</div>'+
        '<div class="rp-pos-l2"><span class="rp-pos-px">'+fp(p.entry)+'</span>'+(pending?'<span class="rp-pos-pl rp-muted">pending</span>':'<span class="rp-pos-pl '+(r>=0?'pos':'neg')+'">'+sgnR(r2(r))+'</span>')+'</div></div>'+
        '<button type="button" class="rp-mini" data-close="'+p.id+'">'+(pending?'Cancel':'Close')+'</button></div>';
    }).join('');
    $('rpPosList').innerHTML=html;
    var st=tradeStats(), nAr=s.closed.filter(function(t){ return t.ar; }).length, nHid=s.closed.filter(function(t){ return t.hid; }).length;
    $('rpStats').innerHTML=(st.n?('<span>Trades <b>'+st.n+'</b></span><span>WR <b>'+st.wr.toFixed(0)+'%</b></span><span class="'+(st.r>=0?'pos':'neg')+'"><b>'+sgnR(r2(st.r))+'</b></span><span class="'+(st.pct>=0?'pos':'neg')+'"><b>'+(st.pct>=0?'+':'')+st.pct.toFixed(2)+'%</b></span>'):'<span class="rp-muted">'+(nAr&&cleanOnly()?'No clean trades':'No trades yet')+'</span>')+
      (nAr?'<div class="rp-filter"><span class="rp-warn">After cut: '+nAr+'</span><span class="rp-seg-mini"><button type="button" data-f="all" class="'+(cleanOnly()?'':'is-on')+'">All</button><button type="button" data-f="clean" class="'+(cleanOnly()?'is-on':'')+'">Clean</button></span></div>':'')+
      (nHid?'<div class="rp-filter"><span class="rp-muted" title="Hidden on the chart — still counted in stats">Hidden: '+nHid+'</span><button type="button" class="rp-mini" data-unhide="1">Show hidden</button></div>':'');
    var dis=s.cur>=s.endIdx; $('rpLong').disabled=$('rpShort').disabled=dis;
  }
  function bindTradeUi(){
    $('rpLong').addEventListener('click',function(){ var d=S.sess&&S.sess.draft; if(d&&d.dir>0) cancelDraft(); else makeDraft(1); });
    $('rpShort').addEventListener('click',function(){ var d=S.sess&&S.sess.draft; if(d&&d.dir<0) cancelDraft(); else makeDraft(-1); });
    $('rpDraftOk').addEventListener('click',confirmDraft);
    $('rpDraftCancel').addEventListener('click',cancelDraft);
    $('rpStats').addEventListener('click',function(e){
      if(e.target.closest('[data-unhide]')){ unhideAll(); return; }
      var b=e.target.closest('[data-f]'); var br=bridge(), s=S.sess; if(!b||!br||!s||!s.btId) return;
      br.updateBacktest(s.btId,{ cleanOnly:b.getAttribute('data-f')==='clean' }); renderTrade(false);
    });
    $('rpPosList').addEventListener('click',function(e){ var b=e.target.closest('[data-close]'); if(b) closeManual(b.getAttribute('data-close')); });
    $('rpRisk').addEventListener('input',function(){ var v=this.value.replace(/[^0-9.,]/g,''); if(v!==this.value) this.value=v; });
    $('rpRisk').addEventListener('change',function(){ if(prefKey()) setPref({ risk:readRisk() }); });
    $('rpTradeToggle').addEventListener('click',function(){ var t=$('rpTrade'); t.classList.toggle('is-collapsed'); try { if(uid()) localStorage.setItem(COLLAPSE_KEY+'_'+uid(),t.classList.contains('is-collapsed')?'1':'0'); } catch(_){} });
    [['rpInEntry','entry'],['rpInSL','sl'],['rpInTP','tp']].forEach(function(x){
      $(x[0]).addEventListener('input',function(){
        var dr=S.sess&&S.sess.draft; if(!dr) return; var v=parseFloat(String(this.value).replace(',','.'));
        if(x[1]==='tp'&&this.value==='') dr.tp=null; else if(!isFinite(v)) return; else if(x[1]==='entry'){ dr.entry=v; dr.market=false; } else dr[x[1]]=v;
        requestDraw();
      });
    });
    applyPref();
  }

  /* chart overlay: TradingView-style boxes (series primitive) + dragging of entry / SL / TP */
  function requestDraw(){ if(S.primReq) S.primReq(); }
  function xOfTs(ts){
    var s=S.sess, d=s.d; if(ts==null) return null;
    var idx=lowerBound(d.T,ts+1,d.n)-1; if(idx<0) return null; if(idx>s.cur) idx=s.cur;
    var bk=buckets(d,S.tf), b=bk.b2[idx]; if(b<0) return -50;
    if(b<S.dispFrom) return -50;
    var x=S.chart.timeScale().timeToCoordinate(bk.Tm[b]); return x==null?null:x;
  }
  function rrect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function drawLabel(ctx,hr,vr,text,xc,y,bg,fg,W,size){
    var sz=size||11, fs=sz*vr; ctx.font='600 '+fs+'px Poppins, sans-serif'; var w=ctx.measureText(text).width+(sz+1)*hr, h=Math.max(18,sz+7)*vr;
    var x=xc*hr-w/2; x=Math.max(4*hr,Math.min(x,(W-4)*hr-w)); rrect(ctx,x,y*vr-h/2,w,h,5*vr); ctx.fillStyle=bg; ctx.fill(); ctx.fillStyle=fg; ctx.textBaseline='middle'; ctx.fillText(text,x+6*hr,y*vr+0.5*vr);
  }
  function posSt(dir){ return S.style.pos[dir>0?'long':'short']; }
  function mulAlpha(css,k){ var c=parseColor(css); if(!c) return css; c.a=Math.max(0,Math.min(1,c.a*k)); return colorCss(c); }
  function opaque(css){ var c=parseColor(css); if(!c) return css; c.a=1; return colorCss(c); }
  function posDash(style,w,hr){ return style==='dashed'?[(4+w)*hr,(3+w)*hr]:style==='dotted'?[w*hr,(2+w)*hr]:[]; }
  function drawBox(ctx,hr,vr,W,o){
    var Y=function(v){ return S.series.priceToCoordinate(v); };
    var yE=Y(o.entry), ySL=Y(o.sl), yTP=o.tp!=null?Y(o.tp):null; if(yE==null||ySL==null) return;
    var x0=o.x0, x1=o.x1; if(x0==null) return; if(x1==null) x1=W;
    var xr=x1; /* the true right edge (before clipping) is where the drag handle sits */
    x0=Math.max(x0,0); x1=Math.min(Math.max(x1,x0+3),W); if(x0>=W||x1<=0) return;
    var st=posSt(o.dir), cl=o.state==='closed', soft=o.state==='draft'||o.state==='pending';
    var fillK=cl?0.67:soft?0.75:1, lineK=cl?0.45:1;
    var rect=function(ya,yb,col){ ctx.fillStyle=col; ctx.fillRect(x0*hr,Math.min(ya,yb)*vr,(x1-x0)*hr,Math.abs(yb-ya)*vr); };
    if(yTP!=null) rect(yE,yTP,mulAlpha(st.target,fillK));
    rect(yE,ySL,mulAlpha(st.stop,fillK));
    var lw=st.line.width, odd=Math.round(lw*vr)%2===1;
    var line=function(y,col){
      ctx.strokeStyle=col; ctx.lineWidth=lw*vr; ctx.setLineDash(posDash(st.line.style,lw,hr)); ctx.lineCap=st.line.style==='dotted'?'round':'butt';
      var yy=Math.round(y*vr)+(odd?0.5:0); ctx.beginPath(); ctx.moveTo(x0*hr,yy); ctx.lineTo(x1*hr,yy); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap='butt';
    };
    line(yE,mulAlpha(st.line.color,lineK)); line(ySL,mulAlpha(opaque(st.stop),lineK)); if(yTP!=null) line(yTP,mulAlpha(opaque(st.target),lineK));
    var ys=[yE,ySL].concat(yTP!=null?[yTP]:[]), yt=Math.min.apply(null,ys), yb=Math.max.apply(null,ys);
    S.boxHits.push({ dir:o.dir, x0:x0, x1:x1, y0:yt, y1:yb });
    if(cl){
      ctx.fillStyle=o.r>=0?'#34d399':'#f87171'; ctx.beginPath(); ctx.arc(x1*hr,Y(o.exit)*vr,3.5*hr,0,Math.PI*2); ctx.fill();
      S.closedHits.push({ id:o.id, x0:x0, x1:x1, y0:yt, y1:yb });
      return;
    }
    var lx=(x0+x1)/2, tc=st.text.color, ts=st.text.size, R=function(price){ return o.risk>0?o.dir*(price-o.entry)/o.risk:0; };
    var tag=(o.dir>0?'LONG':'SHORT')+((o.state==='pending'||(o.state==='draft'&&o.kind))?(o.kind==='stop'?' STOP':' LIMIT'):'')+(o.state==='open'?'  '+sgnR(r2(R(o.price))):'');
    drawLabel(ctx,hr,vr,tag,lx,yE,o.state==='open'?(R(o.price)>=0?'rgba(52,211,153,.92)':'rgba(248,113,113,.92)'):'#c9ced8',tc,W,ts);
    drawLabel(ctx,hr,vr,'SL '+fp(o.sl)+' · '+sgnR(r2(R(o.sl))),lx,ySL,mulAlpha(opaque(st.stop),0.92),tc,W,ts);
    if(yTP!=null) drawLabel(ctx,hr,vr,'TP '+fp(o.tp)+' · '+sgnR(r2(R(o.tp))),lx,yTP,mulAlpha(opaque(st.target),0.92),tc,W,ts);
    if(o.live){
      if(o.entryDrag) S.hits.push({ kind:'entry', ref:o.ref, y:yE, x0:x0, x1:x1 });
      S.hits.push({ kind:'sl', ref:o.ref, y:ySL, x0:x0, x1:x1 }); if(yTP!=null) S.hits.push({ kind:'tp', ref:o.ref, y:yTP, x0:x0, x1:x1 });
      if(xr<W-1){
        S.edgeHits.push({ kind:'edge', ref:o.ref, x:xr, y0:yt, y1:yb });
        var hs=7*hr, ex=Math.round(xr*hr-hs/2), ey=Math.round(yE*vr-hs/2);
        ctx.fillStyle='#2962ff'; ctx.fillRect(ex,ey,hs,hs); ctx.strokeStyle='#ffffff'; ctx.lineWidth=Math.max(1,Math.round(1*hr)); ctx.strokeRect(ex+0.5,ey+0.5,hs-1,hs-1);
      }
    }
  }
  /* right edge of a live position, in pixels (null when it cannot be placed) */
  function edgeX(p){
    if(p.endT==null) return null; var lg=tsToLg(p.endT); if(lg==null) return null;
    return lgToX(lg-S.dispFrom);
  }
  function curBar(){ var s=S.sess, bk=buckets(s.d,S.tf); return bk.b2[s.cur]; }
  function newEndT(){ var cl=curBar(); return cl<0?null:Math.round(lgToTs(cl+25)); }
  /* a position is 25 candles wide when it is placed; when the current candle reaches its right edge the edge jumps 10 candles on */
  function growBoxes(){
    var s=S.sess; if(!s||!S.chart) return false; var cl=curBar(); if(cl<0) return false; var ch=false;
    var list=s.pos.slice(); if(s.draft) list.push(s.draft);
    list.forEach(function(p){
      if(p.endT==null){
        var t0=p.openT||p.placedT||nowT(), e0=tsToLg(t0-1); p.endT=Math.round(lgToTs(Math.max((e0==null?cl:e0)+25,cl+10))); ch=true; return;
      }
      var e=tsToLg(p.endT); if(e==null) return;
      if(cl>=e-1e-6){ p.endT=Math.round(lgToTs(Math.max(Math.round(e),cl)+10)); ch=true; }
    });
    return ch;
  }
  function setEdge(p,x){
    var lg=xToLg(x); if(lg==null) return; var cl=curBar(); if(cl<0) return;
    var t=Math.max(Math.round(lg+S.dispFrom),cl+1); p.endT=Math.round(lgToTs(t));
  }
  function drawTrades(sc){
    var s=S.sess; S.hits=[]; S.closedHits=[]; S.boxHits=[]; S.edgeHits=[]; if(!s||!S.series||!S.chart) return;
    growBoxes();
    drawCurrentPrice(sc);
    var ctx=sc.context, hr=sc.horizontalPixelRatio, vr=sc.verticalPixelRatio, W=sc.mediaSize.width, price=curPrice();
    var nowTs=nowT();
    drawDrawings(ctx,hr,vr);
    s.closed.forEach(function(c){
      if(c.hid||c.openT>nowTs) return; /* hidden on the chart, or not reached yet (after a cut) */
      drawBox(ctx,hr,vr,W,{ state:'closed', id:c.id, ar:c.ar, dir:c.dir, entry:c.entry, sl:c.sl, tp:c.tp, exit:c.exit, r:c.r, risk:Math.abs(c.entry-c.sl), x0:xOfTs(c.openT), x1:xOfTs(Math.min(c.closeT,nowTs)-1) });
    });
    s.pos.forEach(function(p){
      drawBox(ctx,hr,vr,W,{ state:p.status, kind:p.kind, dir:p.dir, entry:p.entry, sl:p.sl, tp:p.tp, risk:p.risk0, price:price, live:true, entryDrag:p.status==='pending', ref:p, x0:xOfTs(p.status==='open'?p.openT:p.placedT), x1:edgeX(p) });
    });
    if(s.draft){
      var dr=s.draft, en=dr.market?price:dr.entry, dk=(!dr.market&&Math.abs(en-price)>=Math.pow(10,-s.d.dp)/2)?(dr.dir>0?(en>price?'stop':'limit'):(en<price?'stop':'limit')):null;
      drawBox(ctx,hr,vr,W,{ state:'draft', kind:dk, dir:dr.dir, entry:en, sl:dr.sl, tp:dr.tp, risk:Math.abs(en-dr.sl), price:price, live:true, entryDrag:true, ref:dr, x0:xOfTs(nowT()), x1:edgeX(dr) });
    }
    if(S.rewind&&S.cut){
      /* TradingView-style cut preview: everything right of the chosen candle is dimmed, a blue line marks the cut */
      var bs=S.chart.timeScale().options().barSpacing||6, cx=S.cut.x, dx=Math.round((cx+Math.max(2,bs/2))*hr), Hh=sc.bitmapSize.height;
      if(dx<sc.bitmapSize.width){ ctx.fillStyle=dimColor(); ctx.fillRect(dx,0,sc.bitmapSize.width-dx,Hh); }
      var lw=Math.max(2,Math.round(1.5*hr)); ctx.fillStyle='#2962ff'; ctx.fillRect(Math.round(cx*hr-lw/2),0,lw,Hh);
    }
    drawDrOverlay(ctx,hr,vr);
  }
  function makePrimitive(){
    var view={ zOrder:function(){ return 'top'; }, renderer:function(){ return { draw:function(target){ target.useBitmapCoordinateSpace(drawTrades); } }; } };
    var sview={ zOrder:function(){ return 'bottom'; }, renderer:function(){ return { draw:function(target){ target.useBitmapCoordinateSpace(function(sc){ drawSessions(sc); drawImbalances(sc); }); } }; } };
    var axisView={
      coordinate:function(){ return S.cut?S.cut.x:0; }, text:function(){ return S.cut?S.cut.label:''; },
      textColor:function(){ return '#ffffff'; }, backColor:function(){ return '#2962ff'; },
      visible:function(){ return !!(S.rewind&&S.cut); }, tickVisible:function(){ return true; }
    };
    var priceView={
      coordinate:function(){ return S.sess&&S.series?S.series.priceToCoordinate(curPrice())||0:0; },
      text:function(){ return S.sess?fp(curPrice()):''; },
      textColor:function(){ return S.style.currentPrice.label.text; },
      backColor:function(){ return S.style.currentPrice.label.color; },
      visible:function(){ return !!(S.sess&&S.series&&S.style.currentPrice.label.on&&S.series.priceToCoordinate(curPrice())!=null); },
      tickVisible:function(){ return false; }
    };
    function snapAxis(price){ return {
      coordinate:function(){var m=S.dr.snap;return m?(price?m.y:m.x):0;},
      text:function(){var m=S.dr.snap;if(!m)return '';if(price)return S.series.priceFormatter().format(m.p);var bk=buckets(S.sess.d,S.tf);return fmtAxis(bk.Tm[Math.round(tsToLg(m.t))]);},
      textColor:function(){return '#fff';},backColor:function(){return S.style.cross.color;},
      visible:function(){return !!(S.sess&&S.dr.snap&&S.dr.crossSet&&!S.rewind&&(price||!S.hideDate));},tickVisible:function(){return true;}
    }; }
    var snapTime=snapAxis(false),snapPrice=snapAxis(true);
    return { attached:function(p){ S.primReq=p.requestUpdate; }, detached:function(){ S.primReq=null; }, paneViews:function(){ return [sview,view]; }, timeAxisViews:function(){ return [axisView,snapTime]; }, priceAxisViews:function(){ return [priceView,snapPrice]; }, updateAllViews:function(){} };
  }
  function hitTest(e){
    if(e.shiftKey) return null;
    if(S.dr&&(S.dr.tool!=='cursor'||S.dr.place||S.dr.op)) return null;
    var el=$('rpChart'), r=el.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, best=null, bd=7;
    var eg=null, ed=6; (S.edgeHits||[]).forEach(function(h){ var dd=Math.abs(h.x-x); if(dd<=ed&&y>=h.y0-4&&y<=h.y1+4){ ed=dd; eg=h; } });
    if(eg) return eg;
    (S.hits||[]).forEach(function(h){ var dd=Math.abs(h.y-y); if(dd<=bd&&x>=h.x0-2&&x<=h.x1+2){ bd=dd; best=h; } });
    return best;
  }
  function setLevel(h,price){
    price=rnd(price); var o=h.ref;
    if(h.kind==='entry'){
      o.entry=price; if('market' in o) o.market=false;
      if(o.status==='pending'){ var cp=curPrice(); o.risk0=Math.abs(o.entry-o.sl); o.kind=o.dir>0?(o.entry>cp?'stop':'limit'):(o.entry<cp?'stop':'limit'); }
    }
    else if(h.kind==='sl'){ o.sl=price; if(o.status==='pending') o.risk0=Math.abs(o.entry-o.sl); }
    else if(h.kind==='tp'){ o.tp=price; }
  }
  function lastBarTime(){ var s=S.sess; if(!s) return null; var bk=buckets(s.d,S.tf), b=bk.b2[s.cur]; return b>=0?bk.Tm[b]:null; }
  function hitClosed(e){
    var r=$('rpChart').getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, best=null, ba=1e12;
    (S.closedHits||[]).forEach(function(h){
      if(x>=h.x0-4&&x<=h.x1+4&&y>=h.y0-4&&y<=h.y1+4){ var a=(h.x1-h.x0+8)*(h.y1-h.y0+8); if(a<ba){ ba=a; best=h; } }
    });
    return best;
  }
  function hideClosed(id){
    var s=S.sess, b=bridge(); if(!s) return;
    var t=s.closed.filter(function(x){ return x.id===id; })[0]; if(!t) return;
    t.hid=true; if(b&&b.patchTrade) b.patchTrade(id,{ hiddenOnChart:true });
    saveSession(); renderTrade(true); requestDraw(); toast('Trade hidden on the chart — still counted in stats (Ctrl + middle click — delete permanently)');
  }
  function unhideAll(){
    var s=S.sess, b=bridge(); if(!s) return; var n=0;
    s.closed.forEach(function(t){ if(t.hid){ t.hid=false; n++; if(b&&b.patchTrade) b.patchTrade(t.id,{ hiddenOnChart:false }); } });
    if(n){ saveSession(); renderTrade(true); requestDraw(); toast('Trades shown: '+n); }
  }
  function deleteClosed(id){
    var s=S.sess, b=bridge(); if(!s) return;
    var t=s.closed.filter(function(x){ return x.id===id; })[0]; if(!t) return;
    s.closed=s.closed.filter(function(x){ return x.id!==id; });
    if(b) b.deleteTrade(id);
    saveSession(); renderTrade(true); requestDraw(); toast('Trade deleted permanently ('+sgnR(t.r)+')','warn');
  }

  /* ---------- cut (TradingView-style "select bar": trim the chart back to a chosen candle) ---------- */
  function setRewind(on){
    var s=S.sess; if(on&&!s) return;
    if(on&&S.dr&&S.dr.tool!=='cursor') drSetTool('cursor'); S.rewind=!!on; S.cut=null; $('rpBtnCut').classList.toggle('is-on',S.rewind); $('rpChart').classList.toggle('is-cut',S.rewind);
    if(S.chart) S.chart.applyOptions({ crosshair:{ vertLine:{ visible:!S.rewind, labelVisible:!S.rewind } } });
    if(S.rewind){ stopPlay(); cancelDraft(); closeMenu(); toast('Cut: hover a candle and click — the chart is cut there. Esc — cancel.'); }
    requestDraw();
  }
  function hideRewindLine(){ if(S.cut){ S.cut=null; requestDraw(); } }
  function rewindTargetAt(e){
    var s=S.sess; if(!s||!S.chart) return null;
    var x=e.clientX-$('rpChart').getBoundingClientRect().left, t=S.chart.timeScale().coordinateToTime(x); if(t==null) return null;
    var bk=buckets(s.d,S.tf), b=lowerBound(bk.Tm,t,bk.Tm.length); if(b>=bk.Tm.length||bk.Tm[b]!==t) return null;
    var cb=bk.b2[s.cur]; if(b>cb) return null;
    var cx=S.chart.timeScale().timeToCoordinate(t); if(cx==null) return null;
    return { b:b, t:t, x:cx, last:b===cb };
  }
  function updateRewindLine(e){
    var tg=rewindTargetAt(e); if(!tg||tg.last){ hideRewindLine(); return; }
    var dtm=S.tf!=='1D'&&S.tf!=='1W'&&S.tf!=='1M'&&S.tf!=='3M';
    S.cut={ x:tg.x, t:tg.t, label:S.hideDate?'Cut':'Cut: '+(dtm?fmtTz(tg.t,true):fmtDate(tg.t,false)) }; requestDraw();
  }
  /* smooth scroll of the visible range (cubic-bezier(.65,0,.3,1), measured from the TradingView reference) */
  function bezierEase(x1,y1,x2,y2){
    return function(x){
      if(x<=0) return 0; if(x>=1) return 1;
      var lo=0, hi=1, t=x; for(var i=0;i<30;i++){ t=(lo+hi)/2; var bx=3*(1-t)*(1-t)*t*x1+3*(1-t)*t*t*x2+t*t*t; if(bx<x) lo=t; else hi=t; }
      return 3*(1-t)*(1-t)*t*y1+3*(1-t)*t*t*y2+t*t*t;
    };
  }
  var easeCut=bezierEase(0.65,0,0.3,1);
  function cancelAnim(){ var a=S.anim; if(a){ clearTimeout(a.t); cancelAnimationFrame(a.r); S.anim=null; } }
  function animateRange(a,z,delay,dur){
    cancelAnim(); var ts=S.chart.timeScale(); ts.setVisibleLogicalRange(a);
    var reduce=false; try { reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){}
    if(reduce||Math.abs(z.from-a.from)<0.5){ ts.setVisibleLogicalRange(z); return; }
    var an=S.anim={};
    an.t=setTimeout(function(){
      var t0=performance.now();
      (function tick(now){
        if(S.anim!==an) return;
        var u=Math.min(1,(now-t0)/dur), p=easeCut(u);
        ts.setVisibleLogicalRange({ from:a.from+(z.from-a.from)*p, to:a.to+(z.to-a.to)*p });
        if(u<1) an.r=requestAnimationFrame(tick); else S.anim=null;
      })(t0);
    },delay);
  }
  function doRewind(tg){
    var s=S.sess; if(!s) return;
    if(tg.last){ toast('This is the current candle — nothing to cut.','warn'); return; }
    var bk=buckets(s.d,S.tf), newCur=bk.La[tg.b];
    if(newCur<s.startIdx){ toast('You can only cut inside the selected period.','warn'); return; }
    cancelAnim();
    var lr=S.chart.timeScale().getVisibleLogicalRange(), w=lr?(lr.to-lr.from):160, oldIdx=tg.b-S.dispFrom;
    if(s.cur>s.maxIdx) s.maxIdx=s.cur;
    s.cur=newCur; s.draft=null;
    var now=nowT(), dropped=0;
    s.pos=s.pos.filter(function(p){ var t=p.status==='open'?p.openT:p.placedT; if(t>now){ dropped++; return false; } return true; });
    setRewind(false); stopPlay();
    fullRefresh(true);
    var b2=buckets(s.d,S.tf).b2[s.cur], len=b2-S.dispFrom+1, fin={ from:len+14-w, to:len+14 };
    /* like TradingView: the chart first stays put with the chosen candle where it was, then glides so the last candle sits at the right edge */
    if(lr){ var sh=(len-1)-oldIdx; animateRange({ from:lr.from+sh, to:lr.to+sh },fin,200,500); }
    else S.chart.timeScale().setVisibleLogicalRange(fin);
    saveSession(); renderTrade(true); requestDraw();
    toast('Chart cut at '+(S.hideDate?'the selected candle':fmtTz(s.d.T[s.cur],true)+' '+tzTag(s.d.T[s.cur]))+(dropped?' · orders/positions cancelled: '+dropped:''),'warn');
  }

  /* cursor shapes: position levels / right edge (pcur-*) and drawings (dcur-*) are separate class sets on the chart */
  function setCurCls(pref,c){
    var el=$('rpChart'); if(!el) return;
    ['ns','ew','nwse','nesw','grab','grabbing'].forEach(function(k){ el.classList.toggle(pref+k,k===c); });
  }
  function setPosCur(c){ setCurCls('pcur-',c); }
  function setDrCur(c){ setCurCls('dcur-',c); }
  function bindChartDrag(){
    var el=$('rpChart'), LW=window.LightweightCharts;
    el.addEventListener('wheel',cancelAnim,{ capture:true, passive:true });
    el.addEventListener('pointerdown',function(e){
      if(S.anim) cancelAnim();
      if(e.button!==0||!S.sess) return;
      if(S.rewind){ e.preventDefault(); e.stopPropagation(); var tg=rewindTargetAt(e); if(tg) doRewind(tg); return; }
      var h=hitTest(e); if(!h) return;
      e.preventDefault(); e.stopPropagation(); S.drag=h; try { el.setPointerCapture(e.pointerId); } catch(_){}
      S.chart.applyOptions({ handleScroll:false, handleScale:false }); setPosCur(h.kind==='edge'?'ew':'ns');
    },true);
    el.addEventListener('mousedown',function(e){
      if(!S.sess) return;
      if(e.button===1){ /* middle click: delete a drawing; on a saved trade it hides it, Ctrl / Cmd + middle deletes it for good */
        if(drMiddle(e)) return;
        var c=hitClosed(e); if(c){ e.preventDefault(); e.stopPropagation(); if(e.ctrlKey||e.metaKey) deleteClosed(c.id); else hideClosed(c.id); } return;
      }
      if(S.dr&&S.dr.capture) e.preventDefault();
      if(S.rewind||S.drag||(S.dr&&S.dr.capture)||hitTest(e)) e.stopPropagation();
    },true);
    el.addEventListener('auxclick',function(e){ if(e.button===1&&S.sess&&(hitClosed(e)||(S.drawHit&&S.drawHit(e)))){ e.preventDefault(); e.stopPropagation(); } },true);
    el.addEventListener('pointerleave',function(){ hideRewindLine(); });
    el.addEventListener('pointermove',function(e){
      if(!S.sess) return;
      if(S.rewind){ updateRewindLine(e); return; }
      if(S.drag){
        var rc=el.getBoundingClientRect(), y=e.clientY-rc.top, pr=S.series.coordinateToPrice(y);
        if(S.drag.kind==='edge'){ setEdge(S.drag.ref,e.clientX-rc.left); requestDraw(); }
        else if(pr!=null&&isFinite(pr)){ setLevel(S.drag,pr); requestDraw(); renderTrade(false); }
        /* the chart does not get mouse events while a level is dragged, so keep its crosshair alive by hand */
        try {
          var tt=S.chart.timeScale().coordinateToTime(e.clientX-rc.left); if(tt==null) tt=lastBarTime();
          if(pr!=null&&tt!=null) S.chart.setCrosshairPosition(pr,tt,S.series);
        } catch(_){}
        e.stopPropagation(); return;
      }
      var hh=hitTest(e); setPosCur(hh?(hh.kind==='edge'?'ew':'ns'):null);
    },true);
    function end(e){
      if(!S.drag) return; S.drag=null; try { el.releasePointerCapture(e.pointerId); } catch(_){}
      S.chart.applyOptions({ handleScroll:true, handleScale:true }); setPosCur(null);
      try { S.chart.clearCrosshairPosition(); } catch(_){}
      saveSession(); renderTrade(true);
    }
    el.addEventListener('pointerup',end,true); el.addEventListener('pointercancel',end,true);
  }

  /* ================= step 4 · chart customisation + templates ================= */
  var LINE_CODE = { solid:0, dotted:1, dashed:2 };
  var CROSS_CODE = { solid:0, dotted:1, dashed:3 };
  var SIZES = [10,11,12,13,14,16,18,20,24,28,32,40];
  var TRANSPARENT = 'rgba(0,0,0,0)';
  var STYLE_KEY = 'tj_replay_style', PROF_KEY = 'tj_replay_profiles';
  function cloneStyle(o){ return JSON.parse(JSON.stringify(o)); }
  function hex2(n){ n=Math.max(0,Math.min(255,Math.round(n))); return (n<16?'0':'')+n.toString(16); }
  function parseColor(c){
    if(typeof c!=='string') return null; c=c.trim(); var m;
    if((m=/^#([0-9a-f]{3})$/i.exec(c))) return { r:parseInt(m[1][0]+m[1][0],16), g:parseInt(m[1][1]+m[1][1],16), b:parseInt(m[1][2]+m[1][2],16), a:1 };
    if((m=/^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c))) return { r:parseInt(m[1].slice(0,2),16), g:parseInt(m[1].slice(2,4),16), b:parseInt(m[1].slice(4,6),16), a:m[2]?parseInt(m[2],16)/255:1 };
    if((m=/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(c))) return { r:+m[1], g:+m[2], b:+m[3], a:m[4]==null?1:Math.max(0,Math.min(1,+m[4])) };
    return null;
  }
  function colorCss(o){
    var a=Math.max(0,Math.min(1,o.a));
    if(a>=0.995) return '#'+hex2(o.r)+hex2(o.g)+hex2(o.b);
    return 'rgba('+Math.round(o.r)+','+Math.round(o.g)+','+Math.round(o.b)+','+(Math.round(a*100)/100)+')';
  }
  /* keeps only known keys with valid values, everything else falls back to the default */
  function normStyle(src){
    var out=cloneStyle(STYLE_DEFAULT);
    (function walk(def,s,dst){
      Object.keys(def).forEach(function(k){
        var dv=def[k], sv=s?s[k]:undefined;
        if(dv&&typeof dv==='object'){ if(sv&&typeof sv==='object') walk(dv,sv,dst[k]); return; }
        if(typeof dv==='boolean'){ if(typeof sv==='boolean') dst[k]=sv; }
        else if(typeof dv==='number'){ if(typeof sv==='number'&&isFinite(sv)) dst[k]=(k==='width')?Math.max(1,Math.min(4,Math.round(sv))):(k==='size')?Math.max(8,Math.min(40,Math.round(sv))):sv; }
        else if(typeof dv==='string'){
          if(LINE_CODE[dv]!=null){ if(typeof sv==='string'&&LINE_CODE[sv]!=null) dst[k]=sv; }
          else if(parseColor(sv)) dst[k]=sv;
        }
      });
    })(STYLE_DEFAULT,src,out);
    return out;
  }
  /* ---------- three-candle fair value gaps: selected timeframe, closed bars only ---------- */
  function fvgClosed(d,bk,b,cur,tf){
    if(b<0||bk.La[b]>cur) return false;
    if(b+1<bk.F.length&&bk.F[b+1]<=cur) return true;
    var t=d.T[bk.F[b]], end=d.T[cur]+d.D[cur], step={ '5m':300,'15m':900,'30m':1800,'1h':3600 }[tf];
    if(step) return end>=Math.floor(t/step)*step+step;
    var sh=t-nyOff(t)*3600+25200, es=end-nyOff(end-1)*3600+25200, day=Math.floor(sh/86400), boundary;
    if(tf==='4h') boundary=Math.floor(sh/14400)*14400+14400;
    else if(tf==='1D') boundary=(day+1)*86400;
    else if(tf==='1W') boundary=(Math.floor((day+3)/7)*7-3+7)*86400;
    else { var date=new Date(day*864e5), m=date.getUTCMonth(); boundary=Date.UTC(date.getUTCFullYear(),tf==='3M'?Math.floor(m/3)*3+3:m+1,1)/1000; }
    return es>=boundary;
  }
  function fvgInstances(){
    var s=S.sess; if(!s) return null;
    var d=s.d, bk=buckets(d,S.tf), last=bk.b2[s.cur];
    if(!fvgClosed(d,bk,last,s.cur,S.tf)) last--;
    var C=S.fvgC;
    if(!C||C.s!==s||C.tf!==S.tf||s.cur<C.cur) C=S.fvgC={ s:s, tf:S.tf, cur:-1, last:1, zones:[] };
    // Visible candles have at most 3500 intraday/hourly bars; retain their complete history.
    var first=Math.max(2,(S.dispFrom||0));
    for(var b=Math.max(first,C.last+1);b<=last;b++){
      var a=barAt(d,bk,b-2,s.cur), z=barAt(d,bk,b,s.cur);
      if(a.high<z.low) C.zones.push({ first:b-2, last:b, low:a.high, high:z.low, up:true });
      else if(a.low>z.high) C.zones.push({ first:b-2, last:b, low:z.high, high:a.low, up:false });
    }
    C.last=Math.max(C.last,last); C.cur=s.cur; return C;
  }
  function drawImbalances(sc){
    var cfg=S.style&&S.style.fvg; if(!cfg||!cfg.on||!S.sess||!S.chart||!S.series) return;
    var ts=S.chart.timeScale(), vl=ts.getVisibleLogicalRange(), x0=ts.logicalToCoordinate(0), x1=ts.logicalToCoordinate(1);
    if(!vl||x0==null||x1==null) return;
    var C=fvgInstances(), ctx=sc.context, hr=sc.horizontalPixelRatio, vr=sc.verticalPixelRatio;
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,sc.mediaSize.width*hr,sc.mediaSize.height*vr); ctx.clip();
    C.zones.forEach(function(z){
      var a=z.first-S.dispFrom, b=z.last-S.dispFrom; if(b<vl.from-1||a>vl.to+1) return;
      var left=ts.logicalToCoordinate(a), right=ts.logicalToCoordinate(b), top=S.series.priceToCoordinate(z.high), bottom=S.series.priceToCoordinate(z.low);
      if(left==null||right==null||top==null||bottom==null) return;
      ctx.fillStyle=z.up?cfg.up:cfg.down;
      ctx.fillRect(left*hr,top*vr,(right-left)*hr,(bottom-top)*vr);
      if(cfg.mid&&cfg.mid.on) replayLine(ctx,hr,vr,cfg.mid,left,(top+bottom)/2,right,(top+bottom)/2);
    }); ctx.restore();
  }

  /* Shared line style matches the rectangle drawing tool. */
  function replayLine(ctx,hr,vr,line,x0,y0,x1,y1){
    var w=line.width; ctx.save(); ctx.lineWidth=w*hr; ctx.strokeStyle=line.color;
    ctx.lineCap=line.style==='dotted'?'round':'butt';
    ctx.setLineDash(line.style==='solid'?[]:line.style==='dashed'?[(4+w)*hr,(3+w)*hr]:[w*hr,(2+w)*hr]);
    ctx.beginPath(); ctx.moveTo(x0*hr,y0*vr); ctx.lineTo(x1*hr,y1*vr); ctx.stroke(); ctx.restore();
  }
  function drawCurrentPrice(sc){
    var cfg=S.style&&S.style.currentPrice; if(!S.sess||!S.series||!cfg||!cfg.line.on) return;
    var y=S.series.priceToCoordinate(curPrice()); if(y==null||y<0||y>sc.mediaSize.height) return;
    replayLine(sc.context,sc.horizontalPixelRatio,sc.verticalPixelRatio,cfg.line,0,y,sc.mediaSize.width,y);
  }

  /* ---------- trading sessions indicator (Asia / Frankfurt / London / New York) ----------
     Settings live in S.style.sess (kept per account in the prefs document, not in chart templates).
     Session times are stored in UTC minutes; the settings window shows them in the chosen time zone (no daylight saving). */
  var SESS_TFS={ '5m':1, '15m':1, '30m':1, '1h':1, '4h':1 };
  var SESS_DAYS=180;
  var SESS_TZ=[ { id:'UTC', name:'UTC', off:0 }, { id:'TYO', name:'Tokyo (UTC+9)', off:540 }, { id:'MSK', name:'Moscow (UTC+3)', off:180 } ];
  var SESS_STYLES=[ { id:'box', name:'Box' }, { id:'solid', name:'Solid' } ];
  var SESS_LINES=[ { id:'dotted', name:'Dotted' }, { id:'dashed', name:'Dashed' }, { id:'solid', name:'Solid' } ];
  function sessDef(id,name,from,to,fill){
    return { id:id, name:name, show:true, style:'box', from:from, to:to, label:'rgba(255,255,255,.85)', fill:fill, border:'rgba(255,255,255,.35)', bstyle:'dotted', hl:'rgba(255,255,255,.6)', hlstyle:'solid' };
  }
  var SESS_DEF={ on:false, tz:'UTC', list:[
    sessDef('asia','Asia',1260,360,'rgba(41,98,255,.13)'),
    sessDef('frankfurt','Frankfurt',360,420,'rgba(160,165,180,.16)'),
    sessDef('london','London',420,720,'rgba(76,175,80,.14)'),
    sessDef('newyork','New York',720,1260,'rgba(255,152,0,.12)')
  ] };
  function normSess(src){
    var out=cloneStyle(SESS_DEF); if(!src||typeof src!=='object') return out;
    if(typeof src.on==='boolean') out.on=src.on;
    if(SESS_TZ.some(function(z){ return z.id===src.tz; })) out.tz=src.tz;
    if(Array.isArray(src.list)) out.list.forEach(function(d,i){
      var s=src.list[i]; if(!s||typeof s!=='object') return;
      if(typeof s.show==='boolean') d.show=s.show;
      if(s.style==='box'||s.style==='solid') d.style=s.style;
      ['from','to'].forEach(function(k){ var v=s[k]; if(typeof v==='number'&&isFinite(v)) d[k]=(((Math.round(v/15)*15)%1440)+1440)%1440; });
      ['label','fill','border','hl'].forEach(function(k){ if(parseColor(s[k])) d[k]=s[k]; });
      ['bstyle','hlstyle'].forEach(function(k){ if(typeof s[k]==='string'&&LINE_CODE[s[k]]!=null) d[k]=s[k]; });
    });
    return out;
  }
  function sessCfg(){ if(!S.style.sess) S.style.sess=normSess(null); return S.style.sess; }
  function sessOff(){ var t=sessCfg().tz; for(var i=0;i<SESS_TZ.length;i++) if(SESS_TZ[i].id===t) return SESS_TZ[i].off; return 0; }
  function sessHm(m){ m=((m%1440)+1440)%1440; return pad(Math.floor(m/60))+':'+pad(m%60); }
  function sessShown(utcMin){ return (((utcMin+sessOff())%1440)+1440)%1440; }
  function sessStore(key,shownMin){ setPath(S.style,key,(((shownMin-sessOff())%1440)+1440)%1440); }

  /* high / low of every session instance, from the base candles up to the current one only (nothing from the future) */
  function sessScan(d,x,arr,st,en){
    var sec=x.from*60, dur=(((x.to-x.from+1440)%1440)||1440)*60, cur=null;
    for(var i=st;i<=en;i++){
      var t=d.T[i], q=Math.floor((t-sec)/86400), off=t-sec-q*86400;
      if(off>=dur) continue;
      if(cur&&cur.q===q){ cur.i1=i; if(d.H[i]>cur.hi) cur.hi=d.H[i]; if(d.L[i]<cur.lo) cur.lo=d.L[i]; }
      else {
        /* a session cut short by the weekend close and carried on right after the reopening is one session, not two */
        var pv=arr[arr.length-1];
        if(pv&&pv.i1+1===i&&d.T[pv.i1]+d.D[pv.i1]<pv.e){ pv.q=q; pv.e=q*86400+sec+dur; pv.i1=i; if(d.H[i]>pv.hi) pv.hi=d.H[i]; if(d.L[i]<pv.lo) pv.lo=d.L[i]; cur=pv; }
        else { cur={ q:q, i0:i, i1:i, hi:d.H[i], lo:d.L[i], e:q*86400+sec+dur }; arr.push(cur); }
      }
    }
  }
  function sessInstances(){
    var s=S.sess, cfg=sessCfg(); if(!s) return null;
    var d=s.d, sig=cfg.list.map(function(x){ return (x.show?1:0)+':'+x.from+':'+x.to; }).join('|'), C=S.sessC;
    if(!C||C.s!==s||C.d!==d||C.sig!==sig||s.cur<C.cur) C=S.sessC={ s:s, d:d, sig:sig, cur:-1, arr:cfg.list.map(function(){ return []; }) };
    if(C.cur<s.cur){
      var base=C.cur<0?lowerBound(d.T,d.T[s.cur]-SESS_DAYS*86400,s.cur+1):C.cur+1;
      cfg.list.forEach(function(x,k){
        if(!x.show) return; var arr=C.arr[k], st=base;
        if(arr.length) st=arr.pop().i0;
        sessScan(d,x,arr,st,s.cur);
      });
      C.cur=s.cur;
    }
    return C;
  }
  function sessDash(style,lw){ return style==='dashed'?[lw*5,lw*3]:style==='dotted'?[lw,lw*2]:[]; }
  function sessLine(ctx,style,color,lw,x0,y0,x1,y1){
    ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.setLineDash(sessDash(style,lw)); ctx.lineCap='butt';
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke(); ctx.restore();
  }
  function drawSessions(sc){
    var s=S.sess, cfg=S.style&&S.style.sess; if(!s||!S.chart||!S.series||!cfg||!cfg.on||!SESS_TFS[S.tf]) return;
    var C=sessInstances(); if(!C) return;
    var ts=S.chart.timeScale(), a0=ts.logicalToCoordinate(0), a1=ts.logicalToCoordinate(1), vl=ts.getVisibleLogicalRange(); if(a0==null||a1==null||!vl) return;
    var ctx=sc.context, hr=sc.horizontalPixelRatio, vr=sc.verticalPixelRatio, W=sc.mediaSize.width, Hh=sc.mediaSize.height, bs=Math.abs(a1-a0)||6;
    var bk=buckets(s.d,S.tf), b2=bk.b2, intra=(S.tf==='5m'||S.tf==='15m'||S.tf==='30m'), mi=intra?s.d.m5Idx:0, lw=Math.max(1,Math.round(hr));
    cfg.list.forEach(function(x,k){
      if(!x.show) return;
      C.arr[k].forEach(function(it){
        var a=Math.max(it.i0,mi); if(it.i1<a) return;
        var bA=b2[a]-S.dispFrom, bB=b2[it.i1]-S.dispFrom; if(b2[a]<0||b2[it.i1]<0||bB<vl.from-2||bA>vl.to+2) return;
        var xa=lgToX(bA), xb=lgToX(bB); if(xa==null||xb==null) return;
        var L=xa-bs/2, R=xb+bs/2, solid=x.style==='solid', yT, yB;
        if(solid){ yT=0; yB=Hh/vr; }
        else { yT=S.series.priceToCoordinate(it.hi); yB=S.series.priceToCoordinate(it.lo); if(yT==null||yB==null) return; }
        var l=Math.round(L*hr), r=Math.max(l+lw*2,Math.round(R*hr)), t=Math.round(yT*vr), b=Math.max(t+lw*2,Math.round(yB*vr));
        if(!solid&&(b<0||t>Hh)) return; /* scrolled out of sight vertically: nothing to draw */
        ctx.fillStyle=x.fill; ctx.fillRect(l,t,r-l,b-t);
        if(solid){
          sessLine(ctx,x.bstyle,x.border,lw,l+lw/2,0,l+lw/2,Hh); sessLine(ctx,x.bstyle,x.border,lw,r-lw/2,0,r-lw/2,Hh);
        } else {
          sessLine(ctx,x.bstyle,x.border,lw,l+lw/2,t,l+lw/2,b); sessLine(ctx,x.bstyle,x.border,lw,r-lw/2,t,r-lw/2,b);
          sessLine(ctx,x.bstyle,x.border,lw,l,t+lw/2,r,t+lw/2); sessLine(ctx,x.bstyle,x.border,lw,l,b-lw/2,r,b-lw/2);
          sessLine(ctx,x.hlstyle,x.hl,lw,l,t+lw/2,r,t+lw/2); sessLine(ctx,x.hlstyle,x.hl,lw,l,b-lw/2,r,b-lw/2);
        }
        /* name, centred over the visible part of the session */
        var vl2=Math.max(l,0), vr2=Math.min(r,Math.round(W*hr)); if(vr2<=vl2) return;
        var fs=11*vr; if(!solid&&t-Math.round(5*vr)<fs) return; /* the top edge is off the screen: the name goes away with it */
        ctx.font='600 '+fs+'px Poppins, sans-serif'; var tw=ctx.measureText(x.name).width; if(tw>vr2-vl2) return;
        ctx.fillStyle=x.label; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
        ctx.fillText(x.name,(vl2+vr2)/2,solid?Math.round(16*vr):t-Math.round(5*vr));
        ctx.textAlign='start';
      });
    });
  }
  function seriesStyleOpts(st){
    return { priceLineVisible:false, lastValueVisible:false, upColor:st.body.on?st.body.up:TRANSPARENT, downColor:st.body.on?st.body.down:TRANSPARENT,
      borderVisible:!!st.border.on, borderUpColor:st.border.up, borderDownColor:st.border.down,
      wickVisible:!!st.wick.on, wickUpColor:st.wick.up, wickDownColor:st.wick.down };
  }
  function chartStyleOpts(st){
    var ch={ width:st.cross.width, style:CROSS_CODE[st.cross.style], color:st.cross.color };
    return {
      layout:{ background:{ color:st.bg }, textColor:st.scale.text, fontSize:st.scale.size },
      grid:{ vertLines:{ visible:!!st.gridV.on, color:st.gridV.color, style:LINE_CODE[st.gridV.style] }, horzLines:{ visible:!!st.gridH.on, color:st.gridH.color, style:LINE_CODE[st.gridH.style] } },
      crosshair:{ vertLine:Object.assign({}, ch), horzLine:Object.assign({}, ch) },
      rightPriceScale:{ borderColor:st.scale.line }, timeScale:{ borderColor:st.scale.line }
    };
  }
  function applyStyle(){
    if(!S.chart||!S.series) return;
    S.chart.applyOptions(chartStyleOpts(S.style)); S.series.applyOptions(seriesStyleOpts(S.style)); legendTone(); updateSessBtn(); requestDraw();
  }
  function updateSessBtn(){ var b=$('rpSessBtn'), se=!!(S.style&&S.style.sess&&S.style.sess.on); if(b){ b.classList.toggle('is-on',se); b.setAttribute('aria-pressed',String(se)); } var f=$('rpFvgBtn'), on=!!(S.style&&S.style.fvg&&S.style.fvg.on); if(f){ f.classList.toggle('is-on',on); f.setAttribute('aria-pressed',String(on)); } }
  function legendTone(){
    var lg=document.getElementById('rpLegend'); if(!lg) return; var c=parseColor(S.style.bg);
    lg.classList.toggle('is-light', !!c && (0.299*c.r+0.587*c.g+0.114*c.b)>150);
  }
  function dimColor(){ var c=parseColor(S.style.bg)||{ r:12, g:14, b:19 }; return 'rgba('+Math.round(c.r)+','+Math.round(c.g)+','+Math.round(c.b)+',.68)'; }
  function styleStoreKey(){ var u=uid(); return STYLE_KEY+(u?'_'+u:''); }
  function loadStyle(){
    var st=null; try { var r=localStorage.getItem(styleStoreKey()); if(r) st=JSON.parse(r); } catch(_){}
    S.style=normStyle(st); var lp=readPosLocal(); if(lp) S.style.pos=normPos(lp.pos); S.style.sess=normSess(readPref().ind); S.style.fvg=normStyle({ fvg:readPref().fvg }).fvg; applyStyle();
  }
  /* chart style without the position boxes: those are kept separately and are not part of templates */
  function chartOnly(st){ var o=cloneStyle(st); delete o.pos; delete o.sess; delete o.fvg; return o; }
  function saveStyle(){ try { localStorage.setItem(styleStoreKey(), JSON.stringify(chartOnly(S.style))); } catch(_){} }
  function setChartStyle(st){ var pos=S.style.pos, se=S.style.sess, fg=S.style.fvg; S.style=normStyle(st); S.style.pos=pos; S.style.sess=se; S.style.fvg=fg; }
  function normPos(p){ return normStyle({ pos:p }).pos; }
  var POS_KEY='tj_replay_posstyle';
  function posStoreKey(){ var u=uid(); return POS_KEY+(u?'_'+u:''); }
  function readPosLocal(){
    try { var r=JSON.parse(localStorage.getItem(posStoreKey())||'null'); if(r&&r.style&&r.style.pos) return { pos:r.style.pos, at:String(r.at||'') }; } catch(_){}
    return null;
  }
  function pushPosRemote(){
    var b=bridge(); if(!(b&&b.profileSave&&b.ready()&&b.isOwnAccount())) return;
    b.profileSave({ id:'posstyle', kind:'posStyle', name:'posStyle', style:{ pos:S.style.pos }, updateOnly:true }).catch(function(err){ console.error('replay position style save failed:',err); });
  }
  function savePosStyle(){
    var at=new Date().toISOString();
    try { localStorage.setItem(posStoreKey(), JSON.stringify({ style:{ pos:S.style.pos }, at:at })); } catch(_){}
    pushPosRemote();
  }
  /* at session start the newest copy wins (this device or the database): position-box style and drawing-tool defaults */
  function newestOf(list,kind){ return (list||[]).filter(function(x){ return x&&x.kind===kind&&x.style; }).sort(function(a,c){ return String(c.updatedAt)<String(a.updatedAt)?-1:1; })[0]; }
  function syncPrefs(){
    var b=bridge(); if(!(b&&b.profilesLoad&&b.ready()&&b.isOwnAccount())) return; var me=uid();
    b.profilesLoad().then(function(list){
      if(uid()!==me) return; /* the account changed while the request was running */
      var rem=newestOf(list,'posStyle'), loc=readPosLocal();
      if(rem&&rem.style.pos&&(!loc||String(rem.updatedAt)>loc.at)){
        if(!S.set){
          S.style.pos=normPos(rem.style.pos);
          try { localStorage.setItem(posStoreKey(), JSON.stringify({ style:{ pos:S.style.pos }, at:String(rem.updatedAt) })); } catch(_){}
          requestDraw();
        }
      } else if(loc&&(!rem||loc.at>String(rem.updatedAt))) pushPosRemote();
      drSyncUi(newestOf(list,'drawUi')); syncPref(newestOf(list,'prefs'));
    }).catch(function(){});
  }
  function getPath(o,p){ var a=p.split('.'); for(var i=0;i<a.length&&o!=null;i++) o=o[a[i]]; return o; }
  function setPath(o,p,v){ var a=p.split('.'); for(var i=0;i<a.length-1;i++) o=o[a[i]]; o[a[a.length-1]]=v; }
  function sameStyle(a,b){ return JSON.stringify(chartOnly(normStyle(a)))===JSON.stringify(chartOnly(normStyle(b))); }

  /* ---- palette (TradingView-like: greys, saturated row, then tints and shades) ---- */
  var PALETTE=(function(){
    var greys=['#ffffff','#dbdbdb','#b2b5be','#9c9c9c','#787b86','#5d606b','#434651','#2a2e39','#131722','#000000'];
    var base=['#f23645','#ff9800','#ffeb3b','#4caf50','#089981','#00bcd4','#2962ff','#673ab7','#9c27b0','#e91e63'];
    var mix=function(h,t,to){ var c=parseColor(h); return '#'+hex2(c.r+(to-c.r)*t)+hex2(c.g+(to-c.g)*t)+hex2(c.b+(to-c.b)*t); };
    var rows=[greys,base];
    [[.82,255],[.66,255],[.5,255],[.3,255],[.28,0],[.52,0]].forEach(function(p){ rows.push(base.map(function(h){ return mix(h,p[0],p[1]); })); });
    return rows;
  })();

  var ICON_X='<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l10 10M14 4 4 14"/></svg>';
  var ICON_TOOL='<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2v3M5 11v3M3.5 5h3v6h-3zM13 4v3M13 13v2.5M11.5 7h3v6h-3z"/></svg>';
  var ICON_POS='<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h13v4.2h-13zM2.5 7.7h13v6.8h-13z"/><path d="M2.5 7.7h13"/></svg>';
  var ICON_SESS='<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h3.6v6.5H2.5zM7.2 3.5h3.6v11H7.2zM11.9 6h3.6v8.5h-3.6z"/></svg>';
  var ICON_CLOCK='<svg class="rps-clock" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5.6"/><path d="M7 3.8V7l2.1 1.4"/></svg>';
  var ICON_PEN='<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15l.7-3L12 3.7a1.4 1.4 0 0 1 2 0l.3.3a1.4 1.4 0 0 1 0 2L6 14.3 3 15zM10.8 4.9l2.3 2.3"/></svg>';

  function buildSettingsDom(){
    if($('rpSet')) return;
    var ov=document.createElement('div'); ov.className='rps-overlay'; ov.id='rpSet'; ov.setAttribute('aria-hidden','true');
    ov.innerHTML=
      '<div class="rps-dialog" id="rpsDialog" role="dialog" aria-label="Settings">'+
        '<div class="rps-head" id="rpsHead"><div class="rps-title">Settings</div><button class="rps-x" id="rpsClose" type="button" aria-label="Close">'+ICON_X+'</button></div>'+
        '<div class="rps-body"><nav class="rps-nav" id="rpsNav">'+
          '<button type="button" class="rps-tab" data-tab="tool">'+ICON_TOOL+'<span>Symbol</span></button>'+
          '<button type="button" class="rps-tab" data-tab="look">'+ICON_PEN+'<span>Appearance</span></button>'+
          '<button type="button" class="rps-tab" data-tab="pos">'+ICON_POS+'<span>Positions</span></button>'+
          '<button type="button" class="rps-tab" data-tab="sess">'+ICON_SESS+'<span>Sessions</span></button>'+
          '<button type="button" class="rps-tab" data-tab="fvg">'+ICON_POS+'<span>Imbalance</span></button>'+
        '</nav><div class="rps-pane" id="rpsPane"></div></div>'+
        '<div class="rps-foot"><button class="rps-sel" id="rpsTpl" type="button"><span>Template</span>'+ICON_CHEV+'</button><span class="rps-sp"></span>'+
          '<button class="rps-b" id="rpsCancel" type="button">Cancel</button><button class="rps-b rps-ok" id="rpsOk" type="button">OK</button></div>'+
      '</div>'+
      '<div class="rps-pop" id="rpsPop"></div>';
    document.body.appendChild(ov);
    var sv=document.createElement('div'); sv.className='rps-saveov'; sv.id='rpsSave'; sv.setAttribute('aria-hidden','true');
    sv.innerHTML=
      '<div class="rps-card" role="dialog" aria-label="Save template as">'+
        '<div class="rps-card-head"><div class="rps-card-title" id="rpsSaveTitle">Save template as</div><button class="rps-x" id="rpsSaveX" type="button" aria-label="Close">'+ICON_X+'</button></div>'+
        '<div id="rpsSaveBody"></div>'+
      '</div>';
    document.body.appendChild(sv);
    var cx=document.createElement('div'); cx.className='rps-ctx'; cx.id='rpsCtx'; document.body.appendChild(cx);
    var ci=document.createElement('input'); ci.type='color'; ci.id='rpsNative'; ci.className='rps-native'; ci.tabIndex=-1; ci.setAttribute('aria-hidden','true'); document.body.appendChild(ci);

    var dlg=$('rpsDialog');
    $('rpsNav').addEventListener('click',function(e){ var b=e.target.closest('[data-tab]'); if(b&&S.set){ S.set.tab=b.getAttribute('data-tab'); closePop(); renderSettings(); } });
    $('rpsPane').addEventListener('click',onPaneClick);
    $('rpsPane').addEventListener('change',function(e){
      var c=e.target.closest('[data-chk]'); if(!c||!S.set) return;
      setPath(S.style,c.getAttribute('data-chk'),!!c.checked); closePop(); applyStyle(); refreshPane();
    });
    $('rpsOk').addEventListener('click',function(){ closeSettings(true); });
    $('rpsCancel').addEventListener('click',function(){ closeSettings(false); });
    $('rpsClose').addEventListener('click',function(){ closeSettings(false); });
    $('rpsTpl').addEventListener('click',function(){ if(S.set&&S.set.pop&&S.set.pop.kind==='tpl') closePop(); else openTplMenu(); });
    $('rpsPop').addEventListener('click',onPopClick);
    $('rpsPop').addEventListener('input',onPopInput);
    $('rpsSaveX').addEventListener('click',closeSave);
    $('rpsSave').addEventListener('pointerdown',function(e){ if(e.target===this) closeSave(); });
    ci.addEventListener('input',function(){
      var p=S.set&&S.set.pop; if(!p||p.kind!=='color') return;
      var cur=parseColor(getPath(S.style,p.key))||{ a:1 }, n=parseColor(ci.value); if(!n) return;
      n.a=cur.a; setColorValue(p.key,n);
    });
    /* drag the dialog by its header */
    $('rpsHead').addEventListener('pointerdown',function(e){
      if(e.button!==0||e.target.closest('button')) return;
      var r=dlg.getBoundingClientRect(), dx=e.clientX-r.left, dy=e.clientY-r.top; e.preventDefault();
      try { $('rpsHead').setPointerCapture(e.pointerId); } catch(_){}
      var mv=function(ev){
        var x=Math.min(Math.max(ev.clientX-dx,-r.width+80),window.innerWidth-80), y=Math.min(Math.max(ev.clientY-dy,0),window.innerHeight-48);
        dlg.style.left=Math.round(x)+'px'; dlg.style.top=Math.round(y)+'px'; closePop();
      };
      var up=function(){ $('rpsHead').removeEventListener('pointermove',mv); $('rpsHead').removeEventListener('pointerup',up); $('rpsHead').removeEventListener('pointercancel',up); };
      $('rpsHead').addEventListener('pointermove',mv); $('rpsHead').addEventListener('pointerup',up); $('rpsHead').addEventListener('pointercancel',up);
    });
    document.addEventListener('pointerdown',function(e){
      if(S.set&&S.set.pop&&!e.target.closest('#rpsPop,[data-color],[data-size],[data-ch],[data-tm],#rpsTpl,#rpsNative')) closePop();
      var cx2=$('rpsCtx'); if(cx2&&cx2.classList.contains('is-open')&&!e.target.closest('#rpsCtx')) closeCtx();
    },true);
    document.addEventListener('keydown',function(e){
      if(e.key!=='Escape') return;
      if(S.save){ e.preventDefault(); e.stopPropagation(); closeSave(); }
      else if(S.set&&S.set.pop){ e.preventDefault(); e.stopPropagation(); closePop(); }
      else if(S.set){ e.preventDefault(); e.stopPropagation(); closeSettings(false); }
      else if(S.ctxOpen){ e.preventDefault(); e.stopPropagation(); closeCtx(); }
    },true);
    window.addEventListener('resize',function(){ closePop(); closeCtx(); });
  }

  /* ---- settings window ---- */
  function swatchHtml(key,o){
    o=o||{}; var c=getPath(S.style,key);
    return '<button type="button" class="rps-sw'+(o.line?' is-line':'')+'" data-color="'+key+'"'+(o.line?' data-line="'+o.line+'"':'')+(o.width?' data-width="'+o.width+'"':'')+(o.noAlpha?' data-noalpha="1"':'')+' title="Color"><i class="rps-ck"><b style="background:'+esc(c)+'"></b></i>'+(o.line?lineSvg(c,o.line,o.width):'')+'</button>';
  }
  function lineSvg(color,styleKey,widthKey){
    var st=getPath(S.style,styleKey), w=widthKey?getPath(S.style,widthKey):1, da=st==='dashed'?'6 4':st==='dotted'?'1.5 3':'';
    return '<svg class="rps-ln" width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="1" y1="6" x2="33" y2="6" stroke="'+esc(color)+'" stroke-width="'+w+'"'+(da?' stroke-dasharray="'+da+'"':'')+(st==='dotted'?' stroke-linecap="round"':'')+'/></svg>';
  }
  function chkRow(key,label,sw){
    return '<div class="rps-row"><label class="rps-lab"><input type="checkbox" class="rps-cb" data-chk="'+key+'"'+(getPath(S.style,key)?' checked':'')+'><span class="rps-box"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.6 3.6"/></svg></span><span>'+label+'</span></label><div class="rps-ctl">'+sw+'</div></div>';
  }
  function plainRow(label,sw){ return '<div class="rps-row"><div class="rps-lab rps-lab-plain"><span>'+label+'</span></div><div class="rps-ctl">'+sw+'</div></div>'; }
  function sessRow(label,ctl){ return '<div class="rps-row rps-srow"><div class="rps-lab rps-lab-plain"><span>'+label+'</span></div><div class="rps-ctl is-wide">'+ctl+'</div></div>'; }
  function sessOpts(key){ var k=key.split('.').pop(); return k==='tz'?SESS_TZ:k==='style'?SESS_STYLES:SESS_LINES; }
  function optLabel(key){ var v=getPath(S.style,key), o=sessOpts(key); for(var i=0;i<o.length;i++) if(o[i].id===v) return o[i].name; return ''; }
  function choiceBtn(key){ return '<button type="button" class="rps-dd rps-ch" data-ch="'+key+'"><span>'+esc(optLabel(key))+'</span>'+ICON_CHEV+'</button>'; }
  function timeBtn(key){ return '<button type="button" class="rps-dd rps-tm" data-tm="'+key+'"><span>'+sessHm(sessShown(getPath(S.style,key)))+'</span>'+ICON_CLOCK+'</button>'; }
  function renderSettings(keepScroll){
    if(!S.set) return; var tab=S.set.tab, html='';
    document.querySelectorAll('#rpsNav .rps-tab').forEach(function(b){ b.classList.toggle('is-on',b.getAttribute('data-tab')===tab); });
    var navOn=document.querySelector('#rpsNav .rps-tab.is-on'), nav=$('rpsNav'); if(navOn&&nav&&nav.scrollWidth>nav.clientWidth) nav.scrollLeft=Math.max(0,navOn.offsetLeft-(nav.clientWidth-navOn.offsetWidth)/2);
    if(tab==='tool'){
      html='<div class="rps-sec">Candlesticks</div>'+
        chkRow('body.on','Body',swatchHtml('body.up')+swatchHtml('body.down'))+
        chkRow('border.on','Borders',swatchHtml('border.up')+swatchHtml('border.down'))+
        chkRow('wick.on','Wick',swatchHtml('wick.up')+swatchHtml('wick.down'));
    } else if(tab==='fvg'){
      html='<div class="rps-sec">Fair Value Gaps (FVG)</div>'+chkRow('fvg.on','Show imbalances','')+
        plainRow('Bullish imbalance',swatchHtml('fvg.up'))+plainRow('Bearish imbalance',swatchHtml('fvg.down'))+
        chkRow('fvg.mid.on','Midline',swatchHtml('fvg.mid.color',{ line:'fvg.mid.style', width:'fvg.mid.width' }))+
        '<div class="rps-sec">Three closed candles · current timeframe</div>';
    } else if(tab==='sess'){
      var sc=sessCfg();
      html='<div class="rps-sec">History</div>'+chkRow('sess.on','Sessions','')+
        '<div class="rps-sec">Sessions timezone</div>'+sessRow('Timezone',choiceBtn('sess.tz'))+
        sc.list.map(function(x,i){
          var p='sess.list.'+i+'.';
          return '<div class="rps-sec">'+esc(x.name)+'</div>'+chkRow(p+'show','Show','')+
            sessRow('Style',choiceBtn(p+'style'))+
            sessRow('Time',timeBtn(p+'from')+'<span class="rps-dash">–</span>'+timeBtn(p+'to'))+
            sessRow('Label',swatchHtml(p+'label'))+
            sessRow('Background',swatchHtml(p+'fill'))+
            sessRow('Border',swatchHtml(p+'border')+choiceBtn(p+'bstyle'))+
            (x.style==='solid'?'':sessRow('High & Low',swatchHtml(p+'hl')+choiceBtn(p+'hlstyle')));
        }).join('');
    } else if(tab==='pos'){
      var pd=S.set.posDir==='short'?'short':'long', pk='pos.'+pd+'.';
      html='<div class="rps-segd" role="tablist">'+['long','short'].map(function(k){ return '<button type="button" data-pdir="'+k+'" class="'+(k===pd?'is-on':'')+'">'+(k==='long'?'Long':'Short')+'</button>'; }).join('')+'</div>'+
        plainRow('Lines',swatchHtml(pk+'line.color',{ line:pk+'line.style', width:pk+'line.width' }))+
        plainRow('Stop level color',swatchHtml(pk+'stop'))+
        plainRow('Target color',swatchHtml(pk+'target'))+
        plainRow('Text',swatchHtml(pk+'text.color',{ noAlpha:true })+'<button type="button" class="rps-dd" data-size="'+pk+'text.size"><span>'+getPath(S.style,pk+'text.size')+'</span>'+ICON_CHEV+'</button>');
    } else {
      html='<div class="rps-sec">Main chart style</div>'+
        plainRow('Background',swatchHtml('bg',{ noAlpha:true }))+
        chkRow('gridV.on','Vertical grid lines',swatchHtml('gridV.color',{ line:'gridV.style' }))+
        chkRow('gridH.on','Horizontal grid lines',swatchHtml('gridH.color',{ line:'gridH.style' }))+
        plainRow('Crosshair',swatchHtml('cross.color',{ line:'cross.style', width:'cross.width' }))+
        '<div class="rps-sec">Scales</div>'+
        plainRow('Text',swatchHtml('scale.text')+'<button type="button" class="rps-dd" data-size="scale.size"><span>'+S.style.scale.size+'</span>'+ICON_CHEV+'</button>')+
        plainRow('Lines',swatchHtml('scale.line'))+
        '<div class="rps-sec">Current price</div>'+
        chkRow('currentPrice.line.on','Price line',swatchHtml('currentPrice.line.color',{ line:'currentPrice.line.style', width:'currentPrice.line.width' }))+
        chkRow('currentPrice.label.on','Price label on scale',swatchHtml('currentPrice.label.color'))+
        plainRow('Label text',swatchHtml('currentPrice.label.text',{ noAlpha:true }));
    }
    var pane=$('rpsPane'), keepTop=pane.scrollTop; pane.innerHTML=html; pane.classList.toggle('rps-no-scrollbar',tab==='sess'||tab==='look'); pane.scrollTop=keepScroll?keepTop:0;
    var tp=$('rpsTpl'); if(tp) tp.style.display=(tab==='pos'||tab==='sess'||tab==='fvg')?'none':'';
  }
  /* repaint swatches / checkboxes after a value change without rebuilding the pane (keeps open popups alive) */
  function refreshPane(){
    document.querySelectorAll('#rpsPane [data-color]').forEach(function(b){
      var k=b.getAttribute('data-color'), c=getPath(S.style,k), i=b.querySelector('b'); if(i) i.style.background=c;
      var ls=b.getAttribute('data-line'); if(ls){ var old=b.querySelector('.rps-ln'); if(old) old.outerHTML=lineSvg(c,ls,b.getAttribute('data-width')); }
    });
    document.querySelectorAll('#rpsPane [data-chk]').forEach(function(c){ c.checked=!!getPath(S.style,c.getAttribute('data-chk')); });
    document.querySelectorAll('#rpsPane [data-size]').forEach(function(b){ var sp=b.querySelector('span'); if(sp) sp.textContent=getPath(S.style,b.getAttribute('data-size')); });
    document.querySelectorAll('#rpsPane [data-ch]').forEach(function(b){ var sp=b.querySelector('span'); if(sp) sp.textContent=optLabel(b.getAttribute('data-ch')); });
    document.querySelectorAll('#rpsPane [data-tm]').forEach(function(b){ var sp=b.querySelector('span'); if(sp) sp.textContent=sessHm(sessShown(getPath(S.style,b.getAttribute('data-tm')))); });
  }
  function openSettings(tab,posDir){
    if(S.set||!S.sess) return;
    buildSettingsDom(); sessCfg(); closeCtx(); stopPlay(); closeMenu(); if(S.rewind) setRewind(false); drCancel(); drClosePop();
    S.set={ tab:tab||'tool', posDir:posDir||'long', snap:cloneStyle(S.style), pop:null };
    var ov=$('rpSet'), dlg=$('rpsDialog'); ov.setAttribute('aria-hidden','false'); ov.classList.add('is-open');
    dlg.style.left='0px'; dlg.style.top='0px'; renderSettings();
    var w=dlg.offsetWidth, h=dlg.offsetHeight;
    dlg.style.left=Math.round(Math.max(8,(window.innerWidth-w)/2))+'px'; dlg.style.top=Math.round(Math.max(8,(window.innerHeight-h)/2.4))+'px';
    loadProfiles();
  }
  function closeSettings(keep){
    if(!S.set) return;
    closePop(); closeSave();
    if(keep){ saveStyle(); if(JSON.stringify(S.style.pos)!==JSON.stringify(S.set.snap.pos)) savePosStyle(); if(JSON.stringify(S.style.sess)!==JSON.stringify(S.set.snap.sess)) setPref({ ind:S.style.sess }); if(JSON.stringify(S.style.fvg)!==JSON.stringify(S.set.snap.fvg)) setPref({ fvg:cloneStyle(S.style.fvg) }); }
    else { S.style=S.set.snap; applyStyle(); }
    S.set=null; var ov=$('rpSet'); ov.classList.remove('is-open'); ov.setAttribute('aria-hidden','true');
  }

  /* ---- popups: colour picker, size list, template menu (one at a time) ---- */
  function closePop(){
    if(!S.set||!S.set.pop) return; var p=$('rpsPop'); p.classList.remove('is-open'); p.innerHTML=''; S.set.pop=null;
  }
  function placePop(anchor,prefer){
    var p=$('rpsPop'), r=anchor.getBoundingClientRect(), pw=p.offsetWidth, ph=p.offsetHeight, vw=window.innerWidth, vh=window.innerHeight;
    var left=Math.min(Math.max(8,r.left),vw-pw-8), top=prefer==='up'?r.top-ph-6:r.bottom+6;
    if(prefer==='up'&&top<8) top=Math.min(r.bottom+6,vh-ph-8);
    if(prefer!=='up'&&top+ph>vh-8) top=Math.max(8,r.top-ph-6);
    p.style.left=Math.round(left)+'px'; p.style.top=Math.round(top)+'px';
  }
  function openColor(btn){
    var key=btn.getAttribute('data-color'), line=btn.getAttribute('data-line'), width=btn.getAttribute('data-width'), noAlpha=!!btn.getAttribute('data-noalpha');
    if(S.set.pop&&S.set.pop.kind==='color'&&S.set.pop.key===key){ closePop(); return; }
    closePop();
    var cur=parseColor(getPath(S.style,key))||{ r:255, g:255, b:255, a:1 };
    var cells=PALETTE.map(function(row,ri){
      return '<div class="rps-prow'+(ri===2?' is-gap':'')+'">'+row.map(function(h){ return '<button type="button" class="rps-cell" data-hex="'+h+'" style="background:'+h+'" aria-label="'+h+'"></button>'; }).join('')+'</div>';
    }).join('');
    var html='<div class="rps-pal">'+cells+'</div><div class="rps-psep"></div><button type="button" class="rps-plus" data-plus="1" title="Custom color"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M7 2v10M2 7h10"/></svg></button>';
    if(!noAlpha) html+='<div class="rps-lbl">Opacity</div><div class="rps-alpha"><input type="range" class="rps-range" min="0" max="100" step="1" data-alpha="1"><span class="rps-pct" data-pct="1"></span></div>';
    if(width) html+='<div class="rps-lbl">Width</div><div class="rps-seg4">'+[1,2,3,4].map(function(n){ return '<button type="button" data-w="'+n+'" title="'+n+' px"><i style="height:'+n+'px"></i></button>'; }).join('')+'</div>';
    if(line) html+='<div class="rps-lbl">Line style</div><div class="rps-seg3">'+['solid','dashed','dotted'].map(function(s){ return '<button type="button" data-ls="'+s+'" title="'+({solid:'Solid',dashed:'Dashed',dotted:'Dotted'}[s])+'"><i class="ls-'+s+'"></i></button>'; }).join('')+'</div>';
    var pop=$('rpsPop'); pop.className='rps-pop rps-pop-color'; pop.innerHTML=html; pop.classList.add('is-open');
    S.set.pop={ kind:'color', key:key, line:line, width:width, btn:btn }; placePop(btn,'down'); syncColorPop();
  }
  function syncColorPop(){
    var p=S.set&&S.set.pop; if(!p||p.kind!=='color') return;
    var c=parseColor(getPath(S.style,p.key))||{ r:255, g:255, b:255, a:1 }, hex='#'+hex2(c.r)+hex2(c.g)+hex2(c.b), pop=$('rpsPop');
    pop.querySelectorAll('.rps-cell').forEach(function(b){ b.classList.toggle('is-sel',b.getAttribute('data-hex')===hex); });
    var rg=pop.querySelector('[data-alpha]'); if(rg){ var v=Math.round(c.a*100); if(+rg.value!==v) rg.value=v; rg.style.setProperty('--rgb',Math.round(c.r)+','+Math.round(c.g)+','+Math.round(c.b)); pop.querySelector('[data-pct]').textContent=v+'%'; }
    if(p.width){ var w=getPath(S.style,p.width); pop.querySelectorAll('[data-w]').forEach(function(b){ b.classList.toggle('is-on',+b.getAttribute('data-w')===w); }); }
    if(p.line){ var s=getPath(S.style,p.line); pop.querySelectorAll('[data-ls]').forEach(function(b){ b.classList.toggle('is-on',b.getAttribute('data-ls')===s); }); }
  }
  function setColorValue(key,col){
    setPath(S.style,key,colorCss(col)); applyStyle(); refreshPane(); syncColorPop();
  }
  function openChoice(btn,isTime){
    var key=btn.getAttribute(isTime?'data-tm':'data-ch');
    if(S.set.pop&&S.set.pop.kind==='choice'&&S.set.pop.key===key){ closePop(); return; }
    closePop();
    var items=[], cur;
    if(isTime){ for(var m=0;m<1440;m+=15) items.push({ id:m, name:sessHm(m) }); cur=sessShown(getPath(S.style,key)); }
    else { items=sessOpts(key); cur=getPath(S.style,key); }
    var pop=$('rpsPop'); pop.className='rps-pop rps-pop-list'; pop.style.minWidth=Math.round(btn.getBoundingClientRect().width)+'px';
    pop.innerHTML=items.map(function(it){ return '<button type="button" class="rps-li'+(it.id===cur?' is-sel':'')+'" data-cv="'+it.id+'">'+esc(it.name)+'</button>'; }).join('');
    pop.classList.add('is-open'); S.set.pop={ kind:'choice', btn:btn, key:key, time:!!isTime }; placePop(btn,'down');
    var sel=pop.querySelector('.is-sel'); if(sel) pop.scrollTop=Math.max(0,sel.offsetTop-pop.clientHeight/2+sel.offsetHeight/2);
  }
  var POS_SIZES=[9,10,11,12,13,14,16,18,20];
  function openSizeList(btn){
    var key=btn.getAttribute('data-size')||'scale.size';
    if(S.set.pop&&S.set.pop.kind==='size'){ var same=S.set.pop.key===key; closePop(); if(same) return; }
    closePop();
    var cur=getPath(S.style,key), list=key==='scale.size'?SIZES:POS_SIZES;
    var pop=$('rpsPop'); pop.className='rps-pop rps-pop-list'; pop.style.minWidth=Math.round(btn.getBoundingClientRect().width)+'px';
    pop.innerHTML=list.map(function(n){ return '<button type="button" class="rps-li'+(n===cur?' is-sel':'')+'" data-sz="'+n+'">'+n+'</button>'; }).join('');
    pop.classList.add('is-open'); S.set.pop={ kind:'size', btn:btn, key:key }; placePop(btn,'down');
    var sel=pop.querySelector('.is-sel'); if(sel&&sel.scrollIntoView){ try { sel.scrollIntoView({ block:'nearest' }); } catch(_){} }
  }
  function onPaneClick(e){
    if(!S.set) return;
    var c=e.target.closest('[data-color]'); if(c){ openColor(c); return; }
    var z=e.target.closest('[data-size]'); if(z){ openSizeList(z); return; }
    var ch=e.target.closest('[data-ch]'); if(ch){ openChoice(ch,false); return; }
    var tm=e.target.closest('[data-tm]'); if(tm){ openChoice(tm,true); return; }
    var pdb=e.target.closest('[data-pdir]'); if(pdb){ S.set.posDir=pdb.getAttribute('data-pdir'); closePop(); renderSettings(); return; }
  }
  function onPopClick(e){
    var p=S.set&&S.set.pop; if(!p) return;
    if(p.kind==='color'){
      var cell=e.target.closest('[data-hex]');
      if(cell){ var cur=parseColor(getPath(S.style,p.key))||{ a:1 }, n=parseColor(cell.getAttribute('data-hex')); n.a=cur.a; setColorValue(p.key,n); return; }
      if(e.target.closest('[data-plus]')){
        var cc=parseColor(getPath(S.style,p.key)), ni=$('rpsNative'); ni.value='#'+hex2(cc?cc.r:255)+hex2(cc?cc.g:255)+hex2(cc?cc.b:255);
        var r=p.btn.getBoundingClientRect(); ni.style.left=Math.round(r.left)+'px'; ni.style.top=Math.round(r.bottom)+'px';
        try { ni.click(); } catch(_){}
        return;
      }
      var w=e.target.closest('[data-w]'); if(w){ setPath(S.style,p.width,+w.getAttribute('data-w')); applyStyle(); refreshPane(); syncColorPop(); return; }
      var ls=e.target.closest('[data-ls]'); if(ls){ setPath(S.style,p.line,ls.getAttribute('data-ls')); applyStyle(); refreshPane(); syncColorPop(); return; }
    } else if(p.kind==='choice'){
      var cv=e.target.closest('[data-cv]'); if(!cv) return; var val=cv.getAttribute('data-cv');
      if(p.time) sessStore(p.key,+val); else setPath(S.style,p.key,val);
      closePop(); renderSettings(true); applyStyle();
    } else if(p.kind==='size'){
      var li=e.target.closest('[data-sz]'); if(li){ setPath(S.style,p.key||'scale.size',+li.getAttribute('data-sz')); applyStyle(); refreshPane(); closePop(); }
    } else if(p.kind==='tpl'){
      var del=e.target.closest('[data-del]'); if(del){ p.confirm=del.getAttribute('data-del'); renderTplMenu(); return; }
      var no=e.target.closest('[data-delno]'); if(no){ p.confirm=null; renderTplMenu(); return; }
      var yes=e.target.closest('[data-delyes]'); if(yes){ deleteProfile(yes.getAttribute('data-delyes')); return; }
      var it=e.target.closest('[data-tpl]'); if(!it) return; var v=it.getAttribute('data-tpl');
      if(v==='default'){ setChartStyle(STYLE_DEFAULT); applyStyle(); closePop(); renderSettings(); }
      else if(v==='save'){ closePop(); openSave(); }
      else { var pr=profileById(v); if(pr){ setChartStyle(pr.style); applyStyle(); closePop(); renderSettings(); } }
    }
  }
  function onPopInput(e){
    var p=S.set&&S.set.pop; if(!p||p.kind!=='color') return;
    var a=e.target.closest('[data-alpha]'); if(!a) return;
    var cur=parseColor(getPath(S.style,p.key))||{ r:255, g:255, b:255, a:1 }; cur.a=(+a.value)/100; setColorValue(p.key,cur);
  }

  /* ---- templates (profiles) ---- */
  function profCacheKey(){ var u=uid(); return PROF_KEY+(u?'_'+u:''); }
  function readProfCache(){ try { var l=JSON.parse(localStorage.getItem(profCacheKey())||'[]'); return Array.isArray(l)?l.filter(function(x){ return x&&x.id&&x.name&&x.style; }):[]; } catch(_){ return []; } }
  function writeProfCache(){ try { localStorage.setItem(profCacheKey(),JSON.stringify(S.profiles||[])); } catch(_){} }
  function sortProfiles(l){ return l.slice().sort(function(a,b){ return String(a.name).toLowerCase()<String(b.name).toLowerCase()?-1:1; }); }
  function profileById(id){ var l=S.profiles||[]; for(var i=0;i<l.length;i++) if(l[i].id===id) return l[i]; return null; }
  function loadProfiles(){
    var b=bridge();
    if(!(b&&b.profilesLoad&&b.ready())){ S.profiles=readProfCache(); S.profState='ok'; refreshTplMenu(); return Promise.resolve(); }
    S.profState='loading'; refreshTplMenu();
    return b.profilesLoad().then(function(list){
      var remote=list.filter(function(x){ return x&&x.id&&x.name&&x.style&&!x.kind; }), ids={}; remote.forEach(function(x){ ids[x.id]=1; });
      var localOnly=readProfCache().filter(function(x){ return x.local&&!ids[x.id]; });
      S.profiles=sortProfiles(remote.concat(localOnly)); S.profState='ok'; writeProfCache();
      localOnly.forEach(function(x){ b.profileSave({ id:x.id, name:x.name, style:x.style }).then(function(){ x.local=false; writeProfCache(); }).catch(function(){}); });
    }).catch(function(err){
      console.error('replay profiles load failed:',err); S.profiles=readProfCache(); S.profState='cache';
    }).then(refreshTplMenu);
  }
  function openTplMenu(){
    if(!S.set) return; closePop();
    var pop=$('rpsPop'); pop.className='rps-pop rps-pop-list rps-pop-tpl'; pop.style.minWidth='';
    pop.classList.add('is-open'); S.set.pop={ kind:'tpl', btn:$('rpsTpl'), confirm:null }; renderTplMenu();
  }
  function refreshTplMenu(){ if(S.set&&S.set.pop&&S.set.pop.kind==='tpl') renderTplMenu(); }
  function renderTplMenu(){
    var p=S.set&&S.set.pop; if(!p||p.kind!=='tpl') return;
    var html='<button type="button" class="rps-li" data-tpl="default">Apply default</button><button type="button" class="rps-li" data-tpl="save">Save as…</button>';
    var list=S.profiles||[];
    if(S.profState==='loading'&&!list.length) html+='<div class="rps-lsep"></div><div class="rps-note">Loading…</div>';
    else if(list.length||S.profState==='cache') html+='<div class="rps-lsep"></div>';
    list.forEach(function(x){
      if(p.confirm===x.id){ html+='<div class="rps-li rps-conf"><span>Delete “'+esc(x.name)+'”?</span><button type="button" class="rps-mb" data-delyes="'+esc(x.id)+'">Yes</button><button type="button" class="rps-mb" data-delno="1">No</button></div>'; return; }
      var on=sameStyle(x.style,S.style);
      html+='<div class="rps-it"><button type="button" class="rps-li'+(on?' is-sel':'')+'" data-tpl="'+esc(x.id)+'" title="'+esc(x.name)+'"><span class="rps-nm">'+esc(x.name)+'</span>'+(x.local?'<small>on this device</small>':'')+'</button><button type="button" class="rps-del" data-del="'+esc(x.id)+'" title="Delete template" aria-label="Delete template">'+ICON_X+'</button></div>';
    });
    if(S.profState==='cache') html+='<div class="rps-note">No database connection — showing this device’s templates</div>';
    $('rpsPop').innerHTML=html; placePop(p.btn,'up');
  }
  function deleteProfile(id){
    var b=bridge(), x=profileById(id); if(!x) return;
    S.profiles=(S.profiles||[]).filter(function(y){ return y.id!==id; }); writeProfCache();
    if(S.set&&S.set.pop) S.set.pop.confirm=null; renderTplMenu();
    if(b&&b.profileDelete&&!x.local) b.profileDelete(id).catch(function(err){ console.error('replay profile delete failed:',err); toast('Could not delete the template in the database','warn'); });
    toast('Template “'+x.name+'” deleted');
  }
  function openSave(){
    var sv=$('rpsSave'); S.save={ confirm:null }; sv.classList.add('is-open'); sv.setAttribute('aria-hidden','false'); renderSave();
    var inp=$('rpsName'); if(inp) setTimeout(function(){ try { inp.focus(); } catch(_){} },30);
  }
  function closeSave(){ if(!S.save) return; S.save=null; var sv=$('rpsSave'); sv.classList.remove('is-open'); sv.setAttribute('aria-hidden','true'); }
  function renderSave(){
    var body=$('rpsSaveBody'), sv=S.save; if(!sv) return;
    if(sv.confirm){
      $('rpsSaveTitle').textContent='Replace template?';
      body.innerHTML='<div class="rps-msg">Template “'+esc(sv.confirm.name)+'” already exists. Replace it with the current settings?</div><div class="rps-card-foot"><button type="button" class="rps-b" id="rpsSvNo">Cancel</button><button type="button" class="rps-b rps-ok" id="rpsSvYes">Replace</button></div>';
      $('rpsSvNo').addEventListener('click',function(){ sv.confirm=null; renderSave(); });
      $('rpsSvYes').addEventListener('click',function(){ doSave(sv.confirm.name,sv.confirm.id); });
      return;
    }
    $('rpsSaveTitle').textContent='Save template as';
    body.innerHTML='<label class="rps-flab" for="rpsName">Template name:</label><div class="rps-fin"><input id="rpsName" type="text" maxlength="40" autocomplete="off" spellcheck="false"><button type="button" class="rps-fchev" id="rpsNameChev" tabindex="-1" aria-label="Template list">'+ICON_CHEV+'</button><div class="rps-flist" id="rpsNameList"></div></div>'+
      '<div class="rps-card-foot"><button type="button" class="rps-b" id="rpsSvCancel">Cancel</button><button type="button" class="rps-b rps-ok" id="rpsSvOk" disabled>Save</button></div>';
    var inp=$('rpsName'), ok=$('rpsSvOk'), list=$('rpsNameList');
    var upd=function(){ ok.disabled=!inp.value.trim(); };
    inp.addEventListener('input',upd);
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); if(!ok.disabled) ok.click(); } });
    $('rpsNameChev').addEventListener('click',function(){
      if(list.classList.contains('is-open')){ list.classList.remove('is-open'); return; }
      var pl=S.profiles||[]; list.innerHTML=pl.length?pl.map(function(x){ return '<button type="button" data-n="'+esc(x.name)+'">'+esc(x.name)+'</button>'; }).join(''):'<div class="rps-note">No saved templates</div>';
      list.classList.add('is-open');
    });
    list.addEventListener('click',function(e){ var b=e.target.closest('[data-n]'); if(b){ inp.value=b.getAttribute('data-n'); list.classList.remove('is-open'); upd(); inp.focus(); } });
    $('rpsSvCancel').addEventListener('click',closeSave);
    ok.addEventListener('click',function(){
      var name=inp.value.trim().slice(0,40); if(!name) return;
      var ex=(S.profiles||[]).filter(function(x){ return String(x.name).toLowerCase()===name.toLowerCase(); })[0];
      if(ex){ sv.confirm={ id:ex.id, name:ex.name }; renderSave(); } else doSave(name,null);
    });
  }
  function doSave(name,id){
    var b=bridge(), style=chartOnly(S.style), rec={ id:id||('rp'+Date.now().toString(36)+newId()), name:name, style:style };
    var finish=function(local){
      rec.local=!!local; var l=(S.profiles||[]).filter(function(x){ return x.id!==rec.id; }); l.push(rec); S.profiles=sortProfiles(l); writeProfCache();
      closeSave(); toast(local?'Template “'+name+'” saved on this device only — no database connection':'Template “'+name+'” saved',local?'warn':'ok');
    };
    if(!(b&&b.profileSave&&b.ready())){ finish(true); return; }
    var ok=$('rpsSvYes')||$('rpsSvOk'); if(ok) ok.disabled=true;
    b.profileSave({ id:rec.id, name:name, style:style }).then(function(){ finish(false); }).catch(function(err){ console.error('replay profile save failed:',err); finish(true); });
  }

  /* ---- right-click menu: empty chart area → «Settings…», price scale → «More settings…» ---- */
  function candleAt(x,y){
    var s=S.sess; if(!s||!S.chart||!S.series) return false;
    var ts=S.chart.timeScale(), lg=ts.coordinateToLogical(x); if(lg==null) return false;
    var bk=buckets(s.d,S.tf), cb=bk.b2[s.cur], b=S.dispFrom+Math.round(lg); if(b<S.dispFrom||b>cb) return false;
    var bar=barAt(s.d,bk,b,s.cur), cx=ts.timeToCoordinate(bk.Tm[b]); if(cx==null) return false;
    var bs=ts.options().barSpacing||6; if(Math.abs(x-cx)>Math.max(3,bs*0.42)) return false;
    var yh=S.series.priceToCoordinate(bar.high), yl=S.series.priceToCoordinate(bar.low); if(yh==null||yl==null) return false;
    return y>=Math.min(yh,yl)-3&&y<=Math.max(yh,yl)+3;
  }
  function ctxKind(e){
    var s=S.sess; if(!s||!S.chart||!S.series||S.rewind||S.drag) return null;
    var r=$('rpChart').getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, pw=0, th=0;
    try { pw=S.chart.priceScale('right').width(); th=S.chart.timeScale().height(); } catch(_){}
    if(y>r.height-th) return null;
    if(pw&&x>=r.width-pw) return 'scale';
    if(S.drawHit&&S.drawHit(e)) return null;
    var bh=S.boxHits||[]; for(var i=bh.length-1;i>=0;i--){ var q=bh[i]; if(x>=q.x0&&x<=q.x1&&y>=q.y0-2&&y<=q.y1+2) return q.dir>0?'pos-long':'pos-short'; }
    if(hitTest(e)||hitClosed(e)||candleAt(x,y)) return null;
    return 'pane';
  }
  function openCtx(x,y,kind){
    buildSettingsDom(); var m=$('rpsCtx');
    m.innerHTML='<button type="button" class="rps-ci" data-open="1">'+(kind==='scale'?'More settings…':'Settings…')+'</button>';
    m.style.left='0px'; m.style.top='0px'; m.classList.add('is-open'); S.ctxOpen=true;
    var w=m.offsetWidth, h=m.offsetHeight;
    m.style.left=Math.round(Math.min(x,window.innerWidth-w-8))+'px'; m.style.top=Math.round(Math.min(y,window.innerHeight-h-8))+'px';
    m.onclick=function(e){ if(e.target.closest('[data-open]')){ closeCtx(); if(kind==='pos-long'||kind==='pos-short') openSettings('pos',kind==='pos-short'?'short':'long'); else openSettings('tool'); } };
  }
  function closeCtx(){ var m=$('rpsCtx'); if(m) m.classList.remove('is-open'); S.ctxOpen=false; }
  function bindContextMenu(){
    var el=$('rpChart');
    el.addEventListener('contextmenu',function(e){
      if(S.set||S.save){ e.preventDefault(); return; }
      var k=ctxKind(e); if(!k) return;
      e.preventDefault(); e.stopPropagation(); openCtx(e.clientX,e.clientY,k);
    },true);
    el.addEventListener('wheel',function(){ closeCtx(); },{ capture:true, passive:true });
  }

  /* ================= step 5 · drawing tools (brush, line, rectangle) ================= */
  var DR_KEY='tj_replay_draw_ui';
  var DR_DEF={ ray:{ color:'#2962ff', w:2, style:'solid' }, line:{ color:'#2962ff', w:2, style:'solid' }, rect:{ color:'#2962ff', fill:'rgba(41,98,255,0.2)', w:2, style:'solid' }, brush:{ color:'#2962ff', w:3, style:'solid' } };
  var TFSEC={ '5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1D':86400,'1W':604800,'1M':2592000,'3M':7776000 };
  var DR_TYPES={ line:1, ray:1, rect:1, brush:1 }, DR_STYLES={ solid:1, dashed:1, dotted:1 };
  S.dr={ tool:'cursor', pan:false, lastE:null, crossSet:false, xr:0, sel:[], undo:[], redo:[], place:null, op:null, marq:null, snap:null, hideAll:false, capture:false, lastKey:'', lastAt:0, tm:null, pop:null, listen:false, scrollOff:false,
         ui:{ tools:null, props:null }, def:JSON.parse(JSON.stringify(DR_DEF)) };
  var ICO={
    ray:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6" cy="22" r="2.2"/><path d="M7.6 20.4 24 4"/></svg>',
    grip:'<svg width="10" height="18" viewBox="0 0 10 18" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/><circle cx="2.5" cy="9" r="1.1"/><circle cx="7" cy="9" r="1.1"/><circle cx="2.5" cy="14" r="1.1"/><circle cx="7" cy="14" r="1.1"/></g></svg>',
    cursor:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5v7M14 17.5v7M3.5 14h7M17.5 14h7"/></svg>',
    brush:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22.5c1.4-3.8 3-6 5.6-7.6 1.9-1.2 4.2 0 4.8 2.1.6 2.3-1 4.6-3.7 5.2-2.2.5-4.6.4-6.7.3z"/><path d="M15.5 9.3v1.2a2.2 2.2 0 0 0 3.4 1.6L24 7.3"/></svg>',
    rect:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6.5h8M10 21.5h8M6.5 10v8M21.5 10v8"/><circle class="bgc" cx="6.5" cy="6.5" r="2.2"/><circle class="bgc" cx="21.5" cy="6.5" r="2.2"/><circle class="bgc" cx="6.5" cy="21.5" r="2.2"/><circle class="bgc" cx="21.5" cy="21.5" r="2.2"/></svg>',
    line:'<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.4 18.6 18.6 9.4"/><circle class="bgc" cx="7.8" cy="20.2" r="2.2"/><circle class="bgc" cx="20.2" cy="7.8" r="2.2"/></svg>',
    eye:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>',
    pen:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
    fill:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7 6 2"/><path d="M18.992 12H2.041"/><path d="M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595"/><path d="m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33"/></svg>',
    lock:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    unlock:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
    trash:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    mid:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="1.6"/><path d="M6 12h12" stroke-dasharray="2 3"/></svg>',
    more:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>'
  };

  /* ---- time / price  <->  pixels (drawings live in data space so they follow every timeframe) ---- */
  function bkReal(bk){
    if(!bk.R){ var T=S.sess.d.T; bk.R=new Float64Array(bk.F.length); for(var i=0;i<bk.F.length;i++) bk.R[i]=T[bk.F[i]]; }
    return bk.R;
  }
  function tsToLg(ts){
    var s=S.sess, bk=buckets(s.d,S.tf), R=bkReal(bk), n=R.length; if(!n) return null; var dur=TFSEC[S.tf]||86400;
    var b=lowerBound(R,ts+1,n)-1;
    if(b<0) return (ts-R[0])/dur;
    if(b>=n-1) return (n-1)+(ts-R[n-1])/dur;
    return b+(ts-R[b])/(R[b+1]-R[b]);
  }
  function lgToTs(lg){
    var s=S.sess, bk=buckets(s.d,S.tf), R=bkReal(bk), n=R.length; if(!n) return null; var dur=TFSEC[S.tf]||86400;
    var b=Math.floor(lg);
    if(b<0) return R[0]+lg*dur;
    if(b>=n-1) return R[n-1]+(lg-(n-1))*dur;
    return R[b]+(lg-b)*(R[b+1]-R[b]);
  }
  function px(pt){
    if(!S.chart||!S.series) return null; var lg=tsToLg(pt.t); if(lg==null) return null;
    var x=lgToX(lg-S.dispFrom), y=S.series.priceToCoordinate(pt.p);
    if(x==null||y==null) return null; return { x:x, y:y };
  }
  /* LightweightCharts rounds coordinateToLogical to a whole bar, so refine it to a fractional position */
  function xToLg(x){
    var ts=S.chart.timeScale(), L=ts.coordinateToLogical(x); if(L==null) return null;
    var a=ts.logicalToCoordinate(L), b=ts.logicalToCoordinate(L+1); if(a==null||b==null||b===a) return L;
    return L+(x-a)/(b-a);
  }
  function lgToX(lg){
    var ts=S.chart.timeScale(), L=Math.floor(lg), a=ts.logicalToCoordinate(L), b=ts.logicalToCoordinate(L+1); if(a==null||b==null) return null;
    return a+(lg-L)*(b-a);
  }
  function unpx(x,y){
    if(!S.chart||!S.series) return null;
    var lg=xToLg(x), p=S.series.coordinateToPrice(y); if(lg==null||p==null||!isFinite(p)) return null;
    var t=lgToTs(lg+S.dispFrom); if(t==null) return null;
    return { t:t, p:+(+p).toFixed(S.sess.d.dp+2) };
  }
  function evPos(e){ var r=$('rpChart').getBoundingClientRect(); return { x:e.clientX-r.left, y:e.clientY-r.top, w:r.width, h:r.height }; }
  function drInPlot(p){
    var pw=0, th=0; try { pw=S.chart.priceScale('right').width(); th=S.chart.timeScale().height(); } catch(_){}
    return p.x>=0&&p.y>=0&&p.x<p.w-pw&&p.y<p.h-th;
  }

  /* ---- data ---- */
  function drList(){ var s=S.sess; if(!s) return []; return s.drawings||(s.drawings=[]); }
  function drById(id){ var l=drList(); for(var i=0;i<l.length;i++) if(l[i].id===id) return l[i]; return null; }
  function drSel(){ return S.dr.sel.map(drById).filter(Boolean); }
  function drSnapJson(){ return JSON.stringify(drList()); }
  function drPushUndo(key){
    var D=S.dr, now=Date.now();
    if(key&&D.lastKey===key&&now-D.lastAt<1500){ D.lastAt=now; return; }
    D.undo.push(drSnapJson()); if(D.undo.length>100) D.undo.shift(); D.redo=[]; D.lastKey=key||''; D.lastAt=now;
  }
  function drClean(arr){
    var out=[]; if(!Array.isArray(arr)) return out;
    arr.forEach(function(d){
      if(!d||!DR_TYPES[d.type]||!Array.isArray(d.pts)) return;
      var pts=d.pts.filter(function(q){ return q&&isFinite(q.t)&&isFinite(q.p); }).map(function(q){ return { t:+q.t, p:+q.p }; });
      if(pts.length<2) return; if(d.type!=='brush') pts=pts.slice(0,2); if(pts.length>50000) return;
      var df=DR_DEF[d.type], o={ id:String(d.id||newId()), type:d.type, pts:pts, color:parseColor(d.color)?d.color:df.color, w:Math.min(4,Math.max(1,Math.round(+d.w)||df.w)), style:DR_STYLES[d.style]?d.style:'solid', locked:!!d.locked, hidden:!!d.hidden };
      if(d.type==='rect') o.fill=parseColor(d.fill)?d.fill:df.fill;
      if(d.type==='rect'&&d.mid&&typeof d.mid==='object') o.mid={ on:!!d.mid.on, color:parseColor(d.mid.color)?d.mid.color:o.color, w:Math.min(4,Math.max(1,Math.round(+d.mid.w)||1)), style:DR_STYLES[d.mid.style]?d.mid.style:'dashed' };
      out.push(o);
    });
    return out;
  }
  function drReset(){
    var D=S.dr; D.tool='cursor'; D.sel=[]; D.undo=[]; D.redo=[]; D.place=null; D.op=null; D.marq=null; D.snap=null; D.hideAll=false; D.capture=false; drPan(false); drClosePop(); drRelease();
    var c=$('rpChart'); if(c){ c.classList.remove('is-draw','is-dhover'); }
  }
  function drPersist(){ var s=S.sess; if(!s) return; s.drawAt=Date.now(); saveSession(); drSchedule(); }
  function drSchedule(){ var D=S.dr; clearTimeout(D.tm); D.tm=setTimeout(drFlush,700); }
  function drFlush(){
    var D=S.dr; clearTimeout(D.tm); D.tm=null;
    var s=S.sess, b=bridge(); if(!s||!s.btId||!b||!b.getBacktest(s.btId)||!s.drawAt) return;
    var js=D.op&&D.op.pre?D.op.pre:JSON.stringify(drList());
    if(js.length>900000){ toast('Drawings are too large for the backtest — they stay on this device.','warn'); return; }
    b.updateBacktest(s.btId,{ drawings:js, drawingsAt:s.drawAt });
  }
  /* on resume take the newest copy: device session or the backtest document */
  function drLoad(extra){
    var s=S.sess, br=bridge(), best=null, at=-1;
    if(extra&&Array.isArray(extra.drawings)){ best=extra.drawings; at=+extra.drawAt||0; }
    var bt=(extra&&extra.btId&&br)?br.getBacktest(extra.btId):null;
    if(bt&&bt.drawings&&(+bt.drawingsAt||0)>at){ try { best=JSON.parse(bt.drawings); at=+bt.drawingsAt||0; } catch(_){} }
    s.drawings=drClean(best||[]); s.drawAt=at>0?at:0;
  }
  function drCommit(){ drPersist(); drSync(); requestDraw(); }
  function drRestore(js){
    var s=S.sess; if(!s) return; try { s.drawings=drClean(JSON.parse(js)); } catch(_){ return; }
    S.dr.sel=S.dr.sel.filter(function(id){ return !!drById(id); }); drCommit();
  }
  function drUndo(){ var D=S.dr; if(!D.undo.length) return false; D.redo.push(drSnapJson()); D.lastKey=''; drRestore(D.undo.pop()); return true; }
  function drRedo(){ var D=S.dr; if(!D.redo.length) return false; D.undo.push(drSnapJson()); D.lastKey=''; drRestore(D.redo.pop()); return true; }
  function drDeleteSel(){
    var D=S.dr, ids=D.sel.slice(); if(!ids.length) return false;
    drPushUndo(); S.sess.drawings=drList().filter(function(d){ return ids.indexOf(d.id)<0; }); D.sel=[]; drClosePop(); drCommit(); return true;
  }
  function drDuplicate(){
    var D=S.dr, sel=drSel(); if(!sel.length) return; drPushUndo(); var ids=[];
    sel.forEach(function(d){
      var c=JSON.parse(JSON.stringify(d)); c.id=newId(); c.locked=false;
      c.pts=c.pts.map(function(q){ var a=px(q), n=a?unpx(a.x+22,a.y+22):null; return n||q; });
      drList().push(c); ids.push(c.id);
    });
    D.sel=ids; drCommit();
  }
  function drOrder(front){
    var D=S.dr, sel=drSel(); if(!sel.length) return; drPushUndo(); var ids=D.sel.slice(), l=drList();
    var a=l.filter(function(d){ return ids.indexOf(d.id)<0; }), b=l.filter(function(d){ return ids.indexOf(d.id)>=0; });
    S.sess.drawings=front?a.concat(b):b.concat(a); drCommit();
  }
  function drHideSel(){
    var D=S.dr, sel=drSel(); if(!sel.length) return; drPushUndo(); sel.forEach(function(d){ d.hidden=true; }); D.sel=[]; drClosePop(); drCommit();
    toast('Drawing hidden — the “eye” button on the toolbar brings hidden ones back.');
  }
  function drToggleEye(){
    var D=S.dr, l=drList(), anyHid=l.some(function(d){ return d.hidden; });
    if(D.hideAll){ D.hideAll=false; }
    else if(anyHid){ drPushUndo(); l.forEach(function(d){ d.hidden=false; }); drPersist(); }
    else { D.hideAll=true; D.sel=[]; }
    drSync(); requestDraw();
  }

  /* ---- geometry ---- */
  function drPxs(d){ var g=[]; for(var i=0;i<d.pts.length;i++){ var q=px(d.pts[i]); if(!q) return null; g.push(q); } return g; }
  function drRay(g){
    var dx=g[1].x-g[0].x,dy=g[1].y-g[0].y,len=Math.hypot(dx,dy); if(len<.001) return g;
    var el=$('rpChart'), reach=(el?el.clientWidth+el.clientHeight:4000)+Math.abs(g[0].x)+Math.abs(g[0].y);
    return [g[0],{x:g[0].x+dx/len*reach,y:g[0].y+dy/len*reach}];
  }
  function distSeg(p,a,b){
    var dx=b.x-a.x, dy=b.y-a.y, l2=dx*dx+dy*dy, t=l2?((p.x-a.x)*dx+(p.y-a.y)*dy)/l2:0; t=Math.max(0,Math.min(1,t));
    return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
  }
  function rectBox(g){ return { x0:Math.min(g[0].x,g[1].x), x1:Math.max(g[0].x,g[1].x), y0:Math.min(g[0].y,g[1].y), y1:Math.max(g[0].y,g[1].y) }; }
  function drBBox(d,g){
    if(d.type==='rect') return rectBox(g);
    var x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; g.forEach(function(q){ x0=Math.min(x0,q.x); x1=Math.max(x1,q.x); y0=Math.min(y0,q.y); y1=Math.max(y1,q.y); });
    return { x0:x0, x1:x1, y0:y0, y1:y1 };
  }
  function drHitOne(d,p){
    var g=drPxs(d); if(!g) return false; if(d.type==='ray') g=drRay(g); var tol=Math.max(6,d.w/2+4), i;
    if((d.type==='line'||d.type==='ray')) return distSeg(p,g[0],g[1])<=tol;
    if(d.type==='rect'){
      var b=rectBox(g), fa=(parseColor(d.fill)||{ a:0 }).a;
      if(fa>0.01&&p.x>=b.x0&&p.x<=b.x1&&p.y>=b.y0&&p.y<=b.y1) return true;
      var c=[{x:b.x0,y:b.y0},{x:b.x1,y:b.y0},{x:b.x1,y:b.y1},{x:b.x0,y:b.y1}];
      for(i=0;i<4;i++) if(distSeg(p,c[i],c[(i+1)%4])<=tol) return true; return false;
    }
    if(d.type==='brush'&&g.length>2){
      var flat=[g[0]], prev=g[0];
      for(var k=1;k<g.length-1;k++){
        var end={x:(g[k].x+g[k+1].x)/2,y:(g[k].y+g[k+1].y)/2};
        for(var j=1;j<=12;j++){ var t=j/12,u=1-t; flat.push({x:u*u*prev.x+2*u*t*g[k].x+t*t*end.x,y:u*u*prev.y+2*u*t*g[k].y+t*t*end.y}); } prev=end;
      } flat.push(g[g.length-1]); g=flat;
    }
    for(i=0;i<g.length-1;i++) if(distSeg(p,g[i],g[i+1])<=tol) return true;
    return g.length===1&&Math.hypot(p.x-g[0].x,p.y-g[0].y)<=tol;
  }
  function drHitAt(p){
    var D=S.dr; if(D.hideAll) return null; var l=drList();
    for(var i=l.length-1;i>=0;i--){ var d=l[i]; if(d.hidden) continue; if(drHitOne(d,p)) return d; }
    return null;
  }
  function drHandles(d){
    var g=drPxs(d); if(!g) return [];
    if((d.type==='line'||d.type==='ray')) return [{ id:0, x:g[0].x, y:g[0].y },{ id:1, x:g[1].x, y:g[1].y }];
    if(d.type==='rect'){
      var b=rectBox(g), mx=(b.x0+b.x1)/2, my=(b.y0+b.y1)/2;
      return [{id:'nw',x:b.x0,y:b.y0},{id:'n',x:mx,y:b.y0},{id:'ne',x:b.x1,y:b.y0},{id:'e',x:b.x1,y:my},{id:'se',x:b.x1,y:b.y1},{id:'s',x:mx,y:b.y1},{id:'sw',x:b.x0,y:b.y1},{id:'w',x:b.x0,y:my}];
    }
    return [{ id:'b0', x:g[0].x, y:g[0].y },{ id:'b1', x:g[g.length-1].x, y:g[g.length-1].y }];
  }
  function drHandleAt(d,p){
    var h=drHandles(d), best=null, bd=9;
    h.forEach(function(q){ var dd=Math.hypot(q.x-p.x,q.y-p.y); if(dd<=bd){ bd=dd; best=q.id; } });
    return best;
  }
  S.drawHit=function(e){
    var D=S.dr; if(!S.sess||!S.chart) return false; var p=evPos(e); if(!drInPlot(p)) return false;
    if(drHitAt(p)) return true;
    var one=D.sel.length===1?drById(D.sel[0]):null; return !!(one&&!one.locked&&!one.hidden&&drHandleAt(one,p)!=null);
  };
  /* Strong Ctrl magnet: nearest revealed candle, with a small stability margin */
  function drMagnet(p,exclude){
    var sess=S.sess,bk=buckets(sess.d,S.tf),lg=xToLg(p.x); if(lg==null) return null;
    var barIndex=Math.max(S.dispFrom,Math.min(bk.b2[sess.cur],Math.round(lg+S.dispFrom)));
    var previous=S.dr.magnet;
    if(previous){var oldIndex=Math.round(tsToLg(previous.t)),oldX=lgToX(oldIndex-S.dispFrom),spacing=Math.abs(lgToX(oldIndex-S.dispFrom+1)-oldX);
      if(oldIndex>=S.dispFrom&&oldIndex<=bk.b2[sess.cur]&&Math.abs(p.x-oldX)<=spacing/2+Math.min(2,spacing*.2))barIndex=oldIndex;
    }
    var bar=barAt(sess.d,bk,barIndex,sess.cur),x=lgToX(barIndex-S.dispFrom),best=null,dist=Infinity;
    [bar.open,bar.high,bar.low,bar.close].forEach(function(v){
      var y=S.series.priceToCoordinate(v); if(y==null) return; var dd=Math.abs(y-p.y);
      if(dd<dist){dist=dd;best={x:x,y:y,t:bkReal(bk)[barIndex],p:v};}
    });
    var old=S.dr.magnet;
    if(old&&best&&old.t===best.t&&[bar.open,bar.high,bar.low,bar.close].indexOf(old.p)>=0){
      var oy=S.series.priceToCoordinate(old.p);
      if(Math.abs(oy-p.y)<=dist+3) best={x:x,y:oy,t:old.t,p:old.p};
    }
    S.dr.magnet=best; return best;
  }
  /* a point under the cursor with Ctrl (magnet) / Shift (angle or square) applied */
  function drPoint(e,p,anchor,type,exclude){
    var D=S.dr; D.snap=null; var x=p.x, y=p.y;
    if(e.ctrlKey||e.metaKey){ var m=drMagnet(p,exclude); if(m){ D.snap={ x:m.x, y:m.y, t:m.t, p:m.p }; return { t:m.t, p:m.p }; } }
    if(e.shiftKey&&anchor){
      var dx=x-anchor.x, dy=y-anchor.y;
      if(type==='rect'){ var mm=Math.max(Math.abs(dx),Math.abs(dy)); x=anchor.x+(dx<0?-mm:mm); y=anchor.y+(dy<0?-mm:mm); }
      else { var len=Math.hypot(dx,dy), ang=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4); x=anchor.x+Math.cos(ang)*len; y=anchor.y+Math.sin(ang)*len; }
    }
    return unpx(x,y);
  }

  /* ---- painting ---- */
  function drDash(d,hr){ var w=d.w; if(d.type==='brush'||d.style==='solid') return []; return d.style==='dashed'?[(4+w)*hr,(3+w)*hr]:[w*hr,(2+w)*hr]; }
  function drPaint(ctx,hr,vr,d,g){
    if(d.type==='ray') g=drRay(g);
    ctx.save(); ctx.lineWidth=d.w*hr; ctx.strokeStyle=d.color; ctx.lineJoin='round'; ctx.lineCap=(d.type==='brush'||d.style==='dotted')?'round':'butt'; ctx.setLineDash(drDash(d,hr));
    if(d.type==='rect'){
      var b=rectBox(g); if((parseColor(d.fill)||{ a:0 }).a>0){ ctx.fillStyle=d.fill; ctx.fillRect(b.x0*hr,b.y0*vr,(b.x1-b.x0)*hr,(b.y1-b.y0)*vr); }
      ctx.strokeRect(b.x0*hr,b.y0*vr,(b.x1-b.x0)*hr,(b.y1-b.y0)*vr);
      if(d.mid&&d.mid.on){
        var mw=d.mid.w, my=(b.y0+b.y1)/2*vr;
        ctx.lineWidth=mw*hr; ctx.strokeStyle=d.mid.color; ctx.lineCap=d.mid.style==='dotted'?'round':'butt';
        ctx.setLineDash(d.mid.style==='solid'?[]:d.mid.style==='dashed'?[(4+mw)*hr,(3+mw)*hr]:[mw*hr,(2+mw)*hr]);
        ctx.beginPath(); ctx.moveTo(b.x0*hr,my); ctx.lineTo(b.x1*hr,my); ctx.stroke();
      }
    } else {
      ctx.beginPath(); ctx.moveTo(g[0].x*hr,g[0].y*vr);
      if(d.type==='brush'&&g.length>2){
        for(var i=1;i<g.length-1;i++) ctx.quadraticCurveTo(g[i].x*hr,g[i].y*vr,(g[i].x+g[i+1].x)/2*hr,(g[i].y+g[i+1].y)/2*vr);
        ctx.lineTo(g[g.length-1].x*hr,g[g.length-1].y*vr);
      } else for(var j=1;j<g.length;j++) ctx.lineTo(g[j].x*hr,g[j].y*vr);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawDrawings(ctx,hr,vr){
    var D=S.dr; if(D.hideAll||!S.sess) return;
    drList().forEach(function(d){ if(d.hidden) return; var g=drPxs(d); if(g) drPaint(ctx,hr,vr,d,g); });
  }
  function drawDrOverlay(ctx,hr,vr){
    var D=S.dr, s=S.sess; if(!s) return;
    if(D.place){
      var pl=D.place, df=D.def[pl.type], tmp={ type:pl.type, pts:[pl.pts[0],pl.cur], color:df.color, fill:df.fill, w:df.w, style:df.style, mid:pl.type==='rect'?df.mid:undefined }, g=drPxs(tmp); if(g) drPaint(ctx,hr,vr,tmp,g);
    }
    if(D.op&&D.op.kind==='brush'&&D.op.pts.length>1){
      var bf=D.def.brush, bt={ type:'brush', pts:D.op.pts, color:bf.color, w:bf.w, style:'solid' }, bg=drPxs(bt); if(bg) drPaint(ctx,hr,vr,bt,bg);
    }
    var sel=D.hideAll?[]:drSel().filter(function(d){ return !d.hidden; });
    if(sel.length>1){
      ctx.save(); ctx.strokeStyle='#2962ff'; ctx.lineWidth=1*hr; ctx.setLineDash([4*hr,3*hr]);
      sel.forEach(function(d){ var g=drPxs(d); if(!g) return; var b=drBBox(d,g); ctx.strokeRect((b.x0-4)*hr,(b.y0-4)*vr,(b.x1-b.x0+8)*hr,(b.y1-b.y0+8)*vr); });
      ctx.restore();
    } else if(sel.length===1&&!sel[0].locked&&!(D.op&&D.op.kind==='move'&&D.op.changed)){
      drHandles(sel[0]).forEach(function(h){
        ctx.beginPath(); ctx.arc(h.x*hr,h.y*vr,4.6*hr,0,Math.PI*2); ctx.fillStyle='#2962ff'; ctx.fill(); ctx.lineWidth=1.6*hr; ctx.strokeStyle='#ffffff'; ctx.stroke();
      });
    }
    if(D.marq){
      var m=D.marq, x=Math.min(m.x0,m.x1), y=Math.min(m.y0,m.y1), w=Math.abs(m.x1-m.x0), h=Math.abs(m.y1-m.y0);
      ctx.fillStyle='rgba(41,98,255,.14)'; ctx.fillRect(x*hr,y*vr,w*hr,h*vr); ctx.strokeStyle='#2962ff'; ctx.lineWidth=1*hr; ctx.setLineDash([]); ctx.strokeRect(x*hr,y*vr,w*hr,h*vr);
    }
    if(D.snap){
      var el=$('rpChart'),w=el.clientWidth-S.chart.priceScale('right').width(),h=el.clientHeight-S.chart.timeScale().height(),m=D.snap;
      ctx.save(); ctx.strokeStyle=S.style.cross.color; ctx.lineWidth=S.style.cross.width*hr; ctx.setLineDash(S.style.cross.style==='solid'?[]:S.style.cross.style==='dotted'?[hr,3*hr]:[4*hr,4*hr]);
      ctx.beginPath();ctx.moveTo(m.x*hr,0);ctx.lineTo(m.x*hr,h*vr);ctx.moveTo(0,m.y*vr);ctx.lineTo(w*hr,m.y*vr);ctx.stroke();ctx.setLineDash([]);
      ctx.restore();
    }
    if(D.op&&D.op.kind==='measure') drPaintMeasure(ctx,hr,vr,D.op);
    if(D.snap){ ctx.beginPath(); ctx.arc(D.snap.x*hr,D.snap.y*vr,6.5*hr,0,Math.PI*2); ctx.strokeStyle='#2962ff'; ctx.lineWidth=1.6*hr; ctx.stroke(); }
  }

  function drMeasurePoint(p){var q=unpx(p.x,p.y);if(q)q.t=lgToTs(Math.round(tsToLg(q.t)));return q;}
  function drMeasure(o){
    var seconds=Math.round(Math.abs(o.b.t-o.a.t)), days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);
    var delta=o.b.p-o.a.p,percent=o.a.p?delta/o.a.p*100:0;
    return {bars:Math.abs(Math.round(tsToLg(o.b.t))-Math.round(tsToLg(o.a.t))),seconds:seconds,delta:delta,percent:percent,
      text:(delta>=0?'+':'')+delta.toFixed(S.sess.d.dp)+' ('+(percent>=0?'+':'')+percent.toFixed(2)+'%)',
      time:(days?days+'d ': '')+(hours?hours+'h ':'')+minutes+'m'};
  }
  function drPaintMeasure(ctx,hr,vr,o){
    var a=px(o.a),b=px(o.b);if(!a||!b)return;var m=drMeasure(o),up=m.delta>=0,color=up?'#2962ff':'#ef5350';
    ctx.save();ctx.scale(hr,vr);ctx.fillStyle=up?'rgba(41,98,255,.15)':'rgba(239,83,80,.15)';ctx.strokeStyle=color;ctx.lineWidth=1;
    ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    ctx.font='12px sans-serif';var lines=[m.text,m.bars+' bars · '+m.time],width=Math.max(ctx.measureText(lines[0]).width,ctx.measureText(lines[1]).width)+20;
    var el=$('rpChart'),x=Math.max(4,Math.min((a.x+b.x-width)/2,el.clientWidth-S.chart.priceScale('right').width()-width-4)),y=Math.max(4,Math.min(Math.min(a.y,b.y)-52,el.clientHeight-70));
    ctx.fillStyle=color;ctx.fillRect(x,y,width,46);ctx.fillStyle='#fff';ctx.fillText(lines[0],x+10,y+18);ctx.fillText(lines[1],x+10,y+36);ctx.restore();
  }
  /* ---- mouse ---- */
  function drStop(e){ e.stopPropagation(); S.dr.capture=true; }
  function drBegin(){
    var D=S.dr; drCrossSoon(); if(!D.listen){ D.listen=true; window.addEventListener('pointermove',drMove,true); window.addEventListener('pointerup',drUp,true); window.addEventListener('pointercancel',drUp,true); }
    if(!D.scrollOff&&S.chart){ D.scrollOff=true; S.chart.applyOptions({ handleScroll:false, handleScale:false }); }
  }
  function drRelease(){
    var D=S.dr; if(D.listen&&!D.place&&!D.op){ D.listen=false; window.removeEventListener('pointermove',drMove,true); window.removeEventListener('pointerup',drUp,true); window.removeEventListener('pointercancel',drUp,true); }
    if(D.scrollOff&&!D.op&&!(D.place&&D.place.pressing)){ D.scrollOff=false; if(S.chart) S.chart.applyOptions({ handleScroll:true, handleScale:true }); }
  }
  function drSetTool(t){
    var D=S.dr; if(t!=='cursor'&&S.rewind) setRewind(false);
    drCancel(); D.place=null; D.op=null; D.marq=null; D.snap=null; D.tool=t; if(t!=='cursor') D.sel=[];
    if(t==='cursor') drPan(false);
    drClosePop(); drRelease(); var c=$('rpChart'); if(c){ c.classList.toggle('is-draw',t!=='cursor'); c.classList.remove('is-dhover'); }
    drSync(); requestDraw();
  }
  function drCancel(){ var D=S.dr; if(D.op&&D.op.pre&&S.sess) S.sess.drawings=JSON.parse(D.op.pre); D.place=null; D.op=null; D.marq=null; D.snap=null; D.capture=false; drRelease(); drCross(); requestDraw(); }
  /* Esc: cancel what is in progress, then deselect, then leave the tool; true when it consumed the key */
  function drEsc(){
    var D=S.dr; if(!S.sess) return false;
    if(D.pop){ drClosePop(); return true; }
    if(D.place||D.op){ drCancel(); return true; }
    if(D.tool!=='cursor'){ drSetTool('cursor'); return true; }
    if(D.sel.length){ D.sel=[]; drSync(); requestDraw(); return true; }
    return false;
  }
  function drDown(e){
    var s=S.sess, D=S.dr; if(!s||!S.chart||e.button!==0||S.rewind||S.drag||S.set||S.save||D.op||D.pan) return;
    var p=evPos(e); if(!drInPlot(p)) return;
    drClosePop(); var tool=D.tool, q;
    if(D.place){ drStop(e); drPlaceFinish(e,p); return; }
    if(tool==='cursor'&&e.shiftKey){
      q=drMeasurePoint(p); if(!q) return; drStop(e); D.snap=null; D.op={kind:'measure',a:q,b:q}; drBegin(); requestDraw(); return;
    }
    if(tool==='brush'){
      q=unpx(p.x,p.y); if(!q) return; drStop(e); if(D.sel.length){ D.sel=[]; drSync(); } D.op={ kind:'brush', pts:[q], last:{ x:p.x, y:p.y } }; drBegin(); return;
    }
    if(tool==='ray'){
      q=drPoint(e,p,null,tool); if(!q) return;
      var start=px(q); if(!start) return;
      var end=unpx(start.x+100,start.y); if(!end) return;
      end.p=q.p; // Preserve an exactly horizontal ray, including an OHLC-snapped start.
      var df=D.def.ray, ray={id:newId(),type:'ray',pts:[q,end],color:df.color,w:df.w,style:df.style,locked:false,hidden:false};
      drStop(e); drPushUndo(); drList().push(ray); D.sel=[ray.id]; drCommit();
      drSetTool('cursor'); D.capture=true; return;
    }
    if(tool==='line'||tool==='rect'){
      drStop(e); q=drPoint(e,p,null,tool); if(!q) return; if(D.sel.length){ D.sel=[]; drSync(); }
      D.place={ type:tool, pts:[q], cur:q, down:{ x:p.x, y:p.y }, anchor:px(q)||{ x:p.x, y:p.y }, pressing:true, moved:false }; drBegin(); requestDraw(); return;
    }
    var one=D.sel.length===1?drById(D.sel[0]):null;
    if(one&&!one.locked&&!one.hidden){
      var h=drHandleAt(one,p);
      if(h!=null){ drStop(e); if(h==='b0'||h==='b1') startMove(p); else D.op={ kind:'handle', id:one.id, h:h, pre:drSnapJson(), orig:drPxs(one), start:p, offset:(function(){var hh=drHandles(one).filter(function(v){return v.id===h;})[0];return {x:hh.x-p.x,y:hh.y-p.y};})(), changed:false }; drBegin(); return; }
    }
    var hit=drHitAt(p);
    if(hit){
      drStop(e);
      if(e.ctrlKey||e.metaKey||e.shiftKey){ var i=D.sel.indexOf(hit.id); if(i>=0) D.sel.splice(i,1); else D.sel.push(hit.id); drSync(); requestDraw(); return; }
      if(D.sel.indexOf(hit.id)<0){ D.sel=[hit.id]; drSync(); }
      startMove(p); drBegin(); requestDraw(); return;
    }
    if(e.ctrlKey||e.metaKey){ drStop(e); D.op={ kind:'marquee', x0:p.x, y0:p.y }; D.marq={ x0:p.x, y0:p.y, x1:p.x, y1:p.y }; drBegin(); return; }
    if(D.sel.length){ D.sel=[]; drSync(); requestDraw(); }
  }

  /* ---- hover magnet, crosshair sync, pan, middle-click delete ---- */
  function drTrack(e){
    var D=S.dr; if(!S.sess||!S.chart||S.rewind||S.drag) return;
    D.lastE={ clientX:e.clientX, clientY:e.clientY };
    if(D.op||D.place||D.pan){ drCrossSoon(); return; }
    var p=evPos(e), had=!!D.snap; D.snap=null;
    if((e.ctrlKey||e.metaKey)&&D.tool!=='cursor'&&D.tool!=='brush'&&drInPlot(p)){ var m=drMagnet(p); if(m) D.snap={ x:m.x, y:m.y, t:m.t, p:m.p }; }
    if(D.snap||had) requestDraw();
    drCrossSoon();
  }
  function drCrossSoon(){ var D=S.dr; if(D.xr) return; D.xr=requestAnimationFrame(function(){ D.xr=0; drCross(); }); }
  /* keep the chart's crosshair on the magnet point while Ctrl holds it; give it back to the cursor afterwards */
  function drCross(){
    var D=S.dr; if(!S.chart) return;
    var on=!!(D.snap&&S.sess&&!S.rewind&&!S.drag);
    if(on!==D.crossSet){ D.crossSet=on; S.chart.applyOptions({crosshair:{vertLine:{visible:!on&&!S.rewind,labelVisible:!on&&!S.rewind},horzLine:{visible:!on,labelVisible:!on}}}); }
    if(!on) D.magnet=null;
    requestDraw();
  }
  function drMod(e){
    var D=S.dr; if(!S.sess||!D.lastE||!/^(Control|Meta|Shift)$/.test(e.key)) return;
    var fe={ clientX:D.lastE.clientX, clientY:D.lastE.clientY, ctrlKey:e.ctrlKey, metaKey:e.metaKey, shiftKey:e.shiftKey };
    if(D.place||D.op) drMove(fe); else drTrack(fe);
  }
  function drPan(on){
    var D=S.dr; on=!!on; if(D.pan===on) return;
    if(on&&(D.op||(D.place&&D.place.pressing))) return;
    D.pan=on; D.snap=null; var c=$('rpChart'); if(c) c.classList.toggle('is-pan',on); requestDraw();
  }
  function drMiddle(e){
    var D=S.dr; if(!S.sess||!S.chart||D.op||D.place) return false;
    var p=evPos(e); if(!drInPlot(p)) return false; var h=drHitAt(p); if(!h) return false;
    e.preventDefault(); e.stopPropagation();
    if(h.locked) return true;
    drPushUndo(); S.sess.drawings=drList().filter(function(d){ return d.id!==h.id; }); D.sel=D.sel.filter(function(id){ return id!==h.id; });
    drClosePop(); drCommit(); return true;
  }
  function startMove(p){
    var D=S.dr, items=[]; drSel().forEach(function(d){ if(d.locked) return; var g=drPxs(d); if(g) items.push({ id:d.id, orig:g }); });
    if(!items.length){ D.op=null; return; }
    D.op={ kind:'move', start:{ x:p.x, y:p.y }, items:items, pre:drSnapJson(), changed:false };
  }
  function drMove(e){
    var D=S.dr, s=S.sess; if(!s||!S.chart) return; var p=evPos(e), o=D.op;
    D.lastE={ clientX:e.clientX, clientY:e.clientY }; drCrossSoon();
    if(o){
      if(o.kind==='measure'){ var mp=drMeasurePoint(p);if(mp) o.b=mp;
      } else if(o.kind==='brush'){
        if(Math.hypot(p.x-o.last.x,p.y-o.last.y)>=1.5){ var q=unpx(p.x,p.y); if(q){ o.pts.push(q); o.last={ x:p.x, y:p.y }; } }
      } else if(o.kind==='move'){
        var dx=p.x-o.start.x, dy=p.y-o.start.y; if(!o.changed&&Math.hypot(dx,dy)<3) return; o.changed=true;
        o.items.forEach(function(it){ var d=drById(it.id); if(!d) return; var np=it.orig.map(function(a){ return unpx(a.x+dx,a.y+dy); }); if(np.every(Boolean)) d.pts=np; });
      } else if(o.kind==='handle'){
        var d2=drById(o.id), g=o.orig; if(!d2||!g) return;
        if(!o.changed&&Math.hypot(p.x-o.start.x,p.y-o.start.y)<3) return;
        p={x:p.x+o.offset.x,y:p.y+o.offset.y};
        if(d2.type==='line'||d2.type==='ray'){ var pt=drPoint(e,p,g[1-o.h],'line',[d2.id]); if(pt){ d2.pts[o.h]=pt; o.changed=true; } }
        else {
          var b=rectBox(g), id=o.h, corner=id.length===2, anc=corner?{ x:id.indexOf('w')>=0?b.x1:b.x0, y:id.indexOf('n')>=0?b.y1:b.y0 }:null;
          var pt2=drPoint(e,p,anc,'rect',[d2.id]), pp=pt2?px(pt2):null; if(!pp) return;
          if(id.indexOf('w')>=0) b.x0=pp.x; if(id.indexOf('e')>=0) b.x1=pp.x; if(id.indexOf('n')>=0) b.y0=pp.y; if(id.indexOf('s')>=0) b.y1=pp.y;
          var a1=unpx(b.x0,b.y0), a2=unpx(b.x1,b.y1); if(a1&&a2){ d2.pts=[a1,a2]; o.changed=true; }
        }
      } else if(o.kind==='marquee'){ D.marq={ x0:o.x0, y0:o.y0, x1:p.x, y1:p.y }; }
      if(o.kind==='brush'||o.kind==='move'||o.kind==='marquee') D.snap=null;
      requestDraw(); return;
    }
    if(D.place){
      var pl=D.place; if(Math.hypot(p.x-pl.down.x,p.y-pl.down.y)>5) pl.moved=true;
      var c=drPoint(e,p,pl.anchor,pl.type); if(c) pl.cur=c; requestDraw();
    }
  }
  function drUp(e){
    if(e.type==='pointercancel'){ drCancel(); return; }
    var D=S.dr; D.capture=false; if(!S.sess) return; var p=evPos(e), o=D.op;
    if(o&&o.kind!=='brush') drMove(e);
    if(o&&o.kind==='brush'){var end=unpx(p.x,p.y),last=o.pts[o.pts.length-1];if(end&&(end.t!==last.t||end.p!==last.p))o.pts.push(end);}
    if(o){
      D.op=null; D.snap=null;
      if(o.kind==='brush') drBrushFinish(o);
      else if(o.kind==='move'||o.kind==='handle'){ if(o.changed){ D.undo.push(o.pre); if(D.undo.length>100) D.undo.shift(); D.redo=[]; D.lastKey=''; drCommit(); } }
      else if(o.kind==='marquee'){
        var m=D.marq; D.marq=null;
        if(m&&Math.hypot(m.x1-m.x0,m.y1-m.y0)>=3){
          var x0=Math.min(m.x0,m.x1), x1=Math.max(m.x0,m.x1), y0=Math.min(m.y0,m.y1), y1=Math.max(m.y0,m.y1);
          D.sel=drList().filter(function(d){ if(d.hidden||D.hideAll) return false; var g=drPxs(d); if(!g) return false; var b=drBBox(d,g); return b.x0>=x0&&b.x1<=x1&&b.y0>=y0&&b.y1<=y1; }).map(function(d){ return d.id; });
        } else D.sel=[];
        drSync();
      }
      drRelease(); drCross(); requestDraw(); return;
    }
    if(D.place&&D.place.pressing){ D.place.pressing=false; if(D.place.moved) drPlaceFinish(e,p); else drRelease(); }
  }
  function drPlaceFinish(e,p){
    var D=S.dr, pl=D.place; if(!pl) return;
    var pt=drPoint(e,p,pl.anchor,pl.type)||pl.cur; D.place=null; D.snap=null; drRelease();
    var a=px(pl.pts[0]), b=pt?px(pt):null;
    if(!a||!b||Math.hypot(a.x-b.x,a.y-b.y)<3){ requestDraw(); return; }
    var df=D.def[pl.type], d={ id:newId(), type:pl.type, pts:[pl.pts[0],pt], color:df.color, w:df.w, style:df.style, locked:false, hidden:false };
    if(pl.type==='rect'){ d.fill=df.fill; if(df.mid) d.mid=JSON.parse(JSON.stringify(df.mid)); } /* the centre line of the last rectangle you set up carries on to new ones */
    drPushUndo(); drList().push(d); D.sel=[d.id]; drCommit();
    drSetTool('cursor'); /* line and rectangle are one-shot; only the brush stays active */
  }
  function drBrushFinish(o){
    var D=S.dr, raw=o.pts;
    var pxs=raw.map(px); if(pxs.some(function(q){ return !q; })||raw.length<2){ drSync(); requestDraw(); return; }
    var bb=drBBox({ type:'brush' },pxs); if(Math.hypot(bb.x1-bb.x0,bb.y1-bb.y0)<3){ drSync(); requestDraw(); return; }

    var df=D.def.brush, d={ id:newId(), type:'brush', pts:raw.slice(), color:df.color, w:df.w, style:'solid', locked:false, hidden:false };
    drPushUndo(); drList().push(d); D.sel=[d.id]; drCommit();
  }

  /* ---- floating bars + popups ---- */
  /* tool defaults (colour, fill, width, style) are per account and synced through the database; panel positions stay on the device */
  function drUiKey(){ var u=uid(); return u?DR_KEY+'_'+u:''; }
  function drApplyDef(src){
    ['line','ray','rect','brush'].forEach(function(k){ var x=src&&src[k]; if(!x) return; var df=S.dr.def[k]; if(parseColor(x.color)) df.color=x.color; if(k==='rect'&&parseColor(x.fill)) df.fill=x.fill; if(x.w>=1&&x.w<=4) df.w=Math.round(x.w); if(DR_STYLES[x.style]&&k!=='brush') df.style=x.style; if(k==='rect'&&x.mid&&typeof x.mid==='object') df.mid={ on:!!x.mid.on, color:parseColor(x.mid.color)?x.mid.color:'#2962ff', w:Math.min(4,Math.max(1,Math.round(+x.mid.w)||1)), style:DR_STYLES[x.mid.style]?x.mid.style:'dashed' }; });
  }
  function drLoadUi(){
    var D=S.dr; D.def=JSON.parse(JSON.stringify(DR_DEF)); D.ui.tools=null; D.ui.props=null; D.defAt='';
    var key=drUiKey();
    if(key) try {
      var u=JSON.parse(localStorage.getItem(key)||'null');
      if(u){ D.ui.tools=u.tools||null; D.ui.props=u.props||null; drApplyDef(u.def); D.defAt=String(u.at||''); }
    } catch(_){}
    D.defSig=JSON.stringify(D.def);
  }
  function drWriteUi(){ var key=drUiKey(); if(!key) return; try { localStorage.setItem(key,JSON.stringify({ tools:S.dr.ui.tools, props:S.dr.ui.props, def:S.dr.def, at:S.dr.defAt||'' })); } catch(_){} }
  function drSaveUi(){
    var D=S.dr, sig=JSON.stringify(D.def);
    if(sig!==D.defSig){ D.defSig=sig; D.defAt=new Date().toISOString(); clearTimeout(D.uiTm); D.uiTm=setTimeout(drPushUi,1000); }
    drWriteUi();
  }
  function drPushUi(){
    var b=bridge(); clearTimeout(S.dr.uiTm); if(!(b&&b.profileSave&&b.ready()&&b.isOwnAccount())) return;
    b.profileSave({ id:'drawui', kind:'drawUi', name:'drawUi', style:{ def:S.dr.def }, updateOnly:true }).catch(function(err){ console.error('replay tool style save failed:',err); });
  }
  function drSyncUi(rem){
    var D=S.dr;
    if(rem&&rem.style&&rem.style.def&&(!D.defAt||String(rem.updatedAt)>D.defAt)){
      drApplyDef(rem.style.def); D.defAt=String(rem.updatedAt); D.defSig=JSON.stringify(D.def); drWriteUi();
    } else if(D.defAt&&(!rem||D.defAt>String(rem.updatedAt))) drPushUi();
  }
  function buildDrawDom(){
    var card=document.querySelector('#rpSession .rp-chart-card'); if(!card||$('rpdTools')) return;
    var tools=document.createElement('div'); tools.className='rpd-bar'; tools.id='rpdTools';
    tools.innerHTML='<div class="rpd-grip" data-grip="tools" title="Drag">'+ICO.grip+'</div>'+
      '<button type="button" class="rpd-b" data-tool="cursor" title="Cursor (Esc). Measure: Shift + drag">'+ICO.cursor+'</button>'+
      '<button type="button" class="rpd-b" data-tool="brush" title="Brush">'+ICO.brush+'</button>'+
      '<button type="button" class="rpd-b" data-tool="line" title="Line: click — click">'+ICO.line+'</button>'+
      '<button type="button" class="rpd-b" data-tool="ray" title="Ray: one click. Change the direction with the handle">'+ICO.ray+'</button>'+
      '<button type="button" class="rpd-b" data-tool="rect" title="Rectangle: click — click">'+ICO.rect+'</button>'+
      '<i class="rpd-sep"></i><button type="button" class="rpd-b" data-act="eye" title="Hide all drawings">'+ICO.eye+'</button>';
    var props=document.createElement('div'); props.className='rpd-bar rpd-props'; props.id='rpdProps';
    props.innerHTML='<div class="rpd-grip" data-grip="props" title="Drag">'+ICO.grip+'</div>'+
      '<button type="button" class="rpd-b rpd-col" data-p="color" title="Line color">'+ICO.pen+'<i></i></button>'+
      '<button type="button" class="rpd-b rpd-col" data-p="fill" title="Fill color">'+ICO.fill+'<i></i></button>'+
      '<i class="rpd-sep"></i>'+
      '<button type="button" class="rpd-b rpd-wide" data-p="width" title="Line width"><i class="rpd-lw"></i><span></span>'+ICON_CHEV+'</button>'+
      '<button type="button" class="rpd-b rpd-wide" data-p="style" title="Line style"><svg class="rpd-st" width="26" height="12" viewBox="0 0 26 12" aria-hidden="true"><line x1="1" y1="6" x2="25" y2="6" stroke="currentColor" stroke-width="2"/></svg>'+ICON_CHEV+'</button>'+
      '<button type="button" class="rpd-b" data-p="mid" title="Center line">'+ICO.mid+'</button>'+
      '<i class="rpd-sep"></i>'+
      '<button type="button" class="rpd-b" data-p="lock" title="Lock">'+ICO.lock+'</button>'+
      '<button type="button" class="rpd-b" data-p="del" title="Delete (Delete)">'+ICO.trash+'</button>'+
      '<button type="button" class="rpd-b" data-p="more" title="More">'+ICO.more+'</button>';
    card.appendChild(tools); card.appendChild(props);
    var pop=document.createElement('div'); pop.className='rps-pop'; pop.id='rpdPop'; document.body.appendChild(pop);
    var ci=document.createElement('input'); ci.type='color'; ci.id='rpdNative'; ci.className='rps-native'; ci.tabIndex=-1; ci.setAttribute('aria-hidden','true'); document.body.appendChild(ci);
    drLoadUi();
    tools.addEventListener('click',function(e){
      var t=e.target.closest('[data-tool]'); if(t){ var v=t.getAttribute('data-tool'); t.blur(); drSetTool(v); return; }
      var ey=e.target.closest('[data-act="eye"]'); if(ey){ ey.blur(); drToggleEye(); }
    });
    props.addEventListener('click',onDrProp);
    pop.addEventListener('click',onDrPopClick); pop.addEventListener('input',onDrPopInput);
    pop.addEventListener('change',function(e){ var p=S.dr.pop, c=e.target.closest('[data-mon]'); if(p&&p.kind==='mid'&&c) drSetMid({ on:!!c.checked }); });
    ci.addEventListener('input',function(){ var p=S.dr.pop; if(p&&p.kind==='mid'){ var mn=parseColor(ci.value); if(!mn) return; mn.a=(parseColor(drMidOf().color)||{ a:1 }).a; drSetMid({ on:true, color:colorCss(mn) },'mid:color'); return; } if(!p||p.kind!=='color') return; var n=parseColor(ci.value); if(!n) return; var cur=parseColor(drPropValue(p.key))||{ a:1 }; n.a=cur.a; drSetColor(p.key,n); });
    [tools,props].forEach(function(bar){
      bar.addEventListener('pointerdown',function(e){ e.stopPropagation(); },false);
      bar.addEventListener('contextmenu',function(e){ e.preventDefault(); e.stopPropagation(); });
    });
    [['tools',tools],['props',props]].forEach(function(pr){
      var key=pr[0], bar=pr[1], grip=bar.querySelector('.rpd-grip');
      grip.addEventListener('pointerdown',function(e){
        if(e.button!==0) return; e.preventDefault(); drClosePop();
        var cr=card.getBoundingClientRect(), br=bar.getBoundingClientRect(), dx=e.clientX-br.left, dy=e.clientY-br.top;
        try { grip.setPointerCapture(e.pointerId); } catch(_){}
        var mv=function(ev){
          var x=Math.min(Math.max(0,ev.clientX-cr.left-dx),cr.width-bar.offsetWidth), y=Math.min(Math.max(0,ev.clientY-cr.top-dy),cr.height-bar.offsetHeight);
          bar.style.left=Math.round(x)+'px'; bar.style.top=Math.round(y)+'px'; S.dr.ui[key]={ x:Math.round(x), y:Math.round(y) };
        };
        var up=function(){ grip.removeEventListener('pointermove',mv); grip.removeEventListener('pointerup',up); grip.removeEventListener('pointercancel',up); drSaveUi(); };
        grip.addEventListener('pointermove',mv); grip.addEventListener('pointerup',up); grip.addEventListener('pointercancel',up);
      });
    });
    document.addEventListener('pointerdown',function(e){ if(S.dr.pop&&!e.target.closest('#rpdPop,#rpdProps,#rpdNative')) drClosePop(); },true);
    window.addEventListener('resize',function(){ drClosePop(); drPlaceBars(); });
    drSync();
  }
  function drPlaceBars(){
    var card=document.querySelector('#rpSession .rp-chart-card'); if(!card) return; var cw=card.clientWidth, ch=card.clientHeight;
    [['tools',$('rpdTools'),50],['props',$('rpdProps'),98]].forEach(function(r){
      var bar=r[1]; if(!bar||!bar.offsetWidth) return; var pos=S.dr.ui[r[0]], x,y;
      if(pos&&isFinite(pos.x)&&isFinite(pos.y)){ x=pos.x; y=pos.y; } else { x=Math.round((cw-bar.offsetWidth)/2); y=r[2]; }
      x=Math.min(Math.max(0,x),Math.max(0,cw-bar.offsetWidth)); y=Math.min(Math.max(0,y),Math.max(0,ch-bar.offsetHeight));
      bar.style.left=x+'px'; bar.style.top=y+'px';
    });
  }
  function drPropValue(key){ var sel=drSel(), d=sel[0]; if(!d) return null; if(key==='fill') return d.fill; if(key==='color') return d.color; return null; }
  function drSync(){
    var D=S.dr, tb=$('rpdTools'); if(!tb) return;
    tb.querySelectorAll('[data-tool]').forEach(function(b){ b.classList.toggle('is-on',b.getAttribute('data-tool')===D.tool); });
    var anyHid=drList().some(function(d){ return d.hidden; }), eye=tb.querySelector('[data-act="eye"]'), off=D.hideAll||anyHid;
    eye.innerHTML=D.hideAll?ICO.eyeOff:ICO.eye; eye.classList.toggle('is-on',D.hideAll||anyHid);
    eye.title=D.hideAll?'Show all drawings':anyHid?'Show hidden drawings':'Hide all drawings';
    var sel=drSel(), pb=$('rpdProps'), open=sel.length>0&&!!S.sess&&!D.hideAll; pb.classList.toggle('is-open',open);
    if(open){
      var d=sel[0], hasRect=sel.some(function(x){ return x.type==='rect'; }), onlyBrush=sel.every(function(x){ return x.type==='brush'; }), allLocked=sel.every(function(x){ return x.locked; });
      pb.querySelector('[data-p="color"] i').style.background=d.color;
      var fb=pb.querySelector('[data-p="fill"]'); fb.style.display=hasRect?'':'none'; if(hasRect){ var rd=sel.filter(function(x){ return x.type==='rect'; })[0]; fb.querySelector('i').style.background=rd.fill; }
      var wb=pb.querySelector('[data-p="width"]'); wb.querySelector('.rpd-lw').style.height=d.w+'px'; wb.querySelector('span').textContent=d.w+'px';
      var sb=pb.querySelector('[data-p="style"]'); sb.style.display=onlyBrush?'none':''; var ln=sb.querySelector('line'); ln.setAttribute('stroke-dasharray',d.style==='dashed'?'6 4':d.style==='dotted'?'1.5 3.5':''); ln.setAttribute('stroke-linecap',d.style==='dotted'?'round':'butt');
      var mb=pb.querySelector('[data-p="mid"]'); mb.style.display=hasRect?'':'none'; mb.classList.toggle('is-on',sel.some(function(x){ return x.type==='rect'&&x.mid&&x.mid.on; }));
      var lk=pb.querySelector('[data-p="lock"]'); lk.innerHTML=allLocked?ICO.lock:ICO.unlock; lk.classList.toggle('is-on',allLocked); lk.title=allLocked?'Unlock':'Lock';
      drPlaceBars();
    } else drClosePop();
  }
  function drClosePop(){ var D=S.dr, p=$('rpdPop'); D.pop=null; if(p){ p.classList.remove('is-open'); p.innerHTML=''; } }
  function drPlacePop(anchor){
    var p=$('rpdPop'), r=anchor.getBoundingClientRect(), pw=p.offsetWidth, ph=p.offsetHeight, vw=window.innerWidth, vh=window.innerHeight;
    var left=Math.min(Math.max(8,r.left),vw-pw-8), top=r.bottom+6; if(top+ph>vh-8) top=Math.max(8,r.top-ph-6);
    p.style.left=Math.round(left)+'px'; p.style.top=Math.round(top)+'px';
  }
  function onDrProp(e){
    var b=e.target.closest('[data-p]'); if(!b) return; b.blur(); var k=b.getAttribute('data-p'), D=S.dr;
    if(D.pop&&D.pop.kind===k){ drClosePop(); return; }
    drClosePop();
    if(k==='color'||k==='fill'){ openDrColor(b,k); return; }
    if(k==='width'||k==='style'||k==='more'){ openDrList(b,k); return; }
    if(k==='mid'){ openDrMid(b); return; }
    if(k==='lock'){ var sel=drSel(), all=sel.every(function(x){ return x.locked; }); drPushUndo(); sel.forEach(function(x){ x.locked=!all; }); drCommit(); return; }
    if(k==='del') drDeleteSel();
  }
  function openDrColor(btn,key){
    var cur=parseColor(drPropValue(key))||{ r:41, g:98, b:255, a:1 };
    var cells=PALETTE.map(function(row,ri){
      return '<div class="rps-prow'+(ri===2?' is-gap':'')+'">'+row.map(function(h){ return '<button type="button" class="rps-cell" data-hex="'+h+'" style="background:'+h+'" aria-label="'+h+'"></button>'; }).join('')+'</div>';
    }).join('');
    var pop=$('rpdPop'); pop.className='rps-pop rps-pop-color';
    pop.innerHTML='<div class="rps-pal">'+cells+'</div><div class="rps-psep"></div><button type="button" class="rps-plus" data-plus="1" title="Custom color"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M7 2v10M2 7h10"/></svg></button>'+
      '<div class="rps-lbl">Opacity</div><div class="rps-alpha"><input type="range" class="rps-range" min="0" max="100" step="1" data-alpha="1"><span class="rps-pct" data-pct="1"></span></div>';
    pop.classList.add('is-open'); S.dr.pop={ kind:key, key:key, btn:btn }; drPlacePop(btn); drSyncColorPop(cur);
  }
  function drSyncColorPop(c){
    var p=S.dr.pop; if(!p||(p.kind!=='color'&&p.kind!=='fill')) return;
    c=c||parseColor(drPropValue(p.key))||{ r:41, g:98, b:255, a:1 }; var hex='#'+hex2(c.r)+hex2(c.g)+hex2(c.b), pop=$('rpdPop');
    pop.querySelectorAll('.rps-cell').forEach(function(b){ b.classList.toggle('is-sel',b.getAttribute('data-hex')===hex); });
    var rg=pop.querySelector('[data-alpha]'); if(rg){ var v=Math.round(c.a*100); if(+rg.value!==v) rg.value=v; rg.style.setProperty('--rgb',Math.round(c.r)+','+Math.round(c.g)+','+Math.round(c.b)); pop.querySelector('[data-pct]').textContent=v+'%'; }
  }
  function drSetColor(key,col){
    var css=colorCss(col); drPushUndo('c:'+key);
    drSel().forEach(function(d){
      if(key==='fill'){ if(d.type==='rect'){ d.fill=css; S.dr.def.rect.fill=css; } }
      else { d.color=css; S.dr.def[d.type].color=css; }
    });
    drSaveUi(); drCommit(); drSyncColorPop(col);
  }
  /* rectangle centre line: its own floating panel (on / colour / opacity / width / style); every rectangle keeps its own settings */
  function drMidRects(){ return drSel().filter(function(x){ return x.type==='rect'; }); }
  function drMidOf(){ var r=drMidRects()[0]; return (r&&r.mid)||{ on:false, color:r?opaque(r.color):'#2962ff', w:1, style:'dashed' }; }
  function openDrMid(btn){
    if(!drMidRects().length) return;
    var cells=PALETTE.map(function(row,ri){
      return '<div class="rps-prow'+(ri===2?' is-gap':'')+'">'+row.map(function(h){ return '<button type="button" class="rps-cell" data-mhex="'+h+'" style="background:'+h+'" aria-label="'+h+'"></button>'; }).join('')+'</div>';
    }).join('');
    var pop=$('rpdPop'); pop.className='rps-pop rps-pop-color rpd-pop-mid';
    pop.innerHTML='<label class="rpd-midchk"><input type="checkbox" class="rps-cb" data-mon="1"><span class="rps-box"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.6 3.6"/></svg></span><span>Center line</span></label>'+
      '<div class="rpd-midbody"><div class="rps-pal">'+cells+'</div><div class="rps-psep"></div><button type="button" class="rps-plus" data-mplus="1" title="Custom color"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M7 2v10M2 7h10"/></svg></button>'+
      '<div class="rps-lbl">Opacity</div><div class="rps-alpha"><input type="range" class="rps-range" min="0" max="100" step="1" data-malpha="1"><span class="rps-pct" data-mpct="1"></span></div>'+
      '<div class="rps-lbl">Width</div><div class="rps-seg4">'+[1,2,3,4].map(function(n){ return '<button type="button" data-mw="'+n+'" title="'+n+' px"><i style="height:'+n+'px"></i></button>'; }).join('')+'</div>'+
      '<div class="rps-lbl">Line style</div><div class="rps-seg3">'+['solid','dashed','dotted'].map(function(t){ return '<button type="button" data-ms="'+t+'" title="'+({solid:'Solid',dashed:'Dashed',dotted:'Dotted'}[t])+'"><i class="ls-'+t+'"></i></button>'; }).join('')+'</div></div>';
    pop.style.minWidth=''; pop.classList.add('is-open'); S.dr.pop={ kind:'mid', btn:btn }; drPlacePop(btn); drSyncMidPop();
  }
  function drSyncMidPop(){
    var p=S.dr.pop; if(!p||p.kind!=='mid') return; var m=drMidOf(), pop=$('rpdPop'), c=parseColor(m.color)||{ r:41, g:98, b:255, a:1 }, hex='#'+hex2(c.r)+hex2(c.g)+hex2(c.b);
    pop.querySelector('[data-mon]').checked=!!m.on; pop.querySelector('.rpd-midbody').classList.toggle('is-off',!m.on);
    pop.querySelectorAll('[data-mhex]').forEach(function(b){ b.classList.toggle('is-sel',b.getAttribute('data-mhex')===hex); });
    var rg=pop.querySelector('[data-malpha]'), v=Math.round(c.a*100); if(+rg.value!==v) rg.value=v; rg.style.setProperty('--rgb',Math.round(c.r)+','+Math.round(c.g)+','+Math.round(c.b)); pop.querySelector('[data-mpct]').textContent=v+'%';
    pop.querySelectorAll('[data-mw]').forEach(function(b){ b.classList.toggle('is-on',+b.getAttribute('data-mw')===m.w); });
    pop.querySelectorAll('[data-ms]').forEach(function(b){ b.classList.toggle('is-on',b.getAttribute('data-ms')===m.style); });
  }
  function drSetMid(patch,key){
    drPushUndo(key||'mid:'+Object.keys(patch).join());
    drMidRects().forEach(function(d){ var m=d.mid||(d.mid={ on:false, color:opaque(d.color), w:1, style:'dashed' }); for(var k in patch) m[k]=patch[k]; });
    var r0=drMidRects()[0]; if(r0&&r0.mid){ S.dr.def.rect.mid=JSON.parse(JSON.stringify(r0.mid)); drSaveUi(); }
    drCommit(); drSyncMidPop();
  }
  function onDrMidClick(e){
    var h=e.target.closest('[data-mhex]'), w=e.target.closest('[data-mw]'), t=e.target.closest('[data-ms]');
    if(h){ var cur=parseColor(drMidOf().color)||{ a:1 }, n=parseColor(h.getAttribute('data-mhex')); n.a=cur.a; drSetMid({ on:true, color:colorCss(n) }); return; }
    if(w){ drSetMid({ on:true, w:+w.getAttribute('data-mw') }); return; }
    if(t){ drSetMid({ on:true, style:t.getAttribute('data-ms') }); return; }
    if(e.target.closest('[data-mplus]')){
      var m=drMidOf(), cc=parseColor(m.color), ni=$('rpdNative'), btn=S.dr.pop.btn; ni.value='#'+hex2(cc?cc.r:41)+hex2(cc?cc.g:98)+hex2(cc?cc.b:255);
      var r=btn.getBoundingClientRect(); ni.style.left=Math.round(r.left)+'px'; ni.style.top=Math.round(r.bottom)+'px'; try { ni.click(); } catch(_){}
    }
  }
  function openDrList(btn,kind){
    var pop=$('rpdPop'), d=drSel()[0], html='';
    pop.className='rps-pop rps-pop-list';
    if(kind==='width') html=[1,2,3,4].map(function(n){ return '<button type="button" class="rps-li rpd-li'+(d&&d.w===n?' is-sel':'')+'" data-lw="'+n+'"><i class="rpd-lw" style="height:'+n+'px"></i><span>'+n+' px</span></button>'; }).join('');
    else if(kind==='style') html=['solid','dashed','dotted'].map(function(s){ return '<button type="button" class="rps-li rpd-li'+(d&&d.style===s?' is-sel':'')+'" data-ls="'+s+'"><i class="rpd-ls ls-'+s+'"></i><span>'+({solid:'Solid',dashed:'Dashed',dotted:'Dotted'}[s])+'</span></button>'; }).join('');
    else html='<button type="button" class="rps-li" data-more="dup">Duplicate</button><button type="button" class="rps-li" data-more="hide">Hide</button><button type="button" class="rps-li" data-more="front">Bring to front</button><button type="button" class="rps-li" data-more="back">Send to back</button>';
    pop.innerHTML=html; pop.style.minWidth=kind==='more'?'190px':Math.round(btn.getBoundingClientRect().width)+'px'; pop.classList.add('is-open'); S.dr.pop={ kind:kind, btn:btn }; drPlacePop(btn);
  }
  function onDrPopClick(e){
    var p=S.dr.pop; if(!p) return;
    if(p.kind==='mid'){ onDrMidClick(e); return; }
    if(p.kind==='color'||p.kind==='fill'){
      var cell=e.target.closest('[data-hex]');
      if(cell){ var cur=parseColor(drPropValue(p.key))||{ a:1 }, n=parseColor(cell.getAttribute('data-hex')); n.a=cur.a; drSetColor(p.key,n); return; }
      if(e.target.closest('[data-plus]')){
        var cc=parseColor(drPropValue(p.key)), ni=$('rpdNative'); ni.value='#'+hex2(cc?cc.r:41)+hex2(cc?cc.g:98)+hex2(cc?cc.b:255);
        var r=p.btn.getBoundingClientRect(); ni.style.left=Math.round(r.left)+'px'; ni.style.top=Math.round(r.bottom)+'px'; try { ni.click(); } catch(_){}
      }
      return;
    }
    var w=e.target.closest('[data-lw]'), ls=e.target.closest('[data-ls]'), mo=e.target.closest('[data-more]');
    if(w){ var n1=+w.getAttribute('data-lw'); drPushUndo(); drSel().forEach(function(d){ d.w=n1; S.dr.def[d.type].w=n1; }); drSaveUi(); drClosePop(); drCommit(); }
    else if(ls){ var st=ls.getAttribute('data-ls'); drPushUndo(); drSel().forEach(function(d){ if(d.type!=='brush'){ d.style=st; S.dr.def[d.type].style=st; } }); drSaveUi(); drClosePop(); drCommit(); }
    else if(mo){ var a=mo.getAttribute('data-more'); drClosePop(); if(a==='dup') drDuplicate(); else if(a==='hide') drHideSel(); else drOrder(a==='front'); }
  }
  function onDrPopInput(e){
    var p=S.dr.pop;
    if(p&&p.kind==='mid'){ var ma=e.target.closest('[data-malpha]'); if(ma){ var mc=parseColor(drMidOf().color)||{ r:41, g:98, b:255, a:1 }; mc.a=(+ma.value)/100; drSetMid({ on:true, color:colorCss(mc) },'mid:alpha'); } return; }
    if(!p||(p.kind!=='color'&&p.kind!=='fill')) return; var a=e.target.closest('[data-alpha]'); if(!a) return;
    var cur=parseColor(drPropValue(p.key))||{ r:41, g:98, b:255, a:1 }; cur.a=(+a.value)/100; drSetColor(p.key,cur);
  }
  function drHandleCur(h){
    return h==='n'||h==='s'?'ns':h==='e'||h==='w'?'ew':h==='nw'||h==='se'?'nwse':h==='ne'||h==='sw'?'nesw':'grab';
  }
  function bindDrawing(){
    var el=$('rpChart');
    el.addEventListener('pointerdown',drDown,true);
    el.addEventListener('pointermove',function(e){
      drTrack(e);
      var D=S.dr; if(!S.sess||S.rewind||S.drag||D.place||D.pan){ setDrCur(null); return; }
      if(D.op){ setDrCur(D.op.kind==='move'?'grabbing':D.op.kind==='handle'?drHandleCur(D.op.h):null); return; }
      if(D.tool!=='cursor'){ setDrCur(null); return; }
      var p=evPos(e), c=null;
      if(drInPlot(p)){
        var one=D.sel.length===1?drById(D.sel[0]):null;
        if(one&&!one.locked&&!one.hidden){ var hh=drHandleAt(one,p); if(hh!=null) c=drHandleCur(hh); }
        if(!c){ var hit=drHitAt(p); if(hit&&!hit.locked) c='grab'; }
      }
      setDrCur(c);
    },true);
    el.addEventListener('pointerleave',function(){ setDrCur(null); setPosCur(null); var D=S.dr; if(!D.op&&!D.place){ D.lastE=null; if(D.snap){ D.snap=null; drCross(); requestDraw(); } } });
    document.addEventListener('keydown',drMod); document.addEventListener('keyup',function(e){ if(e.code==='Space') drPan(false); else drMod(e); });
    window.addEventListener('blur',function(){ drCancel(); drPan(false); var D=S.dr; if(D.snap){ D.snap=null; requestDraw(); } });
    el.addEventListener('contextmenu',function(e){
      var D=S.dr; if(!S.sess||S.set||S.save) return;
      if(D.tool!=='cursor'||D.place||D.op){ e.preventDefault(); e.stopImmediatePropagation(); if(D.place||D.op) drCancel(); else drSetTool('cursor'); return; }
      var p=evPos(e), h=drInPlot(p)?drHitAt(p):null;
      if(h){ e.preventDefault(); e.stopImmediatePropagation(); if(D.sel.indexOf(h.id)<0){ D.sel=[h.id]; drSync(); requestDraw(); } }
    },true);
    document.addEventListener('pointerup',function(){ S.dr.capture=false; },true);
  }
  /* keyboard: Delete, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z — returns true when handled */
  function drKey(e){
    var D=S.dr; if(!S.sess) return false;
    var mod=(e.ctrlKey||e.metaKey)&&!e.altKey;
    if(mod&&(e.code==='KeyZ'||e.key==='z'||e.key==='Z')){ e.preventDefault(); if(D.op||D.place){drCancel();return true;} if(e.shiftKey) drRedo(); else drUndo(); return true; }
    if(mod&&(e.code==='KeyY'||e.key==='y'||e.key==='Y')){ e.preventDefault(); if(D.op||D.place){drCancel();return true;} drRedo(); return true; }
    if((e.key==='Delete'||e.key==='Backspace')&&D.sel.length){ e.preventDefault(); drCancel(); drDeleteSel(); return true; }
    return false;
  }

  /* ---------- workspace enter / exit ---------- */
  function canUse(){ return !!uid(); }
  function syncMenu(){
    var row=$('openReplayWorkspaceBtn'); if(row) row.style.display=canUse()?'flex':'none';
    if(!canUse()&&S.mode) exitWorkspace(true);
  }
  function enterWorkspace(){
    if(!canUse()) return;
    buildDom(); loadStyle(); drLoadUi(); drPlaceBars(); loadPrefs();
    curtainQuick(function(){
      if(window.TJAccounts&&window.TJAccounts.state&&window.TJAccounts.state.mode) window.TJAccounts.exit();
      if(typeof window.exitNotesWorkspace==='function'&&document.body.classList.contains('notes-workspace-mode')) window.exitNotesWorkspace(true);
      document.body.classList.remove('backtest-workspace-mode','backtest-detail-mode','backtest-input-panel-collapsed');
      var sw=$('settingsWrap'); if(sw) sw.classList.remove('open'); var sb=$('settingsBtn'); if(sb) sb.setAttribute('aria-expanded','false');
      if(typeof window.setSecondaryActions==='function') window.setSecondaryActions(false);
      S.mode=true; document.body.classList.add('replay-workspace-mode'); $('replayWorkspace').setAttribute('aria-hidden','false');
      S.sess=null; showLobbyUI();
      loadMeta().then(function(){
        if(!$('rpStart').value){ $('rpStart').value='2024-01-02'; $('rpEnd').value='2024-06-28'; }
        syncRange();
        renderResume(); syncLobby(); getBin(S.selected,'h1').catch(function(){});
      }).catch(function(){ showError('Could not load quotes. Check your connection and the Replay data source.'); });
    });
  }
  function closeWorkspaceNow(){
    stopPlay(); drCancel(); if(S.sess) saveSession(); drFlush(); stFlush(); closeSettings(false); closeCtx(); S.mode=false; S.sess=null;
    document.body.classList.remove('replay-workspace-mode','replay-fullscreen'); var ws=$('replayWorkspace'); if(ws) ws.setAttribute('aria-hidden','true');
    var ses=$('rpSession'); if(ses){ ses.style.display='none'; ses.setAttribute('aria-hidden','true'); }
  }
  function exitWorkspace(immediate){
    if(immediate) closeWorkspaceNow(); else curtainQuick(closeWorkspaceNow);
  }

  function bind(){
    var open=$('openReplayWorkspaceBtn'); if(open) open.addEventListener('click',function(e){ e.stopPropagation(); enterWorkspace(); });
    if(typeof firebase!=='undefined'&&firebase.auth&&firebase.auth().onAuthStateChanged) firebase.auth().onAuthStateChanged(function(){ syncMenu(); });
    syncMenu();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();

  window.TJReplay={ enter:enterWorkspace, exit:function(){ exitWorkspace(true); }, state:S, drawGeo:function(id){ var d=drById(id); if(!d) return null; var r=$('rpChart').getBoundingClientRect(), off=function(q){ return q?{ x:q.x+r.left, y:q.y+r.top }:null; }; return { pts:(drPxs(d)||[]).map(off), handles:drHandles(d).map(function(h){ return { id:h.id, x:h.x+r.left, y:h.y+r.top }; }) }; } };
})();

