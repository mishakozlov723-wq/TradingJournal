/* Diagnostic-only, local presentation change. No data reads, network or storage. */
(() => {
  'use strict';
  if (window.__syterAutumnMotion) return;
  const root = document.documentElement;
  const base = document.createElement('style');
  base.id = 'syter-autumn-motion-probe';
  base.textContent = `
    html.season-autumn #loginParticles,html.season-autumn #appParticles{display:none!important}
    html[data-syter-autumn-motion="numeric"] .autumn-leaf,
    html[data-syter-autumn-motion="numeric"] .autumn-leaf-shape{animation:none!important}
  `;
  document.head.appendChild(base);
  let mode = 'original', entries = [], lastHeight = -1;
  const active = () => root.classList.contains('season-autumn');
  const value = (leaf, key) => parseFloat(leaf.style.getPropertyValue(key));
  const frames = (rotation, height) => [
    {transform:`translate3d(0,${-height*.18}px,0) rotate(${rotation}deg)`},
    {transform:`translate3d(0,${height*1.38}px,0) rotate(${rotation+35}deg)`}
  ];
  function cssTimes(element) {
    const result = {};
    element.getAnimations().forEach(animation => {
      if (animation.animationName) result[animation.animationName] = animation.currentTime;
    });
    return result;
  }
  function animate(element, keyframes, options, currentTime) {
    const animation = element.animate(keyframes, options);
    if (typeof currentTime === 'number') animation.currentTime = currentTime;
    return animation;
  }
  function start() {
    if (entries.length || mode !== 'numeric' || !active()) return;
    const leaves = [...document.querySelectorAll('#autumnParticles .autumn-leaf')];
    if (!leaves.length || !Element.prototype.animate) return;
    lastHeight = innerHeight;
    const created = [];
    try {
      for (const leaf of leaves) {
        const shape = leaf.querySelector('.autumn-leaf-shape');
        if (!shape) throw Error('Autumn leaf shape missing');
        const parameters = ['--leaf-start-rotation','--leaf-duration','--leaf-delay','--leaf-sway',
          '--leaf-sway-duration','--leaf-sway-delay','--leaf-flutter'].map(key => value(leaf,key));
        if (!parameters.every(Number.isFinite)) throw Error('Autumn motion parameters invalid');
        const [rotation,duration,delay,sway,swayDuration,swayDelay,flutter] = parameters;
        const oldFall = cssTimes(leaf), oldShape = cssTimes(shape);
        const previousTop = leaf.style.top;
        const fall = animate(leaf, frames(rotation,lastHeight),
          {duration:duration*1000,delay:delay*1000,iterations:Infinity,easing:'linear'},oldFall.autumnLeafFall);
        const side = animate(shape,[{translate:`${-sway}px 0`},{translate:`${sway}px 0`}],
          {duration:swayDuration*1000,delay:swayDelay*1000,iterations:Infinity,direction:'alternate',easing:'ease-in-out'},oldShape.autumnLeafSway);
        const fluttering = animate(shape,[{scale:'.94 .98'},{scale:'1.04 1'}],
          {duration:flutter*1000,delay:delay*1000,iterations:Infinity,direction:'alternate',easing:'ease-in-out'},oldShape.autumnLeafFlutter);
        created.push({leaf,shape,rotation,previousTop,fall,side,fluttering});
        leaf.style.top = (-lastHeight*.18)+'px';
      }
      entries = created;
      root.setAttribute('data-syter-autumn-motion','numeric');
    } catch (error) {
      for (const entry of created) {
        [entry.fall,entry.side,entry.fluttering].forEach(animation => animation.cancel());
        entry.leaf.style.top = entry.previousTop;
      }
      entries = [];
      root.removeAttribute('data-syter-autumn-motion');
      console.warn('Autumn motion probe kept original animation:',error.message);
    }
  }
  function stop() {
    const previous = entries.map(entry => ({...entry,
      times:{autumnLeafFall:entry.fall.currentTime,autumnLeafSway:entry.side.currentTime,autumnLeafFlutter:entry.fluttering.currentTime}}));
    for (const entry of entries) {
      [entry.fall,entry.side,entry.fluttering].forEach(animation => animation.cancel());
      entry.leaf.style.top = entry.previousTop;
    }
    entries = [];lastHeight = -1;
    root.removeAttribute('data-syter-autumn-motion');
    for (const entry of previous) {
      for (const element of [entry.leaf,entry.shape]) {
        element.getAnimations().forEach(animation => {
          const time = entry.times[animation.animationName];
          if (typeof time === 'number') animation.currentTime = time;
        });
      }
    }
  }
  function syncHeight() {
    if (mode !== 'numeric' || !active() || innerHeight === lastHeight) return;
    lastHeight = innerHeight;
    for (const entry of entries) {
      entry.leaf.style.top = (-lastHeight*.18)+'px';
      entry.fall.effect.setKeyframes(frames(entry.rotation,lastHeight));
    }
  }
  function syncScene() {
    start();
    for (const entry of entries) {
      for (const animation of [entry.fall,entry.side,entry.fluttering]) {
        if (active() && animation.playState === 'paused') animation.play();
        if (!active() && animation.playState !== 'paused') animation.pause();
      }
    }
    syncHeight();
  }
  window.__syterAutumnMotion = {
    setMode(next) {
      if (!['original','numeric'].includes(next)) return;
      if (next !== mode) { if (next === 'original') stop();mode = next; }
      syncScene();
      return this.status();
    },
    status() { return {build:'autumn-motion-v1',mode,leaves:entries.length,height:lastHeight,
      running:entries.filter(entry => entry.fall.playState === 'running').length}; }
  };
  new MutationObserver(syncScene).observe(root,{attributes:true,attributeFilter:['class']});
  // Leaves are generated lazily when the autumn theme is selected.
  const container = document.getElementById('autumnParticles');
  if (container) new MutationObserver(syncScene).observe(container,{childList:true});
  window.addEventListener('resize',syncHeight,{passive:true});
  window.__syterAutumnMotion.setMode('numeric');
})();
