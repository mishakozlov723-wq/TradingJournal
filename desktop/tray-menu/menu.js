/* Renderer of the SYTER tray menu. Items come from the main process via the URL. */
'use strict';
(function () {
  var ICONS = {
    journal: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    mini: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
    quit: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'
  };
  var api = window.syterTrayMenu;
  var menu = document.getElementById('menu');
  var items = [];
  try { items = JSON.parse(new URLSearchParams(location.search).get('items') || '[]'); } catch (e) { items = []; }
  var buttons = [];
  items.forEach(function (item) {
    if (item.separator) { var sep = document.createElement('div'); sep.className = 'sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep); return; }
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'item'; btn.setAttribute('role', 'menuitem'); btn.tabIndex = -1;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[item.icon] || '') + '</svg>';
    var label = document.createElement('span'); label.className = 'label'; label.textContent = String(item.label || '');
    btn.appendChild(label);
    if (item.hint) { var hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = String(item.hint); btn.appendChild(hint); }
    btn.addEventListener('click', function () { api.pick(item.id); });
    btn.addEventListener('mousemove', function () { setActive(buttons.indexOf(btn)); });
    menu.appendChild(btn); buttons.push(btn);
  });
  var active = -1;
  function setActive(index) {
    active = index;
    buttons.forEach(function (b, i) { b.classList.toggle('active', i === index); });
    if (index >= 0) buttons[index].focus({ preventScroll: true });
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
  api.onOpen(function () {
    setActive(-1);
    document.body.classList.remove('open'); void menu.offsetWidth;
    requestAnimationFrame(function () { document.body.classList.add('open'); });
  });
  api.onClose(function () { document.body.classList.remove('open'); setActive(-1); });
  document.fonts.ready.then(function () { api.ready(); });
})();
