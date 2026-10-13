'use strict';
(()=>{
  const stage=document.getElementById('stage');let source,union,running=[];
  async function shot(data,baseHeight){
    const layer=document.createElement('div');layer.className='shot';
    const top=data.top*baseHeight/data.rect.height,images=[];
    if(data.title&&top){const title=new Image();title.src=data.title;
      title.style.top='0';title.style.height=top+'px';layer.append(title);images.push(title);}
    const body=new Image();body.src=data.body;body.style.top=top+'px';body.style.height=`calc(100% - ${top}px)`;
    layer.append(body);images.push(body);await Promise.all(images.map(im=>im.decode()));return layer;
  }
  window.syterTransition={
    async prepare(data){
      for(const a of running)a.cancel();running=[];source=data.source;union=data.union;stage.replaceChildren();
      Object.assign(stage.style,{left:source.rect.x-union.x+'px',top:source.rect.y-union.y+'px',
        width:source.rect.width+'px',height:source.rect.height+'px',transform:'none'});
      stage.append(await shot(source,source.rect.height));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;
    },
    async play({destination,duration}){
      const old=stage.firstElementChild,next=await shot(destination,source.rect.height);
      next.style.opacity='0';stage.append(next);const a=source.rect,b=destination.rect;
      const end=`translate(${b.x-a.x}px, ${b.y-a.y}px) scale(${b.width/a.width}, ${b.height/a.height})`;
      const options={duration,easing:'cubic-bezier(.22,.68,0,1)',fill:'forwards'};
      running=[stage.animate([{transform:'none'},{transform:end}],options),
        old.animate([{opacity:1},{opacity:0,offset:.48},{opacity:0}],options),
        next.animate([{opacity:0},{opacity:0,offset:.16},{opacity:1,offset:.72},{opacity:1}],options)];
      await Promise.race([Promise.all(running.map(a=>a.finished.catch(()=>{}))),
        new Promise(resolve=>setTimeout(resolve,duration+180))]);
      for(const a of running){try{a.finish();}catch(_){}}return true;
    }
  };
})();
