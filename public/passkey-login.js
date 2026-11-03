/* SYTER Face ID / fingerprint sign-in for phones (WebAuthn passkeys).
   - After a normal password sign-in on a phone, SYTER offers to turn it on once.
   - Then the login screen shows "Sign in with Face ID": one glance and you are in.
   - Settings has a switch to turn it on/off for this device. The password always keeps working.
   Not used in the desktop app. The server part lives in accounts-proxy-vercel/api/passkey.js. */
(function () {
  'use strict';
  var API = window.TJ_PASSKEY_URL || 'https://trading-journal-accounts-proxy.vercel.app/api/passkey';
  var KEY = 'syterPasskey', DECLINED = 'syterPasskeyDeclined:', FRESH_MS = 4 * 60 * 1000;
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPod/.test(ua), isPhone = (isIOS || /Android/i.test(ua)) && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  var supported = !!(isPhone && !window.syterDesktop && window.PublicKeyCredential && navigator.credentials &&
    typeof navigator.credentials.create === 'function' && window.isSecureContext && typeof firebase !== 'undefined' && firebase.auth);
  var BIO = isIOS ? 'Face ID' : 'fingerprint';
  window.tjPasskey = { supported: supported };
  if (!supported) return;

  function $(id) { return document.getElementById(id); }
  function b64u(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function readStored() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.login && v.id ? v : null; } catch (e) { return null; }
  }
  function writeStored(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }
  function declined(login) { try { return localStorage.getItem(DECLINED + String(login).toLowerCase()) === '1'; } catch (e) { return true; } }
  function setDeclined(login) { try { localStorage.setItem(DECLINED + String(login).toLowerCase(), '1'); } catch (e) {} }
  function sameLogin(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

  function post(action, body, idToken) {
    var headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = 'Bearer ' + idToken;
    return fetch(API + '?action=' + action, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok || !data || data.ok === false) {
            var msg = String((data && data.error) || 'Face ID sign-in failed.');
            if (!isIOS) msg = msg.replace(/Face ID or fingerprint/g, 'Fingerprint').replace(/Face ID/g, 'Fingerprint');
            var err = new Error(msg); err.code = data && data.code; err.status = r.status; throw err;
          }
          return data;
        });
      });
  }
  function idToken() {
    var u = firebase.auth().currentUser;
    return u ? u.getIdToken() : Promise.reject(new Error('Not signed in'));
  }
  // Safari only opens Face ID straight from a tap, so the request is prepared beforehand.
  function cache(load) {
    var c = { data: null, at: 0, pending: null };
    c.fresh = function () { return c.data && Date.now() - c.at < FRESH_MS ? c.data : null; };
    c.take = function () { var d = c.fresh(); c.data = null; return d; };
    c.load = function () {
      if (c.pending) return c.pending;
      c.pending = load().then(function (d) { c.data = d; c.at = Date.now(); c.pending = null; return d; },
        function (e) { c.pending = null; throw e; });
      return c.pending;
    };
    return c;
  }
  var loginOptions = cache(function () { return post('login-options'); });
  var registerOptions = cache(function () { return idToken().then(function (t) { return post('register-options', {}, t); }); });

  // ---------- Login screen button ----------
  var loginBtn = $('passkeyLoginBtn'), loginBusy = false;
  function loginScreenVisible() { var s = $('loginScreen'); return !!(s && s.style.display !== 'none'); }
  var loginRow = loginBtn && loginBtn.closest('.login-submit-row'), firstReveal = true;
  // Show/hide the icon by animating the row. The first reveal waits until the login
  // card has finished appearing so the motion is actually seen.
  function setLoginButton(on) {
    if (!loginRow) return;
    loginBtn.tabIndex = on ? 0 : -1;
    loginBtn.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (!on) { loginRow.classList.remove('has-passkey'); return; }
    if (loginRow.classList.contains('has-passkey')) return;
    var delay = firstReveal ? Math.max(0, 520 - performance.now()) : 0;
    firstReveal = false;
    setTimeout(function () { requestAnimationFrame(function () { if (readStored()) loginRow.classList.add('has-passkey'); }); }, delay);
  }
  // Face ID verified -> the button shows its spinner (is-loading); mirror that on the row
  // so the icon stretches to full width and pushes Sign in out. Reverses on failure.
  if (loginRow && window.MutationObserver) {
    new MutationObserver(function () {
      var on = loginBtn.classList.contains('is-loading');
      if (on !== loginRow.classList.contains('pk-expand')) requestAnimationFrame(function () {
        loginRow.classList.toggle('pk-expand', loginBtn.classList.contains('is-loading'));
      });
    }).observe(loginBtn, { attributes: true, attributeFilter: ['class'] });
  }
  function refreshLoginButton() {
    if (!loginBtn) return;
    var stored = readStored();
    setLoginButton(!!stored);
    loginBtn.setAttribute('aria-label', 'Sign in with ' + BIO); loginBtn.title = 'Sign in with ' + BIO;
    if (stored && loginScreenVisible() && !loginOptions.fresh()) loginOptions.load().catch(function () {});
  }
  function loginError(msg) {
    if (typeof window.tjShowLoginError === 'function') window.tjShowLoginError(msg);
  }
  function runLogin(opts, stored) {
    return navigator.credentials.get({ publicKey: {
      challenge: fromB64u(opts.challenge), rpId: opts.rpId, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: fromB64u(stored.id) }]
    } }).then(function (cred) {
      if (!cred) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
      loginBtn.classList.add('is-loading');
      var r = cred.response;
      return post('login', {
        state: opts.state, id: b64u(cred.rawId), clientDataJSON: b64u(r.clientDataJSON),
        authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature),
        userHandle: r.userHandle && r.userHandle.byteLength ? b64u(r.userHandle) : undefined
      });
    }).then(function (res) {
      return firebase.auth().signInWithCustomToken(res.token);
    }).then(function (cred) {
      var user = (cred && cred.user) || firebase.auth().currentUser;
      if (!user || !user.email) {
        // The account behind this passkey no longer exists: never continue with an empty identity.
        writeStored(null); refreshLoginButton();
        return firebase.auth().signOut().catch(function () {}).then(function () {
          throw Object.assign(new Error('gone'), { code: 'PASSKEY_UNKNOWN' });
        });
      }
      if (typeof window.tjPasskeyContinue !== 'function' || !window.tjPasskeyContinue(stored.login, loginBtn)) throw new Error('continue');
    });
  }
  function loginFailed(err, freshFetch) {
    loginBtn.classList.remove('is-loading');
    var code = err && err.code;
    if (err && err.name === 'NotAllowedError') {
      if (freshFetch) loginError('Tap the ' + BIO + ' button once more.');
      return;
    }
    if (code === 'PASSKEY_UNKNOWN') {
      writeStored(null); refreshLoginButton();
      loginError(BIO + ' sign-in is off for this device. Sign in with your password.');
      return;
    }
    loginError(BIO + ' sign-in failed. Try again or use your password.');
  }
  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      var stored = readStored();
      if (loginBusy || !stored) return;
      loginBusy = true;
      var err = $('loginError'); if (err) err.style.display = 'none';
      var ready = loginOptions.take(), fresh = !ready;
      var opts = ready ? Promise.resolve(ready) : loginOptions.load().then(function () { return loginOptions.take(); });
      opts.then(function (o) { return runLogin(o, stored); })
        .catch(function (e) { loginFailed(e, fresh); })
        .then(function () { loginBusy = false; if (loginScreenVisible()) loginOptions.load().catch(function () {}); });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshLoginButton(); });
    setInterval(function () { if (!document.hidden && loginScreenVisible() && readStored() && !loginOptions.fresh()) loginOptions.load().catch(function () {}); }, 60000);
    refreshLoginButton();
  }

  // ---------- Turning it on ----------
  var currentLogin = '';
  function enabledHere(login) { var s = readStored(); return !!(s && sameLogin(s.login, login)); }
  function runRegister(opts, login) {
    return navigator.credentials.create({ publicKey: {
      challenge: fromB64u(opts.challenge), rp: opts.rp,
      user: { id: fromB64u(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none', timeout: 60000
    } }).then(function (cred) {
      if (!cred) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
      return idToken().then(function (t) {
        return post('register', { state: opts.state, id: b64u(cred.rawId), clientDataJSON: b64u(cred.response.clientDataJSON),
          attestationObject: b64u(cred.response.attestationObject), label: isIOS ? 'iPhone' : 'Android' }, t);
      });
    }).then(function (res) {
      writeStored({ login: login, id: res.id, at: Date.now() });
      refreshLoginButton(); refreshSettings();
    });
  }
  function enable(login) {
    var ready = registerOptions.take();
    if (ready) return runRegister(ready, login).then(function () { return 'on'; });
    return registerOptions.load().then(function () { return runRegister(registerOptions.take(), login); })
      .then(function () { return 'on'; }, function (e) { if (e && e.name === 'NotAllowedError') { lastErr = e; return 'again'; } throw e; });
  }
  var lastErr = null, againCount = 0;
  function errText(e) {
    if (!e) return '';
    var m = String(e.message || e.error || '').replace(/\s+/g, ' ').slice(0, 140);
    return (e.name && e.name !== 'Error' ? e.name : (e.code || 'Error')) + (m ? ': ' + m : '');
  }

  // SYTER-styled offer (same look as the journal's confirmation dialog).
  var offer = null;
  function buildOffer() {
    var o = document.createElement('div');
    o.className = 'modal-overlay asset-custom-overlay tj-confirm-overlay passkey-offer-overlay';
    o.id = 'passkeyOfferOverlay'; o.setAttribute('aria-hidden', 'true');
    o.innerHTML = '<div class="modal-box asset-delete-box passkey-offer-box" role="dialog" aria-modal="true" aria-labelledby="passkeyOfferTitle">' +
      '<div class="passkey-offer-icon" aria-hidden="true">' + faceIcon(34) + '</div>' +
      '<div class="card-title passkey-offer-title" id="passkeyOfferTitle"></div>' +
      '<div class="asset-delete-message passkey-offer-message" id="passkeyOfferMessage"></div>' +
      '<div class="asset-delete-actions"><button type="button" class="ghost-btn" id="passkeyOfferLater">Not now</button>' +
      '<button type="button" class="add-btn" id="passkeyOfferOk">Turn on</button></div></div>';
    document.body.appendChild(o);
    return o;
  }
  // While the offer is open the journal underneath must not scroll or swipe: choose Turn on or Not now.
  function blockTouch(e) { if (offer && offer.classList.contains('open')) e.preventDefault(); }
  function lockPage(on) {
    document.documentElement.classList.toggle('passkey-offer-lock', on);
    var fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('touchmove', blockTouch, { passive: false });
    document[fn]('wheel', blockTouch, { passive: false });
  }
  function closeOffer() { if (offer) { offer.classList.remove('open'); offer.setAttribute('aria-hidden', 'true'); } lockPage(false); }
  function showOffer(login) {
    offer = offer || buildOffer();
    $('passkeyOfferTitle').textContent = 'Sign in with ' + BIO + '?';
    $('passkeyOfferMessage').textContent = 'Next time, sign in with one ' + (isIOS ? 'glance' : 'touch') + ' — no password needed. Your password keeps working.';
    var ok = $('passkeyOfferOk'), later = $('passkeyOfferLater');
    ok.disabled = false; ok.textContent = 'Turn on';
    ok.onclick = function () {
      ok.disabled = true;
      enable(login).then(function (r) {
        if (r === 'again') { ok.disabled = false; ok.textContent = 'Tap again'; return; }
        $('passkeyOfferTitle').textContent = BIO + ' is on';
        $('passkeyOfferMessage').textContent = 'Next time, tap the ' + BIO + ' button next to Sign in.';
        setTimeout(closeOffer, 1600);
      }).catch(function (e) {
        if (e && e.name === 'NotAllowedError') { setDeclined(login); closeOffer(); return; }
        ok.disabled = false; ok.textContent = 'Try again';
        $('passkeyOfferMessage').textContent = 'Could not turn on ' + BIO + '. You can try again later in Settings.';
      });
    };
    later.onclick = function () { setDeclined(login); closeOffer(); };
    offer.onclick = null;
    offer.setAttribute('aria-hidden', 'false');
    offer.classList.add('open');
    lockPage(true);
  }
  function maybeOffer(login) {
    if (!login || enabledHere(login) || declined(login)) return;
    var check = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : Promise.resolve(false);
    check.then(function (ok) {
      if (!ok) return;
      return registerOptions.load().then(function () {
        setTimeout(function () { if (sameLogin(currentLogin, login) && !loginScreenVisible() && registerOptions.fresh()) showOffer(login); }, 1200);
      });
    }).catch(function () {});
  }

  // ---------- Settings switch ----------
  var section = $('passkeySettingsSection'), setBtn = $('passkeySettingsBtn'), setLabel = $('passkeySettingsLabel');
  function refreshSettings() {
    if (!section) return;
    section.style.display = currentLogin && firebase.auth().currentUser ? '' : 'none';
    if (setLabel) setLabel.textContent = (enabledHere(currentLogin) ? 'Turn off ' : 'Turn on ') + BIO + ' sign-in';
    if (setBtn) setBtn.disabled = false;
  }
  if (setBtn) {
    setBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var login = currentLogin; if (!login || setBtn.disabled) return;
      setBtn.disabled = true;
      if (enabledHere(login)) {
        var stored = readStored();
        idToken().then(function (t) { return post('remove', { id: stored.id }, t); }).catch(function () {})
          .then(function () { writeStored(null); refreshLoginButton(); refreshSettings(); registerOptions.load().catch(function () {}); });
        return;
      }
      // iPhone: call create() synchronously inside the tap (Safari is strict about that).
      var uv = (!isIOS && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return null; }) : null;
      var go = function (avail) {
        if (avail === false) {
          refreshSettings();
          if (setLabel) setLabel.textContent = 'Chrome says no ' + BIO + ' is available. Set a screen lock + fingerprint and turn on Google Password Manager, then retry';
          return;
        }
        return enable(login).then(function (r) {
          refreshSettings();
          if (r === 'on') { againCount = 0; return; }
          againCount++;
          if (setLabel) setLabel.textContent = againCount > 1 ? 'Could not turn on ' + BIO + ' — ' + errText(lastErr) : 'Tap again to turn on ' + BIO;
        });
      };
      var fail = function (e) { refreshSettings(); if (setLabel) setLabel.textContent = 'Could not turn on ' + BIO + ' — ' + errText(e); };
      if (uv) uv.then(go).catch(fail);
      else { try { var p = go(null); if (p) p.catch(fail); } catch (e) { fail(e); } }
    });
  }

  window.addEventListener('tj:signed-in', function (e) {
    var d = (e && e.detail) || {};
    currentLogin = String(d.login || '');
    refreshSettings();
    if (!enabledHere(currentLogin)) registerOptions.load().catch(function () {});
    if (d.manual) maybeOffer(currentLogin);
  });
  firebase.auth().onAuthStateChanged(function (u) {
    if (!u) { currentLogin = ''; closeOffer(); refreshSettings(); setTimeout(refreshLoginButton, 0); }
  });

  // Android: fingerprint icon (Lucide "fingerprint") instead of the Face ID frame.
  var FINGER = '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>' +
    '<path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>' +
    '<path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>';
  function faceIcon(size) {
    if (!isIOS) return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + FINGER + '</svg>';
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 8V6a3 3 0 0 1 3-3h2"/><path d="M16 3h2a3 3 0 0 1 3 3v2"/><path d="M21 16v2a3 3 0 0 1-3 3h-2"/><path d="M8 21H6a3 3 0 0 1-3-3v-2"/>' +
      '<path d="M9 9v1.5"/><path d="M15 9v1.5"/><path d="M12 9v4h-1"/><path d="M9 16c1.6 1.3 4.4 1.3 6 0"/></svg>';
  }
  window.tjPasskey.faceIcon = faceIcon;
  if (!isIOS && loginBtn) { var bt = loginBtn.querySelector('.btn-text'); if (bt) bt.innerHTML = faceIcon(24); }
})();
