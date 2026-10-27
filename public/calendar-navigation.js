/* Shared day → month → year navigation. Browsing never commits an input value. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.TJCalendarNav=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  var MIN=1000,MAX=9999;
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function key(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
  function allowed(y,m,min,max){
    if(y<MIN||y>MAX)return false;
    var first=key(y,m==null?0:m,1),last=key(y,m==null?11:m,m==null?31:new Date(y,m+1,0).getDate());
    return (!min||last>=min)&&(!max||first<=max);
  }
  function decade(s){return Math.floor(s.year/10)*10;}
  function label(s){return s.level==='years'?decade(s)+' – '+(decade(s)+9):s.level==='months'?String(s.year):MONTHS[s.month]+' '+s.year;}
  function cells(s,min,max){
    var a=[],start=s.level==='years'?decade(s)-1:0;
    for(var i=0;i<12;i++){
      var v=start+i,year=s.level==='years';
      a.push({value:v,label:year?String(v):MONTHS[i],fullLabel:year?String(v):MONTHS[i]+' '+s.year,
        active:year?v===s.year:i===s.month,muted:year&&(i===0||i===11),disabled:year?!allowed(v,null,min,max):!allowed(s.year,i,min,max)});
    }
    return a;
  }
  function canMove(s,dir,min,max){
    if(s.level==='years'){
      var base=decade(s)+dir*10;
      for(var y=base;y<base+10;y++)if(allowed(y,null,min,max))return true;
      return false;
    }
    if(s.level==='months')return allowed(s.year+dir,null,min,max);
    var y=s.year,m=s.month+dir;if(m<0){m=11;y--;}if(m>11){m=0;y++;}
    return allowed(y,m,min,max);
  }
  function clamp(s,min,max){
    if(min&&s.year===+min.slice(0,4))s.month=Math.max(s.month,+min.slice(5,7)-1);
    if(max&&s.year===+max.slice(0,4))s.month=Math.min(s.month,+max.slice(5,7)-1);
    if(s.day!=null){
      s.day=Math.min(s.day,new Date(s.year,s.month+1,0).getDate());
      if(min&&key(s.year,s.month,s.day)<min)s.day=+min.slice(8,10);
      if(max&&key(s.year,s.month,s.day)>max)s.day=+max.slice(8,10);
    }
  }
  function move(s,dir,min,max){
    if(!canMove(s,dir,min,max))return false;
    if(s.level==='years')s.year+=dir*10;
    else if(s.level==='months')s.year+=dir;
    else {s.month+=dir;if(s.month<0){s.month=11;s.year--;}if(s.month>11){s.month=0;s.year++;}}
    clamp(s,min,max);return true;
  }
  function up(s){if(!s.level||s.level==='days')s.level='months';else if(s.level==='months')s.level='years';}
  function pick(s,value,min,max){
    if(!Number.isInteger(value))return false;
    if(s.level==='years'){
      if(!allowed(value,null,min,max))return false;s.year=value;s.level='months';
    }else if(s.level==='months'){
      if(value<0||value>11||!allowed(s.year,value,min,max))return false;s.month=value;s.level='days';
    }else return false;
    clamp(s,min,max);return true;
  }
  function animate(grid){grid.classList.remove('calendar-zoom-enter');void grid.offsetWidth;grid.classList.add('calendar-zoom-enter');}
  function header(s,title,prev,next,min,max){
    title.textContent=label(s);title.disabled=s.level==='years';
    title.setAttribute('aria-label',label(s)+(s.level==='years'?'':s.level==='months'?'. Choose year':'. Choose month'));
    title.title=s.level==='years'?'':s.level==='months'?'Choose year':'Choose month';
    var unit=s.level==='years'?'years':s.level==='months'?'year':'month';
    prev.disabled=!canMove(s,-1,min,max);next.disabled=!canMove(s,1,min,max);
    prev.setAttribute('aria-label','Previous '+unit);next.setAttribute('aria-label','Next '+unit);
  }
  function render(s,grid,min,max,onPick){
    var coarse=s.level==='months'||s.level==='years';grid.classList.toggle('calendar-zoom-grid',coarse);
    if(!coarse)return false;
    grid.innerHTML=cells(s,min,max).map(function(c){return '<button type="button" class="calendar-zoom-cell'+(c.active?' is-active':'')+(c.muted?' is-muted':'')+'" data-calendar-value="'+c.value+'" aria-label="'+c.fullLabel+'" aria-pressed="'+c.active+'"'+(c.disabled?' disabled':'')+'>'+c.label+'</button>';}).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('[data-calendar-value]'),function(b){b.addEventListener('click',function(){if(pick(s,+b.getAttribute('data-calendar-value'),min,max)){onPick();focus(grid);}});});
    return true;
  }
  function focus(grid){var b=grid.querySelector('.is-active:not(:disabled),.datetime-picker-day.is-active:not(:disabled),.ndb-day.selected:not(:disabled)')||grid.querySelector('button:not(:disabled)');if(b)b.focus({preventScroll:true});}
  return {allowed:allowed,label:label,cells:cells,canMove:canMove,move:move,up:up,pick:pick,header:header,render:render,animate:animate,focus:focus};
});
