/* Desktop app only (window.syterDesktop comes from the Electron preload; in a browser this file does nothing).
   For 6 hours after a manual sign-in the login screen fills itself in: the login is typed letter by letter,
   the password field gets decorative dots (no password is stored or typed - the saved Firebase session is
   reused), then Sign in is pressed. Touching the login screen while it runs cancels it. */
(function () {
  var desk = window.syterDesktop;
  if (!desk || !desk.isDesktop || typeof desk.getRemember !== 'function') return;
  var screen = document.getElementById('loginScreen');
  var userIn = document.getElementById('loginUserInput');
  var passIn = document.getElementById('loginPassInput');
  var btn = document.getElementById('loginSubmitBtn');
  if (!screen || !userIn || !passIn || !btn || typeof firebase === 'undefined' || !firebase.auth) return;

  var cancelled = false, running = false;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function charDelay() { return rnd(60, 100); }            // 60-100 ms per character, uneven like a person
  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
  function check() { if (cancelled) throw new Error('cancelled'); }

  function restoredUser() {
    return new Promise(function (resolve) {
      var off = firebase.auth().onAuthStateChanged(function (u) { off(); resolve(u); });
    });
  }
  function typeInto(el, text) {
    el.focus();
    var i = 0;
    return (function step() {
      check();
      if (i >= text.length) return Promise.resolve();
      i++;
      el.value = text.slice(0, i); fire(el);
      return wait(charDelay()).then(step);
    })();
  }

  function cancel() {
    if (!running || cancelled) return;
    cancelled = true;
    window.__tjDesktopResume = false;
    userIn.value = ''; passIn.value = '';
    screen.classList.remove('desktop-autologin');
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { screen.addEventListener(ev, cancel, true); });

  function run(login) {
    running = true;
    screen.classList.add('desktop-autologin');     // hides the "show password" eye
    userIn.value = ''; passIn.value = '';
    var dots = Math.round(rnd(9, 13));
    return wait(rnd(700, 1000)).then(function () {
      return typeInto(userIn, login);
    }).then(function () {
      return wait(rnd(280, 480));
    }).then(function () {
      check();
      return typeInto(passIn, new Array(dots + 1).join('•'));   // type="password" shows these as dots; the value is never used
    }).then(function () {
      return wait(rnd(350, 600));
    }).then(function () {
      check();
      window.__tjDesktopResume = true;
      if (btn.animate) btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 160 });
      return wait(90);
    }).then(function () {
      check();
      running = false;
      btn.click();
    }).catch(function () { /* cancelled by the user */ });
  }

  Promise.all([desk.getRemember(), restoredUser()]).then(function (res) {
    var rem = res[0], user = res[1];
    if (!rem || !rem.valid || !rem.login || !user || !user.email) return;       // expired, never signed in, or no saved session
    if (String(user.email).split('@')[0].toLowerCase() !== rem.login.toLowerCase()) return;
    if (getComputedStyle(screen).display === 'none') return;                   // already inside the app
    return run(rem.login);
  }).catch(function () {});
})();
