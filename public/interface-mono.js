/* SYTER monochrome interface. Opt-in, session-only. No account or trading-data writes. */
(function () {
  'use strict';
  var root = document.documentElement, rail, observer, busy = false, collapsed = false;
  var attr = 'data-syter-interface', eventName = 'syter:interface-preview-toggle';
  var routes = [
    ['journal', 'Journal', 'M4 4h16v16H4zM9 4v16M12 9h5M12 13h5'],
    ['replay', 'Replay', 'm9 5 11 7-11 7zM4 5v14'],
    ['backtest', 'Backtest', 'M4 4v16h16M7 14l4-5 4 3 5-7'],
    ['accounts', 'Accounts', 'M3 7h18v14H3zM7 7V3h10v4M3 12h18M10 12v3h4v-3'],
    ['notes', 'Notes', 'M5 3h11l3 3v15H5zM9 10h6M9 14h6M9 18h4']
  ];
  function el(id) { return document.getElementById(id); }
  function enabled() { return root.getAttribute(attr) === 'mono'; }
  function icon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="' + path + '"/>'; return svg;
  }
  function currentRoute() {
    var c = document.body.classList;
    return c.contains('replay-workspace-mode') ? 'replay' : c.contains('notes-workspace-mode') ? 'notes' :
      c.contains('accounts-workspace-mode') ? 'accounts' : c.contains('backtest-workspace-mode') ? 'backtest' : 'journal';
  }
  function signedIn() { var app = el('appRoot'); return app && app.style.display !== 'none' && !document.body.classList.contains('notes-share-mode'); }
  function ready(route) {
    if (route === 'replay' || route === 'accounts') {
      var b = el(route === 'replay' ? 'openReplayWorkspaceBtn' : 'openAccountsWorkspaceBtn');
      return !!(b && b.style.display !== 'none' && window[route === 'replay' ? 'TJReplay' : 'TJAccounts']);
    }
    return true;
  }
  function sync() {
    if (!rail || !enabled()) return;
    var visible = signedIn();
    rail.hidden = !visible;
    root.toggleAttribute('data-syter-rail-visible', visible);
    var settings = rail.querySelector('.syter-rail-settings'); if (settings) settings.disabled = busy;
    var route = currentRoute();
    rail.querySelectorAll('[data-space]').forEach(function (b) {
      var active = b.dataset.space === route;
      b.toggleAttribute('aria-current', active);
      if (active) b.setAttribute('aria-current', 'page');
      b.disabled = busy || !ready(b.dataset.space);
    });
  }
  function waitFor(test, timeout) {
    return new Promise(function (resolve) {
      var start = Date.now();
      function tick() { if (test()) resolve(true); else if (Date.now() - start > timeout) resolve(false); else setTimeout(tick, 30); }
      tick();
    });
  }
  async function navigate(route) {
    if (!enabled() || busy || !ready(route) || route === currentRoute()) return;
    busy = true; sync();
    try {
      // Always leave through native handlers: Replay flushes progress; Notes saves its draft.
      if (window.TJReplay && window.TJReplay.state.mode) window.TJReplay.exit();
      if (window.TJAccounts && window.TJAccounts.state.mode) window.TJAccounts.exit();
      if (document.body.classList.contains('notes-workspace-mode')) {
        var exitNotes = el('exitNotesWorkspaceBtn'); if (exitNotes) exitNotes.click();
        if (!await waitFor(function () { return !document.body.classList.contains('notes-workspace-mode'); }, 5000)) return;
      }
      if (document.body.classList.contains('backtest-workspace-mode') && typeof window.exitBacktestWorkspace === 'function') {
        window.exitBacktestWorkspace();
        if (!await waitFor(function () { return !document.body.classList.contains('backtest-workspace-mode'); }, 5000)) return;
      }
      if (route === 'journal') return;
      if (route === 'replay') window.TJReplay.enter();
      if (route === 'accounts') window.TJAccounts.enter();
      if (route === 'notes') { var openNotes = el('openNotesWorkspaceBtn'); if (openNotes) openNotes.click(); }
      if (route === 'backtest' && typeof window.enterBacktestWorkspace === 'function') window.enterBacktestWorkspace();
      await waitFor(function () { return currentRoute() === route; }, 5000);
    } finally { busy = false; sync(); }
  }
  function buildRail() {
    rail = document.createElement('nav'); rail.id = 'syterRail'; rail.className = 'syter-rail';
    rail.setAttribute('aria-label', 'Workspaces'); rail.hidden = true;
    var brand = document.createElement('div'); brand.className = 'syter-rail-brand'; brand.textContent = 'SYTER'; rail.appendChild(brand);
    var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'syter-rail-toggle';
    toggle.setAttribute('aria-label', 'Collapse navigation'); toggle.setAttribute('aria-expanded', 'true');
    toggle.appendChild(icon('M4 4h16v16H4zM9 4v16M15 9l-3 3 3 3'));
    toggle.addEventListener('click', function () {
      collapsed = !collapsed; root.toggleAttribute('data-syter-rail-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
      window.dispatchEvent(new Event('resize'));
    }); rail.appendChild(toggle);
    var links = document.createElement('div'); links.className = 'syter-rail-links';
    routes.forEach(function (r) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.space = r[0]; b.setAttribute('aria-label', r[1]); b.title = r[1];
      b.appendChild(icon(r[2])); var label = document.createElement('span'); label.textContent = r[1]; b.appendChild(label);
      b.addEventListener('click', function () { navigate(r[0]).catch(function (error) { console.error('Workspace navigation failed', error); }); }); links.appendChild(b);
    }); rail.appendChild(links);
    var settings = document.createElement('button'); settings.type = 'button'; settings.className = 'syter-rail-settings'; settings.setAttribute('aria-label', 'Settings'); settings.title = 'Settings';
    settings.appendChild(icon('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'));
    var label = document.createElement('span'); label.textContent = 'Settings'; settings.appendChild(label);
    settings.addEventListener('click', async function () {
      if (busy) return;
      await navigate('journal');
      if (typeof window.setSecondaryActions === 'function') window.setSecondaryActions(true);
      var b = el('settingsBtn'), wrap = el('settingsWrap');
      if (b && wrap && wrap.style.display !== 'none' && !wrap.classList.contains('open')) b.click();
    }); rail.appendChild(settings); document.body.appendChild(rail);
  }
  var labelObserver, labelEdits = new Map();
  var labelWords = {
    'Add your first trade — equity curve will appear here':'No trades',
    'No trades with screenshots yet. Add a chart screenshot in the "Add Trade" form.':'No screenshots',
    'Paste your trade list on the left to see the equity curve':'No trades',
    'Данные Myfxbook появятся здесь после первой синхронизации':'No balance history',
    'Модель':'Model', 'Без модели':'No model', 'Добавьте свои торговые модели':'Add trading models',
    'Не удалось загрузить модели · Повторить':'Could not load models · Retry', 'Загрузка моделей…':'Loading models…',
    'Добавить модель':'Add model', 'Название модели':'Model name', 'Ссылка на общую заметку Notes':'Shared Notes link',
    'Удалить модель?':'Delete model?', 'Отмена':'Cancel', 'Удалить':'Delete',
    'Подключить Myfxbook':'Connect Myfxbook', 'Myfxbook подключён':'Myfxbook connected',
    'Подключите Myfxbook':'Connect Myfxbook', 'Не удалось обновить':'Could not refresh'
  };
  function projectLabels() {
    var nodes = ['emptyChart','galleryEmptyState','backtestEmptyChart','accountsChartEmpty','tradeModelLabel','tradeModelCTA','modelCreateTitle','modelCreateSubmit','modelDeleteTitle','modelDeleteCancel','modelDeleteConfirm','accountsSetupTitle','accountsSyncCopy'].map(el);
    document.querySelectorAll('#modelCreateForm label').forEach(function(n){nodes.push(n);});
    // Model names are user-authored: translate only the unassigned sentinel, never real names.
    if (typeof window.selectedTradeModelId !== 'undefined' && !window.selectedTradeModelId) nodes.push(el('tradeModelValue'));
    document.querySelectorAll('.account-card-meta,#accountsDetailMeta,#accountsSyncCopy,.accounts-empty-row').forEach(function(n){nodes.push(n);});
    var menu = el('tradeModelMenu'); if (menu) nodes.push(menu.querySelector('.trade-asset-option'));
    nodes.forEach(function(n){
      if (!n || n.children.length) return;
      var old = n.textContent, translated = labelWords[old];
      if (n.matches('.account-card-meta,#accountsDetailMeta,#accountsSyncCopy,.accounts-empty-row')) {
        var copy = old.replace(/Обновлено в Myfxbook:/g,'Myfxbook updated:').replace(/^Обновлено /,'Updated ').replace(/Демо/g,'Demo').replace(/Реальный/g,'Live');
        if(old==='В последней синхронизации Myfxbook открытых позиций нет')copy='No open positions in the latest sync';
        if(old==='Закрытые сделки пока не сохранены')copy='No saved closed trades';
        if(copy!==old)translated=copy;
      }
      if (translated) { labelEdits.set(n,{before:old,after:translated}); n.textContent=translated; }
    });
  }
  function startLabels() {
    projectLabels(); labelObserver = new MutationObserver(projectLabels);
    ['tradeModelControl','tradeModelCTA','tradeModelLabel','modelCreateForm','accountsSetupTitle','accountsSyncCopy','accountsWorkspace'].forEach(function(id){var n=el(id);if(n)labelObserver.observe(n,{childList:true,subtree:true,characterData:true});});
  }
  function stopLabels() {
    if(labelObserver)labelObserver.disconnect();labelObserver=null;
    labelEdits.forEach(function(edit,n){if(n.textContent===edit.after)n.textContent=edit.before;});labelEdits.clear();
  }
  function toggle() {
    if (!rail) buildRail();
    var on = !enabled();
    if (on) {
      root.setAttribute(attr, 'mono');
      startLabels();
      root.toggleAttribute('data-syter-rail-collapsed', collapsed);
      sync();
      observer = new MutationObserver(sync);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      ['appRoot','openReplayWorkspaceBtn','openAccountsWorkspaceBtn'].forEach(function (id) { var n = el(id); if (n) observer.observe(n, { attributes: true, attributeFilter: ['style'] }); });
    } else {
      if (observer) observer.disconnect(); observer = null;
      stopLabels();
      root.removeAttribute(attr); root.removeAttribute('data-syter-rail-visible'); root.removeAttribute('data-syter-rail-collapsed'); rail.hidden = true;
    }
    // Existing chart ResizeObservers resize their own surfaces. No re-render or data reload.
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('syter:interface-changed', { detail: { monochrome: on } }));
  }
  window.addEventListener(eventName, toggle);
  // Electron intercepts the combination before DOM dispatch; this also supports the website.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'Digit0' || e.code === 'Numpad0')) {
      e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) toggle();
    }
  }, true);
})();
