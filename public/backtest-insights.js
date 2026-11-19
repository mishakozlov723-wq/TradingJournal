/* Closed Replay results: date labels follow the saved chart clock; ordering uses the instant. */
(function () {
  'use strict';
  const names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  function calculate(trades) {
    const closed = trades.filter(t => /^\d{4}-(0[1-9]|1[0-2])-\d\dT/.test(t.closeDT) && Number.isFinite(t.r));
    const order = t => Number(t.closeTs)>0 ? Number(t.closeTs)*1000 : Date.parse(t.closeDT.slice(0,16)+'Z');
    closed.sort((a,b) => order(a)-order(b));
    const totals = new Map(), depths = [0]; let equity=0, peak=0, max=0;
    for (const t of closed) {
      const month=Number(t.closeDT.slice(0,4))*12+Number(t.closeDT.slice(5,7))-1;
      // Replay records R to hundredths. Integer sums also avoid negative zero near a peak.
      const r=Math.round(t.r*100); totals.set(month,(totals.get(month)||0)+r);
      equity+=r; peak=Math.max(peak,equity); const depth=(equity-peak)/100;
      depths.push(depth); max=Math.min(max,depth);
    }
    const months=[]; if(totals.size){const ids=[...totals.keys()].sort((a,b)=>a-b); for(let i=ids[0];i<=ids.at(-1);i++) months.push({label:names[i%12],year:Math.floor(i/12),value:(totals.get(i)||0)/100});}
    return {months,depths,max};
  }
  if(typeof module!=='undefined' && module.exports){ module.exports={calculate}; return; }
  const el=id=>document.getElementById(id), pct=v=>(v>0?'+':v<0?'−':'')+Math.abs(v)+'%';
  const text=(x,y,value,anchor='middle',cls='')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${value}</text>`;
  const line=(x,y,w,zero)=>`<path class="bt-${zero?'zero':'grid'}" d="M${x} ${y}H${w}"/>`;
  let current, monthly=false, result, refresh, observer;
  function plot(host,month){
    if(!result.months.length){host.innerHTML='<p>Close a position in Replay to see its result here.</p>';return;}
    const series=result.months, left=58, width=Math.max(270,host.clientWidth,month?left+series.length*76+12:0), right=width-12;
    let body='';
    if(month){
      const limit=Math.max(.01, ...series.map(m=>Math.abs(m.value))), mid=112, span=78, step=(right-left)/series.length;
      [limit,0,-limit].forEach(v=>{const y=mid-v/limit*span;body+=line(left,y,right,!v)+text(left-8,y+4,pct(v),'end');});
      series.forEach((m,i)=>{const x=left+step*(i+.5),y=mid-m.value/limit*span,w=Math.min(36,step*.5);
        body+=`<rect class="${m.value<0?'bt-negative':''}" x="${x-w/2}" y="${Math.min(mid,y)}" width="${w}" height="${Math.max(1,Math.abs(mid-y))}" rx="2"/>`+text(x,y+(m.value<0?16:-8),pct(m.value),'middle','bt-number')+text(x,229,m.label)+text(x,246,m.year);
      });
    }else{
      const top=22,bottom=144,limit=Math.abs(result.max)||1, arr=result.depths;
      const pts=arr.map((v,i)=>`${(left+i/(arr.length-1)*(right-left)).toFixed(2)} ${(top-v/limit*(bottom-top)).toFixed(2)}`).join(' L');
      body+=line(left,top,right,true)+text(left-8,top+4,'0%','end')+line(left,bottom,right,false)+text(left-8,bottom+4,pct(-limit),'end');
      body+=`<path d="M${left} ${top} L${pts} L${right} ${top} Z" fill="currentColor" opacity=".12"/><path d="M${pts}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    }
    host.innerHTML=`<svg role="img" aria-label="${month?'Monthly closed results: '+series.map(m=>m.label+' '+m.year+' '+pct(m.value)).join(', '):'Drawdown from peak: '+pct(result.max)}" width="${width}" height="${month?258:166}">${body}</svg>`;
  }
  function draw(){if(monthly)plot(el('btMonthlyPlot'),true);if(el('btDrawdown').open)plot(el('btDrawdownPlot'),false);}
  function select(value){monthly=value;el('btEquityPlot').hidden=value;el('btMonthlyPlot').hidden=!value;
    for(const [id,on] of [['btEquityView',!value],['btMonthlyView',value]]){el(id).classList.toggle('is-on',on);el(id).setAttribute('aria-pressed',String(on));}
    draw();if(!value && refresh)refresh();
  }
  window.BacktestInsights={update(bt,trades,onEquity){
    const replay=bt.source==='replay', reset=current!==bt.id;current=bt.id;refresh=onEquity;
    el('btMonthlyView').hidden=!replay;el('btDrawdown').hidden=!replay;
    result=calculate(replay?trades:[]);if(reset){el('btDrawdown').open=false;monthly=false;}
    el('btDrawdownMax').textContent=result.months.length?'Max '+pct(result.max):'—';
    el('btEquityView').onclick=()=>select(false);el('btMonthlyView').onclick=()=>select(true);el('btDrawdown').ontoggle=draw;
    if(!observer && window.ResizeObserver){observer=new ResizeObserver(draw);observer.observe(el('backtestPreviewCard'));}
    if(reset||!replay){const cb=refresh;refresh=null;select(false);refresh=cb;}else draw();
  }};
})();
