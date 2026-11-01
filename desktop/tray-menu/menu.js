/* Renderer of the SYTER tray menu. Items come from the main process via the URL. */
'use strict';
(function () {
  var ICONS = {
    journal: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    mini: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
    quit: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'
  };
  var CLOSE_MS = 170;
  var api = window.syterTrayMenu;
  var body = document.body;
  var menu = document.getElementById('menu');
  var params = new URLSearchParams(location.search);
  var items = [];
  try { items = JSON.parse(params.get('items') || '[]'); } catch (e) { items = []; }
  var hl = document.createElement('div'); hl.className = 'hl'; hl.setAttribute('aria-hidden', 'true'); menu.appendChild(hl);
  var buttons = [];
  items.forEach(function (item) {
    if (item.separator) { var sep = document.createElement('div'); sep.className = 'sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep); return; }
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'item'; btn.setAttribute('role', 'menuitem'); btn.tabIndex = -1;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[item.icon] || '') + '</svg>';
    var label = document.createElement('span'); label.className = 'label'; label.textContent = String(item.label || '');
    btn.appendChild(label);
    if (item.hint) { var hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = String(item.hint); btn.appendChild(hint); }
    btn.addEventListener('click', function () { if (body.classList.contains('open')) api.pick(item.id); });
    btn.addEventListener('mouseenter', function () { setActive(buttons.indexOf(btn)); });
    menu.appendChild(btn); buttons.push(btn);
  });
  var version = String(params.get('version') || '');
  var foot = document.createElement('div'); foot.className = 'foot';
  foot.innerHTML = '<div class="sep" role="separator"></div>';
  var ver = document.createElement('div'); ver.className = 'ver'; ver.textContent = version ? 'SYTER ' + version : 'SYTER';
  foot.appendChild(ver); menu.appendChild(foot);

  var active = -1;
  function setActive(index) {
    var wasShown = active >= 0;
    active = index;
    buttons.forEach(function (b, i) { b.classList.toggle('active', i === index); });
    if (index < 0) { hl.classList.remove('show'); return; }
    var top = buttons[index].offsetTop;
    if (!wasShown) { hl.classList.add('jump'); hl.style.transform = 'translateY(' + top + 'px)'; void hl.offsetWidth; hl.classList.remove('jump'); }
    else hl.style.transform = 'translateY(' + top + 'px)';
    hl.classList.add('show');
    buttons[index].focus({ preventScroll: true });
  }
  menu.addEventListener('mouseleave', function () { setActive(-1); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }
    if (!buttons.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % buttons.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + buttons.length) % buttons.length); }
    else if ((e.key === 'Enter' || e.key === ' ') && active >= 0) { e.preventDefault(); buttons[active].click(); }
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var closeTimer = null;
  api.onOpen(function (origin) {
    clearTimeout(closeTimer);
    // Jump to the collapsed state at the new click point, then grow out of it.
    body.classList.add('instant'); body.classList.remove('open');
    document.documentElement.style.setProperty('--ox', origin.x + 'px');
    document.documentElement.style.setProperty('--oy', origin.y + 'px');
    setActive(-1);
    void menu.offsetWidth;
    body.classList.remove('instant');
    requestAnimationFrame(function () { body.classList.add('open'); });
  });
  api.onClose(function () {
    body.classList.remove('open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { setActive(-1); api.closed(); }, CLOSE_MS);
  });
  document.fonts.ready.then(function () { api.ready(); });
})();
