'use strict';
(()=>{
  const stage=document.getElementById('stage');let source,union,running=[];
  const painted=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  async function handoff(from,to){
    await painted();
    const fade=stage.animate([{opacity:from},{opacity:to}],{duration:70,easing:'linear',fill:'forwards'});
    running=[fade];
    await Promise.race([fade.finished.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,250))]);
    stage.style.opacity=String(to);fade.cancel();running=[];await painted();return true;
  }
  function place(rect,rounded){
    Object.assign(stage.style,{left:rect.x-union.x+'px',top:rect.y-union.y+'px',
      width:rect.width+'px',height:rect.height+'px',transform:'none',borderRadius:rounded?'8px':'0'});
  }
  async function shot(data,baseHeight,baseWidth=source.rect.width){
    const layer=document.createElement('div');layer.className='shot';
    const top=data.top*baseHeight/data.rect.height,images=[];
    if(data.title&&top){const title=new Image();title.src=data.title;
      title.style.top='0';title.style.height=top+'px';layer.append(title);images.push(title);}
    const body=new Image();body.src=data.body;body.style.top=top+'px';body.style.height=`calc(100% - ${top}px)`;
    layer.append(body);images.push(body);
    // Electron page capture excludes the system caption buttons. Keep their
    // visual counterparts present so they do not blink out during the cover.
    if(top){
      const controls=document.createElement('div');controls.className='caption-controls';
      controls.style.width=138*baseWidth/data.rect.width+'px';controls.style.height=top+'px';
      controls.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 138 36" preserveAspectRatio="none" fill="none" stroke="#cfd6e4" stroke-width="1">'+
        '<path d="M18 18h10"/>'+
        (data.maximized?'<path d="M65 14h9v9M63 16h9v9h-9z"/>':'<path d="M64 14h10v10H64z"/>')+
        '<path d="m110 14 10 10m0-10-10 10"/></svg>';
      layer.append(controls);
    }
    await Promise.all(images.map(im=>im.decode()));return layer;
  }
  window.syterTransition={
    async prepare(data){
      for(const a of running)a.cancel();running=[];source=data.source;union=data.union;stage.replaceChildren();
      place(source.rect,!source.maximized&&!source.fullscreen);stage.style.opacity='0';
      stage.append(await shot(source,source.rect.height));
      await painted();return true;
    },
    reveal(){return handoff(0,1);},
    release(){return handoff(1,0);},
    async play({destination,duration}){
      const old=stage.firstElementChild,a=source.rect,b=destination.rect;
      // Keep the destination bitmap at native CSS dimensions. Transform the
      // layer, not its image layout, so the final text isn't resampled twice.
      const next=await shot(destination,b.height,b.width);
      Object.assign(next.style,{width:b.width+'px',height:b.height+'px',opacity:'0',
        transformOrigin:'top left',transform:`scale(${a.width/b.width}, ${a.height/b.height})`});
      stage.append(next);
      const end=`translate(${b.x-a.x}px, ${b.y-a.y}px) scale(${b.width/a.width}, ${b.height/a.height})`;
      // Zero initial/final velocity: no hard kick at the start of a long move.
      const options={duration,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'};
      running=[stage.animate([{transform:'none'},{transform:end}],options),
        // Keep the old picture opaque behind the crossfade; otherwise both
        // half-transparent pictures briefly darken against a black backing.
        old.animate([{opacity:1},{opacity:1,offset:.85},{opacity:0}],options),
        next.animate([{opacity:0},{opacity:0,offset:.16},{opacity:1,offset:.72},{opacity:1}],options)];
      await Promise.race([Promise.all(running.map(a=>a.finished.catch(()=>{}))),
        new Promise(resolve=>setTimeout(resolve,duration+180))]);
      for(const a of running){try{a.finish();}catch(_){}}
      // Scaling a screenshot up and then down leaves text on a filtered GPU
      // surface. Before revealing the real window, return to native geometry.
      const final=await shot(destination,destination.rect.height,destination.rect.width);
      place(destination.rect,!destination.maximized&&!destination.fullscreen);
      stage.replaceChildren(final);
      for(const a of running)a.cancel();running=[];
      await painted();return true;
    }
  };
})();
