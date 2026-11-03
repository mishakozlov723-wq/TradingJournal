  // Keep mobile-only behavior tied to the user's explicit version selection.
  function mobilePerformanceEnabled() {
    return document.documentElement.classList.contains('mobile-performance');
  }
  function mobileImageAttributes() {
    return mobilePerformanceEnabled() ? ' loading="lazy" decoding="async"' : '';
  }
  document.addEventListener('visibilitychange', function() {
    document.documentElement.classList.toggle('mobile-page-hidden', document.hidden);
  });

  // All chart entry points share one cache and one resize observer per element.
  // Snapshot scalar values without serializing/copying large screenshot strings.
  function appendChartKey(key, value) {
    if (value && typeof value === 'object') {
      var keys = Object.keys(value);
      key.push(Array.isArray(value) ? 'array' : 'object', keys.length);
      keys.forEach(function(name) { key.push(name); appendChartKey(key, value[name]); });
    } else { key.push(typeof value, value); }
  }
  function sameChartKey(a, b) {
    if (!a || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  function chartCssHeight(element) {
    return parseFloat(getComputedStyle(element).height) || 0;
  }
  function mobileChartSize(svg, fallbackWidth, fallbackHeight) {
    if (!document.body.classList.contains('mobile-mode')) {
      return { width: fallbackWidth, height: fallbackHeight };
    }
    // Match the viewBox to the actual SVG viewport; preserve undistorted labels.
    return { width: svg.clientWidth || fallbackWidth,
      height: svg.clientHeight || chartCssHeight(svg) || fallbackHeight };
  }
  function renderChartOnce(id, data, options, draw, retry) {
    var element = document.getElementById(id);
    if (!element) return;
    var wrap = element.closest('.chart-wrap') || element.parentElement;
    var state = element._chartRenderState;
    if (!state) {
      state = element._chartRenderState = { key: null, width: 0, pending: true, frame: null };
      state.observer = new ResizeObserver(function() {
        if (tjResizeLive || tjBtResizeLive) return;
        if (!wrap.getClientRects().length || wrap.clientWidth <= 0) return;
        if (!state.pending && state.width === wrap.clientWidth && state.height === chartCssHeight(element)) return;
        if (state.frame !== null) return;
        state.frame = requestAnimationFrame(function() {
          state.frame = null;
          state.retry();
        });
      });
      state.observer.observe(wrap);
      state.observer.observe(element);
    }
    state.retry = retry;
    // Remember the newest arguments, but leave hidden charts alone until shown.
    if (!wrap.getClientRects().length || wrap.clientWidth <= 0) {
      state.pending = true;
      return;
    }
    var width = wrap.clientWidth;
    var height = chartCssHeight(element);
    var key = [width, height, document.body.classList.contains('mobile-mode')];
    appendChartKey(key, options);
    appendChartKey(key, data);
    if (sameChartKey(state.key, key)) {
      state.width = width;
      state.height = height;
      state.pending = false;
      return;
    }
    draw();
    // Commit only after successful rendering so an error never poisons the cache.
    state.key = key;
    state.width = width;
    state.height = height;
    state.pending = false;
  }
  // Overview Equity Curve: a persistent "live" chart.
  // Only the numbers that shape the curve decide whether it animates:
  //   layout changed (size / mobile / user) -> redraw, draw-in only on first show
  //   curve values changed                  -> smooth morph old line -> new line
  //   colour changed                        -> recolour in place, no animation
  //   anything else (model, screenshot...)  -> chart is left untouched
  var overviewChartState = {
    drawn: false, pending: false, observer: null, frame: null,
    layoutKey: null, curveKey: null, userKey: null, color: null,
    W: 0, H: 0, geom: null, entries: null, domain: null, unit: '%', data: null, anim: null
  };
  function overviewChartPointKey(d, i) {
    if (!d.trade) return 'origin';
    return d.trade.id != null ? 't:' + d.trade.id : 'i:' + i;
  }
  function overviewCurveKey(data) {
    var key = [];
    for (var i = 0; i < data.length; i++) key.push(overviewChartPointKey(data[i], i) + '=' + data[i].equity);
    return key.join('|');
  }
  function overviewChartMotionEnabled() {
    if (mobilePerformanceEnabled()) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function renderChart(data) {
    lastChartData = data;
    var st = overviewChartState;
    var svg = document.getElementById('chartSvg');
    if (!svg) return;
    var wrap = svg.closest('.chart-wrap') || svg.parentElement;
    if (!st.observer) {
      st.observer = new ResizeObserver(function() {
        if (tjResizeLive || tjBtResizeLive) return;
        if (!wrap.getClientRects().length || wrap.clientWidth <= 0) return;
        if (!st.pending && st.W === wrap.clientWidth && st.H === chartCssHeight(svg)) return;
        if (st.frame !== null) return;
        st.frame = requestAnimationFrame(function() {
          st.frame = null;
          if (lastChartData) renderChart(lastChartData);
        });
      });
      st.observer.observe(wrap);
      st.observer.observe(svg);
    }
    // Hidden tab: keep the newest data, render when the chart becomes visible.
    if (!wrap.getClientRects().length || wrap.clientWidth <= 0) { st.pending = true; return; }
    st.pending = false;
    var W = wrap.clientWidth, H = chartCssHeight(svg);
    st.W = W; st.H = H;
    if (!data || data.length <= 1) {
      stopOverviewChartAnimation();
      renderChartUncached(data || []);
      st.drawn = false; st.curveKey = null; st.data = data;
      return;
    }
    var layoutKey = [W, H, document.body.classList.contains('mobile-mode')].join('|');
    var curveKey = overviewCurveKey(data);
    if (!st.drawn || st.userKey !== viewingUser) {
      renderChartUncached(data, { drawIn: true });
    } else if (st.layoutKey !== layoutKey) {
      renderChartUncached(data, { drawIn: false });
    } else if (st.curveKey !== curveKey) {
      if (overviewChartMotionEnabled()) morphOverviewChart(data);
      else renderChartUncached(data, { drawIn: false });
    } else {
      // Curve is identical: never replay the chart. Just keep colour and
      // tooltip data (trade objects) current.
      if (st.color !== curveColor) applyOverviewChartColor();
      var refsChanged = !st.data || st.data.length !== data.length;
      for (var i = 0; !refsChanged && i < data.length; i++) if (st.data[i].trade !== data[i].trade) refsChanged = true;
      if (refsChanged && !st.anim) rebuildOverviewChartHits(data);
      else if (refsChanged && st.anim) st.anim.data = data;
      st.data = data;
    }
    st.layoutKey = layoutKey;
    st.curveKey = curveKey;
    st.userKey = viewingUser;
    if (!st.anim) refreshOverviewTradeNumbers(data);
  }
  function refreshOverviewTradeNumbers(data) {
    var svg = document.getElementById('chartSvg');
    if (!svg || !data) return;
    var numberedPoints = data.filter(function(d) { return !!d.trade; });
    Array.prototype.forEach.call(svg.querySelectorAll('.chart-hit-area'), function(hit, i) {
      var point = numberedPoints[i];
      if (!point) return;
      var label = 'Trade #' + tradeNumberOf(point.trade) + ', result ' + fmtPercent(tradeGainPercent(point.trade));
      if (hit.getAttribute('aria-label') !== label) hit.setAttribute('aria-label', label);
    });
  }
  function renderMonthDetailChart(arr) {
    renderChartOnce('monthChartSvg', arr, [viewingUser],
      function() { renderMonthDetailChartUncached(arr); }, function() { renderMonthDetailChart(arr); });
  }
  function renderPeriodDetailChart(svgId, emptyId, arr) {
    renderChartOnce(svgId, arr, [viewingUser],
      function() { renderMonthDetailChartUncached(arr, svgId, emptyId); }, function() { renderPeriodDetailChart(svgId, emptyId, arr); });
  }
  function renderBacktestChart(arr) {
    arr = filterBacktestTradesByModel(arr);
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    renderChartOnce('backtestChart', arr, [activeBacktestId, curveColor,
      bt && bt.pendingCurveColor, bt && bt.curveColor, viewingUser, backtestModelFilterId],
      function() { renderBacktestChartUncached(arr); }, function() { renderBacktestChart(arr); });
  }
  function renderBarChart(year, arr) {
    renderChartOnce('barChart', arr, [year, viewingUser],
      function() { renderBarChartUncached(year, arr); }, function() { renderBarChart(year, arr); });
  }
  var RU_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var RU_MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var EN_MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var EN_MONTHS_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  // v3.42: no user list ships with the site any more. A login maps to <login>@journal.local
  // for Firebase sign-in; profiles are read from Firestore /users AFTER sign-in
  // (a user reads only their own record, the admin reads the whole list — see Firestore rules).
  var USERS = [];
  var TJ_LOGIN_DOMAIN = '@journal.local';
  var tjAdminUid = null;
  var tjTypedLogin = '';
  var tjDirectory = { uid: null, promise: null };
  function tjLoginTarget(value) {
    var v = String(value || '').trim();
    if (!v || /\s/.test(v)) return null;
    if (v.indexOf('@') >= 0) return { login: v.split('@')[0], email: v.toLowerCase() };
    return { login: v, email: v.toLowerCase() + TJ_LOGIN_DOMAIN };
  }
  function tjProfileFromAuth(authUser) {
    var email = String(authUser.email || '').toLowerCase();
    var prefix = email.split('@')[0] || '';
    var login = tjTypedLogin && tjTypedLogin.toLowerCase() === prefix ? tjTypedLogin : prefix;
    return { login: login, email: email, role: 'user', uid: authUser.uid };
  }
  function tjCleanProfile(x, profileUid) {
    x = x || {};
    // /users/{uid} is keyed by Firebase Auth UID (see firestore.rules).
    // The legacy uid field may be stale after an account was recreated/imported.
    // Use the document identity for admin views, just as sign-in uses Auth UID.
    return { login: String(x.login || ''), email: String(x.email || ''), role: x.role === 'admin' ? 'admin' : 'user', uid: String(profileUid || '') };
  }
  function tjResetUserDirectory() {
    USERS = [];
    tjAdminUid = null;
    tjDirectory = { uid: null, promise: null };
  }
  function tjRepairSettingsOwners(authUser, profiles) {
    // Only the signed-in administrator can repair a legacy settings UID.
    // Ordinary users cannot read/claim a root that still belongs to an old UID.
    function currentAdmin() {
      var now = firebase.auth().currentUser;
      return !!(now && now.uid === authUser.uid && tjAdminUid === authUser.uid);
    }
    if (!currentAdmin()) return Promise.resolve();
    // Two /users profiles with one login would flip the settings owner back and
    // forth on every administrator sign-in. Never guess: leave such roots alone.
    var uidsByLogin = Object.create(null), ambiguous = [];
    profiles.forEach(function(profile) {
      if (!profile.login || !profile.uid) return;
      var key = String(profile.login).toLowerCase(), uids = uidsByLogin[key] || (uidsByLogin[key] = []);
      if (uids.indexOf(profile.uid) < 0) uids.push(profile.uid);
    });
    Object.keys(uidsByLogin).forEach(function(key) { if (uidsByLogin[key].length > 1) ambiguous.push(key + ' (' + uidsByLogin[key].join(', ') + ')'); });
    if (ambiguous.length) {
      console.warn('Several /users profiles share a login; settings ownership was not changed:', ambiguous.join('; '));
      if (typeof tjNotice === 'function') tjNotice('keep:duplicate-logins', 'warn', 'Несколько профилей /users используют один логин: ' + ambiguous.join('; ') + '. Владелец их настроек не изменялся. Удалите или переименуйте лишний профиль, чтобы вход и настройки работали однозначно.');
    }
    return Promise.all(profiles.map(function(profile) {
      if (!profile.login || !profile.uid) return Promise.resolve();
      if (uidsByLogin[String(profile.login).toLowerCase()].length > 1) return Promise.resolve();
      var ref = db.collection('titles').doc(profile.login);
      return db.runTransaction(function(tx) {
        return tx.get(ref).then(function(snap) {
          if (!currentAdmin()) return;
          // Missing roots are initialized by their owner during normal sign-in.
          if (!snap.exists || (snap.data() || {}).uid === profile.uid) return;
          // Update just the ownership field; preserve Notes, models and usage.
          tx.update(ref, { uid: profile.uid });
        });
      }).catch(function(err) {
        console.warn('Could not repair journal settings ownership:', profile.login, err);
      });
    }));
  }
  function tjLoadUserDirectory(authUser) {
    if (!authUser) return Promise.resolve(null);
    if (tjDirectory.uid === authUser.uid && tjDirectory.promise) return tjDirectory.promise;
    var fallback = function(reason) {
      // Sign-in must never be blocked by the profile read: build the profile from the
      // authenticated identity (ordinary-user rights; Firestore rules still decide access).
      if (reason) console.warn('User profile unavailable, using sign-in identity:', reason);
      var p = tjProfileFromAuth(authUser);
      tjAdminUid = null;
      USERS = [p];
      tjDirectory.promise = null; // retry on the next call
      return p;
    };
    tjDirectory.uid = authUser.uid;
    var promise = db.collection('users').doc(authUser.uid).get().then(function(snap) {
      if (!snap || !snap.exists) return fallback('no /users record');
      var own = tjCleanProfile(snap.data(), authUser.uid);
      own.uid = authUser.uid;
      if (!own.login) own.login = tjProfileFromAuth(authUser).login;
      if (!own.email) own.email = String(authUser.email || '').toLowerCase();
      if (own.role !== 'admin') { tjAdminUid = null; USERS = [own]; return own; }
      tjAdminUid = authUser.uid;
      return db.collection('users').get().then(function(all) {
        var list = [];
        all.forEach(function(d) { var p = tjCleanProfile(d.data(), d.id); if (p.login && p.uid) list.push(p); });
        if (!list.some(function(p) { return p.uid === own.uid; })) list.push(own);
        list.sort(function(a, b) { return (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.login.localeCompare(b.login, undefined, { numeric: true, sensitivity: 'base' }); });
        USERS = list;
        // Do not depend on opening Notes to repair settings after an Auth account
        // was recreated. Finish before the admin can switch to a student.
        return tjRepairSettingsOwners(authUser, list).then(function() { return own; });
      }).catch(function(err) { console.warn('Could not load the user list:', err); USERS = [own]; return own; });
    }).catch(fallback);
    tjDirectory.promise = promise;
    return promise;
  }
  function findUser(login) {
    var normalizedLogin = String(login || '').trim().toLowerCase();
    for (var i = 0; i < USERS.length; i++) {
      var profile = USERS[i];
      // Accept both the short profile name and its Firebase email. This keeps
      // old bookmarks/password-manager entries working after email mapping changes.
      if (String(profile.login || '').toLowerCase() === normalizedLogin ||
          String(profile.email || '').toLowerCase() === normalizedLogin) return profile;
    }
    return null;
  }
  function getAuthEmail(user) {
    return user.email || (String(user.login || '').toLowerCase() + '@journal.local');
  }
  var currentUser = null;
  var viewingUser = null;

  var trades = [];
  var tradingModels = [];
  var tradingModelsUser = null;
  var tradingModelsReady = false;
  var tradingModelsLoadError = false;
  var selectedTradeModelId = '';
  var selectedTradeModelName = '';
  var modelPanelRevision = 0;
  var modelPanelReturnFocus = null;
  var pendingModelDeletion = null;
  var modelDeleteRevision = 0;
  var assetFilter = 'ALL';
  var DEFAULT_ASSETS = [
    { name: 'EURUSD', color: '#a78bfa' },
    { name: 'GBPUSD', color: '#fbbf24' },
    { name: 'XAUUSD', color: '#22d3ee' },
    { name: 'GER40', color: '#f472b6' }
  ];
  var assetDefinitions = DEFAULT_ASSETS.map(function(a) { return { name: a.name, color: a.color }; });
  var deletedAssets = [];
  var activeTab = 'overview';
  var backtests = [];
  var backtestsLoadedFlag = false; /* true once local cache + server copy of the backtests were merged (used by Replay Space) */
  var backtestsLoadError = false;
  var activeBacktestId = null;
  var backtestTrades = [];
  var allBacktestTrades = [];
  var backtestModelFilterId = '', backtestModelFilterContext = '';
  var backtestCreationStep = null;
  var replayRangePick = null; // set by Replay Space: reuse the Backtest start→end calendar without creating a backtest
  var backtestDraftStart = null;
  var backtestTradeMode = false;
  var editingBacktestTradeId = null;
  var editingBacktestId = null;
  var pendingBacktestDeletion = null;
  var backtestWorkspaceMode = false;
  var previousJournalTab = 'overview';
  var backtestTransitionTimer = null;
  var backtestViewTransition = null;
  var TRADES_PAGE_SIZE = 20;
  var currentTradesPage = 1;
  var isLong = true;
  var isWin = true;
  var currentScreenshot = null;
  var monthlyYear = new Date().getFullYear();
  var monthlySelectedMonth = null;
  var weeklyYear = new Date().getFullYear();
  var weeklySelected = null; // { month, week } or null
  var calendarYear = new Date().getFullYear();
  var calendarMonth = new Date().getMonth();
  var calendarBrowse = { year: calendarYear, month: calendarMonth, level: 'days' };
  // Periods start on "today". A tab or the desktop app left open across midnight
  // into a new month/year follows the calendar, unless the user navigated away.
  var tjPeriodToday = { year: calendarYear, month: calendarMonth };
  function tjFollowTodayPeriods() {
    var now = new Date(), year = now.getFullYear(), month = now.getMonth();
    var was = tjPeriodToday;
    if (was.year === year && was.month === month) return false;
    tjPeriodToday = { year: year, month: month };
    var changed = false;
    if (was.year !== year) {
      if (monthlyYear === was.year && monthlySelectedMonth === null) { monthlyYear = year; changed = true; }
      if (weeklyYear === was.year && weeklySelected === null) { weeklyYear = year; changed = true; }
    }
    if (calendarYear === was.year && calendarMonth === was.month) {
      calendarYear = year; calendarMonth = month; changed = true;
      if (calendarBrowse.level === 'days' && calendarBrowse.year === was.year && calendarBrowse.month === was.month) {
        calendarBrowse.year = year; calendarBrowse.month = month;
      }
    }
    if (changed && currentUser && typeof render === 'function') render();
    return changed;
  }
  setInterval(tjFollowTodayPeriods, 60000);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) tjFollowTodayPeriods(); });
  window.addEventListener('focus', tjFollowTodayPeriods);
  var datetimePickerState = {
    target: null,
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    day: new Date().getDate(),
    hour: pad2(new Date().getHours()),
    minute: pad2(new Date().getMinutes()),
    dragPart: null,
    dragStartY: 0,
    dragStartValue: 0,
    dragTargetValue: 0,
    dragLastY: 0,
    dragMoved: false,
    suppressWheelClick: false,
    mouseDown: false,
    pendingSteps: 0,
    stepTimer: null,
    lastStepAt: 0,
    wheelLockUntil: { hour: 0, minute: 0 },
    wheelPending: { hour: 0, minute: 0 },
    wheelTimer: { hour: null, minute: null },
    wheelDelay: { hour: 190, minute: 190 },
    lastWheelAt: { hour: 0, minute: 0 },
    calendarAnimation: null,
    level: 'days',
    minDate: null,
    maxDate: null,
    title: null,
    dateOnly: false
  };
  var TIME_WHEEL_RANGE = 3;
  function timeWheelStep() { return window.innerWidth <= 520 ? 26 : 28; }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function pickerDayKey(year, month, day) { return year + '-' + pad2(month + 1) + '-' + pad2(day); }
  function currentLocalDateTimeKey() {
    var now = new Date();
    return pickerDayKey(now.getFullYear(), now.getMonth(), now.getDate()) + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  }
  function pickerDateTimeIsFuture() {
    if (datetimePickerState.dateOnly) return false;
    return buildDateTimeValue(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day, datetimePickerState.hour, datetimePickerState.minute) > currentLocalDateTimeKey();
  }
  function updateDateTimePickerApplyState() {
    var applyButton = document.getElementById('datetimePickerApplyBtn');
    if (!applyButton) return;
    var dayAllowed = pickerDayAllowed(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day);
    var futureTime = pickerDateTimeIsFuture();
    applyButton.disabled = datetimePickerState.level !== 'days' || !dayAllowed || futureTime;
    applyButton.title = futureTime ? 'Trade dates cannot be in the future.' : '';
  }
  function pickerDayAllowed(year, month, day) {
    var key = pickerDayKey(year, month, day);
    return (!datetimePickerState.minDate || key >= datetimePickerState.minDate) && (!datetimePickerState.maxDate || key <= datetimePickerState.maxDate);
  }

  function parseDateTimeValue(val) {
    if (!val) return null;
    var parts = String(val).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/);
    if (!parts) return null;
    return {
      year: parseInt(parts[1], 10),
      month: parseInt(parts[2], 10) - 1,
      day: parseInt(parts[3], 10),
      hour: parts[4],
      minute: parts[5]
    };
  }

  function formatDateTimeLabel(year, month, day, hour, minute) {
    return day + ' ' + EN_MONTHS_SHORT[month] + ' ' + year + ', ' + hour + ':' + minute;
  }

  function buildDateTimeValue(year, month, day, hour, minute) {
    return year + '-' + pad2(month + 1) + '-' + pad2(day) + 'T' + hour + ':' + minute;
  }

  function setDateTimeInput(input, value) {
    input.setAttribute('data-iso', value);
    var parsed = parseDateTimeValue(value);
    input.value = parsed ? formatDateTimeLabel(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute) : '';
  }

  function getDateTimeInputValue(input) {
    return input.getAttribute('data-iso') || input.value || '';
  }

  function syncPickerTime() {
    renderTimeWheel('hour');
    renderTimeWheel('minute');
    updateDateTimePickerApplyState();
  }

  function wheelValue(part) {
    return parseInt(part === 'hour' ? datetimePickerState.hour : datetimePickerState.minute, 10);
  }

  function setWheelValue(part, value) {
    var max = part === 'hour' ? 24 : 60;
    value = ((value % max) + max) % max;
    if (part === 'hour') datetimePickerState.hour = pad2(value);
    else datetimePickerState.minute = pad2(value);
  }

  function ensureTimeWheelSlots(track, part) {
    if (!track) return;
    if (track.getAttribute('data-wheel-ready') === '1') return;
    var html = '';
    for (var offset = -TIME_WHEEL_RANGE; offset <= TIME_WHEEL_RANGE; offset++) {
      html += '<button type="button" class="datetime-time-slot" data-wheel-part="' + part + '" data-wheel-offset="' + offset + '" aria-hidden="true"></button>';
    }
    track.innerHTML = html;
    track.setAttribute('data-wheel-ready', '1');
    track.addEventListener('click', function(e) {
      var slot = e.target && e.target.closest ? e.target.closest('.datetime-time-slot') : null;
      if (!slot || slot.parentNode !== track) return;
      e.preventDefault();
      e.stopPropagation();
      if (datetimePickerState.suppressWheelClick) {
        datetimePickerState.suppressWheelClick = false;
        return;
      }
      var raw = slot.getAttribute('data-wheel-value');
      if (raw === null || raw === '') return;
       var previous = wheelValue(part);
       var next = parseInt(raw, 10);
       setWheelValue(part, next);
       renderTimeWheel(part);
       triggerWheelAnimation(part, next === previous ? 0 : 1);
    });
  }

  function renderTimeWheel(part) {
    var track = document.getElementById(part === 'hour' ? 'datetimeHourTrack' : 'datetimeMinuteTrack');
    if (!track) return;
    ensureTimeWheelSlots(track, part);
    var value = wheelValue(part);
    var max = part === 'hour' ? 24 : 60;
    var slots = track.querySelectorAll('.datetime-time-slot');
    var step = timeWheelStep();
    Array.prototype.forEach.call(slots, function(slot) {
      var offset = parseInt(slot.getAttribute('data-wheel-offset'), 10);
      var item = (value + offset + max) % max;
      var distance = Math.abs(offset);
      var opacity = distance === 0 ? 1 : (distance === 1 ? 0.74 : (distance === 2 ? 0.42 : 0.18));
      var scale = distance === 0 ? 1 : (distance === 1 ? 0.95 : (distance === 2 ? 0.86 : 0.76));
      slot.setAttribute('data-wheel-value', item);
      slot.textContent = pad2(item);
      slot.classList.toggle('is-active', offset === 0);
      slot.style.transform = 'translate3d(0,' + (offset * step) + 'px,0) scale(' + scale + ')';
      slot.style.opacity = String(opacity);
      slot.style.zIndex = String(20 - distance);
    });
    updateDateTimePickerApplyState();
  }

  function triggerWheelAnimation(part, dir) {
    var el = document.getElementById(part === 'hour' ? 'datetimeHourWheel' : 'datetimeMinuteWheel');
    if (!el) return;
    el.classList.remove('is-step-change', 'is-step-up', 'is-step-down');
    void el.offsetWidth;
    el.classList.add('is-step-change');
    if (dir > 0) el.classList.add('is-step-up');
    else if (dir < 0) el.classList.add('is-step-down');
  }

  function scheduleWheelSteps(part) {
    if (datetimePickerState.wheelTimer[part] !== null) return;
    var tick = function() {
      datetimePickerState.wheelTimer[part] = null;
      if (!datetimePickerState.target || !datetimePickerState.wheelPending[part]) return;
      var pending = datetimePickerState.wheelPending[part];
      var direction = pending > 0 ? 1 : -1;
      datetimePickerState.wheelPending[part] -= direction;
      setWheelValue(part, wheelValue(part) + direction);
      renderTimeWheel(part);
      triggerWheelAnimation(part, direction);
      if (datetimePickerState.wheelPending[part]) {
        datetimePickerState.wheelTimer[part] = setTimeout(tick, datetimePickerState.wheelDelay[part]);
      }
    };
    datetimePickerState.wheelTimer[part] = setTimeout(tick, 0);
  }

  // One wheel event means one time step. Rapid wheel input is queued rather
  // than dropped, and the queue is drained faster when the input arrives
  // faster, while keeping a smooth, bounded animation between values.
  function handleTimeWheel(part, deltaY) {
    if (!datetimePickerState.target || !deltaY) return;
    var now = Date.now();
    var direction = deltaY > 0 ? 1 : -1;
    var magnitude = Math.abs(deltaY);
    var sinceLast = datetimePickerState.lastWheelAt[part] ? now - datetimePickerState.lastWheelAt[part] : 999;
    // Small, deliberate turns remain slow; larger/faster bursts are drained
    // sooner. The limits prevent either a sluggish response or a jumpy one.
    var baseDelay = 218 - Math.min(86, magnitude * 0.55);
    if (sinceLast < 85) baseDelay -= Math.min(62, (85 - sinceLast) * 0.72);
    datetimePickerState.wheelDelay[part] = Math.max(70, Math.min(218, Math.round(baseDelay)));
    datetimePickerState.lastWheelAt[part] = now;
    var nextPending = datetimePickerState.wheelPending[part] + direction;
    datetimePickerState.wheelPending[part] = Math.max(-12, Math.min(12, nextPending));
    scheduleWheelSteps(part);
  }

  // Apply drag input at a human-readable pace. Pointer events can arrive much
  // faster than the eye can follow; queueing steps also prevents a single fast
  // mouse movement from jumping through the whole clock instantly.
  function scheduleTimeWheelSteps(part) {
    if (datetimePickerState.stepTimer) return;
    var tick = function() {
      datetimePickerState.stepTimer = null;
      if (datetimePickerState.dragPart !== part || !datetimePickerState.pendingSteps) return;
      var dir = datetimePickerState.pendingSteps > 0 ? 1 : -1;
      datetimePickerState.pendingSteps -= dir;
      setWheelValue(part, wheelValue(part) + dir);
      renderTimeWheel(part);
      var el = document.getElementById(part === 'hour' ? 'datetimeHourWheel' : 'datetimeMinuteWheel');
      triggerWheelAnimation(part, dir);
      if (datetimePickerState.pendingSteps) {
        datetimePickerState.stepTimer = setTimeout(tick, 145);
      }
    };
    datetimePickerState.stepTimer = setTimeout(tick, Math.max(0, 145 - (Date.now() - datetimePickerState.lastStepAt)));
  }

  function beginTimeDrag(part, clientY) {
    if (datetimePickerState.stepTimer) { clearTimeout(datetimePickerState.stepTimer); datetimePickerState.stepTimer = null; }
    datetimePickerState.pendingSteps = 0;
    datetimePickerState.suppressWheelClick = false;
    datetimePickerState.dragPart = part;
    datetimePickerState.dragStartY = clientY;
    datetimePickerState.dragLastY = clientY;
    datetimePickerState.dragStartValue = wheelValue(part);
    datetimePickerState.dragTargetValue = wheelValue(part);
    datetimePickerState.dragMoved = false;
    datetimePickerState.mouseDown = true;
    var el = document.getElementById(part === 'hour' ? 'datetimeHourWheel' : 'datetimeMinuteWheel');
    if (el) el.classList.add('is-dragging');
  }

  function updateTimeDrag(clientY) {
    if (!datetimePickerState.dragPart) return;
    // A missed mouseup must never turn subsequent cursor movement into time
    // changes. The browser exposes the physical button state on mousemove.
    if (datetimePickerState.mouseDown === false) {
      endTimeDrag();
      return;
    }
    var diff = datetimePickerState.dragStartY - clientY;
    var stepPx = timeWheelStep();
    var steps = diff > 0 ? Math.floor(diff / stepPx) : Math.ceil(diff / stepPx);
    if (!steps) return;
    datetimePickerState.dragMoved = true;
    var max = datetimePickerState.dragPart === 'hour' ? 24 : 60;
    var next = ((datetimePickerState.dragStartValue + steps) % max + max) % max;
    if (next === datetimePickerState.dragTargetValue) return;
    var direction = next > datetimePickerState.dragTargetValue ? 1 : -1;
    datetimePickerState.dragTargetValue = next;
    // The pointer position is the single source of truth. Do not queue or
    // replay extra steps after release.
    setWheelValue(datetimePickerState.dragPart, next);
    renderTimeWheel(datetimePickerState.dragPart);
    triggerWheelAnimation(datetimePickerState.dragPart, direction);
  }

  function endTimeDrag() {
    var part = datetimePickerState.dragPart;
    if (part) {
      // Value is already committed from the pointer position. Only cancel any
      // stale timer left by an earlier interaction.
      setWheelValue(part, datetimePickerState.dragTargetValue);
      renderTimeWheel(part);
      if (datetimePickerState.dragMoved) datetimePickerState.suppressWheelClick = true;
    }
    if (part) {
      var el = document.getElementById(part === 'hour' ? 'datetimeHourWheel' : 'datetimeMinuteWheel');
      if (el) el.classList.remove('is-dragging');
    }
    datetimePickerState.pendingSteps = 0;
    if (datetimePickerState.stepTimer) { clearTimeout(datetimePickerState.stepTimer); datetimePickerState.stepTimer = null; }
    datetimePickerState.dragPart = null;
    datetimePickerState.mouseDown = false;
    if (datetimePickerState.suppressWheelClick) {
      setTimeout(function() { datetimePickerState.suppressWheelClick = false; }, 300);
    }
  }

  function renderDateTimePicker() {
    var grid = document.getElementById('datetimePickerGrid');
    var label = document.getElementById('dtMonthLabel');
    var title = document.getElementById('datetimePickerTitle');
    var calendarAnimation = datetimePickerState.calendarAnimation;
    datetimePickerState.calendarAnimation = null;
    var nav = window.TJCalendarNav;
    nav.header(datetimePickerState, label, document.getElementById('dtPrevMonthBtn'), document.getElementById('dtNextMonthBtn'), datetimePickerState.minDate, datetimePickerState.maxDate);
    document.getElementById('datetimePickerWeekdays').hidden = datetimePickerState.level !== 'days';
    if (nav.render(datetimePickerState, grid, datetimePickerState.minDate, datetimePickerState.maxDate, function() {
      datetimePickerState.calendarAnimation = 'zoom'; renderDateTimePicker();
    })) {
      title.textContent = datetimePickerState.title || 'Select date and time';
      grid.classList.remove('is-month-transition');
      if (calendarAnimation) nav.animate(grid);
      syncPickerTime(); return;
    }
    grid.classList.remove('calendar-zoom-enter');
    var first = new Date(datetimePickerState.year, datetimePickerState.month, 1);
    var daysInMonth = new Date(datetimePickerState.year, datetimePickerState.month + 1, 0).getDate();
    var firstDow = first.getDay();
    var leadBlanks = (firstDow + 6) % 7;
    label.textContent = EN_MONTHS_FULL[datetimePickerState.month] + ' ' + datetimePickerState.year;
    title.textContent = datetimePickerState.title || 'Select date and time';
    var html = '';
    for (var i = 0; i < leadBlanks; i++) html += '<button type="button" class="datetime-picker-day is-muted" disabled></button>';
    for (var day = 1; day <= daysInMonth; day++) {
      var active = day === datetimePickerState.day ? ' is-active' : '';
      var allowed = pickerDayAllowed(datetimePickerState.year, datetimePickerState.month, day);
      html += '<button type="button" class="datetime-picker-day' + active + (allowed ? '' : ' is-muted') + '" data-day="' + day + '"' + (allowed ? '' : ' disabled') + '>' + day + '</button>';
    }
    for (var tail = leadBlanks + daysInMonth; tail < 42; tail++) {
      html += '<button type="button" class="datetime-picker-day is-muted" disabled></button>';
    }
    grid.innerHTML = html;
    grid.classList.remove('is-month-transition');
    if (calendarAnimation === 'month') {
      void grid.offsetWidth;
      grid.classList.add('is-month-transition');
    }
    if (calendarAnimation === 'zoom') nav.animate(grid);
    if (calendarAnimation === 'day') {
      var todayButton = grid.querySelector('.datetime-picker-day.is-active');
      if (todayButton) todayButton.classList.add('is-today-selection');
    }
    Array.prototype.forEach.call(grid.querySelectorAll('.datetime-picker-day[data-day]'), function(btn) {
      btn.addEventListener('click', function() {
        if (!pickerDayAllowed(datetimePickerState.year, datetimePickerState.month, parseInt(btn.getAttribute('data-day'), 10))) return;
        datetimePickerState.day = parseInt(btn.getAttribute('data-day'), 10);
        renderDateTimePicker();
      });
    });
    syncPickerTime();
  }

  function openDateTimePicker(input) {
    var parsed = parseDateTimeValue(getDateTimeInputValue(input));
    var now = new Date();
    datetimePickerState.target = input;
    datetimePickerState.level = 'days';
    datetimePickerState.year = parsed ? parsed.year : now.getFullYear();
    datetimePickerState.month = parsed ? parsed.month : now.getMonth();
    datetimePickerState.day = parsed ? parsed.day : now.getDate();
    datetimePickerState.hour = parsed ? parsed.hour : pad2(now.getHours());
    datetimePickerState.minute = parsed ? parsed.minute : pad2(now.getMinutes());
    datetimePickerState.minDate = null;
    datetimePickerState.maxDate = pickerDayKey(now.getFullYear(), now.getMonth(), now.getDate());
    datetimePickerState.title = null;
    datetimePickerState.dateOnly = false;
    if (backtestCreationStep === 'start') { datetimePickerState.title = 'Backtest start date'; datetimePickerState.dateOnly = true; }
    if (backtestCreationStep === 'end') { datetimePickerState.title = 'Backtest end date'; datetimePickerState.minDate = backtestDraftStart ? backtestDraftStart.slice(0, 10) : null; datetimePickerState.dateOnly = true; }
    if (backtestTradeMode && activeBacktestId) {
      var range = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
      if (range) {
        datetimePickerState.minDate = range.startDate.slice(0, 10);
        datetimePickerState.maxDate = range.endDate.slice(0, 10) < datetimePickerState.maxDate ? range.endDate.slice(0, 10) : datetimePickerState.maxDate;
        datetimePickerState.title = 'Backtest trade date';
      }
    }
    if (!pickerDayAllowed(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day)) {
      var fallback = datetimePickerState.minDate || datetimePickerState.maxDate || pickerDayKey(now.getFullYear(), now.getMonth(), now.getDate());
      var fp = fallback.split('-'); datetimePickerState.year = +fp[0]; datetimePickerState.month = +fp[1] - 1; datetimePickerState.day = +fp[2];
    }
    datetimePickerState.wheelLockUntil.hour = 0;
    datetimePickerState.wheelLockUntil.minute = 0;
    datetimePickerState.wheelPending.hour = 0;
    datetimePickerState.wheelPending.minute = 0;
    datetimePickerState.lastWheelAt.hour = 0;
    datetimePickerState.lastWheelAt.minute = 0;
    if (input && input.closest && input.closest('.inline-edit-popup')) document.body.classList.add('inline-datetime-open');
    renderDateTimePicker();
    document.querySelector('#datetimePickerOverlay .datetime-picker-box').classList.toggle('date-only', datetimePickerState.dateOnly);
    document.body.classList.add('datetime-picker-open');
    document.documentElement.classList.add('datetime-picker-open');
    document.getElementById('datetimePickerOverlay').classList.add('open');
  }

  function closeDateTimePicker() {
    if (replayRangePick) { replayRangePick = null; backtestCreationStep = null; backtestDraftStart = null; }
    document.getElementById('datetimePickerOverlay').classList.remove('open');
    document.body.classList.remove('datetime-picker-open');
    document.body.classList.remove('inline-datetime-open');
    document.documentElement.classList.remove('datetime-picker-open');
    datetimePickerState.target = null;
    datetimePickerState.minDate = null; datetimePickerState.maxDate = null; datetimePickerState.title = null; datetimePickerState.dateOnly = false;
    datetimePickerState.wheelLockUntil.hour = 0;
    datetimePickerState.wheelLockUntil.minute = 0;
    datetimePickerState.wheelPending.hour = 0;
    datetimePickerState.wheelPending.minute = 0;
    ['hour', 'minute'].forEach(function(part) {
      if (datetimePickerState.wheelTimer[part] !== null) {
        clearTimeout(datetimePickerState.wheelTimer[part]);
        datetimePickerState.wheelTimer[part] = null;
      }
    });
  }

  // Models live in the existing per-user settings document, not in trade records.
  // Each map entry is merged independently so concurrent additions do not overwrite each other.
  // Trading models store only a Notes share token. When the journal is opened from
  // another device/hosting alias, rebuild the link against the CURRENT journal origin.
  // This avoids stale localhost/alternate-host links and is especially important on iOS.
  function currentJournalNotesUrl(token, fallbackUrl) {
    if (!token || !/^[A-Za-z0-9]{16,64}$/.test(token)) return null;
    if (/^https?:$/.test(location.protocol)) {
      return location.origin + location.pathname + '?note=' + encodeURIComponent(token);
    }
    return fallbackUrl || null;
  }

  function parseNotesShareUrl(value, strict) {
    try {
      var raw = String(value || '').trim();
      if (!raw || /\s/.test(raw)) return null;
      var url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.username || url.password) return null;
      var token = new URLSearchParams(url.search).get('note');
      if (!token || !/^[A-Za-z0-9]{16,64}$/.test(token)) return null;
      var clean = url.origin + url.pathname + '?note=' + encodeURIComponent(token);
      // While adding a model, accept a valid Notes share token even if Safari opened
      // the journal through another Firebase/custom-domain alias; store a local URL.
      return strict ? currentJournalNotesUrl(token, clean) : clean;
    } catch (e) { return null; }
  }

  function canonicalTradeModelUrl(value) {
    var parsed = parseNotesShareUrl(value, false);
    if (!parsed) return null;
    try {
      var token = new URLSearchParams(new URL(parsed).search).get('note');
      return currentJournalNotesUrl(token, parsed);
    } catch (e) { return null; }
  }

  function normalizeTradingModels(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
    return Object.keys(records).map(function(id) {
      var model = records[id];
      if (!model || typeof model.name !== 'string') return null;
      var name = model.name.trim(), url = parseNotesShareUrl(model.notesShareUrl);
      return name && Array.from(name).length <= 10 && url ? { id: id, name: name, notesShareUrl: url } : null;
    }).filter(Boolean);
  }

  function findTradingModel(id) {
    if (tradingModelsUser !== viewingUser) return null;
    return tradingModels.filter(function(model) { return model.id === id; })[0] || null;
  }

  function tradeModelHTML(trade, editing) {
    if (!trade) return '<span class="trade-model-empty">—</span>';
    var model = findTradingModel(trade.modelId);
    var name = model ? model.name : 'Без модели';
    if (editing) return '<button type="button" class="trade-model-badge trade-model-edit" aria-haspopup="dialog" aria-label="Изменить модель: ' + escapeHtml(name).replace(/"/g, '&quot;') + '">' + (model ? escapeHtml(name) : '—') + '</button>';
    if (!trade.modelId) return '<span class="trade-model-empty">—</span>';
    var url = model && canonicalTradeModelUrl(model.notesShareUrl);
    if (!url) return '<span class="trade-model-empty">—</span>';
    // Escape attribute delimiters as well as text; never trust persisted URLs for rendering.
    return '<a class="trade-model-link" data-model-id="' + escapeHtml(model.id).replace(/"/g, '&quot;') + '" href="' + escapeHtml(url).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer" title="Открыть общую заметку (новая вкладка)">' + escapeHtml(name) + '</a>';
  }

  function useSameTabTradeModelLinks() {
    var ua = navigator.userAgent || '';
    var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return iOS || document.body.classList.contains('mobile-mode');
  }

  // iOS Safari can swallow target=_blank taps inside scrollable/table UI.
  // On mobile, navigate in the current tab from the original trusted tap instead.
  document.addEventListener('click', function(e) {
    if (!useSameTabTradeModelLinks() || !e.target || !e.target.closest) return;
    var link = e.target.closest('a.trade-model-link');
    if (!link) return;
    // If the Model column is explicitly in edit mode, let the table's editor
    // handle the tap instead of navigating away to the linked Notes page.
    if (typeof activeEditCol !== 'undefined' && activeEditCol === 'model' && link.closest('td[data-col="model"]')) return;
    var url = canonicalTradeModelUrl(link.getAttribute('href'));
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(url);
  }, true);

  function applyTradeModel(trade, id) {
    var model = findTradingModel(id);
    if (model) { trade.modelId = model.id; trade.modelName = model.name; }
    else if (!id) { delete trade.modelId; delete trade.modelName; }
    // Preserve an existing unresolved reference when editing unrelated trade fields.
  }

  function tradeModelChoices() {
    return [{ id: '', name: 'Без модели' }].concat(tradingModelsReady && tradingModelsUser === viewingUser ? tradingModels : []);
  }

  function clearTradeModelReferences(records, ids) {
    records.forEach(function(trade) {
      if (ids.indexOf(trade.modelId) >= 0) { delete trade.modelId; delete trade.modelName; }
    });
  }

  // Field-level updates preserve every other trade property, including screenshots.
  // Ask the server only for this user's trades that reference the removed models
  // (equality + `in`, no composite index); never download the whole journal.
  var TJ_MODEL_IN_CHUNK = 10;
  function purgeTradeModelReferences(user, ids) {
    var owner = findUser(user);
    if (!owner) return Promise.reject(new Error('Unknown model owner'));
    ids = ids.filter(function(id, i) { return typeof id === 'string' && id && ids.indexOf(id) === i; });
    if (!ids.length) return Promise.resolve();
    var lookups = [];
    ['trades', 'backtestTrades'].forEach(function(collection) {
      for (var i = 0; i < ids.length; i += TJ_MODEL_IN_CHUNK) {
        (function(chunk) {
          lookups.push(db.collection(collection).where('uid', '==', owner.uid).where('modelId', 'in', chunk).get({ source: 'server' }).then(function(snapshot) {
            var refs = [];
            snapshot.forEach(function(doc) { refs.push(db.collection(collection).doc(doc.id)); });
            return refs;
          }));
        })(ids.slice(i, i + TJ_MODEL_IN_CHUNK));
      }
    });
    return Promise.all(lookups).then(function(results) {
      var refs = [].concat.apply([], results), chain = Promise.resolve();
      for (var i = 0; i < refs.length; i += 400) {
        (function(chunk) {
          chain = chain.then(function() {
            var batch = db.batch();
            chunk.forEach(function(ref) {
              batch.update(ref, { modelId: firebase.firestore.FieldValue.delete(), modelName: firebase.firestore.FieldValue.delete() });
            });
            return batch.commit();
          });
        })(refs.slice(i, i + 400));
      }
      return chain;
    }).then(function() {
      // The server is already clean. Local caches are best effort: a damaged cache
      // is dropped instead of turning a successful deletion into an error.
      ['syter_backtest_trades_v1_' + user, 'tj_trades_v3_' + user].forEach(function(key) {
        try {
          var raw = localStorage.getItem(key);
          if (!raw) return;
          var records = JSON.parse(raw);
          if (!Array.isArray(records)) return;
          clearTradeModelReferences(records, ids);
          localStorage.setItem(key, JSON.stringify(records));
        } catch (err) {
          console.warn('Dropping unreadable local cache after model cleanup:', key, err);
          try { localStorage.removeItem(key); } catch (e) {}
        }
      });
      if (!window.indexedDB) return;
      return openDB().then(function(database) {
        return new Promise(function(resolve, reject) {
          var tx = database.transaction(IDB_STORE, 'readwrite');
          var request = tx.objectStore(IDB_STORE).index('user').openCursor(IDBKeyRange.only(user));
          request.onsuccess = function() {
            var cursor = request.result;
            if (!cursor) return;
            var trade = cursor.value;
            if (ids.indexOf(trade.modelId) >= 0) { clearTradeModelReferences([trade], ids); cursor.update(trade); }
            cursor.continue();
          };
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = function() { reject(tx.error || new Error('Local model cleanup failed')); };
        });
      }).catch(function(err) { console.warn('Local model cleanup skipped:', err); });
    }).then(function() {
      if (viewingUser !== user) return;
      clearTradeModelReferences(trades.concat(allBacktestTrades, backtestTrades), ids);
    });
  }

  function closeTradeModelMenu() {
    document.getElementById('tradeModelControl').classList.remove('open');
    document.getElementById('tradeModelTrigger').setAttribute('aria-expanded', 'false');
  }

  function renderTradeModelControl() {
    var ready = tradingModelsReady && tradingModelsUser === viewingUser;
    var models = ready ? tradingModels : [];
    var hasChoices = models.length > 0;
    document.getElementById('tradeModelRow').style.display = hasChoices ? 'flex' : 'none';
    document.getElementById('tradeModelControl').style.display = hasChoices ? 'block' : 'none';
    var cta = document.getElementById('tradeModelCTA');
    cta.style.display = hasChoices ? 'none' : 'flex';
    cta.disabled = !ready&&!tradingModelsLoadError;
    cta.textContent = ready ? 'Добавьте свои торговые модели' : (tradingModelsLoadError?'Не удалось загрузить модели · Повторить':'Загрузка моделей…');
    var add = document.getElementById('tradeModelAddBtn');
    add.style.display = hasChoices ? 'inline-flex' : 'none';
    add.disabled = !ready;
    var selected = findTradingModel(selectedTradeModelId);
    document.getElementById('tradeModelValue').textContent = selected ? selected.name : 'Без модели';
    var menu = document.getElementById('tradeModelMenu');
    menu.replaceChildren();
    var choices = tradeModelChoices();
    choices.forEach(function(model) {
      var row = document.createElement('div');
      row.className = 'trade-model-option-row';
      row.setAttribute('role', 'none');
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'trade-asset-option' + (model.id === selectedTradeModelId ? ' active' : '');
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(model.id === selectedTradeModelId));
      option.textContent = model.name;
      option.addEventListener('click', function() {
        selectedTradeModelId = model.id;
        selectedTradeModelName = model.id ? model.name : '';
        renderTradeModelControl();
        closeTradeModelMenu();
        document.getElementById('tradeModelTrigger').focus();
      });
      row.appendChild(option);
      if (model.id) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'trade-model-remove';
        remove.setAttribute('role', 'menuitem');
        remove.setAttribute('aria-label', 'Удалить модель «' + model.name + '»');
        remove.title = 'Удалить модель «' + model.name + '»';
        remove.textContent = '×';
        remove.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          openModelDeletePanel(model.id);
        });
        row.appendChild(remove);
      }
      menu.appendChild(row);
    });
    renderBacktestModelControl();
    var activeBt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    var modelOwner = findUser(viewingUser);
    if (ready && activeBt && modelOwner && activeBt.uid === modelOwner.uid) renderBacktests();
  }

  function showModelError(message, input) {
    var error = document.getElementById('modelCreateError');
    error.textContent = message;
    error.style.display = message ? 'block' : 'none';
    ['modelNameInput', 'modelUrlInput'].forEach(function(id) {
      document.getElementById(id).setAttribute('aria-invalid', String(!!input && input.id === id));
    });
    if (input) input.focus();
  }

  function setTradeModalSuspended(suspended) {
    var overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    overlay.classList.toggle('nested-modal-suspended', !!suspended);
    if (suspended) overlay.setAttribute('aria-hidden', 'true');
    else overlay.removeAttribute('aria-hidden');
  }

  function openModelCreatePanel() {
    if (!tradingModelsReady || tradingModelsUser !== viewingUser) return;
    modelPanelRevision++;
    modelPanelReturnFocus = document.activeElement;
    closeTradeModelMenu();
    document.getElementById('modelCreateForm').reset();
    document.getElementById('modelCreateSubmit').disabled = false;
    showModelError('');
    setTradeModalSuspended(true);
    document.getElementById('modelCreateOverlay').classList.add('open');
    document.getElementById('modelNameInput').focus();
  }

  function closeModelCreatePanel() {
    modelPanelRevision++;
    document.getElementById('modelCreateOverlay').classList.remove('open');
    setTradeModalSuspended(false);
    if (modelPanelReturnFocus && modelPanelReturnFocus.isConnected) modelPanelReturnFocus.focus();
    modelPanelReturnFocus = null;
  }

  function openModelDeletePanel(id) {
    var model = findTradingModel(id);
    if (!model || !tradingModelsReady) return;
    modelDeleteRevision++;
    pendingModelDeletion = { id: model.id, user: viewingUser };
    closeTradeModelMenu();
    document.getElementById('modelDeleteName').textContent = model.name;
    document.getElementById('modelDeleteError').style.display = 'none';
    document.getElementById('modelDeleteConfirm').disabled = false;
    setTradeModalSuspended(true);
    document.getElementById('modelDeleteOverlay').classList.add('open');
    document.getElementById('modelDeleteCancel').focus();
  }

  function closeModelDeletePanel() {
    var wasOpen = document.getElementById('modelDeleteOverlay').classList.contains('open');
    modelDeleteRevision++;
    pendingModelDeletion = null;
    document.getElementById('modelDeleteOverlay').classList.remove('open');
    setTradeModalSuspended(false);
    if (wasOpen) document.getElementById(tradingModels.length ? 'tradeModelTrigger' : 'tradeModelCTA').focus();
  }

  document.getElementById('modelDeleteCancel').addEventListener('click', closeModelDeletePanel);
  document.getElementById('modelDeleteOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeModelDeletePanel();
  });
  document.getElementById('modelDeleteConfirm').addEventListener('click', function() {
    var pending = pendingModelDeletion, revision = modelDeleteRevision, button = this;
    if (button.disabled || !pending || pending.user !== viewingUser || !tradingModelsReady || !findTradingModel(pending.id)) return;
    button.disabled = true;
    var entry = {}; entry[pending.id] = firebase.firestore.FieldValue.delete();
    // Keep the model available for retry until all reference cleanup succeeds.
    purgeTradeModelReferences(pending.user, [pending.id]).then(function() {
      return db.collection('titles').doc(pending.user).set({ tradingModels: entry }, { merge: true });
    }).then(function() {
      if (viewingUser !== pending.user || tradingModelsUser !== pending.user) return;
      tradingModels = tradingModels.filter(function(model) { return model.id !== pending.id; });
      if (selectedTradeModelId === pending.id) {
        selectedTradeModelId = '';
        selectedTradeModelName = '';
      }
      closeInlineEditPopup();
      renderTradeModelControl();
      render();
      // Refresh already-rendered hidden tables and open detail panels as well.
      // Replace stale links in hidden tables and open detail panels too.
      Array.prototype.forEach.call(document.querySelectorAll('a.trade-model-link'), function(link) {
        if (link.getAttribute('data-model-id') !== pending.id) return;
        var label = document.createElement('span');
        label.className = 'trade-model-empty';
        label.textContent = '—';
        link.replaceWith(label);
      });
      if (revision === modelDeleteRevision) closeModelDeletePanel();
    }).catch(function(err) {
      console.error('Could not delete trading model:', err);
      if (viewingUser !== pending.user || revision !== modelDeleteRevision) return;
      var error = document.getElementById('modelDeleteError');
      error.textContent = 'Не удалось удалить модель. Проверьте соединение и попробуйте снова.';
      error.style.display = 'block';
    }).then(function() {
      if (revision === modelDeleteRevision) button.disabled = false;
    });
  });
  document.addEventListener('keydown', function(e) {
    var panel = document.getElementById('modelDeleteOverlay');
    if (!panel.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeModelDeletePanel(); return; }
    if (e.key !== 'Tab') return;
    var buttons = panel.querySelectorAll('button:not(:disabled)'), first = buttons[0], last = buttons[buttons.length - 1];
    if (!panel.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  function readTradingModelsDocument(user, load) {
    // A merge for usage/notes can leave a partial local cache. Only a server
    // snapshot may establish that the model catalogue is actually empty.
    return db.collection('titles').doc(user).get({source:'server'}).then(function(doc){
      if(doc.metadata&&(doc.metadata.fromCache||doc.metadata.hasPendingWrites))throw new Error('Model catalogue is not confirmed by the server');
      if(viewingUser===user && (!load || tjLoadIsCurrent(load))){
        tradingModels=normalizeTradingModels(doc.exists?doc.data().tradingModels:null);
        tradingModelsUser=user;tradingModelsReady=true;tradingModelsLoadError=false;renderTradeModelControl();
      }
      return doc;
    });
  }
  function retryTradingModels() {
    var user=viewingUser;tradingModelsLoadError=false;renderTradeModelControl();
    return readTradingModelsDocument(user).catch(function(err){
      if(viewingUser===user){tradingModelsLoadError=true;renderTradeModelControl();}
      console.warn('Could not reload trading models:',err);
    });
  }
  document.getElementById('tradeModelCTA').addEventListener('click',function(){
    if(tradingModelsLoadError&&!tradingModelsReady){retryTradingModels();return;}
    openModelCreatePanel();
  });
  document.getElementById('tradeModelAddBtn').addEventListener('click', openModelCreatePanel);
  document.getElementById('modelCreateClose').addEventListener('click', closeModelCreatePanel);
  document.getElementById('modelCreateOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeModelCreatePanel();
  });
  document.getElementById('modelCreateForm').addEventListener('input', function() { showModelError(''); });
  document.getElementById('modelCreateForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var button = document.getElementById('modelCreateSubmit');
    if (button.disabled) return;
    var nameInput = document.getElementById('modelNameInput'), urlInput = document.getElementById('modelUrlInput');
    var name = nameInput.value.trim(), url = parseNotesShareUrl(urlInput.value, true);
    if (!name || Array.from(name).length > 10) { showModelError('Введите название: от 1 до 10 символов.', nameInput); return; }
    if (!url) { showModelError('Нужна ссылка на общую заметку из Notes этого журнала (вида …/?note=ТОКЕН).', urlInput); return; }
    var user = viewingUser, owner = findUser(user), revision = modelPanelRevision;
    if (!owner || !tradingModelsReady || tradingModelsUser !== user) { showModelError('Обновите страницу и попробуйте снова.'); return; }
    var id = db.collection('titles').doc().id;
    var model = { id: id, name: name, notesShareUrl: url };
    var entry = {}; entry[id] = model;
    button.disabled = true;
    db.collection('titles').doc(user).set({ uid: owner.uid, tradingModels: entry }, { merge: true }).then(function() {
      if (viewingUser !== user || tradingModelsUser !== user) return;
      tradingModels = tradingModels.filter(function(m) { return m.id !== id; }).concat([model]);
      var samePanel = revision === modelPanelRevision;
      if (samePanel) {
        selectedTradeModelId = id;
        selectedTradeModelName = name;
        closeModelCreatePanel();
      }
      renderTradeModelControl();
      if (samePanel && document.getElementById('modalOverlay').classList.contains('open')) document.getElementById('tradeModelTrigger').focus();
    }).catch(function(err) {
      console.error('Could not save trading model:', err);
      if (viewingUser === user && revision === modelPanelRevision) showModelError('Не удалось сохранить модель. Проверьте соединение и попробуйте снова.');
    }).then(function() {
      if (revision === modelPanelRevision) button.disabled = false;
    });
  });
  document.getElementById('tradeModelTrigger').addEventListener('click', function() {
    var open = document.getElementById('tradeModelControl').classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
    if (open) (document.querySelector('#tradeModelMenu .active') || document.querySelector('#tradeModelMenu button')).focus({ preventScroll: true });
  });
  document.getElementById('tradeModelControl').addEventListener('keydown', function(e) {
    var options = Array.prototype.slice.call(document.querySelectorAll('#tradeModelMenu button'));
    if (e.key === 'Escape') { e.preventDefault(); closeTradeModelMenu(); document.getElementById('tradeModelTrigger').focus(); }
    // Keep each row's delete action reachable by keyboard; close when focus leaves.
    if (e.key === 'Tab') return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) < 0 || !options.length) return;
    e.preventDefault();
    document.getElementById('tradeModelControl').classList.add('open');
    document.getElementById('tradeModelTrigger').setAttribute('aria-expanded', 'true');
    var index = options.indexOf(document.activeElement);
    index = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index].focus();
  });
  document.getElementById('tradeModelControl').addEventListener('focusout', function(e) {
    if (!this.contains(e.relatedTarget)) closeTradeModelMenu();
  });
  document.addEventListener('click', function(e) {
    if (!document.getElementById('tradeModelControl').contains(e.target)) closeTradeModelMenu();
  });
  document.addEventListener('keydown', function(e) {
    var panel = document.getElementById('modelCreateOverlay');
    if (!panel.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeModelCreatePanel(); }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(panel.querySelectorAll('button:not(:disabled), input'));
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (!panel.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  function storageKey() { return 'tj_trades_v3_' + viewingUser; }
  function titleKey() { return 'tj_title_v3_' + viewingUser; }

  // ---- IndexedDB storage (much higher quota than localStorage, so screenshots don't hit a ceiling) ----
  var IDB_NAME = 'tj_db_v1';
  var IDB_STORE = 'trades';
  var idbPromise = null;

  function openDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function(resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexeddb')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          var store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          store.createIndex('user', 'user', { unique: false });
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { reject(req.error); };
    });
    return idbPromise;
  }

  function idbGetAllForUser(user) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var idx = tx.objectStore(IDB_STORE).index('user');
        var req = idx.getAll(IDBKeyRange.only(user));
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  // One-time migration: pull any trades saved under the old localStorage scheme into IndexedDB.
  function migrateFromLocalStorage(user) {
    var key = 'tj_trades_v3_' + user;
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (!raw) return Promise.resolve();
    var oldTrades;
    try { oldTrades = JSON.parse(raw); } catch (e) { oldTrades = null; }
    if (!oldTrades || !oldTrades.length) {
      try { localStorage.removeItem(key); } catch (e) {}
      return Promise.resolve();
    }
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        oldTrades.forEach(function(t) { t.user = user; store.put(t); });
        tx.oncomplete = function() {
          try { localStorage.removeItem(key); } catch (e) {}
          resolve();
        };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function showOverviewSkeleton() {
    var skel = document.getElementById('overviewSkeleton');
    var real = document.getElementById('overviewReal');
    if (skel) skel.style.display = 'block';
    if (real) real.style.display = 'none';
  }
  function hideOverviewSkeleton() {
    var skel = document.getElementById('overviewSkeleton');
    var real = document.getElementById('overviewReal');
    if (skel) skel.style.display = 'none';
    if (real) real.style.display = 'block';
  }

  // ── Streak celebration ───────────────────────────────────────────────────
  var streakAck = { type: null, startTradeId: null, seenCount: 0 };
  var WIN_STREAK_MESSAGES = [
    'A winning streak is not a reason to change your system.',
    'Profit doesn\'t give you the right to break the rules.',
    'Don\'t let profit convince you you\'re smarter than your own system.',
    'After five wins, the sixth trade still has to meet the same conditions.',
    'My system doesn\'t get better because it\'s winning.',
    'Don\'t raise your risk just because things are going well right now.'
  ];
  var LOSS_STREAK_MESSAGES = [
    'My job isn\'t to avoid a loss. My job is to execute the system.',
    'A loss taken by the system is a correct trade.',
    'Don\'t change your system because of a losing streak.',
    'The next trade shouldn\'t try to win back the last loss.',
    'A losing streak tests my discipline, not my system.',
    'The system doesn\'t have to win right now. It has to have an edge over time.'
  ];
  var TAKE_AFTER_LOSS_MESSAGES = [
    'This is what discipline is for. Keep doing the same thing.',
    'You didn\'t win it back. You just executed a good trade.',
    'This isn\'t a turn of fate. It\'s one trade. Keep following the system.',
    'The system paid off. Now just keep following it.',
    'The losing streak is over. Discipline isn\'t.',
    'Don\'t try to win it all back at once. One correct trade is enough.',
    'This is how it works: loss, loss, loss — then a win again. Don\'t change anything.',
    'Good trade. No euphoria. The next setup follows the same rules.'
  ];
  var BREAK_STREAK_THRESHOLD = 3;

  // Detects a just-happened streak break: the previous run (win or loss) was
  // long enough, and the very last trade is the single opposite-type trade
  // that ended it (stop right after a winstreak, or take right after a losestreak).
  function computeStreakBreak(arr) {
    var sorted = sortedAsc(arr);
    if (sorted.length < 2) return { type: null, count: 0, tradeId: null };
    var last = sorted[sorted.length - 1], lastSign = Math.sign(Number(last.r) || 0);
    if (!lastSign) return { type: null, count: 0, tradeId: null };
    var curCount = 0;
    for (var i = sorted.length - 1; i >= 0; i--) {
      if (Math.sign(Number(sorted[i].r) || 0) === lastSign) curCount++; else break;
    }
    if (curCount !== 1) return { type: null, count: 0, tradeId: null };
    var prevCount = 0;
    for (var j = sorted.length - 2; j >= 0; j--) {
      if (Math.sign(Number(sorted[j].r) || 0) === -lastSign) prevCount++; else break;
    }
    if (prevCount < BREAK_STREAK_THRESHOLD) return { type: null, count: 0, tradeId: null };
    return { type: lastSign > 0 ? 'take-after-loss' : 'stop-after-win', count: prevCount, tradeId: last.id };
  }

  function computeCurrentStreak(arr) {
    var sorted = sortedAsc(arr);
    if (!sorted.length) return { type: null, count: 0, startTradeId: null };
    var sign = Math.sign(Number(sorted[sorted.length - 1].r) || 0);
    if (!sign) return { type: null, count: 0, startTradeId: null };
    var count = 0;
    for (var i = sorted.length - 1; i >= 0; i--) {
      if (Math.sign(Number(sorted[i].r) || 0) === sign) count++; else break;
    }
    var startTradeId = sorted[sorted.length - count].id;
    return { type: sign > 0 ? 'win' : 'loss', count: count, startTradeId: startTradeId };
  }

  var STREAK_ICON_WIN = '<img src="images/icon-streak-win.webp" style="width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 0 16px rgba(251,146,60,0.35));" alt="">';
  var STREAK_ICON_LOSS = '<img src="images/icon-streak-loss.webp" style="width:100%;height:100%;object-fit:contain;display:block;" alt="">';
  var STREAK_ICON_EXTINGUISHED = '<img class="streak-break-flame-img" src="images/icon-streak-extinguished.webp" alt="Extinguished streak flame">';

  var lastStreakMsg = null;
  var activeCelebration = null;
  var breakAck = { type: null, tradeId: null };
  function showStreakCelebration(type, count) {
    var overlay = document.getElementById('streakCelebrateOverlay');
    var iconEl = document.getElementById('streakCelebrateIcon');
    var subEl = document.getElementById('streakCelebrateSub');
    var msgs = type === 'win' ? WIN_STREAK_MESSAGES : LOSS_STREAK_MESSAGES;
    var msg = msgs[Math.floor(Math.random() * msgs.length)];
    if (msgs.length > 1) {
      var attempts = 0;
      while (msg === lastStreakMsg && attempts < 8) {
        msg = msgs[Math.floor(Math.random() * msgs.length)];
        attempts++;
      }
    }
    lastStreakMsg = msg;
    iconEl.classList.remove('emoji-icon');
    iconEl.innerHTML = type === 'win' ? STREAK_ICON_WIN : STREAK_ICON_LOSS;
    subEl.classList.remove('emoji-sub');
    document.getElementById('streakCelebrateTitle').textContent =
      count + (type === 'win' ? ' wins in a row' : ' losses in a row');
    subEl.textContent = msg;
    overlay.classList.remove('neutral');
    overlay.classList.toggle('loss', type === 'loss');
    document.getElementById('streakThanksBtn').textContent = type === 'loss' ? 'Ok' : 'Thanks';
    activeCelebration = 'streak';
    overlay.classList.add('open');
  }

  // Stop right after a winstreak, or a take right after a losestreak — same
  // popup mechanics (shows once per event, tracked/persisted like the streak toast).
  function showStreakBreakCelebration(type, count) {
    var overlay = document.getElementById('streakCelebrateOverlay');
    var iconEl = document.getElementById('streakCelebrateIcon');
    var subEl = document.getElementById('streakCelebrateSub');
    overlay.classList.remove('loss');
    if (type === 'stop-after-win') {
      // Top: extinguished flame with a small trail of smoke.
      iconEl.classList.remove('emoji-icon');
      iconEl.innerHTML = '<img class="streak-break-flame-img" src="images/icon-streak-extinguished.webp" alt="Extinguished streak flame">';
      // Below the title: the two-person hug sticker.
      subEl.classList.remove('emoji-sub');
      subEl.style.fontSize = '';
      subEl.innerHTML = '<img class="streak-break-hug-img" src="images/icon-streak-hug.webp" alt="Hug">';
      document.getElementById('streakCelebrateTitle').textContent = count + '-win streak snapped';
      overlay.classList.add('neutral');
    } else {
      // Losstreak break: trophy instead of the old cat-like tiger.
      iconEl.classList.remove('emoji-icon');
      iconEl.innerHTML = '<img class="streak-break-tiger-img" src="images/icon-streak-tiger.png" alt="Tiger">';
      subEl.classList.remove('emoji-sub');
      subEl.style.fontSize = '';
      var msg = TAKE_AFTER_LOSS_MESSAGES[Math.floor(Math.random() * TAKE_AFTER_LOSS_MESSAGES.length)];
      if (TAKE_AFTER_LOSS_MESSAGES.length > 1) {
        var attempts2 = 0;
        while (msg === lastStreakMsg && attempts2 < 8) {
          msg = TAKE_AFTER_LOSS_MESSAGES[Math.floor(Math.random() * TAKE_AFTER_LOSS_MESSAGES.length)];
          attempts2++;
        }
      }
      lastStreakMsg = msg;
      subEl.textContent = msg;
      document.getElementById('streakCelebrateTitle').textContent = count + '-loss streak broken';
      overlay.classList.remove('neutral');
    }
    document.getElementById('streakThanksBtn').textContent = 'Ok';
    activeCelebration = 'break';
    overlay.classList.add('open');
  }

  function ackStreakCelebration(type, count, startTradeId) {
    streakAck = { type: type, startTradeId: startTradeId, seenCount: count };
    document.getElementById('streakCelebrateOverlay').classList.remove('open');
    if (!viewingUser) return;
    db.collection('titles').doc(viewingUser).set({ streakAck: streakAck }, { merge: true }).catch(function() {});
  }

  function ackBreakCelebration(type, tradeId) {
    breakAck = { type: type, tradeId: tradeId };
    document.getElementById('streakCelebrateOverlay').classList.remove('open');
    if (!viewingUser) return;
    db.collection('titles').doc(viewingUser).set({ breakAck: breakAck }, { merge: true }).catch(function() {});
  }

  document.getElementById('streakThanksBtn').addEventListener('click', function() {
    if (activeCelebration === 'break') {
      var brk = computeStreakBreak(trades);
      ackBreakCelebration(brk.type, brk.tradeId);
    } else {
      var streak = computeCurrentStreak(trades);
      ackStreakCelebration(streak.type, streak.count, streak.startTradeId);
    }
  });
  document.getElementById('streakCelebrateOverlay').addEventListener('dragstart', function(e) { e.preventDefault(); });
  document.getElementById('streakCelebrateOverlay').addEventListener('selectstart', function(e) { e.preventDefault(); });
  document.getElementById('streakCelebrateOverlay').addEventListener('contextmenu', function(e) { e.preventDefault(); });

  function maybeShowStreakToast() {
    // The popup and its "seen" mark belong to the journal owner. An administrator
    // browsing a student's journal must neither see it nor consume it for them.
    if (!currentUser || !viewingUser || currentUser.login !== viewingUser) return;
    var brk = computeStreakBreak(trades);
    if (brk.type) {
      var brkSeen = breakAck.type === brk.type && breakAck.tradeId === brk.tradeId;
      if (!brkSeen) { showStreakBreakCelebration(brk.type, brk.count); return; }
    }
    var streak = computeCurrentStreak(trades);
    if (streak.count < 3) return;
    var sameRun = streakAck.type === streak.type && streakAck.startTradeId === streak.startTradeId;
    var alreadySeen = sameRun && streakAck.seenCount >= streak.count;
    if (!alreadySeen) showStreakCelebration(streak.type, streak.count);
  }

  /* v3.41: live sync between devices/tabs.
     tjServerTrades keeps the last version the server confirmed, so an edit sends only the
     fields that really changed and can no longer overwrite newer changes from another device. */
  var tjServerTrades = {};
  var tjDataGeneration = 0, tjBacktestLoadGeneration = 0;
  var tjLive = { unsubs: [], timer: null, generation: 0, trades: false, backtests: false };
  function tjLoadIsCurrent(load) {
    return !!(load && load.generation === tjDataGeneration && load.user === viewingUser && load.authUser === currentUser);
  }
  function tjClone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
  function stopLiveSync() {
    tjLive.unsubs.forEach(function(u) { try { u(); } catch (e) {} });
    tjLive.unsubs = [];
    clearTimeout(tjLive.timer);
    tjLive.timer = null;
    tjLive.trades = false; tjLive.backtests = false;
    tjLive.generation++;
  }
  function tjUserIsBusy() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
    if (typeof activeEditCol !== 'undefined' && activeEditCol) return true;
    if (backtestCreationStep) return true;
    return false;
  }
  function tjScheduleLiveRender(kind) {
    if (kind === 'trades' || kind === 'backtests') tjLive[kind] = true;
    clearTimeout(tjLive.timer);
    tjLive.timer = setTimeout(function() {
      tjLive.timer = null;
      if (!currentUser) return;
      if (tjUserIsBusy()) { tjScheduleLiveRender('retry'); return; }
      var needed = activeTab === 'backtests' ? tjLive.backtests : tjLive.trades;
      if (!needed || activeTab === 'notes') return;
      if (activeTab === 'backtests') tjLive.backtests = false; else tjLive.trades = false;
      render();
    }, kind === 'retry' ? 1500 : 300);
  }

  function tjApplyLive(list, data, id) {
    var ex = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { ex = list[i]; break; }
    if (!ex) { list.push(data); return true; }
    if (JSON.stringify(ex) === JSON.stringify(data)) return false;
    Object.keys(ex).forEach(function(k) { if (!(k in data)) delete ex[k]; });
    Object.keys(data).forEach(function(k) { ex[k] = data[k]; });
    return true;
  }
  // ---------------------------------------------------------------------------
  // PR1: journal notices. #saveError lives inside the trade modal and is invisible
  // once that modal is closed, so background failures (loading, a save that ends
  // after the form closed, deleting) are reported here, above every dialog.
  var tjNotices = Object.create(null);
  function tjNoticeHost() {
    var host = document.getElementById('journalNotice');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'journalNotice';
    host.className = 'tj-notice-host';
    document.body.appendChild(host);
    return host;
  }
  // level: 'error' | 'warn' | 'info' | 'ok'. The same kind replaces its previous
  // notice; repeating identical text is a no-op (safe to call on every render).
  function tjNotice(kind, level, message, actions, timeoutMs) {
    if (typeof document === 'undefined' || !document.body) return null;
    actions = actions || [];
    var current = tjNotices[kind];
    var signature = level + '\u0000' + message + '\u0000' + actions.map(function(a) { return a.label; }).join('\u0000');
    if (current && current.el.isConnected && current.signature === signature) {
      current.actions = actions;
      tjArmNoticeTimer(kind, timeoutMs);
      return current.el;
    }
    var host = tjNoticeHost();
    var el = current && current.el.isConnected ? current.el : document.createElement('div');
    if (current && current.timer) clearTimeout(current.timer);
    el.className = 'tj-notice tj-notice-' + level;
    el.setAttribute('role', level === 'error' ? 'alert' : 'status');
    el.setAttribute('data-kind', kind);
    var text = document.createElement('div');
    text.className = 'tj-notice-text';
    text.textContent = message;
    var bar = document.createElement('div');
    bar.className = 'tj-notice-actions';
    actions.forEach(function(action, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tj-notice-btn';
      button.textContent = action.label;
      button.addEventListener('click', function() {
        var live = tjNotices[kind], chosen = live && live.actions[index];
        if (!chosen) return;
        if (!chosen.keep) tjClearNotice(kind);
        chosen.run();
      });
      bar.appendChild(button);
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'tj-notice-close';
    close.setAttribute('aria-label', 'Скрыть уведомление');
    close.innerHTML = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener('click', function() { tjClearNotice(kind); });
    bar.appendChild(close);
    el.replaceChildren(text, bar);
    if (!el.isConnected) host.appendChild(el);
    tjNotices[kind] = { el: el, signature: signature, actions: actions, timer: null };
    tjArmNoticeTimer(kind, timeoutMs);
    return el;
  }
  function tjArmNoticeTimer(kind, timeoutMs) {
    var item = tjNotices[kind];
    if (!item) return;
    if (item.timer) { clearTimeout(item.timer); item.timer = null; }
    if (timeoutMs > 0) item.timer = setTimeout(function() { if (tjNotices[kind] === item) tjClearNotice(kind); }, timeoutMs);
  }
  function tjClearNotice(kind) {
    var item = tjNotices[kind];
    if (!item) return;
    delete tjNotices[kind];
    if (item.timer) clearTimeout(item.timer);
    if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
  }
  // Journal notices never leak into another account's journal. 'keep:' notices
  // describe this tab/administrator (not one journal) and survive a journal switch.
  function tjClearJournalNotices() {
    Object.keys(tjNotices).forEach(function(kind) { if (kind.indexOf('keep:') !== 0) tjClearNotice(kind); });
  }
  function tjErrorReason(err) {
    var reason = err && (err.code || err.message);
    return reason ? ' (' + String(reason).slice(0, 120) + ')' : '';
  }
  function tjDescribeTrade(t) {
    if (!t) return 'Сделка';
    var parts = [], number = tradeNumberOf(t);
    if (number) parts.push('#' + number);
    if (t.asset) parts.push(String(t.asset));
    if (t.direction) parts.push(String(t.direction));
    if (t.openDT) parts.push(fmtDT(t.openDT));
    parts.push(fmtR(Number(t.r) || 0));
    return parts.join(' · ');
  }
  // A failure of the save being submitted from the open form stays inside that form
  // (its draft is kept for retry); every other failure becomes a visible notice.
  function tjReportTradeSaveError(trade, message, err) {
    var el = document.getElementById('saveError'), overlay = document.getElementById('modalOverlay'), form = document.getElementById('tradeForm');
    if (el && overlay && overlay.classList.contains('open') && form && trade && form.dataset.pendingId === String(trade.id)) {
      el.textContent = message;
      el.style.display = 'block';
      return;
    }
    tjNotice('save:' + (trade ? trade.id : ''), 'error', tjDescribeTrade(trade) + ': изменения не сохранены на сервере' + tjErrorReason(err) + '. Проверьте соединение и повторите.');
  }

  // PR1: one styled confirmation dialog for destructive journal actions.
  var tjConfirmState = null;
  function tjConfirmAction(options) {
    options = options || {};
    var overlay = document.getElementById('tjConfirmOverlay');
    if (!overlay) return Promise.resolve(window.confirm(options.message || options.title || ''));
    if (tjConfirmState) tjConfirmState.finish(false);
    if (overlay.parentNode !== document.body) document.body.appendChild(overlay);
    document.getElementById('tjConfirmTitle').textContent = options.title || 'Удалить?';
    document.getElementById('tjConfirmMessage').textContent = options.message || '';
    document.getElementById('tjConfirmOk').textContent = options.confirmLabel || 'Удалить';
    var previous = document.activeElement;
    return new Promise(function(resolve) {
      var state = { finish: function(result) {
        if (tjConfirmState !== state) return;
        tjConfirmState = null;
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        if (previous && previous.isConnected && typeof previous.focus === 'function') { try { previous.focus({ preventScroll: true }); } catch (e) {} }
        resolve(!!result);
      } };
      tjConfirmState = state;
      overlay.setAttribute('aria-hidden', 'false');
      overlay.classList.add('open');
      // Destructive default: keyboard focus starts on Cancel.
      setTimeout(function() { if (tjConfirmState === state) document.getElementById('tjConfirmCancel').focus(); }, 30);
    });
  }
  (function() {
    var overlay = document.getElementById('tjConfirmOverlay');
    if (!overlay) return;
    document.body.appendChild(overlay);
    document.getElementById('tjConfirmOk').addEventListener('click', function() { if (tjConfirmState) tjConfirmState.finish(true); });
    document.getElementById('tjConfirmCancel').addEventListener('click', function() { if (tjConfirmState) tjConfirmState.finish(false); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay && tjConfirmState) tjConfirmState.finish(false); });
    document.addEventListener('keydown', function(e) {
      if (!tjConfirmState || e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      tjConfirmState.finish(false);
    }, true);
  })();
  function tjRequestTradeDelete(id) {
    var trade = trades.filter(function(t) { return t.id === id; })[0];
    if (!trade) return Promise.resolve(false);
    var owner = viewingUser, generation = tjDataGeneration;
    var images = (Array.isArray(trade.images) ? trade.images : (Array.isArray(trade._images) ? trade._images : [])).length || (trade.chart ? 1 : 0);
    return tjConfirmAction({
      title: 'Удалить сделку?',
      message: tjDescribeTrade(trade) + (images ? ' — сделка и её изображения (' + images + ') будут удалены.' : ' — сделка будет удалена.') + ' Это действие нельзя отменить.',
      confirmLabel: 'Удалить'
    }).then(function(confirmed) {
      if (!confirmed || viewingUser !== owner || generation !== tjDataGeneration) return false;
      if (!trades.some(function(t) { return t.id === id; })) return false;
      if (typeof currentNoteTradeId !== 'undefined' && currentNoteTradeId === id) closeNotePanel();
      trades = trades.filter(function(t) { return t.id !== id; });
      remoteDeleteTrade(id);
      render();
      return true;
    });
  }

  // PR1: Firestore runs without offline persistence, so a queued write dies with
  // the tab. NEW journal trades are also recorded here (per signed-in account)
  // until the server acknowledges them and are re-sent after the next successful
  // server load. Image payloads are too large for localStorage and are not kept.
  var TJ_TRADE_OUTBOX_PREFIX = 'syter_trade_outbox_v1_';
  var TJ_SAVE_WAIT_MS = 5000, TJ_OFFLINE_SAVE_WAIT_MS = 1500;
  function tjTradeOutboxKey() {
    try {
      var auth = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
      return auth && auth.uid ? TJ_TRADE_OUTBOX_PREFIX + auth.uid : null;
    } catch (e) { return null; }
  }
  function tjTradeOutboxRead(key) {
    if (!key) return [];
    try {
      var list = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(list)) throw Error('not a list');
      return list.filter(function(e) { return e && typeof e.id === 'string' && e.id && typeof e.ownerUid === 'string' && e.record && typeof e.record === 'object'; });
    } catch (e) {
      console.warn('Trade outbox unreadable; it was left untouched:', e);
      var damaged = []; damaged.damaged = true; return damaged;
    }
  }
  function tjTradeOutboxStore(key, list) {
    try {
      if (list.length) localStorage.setItem(key, JSON.stringify(list)); else localStorage.removeItem(key);
      return true;
    } catch (e) { console.warn('Trade outbox unavailable:', e); return false; }
  }
  function tjTradeOutboxRecord(trade) {
    var record = {};
    Object.keys(trade).forEach(function(k) { if (k !== '_images' && k !== 'images' && k !== 'chart') record[k] = trade[k]; });
    return tjClone(record);
  }
  function tjTradeOutboxPut(trade, key) {
    if (!key || !trade || !trade.id || !trade.uid) return false;
    var record = tjTradeOutboxRecord(trade);
    if (!record) return false;
    var current = tjTradeOutboxRead(key);
    if (current.damaged) return false; // never overwrite a copy kept for manual recovery
    var list = current.filter(function(e) { return e.id !== String(trade.id); });
    var images = Array.isArray(trade._images) ? trade._images.length : (Array.isArray(trade.images) ? trade.images.length : 0);
    list.push({ id: String(trade.id), ownerUid: String(trade.uid), owner: String(trade.user || ''), images: images, savedAt: Date.now(), record: record });
    return tjTradeOutboxStore(key, list);
  }
  // Later edits of a still-unacknowledged trade must survive a reload too.
  function tjTradeOutboxUpdate(trade, key) {
    if (!key || !trade || !trade.id) return;
    var list = tjTradeOutboxRead(key), entry = list.filter(function(e) { return e.id === String(trade.id); })[0];
    if (!entry) return;
    var record = tjTradeOutboxRecord(trade);
    if (!record) return;
    entry.record = record; entry.savedAt = Date.now();
    tjTradeOutboxStore(key, list);
  }
  function tjTradeOutboxRemove(id, key) {
    if (!key || !id) return;
    var list = tjTradeOutboxRead(key), next = list.filter(function(e) { return e.id !== String(id); });
    if (next.length !== list.length) tjTradeOutboxStore(key, next);
  }
  // A rejected write is final for this account. If the account changed meanwhile,
  // the entry stays: that account re-sends it after its next successful load.
  function tjTradeOutboxForget(id, key) {
    if (key && key === tjTradeOutboxKey()) tjTradeOutboxRemove(id, key);
  }
  function tjTradeOutboxHas(id) {
    return tjTradeOutboxRead(tjTradeOutboxKey()).some(function(e) { return e.id === String(id); });
  }
  function tjSettleWithin(promise, ms) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { if (!done) { done = true; resolve({ pending: true }); } }, ms);
      Promise.resolve(promise).then(function(value) {
        if (done) return; done = true; clearTimeout(timer); resolve({ value: value });
      }, function(error) {
        if (done) return; done = true; clearTimeout(timer); resolve({ error: error || Error('Save failed') });
      });
    });
  }
  // A new trade whose save is still unacknowledged after the wait is shown in the
  // journal right away; the form is released instead of staying locked offline.
  var tjPendingTradeSaves = Object.create(null);
  function tjShowPendingTradesNotice(justSaved) {
    var ids = Object.keys(tjPendingTradeSaves);
    if (!ids.length) {
      if (justSaved) tjNotice('keep:pending', 'ok', 'Сделка сохранена на сервере.', null, 4000);
      else tjClearNotice('keep:pending');
      return;
    }
    var images = ids.some(function(id) { return tjPendingTradeSaves[id].images > 0; });
    tjNotice('keep:pending', 'warn', (ids.length === 1 ? 'Сервер ещё не подтвердил сохранение сделки.' : 'Сервер ещё не подтвердил сохранение сделок: ' + ids.length + '.') +
      ' Она уже в журнале и отправится автоматически, когда появится связь. Не закрывайте вкладку до подтверждения' +
      (images ? ': иначе сделка отправится при следующем открытии журнала на этом устройстве, но без изображений.' : ': иначе сделка отправится при следующем открытии журнала на этом устройстве.'));
  }
  function tjTrackPendingTrade(trade, saving, owner) {
    var id = String(trade.id);
    tjPendingTradeSaves[id] = { images: Array.isArray(trade._images) ? trade._images.length : 0 };
    tjShowPendingTradesNotice(false);
    Promise.resolve(saving).then(function(ok) { return ok; }, function(err) { console.error(err); return false; }).then(function(ok) {
      if (!tjPendingTradeSaves[id]) return;
      delete tjPendingTradeSaves[id];
      if (!ok && viewingUser === owner && !tjTradeOutboxHas(id) && trades.some(function(t) { return t.id === id; })) {
        // The server rejected it (reason already reported): never show it as saved.
        trades = trades.filter(function(t) { return t.id !== id; });
        invalidateTradeNumbers();
        render();
      }
      tjShowPendingTradesNotice(!!ok);
    });
  }
  // After a successful SERVER read: drop acknowledged entries; re-send the rest
  // under their original id (idempotent) and show them in the journal again.
  function tjResendPendingTrades(targetUid, serverIds, load) {
    var key = tjTradeOutboxKey();
    if (!key || !targetUid) return 0;
    var entries = tjTradeOutboxRead(key).filter(function(e) { return e.ownerUid === targetUid; });
    var resent = 0, withoutImages = 0;
    entries.forEach(function(entry) {
      if (serverIds[entry.id]) { tjTradeOutboxRemove(entry.id, key); return; }
      var record = tjClone(entry.record);
      if (!record) { tjTradeOutboxRemove(entry.id, key); return; }
      record.id = entry.id; record.uid = targetUid;
      if (!trades.some(function(t) { return t.id === entry.id; })) trades.push(normalizeTradeRisk(tjClone(record)));
      if (tjPendingTradeSaves[entry.id]) return; // this tab is still sending it, with its images
      resent++; if (entry.images > 0) withoutImages++;
      db.collection('trades').doc(entry.id).set(record, { merge: true }).then(function() {
        tjTradeOutboxRemove(entry.id, key);
        if (tjLoadIsCurrent(load)) tjServerTrades[entry.id] = tjClone(record);
      }).catch(function(err) {
        console.error(err);
        tjTradeOutboxForget(entry.id, key);
        if (!tjLoadIsCurrent(load)) return;
        trades = trades.filter(function(t) { return t.id !== entry.id; });
        invalidateTradeNumbers();
        render();
        tjNotice('outbox:' + entry.id, 'error', tjDescribeTrade(record) + ': сделка из очереди этого устройства не принята сервером' + tjErrorReason(err) + ' и убрана из списка. Добавьте её заново.');
      });
    });
    if (Object.keys(tjPendingTradeSaves).length) tjShowPendingTradesNotice(false);
    if (resent) tjNotice('outbox', 'info', 'Отправлены сделки, которые не успели сохраниться в прошлый раз: ' + resent + '.' +
      (withoutImages ? ' Изображения к ним (' + withoutImages + ') не сохранились — добавьте их заново.' : ''), null, withoutImages ? 0 : 8000);
    return resent;
  }
  function tjReloadJournal() {
    loadData().then(function(load) { if (load) finishJournalCoreLoad(load); });
  }

  function startLiveSync(load) {
    if (load && !tjLoadIsCurrent(load)) return;
    stopLiveSync();
    var user = viewingUser, owner = findUser(user), uid = owner ? owner.uid : null;
    if (!uid || typeof db === 'undefined' || !db) return;
    var generation = tjLive.generation, authUser = currentUser;
    var guard = function() { return !!(currentUser === authUser && viewingUser === user && tjLive.generation === generation); };
    tjLive.unsubs.push(db.collection('trades').where('uid', '==', uid).onSnapshot(function(snap) {
      if (!guard()) return;
      var changed = false;
      // A server snapshot supersedes an earlier failed load: clear its notice and
      // send what this device still holds for this journal (as a successful load would).
      if (snap.metadata && !snap.metadata.fromCache && tjNotices.load) {
        tjClearNotice('load');
        var seen = Object.create(null);
        snap.forEach(function(d) { seen[d.id] = true; });
        tjResendPendingTrades(uid, seen, load);
        changed = true;
      }
      snap.docChanges().forEach(function(ch) {
        var d = ch.doc;
        if (d.metadata.hasPendingWrites) return;
        var raw = d.data() || {}, id = d.id; raw.id = id;
        if (ch.type === 'removed') {
          delete tjServerTrades[id];
          var before = trades.length;
          trades = trades.filter(function(t) { return t.id !== id; });
          if (trades.length !== before) changed = true;
          return;
        }
        tjServerTrades[id] = tjClone(raw);
        var nt = normalizeTradeRisk(tjClone(raw));
        if (!nt.id) nt.id = id;
        if (tjApplyLive(trades, nt, id)) changed = true;
      });
      if (changed) { invalidateTradeNumbers(); tjScheduleLiveRender('trades'); }
    }, function(err) { console.warn('Live sync (trades) stopped:', err); }));
    var liveBt = function(collection, isTrades) {
      tjLive.unsubs.push(db.collection(collection).where('uid', '==', uid).onSnapshot(function(snap) {
        if (!guard()) return;
        var changed = false;
        snap.docChanges().forEach(function(ch) {
          var d = ch.doc;
          if (d.metadata.hasPendingWrites) return;
          var raw = d.data() || {}, id = d.id; raw.id = id;
          if (ch.type === 'removed') {
            if (isTrades) {
              var n1 = allBacktestTrades.length;
              allBacktestTrades = allBacktestTrades.filter(function(t) { return t.id !== id; });
              if (allBacktestTrades.length !== n1) changed = true;
            } else {
              var n2 = backtests.length;
              backtests = backtests.filter(function(b) { return b.id !== id; });
              if (backtests.length !== n2) changed = true;
              if (activeBacktestId === id) {
                activeBacktestId = null;
                backtestViewTransition = 'list';
                document.body.classList.remove('backtest-detail-mode');
              }
            }
            return;
          }
          var rec = tjClone(raw); rec.id = id;
          if (isTrades) rec = normalizeTradeRisk(rec);
          else {
            var localBt = backtests.filter(function(b) { return b.id === id; })[0];
            var ae = document.activeElement;
            var editingRR = activeBacktestId === id && (ae === document.getElementById('backtestRRInput') || ae === document.getElementById('backtestDaysTested'));
            if (localBt && (tjBacktestRRDrafts[id] || editingRR)) {
              rec.rrText = localBt.rrText;
              rec.daysTested = localBt.daysTested;
            }
          }
          if (tjApplyLive(isTrades ? allBacktestTrades : backtests, rec, id)) changed = true;
        });
        if (!changed) return;
        // A server snapshot must not erase this device's unacknowledged intent.
        try {
          if(isTrades)allBacktestTrades=tjOverlayBacktestOutbox(allBacktestTrades,'backtestTrades',user);
          else backtests=tjOverlayBacktestOutbox(backtests,'backtests',user);
        }catch(err){console.warn('Backtest pending changes preserved:',err);return;}
        if (!isTrades) backtests.sort(function(a, b) { return new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate); });
        var activeBt = activeBacktestId ? backtests.filter(function(b) { return b.id === activeBacktestId; })[0] : null;
        backtestTrades = activeBt ? allBacktestTrades.filter(function(t) { return t.backtestId === activeBt.id; }) : [];
        saveBacktestLocal();
        tjScheduleLiveRender('backtests');
      }, function(err) { console.warn('Live sync (' + collection + ') stopped:', err); }));
    };
    liveBt('backtests', false);
    liveBt('backtestTrades', true);
    tjLive.unsubs.push(db.collection('titles').doc(user).onSnapshot(function(doc) {
      if (!guard() || (doc.metadata && (doc.metadata.hasPendingWrites || doc.metadata.fromCache))) return;
      var data = doc.exists ? doc.data() : {};
      var nextDeleted = Array.isArray(data.deletedAssets) ? data.deletedAssets.slice() : [];
      var nextAssets = normalizeAssetDefinitions(data.assets, nextDeleted);
      if (JSON.stringify(assetDefinitions) === JSON.stringify(nextAssets) && JSON.stringify(deletedAssets) === JSON.stringify(nextDeleted)) return;
      assetDefinitions = nextAssets; deletedAssets = nextDeleted;
      renderAssetControls();
      tjScheduleLiveRender('trades');
    }, function(err) { console.warn('Live sync (assets) stopped:', err); }));
  }

  function loadData() {
    flushNotePanelSave();
    closeBestTrade();
    flushBacktestRRDraft();
    if(window.TJMedia){TJMedia.clearCache();TJMedia.reset();}
    var load = { generation: ++tjDataGeneration, user: viewingUser, authUser: currentUser };
    tjClearJournalNotices();
    stopLiveSync();
    tjServerTrades = {};
    closeModelCreatePanel();
    closeModal();
    tradingModels = [];
    tradingModelsUser = viewingUser;
    tradingModelsReady = false;
    tradingModelsLoadError = false;
    backtestsLoadedFlag = false;
    backtestsLoadError = false;
    selectedTradeModelId = '';
    selectedTradeModelName = '';
    renderTradeModelControl();
    showOverviewSkeleton();
    // A user switch must never carry an in-progress Backtest form or detail
    // selection into the next account.
    backtestTradeMode = false;
    backtestCreationStep = null;
    backtestDraftStart = null;
    var user = viewingUser;
    var owner = findUser(user);
    var targetUid = owner ? owner.uid : null;
    var serverIds = Object.create(null);
    return readTradingModelsDocument(user, load).then(function(doc) {
      if (!tjLoadIsCurrent(load)) return;
      deletedAssets = doc.exists && Array.isArray(doc.data().deletedAssets) ? doc.data().deletedAssets : [];
      assetDefinitions = normalizeAssetDefinitions(doc.exists ? doc.data().assets : null, deletedAssets);
      renderAssetControls();
      streakAck = (doc.exists && doc.data().streakAck) ? doc.data().streakAck : { type: null, startTradeId: null, seenCount: 0 };
      breakAck = (doc.exists && doc.data().breakAck) ? doc.data().breakAck : { type: null, tradeId: null };
      var titleData = doc.exists ? doc.data() : {}, savedCurve = titleData.curveColor, savedCustom = titleData.customCurveColor;
      curveColor = (typeof savedCurve === 'string' && /^#[0-9a-f]{6}$/i.test(savedCurve)) ? savedCurve.toLowerCase() : (savedCurve === 'grey' ? '#8fa3b8' : '#34d399');
      savedCustomCurveColor = (typeof savedCustom === 'string' && /^#[0-9a-f]{6}$/i.test(savedCustom) && savedCustom.toLowerCase() !== '#34d399' && savedCustom.toLowerCase() !== '#8fa3b8') ? savedCustom.toLowerCase() : null;
      if (!savedCustomCurveColor && curveColor !== '#34d399' && curveColor !== '#8fa3b8') savedCustomCurveColor = curveColor;
      updateCurveColorUI();
      if (currentUser && currentUser.login === user) {
        var savedChartH = Number(titleData.chartHeight);
        tjApplyChartHeight(savedChartH > 0 ? savedChartH : null);
        var savedBtH = Number(titleData.backtestChartHeight);
        tjApplyBacktestChartHeight(savedBtH > 0 ? savedBtH : null);
      }
    }).catch(function(err) {
      if (!tjLoadIsCurrent(load)) return;
      tradingModelsLoadError=true;renderTradeModelControl();
      console.warn('Could not load journal settings/models:',err);
      deletedAssets = [];
      assetDefinitions = normalizeAssetDefinitions(null);
      renderAssetControls();
      streakAck = { type: null, startTradeId: null, seenCount: 0 };
      breakAck = { type: null, tradeId: null };
    }).then(function() {
      if (!tjLoadIsCurrent(load)) return;
      if (!targetUid) return { empty: true, forEach: function() {} };
      // Server only: without persistence an offline default read silently returns
      // the empty memory cache, which looked exactly like an empty journal.
      return db.collection('trades').where('uid', '==', targetUid).get({ source: 'server' });
    }).then(function(snapshot) {
      if (!tjLoadIsCurrent(load)) return;
      var remote = [];
      snapshot.forEach(function(d) { var record=d.data(); record.id=d.id; remote.push(record); serverIds[d.id] = true; tjServerTrades[d.id] = tjClone(record); });
      if (remote.length > 0) {
        trades = remote.map(normalizeTradeRisk);
        var toFix = trades.filter(function(t) { return !t.uid && owner; });
        toFix.forEach(function(t) { t.uid = owner.uid; remoteSaveTrade(t, ['uid']); });
        return;
      }
      // Empty is authoritative. Legacy caches may contain deliberately deleted records.
      // Keep a downloadable recovery copy, never automatically re-upload it.
      trades = [];
      return migrateFromLocalStorage(user).catch(function() {}).then(function() {
        if (!tjLoadIsCurrent(load)) return;
        return idbGetAllForUser(user).catch(function() { return []; });
      }).then(function(localTrades) {
        if (!tjLoadIsCurrent(load) || !localTrades || !localTrades.length) return;
        tjOfferLegacyRecovery(localTrades, user, load);
      });
    }).then(function() {
      if (!tjLoadIsCurrent(load)) return;
      trades = (trades || []).map(normalizeTradeRisk);
      tjResendPendingTrades(targetUid, serverIds, load);
      invalidateTradeNumbers();
      // Overview is ready once settings and trades are reconciled. Backtests keep
      // their own explicit loading state and finish in the background; callers use
      // load.backtestsReady before starting listeners that touch those collections.
      load.backtestsReady = loadBacktests(targetUid, load).catch(function(err) {
        if (!tjLoadIsCurrent(load)) return load;
        backtestsLoadError = true;
        backtestsLoadedFlag = true;
        showBacktestSyncError('Backtests could not be refreshed. Saved changes remain on this device.');
        console.error(err);
        return load;
      }).then(function() { return load; });
      return load;
    // Loading a journal must never delete model references. Missing catalogue
    // entries may be temporary or legacy data; cleanup belongs only to the
    // explicit, confirmed model-delete action.
    }).catch(function(err) {
      if (!tjLoadIsCurrent(load)) return;
      console.error(err);
      trades = [];
      // Visible outside every dialog; never presented as a genuinely empty journal.
      tjNotice('load', 'error', 'Не удалось загрузить сделки с сервера' + tjErrorReason(err) + '. Журнал временно показан пустым — данные на сервере не изменены. Проверьте соединение и повторите.', [{ label: 'Повторить', run: tjReloadJournal }]);
    }).then(function() { return tjLoadIsCurrent(load) ? load : null; });
  }

  function finishJournalCoreLoad(load, button) {
    if (!tjLoadIsCurrent(load)) return;
    render(); hideOverviewSkeleton(); maybeShowStreakToast();
    if (button) button.classList.remove('is-loading');
    // Keep Backtests/Replay listeners behind the initial reconciliation so their
    // first snapshots cannot race the outbox overlay or an owner switch.
    Promise.resolve(load.backtestsReady).then(function() {
      if (!tjLoadIsCurrent(load)) return;
      if (activeTab === 'backtests') renderBacktests();
      startLiveSync(load);
      // Lighten old oversized thumbnails in the background (owner only, a few per visit).
      setTimeout(function() {
        if (!tjLoadIsCurrent(load) || !window.TJMedia || !TJMedia.shrinkLegacy) return;
        if (!currentUser || currentUser.login !== viewingUser) return;
        TJMedia.shrinkLegacy(trades.concat(allBacktestTrades || []), viewingUser);
      }, TJ_THUMB_SHRINK_DELAY_MS);
    });
  }
  var TJ_THUMB_SHRINK_DELAY_MS = 8000;

  function tjOfferLegacyRecovery(records, user, load) {
    // Shown as a journal notice: the old #saveError target was inside a closed modal.
    tjNotice('legacy', 'info', 'На этом устройстве найдено старых локальных сделок: '+records.length+'. Они НЕ импортированы — пустой облачный журнал может быть намеренным. Можно скачать их копию.', [{ label: 'Скачать копию', keep: true, run: function(){
      if(!tjLoadIsCurrent(load))return;
      var url=URL.createObjectURL(new Blob([JSON.stringify({version:1,owner:user,trades:records},null,2)],{type:'application/json'}));
      var link=document.createElement('a');link.href=url;link.download='SYTER-legacy-trades-recovery.json';link.click();
      setTimeout(function(){URL.revokeObjectURL(url);},10000);
    } }]);
  }

  function remoteSaveTrade(trade, fields, isNew) {
    trade.user=trade.user||viewingUser;
    if(!trade.uid){var mediaOwner=findUser(viewingUser);if(mediaOwner)trade.uid=mediaOwner.uid;}
    // Desktop 1.1 uses the same form but does not yet pass the image array.
    if(window.TJMedia&&isNew&&!Array.isArray(trade._images)&&document.getElementById('modalOverlay').classList.contains('open')&&TJMedia.snapshot().length)trade._images=TJMedia.snapshot();
    // A new trade stays recoverable on this device until the server acknowledges it.
    var outboxKey=tjTradeOutboxKey();
    if(isNew)tjTradeOutboxPut(trade,outboxKey);else tjTradeOutboxUpdate(trade,outboxKey);
    if(window.TJMedia && Array.isArray(trade._images)) {
      var mediaUser=viewingUser, mediaGeneration=tjDataGeneration;
      return TJMedia.write('trades',trade,fields,isNew).then(function(record){
        if(isNew)tjTradeOutboxRemove(trade.id,outboxKey);
        if(mediaUser===viewingUser&&mediaGeneration===tjDataGeneration){tjServerTrades[trade.id]=tjClone(record);invalidateTradeNumbers();tjClearNotice('save:'+trade.id);}
        return true;
      }).catch(function(err){console.error(err);if(isNew)tjTradeOutboxForget(trade.id,outboxKey);if(mediaUser===viewingUser)tjReportTradeSaveError(trade,'Не удалось сохранить изображения и сделку. Черновик оставлен для повтора.',err);return false;});
    }
    var user = viewingUser, generation = tjDataGeneration;
    trade.user = trade.user || user;
    if (!trade.uid) {
      var owner = findUser(user);
      if (owner) trade.uid = owner.uid;
    }
    invalidateTradeNumbers();
    var ref = db.collection('trades').doc(trade.id);
    var snapCopy = tjClone(trade), base = tjServerTrades[trade.id] || {}, patch = {}, removed = [];
    if (!isNew) {
      var keys = fields || Object.keys(base).concat(Object.keys(trade));
      keys.forEach(function(k) {
        if (k === 'id' || (!fields && (k === 'uid' || k === 'user'))) return;
        if (!(k in trade)) {
          if (k in base || fields) { patch[k] = firebase.firestore.FieldValue.delete(); removed.push(k); }
        } else if (JSON.stringify(base[k]) !== JSON.stringify(trade[k])) patch[k] = tjClone(trade[k]);
      });
      if (!Object.keys(patch).length) return Promise.resolve(true);
    }
    var op = isNew ? ref.set(snapCopy) : ref.set(patch, { merge: true });
    return op.then(function() {
      if (isNew) tjTradeOutboxRemove(trade.id, outboxKey);
      if (viewingUser !== user || generation !== tjDataGeneration) return true;
      if (isNew) tjServerTrades[trade.id] = snapCopy;
      else {
        var confirmed = tjServerTrades[trade.id] || {};
        Object.keys(patch).forEach(function(k) { if (removed.indexOf(k) >= 0) delete confirmed[k]; else confirmed[k] = tjClone(patch[k]); });
        tjServerTrades[trade.id] = confirmed;
      }
      document.getElementById('saveError').style.display = 'none';
      tjClearNotice('save:' + trade.id);
      return true;
    }).catch(function(err) {
      console.error(err);
      if (isNew) tjTradeOutboxForget(trade.id, outboxKey);
      if (viewingUser !== user || generation !== tjDataGeneration) return false;
      tjReportTradeSaveError(trade, 'Failed to save trade to the server (check your internet connection and that Firestore is enabled).', err);
      return false;
    });
  }

  function remoteDeleteTrade(id) {
    var deleteOwner=viewingUser,deleteGeneration=tjDataGeneration;
    var removedTrade=trades.find(function(t){return t.id===id;})||tjServerTrades[id],deletion=db.batch();
    tjTradeOutboxRemove(id,tjTradeOutboxKey());
    (removedTrade&&removedTrade.images||[]).forEach(function(ref){deletion.delete(db.collection('tradeImages').doc(ref.id));});
    deletion.delete(db.collection('trades').doc(id));
    deletion.commit().then(function() {
      if(viewingUser===deleteOwner&&tjDataGeneration===deleteGeneration)delete tjServerTrades[id];
    }).catch(function(err) {
      console.error(err);
      if(viewingUser!==deleteOwner||tjDataGeneration!==deleteGeneration)return;
      tjNotice('delete:'+id,'error',tjDescribeTrade(removedTrade)+': сделка убрана на этом устройстве, но сервер не подтвердил удаление'+tjErrorReason(err)+'. После перезагрузки она может вернуться — тогда удалите её ещё раз.');
    });
  }

  function backtestStorageKey(type) { return 'syter_' + type + '_v1_' + viewingUser; }

  function readBacktestLocal(type) {
    try {
      var data = JSON.parse(localStorage.getItem(backtestStorageKey(type)) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }

  function saveBacktestLocal() {
    try {
      localStorage.setItem(backtestStorageKey('backtests'), JSON.stringify(backtests));
      localStorage.setItem(backtestStorageKey('backtest_trades'), JSON.stringify(allBacktestTrades));
    } catch (e) { console.error('Could not save Backtests locally:', e); }
  }

  function showBacktestSyncError(message) {
    var el = document.getElementById('backtestSyncError');
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
  }

  // Owner-scoped durable intent log. Only acknowledged operations are removed.
  // Server reads overlay the log so an offline result/deletion cannot disappear on reload.
  var tjBacktestFlushes = Object.create(null), tjBacktestActiveLoads = Object.create(null), tjBacktestSequence=0;
  function tjBacktestOpPrefix(owner) { return 'syter_backtest_op_v1_'+encodeURIComponent(owner)+'_'; }
  function tjBacktestOutbox(owner) {
    var prefix=tjBacktestOpPrefix(owner),queue=[];queue.damaged=false;
    for(var i=0;i<localStorage.length;i++){
      var key=localStorage.key(i);if(!key||key.indexOf(prefix)!==0)continue;
      try {
        var op=JSON.parse(localStorage.getItem(key));
        if(!op||typeof op.id!=='string'||key!==prefix+op.id||!Array.isArray(op.parts)||!Number.isInteger(op.index)||op.index<0||op.index>op.parts.length||typeof op.authUid!=='string'||typeof op.ownerUid!=='string')throw Error('Invalid outbox envelope');
        op.parts.forEach(function(part){if(!Array.isArray(part))throw Error('Invalid part');part.forEach(function(w){if(!w||['backtests','backtestTrades','tradeImages'].indexOf(w.collection)<0||typeof w.id!=='string'||!w.id||(!w.remove&&(!w.data||typeof w.data!=='object')))throw Error('Invalid write');});});
        queue.push(op);
      } catch(err){queue.damaged=true;console.warn('Backtest queue entry kept for recovery:',key);showBacktestSyncError('A damaged Backtest queue entry was preserved on this device. Sync is paused to preserve operation ordering; other data remains available. Export local storage before recovery.');}
    }
    queue.sort(function(a,b){return a.id.localeCompare(b.id);});return queue;
  }
  function tjStoreBacktestOp(owner,op) {
    localStorage.setItem(tjBacktestOpPrefix(owner)+op.id,JSON.stringify(op));
  }
  function tjQueueBacktestOps(parts,owner) {
    owner=owner||viewingUser;
    try {
      var profile=findUser(owner), auth=firebase.auth().currentUser;
      if(!profile||!auth)throw Error('Sign in before saving backtests.');
      var op={id:Date.now().toString().padStart(16,'0')+'_'+String(++tjBacktestSequence).padStart(8,'0')+'_'+Math.random().toString(36).slice(2),authUid:auth.uid,ownerUid:profile.uid,parts:parts,index:0};
      // A complete multi-batch intent is one atomic localStorage write. Separate keys
      // prevent concurrent tabs from losing one another's queued operations.
      tjStoreBacktestOp(owner,op);
      if(tjBacktestActiveLoads[owner])tjBacktestActiveLoads[owner].push(JSON.parse(JSON.stringify(op)));
    } catch(err){var failure=Promise.reject(err);failure.queued=false;return failure;}
    var pending=tjFlushBacktestOutbox(owner);pending.queued=true;return pending;
  }
  function tjBacktestWrite(collection,id,data,options,owner) {
    return tjQueueBacktestOps([[{collection:collection,id:id,data:data,merge:!!(options&&options.merge)}]],owner);
  }
  // PR1: a Backtest trade whose save (with images) is not acknowledged in time is
  // listed right away and queued WITHOUT images in the durable Backtest outbox, so
  // it survives a reload. The in-flight write with images keeps going in this tab.
  function tjQueuePendingBacktestTrade(btTrade, saving, owner) {
    var listed = Object.assign({}, btTrade);
    delete listed._images;
    var durable = tjClone(listed);
    if (durable) { delete durable.images; delete durable.chart; }
    var queued = durable ? tjBacktestWrite('backtestTrades', durable.id, durable, { merge: true }, owner) : Promise.reject(Error('Trade could not be copied'));
    queued.catch(function(err) { console.warn('Backtest sync pending:', err); });
    showBacktestSyncError(queued.queued ? 'Сервер ещё не подтвердил сохранение. Сделка сохранена на этом устройстве и отправится автоматически; изображения сохранятся, если не закрывать вкладку до подтверждения.' : 'Сервер ещё не подтвердил сохранение. Не закрывайте вкладку до подтверждения.');
    Promise.resolve(saving).then(function() {
      if (viewingUser !== owner) return;
      var record = allBacktestTrades.filter(function(t) { return t.id === btTrade.id; })[0];
      if (record) { record.images = btTrade.images; record.chart = btTrade.chart; delete record._images; }
      saveBacktestLocal();
      if (activeTab === 'backtests') renderBacktests();
      showBacktestSyncError('');
    }, function(err) {
      console.error(err);
      if (viewingUser === owner) showBacktestSyncError('Изображения не сохранены: ' + (err && err.message || err) + '. Сама сделка отправится из очереди этого устройства.');
    });
    return listed;
  }
  function tjFlushBacktestOutbox(owner) {
    if(tjBacktestFlushes[owner])return tjBacktestFlushes[owner];
    var noted=false;
    function next(){
      var queue=tjBacktestOutbox(owner);
      if(queue.damaged)throw Error('Backtest sync paused: recover the damaged local queue before sending later operations.');
      if(!queue.length)return Promise.resolve();
      var auth=firebase.auth().currentUser, profile=findUser(owner);
      if(!auth||!profile)throw Error('Backtest sync is waiting for sign-in.');
      // Operations queued by another account on this device wait for that account;
      // they must not block this account's own operations (head-of-line).
      var own=queue.filter(function(item){return item.authUid===auth.uid&&item.ownerUid===profile.uid;});
      if(own.length<queue.length&&!noted){noted=true;console.info('Backtest sync: '+(queue.length-own.length)+' queued operation(s) wait for the account that created them.');}
      if(!own.length)return Promise.resolve();
      var op=own[0];
      if(op.index>=op.parts.length){localStorage.removeItem(tjBacktestOpPrefix(owner)+op.id);return next();}
      var batch=db.batch();
      op.parts[op.index].forEach(function(w){var ref=db.collection(w.collection).doc(w.id);if(w.remove)batch.delete(ref);else batch.set(ref,w.data,{merge:w.merge});});
      return batch.commit().then(function(){op.index++;tjStoreBacktestOp(owner,op);return next();});
    }
    var work=Promise.resolve().then(function(){
      // Web Locks serialize pumps across tabs. Retrying a committed deletion after a
      // crash is safe; its complete intent remains until the final acknowledgement.
      return typeof navigator!=='undefined'&&navigator.locks ? navigator.locks.request('syter-backtest-sync-'+owner,next) : next();
    });
    var result=work.then(function(value){delete tjBacktestFlushes[owner];return value;},function(err){delete tjBacktestFlushes[owner];throw err;});
    tjBacktestFlushes[owner]=result;return result;
  }
  function tjOverlayBacktestOutbox(records,collection,owner,readIntents) {
    var map=Object.create(null);records.forEach(function(record){map[record.id]=record;});
    (readIntents||[]).concat(tjBacktestOutbox(owner)).forEach(function(op){op.parts.forEach(function(part){part.forEach(function(w){
      if(w.collection!==collection)return;
      if(w.remove){delete map[w.id];return;}
      var value=Object.assign({},w.data),existing=map[w.id]||{};
      if(!w.merge)Object.keys(existing).forEach(function(key){delete existing[key];});
      map[w.id]=Object.assign(existing,value,{id:w.id});
    });});});
    return Object.keys(map).map(function(id){return map[id];});
  }
  function tjDeleteBacktestRecords(records,parentId,owner) {
    var parts=[],part=[];
    records.forEach(function(record){
      var group=(record.images||[]).map(function(image){return {collection:'tradeImages',id:image.id,remove:true};});
      group.push({collection:'backtestTrades',id:record.id,remove:true});
      if(part.length+group.length>450){if(part.length)parts.push(part);part=[];}
      if(group.length>450)throw Error('Too many images in one trade to delete safely.');
      part=part.concat(group);
    });
    if(part.length)parts.push(part);
    // The parent is last; every preceding acknowledged chunk stays deleted on a retry.
    if(parentId)parts.push([{collection:'backtests',id:parentId,remove:true}]);
    return tjQueueBacktestOps(parts,owner);
  }
  window.addEventListener('online',function(){
    if(viewingUser)tjFlushBacktestOutbox(viewingUser).catch(function(err){console.warn('Backtest sync pending:',err);});
  });

  function mergeRecords(localRecords, remoteRecords) {
    var byId = {};
    localRecords.concat(remoteRecords).forEach(function(record) { if (record && record.id) byId[record.id] = record; });
    return Object.keys(byId).map(function(id) { return byId[id]; });
  }

  function loadBacktests(targetUid, load) {
    load = load || { generation: tjDataGeneration, user: viewingUser, authUser: currentUser };
    if (!tjLoadIsCurrent(load)) return Promise.resolve();
    var generation = ++tjBacktestLoadGeneration;
    function current() { return tjLoadIsCurrent(load) && generation === tjBacktestLoadGeneration; }
    if (!current()) return Promise.resolve();
    backtestsLoadedFlag = false;
    backtestsLoadError = false;
    var loadOwner=load.user;
    var readIntents=tjBacktestOutbox(loadOwner);tjBacktestActiveLoads[loadOwner]=readIntents;
    tjFlushBacktestOutbox(loadOwner).catch(function(err){console.warn('Backtest sync pending:',err);});
    var localBacktests = readBacktestLocal('backtests');
    var localTrades = readBacktestLocal('backtest_trades').map(normalizeTradeRisk);
    // Preserve the first pre-reconciliation cache. Old clients did not have an outbox,
    // so a failed legacy write cannot be distinguished from a remotely deleted record.
    // Do not silently upload either; retain an owner-scoped recovery copy instead.
    try {
      var recoveryKey='syter_backtest_recovery_v1_'+loadOwner;
      if(!localStorage.getItem(recoveryKey)&&(localBacktests.length||localTrades.length))
        localStorage.setItem(recoveryKey,JSON.stringify({backtests:localBacktests,trades:localTrades,savedAt:Date.now()}));
    }catch(err){console.warn('Backtest recovery backup unavailable:',err);}
    backtests = localBacktests; allBacktestTrades = localTrades;
    activeBacktestId = null;
    backtestTrades = [];
    if (!targetUid) { backtestsLoadedFlag = true; return Promise.resolve(); }
    var remoteBacktests = db.collection('backtests').where('uid', '==', targetUid).get({ source: 'server' }).then(function(snapshot) {
      if (!current()) return;
      var records = [];
      snapshot.forEach(function(d) { var b = d.data(); b.id = d.id; records.push(b); });
      return records;
    }).catch(function(err) { if (!current()) return; backtestsLoadError = true; console.error(err); return localBacktests; });
    var remoteTrades = db.collection('backtestTrades').where('uid', '==', targetUid).get({ source: 'server' }).then(function(snapshot) {
      if (!current()) return;
      var records = [];
      snapshot.forEach(function(d) { var t = d.data(); t.id = d.id; records.push(t); });
      return records;
    }).catch(function(err) { if (!current()) return; backtestsLoadError = true; console.error(err); return localTrades; });
    return Promise.all([remoteBacktests, remoteTrades]).then(function(results) {
      if (!current()) return;
      backtests = tjOverlayBacktestOutbox(results[0],'backtests',loadOwner,readIntents);
      allBacktestTrades = tjOverlayBacktestOutbox(results[1],'backtestTrades',loadOwner,readIntents).map(normalizeTradeRisk);
      backtests.sort(function(a, b) { return new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate); });
      saveBacktestLocal();
      backtestsLoadedFlag = true;
      if (backtestsLoadError) showBacktestSyncError('Backtests could not be fully refreshed. Saved changes remain on this device.');
      if(tjBacktestActiveLoads[loadOwner]===readIntents)delete tjBacktestActiveLoads[loadOwner];
    });
  }

  function loadBacktestTrades(bt) {
    backtestTrades = bt ? allBacktestTrades.filter(function(t) { return t.backtestId === bt.id; }) : [];
    return Promise.resolve(backtestTrades);
  }

  function openBacktestNameModal(id) {
    var bt = backtests.filter(function(b) { return b.id === id; })[0];
    if (!bt) return;
    editingBacktestId = id;
    document.getElementById('backtestNameInput').value = bt.name || 'Backtest';
    document.getElementById('backtestNameOverlay').classList.add('open');
    setTimeout(function() { document.getElementById('backtestNameInput').focus(); document.getElementById('backtestNameInput').select(); }, 80);
  }

  function closeBacktestNameModal() {
    editingBacktestId = null;
    document.getElementById('backtestNameOverlay').classList.remove('open');
  }

  function saveBacktestName() {
    var bt = backtests.filter(function(b) { return b.id === editingBacktestId; })[0];
    var name = document.getElementById('backtestNameInput').value.trim().slice(0, 48);
    if (!bt || !name) return;
    bt.name = name;
    saveBacktestLocal();
    renderBacktests();
    showBacktestSyncError('');
    tjBacktestWrite('backtests',bt.id,{ name: name }, { merge: true }).catch(function(err) {
      console.error(err);
      showBacktestSyncError('The new name was saved on this device, but could not be synced. Check your connection.');
    });
    closeBacktestNameModal();
  }

  function openBacktestDeleteModal(id) {
    var bt = backtests.filter(function(b) { return b.id === id; })[0];
    if (!bt) return;
    pendingBacktestDeletion = id;
    document.getElementById('backtestDeleteName').textContent = bt.name || 'Backtest';
    document.getElementById('backtestDeleteOverlay').classList.add('open');
  }

  function closeBacktestDeleteModal() {
    pendingBacktestDeletion = null;
    document.getElementById('backtestDeleteOverlay').classList.remove('open');
  }

  function deleteBacktest(id) {
    var owner=viewingUser,generation=tjDataGeneration;
    var records=allBacktestTrades.filter(function(t){return t.backtestId===id;});
    // Queue persistence occurs synchronously before the optimistic UI change.
    var operation=tjDeleteBacktestRecords(records,id,owner);
    var queued=false;try{queued=tjBacktestOutbox(owner).some(function(op){return op.parts.some(function(part){return part.some(function(w){return w.collection==='backtests'&&w.id===id&&w.remove;});});});}catch(_){}
    if(queued){
      backtests=backtests.filter(function(b){return b.id!==id;});
      allBacktestTrades=allBacktestTrades.filter(function(t){return t.backtestId!==id;});
      if(activeBacktestId===id){activeBacktestId=null;backtestTrades=[];backtestViewTransition='list';document.body.classList.remove('backtest-detail-mode');}
      saveBacktestLocal();renderBacktests();
    }
    return operation.catch(function(err){
      console.error(err);
      if(viewingUser!==owner||tjDataGeneration!==generation)return;
      showBacktestSyncError(queued?'Deletion is queued on this device and will retry when online. No deleted trades were restored.':'Deletion was not saved: '+err.message);
    });
  }
  function deleteBacktestTrade(id) {
    var owner=viewingUser,generation=tjDataGeneration;
    var record=allBacktestTrades.filter(function(t){return t.id===id;})[0];
    if(!record)return Promise.resolve();
    var operation=tjDeleteBacktestRecords([record],null,owner);
    var queued=false;try{queued=tjBacktestOutbox(owner).some(function(op){return op.parts.some(function(part){return part.some(function(w){return w.collection==='backtestTrades'&&w.id===id&&w.remove;});});});}catch(_){}
    if(queued){allBacktestTrades=allBacktestTrades.filter(function(t){return t.id!==id;});backtestTrades=backtestTrades.filter(function(t){return t.id!==id;});saveBacktestLocal();renderBacktests();}
    return operation.catch(function(err){if(viewingUser===owner&&tjDataGeneration===generation)showBacktestSyncError(queued?'Trade deletion is queued and will retry when online.':'Deletion was not saved: '+err.message);});
  }
  function setTradeToggleState(trade) {
    isLong = trade.direction === 'LONG';
    isWin = Number(trade.r) > 0;
    document.getElementById('btnLong').classList.toggle('active-long', isLong);
    document.getElementById('btnShort').classList.toggle('active-short', !isLong);
    document.getElementById('btnWin').classList.toggle('active-win', isWin);
    document.getElementById('btnLoss').classList.toggle('active-loss', Number(trade.r) < 0);
  }

  function openBacktestTradeEditor(id) {
    var trade = allBacktestTrades.filter(function(t) { return t.id === id && t.backtestId === activeBacktestId; })[0];
    if (!trade) return;
    backtestTradeMode = true;
    editingBacktestTradeId = id;
    openModal(null);
    if(window.TJMedia){
      var mediaOwner=viewingUser,mediaRev=TJMedia.revision;
      document.getElementById('tradeModalSubmitBtn').disabled=true;
      TJMedia.sources(trade).then(function(items){if(viewingUser===mediaOwner&&editingBacktestTradeId===id&&TJMedia.revision===mediaRev){TJMedia.reset(items);document.getElementById('tradeModalSubmitBtn').disabled=false;}}).catch(function(){document.getElementById('saveError').textContent='Не удалось загрузить изображения. Закройте и повторите открытие сделки.';document.getElementById('saveError').style.display='block';});
    }
    setTradeAsset(trade.asset);
    selectedTradeModelId = trade.modelId || '';
    selectedTradeModelName = trade.modelName || '';
    renderTradeModelControl();
    setDateTimeInput(document.getElementById('openInput'), trade.openDT);
    setDateTimeInput(document.getElementById('closeInput'), trade.closeDT);
    document.getElementById('magnitudeInput').value = Math.abs(Number(trade.r));
    document.getElementById('riskPercentInput').value = tradeRiskPercent(trade);
    setTradeToggleState(trade);
    document.getElementById('tradeModalTitle').textContent = 'Edit Trade';
    document.getElementById('tradeModalSubmitBtn').textContent = 'Save Changes';
  }

  // Backtest model filter: presentation only; never rewrite trades or RR data.
  function backtestModelCatalogue() {
    return tradingModelsReady && tradingModelsUser === viewingUser ? tradingModels : [];
  }
  function validBacktestModelFilter() {
    var context = JSON.stringify([viewingUser, activeBacktestId]);
    if (context !== backtestModelFilterContext) {
      backtestModelFilterContext = context; backtestModelFilterId = ''; closeBacktestModelMenu();
    }
    var models = backtestModelCatalogue();
    if (!models.length || (backtestModelFilterId && backtestModelFilterId !== '__NO_MODEL__' &&
        !models.some(function(m) { return m.id === backtestModelFilterId; }))) backtestModelFilterId = '';
    return backtestModelFilterId;
  }
  function filterBacktestTradesByModel(arr) {
    var id = validBacktestModelFilter();
    if (!id) return arr;
    return arr.filter(function(t) { return id === '__NO_MODEL__' ? !t.modelId : t.modelId === id; });
  }
  function closeBacktestModelMenu() {
    var control = document.getElementById('backtestModelControl');
    var trigger = document.getElementById('backtestModelTrigger');
    if (control) control.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  function selectBacktestModel(id) {
    validBacktestModelFilter();
    if (id && id !== '__NO_MODEL__' && !backtestModelCatalogue().some(function(m) { return m.id === id; })) return;
    backtestModelFilterId = id;
    closeBacktestModelMenu();
    renderBacktests();
    document.getElementById('backtestModelTrigger').focus();
  }
  function renderBacktestModelControl() {
    var row = document.getElementById('backtestModelRow');
    if (!row) return;
    var id = validBacktestModelFilter(), models = backtestModelCatalogue();
    row.hidden = !activeBacktestId || !models.length;
    if (row.hidden) closeBacktestModelMenu();
    var selected = models.filter(function(m) { return m.id === id; })[0];
    var name = selected ? selected.name : (id === '__NO_MODEL__' ? 'No model' : 'All models');
    document.getElementById('backtestModelValue').textContent = name;
    var summary = document.getElementById('backtestModelSummary');
    if (summary) { summary.hidden = !id; summary.textContent = id ? 'Model · ' + name : ''; }
    var empty = document.getElementById('backtestEmptyChart');
    if (empty) empty.textContent = id ? 'No trades for this model with the current filters' : 'No trades yet — add results or close a position in Replay';
    var menu = document.getElementById('backtestModelMenu');
    menu.replaceChildren();
    [{id:'',name:'All models'}].concat(models,[{id:'__NO_MODEL__',name:'No model'}]).forEach(function(m) {
      var option = document.createElement('button'); option.type = 'button';
      option.className = 'trade-asset-option' + (m.id === id ? ' active' : '');
      option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(m.id === id));
      option.textContent = m.name;
      option.addEventListener('click', function() { selectBacktestModel(m.id); });
      menu.appendChild(option);
    });
  }
  function handleBacktestModelKeys(e) {
    var control = document.getElementById('backtestModelControl'), trigger = document.getElementById('backtestModelTrigger');
    if (!control || !control.contains(e.target)) return;
    if (e.key === 'Escape') { e.preventDefault(); closeBacktestModelMenu(); trigger.focus(); return; }
    if (e.key === 'Tab') { closeBacktestModelMenu(); return; }
    if (['ArrowDown','ArrowUp','Home','End'].indexOf(e.key) < 0) return;
    e.preventDefault(); control.classList.add('open'); trigger.setAttribute('aria-expanded','true');
    var options = Array.prototype.slice.call(document.querySelectorAll('#backtestModelMenu button'));
    var index = options.indexOf(document.activeElement);
    var next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 :
      (index + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    if (options[next]) options[next].focus();
  }
  document.getElementById('backtestModelTrigger').addEventListener('click', function() {
    var control = document.getElementById('backtestModelControl');
    var open = control.classList.toggle('open'); this.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('backtestModelControl').addEventListener('keydown', handleBacktestModelKeys);
  document.addEventListener('pointerdown', function(e) {
    var control = document.getElementById('backtestModelControl');
    if (control && !control.contains(e.target)) closeBacktestModelMenu();
  });
  // End backtest model filter.

  var lastBacktestChartSignature = null;
  function renderBacktestChartUncached(arr) {
    var svg = document.getElementById('backtestChart'), empty = document.getElementById('backtestEmptyChart');
    var btCard = svg.closest('.card');
    if (btCard) btCard.classList.toggle('tj-bt-empty', !arr.length);
    if (!arr.length) { svg.style.display = 'none'; empty.style.display = 'flex'; lastBacktestChartSignature = null; svg._tjBtGeo = null; return; }
    svg.style.display = 'block'; empty.style.display = 'none';
    var stats = computeStats(arr), data = stats.chartData;
    var btWrap = svg.closest('.chart-wrap') || svg.parentElement;
    var W = (btWrap ? btWrap.clientWidth : 0) || svg.clientWidth || 800;
    var size = mobileChartSize(svg, W, chartCssHeight(svg) || 300);
    W = size.width;
    var H = size.height, pL = 52, pR = 10, pT = 10, pB = 28;
    var min = Math.min(0, Math.min.apply(null, data.map(function(d) { return d.equity; }))), max = Math.max(0, Math.max.apply(null, data.map(function(d) { return d.equity; })));
    if (min === max) { min -= 1; max += 1; } var pad = (max - min) * .1; min -= pad; max += pad;
    function xp(i) { return pL + i / Math.max(1, data.length - 1) * (W - pL - pR); }
    function yp(v) { return pT + (H - pT - pB) - (v - min) / (max - min) * (H - pT - pB); }
    var pts = data.map(function(d, i) { return { x: xp(i), y: yp(d.equity) }; }), path = smoothPath(pts), zero = yp(0);
    var yLabels = '', yGrid = '', yTicks = 4;
    for (var i = 0; i <= yTicks; i++) {
      var yValue = min + (i / yTicks) * (max - min);
      var yPos = yp(yValue);
      var yText = Math.abs(yValue) >= 10 ? yValue.toFixed(0) : (Math.abs(yValue) >= 2 ? yValue.toFixed(1) : yValue.toFixed(2));
      yGrid += '<line class="chart-grid-line" x1="' + pL + '" y1="' + yPos + '" x2="' + (W - pR) + '" y2="' + yPos + '" />';
      yLabels += '<text data-bt-y="' + i + '" x="4" y="' + (yPos + 4) + '" fill="#7d8798" font-size="12" font-family="TJ Digits, TJ Text, sans-serif">' + yText + 'R</text>';
    }
    var xLabels = '', lastPosition = data.length - 1, xTicks = lastPosition <= 12 ? lastPosition : 8;
    for (var j = 0; j <= xTicks; j++) {
      var position = xTicks ? Math.round((j / xTicks) * lastPosition) : 0;
      xLabels += '<text x="' + xp(position) + '" y="' + (H - 7) + '" fill="#7d8798" font-size="12" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">' + data[position].idx + '</text>';
    }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var activeBt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    var btColor = activeBt && /^#[0-9a-f]{6}$/i.test(String(activeBt.pendingCurveColor || activeBt.curveColor || '')) ? String(activeBt.pendingCurveColor || activeBt.curveColor).toLowerCase() : curveColor;
    var chartSignature = (activeBacktestId || '') + '|' + backtestModelFilterId + '|' + data.map(function(d) { return d.equity; }).join(',');
    var pathClass = chartSignature === lastBacktestChartSignature ? ' no-redraw-anim' : '';
    lastBacktestChartSignature = chartSignature;
    svg.innerHTML = yGrid + yLabels + '<line class="bt-zero" x1="' + pL + '" y1="' + zero + '" x2="' + (W - pR) + '" y2="' + zero + '" stroke="rgba(255,255,255,.15)"/><path class="' + pathClass.trim() + '" d="' + path + '" pathLength="1" fill="none" stroke="' + btColor + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' + xLabels;
    svg._tjBtGeo = { W: W, pL: pL, pR: pR, pT: pT, pB: pB, min: min, max: max, eq: data.map(function(d) { return d.equity; }) };
    svg._tjBtRelayout = false;
  }

  function updateBacktestCurveColourUI() {
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0], color = bt && (bt.pendingCurveColor || bt.curveColor) || curveColor;
    Array.prototype.forEach.call(document.querySelectorAll('[data-bt-colour]'), function(btn) { btn.classList.toggle('active', String(btn.getAttribute('data-bt-colour')).toLowerCase() === String(color).toLowerCase()); });
    var customBtn = document.getElementById('backtestCustomBtn');
    var normalizedColor = String(color).toLowerCase();
    var isPreset = normalizedColor === '#34d399' || normalizedColor === '#8fa3b8';
    var hasCustomColor = !!(bt && /^#[0-9a-f]{6}$/i.test(String(bt.pendingCurveColor || '')) && !isPreset) || !!(bt && /^#[0-9a-f]{6}$/i.test(String(bt.customCurveColor || ''))) || !!(bt && /^#[0-9a-f]{6}$/i.test(String(bt.curveColor || '')) && String(bt.curveColor).toLowerCase() !== '#34d399' && String(bt.curveColor).toLowerCase() !== '#8fa3b8');
    if (customBtn) {
      customBtn.classList.toggle('visible', hasCustomColor);
      customBtn.classList.toggle('active-custom', hasCustomColor && !isPreset);
    }
    var previewDot = document.getElementById('backtestColorPreviewDot');
    var previewHex = document.getElementById('backtestColorHex');
    if (previewDot) previewDot.style.background = color;
    if (previewHex) previewHex.textContent = String(color).toUpperCase();
  }
  function syncBacktestKnobToColor(color) {
    var canvas = document.getElementById('backtestColorWheel'), knob = document.getElementById('backtestColorKnob');
    if (!canvas || !knob || !/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
    var value = String(color).replace('#',''), r = parseInt(value.slice(0,2),16) / 255, g = parseInt(value.slice(2,4),16) / 255, b = parseInt(value.slice(4,6),16) / 255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b), h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) { var d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min); if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
    var rect = canvas.getBoundingClientRect(), radius = Math.max(1, rect.width / 2 - 9), distance = max === min ? 0 : Math.max(4, s * radius), angle = h * Math.PI * 2;
    knob.style.left = (rect.width / 2 + Math.cos(angle) * distance) + 'px'; knob.style.top = (rect.height / 2 + Math.sin(angle) * distance) + 'px'; knob.style.background = color;
  }
  function setBacktestCurveColour(color, rememberCustom) {
    if (!activeBacktestId || !/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0]; if (!bt) return;
    var normalized = String(color).toLowerCase();
    if (!bt.customCurveColor && /^#[0-9a-f]{6}$/i.test(String(bt.curveColor || '')) && bt.curveColor.toLowerCase() !== '#34d399' && bt.curveColor.toLowerCase() !== '#8fa3b8') bt.customCurveColor = bt.curveColor.toLowerCase();
    if (rememberCustom && normalized !== '#34d399' && normalized !== '#8fa3b8') bt.customCurveColor = normalized;
    bt.curveColor = normalized; bt.pendingCurveColor = null; saveBacktestLocal(); updateBacktestCurveColourUI(); renderBacktestChart(backtestTrades);
    var payload = { curveColor: bt.curveColor }; if (bt.customCurveColor) payload.customCurveColor = bt.customCurveColor;
    tjBacktestWrite('backtests',bt.id,payload, { merge: true }).catch(function(err) { console.error('backtest curve colour save failed:', err); });
  }

  function renderBacktests() {
    var list = document.getElementById('backtestsList'), empty = document.getElementById('backtestsEmpty'), detail = document.getElementById('backtestDetailView'), listView = document.getElementById('backtestsListView');
    var addButton = document.getElementById('addBacktestBtn');
    document.body.classList.toggle('backtest-detail-mode', !!activeBacktestId && backtestWorkspaceMode);
    addButton.style.display = activeBacktestId ? 'none' : 'inline-flex';
    addButton.disabled = !backtestsLoadedFlag;
    if (!backtestsLoadedFlag) {
      activeBacktestId = null;
      listView.style.display = 'block'; detail.style.display = 'none'; list.innerHTML = ''; empty.style.display = 'block';
      empty.querySelector('.empty-title').textContent = 'Loading backtests…';
      empty.querySelector('.empty-title').nextElementSibling.textContent = 'Your journal is ready while Backtests finish syncing.';
      return;
    }
    empty.querySelector('.empty-title').textContent = backtestsLoadError ? 'Backtests are available offline' : 'No backtests yet';
    empty.querySelector('.empty-title').nextElementSibling.textContent = backtestsLoadError ? 'The latest cloud refresh did not finish. Pending changes remain protected.' : 'Add a backtest to track a historical strategy range.';
    if (activeBacktestId) {
      listView.style.display = 'none'; detail.style.display = 'block';
      var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0]; if (!bt) { activeBacktestId = null; return renderBacktests(); }
      renderBacktestModelControl();
      var panelHint = document.querySelector('#backtestInputPanel .backtest-panel-hint');
      if (panelHint) panelHint.textContent = bt.source === 'replay'
        ? (backtestModelCatalogue().length ? 'Results from Replay Space. Select a model to explore its performance.' : 'Results from Replay Space. Statistics update as positions close.')
        : 'Paste your trade results in RR — the stats and chart on the right will update instantly.';
      updateBacktestCurveColourUI();
      document.getElementById('backtestDetailTitle').textContent = bt.name || 'Backtest';
      document.getElementById('backtestDetailRange').textContent = fmtBacktestDate(bt.startDate) + ' → ' + fmtBacktestDate(bt.endDate);
      var rrInputEl = document.getElementById('backtestRRInput'), daysInputEl = document.getElementById('backtestDaysTested');
      if (rrInputEl && document.activeElement !== rrInputEl) rrInputEl.value = bt.rrText || '';
      if (rrInputEl) { rrInputEl.readOnly = bt.source === 'replay'; rrInputEl.title = bt.source === 'replay' ? 'Trades come from Replay Space' : ''; }
      if (daysInputEl && document.activeElement !== daysInputEl) daysInputEl.value = bt.daysTested || '';
      backtestTrades = buildBacktestTradesFromRR(bt);
      var rrCountEl = document.getElementById('backtestRRCount');
      if (rrCountEl) rrCountEl.textContent = backtestTrades.length + (backtestTrades.length === 1 ? ' value' : ' values');
      var filteredBacktestTrades = filterBacktestTradesByModel(backtestTrades);
      var s = computeStats(filteredBacktestTrades);
      document.getElementById('backtestTradeCount').textContent = s.total + ' trade' + (s.total === 1 ? '' : 's');
      document.getElementById('backtestTotalRR').textContent = fmtPercent(s.totalPercent); document.getElementById('backtestTotalRR').style.color = s.totalPercent >= 0 ? 'var(--green)' : 'var(--red)';
      var totalRRSubEl = document.getElementById('backtestTotalRRSub');
      if (totalRRSubEl) totalRRSubEl.textContent = s.total + (s.total === 1 ? ' trade' : ' trades');
      document.getElementById('backtestWinRate').textContent = s.winRate.toFixed(1) + '%';
      var winRateSubEl = document.getElementById('backtestWinRateSub');
      if (winRateSubEl) winRateSubEl.textContent = s.wins + 'W / ' + s.losses + 'L';
      document.getElementById('backtestAvgWinRR').textContent = s.wins ? fmtR(s.avgWinningRR) : '0.0R';
      var winningEl = document.getElementById('backtestWinningTrades'); if (winningEl) winningEl.textContent = s.wins;
      var losingEl = document.getElementById('backtestLosingTrades'); if (losingEl) losingEl.textContent = s.losses;
      var maxWinEl = document.getElementById('backtestMaxWinStreak'); if (maxWinEl) maxWinEl.textContent = s.maxWinStreak;
      var maxLoseEl = document.getElementById('backtestMaxLoseStreak'); if (maxLoseEl) maxLoseEl.textContent = s.maxLoseStreak;
      var avgTradesEl = document.getElementById('backtestAvgTradesMonth'); if (avgTradesEl) avgTradesEl.textContent = s.total ? s.avgTradesPerMonth.toFixed(1) : '—';
      var avgGainEl = document.getElementById('backtestAvgGainMonth'); if (avgGainEl) { avgGainEl.textContent = s.total ? fmtPercent(s.avgPercentPerMonth) : '—'; avgGainEl.style.color = s.avgPercentPerMonth >= 0 ? 'var(--green)' : 'var(--red)'; }
      var replayFilterRow = document.getElementById('backtestReplayFilterRow');
      if (replayFilterRow) {
        var rewound = bt.source === 'replay' ? allBacktestTrades.filter(function(t) { return t.backtestId === bt.id && t.afterRewind; }).length : 0;
        replayFilterRow.style.display = rewound ? 'flex' : 'none';
        document.getElementById('backtestReplayFilterLabel').textContent = rewound + ' after cut';
        document.getElementById('backtestFilterAll').classList.toggle('is-on', !bt.cleanOnly);
        document.getElementById('backtestFilterClean').classList.toggle('is-on', !!bt.cleanOnly);
      }
      var daysTestedDisplayEl = document.getElementById('backtestDaysTestedDisplay');
      if (daysTestedDisplayEl) daysTestedDisplayEl.textContent = bt.daysTested ? (bt.daysTested + (bt.daysTested === 1 ? ' day tested' : ' days tested')) : '';
      renderBacktestChart(backtestTrades);
      playBacktestViewTransition(detail);
      return;
    }
    closeBacktestModelMenu();
    listView.style.display = 'block'; detail.style.display = 'none'; empty.style.display = backtests.length ? 'none' : 'block';
    list.innerHTML = backtests.map(function(b) {
      var tradesForBacktest = buildBacktestTradesFromRR(b);
      var stats = computeStats(tradesForBacktest);
      var resultClass = stats.totalPercent > 0 ? 'positive' : (stats.totalPercent < 0 ? 'negative' : 'neutral');
      return '<div class="backtest-item ' + resultClass + '" data-id="' + escapeAttr(b.id) + '"><div class="backtest-item-main"><div class="backtest-item-title">' + escapeHtml(b.name || 'Backtest') + '</div><div class="backtest-item-date">' + fmtBacktestDate(b.startDate) + ' → ' + fmtBacktestDate(b.endDate) + '</div></div><div class="backtest-item-summary"><div class="backtest-item-stat"><div class="backtest-item-stat-label">Total Gain</div><div class="backtest-item-stat-value" style="color:' + (stats.totalPercent >= 0 ? 'var(--green)' : 'var(--red)') + '">' + fmtPercent(stats.totalPercent) + '</div></div><div class="backtest-item-stat"><div class="backtest-item-stat-label">Win Rate</div><div class="backtest-item-stat-value">' + stats.winRate.toFixed(1) + '%</div></div><div class="backtest-item-stat"><div class="backtest-item-stat-label">Trades</div><div class="backtest-item-stat-value">' + stats.total + '</div></div></div><span class="backtest-actions backtest-item-actions"><button class="backtest-icon-btn rename-backtest" type="button" data-id="'+escapeAttr(b.id)+'" title="Rename backtest" aria-label="Rename backtest"><svg class="tj-ui-icon" data-icon="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></button><button class="backtest-icon-btn delete remove-backtest" type="button" data-id="'+escapeAttr(b.id)+'" title="Delete backtest" aria-label="Delete backtest">×</button></span></div>';
    }).join('');
    playBacktestViewTransition(listView);
  }

  function parseRRList(text) {
    if (!text) return [];
    return String(text).split(/[,;\n]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length; })
      .map(function(s) { return Number(s); })
      .filter(function(n) { return Number.isFinite(n)&&Math.abs(n)<=1000000; });
  }

  function buildBacktestTradesFromRR(bt) {
    // Backtests created by Replay Space carry real trades (real dates, risk %), so use them instead of the RR text.
    if (bt && bt.source === 'replay') {
      return allBacktestTrades.filter(function(t) { return t.backtestId === bt.id && !(bt.cleanOnly && t.afterRewind); }).map(normalizeTradeRisk);
    }
    var values = parseRRList(bt && bt.rrText);
    var n = values.length;
    if (!n) return [];
    var days = Math.max(1, Number(bt && bt.daysTested) || n);
    var endDate = bt && bt.endDate ? new Date(bt.endDate) : new Date();
    if (isNaN(endDate.getTime())) endDate = new Date();
    var owner = findUser(viewingUser);
    return values.map(function(r, i) {
      var dayOffset = n > 1 ? Math.round(i * (days - 1) / (n - 1)) : 0;
      var d = new Date(endDate.getTime() - (days - 1 - dayOffset) * 86400000);
      var iso = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T12:00';
      return { id: 'rr' + i, asset: 'Backtest', direction: r >= 0 ? 'LONG' : 'SHORT', openDT: iso, closeDT: iso, r: r, riskPercent: 1, uid: owner ? owner.uid : null, backtestId: bt ? bt.id : null };
    });
  }

  // Typing in RR / days tested updates the backtest in memory at once, but the
  // re-render, the local copy and the server write wait for a short pause (or
  // blur / leaving the page), instead of running on every keystroke.
  var TJ_BACKTEST_RR_DEBOUNCE_MS = 500;
  var backtestRRSaveTimer = null, tjBacktestRRPending = null, tjBacktestRRDrafts = {};
  function tjStoreBacktestRRDraftLocally(draft) {
    // Keyed by the draft owner, so a switch of the viewed account can never
    // write one user's backtests under another user's key.
    try {
      var key = 'syter_backtests_v1_' + draft.user;
      var list = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(list)) return;
      var changed = false;
      list.forEach(function(item) {
        if (item && item.id === draft.id) { item.rrText = draft.rrText; item.daysTested = draft.daysTested; changed = true; }
      });
      if (changed) localStorage.setItem(key, JSON.stringify(list));
    } catch (e) { console.error('Could not save Backtests locally:', e); }
  }
  function flushBacktestRRDraft() {
    var draft = tjBacktestRRPending;
    clearTimeout(backtestRRSaveTimer); backtestRRSaveTimer = null;
    if (!draft) return;
    tjBacktestRRPending = null;
    if (draft.user === viewingUser) saveBacktestLocal(); else tjStoreBacktestRRDraftLocally(draft);
    tjBacktestWrite('backtests',draft.id,{ rrText: draft.rrText, daysTested: draft.daysTested }, { merge: true }, draft.user).then(function() {
      if (tjBacktestRRDrafts[draft.id] === draft) delete tjBacktestRRDrafts[draft.id];
    }).catch(function(err) {
      console.error('backtest rr save failed:', err);
      if (viewingUser === draft.user) showBacktestSyncError('The data was saved on this device, but could not be synced. Check your connection.');
    });
  }
  function commitBacktestRRDraft() {
    var draft = tjBacktestRRPending;
    flushBacktestRRDraft();
    if (draft && draft.user === viewingUser) renderBacktests();
  }
  function updateActiveBacktestFromInputs() {
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    if (!bt) return;
    if (tjBacktestRRPending && tjBacktestRRPending.id !== bt.id) commitBacktestRRDraft();
    var rrInputEl = document.getElementById('backtestRRInput'), daysInputEl = document.getElementById('backtestDaysTested');
    var draft = { id: bt.id, user: viewingUser, rrText: rrInputEl ? rrInputEl.value : '', daysTested: (daysInputEl && daysInputEl.value !== '') ? Number(daysInputEl.value) : null };
    bt.rrText = draft.rrText; bt.daysTested = draft.daysTested;
    tjBacktestRRDrafts[bt.id] = draft; tjBacktestRRPending = draft;
    showBacktestSyncError('');
    clearTimeout(backtestRRSaveTimer);
    backtestRRSaveTimer = setTimeout(commitBacktestRRDraft, TJ_BACKTEST_RR_DEBOUNCE_MS);
  }

  function playBacktestViewTransition(view) {
    if (!backtestViewTransition || !view) return;
    view.classList.remove('backtest-view-enter');
    void view.offsetWidth;
    view.classList.add('backtest-view-enter');
    backtestViewTransition = null;
    setTimeout(function() { view.classList.remove('backtest-view-enter'); }, 1050);
  }

  function fmtR(n) {
    if(!Number.isFinite(n))return 'Invalid R';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + 'R';
  }

  function tradeRiskPercent(trade) {
    var risk = Number(trade && trade.riskPercent);
    return isFinite(risk) && risk >= 0 ? risk : 1;
  }

  function tradeGainPercent(trade) {
    var value=(Number(trade && trade.r)||0)*tradeRiskPercent(trade);
    if(!Number.isFinite(value))return NaN;
    return value;
  }

  function fmtPercent(n) {
    if(!Number.isFinite(Number(n)))return 'Invalid %';
    var value = Number(n) || 0;
    var sign = value > 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  }

  function fmtTradeResult(trade) {
    return fmtPercent(tradeGainPercent(trade)) + ' · ' + fmtR(Number(trade && trade.r) || 0);
  }

  function normalizeTradeRisk(trade) {
    if (trade && (!isFinite(Number(trade.riskPercent)) || Number(trade.riskPercent) < 0)) trade.riskPercent = 1;
    return trade;
  }

  function fmtDT(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var day = d.getDate();
    var mon = RU_MONTHS_SHORT[d.getMonth()];
    var hh = pad2(d.getHours());
    var mm = pad2(d.getMinutes());
    return day + ' ' + mon + ', ' + hh + ':' + mm;
  }

  function fmtBacktestDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + EN_MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
  }

  function validateTradeDateOrder(openDT, closeDT, error) {
    if (new Date(openDT).getTime() <= new Date(closeDT).getTime()) return true;
    error = error || document.getElementById('saveError');
    error.style.display = 'block';
    error.textContent = 'Close date cannot be earlier than open date.';
    if (error.parentElement === inlineEditPopup) {
      var box = inlineEditPopup.getBoundingClientRect();
      if (box.bottom > window.innerHeight - 6) inlineEditPopup.style.top = Math.max(6, window.innerHeight - box.height - 6) + 'px';
    }
    return false;
  }

  function formatHolding(openISO, closeISO) {
    if (!openISO || !closeISO) return '—';
    var diff = new Date(closeISO) - new Date(openISO);
    if (isNaN(diff) || diff < 0) return '—';
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + mins + 'm';
    return mins + 'm';
  }

  function monthsBetween(a, b) {
    var d1 = new Date(a), d2 = new Date(b);
    return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
  }

  function assetFiltered(arr) {
    if (assetFilter === 'ALL') return arr.slice();
    return arr.filter(function(t) { return t.asset === assetFilter; });
  }

  // Statistics are booked on the close date: a trade affects the journal
  // only in the period in which it was actually closed.
  function tradeStatsDate(trade) {
    var raw = trade && (trade.closeDT || trade.openDT);
    var d = new Date(raw || 0);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  function sortedAsc(arr) {
    return arr.slice().sort(function(a, b) { return tradeStatsDate(a) - tradeStatsDate(b); });
  }

  function computeStats(arr) {
    var invalid=arr.filter(function(t){var rawRisk=t.riskPercent;return (rawRisk!=null&&rawRisk!==''&&(!Number.isFinite(Number(rawRisk))||Number(rawRisk)<0||Number(rawRisk)>100))||!Number.isFinite(Number(t.r))||Math.abs(Number(t.r))>1000000||!Number.isFinite(tradeGainPercent(t))||tradeRiskPercent(t)>100;});
    if(invalid.length&&typeof tjNotice==='function')tjNotice('stats','warn','Некоторые сделки выходят за поддерживаемый числовой диапазон и не учитываются в статистике. Сохранённые данные не удалены — экспортируйте и исправьте эти сделки.');
    var sorted = sortedAsc(arr.filter(function(t){return invalid.indexOf(t)<0;}));
    var total = sorted.length;
    var wins = sorted.filter(function(t) { return Number(t.r) > 0; });
    var losses = sorted.filter(function(t) { return Number(t.r) < 0; });
    var totalRR = sorted.reduce(function(s, t) { return s + (Number(t.r) || 0); }, 0);
    var totalPercent = sorted.reduce(function(s, t) { return s + tradeGainPercent(t); }, 0);
    var winRate = total ? (wins.length / total) * 100 : 0;
    var avgWinningRR = wins.length ? wins.reduce(function(s, t) { return s + (Number(t.r) || 0); }, 0) / wins.length : 0;
    var avgWinningPercent = wins.length ? wins.reduce(function(s, t) { return s + tradeGainPercent(t); }, 0) / wins.length : 0;

    var maxWinStreak = 0, maxLoseStreak = 0, curWin = 0, curLose = 0;
    sorted.forEach(function(t) {
      if (Number(t.r) > 0) { curWin++; curLose = 0; } else if (Number(t.r) < 0) { curLose++; curWin = 0; } else { curWin = 0; curLose = 0; }
      maxWinStreak = Math.max(maxWinStreak, curWin);
      maxLoseStreak = Math.max(maxLoseStreak, curLose);
    });

    var avgTradesPerMonth = total, avgRRPerMonth = totalRR, avgPercentPerMonth = totalPercent;
    if (total > 1) {
      var first = tradeStatsDate(sorted[0]), last = tradeStatsDate(sorted[sorted.length - 1]);
      var months = Math.max(1, monthsBetween(first, last));
      avgTradesPerMonth = total / months;
      avgRRPerMonth = totalRR / months;
      avgPercentPerMonth = totalPercent / months;
    }

    var chartData = [{ idx: 0, equity: 0, trade: null }];
    var percentChartData = [{ idx: 0, equity: 0, rrEquity: 0, trade: null, unit: '%' }];
    var cum = 0;
    var percentCum = 0;
    sorted.forEach(function(t, i) {
      cum += Number(t.r) || 0;
      chartData.push({ idx: i + 1, equity: +cum.toFixed(2), trade: t });
      percentCum += tradeGainPercent(t);
      percentChartData.push({ idx: i + 1, equity: +percentCum.toFixed(2), rrEquity: +cum.toFixed(2), trade: t, unit: '%' });
    });

    return {
      total: total, wins: wins.length, losses: losses.length, totalRR: totalRR, totalPercent: totalPercent,
      winRate: winRate, avgWinningRR: avgWinningRR, avgWinningPercent: avgWinningPercent, maxWinStreak: maxWinStreak,
      maxLoseStreak: maxLoseStreak, avgTradesPerMonth: avgTradesPerMonth,
      avgRRPerMonth: avgRRPerMonth, avgPercentPerMonth: avgPercentPerMonth,
      chartData: chartData, percentChartData: percentChartData, winsArr: wins
    };
  }

  function smoothPath(points) {
    if (points.length < 2) return '';
    /* Monotone cubic interpolation: it keeps the marker-like softness while
       preventing Bézier overshoot and unnatural rebounds between trades. */
    var n = points.length, slopes = [], tangents = [];
    for (var i = 0; i < n - 1; i++) {
      var dx = points[i + 1].x - points[i].x;
      slopes[i] = dx ? (points[i + 1].y - points[i].y) / dx : 0;
    }
    tangents[0] = slopes[0];
    tangents[n - 1] = slopes[n - 2];
    for (var j = 1; j < n - 1; j++) {
      if (slopes[j - 1] * slopes[j] <= 0) tangents[j] = 0;
      else tangents[j] = (slopes[j - 1] + slopes[j]) / 2;
    }
    for (var k = 0; k < n - 1; k++) {
      var s = slopes[k];
      if (s === 0) { tangents[k] = 0; tangents[k + 1] = 0; continue; }
      var a = tangents[k] / s, b = tangents[k + 1] / s;
      var h = Math.sqrt(a * a + b * b);
      if (h > 3) { var scale = 3 / h; tangents[k] = scale * a * s; tangents[k + 1] = scale * b * s; }
    }
    var d = 'M ' + points[0].x + ',' + points[0].y + ' ';
    for (var q = 0; q < n - 1; q++) {
      var p1 = points[q], p2 = points[q + 1], span = p2.x - p1.x;
      var cp1x = p1.x + span / 3, cp1y = p1.y + tangents[q] * span / 3;
      var cp2x = p2.x - span / 3, cp2y = p2.y - tangents[q + 1] * span / 3;
      d += 'C ' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + p2.x + ',' + p2.y + ' ';
    }
    return d;
  }

  var activeChartMarker = null;
  var chartTooltipMarker = null;
  var chartTooltipHideTimer = null;
  var chartTooltipOpenAction = null;

  function closeChartTradeCard() {
    var card = document.getElementById('chartTradeCard');
    if (card) {
      card.classList.remove('open');
      card.setAttribute('aria-hidden', 'true');
    }
    if (activeChartMarker) activeChartMarker.setAttribute('opacity', '0');
    var ovSvg = document.getElementById('chartSvg');
    if (ovSvg && ovSvg._tjHover && activeChartMarker === ovSvg._tjHover.dot && !ovSvg._tjHover.on && ovSvg._tjHover.g) ovSvg._tjHover.g.classList.remove('on');
    activeChartMarker = null;
  }

  function hideChartTooltip() {
    if (chartTooltipHideTimer) clearTimeout(chartTooltipHideTimer);
    chartTooltipHideTimer = null;
    var tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.classList.remove('open', 'tj-pinned');
    chartTooltipOpenAction = null;
    chartTooltipMarker = null;
  }

  function scheduleChartTooltipHide(marker) {
    if (chartTooltipHideTimer) clearTimeout(chartTooltipHideTimer);
    chartTooltipHideTimer = setTimeout(function() {
      var tooltip = document.getElementById('tooltip');
      if (tooltip) tooltip.classList.remove('open', 'tj-pinned');
      if (marker && activeChartMarker !== marker) marker.setAttribute('opacity', '0');
      chartTooltipOpenAction = null;
      chartTooltipMarker = null;
      chartTooltipHideTimer = null;
    }, 220);
  }

  function curveOverlapScore(rect, curvePoints) {
    var clearance = 18, score = 0;
    var right = rect.left + rect.width, bottom = rect.top + rect.height;
    for (var i = 0; i < curvePoints.length; i++) {
      var point = curvePoints[i];
      var dx = point.x < rect.left ? rect.left - point.x : (point.x > right ? point.x - right : 0);
      var dy = point.y < rect.top ? rect.top - point.y : (point.y > bottom ? point.y - bottom : 0);
      var distance = Math.hypot(dx, dy);
      if (distance < clearance) {
        var intrusion = clearance - distance;
        score += 10000 + intrusion * intrusion * 100;
      }
    }
    return score;
  }

  function positionChartTooltip(element, anchorX, anchorY, curvePoints) {
    var wrap = document.querySelector('#chartSvg').closest('.chart-wrap');
    var edge = 8, gap = 20;
    element.style.left = edge + 'px';
    element.style.top = edge + 'px';
    var width = element.offsetWidth, height = element.offsetHeight;
    var maxLeft = Math.max(edge, wrap.clientWidth - width - edge);
    var maxTop = Math.max(edge, wrap.clientHeight - height - edge);
    function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
    function addUnique(list, value) {
      value = Math.round(clamp(value, edge, list === lefts ? maxLeft : maxTop));
      if (list.indexOf(value) === -1) list.push(value);
    }

    var lefts = [], tops = [];
    addUnique(lefts, anchorX + gap);
    addUnique(lefts, anchorX - width - gap);
    addUnique(lefts, anchorX - width / 2);
    addUnique(lefts, edge);
    addUnique(lefts, maxLeft);
    /* The curve can pass through any corner of the card, so inspect the full
       usable width rather than only a few positions around the active point. */
    for (var scanLeft = edge; scanLeft <= maxLeft; scanLeft += 8) addUnique(lefts, scanLeft);

    addUnique(tops, anchorY - height - gap);
    addUnique(tops, anchorY + gap);
    for (var scanTop = edge; scanTop <= maxTop; scanTop += 6) addUnique(tops, scanTop);
    addUnique(tops, maxTop);

    var candidates = [];
    lefts.forEach(function(left) {
      tops.forEach(function(top) {
        candidates.push({
          left:left,
          top:top,
          above:top + height / 2 < anchorY,
          leftSide:left + width / 2 < anchorX
        });
      });
    });
    var best = candidates[0] || { left:edge, top:edge, above:false, leftSide:false };
    var bestScore = Infinity;
    candidates.forEach(function(candidate) {
      var score = curveOverlapScore({ left:candidate.left, top:candidate.top, width:width, height:height }, curvePoints || []);
      var centerX = candidate.left + width / 2, centerY = candidate.top + height / 2;
      /* Collision cost dominates. Distance only chooses the nearest among
         equally clear positions, keeping the card connected to its marker. */
      score += Math.hypot(centerX - anchorX, centerY - anchorY) * .06;
      if (score < bestScore) { best = candidate; bestScore = score; }
    });
    element.classList.toggle('above', best.above);
    element.classList.toggle('left-side', best.leftSide);
    element.style.left = Math.round(best.left) + 'px';
    element.style.top = Math.round(best.top) + 'px';
  }

  function showChartTooltip(point, marker, anchorX, anchorY, curvePoints) {
    if (!point.trade) return;
    if (chartTooltipHideTimer) clearTimeout(chartTooltipHideTimer);
    chartTooltipHideTimer = null;
    if (chartTooltipMarker && chartTooltipMarker !== marker) {
      chartTooltipMarker.setAttribute('opacity', '0');
    }
    chartTooltipMarker = marker;
    chartTooltipOpenAction = function() { openChartTradeCard(point, marker, anchorX, anchorY, curvePoints); };
    var tooltip = document.getElementById('tooltip');
    var color = tradeResultColor(point.trade);
    tooltip.innerHTML = '<div class="chart-tooltip-title">Trade #' + tradeNumberOf(point.trade) + '</div>' +
      '<div class="trade-model-meta"><span class="card-sub">Модель</span>' + tradeModelHTML(point.trade) + '</div>' +
      '<div class="chart-tooltip-result mono" style="color:' + color + '">' + fmtPercent(tradeGainPercent(point.trade)) + '</div>' +
      '<div class="chart-tooltip-hint">' + tjPinHintText() + '</div>';
    tooltip.classList.add('open');
    // The smooth hover positions the card every frame next to its gliding dot.
    if (!(marker && marker.classList && marker.classList.contains('tj-hover-dot'))) positionChartTooltip(tooltip, anchorX, anchorY, curvePoints);
  }

  function openChartTradeCard(point) {
    if (!point.trade) return;
    closeChartTradeCard();
    hideChartTooltip();
    openBestTrade(point.trade.id);
  }

  function overviewChartDomain(values) {
    var minY = Math.min(0, Math.min.apply(null, values));
    var maxY = Math.max(0, Math.max.apply(null, values));
    if (minY === maxY) { minY -= 1; maxY += 1; }
    var yPad = (maxY - minY) * 0.1;
    return { min: minY - yPad, max: maxY + yPad };
  }
  function overviewChartEntries(chartData) {
    var n = chartData.length;
    /* X is the ordinal trade position, never the numeric trade id. */
    return chartData.map(function(d, position) {
      return { key: overviewChartPointKey(d, position), xf: position / Math.max(1, n - 1), eq: d.equity };
    });
  }
  function overviewChartFrame(g, entries, domain) {
    function yPix(y) { return g.padT + g.innerH - ((y - domain.min) / (domain.max - domain.min || 1)) * g.innerH; }
    var pts = entries.map(function(e) { return { x: g.padL + e.xf * g.innerW, y: yPix(e.eq) }; });
    var linePath = smoothPath(pts);
    var zeroY = yPix(0);
    var areaPath = linePath + ' L ' + pts[pts.length - 1].x + ',' + zeroY + ' L ' + pts[0].x + ',' + zeroY + ' Z';
    return { pts: pts, linePath: linePath, areaPath: areaPath, zeroY: zeroY };
  }
  function overviewChartYLabel(val, unit) {
    return (unit === '%' ? val.toFixed(1) : Math.round(val)) + unit;
  }
  function overviewChartXLabels(chartData, g) {
    /* Labels use actual ordinal trade positions. A whole-number step keeps
       long-series labels regular instead of producing uneven rounded gaps. */
    var pointCount = chartData.length;
    function xPix(position) { return g.padL + (position / Math.max(1, pointCount - 1)) * g.innerW; }
    var realTradeCount = pointCount - 1;
    var maxXLabels = Math.max(2, Math.floor(g.innerW / 34));
    var xLabelStep = Math.max(1, Math.ceil(realTradeCount / maxXLabels));
    var xLabels = '', lastLabeledPosition = 0;
    for (var position = 1; position < pointCount; position += xLabelStep) {
      xLabels += '<text x="' + xPix(position) + '" y="' + (g.H - 7) + '" fill="#7d8798" font-size="12" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">' + chartData[position].idx + '</text>';
      lastLabeledPosition = position;
    }
    if (lastLabeledPosition !== pointCount - 1) {
      var lastPosition = pointCount - 1;
      xLabels += '<text x="' + xPix(lastPosition) + '" y="' + (g.H - 7) + '" fill="#7d8798" font-size="12" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">' + chartData[lastPosition].idx + '</text>';
    }
    return xLabels;
  }

  function renderChartUncached(chartData, opts) {
    opts = opts || {};
    var st = overviewChartState;
    stopOverviewChartAnimation();
    lastChartData = chartData;
    var svg = document.getElementById('chartSvg');
    var empty = document.getElementById('emptyChart');
    hideChartTooltip();
    closeChartTradeCard();
    if (chartData.length <= 1) {
      svg.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    svg.style.display = 'block';
    empty.style.display = 'none';

    /* Read width from the wrapping container rather than the SVG itself.
       svg.clientWidth is 0 on first render because the browser hasn't done
       a layout pass yet after switching display:none → display:block.
       The parent .chart-wrap is always in the normal flow and has a real
       measured width even before the SVG is laid out. */
    var chartWrap = svg.closest('.chart-wrap') || svg.parentElement;
    var W = (chartWrap ? chartWrap.clientWidth : 0) || svg.clientWidth || 800;
    var size = mobileChartSize(svg, W, chartCssHeight(svg) || 380);
    W = size.width;
    var H = size.height;
    var padL = 52, padR = 10, padT = 10, padB = 28;
    var g = { W: W, H: H, padL: padL, padR: padR, padT: padT, padB: padB, innerW: W - padL - padR, innerH: H - padT - padB };

    var entries = overviewChartEntries(chartData);
    var domain = overviewChartDomain(chartData.map(function(d) { return d.equity; }));
    var frame = overviewChartFrame(g, entries, domain);
    var chartUnit = chartData[0] && chartData[0].unit ? chartData[0].unit : 'R';

    var yTicks = 4, yLabels = '', yGrid = '';
    for (var i = 0; i <= yTicks; i++) {
      var val = domain.min + (i / yTicks) * (domain.max - domain.min);
      var py = g.padT + g.innerH - (i / yTicks) * g.innerH;
      /* Faint dashed guide lines, matching the monthly equity curve's grid style. */
      yGrid += '<line class="chart-grid-line" x1="' + padL + '" y1="' + py + '" x2="' + (W - padR) + '" y2="' + py + '" />';
      yLabels += '<text data-tj-ylabel="' + i + '" x="4" y="' + (py + 4) + '" fill="#7d8798" font-size="12" font-family="TJ Digits, TJ Text, sans-serif">' + overviewChartYLabel(val, chartUnit) + '</text>';
    }

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML =
      '<defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + curveColor + '" stop-opacity="0.13"/>' +
      '<stop offset="100%" stop-color="' + curveColor + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      yGrid +
      yLabels +
      '<line data-tj-zero="1" x1="' + padL + '" y1="' + frame.zeroY + '" x2="' + (W - padR) + '" y2="' + frame.zeroY + '" stroke="rgba(255,255,255,0.15)" />' +
      '<path d="' + frame.areaPath + '" fill="url(#grad)" stroke="none" class="chart-area-path" />' +
      /* A broad, round marker-like stroke keeps the curve soft and elongated
         instead of looking like a thin technical plot line. */
      '<path id="chartLinePath" d="' + frame.linePath + '" fill="none" stroke="' + curveColor + '" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" />' +
      '<g data-tj-xlabels="1">' + overviewChartXLabels(chartData, g) + '</g>' +
      '<g data-tj-hits="1"></g>';
    tjFreezeChartAnim(svg);
    if (tjChartResizing) opts.drawIn = false;

    // Draw the equity line in, left to right — only when the chart first appears.
    var linePathEl = document.getElementById('chartLinePath');
    if (opts.drawIn && !mobilePerformanceEnabled() && linePathEl && linePathEl.getTotalLength) {
      var len = linePathEl.getTotalLength();
      linePathEl.style.strokeDasharray = len;
      linePathEl.style.strokeDashoffset = len;
      linePathEl.style.transition = 'none';
      void linePathEl.getBoundingClientRect();
      linePathEl.style.transition = 'stroke-dashoffset 0.9s var(--easeOut)';
      linePathEl.style.strokeDashoffset = '0';
    }

    st.geom = g;
    st.entries = entries;
    st.domain = domain;
    st.unit = chartUnit;
    st.color = curveColor;
    st.data = chartData;
    st.drawn = true;
    buildOverviewChartHits(svg, chartData, frame.pts, W, H);
  }

  function rebuildOverviewChartHits(chartData) {
    var st = overviewChartState, svg = document.getElementById('chartSvg');
    if (!svg || !st.geom || !st.entries || st.entries.length !== chartData.length) return;
    hideChartTooltip();
    closeChartTradeCard();
    var frame = overviewChartFrame(st.geom, st.entries, st.domain);
    buildOverviewChartHits(svg, chartData, frame.pts, st.geom.W, st.geom.H);
  }

  function overviewHoverAnchor(svg, W, H, p) {
    var svgRect = svg.getBoundingClientRect();
    var wrapRect = svg.closest('.chart-wrap').getBoundingClientRect();
    var offsetX = svgRect.left - wrapRect.left, offsetY = svgRect.top - wrapRect.top;
    var scaleX = svgRect.width / W, scaleY = svgRect.height / H;
    var curvePoints = [];
    var curvePath = document.getElementById('chartLinePath');
    if (curvePath && curvePath.getTotalLength) {
      var curveLength = curvePath.getTotalLength();
      for (var at = 0; at <= curveLength; at += 6) {
        var cp = curvePath.getPointAtLength(at);
        curvePoints.push({ x: offsetX + cp.x * scaleX, y: offsetY + cp.y * scaleY });
      }
    }
    return { x: offsetX + p.x * scaleX, y: offsetY + p.y * scaleY, curvePoints: curvePoints };
  }
  function attachOverviewHover(svg, chartData, pts, W, H) {
    var g0 = overviewChartState.geom;
    var lineEl = document.getElementById('chartLinePath');
    tjSetHoverModel(svg, {
      W: W, H: H, pts: pts, data: chartData, d: lineEl ? lineEl.getAttribute('d') : smoothPath(pts),
      top: g0 ? g0.padT : 10, bottom: g0 ? g0.padT + g0.innerH : H - 28, color: curveColor,
      onEnter: function(idx) {
        // Hot path: runs every time the gliding dot reaches a new trade.
        // Do NOT sample the whole curve here (getPointAtLength along the full
        // path forces heavy synchronous work and made the overview hover
        // stutter). The dot positions the tooltip each frame via onFrame;
        // the full curve anchor is only needed when the trade card opens.
        var point = chartData[idx], dot = svg._tjHover.dot;
        showChartTooltip(point, dot, 0, 0, null);
        chartTooltipOpenAction = function() {
          var a = overviewHoverAnchor(svg, W, H, pts[idx]);
          openChartTradeCard(point, dot, a.x, a.y, a.curvePoints);
        };
      },
      onFrame: function(idx, x, y) {
        var tip = document.getElementById('tooltip');
        if (tip && tip.classList.contains('open')) placeDetailTooltip(svg, tip, W, H, x, y);
      },
      onLeave: function() { scheduleChartTooltipHide(null); },
      keepOn: function() { return !!(svg._tjHover && activeChartMarker === svg._tjHover.dot); },
      onClick: function() { if (chartTooltipOpenAction) chartTooltipOpenAction(); },
      tip: function() { return document.getElementById('tooltip'); },
      onPin: function() {
        if (chartTooltipHideTimer) { clearTimeout(chartTooltipHideTimer); chartTooltipHideTimer = null; }
        var card = document.getElementById('chartTradeCard');
        if (card && card.classList.contains('open')) { card.classList.remove('open'); card.setAttribute('aria-hidden', 'true'); activeChartMarker = null; }
        var tip = document.getElementById('tooltip');
        tip.classList.add('open');
        tjPinHint(tip, true);
      },
      onUnpin: function() { tjPinHint(document.getElementById('tooltip'), false); }
    });
  }

  function buildOverviewChartHits(svg, chartData, pts, W, H) {
    attachOverviewHover(svg, chartData, pts, W, H);
    var layer = svg.querySelector('g[data-tj-hits]');
    if (!layer) return;
    layer.replaceChildren();
    chartData.forEach(function(d, idx) {
      if (!d.trade) return;
      var cx = pts[idx].x, cy = pts[idx].y;
      var marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('cx', cx); marker.setAttribute('cy', cy); marker.setAttribute('r', 3.2);
      marker.setAttribute('fill', curveColor);
      marker.setAttribute('data-tj-marker', '1');
      marker.setAttribute('stroke', '#050608');
      marker.setAttribute('stroke-width', '1.5');
      marker.setAttribute('opacity', '0');
      marker.setAttribute('pointer-events', 'none');
      marker.style.transition = 'opacity .14s var(--ease), transform .14s var(--ease)';
      layer.appendChild(marker);
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 8);
      c.setAttribute('fill', 'transparent');
      c.setAttribute('class', 'chart-hit-area');
      c.setAttribute('aria-label', 'Trade #' + tradeNumberOf(d.trade) + ', result ' + fmtPercent(tradeGainPercent(d.trade)));
      function getPointAnchor() {
        var svgRect = svg.getBoundingClientRect();
        var wrapRect = svg.closest('.chart-wrap').getBoundingClientRect();
        var offsetX = svgRect.left - wrapRect.left;
        var offsetY = svgRect.top - wrapRect.top;
        var scaleX = svgRect.width / W;
        var scaleY = svgRect.height / H;
        var curvePoints = [];
        var curvePath = document.getElementById('chartLinePath');
        if (curvePath && curvePath.getTotalLength) {
          var curveLength = curvePath.getTotalLength();
          for (var curveAt = 0; curveAt <= curveLength; curveAt += 6) {
            var curvePoint = curvePath.getPointAtLength(curveAt);
            curvePoints.push({ x:offsetX + curvePoint.x * scaleX, y:offsetY + curvePoint.y * scaleY });
          }
          var curveEnd = curvePath.getPointAtLength(curveLength);
          curvePoints.push({ x:offsetX + curveEnd.x * scaleX, y:offsetY + curveEnd.y * scaleY });
        } else {
          curvePoints = pts.map(function(p) {
            return { x:offsetX + p.x * scaleX, y:offsetY + p.y * scaleY };
          });
        }
        return {
          x: offsetX + cx * scaleX,
          y: offsetY + cy * scaleY,
          curvePoints: curvePoints
        };
      }
      c.addEventListener('pointerenter', function() {
        marker.setAttribute('opacity', '1');
        var anchor = getPointAnchor();
        showChartTooltip(d, marker, anchor.x, anchor.y, anchor.curvePoints);
      });
      c.addEventListener('pointerleave', function() {
        scheduleChartTooltipHide(marker);
      });
      layer.appendChild(c);
    });
  }

  function applyOverviewChartColor() {
    var svg = document.getElementById('chartSvg');
    overviewChartState.color = curveColor;
    if (!svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll('#grad stop'), function(stop) { stop.setAttribute('stop-color', curveColor); });
    var line = document.getElementById('chartLinePath');
    if (line) line.setAttribute('stroke', curveColor);
    Array.prototype.forEach.call(svg.querySelectorAll('circle[data-tj-marker]'), function(m) { m.setAttribute('fill', curveColor); });
    if (svg._hoverModel) { svg._hoverModel.color = curveColor; if (svg._tjHover && svg._tjHover.dot) svg._tjHover.dot.setAttribute('fill', curveColor); }
  }

  function stopOverviewChartAnimation() {
    var st = overviewChartState;
    if (st.anim && st.anim.raf) cancelAnimationFrame(st.anim.raf);
    st.anim = null;
  }

  // Morph the existing line into the new one in value space: points are matched
  // by trade id, new trades grow out of their neighbour, removed trades collapse
  // into it, and the Y range eases so the whole curve rescales smoothly.
  function morphOverviewChart(chartData) {
    var st = overviewChartState;
    var svg = document.getElementById('chartSvg');
    var line = document.getElementById('chartLinePath');
    var area = svg && svg.querySelector('.chart-area-path');
    var zero = svg && svg.querySelector('line[data-tj-zero]');
    if (!svg || !line || !area || !zero || !st.geom) { renderChartUncached(chartData, { drawIn: false }); return; }
    var from = st.anim ? st.anim.current : st.entries;
    var fromDomain = st.anim ? st.anim.currentDomain : st.domain;
    stopOverviewChartAnimation();
    hideChartTooltip();
    closeChartTradeCard();
    tjSetHoverModel(svg, null);
    lastChartData = chartData;

    var to = overviewChartEntries(chartData);
    var toDomain = overviewChartDomain(chartData.map(function(d) { return d.equity; }));
    var toKeys = {}, fromByKey = {};
    to.forEach(function(e) { toKeys[e.key] = true; });
    from.forEach(function(e) { fromByKey[e.key] = e; });

    // Removed points ride along with the nearest surviving predecessor.
    var removedAfter = {}, pred = '__start__';
    from.forEach(function(e) {
      if (toKeys[e.key]) { pred = e.key; return; }
      (removedAfter[pred] = removedAfter[pred] || []).push(e);
    });
    var merged = [];
    function pushRemoved(key) {
      (removedAfter[key] || []).forEach(function(e) {
        var prev = merged[merged.length - 1];
        merged.push({ key: e.key, removed: true, a: { xf: e.xf, eq: e.eq }, b: prev ? prev.b : { xf: e.xf, eq: e.eq } });
      });
    }
    pushRemoved('__start__');
    to.forEach(function(e) {
      var old = fromByKey[e.key], prev = merged[merged.length - 1];
      var a = old ? { xf: old.xf, eq: old.eq } : (prev ? { xf: prev.a.xf, eq: prev.a.eq } : { xf: e.xf, eq: e.eq });
      merged.push({ key: e.key, removed: false, a: a, b: { xf: e.xf, eq: e.eq } });
      pushRemoved(e.key);
    });

    line.style.transition = 'none';
    line.style.strokeDasharray = '';
    line.style.strokeDashoffset = '';
    var layer = svg.querySelector('g[data-tj-hits]');
    if (layer) layer.replaceChildren();
    var labels = svg.querySelectorAll('text[data-tj-ylabel]');
    var g = st.geom, unit = st.unit, duration = 650, start = null;
    function lerp(a, b, t) { return a + (b - a) * t; }
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    var anim = st.anim = { raf: null, current: from, currentDomain: fromDomain, data: chartData };
    function paint(t) {
      var entries = merged.map(function(m) { return { key: m.key, removed: m.removed, xf: lerp(m.a.xf, m.b.xf, t), eq: lerp(m.a.eq, m.b.eq, t) }; });
      var domain = { min: lerp(fromDomain.min, toDomain.min, t), max: lerp(fromDomain.max, toDomain.max, t) };
      // Points that currently coincide with their neighbour (just born / fully
      // collapsed) are not drawn, so the first and last frames match the real curves.
      var drawn = entries.filter(function(e, i) {
        var p = entries[i - 1];
        return !p || Math.abs(e.xf - p.xf) > 1e-6 || Math.abs(e.eq - p.eq) > 1e-9;
      });
      var frame = overviewChartFrame(g, drawn.length > 1 ? drawn : entries, domain);
      line.setAttribute('d', frame.linePath);
      area.setAttribute('d', frame.areaPath);
      zero.setAttribute('y1', frame.zeroY);
      zero.setAttribute('y2', frame.zeroY);
      Array.prototype.forEach.call(labels, function(label) {
        var i = Number(label.getAttribute('data-tj-ylabel'));
        var text = overviewChartYLabel(domain.min + (i / 4) * (domain.max - domain.min), unit);
        if (label.textContent !== text) label.textContent = text;
      });
      anim.current = entries.filter(function(e) { return !e.removed; });
      anim.currentDomain = domain;
    }
    function step(now) {
      if (st.anim !== anim) return;
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / duration);
      paint(ease(p));
      if (p < 1) { anim.raf = requestAnimationFrame(step); return; }
      st.anim = null;
      st.entries = to;
      st.domain = toDomain;
      st.data = anim.data;
      // Settle on the exact final geometry (collapsed points are dropped).
      var finalFrame = overviewChartFrame(g, to, toDomain);
      line.setAttribute('d', finalFrame.linePath);
      area.setAttribute('d', finalFrame.areaPath);
      zero.setAttribute('y1', finalFrame.zeroY);
      zero.setAttribute('y2', finalFrame.zeroY);
      var xl = svg.querySelector('g[data-tj-xlabels]');
      if (xl) xl.innerHTML = overviewChartXLabels(anim.data, g);
      buildOverviewChartHits(svg, anim.data, finalFrame.pts, g.W, g.H);
    }
    anim.raf = requestAnimationFrame(step);
    if (st.color !== curveColor) applyOverviewChartColor();
    st.data = chartData;
  }

  document.getElementById('tooltip').addEventListener('pointerenter', function() {
    if (chartTooltipHideTimer) clearTimeout(chartTooltipHideTimer);
    chartTooltipHideTimer = null;
  });
  document.getElementById('tooltip').addEventListener('pointerleave', function() {
    var ov = document.getElementById('chartSvg');
    if (ov && ov._tjHover && ov._tjHover.pinned) return;
    scheduleChartTooltipHide(chartTooltipMarker);
  });
  document.getElementById('tooltip').addEventListener('click', function(e) {
    e.stopPropagation();
    if (e.target.closest('a.trade-model-link')) return;
    var ov = document.getElementById('chartSvg');
    if (ov && ov._tjHover && ov._tjHover.pinned) { ov._tjHover.open(); return; }
    if (chartTooltipOpenAction) chartTooltipOpenAction();
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest || (!e.target.closest('#tooltip') && !e.target.closest('.chart-trade-card'))) closeChartTradeCard();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeChartTradeCard();
  });
  function assetBadge(asset) {
    var def = getAssetDefinition(asset);
    var color = def ? def.color : '#a78bfa';
    return '<span class="badge" style="color:' + color + ';background:' + hexToRgba(color, .15) + '">' + escapeHtml(asset) + '</span>';
  }
  function getAssetDefinition(name) {
    for (var i = 0; i < assetDefinitions.length; i++) if (assetDefinitions[i].name === name) return assetDefinitions[i];
    return null;
  }
  function hexToRgba(hex, alpha) {
    var value = String(hex || '').replace('#', '');
    if (value.length === 3) value = value.split('').map(function(c) { return c + c; }).join('');
    var n = parseInt(value, 16);
    if (isNaN(n)) return 'rgba(167,139,250,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  function normalizeAssetDefinitions(list, deleted) {
    deleted = deleted || [];
    var result = DEFAULT_ASSETS.filter(function(a) { return deleted.indexOf(a.name) < 0; }).map(function(a) { return { name: a.name, color: a.color.toLowerCase() }; });
    (Array.isArray(list) ? list : []).forEach(function(item) {
      var name = String(item && item.name || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 16);
      var color = String(item && item.color || '').toLowerCase();
      if (!name || deleted.indexOf(name) >= 0 || !/^#[0-9a-f]{6}$/.test(color)) return;
      if (result.some(function(a) { return a.name !== name && a.color === color; })) return;
      var existing = result.filter(function(a) { return a.name === name; })[0];
      if (existing) { existing.color = color; return; }
      result.push({ name: name, color: color });
    });
    return result;
  }
  function tjAssetEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function tjAssetColor(v) { v = String(v == null ? '' : v).trim(); return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\)|[a-z]+)$/i.test(v) ? v : '#8fa3b8'; }
  function renderAssetControls() {
    var nativeSelect = document.getElementById('assetFilterSelect');
    var menu = document.getElementById('assetFilterMenu');
    var tradeSelect = document.getElementById('assetInput');
    var selectedTradeAsset = tradeSelect.value;
    nativeSelect.innerHTML = '<option value="ALL">All Assets</option>' + assetDefinitions.map(function(a) { return '<option value="' + tjAssetEsc(a.name) + '">' + tjAssetEsc(a.name) + '</option>'; }).join('');
    menu.innerHTML = '<button class="asset-filter-option' + (assetFilter === 'ALL' ? ' active' : '') + '" type="button" data-value="ALL" data-label="All Assets">All</button>' + assetDefinitions.map(function(a) {
      return '<button class="asset-filter-option' + (assetFilter === a.name ? ' active' : '') + ' has-delete has-edit" type="button" data-value="' + tjAssetEsc(a.name) + '" data-label="' + tjAssetEsc(a.name) + '" style="--asset-color:' + tjAssetColor(a.color) + '">' + tjAssetEsc(a.name) + '<span class="asset-filter-option-delete" data-delete-asset="' + tjAssetEsc(a.name) + '" title="Delete asset">✕</span><span class="asset-filter-option-edit" data-edit-asset="' + tjAssetEsc(a.name) + '" title="Edit asset"><svg class="tj-ui-icon" data-icon="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span></button>';
    }).join('') + '<button class="asset-filter-option asset-filter-option-add" id="assetAddBtn" type="button" title="Add asset" aria-label="Add asset">+</button>';
    tradeSelect.innerHTML = assetDefinitions.map(function(a) { return '<option value="' + tjAssetEsc(a.name) + '">' + tjAssetEsc(a.name) + '</option>'; }).join('');
    if (getAssetDefinition(selectedTradeAsset)) tradeSelect.value = selectedTradeAsset;
    var tradeMenu = document.getElementById('tradeAssetMenu');
    if (tradeMenu) {
      tradeMenu.innerHTML = assetDefinitions.map(function(a) {
        var active = tradeSelect.value === a.name;
        return '<button type="button" class="trade-asset-option' + (active ? ' active' : '') + '" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-value="' + tjAssetEsc(a.name) + '" style="--asset-color:' + tjAssetColor(a.color) + '">' + tjAssetEsc(a.name) + '</button>';
      }).join('');
    }
    updateTradeAssetUI();
    menu.querySelectorAll('.asset-filter-option').forEach(function(option) {
      option.addEventListener('click', function(e) {
        if (this.classList.contains('asset-filter-option-add') || (e.target.closest && e.target.closest('[data-delete-asset], [data-edit-asset]'))) return;
        var value = this.getAttribute('data-value');
        if (value) setAssetFilter(value, true);
      });
    });
    var addBtn = document.getElementById('assetAddBtn');
    if (addBtn) addBtn.addEventListener('click', function(e) { e.stopPropagation(); openAssetCustomModal(); });
    menu.querySelectorAll('[data-delete-asset]').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openAssetDeleteModal(this.getAttribute('data-delete-asset')); });
    });
    menu.querySelectorAll('[data-edit-asset]').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openAssetEditModal(this.getAttribute('data-edit-asset')); });
    });
    if (!getAssetDefinition(assetFilter) && assetFilter !== 'ALL') assetFilter = 'ALL';
    setAssetFilter(assetFilter, false);
    syncAssetFilterScrollbar();
  }
  function updateTradeAssetUI() {
    var select = document.getElementById('assetInput'), value = document.getElementById('tradeAssetValue'), menu = document.getElementById('tradeAssetMenu');
    if (!select || !value) return;
    value.textContent = select.value || (assetDefinitions[0] ? assetDefinitions[0].name : '');
    if (menu) Array.prototype.forEach.call(menu.querySelectorAll('.trade-asset-option'), function(option) {
      var active = option.getAttribute('data-value') === select.value;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }
  function setTradeAsset(value) {
    var select = document.getElementById('assetInput');
    if (!select || !getAssetDefinition(value)) return;
    select.value = value;
    updateTradeAssetUI();
  }
  function closeTradeAssetMenu() {
    var control = document.getElementById('tradeAssetControl'), trigger = document.getElementById('tradeAssetTrigger');
    if (control) control.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  function syncAssetFilterScrollbar() {
    var menu = document.getElementById('assetFilterMenu'), bar = document.getElementById('assetFilterScrollbar'), thumb = document.getElementById('assetFilterScrollbarThumb');
    if (!menu || !bar || !thumb) return;
    var control = document.getElementById('assetFilterControl');
    var measurable = menu.clientWidth > 80;
    var overflow = measurable && menu.scrollWidth > menu.clientWidth + 4;
    bar.classList.toggle('is-visible', overflow && control.classList.contains('open'));
    if (!overflow) return;
    var ratio = menu.clientWidth / menu.scrollWidth;
    thumb.style.width = Math.max(28, ratio * 100) + '%';
    var max = menu.scrollWidth - menu.clientWidth;
    var track = bar.clientWidth - thumb.offsetWidth;
    thumb.style.transform = 'translateX(' + (max ? (menu.scrollLeft / max) * track : 0) + 'px)';
  }
  (function initAssetFilterScrollbar() {
    var menu = document.getElementById('assetFilterMenu'), bar = document.getElementById('assetFilterScrollbar'), thumb = document.getElementById('assetFilterScrollbarThumb');
    if (!menu || !bar || !thumb) return;
    menu.addEventListener('scroll', syncAssetFilterScrollbar, { passive: true });
    window.addEventListener('resize', syncAssetFilterScrollbar);
    var dragging = false, startX = 0, startScroll = 0;
    bar.addEventListener('pointerdown', function(e) {
      if (e.target === thumb) return;
      var rect = bar.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      menu.scrollLeft = ratio * (menu.scrollWidth - menu.clientWidth);
      syncAssetFilterScrollbar();
    });
    thumb.addEventListener('pointerdown', function(e) { dragging = true; startX = e.clientX; startScroll = menu.scrollLeft; thumb.classList.add('dragging'); thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
    thumb.addEventListener('pointermove', function(e) { if (!dragging) return; var track = bar.clientWidth - thumb.offsetWidth, max = menu.scrollWidth - menu.clientWidth; if (track > 0) menu.scrollLeft = startScroll + (e.clientX - startX) * max / track; syncAssetFilterScrollbar(); });
    function stop(e) { if (!dragging) return; dragging = false; thumb.classList.remove('dragging'); try { thumb.releasePointerCapture(e.pointerId); } catch (_) {} }
    thumb.addEventListener('pointerup', stop); thumb.addEventListener('pointercancel', stop);
  }());
  function directionBadge(dir) {
    var cls = dir === 'LONG' ? 'badge-long' : 'badge-short';
    return '<span class="badge ' + cls + '">' + escapeHtml(String(dir == null ? '' : dir)) + '</span>';
  }
  function tradeResultColor(trade) {
    var r = Number(trade && trade.r) || 0;
    return r > 0 ? 'var(--green)' : (r < 0 ? 'var(--red)' : 'var(--textDim)');
  }
  function tradeResultLabel(trade) {
    var r = Number(trade && trade.r) || 0;
    return r > 0 ? 'Win' : (r < 0 ? 'Loss' : 'BE');
  }
  function resultBadge(r) {
    if (Number(r) === 0) return '<span class="badge badge-be">BE</span>';
    var win = r > 0;
    return '<span class="badge ' + (win ? 'badge-win' : 'badge-loss') + '">' + (win ? 'WIN' : 'LOSS') + '</span>';
  }

  // ---- Inline editing state ----
  var activeEditCol = null; // currently active column for editing
  var inlineEditPopup = null;
  var inlineOutsideClickHandler = null;

  // Update existing cells as well as newly rendered tables when edit mode changes.
  function refreshTradeModelCells() {
    var editing = activeEditCol === 'model';
    ['allTradesBody', 'monthTradesBody', 'weekTradesBody', 'quarterTradesBody', 'yearTradesBody'].forEach(function(id) {
      var tbody = document.getElementById(id);
      if (!tbody) return;
      Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col="model"]'), function(td) {
        var trade = trades.filter(function(t) { return t.id === td.getAttribute('data-id'); })[0];
        if (trade) td.innerHTML = tradeModelHTML(trade, editing);
      });
    });
  }

  function closeInlineEditPopup() {
    if (inlineOutsideClickHandler) {
      document.removeEventListener('click', inlineOutsideClickHandler);
      inlineOutsideClickHandler = null;
    }
    if (inlineEditPopup && inlineEditPopup.parentNode) {
      inlineEditPopup.parentNode.removeChild(inlineEditPopup);
    }
    inlineEditPopup = null;
  }

  function setActiveEditCol(col) {
    // Deactivate previous
    Array.prototype.forEach.call(document.querySelectorAll('.th-pencil.col-edit-active'), function(el) {
      el.classList.remove('col-edit-active');
    });
    Array.prototype.forEach.call(document.querySelectorAll('td.col-editing'), function(el) {
      el.classList.remove('col-editing');
    });
    closeInlineEditPopup();

    if (activeEditCol === col) {
      activeEditCol = null;
      refreshTradeModelCells();
      return;
    }
    activeEditCol = col;
    refreshTradeModelCells();

    // Activate pencil
    Array.prototype.forEach.call(document.querySelectorAll('.th-pencil[data-col="' + col + '"]'), function(p) {
      p.classList.add('col-edit-active');
    });

    // Activate cells in both editable tables
    ['allTradesBody', 'monthTradesBody', 'weekTradesBody', 'quarterTradesBody', 'yearTradesBody'].forEach(function(id) {
      var tbody = document.getElementById(id);
      if (!tbody) return;
      Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col="' + col + '"]'), function(td) {
        td.classList.add('col-editing');
      });
    });
  }

  function showInlinePopup(td, trade, col) {
    closeInlineEditPopup();
    var curveBefore = tradeCurveSnapshot(trade);
    var rect = td.getBoundingClientRect();
    var popup = document.createElement('div');
    popup.className = 'inline-edit-popup';
    inlineEditPopup = popup;

    function addConfirmButton(onConfirm) {
      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'popup-confirm-btn';
      confirm.title = 'Confirm';
      confirm.setAttribute('aria-label', 'Confirm');
      confirm.innerHTML = '<svg class="tj-ui-icon" data-icon="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      confirm.addEventListener('click', function(e) {
        e.stopPropagation();
        onConfirm();
      });
      popup.classList.add('has-confirm');
      popup.appendChild(confirm);
      return confirm;
    }

    function saveAndRefresh() {
      var fields = col === 'model' ? ['modelId', 'modelName'] : [col === 'rr' || col === 'result' ? 'r' : (col === 'open' ? 'openDT' : (col === 'close' ? 'closeDT' : (col === 'screenshot' ? 'chart' : col)))];
      remoteSaveTrade(trade, fields);
      // Re-render only the overview table without resetting edit mode
      var col_backup = activeEditCol;
      if (activeTab === 'overview' && classifyTradeChange(curveBefore, trade) === 'row') {
        // Model / screenshot / open / direction: period statistics and the curve are unchanged,
        // so only this trade's row is patched.
        renderOverviewTradesTable(assetFiltered(trades));
        if (col === 'open') refreshOverviewTradeNumbers(lastChartData);
      } else {
        render();
      }
      curveBefore = tradeCurveSnapshot(trade);
      // Restore editing state after render
      activeEditCol = col_backup;
      Array.prototype.forEach.call(document.querySelectorAll('.th-pencil[data-col="' + col_backup + '"]'), function(p) {
        p.classList.add('col-edit-active');
      });
      ['allTradesBody', 'monthTradesBody', 'weekTradesBody', 'quarterTradesBody', 'yearTradesBody'].forEach(function(id) {
        var tbody2 = document.getElementById(id);
        if (tbody2) {
          Array.prototype.forEach.call(tbody2.querySelectorAll('td[data-col="' + col_backup + '"]'), function(td2) {
            td2.classList.add('col-editing');
          });
        }
      });
    }

    if (col === 'model') {
      popup.classList.add('model-edit-popup');
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', 'Изменить модель');
      var selectedModelId = trade.modelId || '';
      var modelChoices = tradeModelChoices();
      modelChoices.forEach(function(model) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'popup-option' + (model.id === selectedModelId ? ' active-option' : '');
        btn.setAttribute('aria-pressed', String(model.id === selectedModelId));
        btn.textContent = model.name;
        btn.addEventListener('click', function() {
          selectedModelId = model.id;
          Array.prototype.forEach.call(popup.querySelectorAll('.popup-option'), function(option) {
            option.classList.remove('active-option');
            option.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('active-option');
          btn.setAttribute('aria-pressed', 'true');
        });
        popup.appendChild(btn);
      });
      var modelActions = document.createElement('div');
      modelActions.className = 'model-edit-actions';
      var cancelModel = document.createElement('button');
      cancelModel.type = 'button';
      cancelModel.className = 'ghost-btn popup-cancel-btn';
      cancelModel.textContent = 'Отмена';
      cancelModel.addEventListener('click', function() { closeInlineEditPopup(); });
      modelActions.appendChild(cancelModel);
      var confirmModel = addConfirmButton(function() {
        applyTradeModel(trade, selectedModelId);
        closeInlineEditPopup();
        saveAndRefresh();
        refreshTradeModelCells();
      });
      confirmModel.title = 'Сохранить';
      confirmModel.setAttribute('aria-label', 'Сохранить');
      modelActions.appendChild(confirmModel);
      popup.appendChild(modelActions);
      popup.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeInlineEditPopup(); }
      });
    } else if (col === 'asset') {
      var assets = assetDefinitions.map(function(a) { return a.name; });
      var selectedAsset = trade.asset;
      assets.forEach(function(a) {
        var btn = document.createElement('button');
        btn.className = 'popup-option' + (selectedAsset === a ? ' active-option' : '');
        btn.textContent = a;
        btn.addEventListener('click', function() {
          selectedAsset = a;
          Array.prototype.forEach.call(popup.querySelectorAll('.popup-option'), function(option) { option.classList.remove('active-option'); });
          btn.classList.add('active-option');
        });
        popup.appendChild(btn);
      });
      addConfirmButton(function() { trade.asset = selectedAsset; closeInlineEditPopup(); saveAndRefresh(); });
    } else if (col === 'direction') {
      var selectedDirection = trade.direction;
      ['LONG', 'SHORT'].forEach(function(d) {
        var btn = document.createElement('button');
        btn.className = 'popup-option' + (selectedDirection === d ? ' active-option' : '');
        btn.textContent = d;
        btn.addEventListener('click', function() {
          selectedDirection = d;
          Array.prototype.forEach.call(popup.querySelectorAll('.popup-option'), function(option) { option.classList.remove('active-option'); });
          btn.classList.add('active-option');
        });
        popup.appendChild(btn);
      });
      addConfirmButton(function() { trade.direction = selectedDirection; closeInlineEditPopup(); saveAndRefresh(); });
    } else if (col === 'result') {
      var selectedSign = Math.sign(Number(trade.r) || 0);
      // A break-even trade has no size to flip, so WIN/LOSS also asks for the RR;
      // without it the choice used to be silently ignored.
      var isBreakEven = !(Math.abs(Number(trade.r)) > 0);
      var magnitudeInput = null;
      var syncMagnitude = function() {
        if (!magnitudeInput) return;
        magnitudeInput.style.display = selectedSign === 0 ? 'none' : '';
        if (selectedSign !== 0) setTimeout(function() { magnitudeInput.focus(); }, 0);
      };
      [['WIN', 1], ['LOSS', -1]].concat(isBreakEven ? [['BE', 0]] : []).forEach(function(pair) {
        var label = pair[0], sign = pair[1];
        var isActive = (sign === selectedSign);
        var btn = document.createElement('button');
        btn.className = 'popup-option' + (isActive ? ' active-option' : '');
        btn.textContent = label;
        btn.addEventListener('click', function() {
          selectedSign = sign;
          Array.prototype.forEach.call(popup.querySelectorAll('.popup-option'), function(option) { option.classList.remove('active-option'); });
          btn.classList.add('active-option');
          syncMagnitude();
        });
        popup.appendChild(btn);
      });
      if (isBreakEven) {
        magnitudeInput = document.createElement('input');
        magnitudeInput.className = 'popup-input';
        magnitudeInput.type = 'number'; magnitudeInput.step = '0.01'; magnitudeInput.min = '0'; magnitudeInput.max = '1000000';
        magnitudeInput.placeholder = 'RR, e.g. 1.5';
        magnitudeInput.setAttribute('aria-label', 'RR');
        popup.appendChild(magnitudeInput);
        syncMagnitude();
      }
      addConfirmButton(function() {
        if (selectedSign === 0) { trade.r = 0; closeInlineEditPopup(); saveAndRefresh(); return; }
        if (isBreakEven) {
          var size = Number(magnitudeInput.value.trim().replace(',', '.'));
          if (!(Number.isFinite(size) && size > 0 && size <= 1000000)) {
            magnitudeInput.classList.add('popup-input-invalid');
            magnitudeInput.focus();
            return;
          }
          trade.r = size * selectedSign;
        } else {
          trade.r = Math.abs(trade.r) * selectedSign;
        }
        closeInlineEditPopup(); saveAndRefresh();
      });
      if (magnitudeInput) {
        magnitudeInput.addEventListener('input', function() { magnitudeInput.classList.remove('popup-input-invalid'); });
        magnitudeInput.addEventListener('keydown', function(e) {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          var ok = popup.querySelector('.popup-confirm-btn'); if (ok) ok.click();
        });
      }
    } else if (col === 'rr') {
      popup.classList.add('rr-edit-popup');
      var inp = document.createElement('input');
      inp.className = 'popup-input';
      inp.type = 'number';
      inp.step = '0.01';
      inp.min = '0';inp.max='1000000';
      inp.value = Math.abs(trade.r).toFixed(2);
      inp.placeholder = '1.0';
      popup.appendChild(inp);
      addConfirmButton(function() {
        var val = Number(inp.value.trim().replace(',', '.'));
        if (inp.value.trim() && Number.isFinite(val) && val >= 0 && val <= 1000000) {
          trade.r = trade.r >= 0 ? val : -val;
          closeInlineEditPopup();
          saveAndRefresh();
        }
      });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var val = Number(inp.value.trim().replace(',', '.'));
          if (inp.value.trim() && Number.isFinite(val) && val >= 0 && val <= 1000000) {
            trade.r = trade.r >= 0 ? val : -val;
            closeInlineEditPopup();
            saveAndRefresh();
          }
        }
        if (e.key === 'Escape') closeInlineEditPopup();
      });
      setTimeout(function() { inp.focus(); inp.select(); }, 30);
    } else if (col === 'open' || col === 'close') {
      popup.classList.add('date-edit-popup');
      var field = col === 'open' ? 'openDT' : 'closeDT';
      var wrap = document.createElement('div');
      wrap.className = 'datetime-field';
      var inp2 = document.createElement('input');
      inp2.className = 'popup-input trade-datetime-input';
      inp2.type = 'text';
      inp2.readOnly = true;
      setDateTimeInput(inp2, trade[field] ? trade[field].slice(0, 16) : '');
      wrap.appendChild(inp2);
      var inlineCalendarTrigger = document.createElement('button');
      inlineCalendarTrigger.type = 'button';
      inlineCalendarTrigger.className = 'datetime-calendar-trigger';
      inlineCalendarTrigger.setAttribute('aria-label', 'Choose date');
      inlineCalendarTrigger.textContent = '';
      wrap.appendChild(inlineCalendarTrigger);
      popup.appendChild(wrap);
      var dateError = document.createElement('div');
      dateError.className = 'save-error';
      dateError.style.display = 'none';
      dateError.setAttribute('role', 'alert');
      popup.appendChild(dateError);
      inp2.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
      inlineCalendarTrigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openDateTimePicker(inp2);
      });
      wrap.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      addConfirmButton(function() {
        var val = getDateTimeInputValue(inp2);
        var openDT = field === 'openDT' ? val : trade.openDT;
        var closeDT = field === 'closeDT' ? val : trade.closeDT;
        if (val && val <= currentLocalDateTimeKey() && validateTradeDateOrder(openDT, closeDT, dateError)) {
          trade[field] = val;
          closeInlineEditPopup();
          saveAndRefresh();
        }
      });
    } else if (col === 'screenshot') {
      if(window.TJMedia){closeInlineEditPopup();TJMedia.edit(trade,function(){render();});return;}
      popup.classList.add('screenshot-edit-popup');
      var pendingChart = trade.chart || null;
      var preview = document.createElement('img');
      preview.className = 'screenshot-edit-preview';
      preview.alt = 'Chart screenshot preview';
      preview.src = pendingChart || '';
      preview.style.display = pendingChart ? 'block' : 'none';
      popup.appendChild(preview);

      var filePicker = document.createElement('div');
      filePicker.className = 'custom-file-picker screenshot-edit-file-picker';
      var file = document.createElement('input');
      file.className = 'custom-file-picker-input';
      file.type = 'file';
      file.accept = 'image/*';
      file.id = 'screenshotEditFile_' + trade.id;
      var fileLabel = document.createElement('label');
      fileLabel.className = 'custom-file-picker-btn';
      fileLabel.htmlFor = file.id;
      fileLabel.textContent = 'Choose file';
      var fileName = document.createElement('span');
      fileName.className = 'custom-file-picker-name';
      fileName.textContent = 'No file chosen';
      filePicker.appendChild(file);
      filePicker.appendChild(fileLabel);
      filePicker.appendChild(fileName);
      popup.appendChild(filePicker);

      var screenshotActions = document.createElement('div');
      screenshotActions.className = 'screenshot-edit-actions';
      var remove = document.createElement('button');
      remove.className = 'ghost-btn screenshot-edit-remove';
      remove.type = 'button';
      remove.textContent = 'Remove screenshot';
      remove.style.display = pendingChart ? 'block' : 'none';
      screenshotActions.appendChild(remove);
      popup.appendChild(screenshotActions);

      file.addEventListener('click', function(e) { e.stopPropagation(); });
      file.addEventListener('change', function() {
        var selected = file.files && file.files[0];
        if (!selected) return;
        fileName.textContent = selected.name;
        compressImage(selected, 1600, 0.82).then(function(dataUrl) {
          pendingChart = dataUrl;
          preview.src = dataUrl;
          preview.style.display = 'block';
          remove.style.display = 'block';
        }).catch(function() {});
      });
      remove.addEventListener('click', function(e) {
        e.stopPropagation();
        pendingChart = null;
        file.value = '';
        fileName.textContent = 'No file chosen';
        preview.src = '';
        preview.style.display = 'none';
        remove.style.display = 'none';
      });
      var screenshotConfirm = addConfirmButton(function() {
        trade.chart = pendingChart;
        closeInlineEditPopup();
        saveAndRefresh();
      });
      screenshotActions.appendChild(screenshotConfirm);
    }

    // Position popup near the cell — fixed positioning, respects viewport edges
    // First mount invisibly to measure real height
    popup.style.visibility = 'hidden';
    popup.style.position = 'fixed';
    document.body.appendChild(popup);
    var popW = popup.classList.contains('rr-edit-popup')
      ? popup.offsetWidth
      : Math.max(160, popup.offsetWidth);
    var popH = popup.offsetHeight;
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;
    var gap = 6;

    // Horizontal: align to cell left, clamp inside viewport
    var left = rect.left;
    if (left + popW > viewW - gap) left = viewW - popW - gap;
    if (left < gap) left = gap;

    // Vertical: prefer below the cell; flip above if insufficient space
    var spaceBelow = viewH - rect.bottom - gap;
    var spaceAbove = rect.top - gap;
    var top;
    if (spaceBelow >= popH || spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
      if (top + popH > viewH - gap) top = viewH - popH - gap; // clamp bottom
    } else {
      top = rect.top - popH - gap;
      if (top < gap) top = gap; // clamp top
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.minWidth = popW + 'px';
    popup.style.visibility = '';
    if (col === 'model') (popup.querySelector('.active-option') || popup.querySelector('.popup-option')).focus({ preventScroll: true });

    // Close on outside click
    setTimeout(function() {
      if (inlineEditPopup !== popup) return;
      inlineOutsideClickHandler = function outsideClick(e) {
        if (document.body.classList.contains('datetime-picker-open')) return;
        if (!popup.contains(e.target)) {
          closeInlineEditPopup();
        }
      };
      document.addEventListener('click', inlineOutsideClickHandler);
    }, 10);
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function safeTradeImage(value) {
    var url = String(value || '').trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
    if (/^https?:\/\//i.test(url) && !/[\x00-\x1f\x7f]/.test(url)) return url;
    return '';
  }

  function tradeRowCells(t, num, isMainTable) {
    var color = tradeResultColor(t);
    var thumbCell = t.chart
      ? '<button class="thumb-btn" data-id="' + escapeAttr(t.id) + '"><img' + mobileImageAttributes() + ' src="' + escapeAttr(safeTradeImage(t.chart)) + '" alt="">' + '' + '</button>'
      : '<div class="thumb-empty"></div>';
    var screenshotTd = isMainTable
      ? '<td data-col="screenshot" data-id="' + escapeAttr(t.id) + '">' + thumbCell + '</td>'
      : '<td>' + thumbCell + '</td>';
    var openTd = isMainTable
      ? '<td data-col="open" data-id="' + escapeAttr(t.id) + '"><span class="mono">' + fmtDT(t.openDT) + '</span></td>'
      : '<td class="mono">' + fmtDT(t.openDT) + '</td>';
    var closeTd = isMainTable
      ? '<td data-col="close" data-id="' + escapeAttr(t.id) + '"><span class="mono">' + fmtDT(t.closeDT) + '</span></td>'
      : '<td class="mono">' + fmtDT(t.closeDT) + '</td>';
    var assetTd = isMainTable
      ? '<td data-col="asset" data-id="' + escapeAttr(t.id) + '">' + assetBadge(t.asset) + '</td>'
      : '<td>' + assetBadge(t.asset) + '</td>';
    var dirTd = isMainTable
      ? '<td data-col="direction" data-id="' + escapeAttr(t.id) + '">' + directionBadge(t.direction) + '</td>'
      : '<td>' + directionBadge(t.direction) + '</td>';
    var resTd = isMainTable
      ? '<td data-col="result" data-id="' + escapeAttr(t.id) + '">' + resultBadge(t.r) + '</td>'
      : '<td>' + resultBadge(t.r) + '</td>';
    var rrTd = isMainTable
      ? '<td data-col="rr" data-id="' + escapeAttr(t.id) + '"><span class="mono" style="color:' + color + '">' + fmtTradeResult(t) + '</span></td>'
      : '<td class="mono" style="color:' + color + '">' + fmtTradeResult(t) + '</td>';
    return [
      screenshotTd,
      '<td class="mono">#' + num + '</td>',
      openTd,
      closeTd,
      '<td class="mono">' + formatHolding(t.openDT, t.closeDT) + '</td>',
      assetTd,
      dirTd,
      resTd,
      '<td data-col="model" data-id="' + escapeAttr(t.id) + '">' + tradeModelHTML(t, isMainTable && activeEditCol === 'model') + '</td>',
      rrTd,
      '<td><button class="del-btn" data-id="' + escapeAttr(t.id) + '">✕</button></td>'
    ];
  }

  // Keyed row reconciliation: unchanged rows stay in the DOM (no stagger replay),
  // changed rows get only their changed cells replaced, new rows fade in once.
  // A full remount (with the original stagger) happens only on first paint or
  // when most rows are new (e.g. switching page).
  var tjRowTemplate = document.createElement('template');
  function tjParseRow(cells) {
    tjRowTemplate.innerHTML = '<tr>' + cells.join('') + '</tr>';
    return tjRowTemplate.content.firstElementChild;
  }
  function patchKeyedRows(tbody, rows) {
    var existing = {};
    Array.prototype.forEach.call(tbody.children, function(tr) { if (tr._tjKey != null) existing[tr._tjKey] = tr; });
    var retained = 0;
    rows.forEach(function(r) { if (existing[r.key]) retained++; });
    if (!tbody._tjMounted || (rows.length && retained < Math.ceil(rows.length / 2))) {
      tbody.innerHTML = rows.map(function(r) { return '<tr>' + r.cells.join('') + '</tr>'; }).join('');
      Array.prototype.forEach.call(tbody.children, function(tr, i) { tr._tjKey = rows[i].key; tr._tjCells = rows[i].cells; });
      tbody._tjMounted = true;
      return;
    }
    var cursor = tbody.firstElementChild;
    rows.forEach(function(r) {
      var tr = existing[r.key];
      if (tr) {
        delete existing[r.key];
        var old = tr._tjCells || [];
        if (old.length !== r.cells.length || tr.children.length !== r.cells.length) {
          var fresh = tjParseRow(r.cells);
          tr.replaceChildren.apply(tr, Array.prototype.slice.call(fresh.children));
        } else {
          for (var i = 0; i < r.cells.length; i++) {
            if (old[i] === r.cells[i]) continue;
            var cellRow = tjParseRow([r.cells[i]]);
            tr.replaceChild(cellRow.firstElementChild, tr.children[i]);
          }
        }
        tr._tjCells = r.cells;
      } else {
        tr = tjParseRow(r.cells);
        tr._tjKey = r.key;
        tr._tjCells = r.cells;
        tr.classList.add('row-live-enter');
      }
      if (tr === cursor) { cursor = cursor.nextElementSibling; }
      else {
        if (tr.parentNode === tbody) tr.classList.add('row-live-enter');
        tbody.insertBefore(tr, cursor);
      }
    });
    Object.keys(existing).forEach(function(key) { existing[key].remove(); });
  }

  // One delegated listener per main table instead of re-binding every row on
  // every render. Behaviour mirrors the former per-element handlers.
  function installTradesTableDelegation(tbody) {
    if (tbody._tjDelegated) return;
    tbody._tjDelegated = true;
    tbody.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var del = target.closest('.del-btn');
      if (del && tbody.contains(del)) {
        tjRequestTradeDelete(del.getAttribute('data-id'));
        return;
      }
      var thumb = target.closest('.thumb-btn');
      if (thumb && tbody.contains(thumb)) {
        e.stopPropagation();
        var thumbId = thumb.getAttribute('data-id');
        var thumbTrade = trades.filter(function(t) { return t.id === thumbId; })[0];
        if (!thumbTrade) return;
        // When the screenshot column is active, clicking the thumbnail edits it;
        // otherwise preserve the normal preview/note-panel behavior.
        if (activeEditCol === 'screenshot') {
          showInlinePopup(thumb.closest('td'), thumbTrade, 'screenshot');
        } else {
          openNotePanel(thumbTrade, thumb);
        }
        return;
      }
      var td = target.closest('td[data-col]');
      if (!td || !tbody.contains(td)) return;
      var col = td.getAttribute('data-col');
      var modelLink = target.closest('a.trade-model-link');
      if (modelLink && col !== activeEditCol) return;
      if (modelLink) e.preventDefault();
      if (col !== activeEditCol) return; // only clickable when column is in edit mode
      e.stopPropagation();
      var id = td.getAttribute('data-id');
      var trade = trades.filter(function(t) { return t.id === id; })[0];
      if (!trade) return;
      showInlinePopup(td, trade, col);
    });
  }

  function renderTradesTable(arr, tbodyId, emptyId, limit, offset) {
    offset = offset || 0;
    var useStatsDateOrder = tbodyId === 'monthTradesBody' || tbodyId === 'weekTradesBody' || tbodyId === 'quarterTradesBody' || tbodyId === 'yearTradesBody';
    var sortedDesc = arr.slice().sort(function(a, b) {
      return useStatsDateOrder ? (tradeStatsDate(b) - tradeStatsDate(a)) : (new Date(b.openDT) - new Date(a.openDT));
    });
    var shown = limit ? sortedDesc.slice(offset, offset + limit) : sortedDesc;
    var tbody = document.getElementById(tbodyId);
    var empty = document.getElementById(emptyId);
    if (empty) empty.style.display = shown.length ? 'none' : 'block';
    var isMainTable = tbodyId === 'allTradesBody' || tbodyId === 'monthTradesBody' || tbodyId === 'weekTradesBody' || tbodyId === 'quarterTradesBody' || tbodyId === 'yearTradesBody';
    if (tbodyId === 'allTradesBody') {
      // Overview: incremental update.
      installTradesTableDelegation(tbody);
      patchKeyedRows(tbody, shown.map(function(t, i) {
        return { key: String(t.id), cells: tradeRowCells(t, tradeNumberOf(t), true) };
      }));
      if (activeEditCol) {
        Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col="' + activeEditCol + '"]'), function(td) {
          td.classList.add('col-editing');
        });
      }
      return sortedDesc.length;
    }
    // Other sections (monthly / weekly / ...) keep their original full render.
    tbody.innerHTML = shown.map(function(t, i) {
      return '<tr>' + tradeRowCells(t, tradeNumberOf(t), isMainTable).join('') + '</tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('.del-btn'), function(btn) {
      btn.addEventListener('click', function() { tjRequestTradeDelete(btn.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(tbody.querySelectorAll('.thumb-btn'), function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var trade = trades.filter(function(t) { return t.id === id; })[0];
        if (!trade) return;
        // When the screenshot column is active, clicking the thumbnail edits it;
        // otherwise preserve the normal preview/note-panel behavior.
        if (activeEditCol === 'screenshot') {
          showInlinePopup(btn.closest('td'), trade, 'screenshot');
        } else {
          openNotePanel(trade, btn);
        }
      });
    });
    // Attach click handlers for editable cells (main tables on desktop and mobile)
    if (isMainTable) {
      Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col]'), function(td) {
        td.addEventListener('click', function(e) {
          var col = td.getAttribute('data-col');
          var modelLink = e.target.closest('a.trade-model-link');
          if (modelLink && col !== activeEditCol) return;
          if (modelLink) e.preventDefault();
          if (col !== activeEditCol) return; // only clickable when column is in edit mode
          e.stopPropagation();
          var id = td.getAttribute('data-id');
          var trade = trades.filter(function(t) { return t.id === id; })[0];
          if (!trade) return;
          showInlinePopup(td, trade, col);
        });
      });
      // Re-apply wiggle class if a column is active
      if (activeEditCol) {
        Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col="' + activeEditCol + '"]'), function(td) {
          td.classList.add('col-editing');
        });
      }
    }
    return sortedDesc.length;
  }

  // Write to the DOM only when the value actually changed.
  function tjSetText(id, text) {
    var el = document.getElementById(id);
    if (el && el.textContent !== String(text)) el.textContent = text;
    return el;
  }
  function tjSetColor(el, color) {
    if (el && el.style.color !== color) el.style.color = color;
  }

  function renderOverviewTradesTable(filtered) {
    var totalPages = Math.max(1, Math.ceil(filtered.length / TRADES_PAGE_SIZE));
    if (currentTradesPage > totalPages) currentTradesPage = totalPages;
    if (currentTradesPage < 1) currentTradesPage = 1;
    var pageOffset = (currentTradesPage - 1) * TRADES_PAGE_SIZE;
    var total = renderTradesTable(filtered, 'allTradesBody', 'tradesEmptyState', TRADES_PAGE_SIZE, pageOffset);
    var shownCount = Math.max(0, Math.min(TRADES_PAGE_SIZE, total - pageOffset));
    tjSetText('showingLabel', total ? ('Showing ' + (pageOffset + 1) + '-' + (pageOffset + shownCount) + ' of ' + total + ' trades') : 'Showing 0 of 0 trades');
    renderTradesPagination(totalPages);
  }

  function renderOverview() {
    var filtered = assetFiltered(trades);
    var stats = computeStats(filtered);

    tjSetText('tradeCountLabel', stats.total + ' trades');
    renderChart(stats.percentChartData);

    tjSetColor(tjSetText('totalRR', fmtPercent(stats.totalPercent)), stats.totalPercent >= 0 ? 'var(--green)' : 'var(--red)');
    tjSetText('totalTradesSub', stats.total + ' trades');

    tjSetText('winRate', stats.winRate.toFixed(1) + '%');
    tjSetText('winLossSub', stats.wins + 'W / ' + stats.losses + 'L');

    tjSetText('avgWinRR', stats.winsArr.length ? fmtR(stats.avgWinningRR) : '—');

    tjSetText('winCount', stats.wins);
    tjSetText('loseCount', stats.losses);
    tjSetText('maxWinStreak', stats.maxWinStreak);
    tjSetText('maxLoseStreak', stats.maxLoseStreak);
    tjSetText('tradesPerMonth', stats.avgTradesPerMonth.toFixed(1));
    tjSetColor(tjSetText('rrPerMonth', fmtPercent(stats.avgPercentPerMonth)), stats.avgPercentPerMonth >= 0 ? 'var(--green)' : 'var(--red)');

    // Group once instead of filtering every trade for every asset.
    var byAsset = {};
    trades.forEach(function(t) { (byAsset[t.asset] = byAsset[t.asset] || []).push(t); });
    patchKeyedRows(document.getElementById('assetsStatsBody'), assetDefinitions.map(function(def) {
      var asset = def.name;
      var s = computeStats(byAsset[asset] || []);
      var color = s.totalPercent >= 0 ? 'var(--green)' : 'var(--red)';
      return { key: asset, cells: [
        '<td>' + assetBadge(asset) + '</td>',
        '<td class="mono">' + s.total + '</td>',
        '<td class="mono">' + s.winRate.toFixed(1) + '%</td>',
        '<td class="mono">' + (s.winsArr.length ? fmtR(s.avgWinningRR) : '—') + '</td>',
        '<td class="mono" style="color:' + color + '">' + fmtPercent(s.totalPercent) + '</td>'
      ] };
    }));

    renderOverviewTradesTable(filtered);
  }

  // Which parts of the Overview does an edit of one trade touch?
  //   'curve' -> equity values / order / asset stats may change
  //   'row'   -> only that trade's table row (model, screenshot, close, direction)
  var TRADE_CURVE_FIELDS = ['r', 'riskPercent', 'closeDT', 'asset'];
  function tradeCurveSnapshot(trade) {
    var snap = {};
    TRADE_CURVE_FIELDS.forEach(function(f) { snap[f] = trade ? trade[f] : undefined; });
    return snap;
  }
  function classifyTradeChange(before, trade) {
    if (!before || !trade) return 'curve'; // added / removed trade
    for (var i = 0; i < TRADE_CURVE_FIELDS.length; i++) {
      var f = TRADE_CURVE_FIELDS[i];
      if (String(before[f]) !== String(trade[f])) return 'curve';
    }
    return 'row';
  }

  function renderTradesPagination(totalPages) {
    var el = document.getElementById('tradesPagination');
    if (!el) return;
    if (totalPages <= 1) {
      var single = '<span class="page-btn active">1</span>';
      if (el._tjHtml !== single) { el.innerHTML = single; el._tjHtml = single; }
      return;
    }
    var pages = [1, totalPages];
    for (var p = currentTradesPage - 1; p <= currentTradesPage + 1; p++) {
      if (p > 1 && p < totalPages) pages.push(p);
    }
    pages = pages.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort(function(a, b) { return a - b; });
    var html = '<button class="page-btn page-prev" type="button"' + (currentTradesPage === 1 ? ' disabled' : '') + '><svg class="tj-ui-icon" data-icon="chevron-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>';
    var prevPage = null;
    pages.forEach(function(p) {
      if (prevPage !== null && p - prevPage > 1) html += '<span class="page-ellipsis">…</span>';
      html += '<button class="page-btn' + (p === currentTradesPage ? ' active' : '') + '" type="button" data-page="' + p + '"' + (p === currentTradesPage ? ' disabled' : '') + '>' + p + '</button>';
      prevPage = p;
    });
    html += '<button class="page-btn page-next" type="button"' + (currentTradesPage === totalPages ? ' disabled' : '') + '><svg class="tj-ui-icon" data-icon="chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';
    if (el._tjHtml === html) return; // unchanged: keep buttons (and their listeners)
    el._tjHtml = html;
    el.innerHTML = html;
    var prevBtn = el.querySelector('.page-prev'), nextBtn = el.querySelector('.page-next');
    if (prevBtn) prevBtn.addEventListener('click', function() { if (currentTradesPage > 1) { currentTradesPage--; render(); } });
    if (nextBtn) nextBtn.addEventListener('click', function() { if (currentTradesPage < totalPages) { currentTradesPage++; render(); } });
    Array.prototype.forEach.call(el.querySelectorAll('.page-btn[data-page]'), function(btn) {
      btn.addEventListener('click', function() {
        var p = parseInt(btn.getAttribute('data-page'), 10);
        if (p !== currentTradesPage) { currentTradesPage = p; render(); }
      });
    });
  }

  function monthStats(year, month, arr) {
    var sub = arr.filter(function(t) {
      var d = tradeStatsDate(t);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return computeStats(sub);
  }

  function periodClass(s) {
    if (s.total === 0 || s.totalPercent === 0) return 'period-flat';
    return s.totalPercent > 0 ? 'period-win' : 'period-loss';
  }

  function periodRowHTML(label, s, includeRR) {
    var color = s.totalPercent > 0 ? 'var(--green)' : (s.totalPercent < 0 ? 'var(--red)' : 'var(--textDim)');
    var gainLabel = fmtPercent(s.totalPercent) + (includeRR === false ? '' : ' · ' + fmtR(s.totalRR));
    return '<div class="period-row ' + periodClass(s) + '" data-label="' + label + '">' +
      '<div class="month-row-name">' + label + '</div>' +
      '<div class="month-row-right">' +
        '<span class="mono" style="color:' + color + '">' + gainLabel + '</span>' +
        '<span class="month-row-sub mono">' + s.winRate.toFixed(1) + '% Win Rate</span>' +
        '<span class="month-row-sub mono">' + s.total + ' Trades</span>' +
      '</div>' +
    '</div>';
  }

  function renderBarChartUncached(year, arr) {
    var totals = [];
    var maxAbs = 0.0001;
    for (var m = 0; m < 12; m++) {
      var s = monthStats(year, m, arr);
      totals.push(s);
      maxAbs = Math.max(maxAbs, Math.abs(s.totalPercent));
    }
    var HALF = 70, MAXBAR = 62;
    var barChart = document.getElementById('barChart');
    var html = '<div class="bar-zeroline" style="top:' + HALF + 'px;"></div>';
    html += totals.map(function(s, m) {
      var pct = Math.abs(s.totalPercent) / maxAbs;
      var barLen = s.total === 0 ? 0 : Math.max(3, pct * MAXBAR);
      var isPos = s.totalPercent >= 0;
      var barTop = isPos ? (HALF - barLen) : HALF;
      var color = s.total === 0 ? 'rgba(255,255,255,0.08)' : (isPos ? 'var(--green)' : 'var(--red)');
      var radius = isPos ? '6px 6px 2px 2px' : '2px 2px 6px 6px';
      var title = EN_MONTHS_FULL[m] + ' ' + year + ': ' + fmtPercent(s.totalPercent) + ', ' + s.winRate.toFixed(0) + '% WR, ' + s.total + ' trades';
      return '<div class="bar-col" data-month="' + m + '" title="' + title + '">' +
        '<div class="bar-inner">' +
          '<div class="bar ' + (isPos ? 'bar-pos' : 'bar-neg') + '" style="top:' + barTop + 'px; height:' + barLen + 'px; background:' + color + '; border-radius:' + radius + ';"></div>' +
        '</div>' +
        '<div class="bar-month-label">' + EN_MONTHS_SHORT[m] + '</div>' +
      '</div>';
    }).join('');
    barChart.innerHTML = html;
    Array.prototype.forEach.call(barChart.querySelectorAll('.bar-col'), function(col) {
      col.addEventListener('click', function() {
        monthlySelectedMonth = parseInt(col.getAttribute('data-month'), 10);
        render();
      });
    });
  }

  function renderMonthList(year, arr) {
    var list = document.getElementById('monthList');
    var rows = [];
    for (var m = 0; m < 12; m++) {
      var s = monthStats(year, m, arr);
      rows.push(periodRowHTML(EN_MONTHS_FULL[m], s, false).replace('data-label="' + EN_MONTHS_FULL[m] + '"', 'data-month="' + m + '"'));
    }
    list.innerHTML = rows.join('');
    Array.prototype.forEach.call(list.querySelectorAll('.period-row'), function(row) {
      row.addEventListener('click', function() {
        monthlySelectedMonth = parseInt(row.getAttribute('data-month'), 10);
        render();
      });
    });
  }

  function computeQuarterStats(year, q, arr) {
    var months = [q * 3, q * 3 + 1, q * 3 + 2];
    var sub = arr.filter(function(t) {
      var d = tradeStatsDate(t);
      return d.getFullYear() === year && months.indexOf(d.getMonth()) !== -1;
    });
    return computeStats(sub);
  }

  // pos / neg / flat. A day or week that ended at exactly 0% is neutral, not green.
  function tjResultTone(value) {
    var v = Number(value) || 0;
    if (Math.abs(v) < 1e-9) return 'flat';
    return v > 0 ? 'pos' : 'neg';
  }

  // Streak of consecutive profitable trading days. Days without trades (weekends,
  // days off) neither extend nor break it, and it runs across month boundaries.
  // `current` is the streak as of the viewed month's end (or today), `best` is the
  // longest streak reached on a day of the viewed month.
  function tjCalendarStreaks(list, year, month) {
    var byKey = {};
    list.forEach(function(t) {
      var d = tradeStatsDate(t);
      if (isNaN(d.getTime())) return;
      var key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      byKey[key] = (byKey[key] || 0) + tradeGainPercent(t);
    });
    var now = new Date(), today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    var monthStart = year * 10000 + (month + 1) * 100, monthEnd = monthStart + 99;
    var limit = Math.min(monthEnd, today), run = 0, best = 0, current = 0;
    Object.keys(byKey).map(Number).sort(function(a, b) { return a - b; }).forEach(function(key) {
      if (key > limit) return;
      run = tjResultTone(byKey[key]) === 'pos' ? run + 1 : 0;
      if (key > monthStart) best = Math.max(best, run);
      current = run;
    });
    return { current: current, best: best };
  }

  function renderCalendar() {
    calendarBrowse.year = calendarYear; calendarBrowse.month = calendarMonth;
    var nav = window.TJCalendarNav, coarse = calendarBrowse.level !== 'days';
    var zoomGrid = document.getElementById('calZoomGrid');
    nav.header(calendarBrowse, document.getElementById('calLabel'), document.getElementById('calPrevBtn'), document.getElementById('calNextBtn'));
    zoomGrid.hidden = !coarse;
    document.querySelector('#calendarTab .cal-scroll-inner').hidden = coarse;
    document.querySelector('#calendarTab .cal-legend').hidden = coarse;
    document.getElementById('calTotalLabel').style.visibility = coarse ? 'hidden' : '';
    if (nav.render(calendarBrowse, zoomGrid, null, null, function() {
      calendarYear = calendarBrowse.year; calendarMonth = calendarBrowse.month;
      renderCalendar();
      if (calendarBrowse.level === 'days') document.getElementById('calLabel').focus({ preventScroll:true });
    })) { nav.animate(zoomGrid); return; }
    var filtered = assetFiltered(trades);
    document.getElementById('calLabel').textContent = EN_MONTHS_FULL[calendarMonth] + ' ' + calendarYear;

    var daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    var firstDow = new Date(calendarYear, calendarMonth, 1).getDay(); // 0=Sun
    var leadBlanks = (firstDow + 6) % 7; // convert to Mon-first

    var byDay = {};
    filtered.forEach(function(t) {
      var d = tradeStatsDate(t);
      if (isNaN(d.getTime())) return;
      if (d.getFullYear() !== calendarYear || d.getMonth() !== calendarMonth) return;
      var day = d.getDate();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(t);
    });

    var monthTotal = 0;
    var rowCells = []; // day cells for the current row (max 7), reset every week
    var cellsHTML = '';
    var streaks = tjCalendarStreaks(filtered, calendarYear, calendarMonth);

    function flushWeekCell() {
      var weekR = 0, weekHasTrades = false;
      rowCells.forEach(function(day) {
        if (day == null) return;
        var dayTrades = byDay[day] || [];
        if (dayTrades.length) {
          weekHasTrades = true;
          weekR += dayTrades.reduce(function(s, t) { return s + tradeGainPercent(t); }, 0);
        }
      });
      var wcls = 'cal-week-cell';
      if (weekHasTrades) wcls += ' ' + tjResultTone(weekR);
      cellsHTML += '<div class="' + wcls + '">' +
        (weekHasTrades ? '<div class="cal-week-r">' + fmtPercent(weekR) + '</div>' : '<div class="cal-week-dash">—</div>') +
      '</div>';
      rowCells = [];
    }

    for (var i = 0; i < leadBlanks; i++) {
      cellsHTML += '<div class="cal-cell empty"></div>';
      rowCells.push(null);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dayTrades = byDay[day] || [];
      var dayR = dayTrades.reduce(function(s, t) { return s + tradeGainPercent(t); }, 0);
      if (dayTrades.length) monthTotal += dayR;

      var cls = 'cal-cell';
      if (!dayTrades.length) {
        cls += ' empty-day';
      } else {
        cls += ' has-trades ' + tjResultTone(dayR);
      }

      cellsHTML += '<div class="' + cls + '" data-day="' + day + '">' +
        '<div class="cal-cell-day">' + day + '</div>' +
        (dayTrades.length ? '<div class="cal-cell-r">' + fmtPercent(dayR) + '</div>' : '') +
      '</div>';

      rowCells.push(day);
      if (rowCells.length === 7) flushWeekCell();
    }

    // Pad the final partial week with trailing blanks so its week-total cell still lines up
    if (rowCells.length) {
      while (rowCells.length < 7) {
        cellsHTML += '<div class="cal-cell empty"></div>';
        rowCells.push(null);
      }
      flushWeekCell();
    }

    document.getElementById('calGrid').innerHTML = cellsHTML;
    var totalEl = document.getElementById('calTotalLabel');
    totalEl.textContent = fmtPercent(monthTotal);
    var totalTone = tjResultTone(monthTotal);
    totalEl.style.color = totalTone === 'pos' ? 'var(--green)' : (totalTone === 'neg' ? 'var(--red)' : 'var(--textDim)');
    document.getElementById('calStreakLabel').textContent = 'Current streak: ' + streaks.current + ' day' + (streaks.current === 1 ? '' : 's');
    document.getElementById('calBestStreakLabel').textContent = 'Best streak: ' + streaks.best + ' day' + (streaks.best === 1 ? '' : 's');

    Array.prototype.forEach.call(document.querySelectorAll('.cal-cell.has-trades'), function(el) {
      el.addEventListener('click', function() {
        var day = parseInt(el.getAttribute('data-day'), 10);
        openCalDayModal(day, byDay[day] || []);
      });
    });
  }

  function openCalDayModal(day, dayTrades) {
    var d = new Date(calendarYear, calendarMonth, day);
    document.getElementById('calDayTitle').textContent = d.getDate() + ' ' + EN_MONTHS_FULL[calendarMonth].slice(0, 3) + ' ' + calendarYear;
    var list = document.getElementById('calDayTradesList');
    list.innerHTML = dayTrades.map(function(t) {
      var color = tradeResultColor(t);
      var thumb = t.chart
        ? '<button class="thumb-btn" data-id="' + escapeAttr(t.id) + '"><img' + mobileImageAttributes() + ' src="' + escapeAttr(safeTradeImage(t.chart)) + '" alt=""></button>'
        : '<div class="thumb-empty"></div>';
      return '<div class="cal-day-trade-row" data-id="' + escapeAttr(t.id) + '">' +
        '<div class="cal-day-trade-left">' + assetBadge(t.asset) + directionBadge(t.direction) + thumb + '</div>' +
        '<div class="trade-model-meta"><span class="card-sub">Модель</span>' + tradeModelHTML(t) + '</div>' +
        '<div class="mono" style="font-weight:700; color:' + color + '">' + fmtTradeResult(t) + '</div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.thumb-btn'), function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var trade = trades.filter(function(t) { return t.id === id; })[0];
        if (trade && trade.chart) if(window.TJMedia)TJMedia.gallery(trade);else openFullscreenImage(trade.chart);
      });
    });
    document.getElementById('calDayModal').classList.add('open');
  }
  function closeCalDayModal() { document.getElementById('calDayModal').classList.remove('open'); }
  document.getElementById('calDayCloseBtn').addEventListener('click', closeCalDayModal);
  document.getElementById('calDayModal').addEventListener('click', function(e) {
    if (e.target === document.getElementById('calDayModal')) closeCalDayModal();
  });
  document.getElementById('calLabel').addEventListener('click', function() {
    window.TJCalendarNav.up(calendarBrowse); renderCalendar();
  });
  function movePnlPeriod(dir) {
    if (window.TJCalendarNav.move(calendarBrowse, dir)) {
      calendarYear = calendarBrowse.year; calendarMonth = calendarBrowse.month; renderCalendar();
    }
  }
  document.getElementById('calPrevBtn').addEventListener('click', function() { movePnlPeriod(-1); });
  document.getElementById('calNextBtn').addEventListener('click', function() { movePnlPeriod(1); });

  // ── Best trade / best asset cards (month, quarter, year) ──
  function bestTradeOf(arr) {
    var best = null;
    arr.forEach(function(t) { if (!best || tradeGainPercent(t) > tradeGainPercent(best)) best = t; });
    return best;
  }
  function bestAssetOf(arr) {
    var sums = {}, best = null;
    arr.forEach(function(t) { var a = t.asset || '—'; sums[a] = (sums[a] || 0) + tradeGainPercent(t); });
    Object.keys(sums).forEach(function(a) { if (!best || sums[a] > best.pct) best = { asset: a, pct: sums[a] }; });
    return best;
  }
  // Per-asset stats under the best cards: win rate, trades, total %.
  function assetStatsGridHtml(arr) {
    var by = {}, order = [];
    arr.forEach(function(t) {
      var a = t.asset || '—';
      if (!by[a]) { by[a] = { asset: a, n: 0, wins: 0, pct: 0 }; order.push(a); }
      var s = by[a];
      s.n++;
      if (Number(t.r) > 0) s.wins++;
      s.pct += tradeGainPercent(t);
    });
    if (!order.length) return '';
    var list = order.map(function(a) { return by[a]; });
    list.sort(function(x, y) { return (y.pct - x.pct) || (y.n - x.n) || String(x.asset).localeCompare(String(y.asset)); });
    return '<div class="asset-stats-grid">' + list.map(function(s) {
      var wr = s.n ? s.wins / s.n * 100 : 0;
      return '<div class="asset-stat-card"><div class="asset-stat-name">' + assetBadge(s.asset) + '</div>' +
        '<div class="asset-stat-nums">' +
          '<div class="asset-stat-num"><span class="asset-stat-label">Win rate</span><span class="asset-stat-value mono">' + wr.toFixed(1) + '%</span></div>' +
          '<div class="asset-stat-num"><span class="asset-stat-label">Trades</span><span class="asset-stat-value mono">' + s.n + '</span></div>' +
          '<div class="asset-stat-num"><span class="asset-stat-label">Total</span><span class="asset-stat-value mono" style="color:' + bestPctColor(s.pct) + '">' + fmtPercent(s.pct) + '</span></div>' +
        '</div></div>';
    }).join('') + '</div>';
  }
  function bestPctColor(v) { return v > 0 ? 'var(--green)' : (v < 0 ? 'var(--red)' : 'var(--textDim)'); }
  function renderBestCards(wrapId, arr) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var bt = bestTradeOf(arr), ba = bestAssetOf(arr);
    var empty = '<span class="best-card-value mono" style="color:var(--textDim)">—</span>';
    var h = '';
    if (bt) {
      var g = tradeGainPercent(bt);
      h += '<div class="best-card clickable" data-best-trade="' + escapeAttr(String(bt.id)) + '" role="button" tabindex="0">' +
        '<div><div class="best-card-label">Best Trade</div><div class="best-card-meta">' + assetBadge(bt.asset) + '<span class="mono best-card-date">' + escapeHtml(fmtBacktestDate(bt.closeDT || bt.openDT)) + '</span></div></div>' +
        '<span class="best-card-value mono" style="color:' + bestPctColor(g) + '">' + fmtPercent(g) + '</span></div>';
    } else {
      h += '<div class="best-card"><div><div class="best-card-label">Best Trade</div></div>' + empty + '</div>';
    }
    if (ba) {
      h += '<div class="best-card"><div><div class="best-card-label">Best Asset</div><div class="best-card-meta">' + assetBadge(ba.asset) + '</div></div>' +
        '<span class="best-card-value mono" style="color:' + bestPctColor(ba.pct) + '">' + fmtPercent(ba.pct) + '</span></div>';
    } else {
      h += '<div class="best-card"><div><div class="best-card-label">Best Asset</div></div>' + empty + '</div>';
    }
    h += assetStatsGridHtml(arr);
    wrap.innerHTML = h;
  }
  Array.prototype.forEach.call(['mdBestWrap', 'qdBestWrap', 'ydBestWrap'], function(id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    function open(e) {
      var card = e.target.closest && e.target.closest('[data-best-trade]');
      if (card) openBestTrade(card.getAttribute('data-best-trade'));
    }
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  });

  // ── Best trade details popup ──
  var bestTradeId = null, bestNoteTimer = null, pendingBestNoteSave = null;
  function openBestTrade(id) {
    flushBestNote();
    var t = trades.filter(function(x) { return String(x.id) === String(id); })[0];
    if (!t) return;
    bestTradeId = t.id;
    var num = tradeNumberOf(t);
    var win = Number(t.r) > 0;
    var gain = tradeGainPercent(t);
    document.getElementById('btTitle').innerHTML = assetBadge(t.asset) + ' ' + directionBadge(t.direction) + ' <span class="bt-num mono">#' + num + '</span>';
    document.getElementById('btGrid').innerHTML =
      '<div><div class="bt-key">Open</div><div class="bt-val mono">' + escapeHtml(fmtDT(t.openDT)) + '</div></div>' +
      '<div><div class="bt-key">Close</div><div class="bt-val mono">' + escapeHtml(fmtDT(t.closeDT)) + '</div></div>' +
      '<div><div class="bt-key">Holding time</div><div class="bt-val mono">' + escapeHtml(formatHolding(t.openDT, t.closeDT)) + '</div></div>' +
      '<div><div class="bt-key">Entry model</div><div class="bt-val">' + tradeModelHTML(t) + '</div></div>' +
      '<div><div class="bt-key">Result</div><div class="bt-val mono" style="color:' + tradeResultColor(t) + '">' + tradeResultLabel(t) + '</div></div>' +
      '<div><div class="bt-key">Gain</div><div class="bt-val mono" style="color:' + bestPctColor(gain) + '">' + escapeHtml(fmtTradeResult(t)) + '</div></div>';
    document.getElementById('btNotes').value = t.notes || '';
    document.getElementById('btSaved').textContent = '';
    try{var draft=localStorage.getItem(tjNoteDraftKey(viewingUser,t.id));if(draft!==null){document.getElementById('btNotes').value=draft;pendingBestNoteSave={id:t.id,user:viewingUser,text:draft};clearTimeout(bestNoteTimer);bestNoteTimer=setTimeout(flushBestNote,400);document.getElementById('btSaved').textContent='Recovered local draft';}}catch(_){}
    var shot = document.getElementById('btShot');
    shot.replaceChildren();
    if (t.chart) {
      var img = document.createElement('img');
      img.src = t.chart; img.alt = 'Trade screenshot'; img.draggable = false;
      if (window.TJMedia && TJMedia.sharpen) TJMedia.sharpen(img, t);
      img.addEventListener('click', function() { if(window.TJMedia)TJMedia.gallery(t);else openFullscreenImage(t.chart); });
      shot.appendChild(img);
    } else {
      var none = document.createElement('div');
      none.className = 'bt-shot-empty';
      none.textContent = 'No screenshot attached';
      shot.appendChild(none);
    }
    document.getElementById('bestTradeOverlay').classList.add('open');
  }
  function closeBestTrade() {
    flushBestNote();
    document.getElementById('bestTradeOverlay').classList.remove('open');
    bestTradeId = null;
  }
  function flushBestNote() {
    var pending = pendingBestNoteSave;
    pendingBestNoteSave = null;
    clearTimeout(bestNoteTimer); bestNoteTimer = null;
    if (!pending || viewingUser !== pending.user) return false;
    var trade = trades.filter(function(x) { return x.id === pending.id; })[0];
    if (!trade) return false;
    var val = pending.text;
    var hasDraft=true;try{hasDraft=localStorage.getItem(tjNoteDraftKey(pending.user,pending.id))!==null;}catch(_){}
    if ((trade.notes || '') === val && !hasDraft) return false;
    trade.notes = val;
    var writeKey=tjNoteDraftKey(pending.user,pending.id);
    var record=Object.assign({},trade,{notes:pending.text});
    var write=(tjNoteWrites[writeKey]||Promise.resolve()).catch(function(){}).then(function(){if(viewingUser!==pending.user)return false;return remoteSaveTrade(record,['notes']);});
    tjNoteWrites[writeKey]=write;
    write.then(function(saved) {
      if(saved){try{if(localStorage.getItem(writeKey)===pending.text)localStorage.removeItem(writeKey);}catch(_){}}
      else if(bestTradeId===pending.id&&viewingUser===pending.user)document.getElementById('btSaved').textContent='Not synced · draft kept on this device';
      if (saved && bestTradeId === pending.id && viewingUser === pending.user && !pendingBestNoteSave && document.getElementById('btNotes').value === val) document.getElementById('btSaved').textContent = 'Saved';
    });
    return true;
  }
  document.getElementById('btNotes').addEventListener('input', function() {
    if (!bestTradeId) return;
    pendingBestNoteSave = { id: bestTradeId, user: viewingUser, text: this.value };
    try{localStorage.setItem(tjNoteDraftKey(viewingUser,bestTradeId),this.value);}catch(_){document.getElementById('btSaved').textContent='Local storage unavailable · keep this editor open';return;}
    var savedEl = document.getElementById('btSaved');
    savedEl.textContent = '';
    clearTimeout(bestNoteTimer);
    bestNoteTimer = setTimeout(flushBestNote, 400);
  });
  document.getElementById('btCloseX').addEventListener('click', closeBestTrade);
  document.getElementById('btClose').addEventListener('click', closeBestTrade);
  document.getElementById('bestTradeOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeBestTrade();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && bestTradeId) closeBestTrade();
  });

  // ── Shared detail helpers (quarter / year) ──
  function fillDetailStats(pre, s) {
    function set(id, v) { var el = document.getElementById(pre + id); if (el) el.textContent = v; return el; }
    var g = set('TotalGain', fmtPercent(s.totalPercent));
    if (g) g.style.color = s.totalPercent >= 0 ? 'var(--green)' : 'var(--red)';
    set('TotalGainSub', s.total + ' trade' + (s.total === 1 ? '' : 's'));
    set('MonthWinRate', s.winRate.toFixed(1) + '%');
    set('WinLossSub', s.wins + 'W / ' + s.losses + 'L');
    set('AvgWinning', s.wins ? fmtR(s.avgWinningRR) : '—');
    set('TotalTrades', s.total);
    set('WinningTrades', s.wins);
    set('LosingTrades', s.losses);
    set('MaxWinStreak', s.maxWinStreak);
    set('MaxLoseStreak', s.maxLoseStreak);
  }

  // ── Quarterly ──
  var quarterSel = null; // { year, q }
  function quarterTrades(year, q, arr) {
    return arr.filter(function(t) {
      var d = tradeStatsDate(t);
      return d.getFullYear() === year && Math.floor(d.getMonth() / 3) === q;
    });
  }
  function moveQuarterSelection(delta) {
    if (!quarterSel) return;
    var q = quarterSel.q + delta, y = quarterSel.year;
    if (q < 0) { q = 3; y--; }
    if (q > 3) { q = 0; y++; }
    quarterSel = { year: y, q: q };
    runPeriodMorph(render);
  }
  document.getElementById('backToQuarters').addEventListener('click', function() { quarterSel = null; render(); });
  document.getElementById('quarterDetailPrev').addEventListener('click', function() { moveQuarterSelection(-1); });
  document.getElementById('quarterDetailNext').addEventListener('click', function() { moveQuarterSelection(1); });

  function renderQuarterly() {
    var filtered = assetFiltered(trades);
    var listView = document.getElementById('quarterListView');
    var detail = document.getElementById('quarterDetailView');
    if (quarterSel === null) {
      listView.style.display = 'block';
      detail.style.display = 'none';
      var years = {};
      filtered.forEach(function(t) { years[tradeStatsDate(t).getFullYear()] = true; });
      var now = new Date();
      years[now.getFullYear()] = true;
      years[now.getFullYear() + 1] = true;
      var yearList = Object.keys(years).map(Number).sort(function(a, b) { return a - b; });
      var html = '';
      yearList.forEach(function(year) {
        html += '<div class="year-header">' + year + '</div>';
        for (var q = 0; q < 4; q++) {
          var s = computeQuarterStats(year, q, filtered);
          html += periodRowHTML('Q' + (q + 1), s, false).replace('data-label="Q' + (q + 1) + '"', 'data-year="' + year + '" data-q="' + q + '"');
        }
      });
      var list = document.getElementById('quarterList');
      list.innerHTML = html;
      Array.prototype.forEach.call(list.querySelectorAll('.period-row'), function(row) {
        row.addEventListener('click', function() {
          quarterSel = { year: parseInt(row.getAttribute('data-year'), 10), q: parseInt(row.getAttribute('data-q'), 10) };
          render();
        });
      });
    } else {
      listView.style.display = 'none';
      detail.style.display = 'block';
      var sub = quarterTrades(quarterSel.year, quarterSel.q, filtered);
      var st = computeStats(sub);
      document.getElementById('quarterDetailTitle').textContent = 'Q' + (quarterSel.q + 1) + ' ' + quarterSel.year;
      document.getElementById('quarterDetailTradeCount').textContent = st.total + ' trade' + (st.total === 1 ? '' : 's');
      fillDetailStats('qd', st);
      renderPeriodDetailChart('quarterChartSvg', 'quarterChartEmpty', sub);
      renderBestCards('qdBestWrap', sub);
      renderTradesTable(sub, 'quarterTradesBody', 'quarterEmptyState', null);
    }
  }

  // ── Yearly ──
  var yearSel = null; // number
  function computeYearStats(year, arr) {
    var sub = arr.filter(function(t) { return tradeStatsDate(t).getFullYear() === year; });
    return computeStats(sub);
  }
  function moveYearSelection(delta) {
    if (yearSel === null) return;
    yearSel += delta;
    runPeriodMorph(render);
  }
  document.getElementById('backToYears').addEventListener('click', function() { yearSel = null; render(); });
  document.getElementById('yearDetailPrev').addEventListener('click', function() { moveYearSelection(-1); });
  document.getElementById('yearDetailNext').addEventListener('click', function() { moveYearSelection(1); });

  function renderYearly() {
    var filtered = assetFiltered(trades);
    var listView = document.getElementById('yearListView');
    var detail = document.getElementById('yearDetailView');
    if (yearSel === null) {
      listView.style.display = 'block';
      detail.style.display = 'none';
      var years = {};
      filtered.forEach(function(t) { years[tradeStatsDate(t).getFullYear()] = true; });
      var now = new Date();
      years[now.getFullYear()] = true;
      var yearList = Object.keys(years).map(Number).sort(function(a, b) { return b - a; });
      var html = yearList.map(function(year) {
        return periodRowHTML(String(year), computeYearStats(year, filtered), false).replace('data-label="' + year + '"', 'data-year="' + year + '"');
      }).join('');
      var list = document.getElementById('yearlyList');
      list.innerHTML = html;
      Array.prototype.forEach.call(list.querySelectorAll('.period-row'), function(row) {
        row.addEventListener('click', function() {
          yearSel = parseInt(row.getAttribute('data-year'), 10);
          render();
        });
      });
    } else {
      listView.style.display = 'none';
      detail.style.display = 'block';
      var sub = filtered.filter(function(t) { return tradeStatsDate(t).getFullYear() === yearSel; });
      var st = computeStats(sub);
      document.getElementById('yearDetailTitle').textContent = String(yearSel);
      document.getElementById('yearDetailTradeCount').textContent = st.total + ' trade' + (st.total === 1 ? '' : 's');
      fillDetailStats('yd', st);
      renderPeriodDetailChart('yearChartSvg', 'yearChartEmpty', sub);
      renderBestCards('ydBestWrap', sub);
      renderTradesTable(sub, 'yearTradesBody', 'yearEmptyState', null);
    }
  }

  // ── Weekly (weeks nested under each month, "Week N" = calendar days N*7-6..N*7 of that month) ──
  function weeksInMonth(year, month) {
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.ceil(daysInMonth / 7);
  }

  function weekStats(year, month, weekNum, arr) {
    var startDay = (weekNum - 1) * 7 + 1;
    var endDay = Math.min(startDay + 6, new Date(year, month + 1, 0).getDate());
    var sub = arr.filter(function(t) {
      var d = tradeStatsDate(t);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() >= startDay && d.getDate() <= endDay;
    });
    return computeStats(sub);
  }

  function weekDateRange(year, month, weekNum) {
    var startDay = (weekNum - 1) * 7 + 1;
    var endDay = Math.min(startDay + 6, new Date(year, month + 1, 0).getDate());
    return EN_MONTHS_SHORT[month] + ' ' + startDay + '–' + endDay;
  }

  function renderWeekly() {
    var filtered = assetFiltered(trades);
    document.getElementById('weeklyYearLabel').textContent = weeklyYear;

    if (weeklySelected === null) {
      document.getElementById('weeklyYearView').style.display = 'block';
      document.getElementById('weekDetailView').style.display = 'none';

      var html = '';
      for (var month = 0; month < 12; month++) {
        var maxWeek = weeksInMonth(weeklyYear, month);
        var weekRows = '';
        for (var w = 1; w <= maxWeek; w++) {
          var s = weekStats(weeklyYear, month, w, filtered);
          if (s.total === 0) continue;
          var label = 'Week ' + w + ' · ' + weekDateRange(weeklyYear, month, w);
          weekRows += periodRowHTML(label, s).replace('data-label="' + label + '"', 'data-month="' + month + '" data-week="' + w + '"');
        }
        if (weekRows) {
          html += '<div class="year-header"' + (month === 0 ? '' : ' style="margin-top:18px;"') + '>' + EN_MONTHS_FULL[month] + '</div>' + weekRows;
        }
      }

      var list = document.getElementById('weeklyList');
      list.innerHTML = html;
      document.getElementById('weeklyEmptyState').style.display = html ? 'none' : 'block';

      Array.prototype.forEach.call(list.querySelectorAll('.period-row'), function(row) {
        row.addEventListener('click', function() {
          weeklySelected = {
            month: parseInt(row.getAttribute('data-month'), 10),
            week: parseInt(row.getAttribute('data-week'), 10)
          };
          render();
        });
      });
    } else {
      document.getElementById('weeklyYearView').style.display = 'none';
      document.getElementById('weekDetailView').style.display = 'block';
      var sel = weeklySelected;
      var s2 = weekStats(weeklyYear, sel.month, sel.week, filtered);
      document.getElementById('weekDetailTitle').textContent =
        'Week ' + sel.week + ' · ' + weekDateRange(weeklyYear, sel.month, sel.week) + ', ' + weeklyYear;
      document.getElementById('wdTrades').textContent = s2.total;
      document.getElementById('wdWinRate').textContent = s2.winRate.toFixed(1) + '%';
      document.getElementById('wdAvgRR').textContent = s2.winsArr.length ? fmtR(s2.avgWinningRR) : '—';
      document.getElementById('wdTotalRR').textContent = fmtPercent(s2.totalPercent) + ' · ' + fmtR(s2.totalRR);
      document.getElementById('wdTotalRR').style.color = s2.totalPercent >= 0 ? 'var(--green)' : 'var(--red)';

      var startDay = (sel.week - 1) * 7 + 1;
      var endDay = Math.min(startDay + 6, new Date(weeklyYear, sel.month + 1, 0).getDate());
      var subWeek = filtered.filter(function(t) {
        var d = tradeStatsDate(t);
        return d.getFullYear() === weeklyYear && d.getMonth() === sel.month && d.getDate() >= startDay && d.getDate() <= endDay;
      });
      renderTradesTable(subWeek, 'weekTradesBody', 'weekEmptyState', null);
    }
  }

  function renderMonthly() {
    var filtered = assetFiltered(trades);
    document.getElementById('yearLabel').textContent = monthlyYear;

    if (monthlySelectedMonth === null) {
      document.getElementById('monthlyYearView').style.display = 'block';
      document.getElementById('monthDetailView').style.display = 'none';
      renderBarChart(monthlyYear, filtered);
      renderMonthList(monthlyYear, filtered);
    } else {
      document.getElementById('monthlyYearView').style.display = 'none';
      document.getElementById('monthDetailView').style.display = 'block';
      var s = monthStats(monthlyYear, monthlySelectedMonth, filtered);
      document.getElementById('monthDetailTitle').textContent = EN_MONTHS_FULL[monthlySelectedMonth] + ' ' + monthlyYear;
      document.getElementById('monthDetailTradeCount').textContent = s.total + ' trade' + (s.total === 1 ? '' : 's');
      document.getElementById('mdTotalGain').textContent = fmtPercent(s.totalPercent);
      document.getElementById('mdTotalGain').style.color = s.totalPercent >= 0 ? 'var(--green)' : 'var(--red)';
      document.getElementById('mdTotalGainSub').textContent = s.total + ' trade' + (s.total === 1 ? '' : 's');
      document.getElementById('mdMonthWinRate').textContent = s.winRate.toFixed(1) + '%';
      document.getElementById('mdWinLossSub').textContent = s.wins + 'W / ' + s.losses + 'L';
      document.getElementById('mdAvgWinning').textContent = s.wins ? fmtR(s.avgWinningRR) : '—';
      document.getElementById('mdTotalTrades').textContent = s.total;
      document.getElementById('mdWinningTrades').textContent = s.wins;
      document.getElementById('mdLosingTrades').textContent = s.losses;
      document.getElementById('mdMaxWinStreak').textContent = s.maxWinStreak;
      document.getElementById('mdMaxLoseStreak').textContent = s.maxLoseStreak;

      var sub = filtered.filter(function(t) {
        var d = tradeStatsDate(t);
        return d.getFullYear() === monthlyYear && d.getMonth() === monthlySelectedMonth;
      });
      renderMonthDetailChart(sub);
      renderBestCards('mdBestWrap', sub);
      renderTradesTable(sub, 'monthTradesBody', 'monthEmptyState', null);
    }
  }

  // ── Pinned chart cards: release on outside click / Esc ─────────────────────
  var tjHoverRegistry = [];
  var tjLastPointerTouch = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  function tjPinHintText() { return tjLastPointerTouch ? 'Tap to pin' : 'Click to pin'; }
  function tjPinHint(tip, pinned) {
    if (!tip) return;
    tip.classList.toggle('tj-pinned', !!pinned);
    var el = tip.querySelector('.chart-tooltip-hint');
    if (el) el.innerHTML = pinned ? 'View trade &rarr;' : tjPinHintText();
  }
  function tjReleasePins(target) {
    for (var i = tjHoverRegistry.length - 1; i >= 0; i--) {
      if (!tjHoverRegistry[i].svg.isConnected) tjHoverRegistry.splice(i, 1);
    }
    tjHoverRegistry.forEach(function(h) {
      if (!h.pinned) return;
      if (target && h.svg.contains(target)) return;
      var tip = h.model && h.model.tip ? h.model.tip() : null;
      if (target && tip && tip.contains(target)) return;
      h.unpin(); h.hide();
    });
  }
  // Only these journal charts use mobile tap-to-dismiss. Desktop and
  // Backtest/Replay interactions keep their existing behavior.
  function tjMobileTooltipChart(svg) {
    return !!(svg && document.body.classList.contains('mobile-mode') &&
      ['chartSvg', 'monthChartSvg', 'quarterChartSvg', 'yearChartSvg'].indexOf(svg.id) !== -1);
  }
  function tjDismissMobileChartTooltip(svg) {
    if (!tjMobileTooltipChart(svg)) return;
    var h = svg._tjHover;
    if (h) { h.unpin(); h.hide(); }
    if (svg.id === 'chartSvg') hideChartTooltip();
    else hideDetailTooltip(svg);
  }
  function tjDismissMobileChartTooltips(target) {
    if (!document.body.classList.contains('mobile-mode')) return;
    ['chartSvg', 'monthChartSvg', 'quarterChartSvg', 'yearChartSvg'].forEach(function(id) {
      var svg = document.getElementById(id);
      if (!svg) return;
      var tip = id === 'chartSvg' ? document.getElementById('tooltip') : svg._tjTip;
      if (target && (svg.contains(target) || (tip && tip.contains(target)))) return;
      tjDismissMobileChartTooltip(svg);
    });
  }
  document.addEventListener('pointerdown', function(e) {
    tjLastPointerTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    tjDismissMobileChartTooltips(e.target);
    tjReleasePins(e.target);
  }, true);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') tjReleasePins(null); });

  // ── Resizable equity-curve height (6-dot grip) ────────────────────────────
  // One height shared by Overview / Month / Quarter / Year, stored per user.
  var TJ_CHART_H_MIN = 240, TJ_CHART_H_MAX = 820;
  var tjChartResizing = false, tjChartResizeEndTimer = null, tjChartHeightSaveTimer = null, tjChartHeight = null, tjChartHeightSaved = null;
  // Height that came from the user's saved settings. While the user is
  // dragging, their own drag wins (it is saved when it ends), so a settings
  // load can never interrupt / freeze a running resize.
  function tjApplyChartHeight(h) {
    var v = (h == null || !isFinite(h)) ? null : Math.round(Math.max(TJ_CHART_H_MIN, Math.min(TJ_CHART_H_MAX, h)));
    tjChartHeightSaved = v;
    if (tjResizeLive || tjResizeAnim.dragging) return;
    // A just-finished drag is still waiting to be saved: the user's newer
    // height stays on screen (and is saved), never the older loaded value.
    if (tjChartHeightSaveTimer) return;
    if (v === tjChartHeight) return;
    tjChartHeight = v;
    var root = document.documentElement;
    if (v == null) root.style.removeProperty('--tj-chart-h'); else root.style.setProperty('--tj-chart-h', v + 'px');
  }
  // Smooth resize: the pointer only sets a target; one rAF loop eases the
  // height toward it and, in the SAME frame, redraws every visible chart.
  // So the SVG is never shown stretched/letterboxed for a frame (that was
  // what made the % axis labels jump), and Month/Quarter/Year glide exactly
  // like Overview.
  var tjResizeAnim = { cur: null, target: null, raf: 0, last: 0, dragging: false, resetPending: false };
  // During a drag NOTHING global changes: only the inline height of the four
  // chart SVGs. (Changing a CSS variable on <html> made the browser restyle the
  // entire page every frame - that is what froze Quarter/Year.) The shared
  // variable is written once, when the drag ends.
  var TJ_CHART_SVG_IDS = ['chartSvg', 'monthChartSvg', 'quarterChartSvg', 'yearChartSvg'];
  var TJ_DETAIL_SVG_IDS = ['monthChartSvg', 'quarterChartSvg', 'yearChartSvg'];
  var tjResizeLive = false;
  function tjWriteChartHeight(h) {
    var v = (Math.round(h * 100) / 100) + 'px';
    TJ_CHART_SVG_IDS.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.height = v; });
  }
  // Month / Quarter / Year: move the existing elements instead of rebuilding
  // the chart. No innerHTML, no stats, no path sampling -> well under 1ms.
  function tjEaseInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function tjDetailWrapWidth(svg) {
    var w = svg.parentElement;
    return w ? w.clientWidth - 40 : 0;
  }
  // Returns true while a month-switch animation is still being handed off.
  function tjRelayoutDetailChart(svg, H, wrapW) {
    var g = svg && svg._tjGeo;
    if (!g || svg.style.display === 'none' || !(wrapW > 0)) return false;
    if (Math.abs(wrapW - g.W) > 0.5) {
      // Width changed mid-drag (e.g. the page scrollbar appeared): rebuild
      // once at the new width (no animation), then keep moving in place.
      var st = svg._chartRenderState;
      svg._tjBlend = null;
      if (svg._tjMorphRaf) { cancelAnimationFrame(svg._tjMorphRaf); svg._tjMorphRaf = 0; }
      if (st && st.retry) { st.key = null; st.retry(); }
      svg._tjRelayout = false;
      g = svg._tjGeo;
      if (!g) return false;
    }
    if (!svg._tjRelayout) {
      svg._tjRelayout = true;
      hideDetailTooltip(svg);
      tjSetHoverModel(svg, null);
      if (svg._tjMorphRaf) {
        // A month/quarter switch is still animating: continue it smoothly
        // from the on-screen shape and scale instead of jumping to the end.
        cancelAnimationFrame(svg._tjMorphRaf); svg._tjMorphRaf = 0;
        var c = svg._tjCurve, ih0 = g.H0 - g.padT - g.padB;
        if (c && c.ys && c.dom && g.toYs && c.ys.length === g.toYs.length && ih0 > 0) {
          var toV = function(y, dm) { return dm.min + (g.padT + ih0 - y) / ih0 * (dm.max - dm.min); };
          svg._tjBlend = {
            from: c.ys.map(function(y) { return toV(y, c.dom); }),
            to: g.toYs.map(function(y) { return toV(y, g.dom); }),
            dom: { min: c.dom.min, max: c.dom.max }, t0: performance.now()
          };
        }
      }
    }
    var innerW = g.W - g.padL - g.padR, innerH = Math.max(10, H - g.padT - g.padB);
    var b = svg._tjBlend, t = 1, dm = g.dom;
    if (b) {
      t = tjEaseInOut(Math.min(1, (performance.now() - b.t0) / 420));
      dm = { min: b.dom.min + (g.dom.min - b.dom.min) * t, max: b.dom.max + (g.dom.max - b.dom.max) * t };
    }
    function yPix(v) { return g.padT + innerH - (v - dm.min) / ((dm.max - dm.min) || 1) * innerH; }
    var lineD, areaD, z = yPix(0);
    if (b && t < 1) {
      var n = b.from.length, d = '';
      for (var k = 0; k < n; k++) {
        var v = b.from[k] + (b.to[k] - b.from[k]) * t;
        d += (k ? ' L ' : 'M ') + (g.x0 + (g.x1 - g.x0) * k / (n - 1)).toFixed(2) + ',' + yPix(v).toFixed(2);
      }
      lineD = d;
      areaD = d + ' L ' + g.x1 + ',' + z + ' L ' + g.x0 + ',' + z + ' Z';
    } else {
      svg._tjBlend = null; b = null;
      var pts = g.entries.map(function(e) { return { x: g.padL + e.xf * innerW, y: yPix(e.eq) }; });
      lineD = smoothPath(pts);
      areaD = lineD + ' L ' + pts[pts.length - 1].x + ',' + z + ' L ' + pts[0].x + ',' + z + ' Z';
    }
    svg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + H);
    var line = svg.querySelector('.month-chart-line'), area = svg.querySelector('.month-chart-area'), zero = svg.querySelector('.month-chart-zero');
    if (line) line.setAttribute('d', lineD);
    if (area) area.setAttribute('d', areaD);
    if (zero) { zero.setAttribute('y1', z); zero.setAttribute('y2', z); }
    Array.prototype.forEach.call(svg.querySelectorAll('.month-chart-grid'), function(el, i) {
      var y = g.padT + innerH - i / 4 * innerH; el.setAttribute('y1', y); el.setAttribute('y2', y);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('text[data-tj-ylabel]'), function(el) {
      var i = Number(el.getAttribute('data-tj-ylabel'));
      el.setAttribute('y', g.padT + innerH - i / 4 * innerH + 4);
      var txt = (dm.min + i / 4 * (dm.max - dm.min)).toFixed(1) + '%';
      if (el.textContent !== txt) el.textContent = txt;
    });
    Array.prototype.forEach.call(svg.querySelectorAll('text[text-anchor="middle"]'), function(el) { el.setAttribute('y', H - 8); });
    return !!b;
  }
  function tjRedrawVisibleCharts(h) {
    if (lastChartData && lastChartData.length > 1) renderChart(lastChartData);
    // Read every width first, then write: one layout per frame.
    var svgs = TJ_DETAIL_SVG_IDS.map(function(id) { return document.getElementById(id); });
    var widths = svgs.map(function(s) {
      return (s && s._tjGeo && s.style.display !== 'none' && s.getClientRects().length) ? tjDetailWrapWidth(s) : 0;
    });
    var busy = false;
    svgs.forEach(function(s, i) { if (widths[i] > 0 && tjRelayoutDetailChart(s, h, widths[i])) busy = true; });
    return busy;
  }
  // Drag finished: commit the shared height once, then one full (non-animated)
  // redraw so hover / morph data match the new size exactly. Safe to call twice.
  function tjFinishChartResize() {
    var a = tjResizeAnim;
    if (a.raf) { cancelAnimationFrame(a.raf); a.raf = 0; }
    a.last = 0;
    a.resetPending = false;
    var root = document.documentElement;
    if (tjChartHeight == null) root.style.removeProperty('--tj-chart-h'); else root.style.setProperty('--tj-chart-h', tjChartHeight + 'px');
    TJ_CHART_SVG_IDS.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.height = ''; });
    tjResizeLive = false;
    if (lastChartData && lastChartData.length > 1) renderChart(lastChartData);
    TJ_DETAIL_SVG_IDS.forEach(function(id) {
      var el = document.getElementById(id), st = el && el._chartRenderState;
      if (!el) return;
      var was = el._tjRelayout;
      el._tjRelayout = false; el._tjBlend = null;
      if (was && st && st.retry) { st.key = null; st.retry(); }
    });
    a.cur = null;
    tjEndChartResize();
  }
  function tjResizeTick(now) {
    var a = tjResizeAnim;
    a.raf = 0;
    var dt = a.last ? Math.min(48, now - a.last) : 16;
    a.last = now;
    var k = tjHoverMotion() ? 1 - Math.exp(-dt / 60) : 1;
    a.cur += (a.target - a.cur) * k;
    if (Math.abs(a.target - a.cur) < 0.25) a.cur = a.target;
    tjWriteChartHeight(a.cur);
    var busy = tjRedrawVisibleCharts(a.cur);
    if (a.cur !== a.target || busy) { a.raf = requestAnimationFrame(tjResizeTick); return; }
    a.last = 0;
    if (!a.dragging) tjFinishChartResize();
  }
  function tjAnimateChartHeight(target, fromSvg, isReset) {
    var a = tjResizeAnim;
    if (!Number.isFinite(target)) return;
    var t = Math.max(TJ_CHART_H_MIN, Math.min(TJ_CHART_H_MAX, target));
    if (a.cur == null || !a.raf) a.cur = (fromSvg && chartCssHeight(fromSvg)) || t;
    a.target = Math.round(t); // whole pixels: the committed height equals the last drawn frame
    a.resetPending = !!isReset;
    tjChartHeight = isReset ? null : Math.round(t);
    tjResizeLive = true;
    tjBeginChartResize();
    if (!a.raf) a.raf = requestAnimationFrame(tjResizeTick);
  }
  // Saved to the SIGNED-IN user's settings only (an admin looking at someone
  // else's journal never changes that person's chart height), and only when
  // the value really changed.
  function tjSaveChartHeight() {
    var user = currentUser && currentUser.login;
    clearTimeout(tjChartHeightSaveTimer);
    tjChartHeightSaveTimer = null;
    if (!user) return;
    var val = tjChartHeight;
    if (val === tjChartHeightSaved) return;
    tjChartHeightSaveTimer = setTimeout(function() {
      tjChartHeightSaveTimer = null;
      var prev = tjChartHeightSaved;
      tjChartHeightSaved = val;
      db.collection('titles').doc(user).set({ chartHeight: val }, { merge: true }).catch(function(err) {
        if (tjChartHeightSaved === val) tjChartHeightSaved = prev;
        console.error('chartHeight save failed:', err);
      });
    }, 300);
  }
  function tjBeginChartResize() {
    clearTimeout(tjChartResizeEndTimer);
    tjChartResizing = true;
    document.documentElement.classList.add('tj-chart-resizing');
  }
  function tjEndChartResize() {
    document.documentElement.classList.remove('tj-chart-resizing');
    clearTimeout(tjChartResizeEndTimer);
    // Let layout / resize observers settle for one frame, then animations are
    // back to normal (a month switch right after a resize animates again).
    tjChartResizeEndTimer = setTimeout(function() {
      requestAnimationFrame(function() { requestAnimationFrame(function() {
        if (!tjResizeLive && !tjResizeAnim.dragging && !tjBtResizeLive && !tjBtResize.dragging) tjChartResizing = false;
      }); });
    }, 0);
  }
  // While resizing, charts are redrawn every frame: never replay draw-in/fade.
  function tjFreezeChartAnim(svg) {
    if (!tjChartResizing || !svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll('path'), function(p) { p.style.animation = 'none'; p.style.transition = 'none'; });
  }
  function tjInitChartGrip(svgId, cardSelector) {
    var svg = document.getElementById(svgId);
    if (!svg) return;
    var card = svg.closest(cardSelector);
    if (!card || card.querySelector('.tj-chart-grip')) return;
    card.classList.add('tj-chart-resizable');
    var grip = document.createElement('div');
    grip.className = 'tj-chart-grip';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', 'Resize chart');
    grip.title = 'Drag to resize · double-click to reset';
    grip.tabIndex = 0;
    grip.innerHTML = '<span class="tj-chart-grip-dots"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    card.appendChild(grip);
    var drag = null;
    grip.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var css = chartCssHeight(svg), r = svg.getBoundingClientRect();
      drag = { id: e.pointerId, y: e.clientY, h: css || r.height || 380, scale: (css > 0 && r.height > 0) ? Math.max(0.1, r.height / css) : 1, moved: false };
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      grip.classList.add('dragging');
      tjResizeAnim.dragging = true;
      tjBeginChartResize();
    });
    grip.addEventListener('pointermove', function(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientY - drag.y) < 1) return;
      drag.moved = true;
      tjAnimateChartHeight(drag.h + (e.clientY - drag.y) / drag.scale, svg, false);
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var moved = drag.moved, pid = drag.id;
      drag = null;
      try { if (grip.hasPointerCapture(pid)) grip.releasePointerCapture(pid); } catch (err) {}
      grip.classList.remove('dragging');
      tjResizeAnim.dragging = false;
      if (tjResizeLive) tjFinishChartResize();
      else tjEndChartResize();
      if (moved) tjSaveChartHeight();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    // The browser can drop the drag without a pointerup (alt-tab, system
    // dialog, window loses focus): end it the same way.
    grip.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', function() { if (drag) end(null); });
    grip.addEventListener('click', function(e) { e.stopPropagation(); });
    grip.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      tjAnimateChartHeight(svgId === 'chartSvg' ? 380 : 390, svg, true); tjSaveChartHeight();
    });
    grip.addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var cur = chartCssHeight(svg) || 390;
      var base = tjResizeAnim.raf ? tjResizeAnim.target : cur;
      tjAnimateChartHeight(base + (e.key === 'ArrowDown' ? 24 : -24), svg, false); tjSaveChartHeight();
    });
  }
  tjInitChartGrip('chartSvg', '.card');
  tjInitChartGrip('monthChartSvg', '.month-detail-chart-card');
  tjInitChartGrip('quarterChartSvg', '.month-detail-chart-card');
  tjInitChartGrip('yearChartSvg', '.month-detail-chart-card');

  // ── Backtest equity curve: same 6-dot grip, its own height ───────────────
  // One height for every backtest (new ones included), stored per signed-in
  // user as titles/{user}.backtestChartHeight. During a drag only the inline
  // height of #backtestChart changes and the existing elements are moved in
  // place; one full redraw happens when the drag ends.
  var TJ_BT_H_MIN = 220, TJ_BT_H_MAX = 820, TJ_BT_H_DEFAULT = 300;
  var tjBtResizeLive = false;
  var tjBtResize = { h: null, saved: null, cur: null, target: null, raf: 0, last: 0, dragging: false, saveTimer: null };
  function tjBtClamp(h) { return Math.max(TJ_BT_H_MIN, Math.min(TJ_BT_H_MAX, h)); }
  function tjApplyBacktestChartHeight(h) {
    var v = (h == null || !isFinite(h)) ? null : Math.round(tjBtClamp(h));
    tjBtResize.saved = v;
    if (tjBtResizeLive || tjBtResize.dragging) return;
    if (tjBtResize.saveTimer) return; // pending save of a newer drag wins
    if (v === tjBtResize.h) return;
    tjBtResize.h = v;
    var root = document.documentElement;
    if (v == null) root.style.removeProperty('--tj-bt-chart-h'); else root.style.setProperty('--tj-bt-chart-h', v + 'px');
  }
  function tjRelayoutBacktestChart(svg, H, wrapW) {
    var g = svg && svg._tjBtGeo;
    if (!g || svg.style.display === 'none' || !(wrapW > 0)) return;
    if (Math.abs(wrapW - g.W) > 0.5) {
      var st = svg._chartRenderState;
      if (st && st.retry) { st.key = null; st.retry(); }
      g = svg._tjBtGeo;
      if (!g) return;
    }
    svg._tjBtRelayout = true;
    var ih = Math.max(10, H - g.pT - g.pB), n = g.eq.length, span = (g.max - g.min) || 1;
    function yp(v) { return g.pT + ih - (v - g.min) / span * ih; }
    function xp(i) { return g.pL + i / Math.max(1, n - 1) * (g.W - g.pL - g.pR); }
    svg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + H);
    Array.prototype.forEach.call(svg.querySelectorAll('.chart-grid-line'), function(el, i) {
      var y = yp(g.min + i / 4 * span); el.setAttribute('y1', y); el.setAttribute('y2', y);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('text[data-bt-y]'), function(el) {
      var i = Number(el.getAttribute('data-bt-y')); el.setAttribute('y', yp(g.min + i / 4 * span) + 4);
    });
    var zero = svg.querySelector('.bt-zero'), z = yp(0);
    if (zero) { zero.setAttribute('y1', z); zero.setAttribute('y2', z); }
    var path = svg.querySelector('path');
    if (path) path.setAttribute('d', smoothPath(g.eq.map(function(v, i) { return { x: xp(i), y: yp(v) }; })));
    Array.prototype.forEach.call(svg.querySelectorAll('text[text-anchor="middle"]'), function(el) { el.setAttribute('y', H - 7); });
  }
  function tjFinishBacktestResize() {
    var a = tjBtResize, svg = document.getElementById('backtestChart');
    if (a.raf) { cancelAnimationFrame(a.raf); a.raf = 0; }
    a.last = 0;
    var root = document.documentElement;
    if (a.h == null) root.style.removeProperty('--tj-bt-chart-h'); else root.style.setProperty('--tj-bt-chart-h', a.h + 'px');
    tjBtResizeLive = false;
    if (svg) {
      svg.style.height = '';
      var st = svg._chartRenderState;
      if (svg._tjBtRelayout && st && st.retry) { st.key = null; st.retry(); }
      svg._tjBtRelayout = false;
    }
    a.cur = null;
    tjEndChartResize();
  }
  function tjBtTick(now) {
    var a = tjBtResize, svg = document.getElementById('backtestChart');
    a.raf = 0;
    var dt = a.last ? Math.min(48, now - a.last) : 16;
    a.last = now;
    var k = tjHoverMotion() ? 1 - Math.exp(-dt / 60) : 1;
    a.cur += (a.target - a.cur) * k;
    if (Math.abs(a.target - a.cur) < 0.25) a.cur = a.target;
    if (svg) {
      svg.style.height = (Math.round(a.cur * 100) / 100) + 'px';
      var w = svg.closest('.chart-wrap') || svg.parentElement;
      if (svg._tjBtGeo && svg.style.display !== 'none' && w && w.getClientRects().length) tjRelayoutBacktestChart(svg, a.cur, w.clientWidth);
    }
    if (a.cur !== a.target) { a.raf = requestAnimationFrame(tjBtTick); return; }
    a.last = 0;
    if (!a.dragging) tjFinishBacktestResize();
  }
  function tjAnimateBacktestHeight(target, svg, isReset) {
    if (!Number.isFinite(target)) return;
    var a = tjBtResize, t = Math.round(tjBtClamp(target));
    if (a.cur == null || !a.raf) a.cur = chartCssHeight(svg) || t;
    a.target = t;
    a.h = isReset ? null : t;
    tjBtResizeLive = true;
    tjBeginChartResize();
    if (!a.raf) a.raf = requestAnimationFrame(tjBtTick);
  }
  function tjSaveBacktestChartHeight() {
    var a = tjBtResize, user = currentUser && currentUser.login;
    clearTimeout(a.saveTimer); a.saveTimer = null;
    if (!user) return;
    var val = a.h;
    if (val === a.saved) return;
    a.saveTimer = setTimeout(function() {
      a.saveTimer = null;
      var prev = a.saved;
      a.saved = val;
      db.collection('titles').doc(user).set({ backtestChartHeight: val }, { merge: true }).catch(function(err) {
        if (a.saved === val) a.saved = prev;
        console.error('backtestChartHeight save failed:', err);
      });
    }, 300);
  }
  function tjInitBacktestGrip() {
    var svg = document.getElementById('backtestChart');
    if (!svg) return;
    var card = svg.closest('.card');
    if (!card || card.querySelector('.tj-chart-grip')) return;
    card.classList.add('tj-chart-resizable');
    if (svg.style.display === 'none') card.classList.add('tj-bt-empty');
    var grip = document.createElement('div');
    grip.className = 'tj-chart-grip';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', 'Resize chart');
    grip.title = 'Drag to resize · double-click to reset';
    grip.tabIndex = 0;
    grip.innerHTML = '<span class="tj-chart-grip-dots"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    card.appendChild(grip);
    var drag = null;
    grip.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var css = chartCssHeight(svg), r = svg.getBoundingClientRect();
      drag = { id: e.pointerId, y: e.clientY, h: css || r.height || TJ_BT_H_DEFAULT, scale: (css > 0 && r.height > 0) ? Math.max(0.1, r.height / css) : 1, moved: false };
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      grip.classList.add('dragging');
      tjBtResize.dragging = true;
      tjBeginChartResize();
    });
    grip.addEventListener('pointermove', function(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientY - drag.y) < 1) return;
      drag.moved = true;
      tjAnimateBacktestHeight(drag.h + (e.clientY - drag.y) / drag.scale, svg, false);
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var moved = drag.moved, pid = drag.id;
      drag = null;
      try { if (grip.hasPointerCapture(pid)) grip.releasePointerCapture(pid); } catch (err) {}
      grip.classList.remove('dragging');
      tjBtResize.dragging = false;
      if (tjBtResizeLive) tjFinishBacktestResize();
      else tjEndChartResize();
      if (moved) tjSaveBacktestChartHeight();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', function() { if (drag) end(null); });
    grip.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      tjAnimateBacktestHeight(TJ_BT_H_DEFAULT, svg, true); tjSaveBacktestChartHeight();
    });
    grip.addEventListener('keydown', function(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var cur = chartCssHeight(svg) || TJ_BT_H_DEFAULT;
      var base = tjBtResize.raf ? tjBtResize.target : cur;
      tjAnimateBacktestHeight(base + (e.key === 'ArrowDown' ? 24 : -24), svg, false); tjSaveBacktestChartHeight();
    });
  }
  tjInitBacktestGrip();

  // ── Smooth equity-curve hover ─────────────────────────────────────────────
  // A vertical guide line and a dot glide along the curve to the trade nearest
  // to the cursor; the dot rides the real (smoothed) curve, not a straight cut.
  function tjHoverMotion() {
    if (mobilePerformanceEnabled()) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function tjChartHover(svg) {
    if (svg._tjHover) {
      if (tjHoverRegistry.indexOf(svg._tjHover) < 0) tjHoverRegistry.push(svg._tjHover);
      return svg._tjHover;
    }
    var NS = 'http://www.w3.org/2000/svg';
    var h = svg._tjHover = { idx: -1, x: 0, tx: 0, raf: 0, last: 0, on: false, g: null, model: null, samples: null, pointer: 'mouse', pinned: false, svg: svg };
    tjHoverRegistry.push(h);
    function ensure() {
      if (h.g && h.g.parentNode === svg) return true;
      if (!svg._hoverModel) return false;
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'tj-hover');
      g.setAttribute('pointer-events', 'none');
      var sampler = document.createElementNS(NS, 'path');
      sampler.setAttribute('fill', 'none'); sampler.setAttribute('stroke', 'none');
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('class', 'tj-hover-line');
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('class', 'tj-hover-dot');
      dot.setAttribute('r', '5.5');
      g.appendChild(sampler); g.appendChild(line); g.appendChild(dot);
      svg.appendChild(g);
      h.g = g; h.sampler = sampler; h.line = line; h.dot = dot; h.model = null;
      return true;
    }
    function sync(m) {
      if (h.model === m) return;
      h.model = m; h.samples = null; h.idx = -1;
      h.sampler.setAttribute('d', m.d);
    }
    function samples() {
      if (h.samples) return h.samples;
      var out = [];
      try {
        var len = h.sampler.getTotalLength();
        for (var l = 0; l <= len; l += 2) { var p = h.sampler.getPointAtLength(l); out.push({ x: p.x, y: p.y }); }
        var e = h.sampler.getPointAtLength(len); out.push({ x: e.x, y: e.y });
      } catch (err) { out = []; }
      if (out.length < 2) out = h.model.pts.slice();
      h.samples = out;
      return out;
    }
    function yAt(x) {
      var a = samples(), lo = 0, hi = a.length - 1;
      if (x <= a[0].x) return a[0].y;
      if (x >= a[hi].x) return a[hi].y;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (a[mid].x <= x) lo = mid; else hi = mid; }
      var t = (x - a[lo].x) / ((a[hi].x - a[lo].x) || 1);
      return a[lo].y + (a[hi].y - a[lo].y) * t;
    }
    function nearest(vx) {
      var m = h.model, best = -1, bd = Infinity;
      for (var i = 0; i < m.pts.length; i++) {
        if (!m.data[i] || !m.data[i].trade) continue;
        var d = Math.abs(m.pts[i].x - vx);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    // A tap far from the curve is empty space, not the nearest trade by X.
    // Use a forgiving CSS-pixel radius so a finger can still select the line.
    function mobileChartBlankTap(e) {
      if (!tjMobileTooltipChart(svg)) return false;
      var m = svg._hoverModel;
      if (!m || !m.pts || !m.pts.length || !ensure()) return false;
      sync(m);
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var vx = (e.clientX - r.left) * m.W / r.width;
      var curveY = r.top + yAt(vx) * r.height / m.H;
      return vx < m.pts[0].x || vx > m.pts[m.pts.length - 1].x || Math.abs(e.clientY - curveY) > 24;
    }
    function paint() {
      var m = h.model; if (!m) return;
      var y = yAt(h.x);
      h.line.setAttribute('x1', h.x); h.line.setAttribute('x2', h.x);
      h.line.setAttribute('y1', m.top); h.line.setAttribute('y2', m.bottom);
      h.dot.setAttribute('cx', h.x); h.dot.setAttribute('cy', y);
      h.dot.setAttribute('fill', m.color);
      if (h.on) h.dot.setAttribute('opacity', '1');
      if (m.onFrame) m.onFrame(h.idx, h.x, y);
    }
    function tick(now) {
      h.raf = 0;
      var dt = h.last ? Math.min(64, now - h.last) : 16;
      h.last = now;
      h.x += (h.tx - h.x) * (1 - Math.exp(-dt / 75));
      if (Math.abs(h.tx - h.x) < 0.25) h.x = h.tx;
      paint();
      if (h.x !== h.tx) h.raf = requestAnimationFrame(tick); else h.last = 0;
    }
    function move(e) {
      if (mobileChartBlankTap(e)) return;
      if (h.pinned) return;
      var m = svg._hoverModel;
      if (!m || !ensure()) return;
      sync(m);
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var idx = nearest((e.clientX - r.left) * m.W / r.width);
      if (idx < 0) return;
      var wasOn = h.on;
      h.tx = m.pts[idx].x;
      if (!wasOn || !tjHoverMotion()) { h.x = h.tx; if (h.raf) { cancelAnimationFrame(h.raf); h.raf = 0; h.last = 0; } }
      h.on = true;
      h.g.classList.add('on');
      svg.classList.add('tj-hover-active');
      if (idx !== h.idx) { h.idx = idx; if (m.onEnter) m.onEnter(idx); }
      if (h.x === h.tx) paint(); else if (!h.raf) h.raf = requestAnimationFrame(tick);
    }
    function hide() {
      if (!h.on || h.pinned) return;
      h.on = false;
      svg.classList.remove('tj-hover-active');
      var m = h.model, idx = h.idx;
      h.idx = -1;
      if (!(m && m.keepOn && m.keepOn()) && h.g) h.g.classList.remove('on');
      if (m && m.onLeave) m.onLeave(idx);
    }
    svg.addEventListener('pointermove', move);
    // Pin: a click freezes the dot + card on that trade, so the card can be
    // reached and clicked. Click the same trade again (or the card) to open it,
    // click another trade to glide the pin there, click outside / Esc to release.
    function pinTo(idx) {
      var m = svg._hoverModel;
      if (!m || !ensure()) return;
      sync(m);
      var wasOn = h.on;
      h.on = true;
      h.g.classList.add('on');
      svg.classList.add('tj-hover-active', 'tj-pinned');
      h.tx = m.pts[idx].x;
      if (!wasOn || !tjHoverMotion()) { h.x = h.tx; if (h.raf) { cancelAnimationFrame(h.raf); h.raf = 0; h.last = 0; } }
      if (idx !== h.idx) { h.idx = idx; if (m.onEnter) m.onEnter(idx); }
      h.pinned = true;
      if (m.onPin) m.onPin(idx);
      if (h.x === h.tx) paint(); else if (!h.raf) h.raf = requestAnimationFrame(tick);
    }
    function unpin() {
      if (!h.pinned) return;
      h.pinned = false;
      svg.classList.remove('tj-pinned');
      if (h.model && h.model.onUnpin) h.model.onUnpin();
    }
    function openPinned() {
      var m = h.model, idx = h.idx;
      if (!m || idx < 0) return;
      unpin();
      if (m.onClick) m.onClick(idx);
      hide();
    }
    svg.addEventListener('pointerdown', function(e) {
      h.pointer = e.pointerType || 'mouse';
      if (mobileChartBlankTap(e)) { tjDismissMobileChartTooltip(svg); return; }
      move(e);
    });
    svg.addEventListener('pointerleave', function(e) { if (!e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen') hide(); });
    svg.addEventListener('click', function(e) {
      if (mobileChartBlankTap(e)) { tjDismissMobileChartTooltip(svg); return; }
      var m = svg._hoverModel;
      if (!m) return;
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      if (!ensure()) return;
      sync(m);
      var idx = nearest((e.clientX - r.left) * m.W / r.width);
      if (idx < 0) return;
      e.stopPropagation();
      if (h.pinned && idx === h.idx) { openPinned(); return; }
      pinTo(idx);
    });
    h.hide = hide;
    h.unpin = unpin;
    h.open = openPinned;
    h.reset = function() {
      if (h.raf) cancelAnimationFrame(h.raf);
      if (h.pinned && h.model && h.model.onUnpin) h.model.onUnpin();
      h.pinned = false; svg.classList.remove('tj-pinned');
      h.raf = 0; h.last = 0; h.on = false; h.idx = -1; h.model = null; h.samples = null;
      if (h.g && h.g.parentNode) h.g.parentNode.removeChild(h.g);
      h.g = null;
      svg.classList.remove('tj-hover-active');
    };
    return h;
  }
  function tjSetHoverModel(svg, model) {
    if (!svg) return;
    var h = tjChartHover(svg);
    if (h.on && h.model && h.model.onLeave) h.model.onLeave(h.idx);
    h.reset();
    svg._hoverModel = model || null;
  }
  var tjTradeNumbers = { source: null, length: -1, map: null };
  function invalidateTradeNumbers() { tjTradeNumbers.map = null; }
  function tradeNumberOf(t) {
    if (!t) return 0;
    if (!tjTradeNumbers.map || tjTradeNumbers.source !== trades || tjTradeNumbers.length !== trades.length) {
      var map = Object.create(null);
      trades.slice().sort(function(a, b) { return new Date(a.openDT) - new Date(b.openDT); }).forEach(function(trade, i) { map[String(trade.id)] = i + 1; });
      tjTradeNumbers = { source: trades, length: trades.length, map: map };
    }
    return tjTradeNumbers.map[String(t.id)] || 0;
  }

  function detailChartTooltip(svg) {
    if (svg._tjTip && svg._tjTip.isConnected) return svg._tjTip;
    var card = svg.closest('.month-detail-chart-card') || svg.parentElement;
    var tip = document.createElement('div');
    tip.className = 'tooltip tj-detail-tooltip';
    tip.addEventListener('pointerenter', function() { if (svg._tjTipTimer) { clearTimeout(svg._tjTipTimer); svg._tjTipTimer = null; } });
    tip.addEventListener('pointerleave', function() { if (svg._tjHover && svg._tjHover.pinned) return; hideDetailTooltip(svg, true); });
    tip.addEventListener('click', function(e) {
      e.stopPropagation();
      if (e.target.closest && e.target.closest('a.trade-model-link')) return;
      if (svg._tjHover && svg._tjHover.pinned) { svg._tjHover.open(); return; }
      if (tip._tradeId != null) { hideDetailTooltip(svg); openBestTrade(tip._tradeId); }
    });
    card.appendChild(tip);
    svg._tjTip = tip;
    return tip;
  }
  function hideDetailTooltip(svg, delayed) {
    var tip = svg && svg._tjTip;
    if (!tip) return;
    if (svg._tjTipTimer) clearTimeout(svg._tjTipTimer);
    svg._tjTipTimer = null;
    function go() {
      svg._tjTipTimer = null;
      tip.classList.remove('open', 'tj-pinned');
      if (svg._tjHover && !svg._tjHover.on && svg._tjHover.g) svg._tjHover.g.classList.remove('on');
    }
    if (delayed) svg._tjTipTimer = setTimeout(go, 220); else go();
  }
  function placeDetailTooltip(svg, tip, W, H, x, y) {
    var card = tip.parentElement;
    var sr = svg.getBoundingClientRect(), cr = card.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    var ax = sr.left - cr.left + x * sr.width / W;
    var ay = sr.top - cr.top + y * sr.height / H;
    var tw = tip.offsetWidth, th = tip.offsetHeight, gap = 18, edge = 8, hyst = 24;
    var cw = card.clientWidth, ch = card.clientHeight;
    // Keep the current side until it really stops fitting; switch back only
    // with some margin, so the card never jitters between sides.
    var right = tip._tjRight !== false, above = tip._tjAbove !== false;
    if (right && ax + gap + tw > cw - edge) right = false;
    else if (!right && ax + gap + tw <= cw - edge - hyst) right = true;
    if (!right && ax - gap - tw < edge) right = true;
    if (above && ay - gap - th < edge) above = false;
    else if (!above && ay - gap - th >= edge + hyst) above = true;
    tip._tjRight = right; tip._tjAbove = above;
    var left = right ? ax + gap : ax - tw - gap;
    var top = above ? ay - th - gap : ay + gap;
    left = Math.max(edge, Math.min(left, cw - tw - edge));
    top = Math.max(edge, Math.min(top, ch - th - edge));
    tip.classList.remove('above', 'left-side');
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  // Period charts (month / quarter / year): draw-in on first show, smooth
  // morph old curve -> new curve when flipping periods with the arrows.
  var periodChartMorphNext = false;
  function runPeriodMorph(fn) {
    periodChartMorphNext = true;
    try { fn(); } finally { periodChartMorphNext = false; }
  }
  function renderMonthDetailChartUncached(arr, svgId, emptyId) {
    svgId = svgId || 'monthChartSvg';
    var gradId = 'monthCurveGradient' + (svgId === 'monthChartSvg' ? '' : svgId);
    var svg = document.getElementById(svgId);
    var empty = document.getElementById(emptyId || 'monthChartEmpty');
    var data = computeStats(arr).percentChartData;
    // Monthly detail charts are intentionally neutral and do not follow the global curve colour.
    var monthCurveColor = '#8fa3b8';
    svg._monthChartTrades = arr.slice();
    if (svg._tjMorphRaf) { cancelAnimationFrame(svg._tjMorphRaf); svg._tjMorphRaf = 0; }
    hideDetailTooltip(svg);
    var wantMorph = periodChartMorphNext;
    var prev = svg.style.display !== 'none' ? svg._tjCurve : null;
    if (data.length <= 1) {
      tjSetHoverModel(svg, null);
      svg._tjCurve = null;
      svg._tjGeo = null;
      svg.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    svg.style.display = 'block';
    empty.style.display = 'none';

    var wrap = svg.parentElement;
    var W = (wrap ? wrap.clientWidth - 40 : 0) || svg.clientWidth || 800;
    var size = mobileChartSize(svg, W, chartCssHeight(svg) || 390);
    W = size.width;
    var H = size.height, padL = 50, padR = 8, padT = 18, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var values = data.map(function(d) { return d.equity; });
    var minY = Math.min(0, Math.min.apply(null, values));
    var maxY = Math.max(0, Math.max.apply(null, values));
    if (minY === maxY) { minY -= 1; maxY += 1; }
    var rangePad = (maxY - minY) * .08;
    minY -= rangePad; maxY += rangePad;
    var dom = { min: minY, max: maxY };
    var n = data.length;
    var entries = data.map(function(d, i) { return { xf: i / Math.max(1, n - 1), eq: d.equity }; });
    function frameFor(ents, dm) {
      function yPix(v) { return padT + innerH - (v - dm.min) / ((dm.max - dm.min) || 1) * innerH; }
      var pts = ents.map(function(e) { return { x: padL + e.xf * innerW, y: yPix(e.eq) }; });
      var linePath = smoothPath(pts);
      var zeroY = yPix(0);
      return { pts: pts, linePath: linePath, zeroY: zeroY,
        areaPath: linePath + ' L ' + pts[pts.length - 1].x + ',' + zeroY + ' L ' + pts[0].x + ',' + zeroY + ' Z' };
    }
    function yLabel(i, dm) { return (dm.min + i / 4 * (dm.max - dm.min)).toFixed(1) + '%'; }

    var finalFrame = frameFor(entries, dom);
    var x0 = padL, x1 = W - padR, SN = 180;
    // Both curves are resampled at the same x positions, so any trade count
    // morphs cleanly; an interrupted morph continues from the on-screen shape.
    var canMorph = !!(wantMorph && prev && prev.W === W && prev.H === H && prev.ys && prev.ys.length === SN && tjHoverMotion());
    var fromYs = canMorph ? prev.ys.slice() : null;
    var fromDom = canMorph ? prev.dom : null;
    var fromZero = canMorph ? prev.zeroY : 0;
    var labelDom = canMorph ? fromDom : dom;
    function polyD(ys) {
      var d = '';
      for (var k = 0; k < ys.length; k++) d += (k ? ' L ' : 'M ') + (x0 + (x1 - x0) * k / (ys.length - 1)).toFixed(2) + ',' + ys[k].toFixed(2);
      return d;
    }
    function areaD(lineD, z) { return lineD + ' L ' + x1 + ',' + z + ' L ' + x0 + ',' + z + ' Z'; }
    function sampleYs(d) {
      var pts = [];
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'none');
      svg.appendChild(p);
      try {
        var len = p.getTotalLength();
        for (var l = 0, lStep = tjChartResizing ? 6 : 1.5; l <= len; l += lStep) { var q = p.getPointAtLength(l); pts.push({ x: q.x, y: q.y }); }
        var e = p.getPointAtLength(len); pts.push({ x: e.x, y: e.y });
      } catch (err) { pts = []; }
      svg.removeChild(p);
      if (pts.length < 2) pts = finalFrame.pts;
      var ys = [], jj = 0;
      for (var k = 0; k < SN; k++) {
        var x = x0 + (x1 - x0) * k / (SN - 1);
        while (jj < pts.length - 2 && pts[jj + 1].x < x) jj++;
        var a = pts[jj], b = pts[jj + 1] || a;
        var t = Math.max(0, Math.min(1, (x - a.x) / ((b.x - a.x) || 1)));
        ys.push(a.y + (b.y - a.y) * t);
      }
      return ys;
    }
    var startLine = canMorph ? polyD(fromYs) : finalFrame.linePath;
    var startArea = canMorph ? areaD(startLine, fromZero) : finalFrame.areaPath;
    var startZero = canMorph ? fromZero : finalFrame.zeroY;

    var yMarkup = '';
    for (var yTick = 0; yTick <= 4; yTick++) {
      var y = padT + innerH - yTick / 4 * innerH;
      yMarkup += '<line class="month-chart-grid" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" />';
      yMarkup += '<text data-tj-ylabel="' + yTick + '" x="3" y="' + (y + 4) + '" fill="#687489" font-size="12" font-family="TJ Digits, TJ Text, sans-serif">' + yLabel(yTick, labelDom) + '</text>';
    }
    function xPix(i) { return padL + i / Math.max(1, n - 1) * innerW; }
    var xMarkup = '';
    var last = n - 1;
    var xStep = Math.max(1, Math.ceil(last / Math.max(1, Math.floor(innerW / 48))));
    for (var xTick = 0; xTick <= last; xTick += xStep) {
      xMarkup += '<text x="' + xPix(xTick) + '" y="' + (H - 8) + '" fill="#687489" font-size="12" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">' + xTick + '</text>';
    }
    if (last % xStep !== 0) xMarkup += '<text x="' + xPix(last) + '" y="' + (H - 8) + '" fill="#687489" font-size="12" font-family="TJ Digits, TJ Text, sans-serif" text-anchor="middle">' + last + '</text>';

    tjSetHoverModel(svg, null);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + monthCurveColor + '" stop-opacity=".26"/><stop offset="100%" stop-color="' + monthCurveColor + '" stop-opacity=".035"/></linearGradient></defs>' +
      yMarkup + '<line class="month-chart-zero" x1="' + padL + '" y1="' + startZero + '" x2="' + (W - padR) + '" y2="' + startZero + '" />' +
      '<path class="month-chart-area" d="' + startArea + '" fill="url(#' + gradId + ')" />' +
      (canMorph
        ? '<path class="month-chart-line tj-morph" d="' + startLine + '" fill="none" stroke="' + monthCurveColor + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />'
        : '<path class="month-chart-line" pathLength="1" stroke-dasharray="1" d="' + finalFrame.linePath + '" fill="none" stroke="' + monthCurveColor + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />') +
      xMarkup;
    tjFreezeChartAnim(svg);
    var toYs = sampleYs(finalFrame.linePath);
    svg._tjCurve = { W: W, H: H, dom: dom, zeroY: finalFrame.zeroY, ys: toYs };
    svg._tjGeo = { W: W, H0: H, padL: padL, padR: padR, padT: padT, padB: padB, entries: entries, dom: dom, x0: x0, x1: x1, toYs: toYs };

    function enableHover() {
      // Mid-resize (e.g. a trade synced from another device while dragging):
      // keep hover off; the full redraw after the drag turns it back on.
      if (tjResizeLive) { svg._tjRelayout = true; tjSetHoverModel(svg, null); return; }
      tjSetHoverModel(svg, {
        W: W, H: H, pts: finalFrame.pts, data: data, d: finalFrame.linePath,
        top: padT, bottom: padT + innerH, color: monthCurveColor,
        onEnter: function(idx) {
          var t = data[idx] && data[idx].trade;
          if (!t) return;
          var tip = detailChartTooltip(svg);
          if (svg._tjTipTimer) { clearTimeout(svg._tjTipTimer); svg._tjTipTimer = null; }
          var g = tradeGainPercent(t);
          tip._tradeId = t.id;
          tip.innerHTML = '<div class="chart-tooltip-title">Trade #' + tradeNumberOf(t) + ' · ' + escapeHtml(t.asset || '') + '</div>' +
            '<div class="chart-tooltip-result mono" style="color:' + tradeResultColor(t) + '">' + fmtPercent(g) + '</div>' +
            '<div class="chart-tooltip-hint">' + tjPinHintText() + '</div>';
          tip.classList.add('open');
        },
        onFrame: function(idx, x, y) {
          var tip = svg._tjTip;
          if (tip && tip.classList.contains('open')) placeDetailTooltip(svg, tip, W, H, x, y);
        },
        onLeave: function() { hideDetailTooltip(svg, true); },
        keepOn: function() { return !!svg._tjTipTimer; },
        tip: function() { return svg._tjTip || null; },
        onPin: function() {
          if (svg._tjTipTimer) { clearTimeout(svg._tjTipTimer); svg._tjTipTimer = null; }
          var tip = detailChartTooltip(svg);
          tip.classList.add('open');
          tjPinHint(tip, true);
        },
        onUnpin: function() { tjPinHint(svg._tjTip, false); },
        onClick: function(idx) {
          var t = data[idx] && data[idx].trade;
          if (!t) return;
          hideDetailTooltip(svg);
          openBestTrade(t.id);
        }
      });
    }
    if (!canMorph) { enableHover(); return; }

    var line = svg.querySelector('.month-chart-line');
    var area = svg.querySelector('.month-chart-area');
    var zero = svg.querySelector('.month-chart-zero');
    var labels = svg.querySelectorAll('text[data-tj-ylabel]');
    var duration = 800, start = null, toZero = finalFrame.zeroY;
    function lerp(a, b, t) { return a + (b - a) * t; }
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    svg._tjCurve = { W: W, H: H, dom: fromDom, zeroY: fromZero, ys: fromYs };
    function paint(t) {
      var cur = new Array(SN);
      for (var k = 0; k < SN; k++) cur[k] = lerp(fromYs[k], toYs[k], t);
      var dm = { min: lerp(fromDom.min, dom.min, t), max: lerp(fromDom.max, dom.max, t) };
      var z = lerp(fromZero, toZero, t);
      var ld = polyD(cur);
      line.setAttribute('d', ld);
      area.setAttribute('d', areaD(ld, z));
      zero.setAttribute('y1', z); zero.setAttribute('y2', z);
      Array.prototype.forEach.call(labels, function(label) {
        var txt = yLabel(Number(label.getAttribute('data-tj-ylabel')), dm);
        if (label.textContent !== txt) label.textContent = txt;
      });
      svg._tjCurve = { W: W, H: H, dom: dm, zeroY: z, ys: cur };
    }
    function step(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / duration);
      if (p < 1) { paint(ease(p)); svg._tjMorphRaf = requestAnimationFrame(step); return; }
      svg._tjMorphRaf = 0;
      line.setAttribute('d', finalFrame.linePath);
      area.setAttribute('d', finalFrame.areaPath);
      zero.setAttribute('y1', toZero); zero.setAttribute('y2', toZero);
      Array.prototype.forEach.call(labels, function(label) { label.textContent = yLabel(Number(label.getAttribute('data-tj-ylabel')), dom); });
      svg._tjCurve = { W: W, H: H, dom: dom, zeroY: toZero, ys: toYs };
      enableHover();
    }
    svg._tjMorphRaf = requestAnimationFrame(step);
  }

  function moveMonthlySelection(delta) {
    if (monthlySelectedMonth === null) return;
    monthlySelectedMonth += delta;
    if (monthlySelectedMonth < 0) { monthlySelectedMonth = 11; monthlyYear--; }
    if (monthlySelectedMonth > 11) { monthlySelectedMonth = 0; monthlyYear++; }
    runPeriodMorph(render);
  }

  function render() {
    if (!currentUser) return;
    document.getElementById('overviewTab').style.display = activeTab === 'overview' ? 'block' : 'none';
    document.getElementById('calendarTab').style.display = activeTab === 'calendar' ? 'block' : 'none';
    document.getElementById('monthlyTab').style.display = activeTab === 'monthly' ? 'block' : 'none';
    document.getElementById('quarterlyTab').style.display = activeTab === 'quarterly' ? 'block' : 'none';
    document.getElementById('yearlyTab').style.display = activeTab === 'yearly' ? 'block' : 'none';
    document.getElementById('galleryTab').style.display = activeTab === 'gallery' ? 'block' : 'none';
    document.getElementById('notesTab').style.display = activeTab === 'notes' ? 'block' : 'none';
    document.getElementById('backtestsTab').style.display = activeTab === 'backtests' ? 'block' : 'none';
    if (activeTab === 'notes') loadDiary();
    if (activeTab === 'overview') renderOverview();
    else if (activeTab === 'calendar') renderCalendar();
    else if (activeTab === 'monthly') renderMonthly();
    else if (activeTab === 'quarterly') renderQuarterly();
    else if (activeTab === 'yearly') renderYearly();
    else if (activeTab === 'gallery') renderGallery();
    else if (activeTab === 'backtests') renderBacktests();
  }

  function renderGallery() {
    var withShots = assetFiltered(trades).filter(function(t) { return !!t.chart; });
    withShots.sort(function(a, b) { return new Date(b.closeDT) - new Date(a.closeDT); });

    var grid = document.getElementById('galleryGrid');
    var empty = document.getElementById('galleryEmptyState');
    if (withShots.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = withShots.map(function(t) {
      var rClass = Number(t.r) > 0 ? 'pos' : (Number(t.r) < 0 ? 'neg' : '');
      return '<div class="gallery-item" data-id="' + escapeAttr(t.id) + '">' +
        '<img' + mobileImageAttributes() + ' src="' + escapeAttr(safeTradeImage(t.chart)) + '" alt="' + tjAssetEsc(t.asset) + '">' + '' +
        '<div class="gallery-item-overlay">' +
          '<div>' +
            '<div class="gallery-item-r ' + rClass + '">' + tjAssetEsc(t.asset) + ' · ' + tjAssetEsc(t.direction) + '</div>' +
            '<div class="gallery-item-date">' + fmtDT(t.closeDT) + '</div>' +
          '</div>' +
          '<div class="trade-model-meta"><span class="card-sub">Модель</span>' + tradeModelHTML(t) + '</div>' +
          '<div class="gallery-item-r ' + rClass + '">' + fmtTradeResult(t) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(grid.querySelectorAll('.gallery-item'), function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('a.trade-model-link')) return;
        var id = el.getAttribute('data-id');
        var trade = trades.filter(function(t) { return t.id === id; })[0];
        if (!trade) return;
        openLightbox(trade);
      });
    });
  }

  function openLightbox(trade) {
    document.getElementById('lightboxImg').src = trade.chart;
    if (window.TJMedia && TJMedia.sharpen) TJMedia.sharpen(document.getElementById('lightboxImg'), trade);
    document.getElementById('lightboxImg')._trade=trade;
    document.getElementById('lightboxImg').onclick=function(){if(window.TJMedia)TJMedia.gallery(trade,0);};
    document.getElementById('lightboxTitle').textContent = trade.asset + ' · ' + trade.direction + (trade.images&&trade.images.length>1?' · '+trade.images.length+' изображений':'');
    document.getElementById('lightboxDate').textContent = fmtDT(trade.openDT) + ' → ' + fmtDT(trade.closeDT);
    document.getElementById('lightboxModel').innerHTML = '<span class="card-sub">Модель</span>' + tradeModelHTML(trade);
    var rEl = document.getElementById('lightboxR');
    rEl.textContent = fmtTradeResult(trade);
    rEl.style.color = tradeResultColor(trade);
    document.getElementById('galleryLightbox').classList.add('open');
  }
  function closeLightbox() { document.getElementById('galleryLightbox').classList.remove('open'); }
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  document.getElementById('galleryLightbox').addEventListener('click', function(e) {
    if (e.target === document.getElementById('galleryLightbox')) closeLightbox();
  });

  // ---- Trade note side panel ----
  var currentNoteTradeId = null;
  var noteSaveTimer = null, pendingNoteSave = null;

  function openNotePanel(trade, anchor) {
    flushNotePanelSave();
    currentNoteTradeId = trade.id;
    document.getElementById('notePanelImg').src = trade.chart;
    if (window.TJMedia && TJMedia.sharpen) TJMedia.sharpen(document.getElementById('notePanelImg'), trade);
    document.getElementById('notePanelImg')._trade=trade;
    document.getElementById('notePanelImg').onclick=function(){if(window.TJMedia)TJMedia.gallery(trade,0);};
    document.getElementById('notePanelTitle').textContent = trade.asset + ' · ' + trade.direction;
    document.getElementById('notePanelModel').innerHTML = '<span class="card-sub">Модель</span>' + tradeModelHTML(trade) + '<span class="mono">' + fmtTradeResult(trade) + '</span>';
    document.getElementById('notePanelText').value = trade.notes || '';
    document.getElementById('notePanelSaved').textContent = '';
    try {var recovered=localStorage.getItem(tjNoteDraftKey(viewingUser,trade.id));if(recovered!==null){
      document.getElementById('notePanelText').value=recovered;pendingNoteSave={id:trade.id,user:viewingUser,text:recovered};
      document.getElementById('notePanelSaved').textContent='Recovered local draft · retrying sync';
      clearTimeout(noteSaveTimer);noteSaveTimer=setTimeout(flushNotePanelSave,400);
    }}catch(_){}
    if (window.TJPanels) TJPanels.anchorNote(anchor);
    document.getElementById('notePanel').classList.add('open');
  }
  function closeNotePanel() {
    flushNotePanelSave();
    document.getElementById('notePanel').classList.remove('open');
    currentNoteTradeId = null;
  }
  document.getElementById('notePanelCloseBtn').addEventListener('click', closeNotePanel);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeNotePanel();
  });
  document.addEventListener('click', function(e) {
    var panel = document.getElementById('notePanel');
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.thumb-btn')) return;
    if (e.target.closest && e.target.closest('.fullscreen-img-overlay')) return;
    closeNotePanel();
  });
  var tjNoteWrites=Object.create(null);
  function tjNoteDraftKey(owner,id){return 'tj_trade_note_draft_v1_'+encodeURIComponent(owner)+'_'+encodeURIComponent(id);}
  function flushNotePanelSave() {
    var pending = pendingNoteSave;
    pendingNoteSave = null;
    clearTimeout(noteSaveTimer); noteSaveTimer = null;
    if (!pending) return;
    var trade = trades.filter(function(t) { return t.id === pending.id; })[0];
    if (!trade || viewingUser !== pending.user) return;
    trade.notes = pending.text;
    var writeKey=tjNoteDraftKey(pending.user,pending.id);
    var record=Object.assign({},trade,{notes:pending.text});
    var write=(tjNoteWrites[writeKey]||Promise.resolve()).catch(function(){}).then(function(){if(viewingUser!==pending.user)return false;return remoteSaveTrade(record,['notes']);});
    tjNoteWrites[writeKey]=write;
    write.then(function(saved) {
      if(saved){try{var k=tjNoteDraftKey(pending.user,pending.id);if(localStorage.getItem(k)===pending.text)localStorage.removeItem(k);}catch(_) {}}
      else if(currentNoteTradeId===pending.id&&viewingUser===pending.user)document.getElementById('notePanelSaved').textContent='Not synced · draft kept on this device';
      if (saved && currentNoteTradeId === pending.id && viewingUser === pending.user && !pendingNoteSave && document.getElementById('notePanelText').value === pending.text) document.getElementById('notePanelSaved').textContent = 'Saved';
    });
  }
  document.getElementById('notePanelText').addEventListener('input', function() {
    if (!currentNoteTradeId) return;
    pendingNoteSave = { id: currentNoteTradeId, user: viewingUser, text: this.value };
    try{localStorage.setItem(tjNoteDraftKey(viewingUser,currentNoteTradeId),this.value);}catch(_){document.getElementById('notePanelSaved').textContent='Local storage unavailable · keep this editor open';return;}
    document.getElementById('notePanelSaved').textContent = 'Draft saved on this device';
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(flushNotePanelSave, 400);
  });

  // ---- Fullscreen image viewer (native resolution) ----
  function openFullscreenImage(src) {
    if(window.TJMedia)return TJMedia.gallery([src],0);
    if (!src) return;
    document.getElementById('fullscreenImg').src = src;
    document.getElementById('fullscreenImgOverlay').classList.add('open');
  }
  function closeFullscreenImage() {
    document.getElementById('fullscreenImgOverlay').classList.remove('open');
  }
  document.getElementById('fullscreenImgCloseBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    closeFullscreenImage();
  });
  document.getElementById('fullscreenImgOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeFullscreenImage();
  });
  document.getElementById('lightboxExpandBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if(window.TJMedia&&document.getElementById('lightboxImg')._trade)TJMedia.gallery(document.getElementById('lightboxImg')._trade);else openFullscreenImage(document.getElementById('lightboxImg').src);
  });
  document.getElementById('notePanelExpandBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if(window.TJMedia&&document.getElementById('notePanelImg')._trade)TJMedia.gallery(document.getElementById('notePanelImg')._trade);else openFullscreenImage(document.getElementById('notePanelImg').src);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeFullscreenImage();
  });

  function setActiveTab(tab) {
    activeTab = tab;
    ['tabOverviewBtn', 'tabCalendarBtn', 'tabMonthlyBtn', 'tabQuarterlyBtn', 'tabYearlyBtn', 'tabGalleryBtn', 'tabNotesBtn', 'tabBacktestsBtn'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
    var map = { overview: 'tabOverviewBtn', calendar: 'tabCalendarBtn', monthly: 'tabMonthlyBtn', quarterly: 'tabQuarterlyBtn', yearly: 'tabYearlyBtn', gallery: 'tabGalleryBtn', notes: 'tabNotesBtn', backtests: 'tabBacktestsBtn' };
    document.getElementById(map[tab]).classList.add('active');
    render();

    var panelMap = { overview: 'overviewTab', calendar: 'calendarTab', monthly: 'monthlyTab', quarterly: 'quarterlyTab', yearly: 'yearlyTab', gallery: 'galleryTab', notes: 'notesTab', backtests: 'backtestsTab' };
    var panel = document.getElementById(panelMap[tab]);
    panel.classList.remove('tab-panel-reveal');
    void panel.offsetWidth; // restart animation
    panel.classList.add('tab-panel-reveal');
  }
  document.getElementById('tabOverviewBtn').addEventListener('click', function() { setActiveTab('overview'); });
  document.getElementById('tabCalendarBtn').addEventListener('click', function() { setActiveTab('calendar'); });
  document.getElementById('tabMonthlyBtn').addEventListener('click', function() { setActiveTab('monthly'); });
  document.getElementById('tabQuarterlyBtn').addEventListener('click', function() { setActiveTab('quarterly'); });
  document.getElementById('tabYearlyBtn').addEventListener('click', function() { setActiveTab('yearly'); });
  document.getElementById('tabGalleryBtn').addEventListener('click', function() { setActiveTab('gallery'); });
  document.getElementById('tabNotesBtn').addEventListener('click', function() { setActiveTab('notes'); });
  document.getElementById('tabBacktestsBtn').addEventListener('click', function() { setActiveTab('backtests'); });
  function enterBacktestWorkspace() {
    if (backtestTransitionTimer) return;
    var overlay = document.getElementById('backtestTransitionOverlay');
    overlay.classList.remove('open');
    void overlay.offsetWidth;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    backtestTransitionTimer = setTimeout(function() {
      if (!backtestWorkspaceMode && activeTab !== 'backtests') previousJournalTab = activeTab;
      backtestWorkspaceMode = true;
      backtestViewTransition = 'list';
      document.body.classList.add('backtest-workspace-mode');
      setActiveTab('backtests');
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      backtestTransitionTimer = null;
    }, 2800);
  }
  function exitBacktestWorkspace() {
    if (backtestTransitionTimer) return;
    var overlay = document.getElementById('backtestTransitionOverlay');
    document.getElementById('backtestTransitionText').textContent = 'Returning to your journal';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    backtestTransitionTimer = setTimeout(function() {
      backtestWorkspaceMode = false;
      activeBacktestId = null;
      document.body.classList.remove('backtest-workspace-mode', 'backtest-detail-mode', 'backtest-input-panel-collapsed');
      setActiveTab(previousJournalTab === 'backtests' ? 'overview' : previousJournalTab);
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.getElementById('backtestTransitionText').textContent = 'Your backtest space is almost ready';
      backtestTransitionTimer = null;
    }, 950);
  }
  document.getElementById('goBacktestBtn').addEventListener('click', enterBacktestWorkspace);
  document.getElementById('exitBacktestWorkspaceBtn').addEventListener('click', exitBacktestWorkspace);

  // Keep fixed dialogs outside the animated and clipped journal root.
  ['assetCustomOverlay', 'assetDeleteOverlay', 'backtestNameOverlay', 'backtestDeleteOverlay', 'backtestExportOverlay', 'backtestInputPanel', 'backtestDrawerOpenTab'].forEach(function(id) {
    var overlay = document.getElementById(id);
    if (overlay && overlay.parentNode !== document.body) document.body.appendChild(overlay);
  });

  // The backtest input panel is a floating drawer (position:fixed) rather than a grid
  // column, so its vertical position is synced to where the builder actually starts —
  // it isn't tied to the statistics block's width or layout at all.
  function syncBacktestPanelPosition() {
    var builder = document.querySelector('.backtest-builder');
    var panel = document.getElementById('backtestInputPanel');
    var tab = document.getElementById('backtestDrawerOpenTab');
    if (!builder || !panel) return;
    var top = Math.max(16, builder.getBoundingClientRect().top);
    panel.style.top = top + 'px';
    panel.style.maxHeight = 'calc(100vh - ' + (top + 20) + 'px)';
    if (tab) tab.style.top = top + 'px';
  }
  window.addEventListener('resize', syncBacktestPanelPosition);
  document.getElementById('backtestDrawerToggle').addEventListener('click', function() {
    document.body.classList.add('backtest-input-panel-collapsed');
    this.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('backtestDrawerOpenTab').addEventListener('click', function() {
    document.body.classList.remove('backtest-input-panel-collapsed');
    var toggleBtn = document.getElementById('backtestDrawerToggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    syncBacktestPanelPosition();
  });

  document.getElementById('backtestsList').addEventListener('click', function(e) {
    var renameButton = e.target.closest('.rename-backtest');
    if (renameButton) { e.stopPropagation(); openBacktestNameModal(renameButton.getAttribute('data-id')); return; }
    var deleteButton = e.target.closest('.remove-backtest');
    if (deleteButton) { e.stopPropagation(); openBacktestDeleteModal(deleteButton.getAttribute('data-id')); return; }
    var item = e.target.closest('.backtest-item');
    if (!item || !this.contains(item)) return;
    activeBacktestId = item.getAttribute('data-id');
    backtestViewTransition = 'detail';
    document.body.classList.remove('backtest-input-panel-collapsed');
    document.body.classList.add('backtest-detail-mode');
    loadBacktestTrades(backtests.filter(function(b) { return b.id === activeBacktestId; })[0]).then(renderBacktests);
    requestAnimationFrame(syncBacktestPanelPosition);
  });

  document.getElementById('backtestRRInput').addEventListener('input', updateActiveBacktestFromInputs);
  document.getElementById('backtestDaysTested').addEventListener('input', updateActiveBacktestFromInputs);
  document.getElementById('backtestRRInput').addEventListener('blur', commitBacktestRRDraft);
  document.getElementById('backtestDaysTested').addEventListener('blur', commitBacktestRRDraft);
  function setBacktestCleanOnly(flag) {
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    if (!bt || !!bt.cleanOnly === flag) return;
    bt.cleanOnly = flag; saveBacktestLocal(); renderBacktests();
    tjBacktestWrite('backtests',bt.id,{ cleanOnly: flag }, { merge: true }).catch(function(err) { console.error('backtest filter save failed:', err); });
  }
  document.getElementById('backtestFilterAll').addEventListener('click', function() { setBacktestCleanOnly(false); });
  document.getElementById('backtestFilterClean').addEventListener('click', function() { setBacktestCleanOnly(true); });
  document.getElementById('backtestClearBtn').addEventListener('click', function() {
    document.getElementById('backtestRRInput').value = '';
    document.getElementById('backtestDaysTested').value = '';
    updateActiveBacktestFromInputs();
  });

  document.getElementById('addBacktestBtn').addEventListener('click', function() {
    backtestCreationStep = 'start'; backtestDraftStart = null;
    var input = document.getElementById('backtestDateInput'); input.value = '';
    openDateTimePicker(input);
  });
  document.getElementById('backtestsBackBtn').addEventListener('click', function() {
    activeBacktestId = null;
    backtestViewTransition = 'list';
    document.body.classList.remove('backtest-detail-mode');
    renderBacktests();
  });
  document.getElementById('renameActiveBacktestBtn').addEventListener('click', function() { if (activeBacktestId) openBacktestNameModal(activeBacktestId); });
  document.getElementById('deleteActiveBacktestBtn').addEventListener('click', function() { if (activeBacktestId) openBacktestDeleteModal(activeBacktestId); });
  document.getElementById('backtestExportBtn').addEventListener('click', function() {
    var card = document.getElementById('backtestPreviewCard');
    if (!card) return;
    if (typeof html2canvas === 'undefined') {
      // v3.41: the screenshot library is loaded only when an export is requested.
      var exportBtn = this;
      if (exportBtn.dataset.tjLoading === '1') return;
      exportBtn.dataset.tjLoading = '1';
      // v3.43.1: own copy on our hosting first (vendor/html2canvas.min.js), public CDN only as a fallback.
      var TJ_HTML2CANVAS_SRI = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';
      var sources = ['vendor/html2canvas.min.js?v=1.4.1', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'];
      var tryLoad = function(i) {
        if (i >= sources.length) { exportBtn.dataset.tjLoading = ''; showBacktestSyncError('Could not load the export tool. Check your internet connection.'); return; }
        var sc = document.createElement('script');
        sc.src = sources[i];
        sc.async = true;
        // PR2: the CDN copy must match the vendored file byte for byte (Subresource Integrity).
        if (i > 0) { sc.crossOrigin = 'anonymous'; sc.integrity = TJ_HTML2CANVAS_SRI; }
        sc.onload = function() {
          if (typeof html2canvas !== 'undefined') { exportBtn.dataset.tjLoading = ''; exportBtn.click(); }
          else tryLoad(i + 1);
        };
        sc.onerror = function() { tryLoad(i + 1); };
        document.head.appendChild(sc);
      };
      tryLoad(0);
      return;
    }
    var btn = this, labelEl = btn.querySelector('.backtest-export-btn-label'), oldLabel = labelEl ? labelEl.textContent : btn.textContent;
    btn.disabled = true; btn.classList.add('exporting'); if (labelEl) labelEl.textContent = 'Exporting…'; else btn.textContent = 'Exporting…';
    // The equity curve draws itself with a one-shot CSS animation (stroke-dashoffset 1 -> 0).
    // html2canvas clones the SVG into an offscreen document to rasterize it, which restarts
    // that animation from scratch — the snapshot then gets taken mid-draw, cutting the line
    // off partway. Freeze the path(s) at their finished state before capturing, then restore.
    var chartPaths = card.querySelectorAll('#backtestChart path');
    var frozen = [];
    chartPaths.forEach(function(p) {
      frozen.push({ el: p, animation: p.style.animation, dashoffset: p.style.strokeDashoffset, dasharray: p.style.strokeDasharray });
      p.style.animation = 'none';
      p.style.strokeDashoffset = '0';
      // Belt-and-braces: drop the dash pattern entirely rather than trusting dashoffset:0
      // to fully reveal it — html2canvas's SVG rasterization pipeline doesn't reliably
      // honour the pathLength-normalized dasharray, so "0 offset" can still render short.
      p.style.strokeDasharray = 'none';
    });
    // Force a synchronous style flush so the overrides are committed before html2canvas
    // reads/clones the DOM (style writes can otherwise be deferred to the next frame).
    void card.offsetHeight;
    function unfreeze() { frozen.forEach(function(f) { f.el.style.animation = f.animation; f.el.style.strokeDashoffset = f.dashoffset; f.el.style.strokeDasharray = f.dasharray; }); }
    html2canvas(card, {
      backgroundColor: '#050608', scale: 2, useCORS: true,
      ignoreElements: function(el) { return el.id === 'backtestExportBtn'; }
    }).then(function(canvas) {
      lastBacktestExportCanvas = canvas;
      document.getElementById('backtestExportPreviewImg').src = canvas.toDataURL('image/png');
      document.getElementById('backtestExportOverlay').classList.add('open');
    }).catch(function(err) {
      console.error('Export failed', err);
      tjNotice('export', 'error', 'Не удалось подготовить картинку для экспорта' + tjErrorReason(err) + '. Попробуйте ещё раз.', [], 12000);
    }).finally(function() {
      unfreeze();
      btn.disabled = false; btn.classList.remove('exporting'); if (labelEl) labelEl.textContent = oldLabel; else btn.textContent = oldLabel;
    });
  });
  var lastBacktestExportCanvas = null;
  // Keeps letters of any alphabet (Cyrillic names used to become "____"); only
  // characters that file systems reject are replaced.
  function tjExportFileName(name) {
    var clean = String(name || '').normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[^\p{L}\p{N}\-_. ]+/gu, ' ')
      .trim().replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '')
      .slice(0, 80);
    return clean || 'backtest';
  }
  function closeBacktestExportModal() { document.getElementById('backtestExportOverlay').classList.remove('open'); }
  document.getElementById('backtestExportCloseBtn').addEventListener('click', closeBacktestExportModal);
  document.getElementById('backtestExportCancelBtn').addEventListener('click', closeBacktestExportModal);
  document.getElementById('backtestExportOverlay').addEventListener('click', function(e) { if (e.target === this) closeBacktestExportModal(); });
  document.getElementById('backtestExportDownloadBtn').addEventListener('click', function() {
    if (!lastBacktestExportCanvas) return;
    var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
    var link = document.createElement('a');
    link.download = tjExportFileName(bt && bt.name) + '-stats.png';
    link.href = lastBacktestExportCanvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    closeBacktestExportModal();
  });
  document.getElementById('backtestCurveColour').addEventListener('click', function(e) {
    var trigger = e.target.closest ? e.target.closest('#backtestCurveTrigger') : null;
    if (trigger) { e.stopPropagation(); var open = this.classList.toggle('open'); trigger.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { updateBacktestCurveColourUI(); var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0]; syncBacktestKnobToColor(bt && (bt.pendingCurveColor || bt.curveColor) || curveColor); } return; }
    var button = e.target.closest ? e.target.closest('[data-bt-colour]') : null;
    if (button) setBacktestCurveColour(button.getAttribute('data-bt-colour'));
    var custom = e.target.closest ? e.target.closest('#backtestCustomBtn') : null;
    if (custom) {
      e.stopPropagation();
      var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
      var customColor = bt && /^#[0-9a-f]{6}$/i.test(String(bt.customCurveColor || bt.pendingCurveColor || bt.curveColor || '')) && String(bt.customCurveColor || bt.pendingCurveColor || bt.curveColor).toLowerCase() !== '#34d399' && String(bt.customCurveColor || bt.pendingCurveColor || bt.curveColor).toLowerCase() !== '#8fa3b8' ? String(bt.customCurveColor || bt.pendingCurveColor || bt.curveColor).toLowerCase() : null;
      if (customColor) {
        bt.pendingCurveColor = customColor;
        updateBacktestCurveColourUI();
        syncBacktestKnobToColor(customColor);
        renderBacktestChart(backtestTrades);
      }
    }
  });
  document.getElementById('backtestColorSaveBtn').addEventListener('click', function(e) { e.stopPropagation(); var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0]; if (bt) setBacktestCurveColour(bt.pendingCurveColor || bt.curveColor || curveColor, true); document.getElementById('backtestCurveColour').classList.remove('open'); });
  (function() { var c=document.getElementById('backtestColorWheel'),k=document.getElementById('backtestColorKnob'); if(!c)return; var x=c.getContext('2d'), n=c.width, im=x.createImageData(n,n); for(var y=0;y<n;y++)for(var z=0;z<n;z++){var dx=z-n/2,dy=y-n/2,d=Math.sqrt(dx*dx+dy*dy),i=(y*n+z)*4;if(d>n/2-2){im.data[i+3]=0;continue}var rgb=hslToRgb((Math.atan2(dy,dx)*180/Math.PI+360)%360/360,Math.min(1,d/(n/2-2)),.5);im.data[i]=rgb[0];im.data[i+1]=rgb[1];im.data[i+2]=rgb[2];im.data[i+3]=255;}x.putImageData(im,0,0); var pick=function(e){var r=c.getBoundingClientRect(),cx=r.width/2,cy=r.height/2,pxPos=e.clientX-r.left,pyPos=e.clientY-r.top,dx=pxPos-cx,dy=pyPos-cy,dist=Math.sqrt(dx*dx+dy*dy),maxDist=Math.max(1,r.width/2-9);if(dist>maxDist){dx*=maxDist/dist;dy*=maxDist/dist;pxPos=cx+dx;pyPos=cy+dy;}var px=Math.max(0,Math.min(n-1,Math.round(pxPos/r.width*n))),py=Math.max(0,Math.min(n-1,Math.round(pyPos/r.height*n))),d=x.getImageData(px,py,1,1).data,col=rgbToHex(d[0],d[1],d[2]),bt=backtests.filter(function(b){return b.id===activeBacktestId;})[0];if(!bt)return;bt.pendingCurveColor=col;updateBacktestCurveColourUI();renderBacktestChart(backtestTrades);k.style.left=pxPos+'px';k.style.top=pyPos+'px';}; c.addEventListener('pointerdown',function(e){c.setPointerCapture(e.pointerId);pick(e);}); c.addEventListener('pointermove',function(e){if(c.hasPointerCapture(e.pointerId))pick(e);}); })();
  document.addEventListener('click', function(e) { var wrap=document.getElementById('backtestCurveColour'); if(wrap && !wrap.contains(e.target)){wrap.classList.remove('open'); document.getElementById('backtestCurveTrigger').setAttribute('aria-expanded','false');} });
  document.getElementById('backtestNameCloseBtn').addEventListener('click', closeBacktestNameModal);
  document.getElementById('backtestNameCancelBtn').addEventListener('click', closeBacktestNameModal);
  document.getElementById('backtestNameSaveBtn').addEventListener('click', saveBacktestName);
  document.getElementById('backtestNameInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); saveBacktestName(); } });
  document.getElementById('backtestNameOverlay').addEventListener('click', function(e) { if (e.target === this) closeBacktestNameModal(); });
  document.getElementById('backtestDeleteCancelBtn').addEventListener('click', closeBacktestDeleteModal);
  document.getElementById('backtestDeleteOverlay').addEventListener('click', function(e) { if (e.target === this) closeBacktestDeleteModal(); });
  document.getElementById('backtestDeleteConfirmBtn').addEventListener('click', function() {
    if (!pendingBacktestDeletion) return;
    var id = pendingBacktestDeletion;
    var confirmButton = this;
    confirmButton.disabled = true;
    closeBacktestDeleteModal();
    deleteBacktest(id).then(function() { confirmButton.disabled = false; }, function(err) { console.error(err); confirmButton.disabled = false; });
  });
  function setAssetFilter(value, shouldRender) {
    assetFilter = value;
    currentTradesPage = 1;
    document.getElementById('assetFilterSelect').value = value;
    var option = document.querySelector('.asset-filter-option[data-value="' + value + '"]');
    if (option) document.getElementById('assetFilterValue').textContent = option.getAttribute('data-label') || (value === 'ALL' ? 'All Assets' : value);
    Array.prototype.forEach.call(document.querySelectorAll('.asset-filter-option'), function(el) {
      el.classList.toggle('active', el.getAttribute('data-value') === value);
    });
    if (shouldRender) render();
  }

  function closeAssetFilterMenu() {
    document.getElementById('assetFilterControl').classList.remove('open');
    document.getElementById('assetFilterTrigger').setAttribute('aria-expanded', 'false');
    syncAssetFilterScrollbar();
  }

  document.getElementById('assetFilterSelect').addEventListener('change', function(e) { setAssetFilter(e.target.value, true); });
  document.getElementById('tradeAssetTrigger').addEventListener('click', function(e) {
    e.preventDefault();
    var control = document.getElementById('tradeAssetControl'), isOpen = control.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) updateTradeAssetUI();
  });
  document.getElementById('tradeAssetMenu').addEventListener('click', function(e) {
    var option = e.target.closest ? e.target.closest('.trade-asset-option') : null;
    if (!option) return;
    e.preventDefault();
    setTradeAsset(option.getAttribute('data-value'));
    closeTradeAssetMenu();
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest || !e.target.closest('#tradeAssetControl')) closeTradeAssetMenu();
  });
  document.getElementById('assetFilterTrigger').addEventListener('click', function() {
    var control = document.getElementById('assetFilterControl');
    var isOpen = control.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
    var bar = document.getElementById('assetFilterScrollbar');
    if (!isOpen && bar) bar.classList.remove('is-visible');
    if (isOpen) {
      [180, 360, 520].forEach(function(delay) { setTimeout(syncAssetFilterScrollbar, delay); });
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.asset-filter-option'), function(option) {
    option.addEventListener('click', function() {
      setAssetFilter(this.getAttribute('data-value'), true);
    });
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest || !e.target.closest('#assetFilterControl')) closeAssetFilterMenu();
  });

  function showAssetCustomError(message, notice) {
    var el = document.getElementById('assetCustomError');
    el.textContent = message || '';
    el.classList.toggle('show', !!message);
    el.classList.toggle('notice', !!notice);
  }
  var curveColor = '#34d399'; // green by default; '#8fa3b8' = grey
  var pendingCurveColor = curveColor;
  var savedCustomCurveColor = null;
  var curveColorSaveTimer = null;
  var lastChartData = null;
  var selectedAssetColor = '#34d399';
  function drawAssetColorWheel() {
    var canvas = document.getElementById('assetColorWheel');
    var ctx = canvas.getContext('2d');
    var image = ctx.createImageData(canvas.width, canvas.height);
    var center = canvas.width / 2, radius = center - 3;
    for (var y = 0; y < canvas.height; y++) for (var x = 0; x < canvas.width; x++) {
      var dx = x - center, dy = y - center, dist = Math.sqrt(dx * dx + dy * dy), idx = (y * canvas.width + x) * 4;
      if (dist > radius) { image.data[idx + 3] = 0; continue; }
      var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      var rgb = hslToRgb(hue / 360, Math.min(1, dist / radius), .5);
      image.data[idx] = rgb[0]; image.data[idx + 1] = rgb[1]; image.data[idx + 2] = rgb[2]; image.data[idx + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) r = g = b = l;
    else {
      var hue2rgb = function(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q-p)*6*t; if (t < 1/2) return q; if (t < 2/3) return p + (q-p)*(2/3-t)*6; return p; };
      var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
    }
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
  }
  function rgbToHex(r, g, b) { return '#' + [r,g,b].map(function(v) { return v.toString(16).padStart(2,'0'); }).join(''); }
  function setAssetColorFromPoint(clientX, clientY) {
    var canvas = document.getElementById('assetColorWheel'), rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left, y = clientY - rect.top, cx = rect.width/2, cy = rect.height/2;
    var dx = x-cx, dy = y-cy, dist = Math.sqrt(dx*dx+dy*dy), radius = rect.width/2-2;
    if (dist > radius) { dx *= radius/dist; dy *= radius/dist; x = cx+dx; y = cy+dy; }
    var pixelX = Math.max(0, Math.min(canvas.width-1, Math.round(x/rect.width*canvas.width)));
    var pixelY = Math.max(0, Math.min(canvas.height-1, Math.round(y/rect.height*canvas.height)));
    var data = canvas.getContext('2d').getImageData(pixelX,pixelY,1,1).data;
    selectedAssetColor = rgbToHex(data[0],data[1],data[2]);
    var knob = document.getElementById('assetColorKnob'); knob.style.left = x+'px'; knob.style.top = y+'px'; knob.style.background = selectedAssetColor;
    document.getElementById('assetColorPreviewDot').style.background = selectedAssetColor;
    document.getElementById('assetColorHex').textContent = selectedAssetColor.toUpperCase();
    var occupied = assetDefinitions.filter(function(a) { return a.color.toLowerCase() === selectedAssetColor; })[0];
    showAssetCustomError(occupied ? 'This color is already assigned to ' + occupied.name + '.' : '', !!occupied);
  }
  function resetAssetColorWheel() {
    selectedAssetColor = '#34d399';
    var canvas = document.getElementById('assetColorWheel');
    var rect = canvas.getBoundingClientRect(), angle = 2.48, radius = rect.width*.31;
    setAssetColorFromPoint(rect.left + rect.width/2 + Math.cos(angle)*radius, rect.top + rect.height/2 + Math.sin(angle)*radius);
  }
  function openAssetCustomModal() {
    closeAssetFilterMenu();
    var input = document.getElementById('assetCustomName');
    input.value = '';
    showAssetCustomError('');
    document.getElementById('assetCustomOverlay').classList.add('open');
    document.body.classList.add('asset-custom-lock');
    requestAnimationFrame(resetAssetColorWheel);
    setTimeout(function() { input.focus(); }, 220);
  }
  var editingAssetName = null;
  function openAssetEditModal(name) {
    var asset = getAssetDefinition(name); if (!asset) return;
    editingAssetName = name;
    document.getElementById('assetCustomTitle').textContent = 'Edit asset';
    document.getElementById('assetCustomName').value = name;
    document.getElementById('assetCustomSaveBtn').textContent = 'Save changes';
    selectedAssetColor = asset.color;
    document.getElementById('assetCustomOverlay').classList.add('open');
    document.body.classList.add('asset-custom-lock');
    requestAnimationFrame(function() {
      var canvas = document.getElementById('assetColorWheel'), rect = canvas.getBoundingClientRect();
      resetAssetColorWheel();
      selectedAssetColor = asset.color;
      document.getElementById('assetColorPreviewDot').style.background = asset.color;
      document.getElementById('assetColorHex').textContent = asset.color.toUpperCase();
    });
    setTimeout(function() { document.getElementById('assetCustomName').focus(); }, 220);
  }
  function closeAssetCustomModal() { editingAssetName = null; document.getElementById('assetCustomTitle').textContent = 'Add asset'; document.getElementById('assetCustomSaveBtn').textContent = 'Add asset'; document.getElementById('assetCustomOverlay').classList.remove('open'); document.body.classList.remove('asset-custom-lock'); }
  var pendingAssetDeletion = null;
  function openAssetDeleteModal(name) {
    pendingAssetDeletion = name;
    document.getElementById('assetDeleteName').textContent = name;
    document.getElementById('assetDeleteAcknowledge').checked = false;
    document.getElementById('assetDeleteConfirmBtn').classList.remove('ready');
    document.getElementById('assetDeleteOverlay').classList.add('open');
    document.body.classList.add('asset-delete-lock');
    requestAnimationFrame(function() { document.getElementById('assetDeleteAcknowledge').focus(); });
  }
  function closeAssetDeleteModal() { pendingAssetDeletion = null; document.getElementById('assetDeleteOverlay').classList.remove('open'); document.body.classList.remove('asset-delete-lock'); }
  // One bounded atomic operation: settings, existing journal trades and images all commit or none do.
  // Backtest/Replay instruments are independent market identities and are intentionally not renamed.
  async function tjChangeAssetSettings(user, uid, change, fromName, toName) {
    // A server-enforced per-journal fence closes the query/commit gap. Older
    // clients are fenced by rules too; offline writes cannot resurrect a retired name.
    var root=db.collection('titles').doc(user),guard=db.collection('journalAssetGuards').doc(uid);
    var operation=null;
    try {
      var start=await db.runTransaction(async function(tx){
        var docs=await Promise.all([tx.get(root),tx.get(guard)]),data=docs[0].exists?docs[0].data():{},g=docs[1].exists?docs[1].data():{};
        if(g.locked){
          if(!fromName||!g.operation||g.operation.from!==fromName||g.operation.to!==toName)throw Error('Unfinished asset operation: '+(g.operation?g.operation.from+' → '+(g.operation.to||'DELETE'):'unknown')+'. Retry that rename/delete first. No data changed.');
          return {operation:g.operation}; // explicit retry also resumes after a process crash
        }
        var retired=Array.isArray(g.retired)?g.retired.slice():[];
        var deleted=Array.isArray(data.deletedAssets)?data.deletedAssets.slice():[];
        var settings={assets:normalizeAssetDefinitions(data.assets,deleted),deletedAssets:deleted};change(settings);
        // Saving a retired name again is the owner's explicit decision: revive it in
        // the same transaction (an explicit, counted revival the rules accept). Stale
        // offline writes still cannot use a name that is retired at commit time.
        var revive=settings.assets.map(function(a){return a.name;}).filter(function(name,i,all){return retired.indexOf(name)>=0&&all.indexOf(name)===i;});
        if(!fromName){
          tx.set(root,{assets:settings.assets,deletedAssets:settings.deletedAssets,uid:uid,assetRevision:(Number(data.assetRevision)||0)+1},{merge:true});
          if(revive.length)tx.set(guard,{uid:uid,locked:false,retired:retired.filter(function(name){return revive.indexOf(name)<0;}),revivals:(Number(g.revivals)||0)+1},{merge:true});
          return {settings:settings};
        }
        if(retired.indexOf(fromName)>=0)throw Error('This asset was already migrated. Reload the journal.');
        if(retired.length>=500)throw Error('Asset migration history is full. Export and contact support; no data changed.');
        var op={id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),from:fromName,to:toName,settings:settings,revive:revive};
        tx.set(guard,{uid:uid,locked:true,retired:retired,operation:op},{merge:true});return {operation:op};
      });
      if(!start.operation)return start.settings;
      operation=start.operation;
      // This strong server read starts AFTER the acknowledged fence. No journal
      // trade/image mutations can commit until finalization/cancellation.
      var snapshot=await db.collection('trades').where('uid','==',uid).get({source:'server'}),refs=[];
      snapshot.forEach(function(d){if(d.data().asset===operation.from)refs.push(db.collection('trades').doc(d.id));});
      if(refs.length>450)throw Error('Too many journal trades for one safe atomic asset change. No journal data changed.');
      return await db.runTransaction(async function(tx){
        var docs=await Promise.all([tx.get(guard),tx.get(root)].concat(refs.map(function(ref){return tx.get(ref);}))),g=docs[0].exists?docs[0].data():{};
        if(!g.locked||!g.operation||g.operation.id!==operation.id){
          if(g.lastOperation===operation.id)return operation.settings; // lost acknowledgement / concurrent retry
          throw Error('Asset operation was cancelled or superseded. Reload and retry.');
        }
        var writes=[];
        refs.forEach(function(ref,i){var doc=docs[i+2],trade=doc.exists?doc.data():null;
          if(!trade||trade.uid!==uid||trade.asset!==operation.from)throw Error('Journal changed outside the asset fence. No migration was committed.');
          if(operation.to==null){(trade.images||[]).forEach(function(image){writes.push({ref:db.collection('tradeImages').doc(image.id),remove:true});});writes.push({ref:ref,remove:true});}
          else writes.push({ref:ref,data:{asset:operation.to}});
        });
        if(writes.length+2>490)throw Error('Too many trades/images for one safe atomic change. No journal data changed.');
        writes.forEach(function(w){if(w.remove)tx.delete(w.ref);else tx.update(w.ref,w.data);});
        tx.set(root,{assets:operation.settings.assets,deletedAssets:operation.settings.deletedAssets,uid:uid,assetRevision:(docs[1].exists?Number(docs[1].data().assetRevision)||0:0)+1},{merge:true});
        var before=(g.retired||[]).slice(),revive=Array.isArray(operation.revive)?operation.revive:[];
        var retired=before.filter(function(name){return revive.indexOf(name)<0;});if(retired.indexOf(operation.from)<0)retired.push(operation.from);
        var guardData={uid:uid,locked:false,retired:retired,operation:null,lastOperation:operation.id};
        if(before.some(function(name){return retired.indexOf(name)<0;}))guardData.revivals=(Number(g.revivals)||0)+1;
        tx.set(guard,guardData,{merge:true});
        return operation.settings;
      });
    } catch(error){
      // If the final acknowledgement was lost, never undo its retirement. If it
      // failed, cancellation is itself conditional/atomic and changes no trades.
      if(operation){try{await db.runTransaction(async function(tx){var doc=await tx.get(guard),g=doc.exists?doc.data():{};if(g.locked&&g.operation&&g.operation.id===operation.id)tx.set(guard,{locked:false,operation:null},{merge:true});});}catch(cancelError){error.message+=' Recovery fence remains: reconnect and retry the same operation.';}}
      throw error;
    }
  }
  function deleteAssetData(name) {
    var user=viewingUser,generation=tjDataGeneration,owner=findUser(user),uid=owner&&owner.uid;
    if(!uid)return Promise.reject(Error('Could not find the asset owner.'));
    return tjChangeAssetSettings(user,uid,function(settings){
      settings.assets=settings.assets.filter(function(a){return a.name!==name;});
      if(DEFAULT_ASSETS.some(function(a){return a.name===name;})&&settings.deletedAssets.indexOf(name)<0)settings.deletedAssets.push(name);
    },name,null).then(function(settings){
      if(viewingUser!==user||generation!==tjDataGeneration)return;
      assetDefinitions=settings.assets;deletedAssets=settings.deletedAssets;trades=trades.filter(function(t){return t.asset!==name;});invalidateTradeNumbers();
      if(assetFilter===name)assetFilter='ALL';renderAssetControls();render();
    });
  }

  document.getElementById('assetDeleteAcknowledge').addEventListener('change', function() { document.getElementById('assetDeleteConfirmBtn').classList.toggle('ready', this.checked); });
  document.getElementById('assetDeleteConfirmBtn').addEventListener('click', function() { if (!pendingAssetDeletion || !this.classList.contains('ready')) return; var name = pendingAssetDeletion; this.disabled = true; deleteAssetData(name).then(closeAssetDeleteModal).catch(function(err) { console.error(err); window.alert('Asset not deleted: '+(err.message||'Check your connection and retry.')); }).then(function() { document.getElementById('assetDeleteConfirmBtn').disabled = false; }); });
  document.getElementById('assetDeleteCancelBtn').addEventListener('click', closeAssetDeleteModal);
  document.getElementById('assetDeleteOverlay').addEventListener('click', function(e) { e.stopPropagation(); });
  document.addEventListener('keydown', function(e) { if (pendingAssetDeletion && (e.key === 'Escape' || e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End')) e.preventDefault(); });
  document.addEventListener('wheel', function(e) { if (pendingAssetDeletion) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function(e) { if (pendingAssetDeletion) e.preventDefault(); }, { passive: false });
  function saveCustomAsset() {
    var input = document.getElementById('assetCustomName');
    var name = input.value.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 16);
    var color = selectedAssetColor.toLowerCase();
    input.value = name;
    if (!name) { showAssetCustomError('Enter an asset name using capital letters and numbers.'); return; }
    var user = viewingUser, generation = tjDataGeneration, oldName = editingAssetName, owner = findUser(user);
    if (!owner || !owner.uid) { showAssetCustomError('Could not find the asset owner.'); return; }
    return tjChangeAssetSettings(user, owner.uid, function(settings) {
      var current = oldName ? settings.assets.filter(function(a) { return a.name === oldName; })[0] : null;
      if (oldName && !current) throw new Error('This asset was changed on another device. Reopen the editor.');
      var duplicate = settings.assets.filter(function(a) { return a.name === name && a.name !== oldName; })[0];
      if (duplicate) throw new Error('Asset ' + name + ' already exists.');
      var occupied = settings.assets.filter(function(a) { return a.name !== oldName && a.color.toLowerCase() === color; })[0];
      if (occupied) throw new Error('This color is already assigned to ' + occupied.name + '.');
      if (current) {
        current.name = name; current.color = color;
        if (oldName !== name && DEFAULT_ASSETS.some(function(a) { return a.name === oldName; }) && settings.deletedAssets.indexOf(oldName) < 0) settings.deletedAssets.push(oldName);
      } else settings.assets.push({ name: name, color: color });
      settings.deletedAssets = settings.deletedAssets.filter(function(a) { return a !== name; });
    },oldName&&oldName!==name?oldName:null,name).then(function(settings) {
      if (viewingUser !== user || generation !== tjDataGeneration) return;
      assetDefinitions = settings.assets; deletedAssets = settings.deletedAssets;
      if (oldName) {
        trades.forEach(function(t) { if (t.asset === oldName) t.asset = name; });
        invalidateTradeNumbers();
        if (assetFilter === oldName) assetFilter = name;
      }
      renderAssetControls(); render(); closeAssetCustomModal();
    }).catch(function(err) {
      console.error(err);
      if (viewingUser !== user || generation !== tjDataGeneration) return;
      showAssetCustomError(err.message || 'Could not save the asset. Check your connection.');
    });
  }

  document.getElementById('assetCustomCloseBtn').addEventListener('click', closeAssetCustomModal);
  document.getElementById('assetCustomCancelBtn').addEventListener('click', closeAssetCustomModal);
  document.getElementById('assetCustomSaveBtn').addEventListener('click', saveCustomAsset);
  document.getElementById('assetCustomName').addEventListener('input', function() {
    var start = this.selectionStart;
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 16);
    try { this.setSelectionRange(start, start); } catch (e) {}
    showAssetCustomError('');
  });
  document.getElementById('assetCustomName').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveCustomAsset(); }
  });
  drawAssetColorWheel();
  (function() {
    var canvas = document.getElementById('assetColorWheel'), wrap = document.getElementById('assetColorWheelWrap'), picking = false;
    canvas.addEventListener('pointerdown', function(e) { picking = true; wrap.classList.add('is-picking'); canvas.setPointerCapture(e.pointerId); setAssetColorFromPoint(e.clientX,e.clientY); });
    canvas.addEventListener('pointermove', function(e) { if (picking) setAssetColorFromPoint(e.clientX,e.clientY); });
    canvas.addEventListener('pointerup', function(e) { picking = false; wrap.classList.remove('is-picking'); try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} });
    canvas.addEventListener('pointercancel', function() { picking = false; wrap.classList.remove('is-picking'); });
  })();
  document.getElementById('assetCustomOverlay').addEventListener('click', function(e) { e.stopPropagation(); });
  document.addEventListener('keydown', function(e) {
    if (document.getElementById('assetCustomOverlay').classList.contains('open') && e.key === 'Escape') e.preventDefault();
  });
  document.addEventListener('wheel', function(e) { if (document.getElementById('assetCustomOverlay').classList.contains('open')) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function(e) { if (document.getElementById('assetCustomOverlay').classList.contains('open')) e.preventDefault(); }, { passive: false });

  document.getElementById('filterToggleBtn').addEventListener('click', function() {
    var panel = document.getElementById('assetFilterPanel');
    var collapsed = panel.classList.toggle('is-collapsed');
    this.classList.toggle('is-collapsed', collapsed);
    this.setAttribute('aria-expanded', String(!collapsed));
    this.title = collapsed ? 'Show filters' : 'Hide filters';
  });

  document.getElementById('prevYearBtn').addEventListener('click', function() { monthlyYear--; render(); });
  document.getElementById('nextYearBtn').addEventListener('click', function() { monthlyYear++; render(); });
  document.getElementById('backToMonths').addEventListener('click', function() { monthlySelectedMonth = null; render(); });
  document.getElementById('monthDetailPrev').addEventListener('click', function() { moveMonthlySelection(-1); });
  document.getElementById('monthDetailNext').addEventListener('click', function() { moveMonthlySelection(1); });

  document.getElementById('prevWeeklyYearBtn').addEventListener('click', function() { weeklyYear--; weeklySelected = null; render(); });
  document.getElementById('nextWeeklyYearBtn').addEventListener('click', function() { weeklyYear++; weeklySelected = null; render(); });
  document.getElementById('backToWeeks').addEventListener('click', function() { weeklySelected = null; render(); });

  function openModal(prefillMonth) {
    if(document.getElementById('tradeForm').dataset.saving==='1')return;
    clearTradeFormError();
    delete document.getElementById('tradeForm').dataset.pendingId;
    selectedTradeModelId = '';
    selectedTradeModelName = '';
    closeTradeModelMenu();
    renderTradeModelControl();
    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('tradeModalTitle').textContent = 'Add Trade';
    document.getElementById('tradeModalSubmitBtn').textContent = 'Add Trade';
    document.getElementById('tradeScreenshotField').style.display = 'block';
    document.getElementById('tradeModalSubmitBtn').disabled=false;
    if(window.TJMedia) TJMedia.reset();
    document.getElementById('riskPercentInput').value = '1';
    closeTradeAssetMenu();
    updateTradeAssetUI();
    currentScreenshot = null;
    document.getElementById('screenshotInput').value = '';
    document.getElementById('screenshotFileName').textContent = 'No file chosen';
    document.getElementById('screenshotPreview').src = '';
    document.getElementById('screenshotPreviewWrap').style.display = 'none';
    var activeRange = backtestTradeMode ? backtests.filter(function(bt) { return bt.id === activeBacktestId; })[0] : null;
    if (activeRange) {
      setDateTimeInput(document.getElementById('openInput'), activeRange.startDate);
      setDateTimeInput(document.getElementById('closeInput'), activeRange.startDate);
    } else if (prefillMonth !== undefined && prefillMonth !== null) {
      var y = monthlyYear, m = pad2(prefillMonth + 1);
      setDateTimeInput(document.getElementById('openInput'), y + '-' + m + '-01T09:00');
      setDateTimeInput(document.getElementById('closeInput'), y + '-' + m + '-01T10:00');
    } else {
      var now = new Date();
      var val = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      setDateTimeInput(document.getElementById('openInput'), val);
      setDateTimeInput(document.getElementById('closeInput'), val);
    }
  }
  function closeModal() {
    if(document.getElementById('tradeForm').dataset.saving==='1')return;
    closeModelDeletePanel();
    closeModelCreatePanel();
    closeTradeModelMenu();
    clearTradeFormError();
    document.getElementById('modalOverlay').classList.remove('open');
    if(window.TJMedia)TJMedia.reset();
    backtestTradeMode = false;
    editingBacktestTradeId = null;
    document.getElementById('tradeModalTitle').textContent = 'Add Trade';
    document.getElementById('tradeModalSubmitBtn').textContent = 'Add Trade';
  }

  document.getElementById('openAddModal').addEventListener('click', function() { backtestTradeMode = false; openModal(null); });
  document.getElementById('openAddModal').addEventListener('dragstart', function(e) { e.preventDefault(); });
  document.getElementById('openAddModal').addEventListener('selectstart', function(e) { e.preventDefault(); });
  document.getElementById('openAddModal').addEventListener('contextmenu', function(e) {
    if (document.documentElement.classList.contains('season-winter')) e.preventDefault();
  });
  document.getElementById('openAddModalMonth').addEventListener('click', function() { openModal(monthlySelectedMonth); });
  document.getElementById('openAddModalWeek').addEventListener('click', function() {
    var savedMonthlyYear = monthlyYear;
    monthlyYear = weeklyYear;
    openModal(weeklySelected ? weeklySelected.month : null);
    monthlyYear = savedMonthlyYear;
  });
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('modalOverlay') && !document.body.classList.contains('syter-mini')) closeModal();
  });

  function clearTradeFormError() {
    var error = document.getElementById('saveError');
    error.textContent = '';
    error.style.display = 'none';
  }
  document.getElementById('tradeForm').addEventListener('input', clearTradeFormError);
  document.getElementById('tradeForm').addEventListener('change', clearTradeFormError);

  function compressImage(file, maxDim, quality) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
            else { w = Math.round(w * (maxDim / h)); h = maxDim; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('screenshotInput').addEventListener('change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById('screenshotFileName').textContent = file.name;
    compressImage(file, 1280, 0.72).then(function(dataUrl) {
      currentScreenshot = dataUrl;
      document.getElementById('screenshotPreview').src = currentScreenshot;
      document.getElementById('screenshotPreviewWrap').style.display = 'block';
    }).catch(function() {
      var el = document.getElementById('saveError');
      el.style.display = 'block';
      el.textContent = 'Failed to process image.';
    });
  });

  document.getElementById('screenshotRemoveBtn').addEventListener('click', function() {
    currentScreenshot = null;
    document.getElementById('screenshotInput').value = '';
    document.getElementById('screenshotFileName').textContent = 'No file chosen';
    document.getElementById('screenshotPreview').src = '';
    document.getElementById('screenshotPreviewWrap').style.display = 'none';
  });

  document.getElementById('btnLong').addEventListener('click', function() {
    isLong = true;
    document.getElementById('btnLong').classList.add('active-long');
    document.getElementById('btnShort').classList.remove('active-short');
  });
  document.getElementById('btnShort').addEventListener('click', function() {
    isLong = false;
    document.getElementById('btnShort').classList.add('active-short');
    document.getElementById('btnLong').classList.remove('active-long');
  });

  document.getElementById('btnWin').addEventListener('click', function() {
    isWin = true;
    document.getElementById('btnWin').classList.add('active-win');
    document.getElementById('btnLoss').classList.remove('active-loss');
  });
  document.getElementById('btnLoss').addEventListener('click', function() {
    isWin = false;
    document.getElementById('btnLoss').classList.add('active-loss');
    document.getElementById('btnWin').classList.remove('active-win');
  });

  document.getElementById('tradeForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    clearTradeFormError();
    if(window.TJMedia && TJMedia.busy)return;
    if(this.dataset.saving==='1')return;
    var submitForm=this,submitOwner=viewingUser;
    var mag = Number(document.getElementById('magnitudeInput').value.trim().replace(',', '.'));
    var riskPercent = Number(document.getElementById('riskPercentInput').value.trim().replace(',', '.'));
    if(!document.getElementById('magnitudeInput').value.trim()||!document.getElementById('riskPercentInput').value.trim()||!Number.isFinite(mag)||mag<0||mag>1000000||!Number.isFinite(riskPercent)||riskPercent<0||riskPercent>100){
      var numError=document.getElementById('saveError');numError.style.display='block';numError.textContent='Use finite RR from 0 to 1,000,000 and risk from 0 to 100%.';return;
    }
    var asset = document.getElementById('assetInput').value;
    var openDT = getDateTimeInputValue(document.getElementById('openInput'));
    var closeDT = getDateTimeInputValue(document.getElementById('closeInput'));
    if (!openDT || !closeDT) return;
    if (openDT > currentLocalDateTimeKey() || closeDT > currentLocalDateTimeKey()) {
      var futureError = document.getElementById('saveError');
      futureError.style.display = 'block';
      futureError.textContent = 'Trade dates cannot be in the future.';
      return;
    }
    if (!validateTradeDateOrder(openDT, closeDT)) return;
    var owner = findUser(viewingUser);
    if (backtestTradeMode) {
      var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
      var backtestRangeStart = bt ? bt.startDate.slice(0, 10) + 'T00:00' : '';
      var backtestRangeEnd = bt ? bt.endDate.slice(0, 10) + 'T23:59' : '';
      if (!bt || openDT < backtestRangeStart || openDT > backtestRangeEnd || closeDT < backtestRangeStart || closeDT > backtestRangeEnd || closeDT < openDT) {
        var rangeError = document.getElementById('saveError'); rangeError.style.display = 'block'; rangeError.textContent = 'Trade dates must stay inside the selected backtest range.'; return;
      }
      var btTrade = editingBacktestTradeId ? allBacktestTrades.filter(function(t) { return t.id === editingBacktestTradeId && t.backtestId === activeBacktestId; })[0] : null;
      if(editingBacktestTradeId&&!btTrade){showBacktestSyncError('This trade no longer exists. Close the editor and reload.');return;}
      var oldBtTrade=btTrade;
      if (btTrade) {
        btTrade=Object.assign({},btTrade);
        btTrade.asset = asset; btTrade.direction = isLong ? 'LONG' : 'SHORT'; btTrade.openDT = openDT; btTrade.closeDT = closeDT; btTrade.r = isWin ? mag : -mag; btTrade.riskPercent = riskPercent;
      } else {
        btTrade = { id: Date.now().toString() + Math.random().toString(36).slice(2, 6), asset: asset, direction: isLong ? 'LONG' : 'SHORT', openDT: openDT, closeDT: closeDT, r: isWin ? mag : -mag, riskPercent: riskPercent, uid: owner ? owner.uid : null, backtestId: activeBacktestId };
        if(submitForm.dataset.pendingId)btTrade.id=submitForm.dataset.pendingId;else submitForm.dataset.pendingId=btTrade.id;
      }
      applyTradeModel(btTrade, selectedTradeModelId);
      var listedBtTrade=btTrade;
      if(window.TJMedia){
        btTrade._images=TJMedia.snapshot();submitForm.dataset.saving='1';submitForm.inert=true;
        var btSaving;try{btSaving=Promise.resolve(TJMedia.write('backtestTrades',btTrade,null,true));}catch(err){btSaving=Promise.reject(err);}
        var btOutcome=await tjSettleWithin(btSaving,navigator.onLine===false?TJ_OFFLINE_SAVE_WAIT_MS:TJ_SAVE_WAIT_MS);
        submitForm.dataset.saving='';submitForm.inert=false;
        if(btOutcome.error){showBacktestSyncError('Не сохранено: '+(btOutcome.error.message||btOutcome.error));return;}
        if(submitOwner!==viewingUser)return;
        if(btOutcome.pending)listedBtTrade=tjQueuePendingBacktestTrade(btTrade,btSaving,submitOwner);
      }
      if(!window.TJMedia){
        var queuedWrite=tjBacktestWrite('backtestTrades',btTrade.id,btTrade);
        queuedWrite.catch(function(err){if(viewingUser===submitOwner)showBacktestSyncError(queuedWrite.queued?'Saved on this device. Sync will retry when online.':'Not saved: '+err.message);});
        if(!queuedWrite.queued){showBacktestSyncError('Not saved: local storage is unavailable.');return;}
      }
      if(oldBtTrade)Object.assign(oldBtTrade,listedBtTrade);else{backtestTrades.push(listedBtTrade);allBacktestTrades.push(listedBtTrade);}
      delete submitForm.dataset.pendingId;
      saveBacktestLocal();
      if(listedBtTrade===btTrade)showBacktestSyncError('');
      backtestTradeMode = false; editingBacktestTradeId = null; document.getElementById('magnitudeInput').value = ''; currentScreenshot = null; closeModal(); renderBacktests(); return;
    }
    var newTrade = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      asset: asset,
      direction: isLong ? 'LONG' : 'SHORT',
      openDT: openDT,
      closeDT: closeDT,
      r: isWin ? mag : -mag,
      riskPercent: riskPercent,
      chart: currentScreenshot,
      _images: window.TJMedia ? TJMedia.snapshot() : (currentScreenshot?[currentScreenshot]:[]),
      uid: owner ? owner.uid : null
    };
    applyTradeModel(newTrade, selectedTradeModelId);
    if(submitForm.dataset.pendingId)newTrade.id=submitForm.dataset.pendingId;
    else submitForm.dataset.pendingId=newTrade.id;
    submitForm.dataset.saving='1';submitForm.inert=true;
    var saving;try{saving=Promise.resolve(remoteSaveTrade(newTrade,null,true));}catch(err){saving=Promise.reject(err);}
    // Without an acknowledgement in time (or offline) the trade is shown as pending
    // and the form is released instead of staying locked until the network returns.
    var outcome=await tjSettleWithin(saving,navigator.onLine===false?TJ_OFFLINE_SAVE_WAIT_MS:TJ_SAVE_WAIT_MS);
    submitForm.dataset.saving='';submitForm.inert=false;
    if(outcome.error){console.error(outcome.error);if(submitOwner===viewingUser)tjReportTradeSaveError(newTrade,'Failed to save trade to the server (check your internet connection and that Firestore is enabled).',outcome.error);return;}
    if(submitOwner!==viewingUser)return;
    if(outcome.pending)tjTrackPendingTrade(newTrade,saving,submitOwner);
    else if(!outcome.value)return;
    delete submitForm.dataset.pendingId;
    if(!trades.some(function(t){return t.id===newTrade.id;}))trades.push(newTrade);
    document.getElementById('magnitudeInput').value = '';
    document.getElementById('screenshotInput').value = '';
    document.getElementById('screenshotFileName').textContent = 'No file chosen';
    document.getElementById('screenshotPreview').src = '';
    document.getElementById('screenshotPreviewWrap').style.display = 'none';
    currentScreenshot = null;
    closeModal();
    render();
    maybeShowStreakToast();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.trade-datetime-input'), function(input) {
    var trigger = input.parentElement && input.parentElement.querySelector('.datetime-calendar-trigger');
    if (trigger) trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openDateTimePicker(input);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDateTimePicker(input);
      }
    });
  });

  document.getElementById('datetimePickerCloseBtn').addEventListener('click', closeDateTimePicker);
  document.getElementById('datetimePickerOverlay').addEventListener('click', function(e) {
    // The picker is modal: empty-space clicks must not dismiss it.
    e.preventDefault();
    e.stopPropagation();
  });
  document.getElementById('datetimePickerOverlay').addEventListener('mousedown', function(e) {
    e.stopPropagation();
  });
  document.getElementById('datetimePickerOverlay').addEventListener('click', function(e) {
    e.stopPropagation();
  });
  document.addEventListener('keydown', function(e) {
    if (document.body.classList.contains('datetime-picker-open') && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  document.addEventListener('wheel', function(e) {
    if (!document.body.classList.contains('datetime-picker-open')) return;
    var wheel = e.target && e.target.closest ? e.target.closest('.datetime-time-wheel') : null;
    if (!wheel) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    var part = wheel.id === 'datetimeHourWheel' ? 'hour' : 'minute';
    handleTimeWheel(part, e.deltaY || e.deltaX);
  }, { passive: false, capture: true });
  ['hour', 'minute'].forEach(function(part) {
    var wheel = document.getElementById(part === 'hour' ? 'datetimeHourWheel' : 'datetimeMinuteWheel');
    if (!wheel) return;
    wheel.addEventListener('mousedown', function(e) {
      e.preventDefault();
      beginTimeDrag(part, e.clientY);
    });
    wheel.addEventListener('touchstart', function(e) {
      if (!e.touches || !e.touches[0]) return;
      beginTimeDrag(part, e.touches[0].clientY);
    }, { passive: true });
  });
  document.addEventListener('mousemove', function(e) {
    if (datetimePickerState.dragPart && e.buttons !== undefined && (e.buttons & 1) === 0) {
      endTimeDrag();
      return;
    }
    updateTimeDrag(e.clientY);
  });
  document.addEventListener('mouseup', function() {
    datetimePickerState.mouseDown = false;
    endTimeDrag();
  });
  document.addEventListener('touchmove', function(e) {
    if (!datetimePickerState.dragPart || !e.touches || !e.touches[0]) return;
    updateTimeDrag(e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchend', function() {
    endTimeDrag();
  });
  document.addEventListener('touchcancel', function() {
    endTimeDrag();
  });
  // Releasing the mouse outside the document (or switching windows) may not
  // dispatch a normal mouseup, so explicitly cancel the drag in those cases.
  window.addEventListener('blur', function() {
    endTimeDrag();
  });
  document.addEventListener('mouseleave', function() {
    if (datetimePickerState.dragPart) endTimeDrag();
  });
  document.getElementById('dtMonthLabel').addEventListener('click', function() {
    window.TJCalendarNav.up(datetimePickerState);
    datetimePickerState.calendarAnimation = 'zoom'; renderDateTimePicker();
  });
  function movePickerPeriod(dir) {
    if (window.TJCalendarNav.move(datetimePickerState, dir, datetimePickerState.minDate, datetimePickerState.maxDate)) {
      datetimePickerState.calendarAnimation = 'zoom'; renderDateTimePicker();
    }
  }
  document.getElementById('dtPrevMonthBtn').addEventListener('click', function() { movePickerPeriod(-1); });
  document.getElementById('dtNextMonthBtn').addEventListener('click', function() { movePickerPeriod(1); });
  document.getElementById('datetimePickerTodayBtn').addEventListener('click', function() {
    var now = new Date();
    var sameMonth = datetimePickerState.year === now.getFullYear() && datetimePickerState.month === now.getMonth();
    var sameDay = sameMonth && datetimePickerState.day === now.getDate();
    var sameTime = sameDay && datetimePickerState.hour === pad2(now.getHours()) && datetimePickerState.minute === pad2(now.getMinutes());
    if (sameTime && datetimePickerState.level === 'days') return;
    var wasZoomed = datetimePickerState.level !== 'days';
    datetimePickerState.level = 'days';
    datetimePickerState.calendarAnimation = sameMonth ? (sameDay ? null : 'day') : 'month';
    datetimePickerState.year = now.getFullYear();
    datetimePickerState.month = now.getMonth();
    datetimePickerState.day = now.getDate();
    datetimePickerState.hour = pad2(now.getHours());
    datetimePickerState.minute = pad2(now.getMinutes());
    if (sameDay && !wasZoomed) syncPickerTime();
    else renderDateTimePicker();
  });
  document.getElementById('datetimePickerApplyBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (!datetimePickerState.target || datetimePickerState.level !== 'days') return;
    var value = buildDateTimeValue(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day, datetimePickerState.hour, datetimePickerState.minute);
    if (!pickerDayAllowed(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day)) return;
    if (!datetimePickerState.dateOnly && value > currentLocalDateTimeKey()) return;
    if (backtestCreationStep === 'start') {
      backtestDraftStart = pickerDayKey(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day) + 'T00:00:00';
      backtestCreationStep = 'end';
      document.getElementById('backtestDateInput').value = value;
      datetimePickerState.title = 'Backtest end date';
      datetimePickerState.minDate = backtestDraftStart.slice(0, 10);
      datetimePickerState.dateOnly = true;
      datetimePickerState.calendarAnimation = 'day';
      renderDateTimePicker();
      var pickerBox = document.querySelector('#datetimePickerOverlay .datetime-picker-box');
      pickerBox.classList.remove('is-backtest-step-transition');
      void pickerBox.offsetWidth;
      pickerBox.classList.add('is-backtest-step-transition');
      setTimeout(function() { pickerBox.classList.remove('is-backtest-step-transition'); }, 900);
      return;
    }
    if (backtestCreationStep === 'end') {
      value = pickerDayKey(datetimePickerState.year, datetimePickerState.month, datetimePickerState.day) + 'T23:59:59.999';
      if (!backtestDraftStart || value < backtestDraftStart) return;
      if (replayRangePick) {
        var rangeCb = replayRangePick, rangeFrom = backtestDraftStart.slice(0, 10), rangeTo = value.slice(0, 10);
        replayRangePick = null; backtestCreationStep = null; backtestDraftStart = null;
        closeDateTimePicker(); rangeCb(rangeFrom, rangeTo);
        return;
      }
      var owner = findUser(viewingUser);
      var bt = { id: Date.now().toString() + Math.random().toString(36).slice(2, 6), name: 'Backtest', uid: owner ? owner.uid : null, ownerLogin: viewingUser, startDate: backtestDraftStart, endDate: value, createdAt: new Date().toISOString() };
      var creation=tjBacktestWrite('backtests',bt.id,bt);
      creation.catch(function(err){console.error(err);showBacktestSyncError(creation.queued?'Saved on this device. Sync will retry when online.':'Not saved: '+err.message);});
      if(!creation.queued){showBacktestSyncError('Not saved: local storage is unavailable.');return;}
      backtests.push(bt); activeBacktestId = bt.id; backtestTrades = [];
      saveBacktestLocal();
      backtestCreationStep = null; backtestDraftStart = null;
      backtestViewTransition = 'detail';
      document.body.classList.remove('backtest-input-panel-collapsed');
      document.body.classList.add('backtest-detail-mode');
      closeDateTimePicker(); renderBacktests();
      if (typeof syncBacktestPanelPosition === 'function') requestAnimationFrame(syncBacktestPanelPosition);
      return;
    }
    var pickerTarget = datetimePickerState.target;
    setDateTimeInput(pickerTarget, value);
    if (pickerTarget.closest && pickerTarget.closest('#tradeForm')) clearTradeFormError();
    closeDateTimePicker();
    pickerTarget.blur();
  });

  // ---- Auth ----
  function setupAdminBar() {
    var sel = document.getElementById('adminUserSelect');
    var wrap = document.getElementById('adminPanelWrap');
    var menu = document.getElementById('adminAccountMenu');
    if (currentUser.role === 'admin') {
      wrap.style.display = 'flex';
      sel.innerHTML = USERS.map(function(u) {
        return '<option value="' + tjAssetEsc(u.login) + '"' + (u.login === viewingUser ? ' selected' : '') + '>' + tjAssetEsc(u.login) + '</option>';
      }).join('');
      menu.innerHTML = USERS.map(function(u) {
        var active = u.login === viewingUser ? ' active' : '';
        return '<button type="button" class="admin-account-option' + active + '" data-login="' + tjAssetEsc(u.login) + '" role="option" aria-selected="' + (u.login === viewingUser) + '"><span>' + tjAssetEsc(u.login) + '</span><span class="admin-account-check"><svg class="tj-ui-icon" data-icon="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span></button>';
      }).join('');
      document.getElementById('adminAccountLabel').textContent = viewingUser || '';
    } else {
      wrap.style.display = 'none';
    }
  }

  document.getElementById('adminGhostBtn').addEventListener('click', function() {
    var inner = document.getElementById('adminPanelInner');
    inner.classList.toggle('hidden');
  });

  document.getElementById('adminUserSelect').addEventListener('change', function(e) {
    flushNotePanelSave(); closeNotePanel(); closeBestTrade(); flushBacktestRRDraft();
    viewingUser = e.target.value;
    // Keep the custom control synchronized with the account whose data is
    // currently being viewed; the signed-in admin name is not the view label.
    setupAdminBar();
    setupSiteVersionSettings();
    activeTab = 'overview'; monthlySelectedMonth = null; quarterSel = null; yearSel = null; setAssetFilter('ALL', false); currentTradesPage = 1;
    setActiveTab('overview');
    loadData().then(function(load) { if (load) finishJournalCoreLoad(load); });
  });

  document.getElementById('adminAccountTrigger').addEventListener('click', function(e) {
    e.stopPropagation();
    var picker = document.getElementById('adminAccountPicker');
    var open = picker.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.getElementById('adminAccountMenu').addEventListener('click', function(e) {
    var option = e.target.closest ? e.target.closest('.admin-account-option') : null;
    if (!option) return;
    e.stopPropagation();
    var login = option.getAttribute('data-login');
    var sel = document.getElementById('adminUserSelect');
    sel.value = login;
    document.getElementById('adminAccountPicker').classList.remove('open');
    document.getElementById('adminAccountTrigger').setAttribute('aria-expanded', 'false');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('click', function(e) {
    var picker = document.getElementById('adminAccountPicker');
    if (!picker || picker.contains(e.target)) return;
    picker.classList.remove('open');
    document.getElementById('adminAccountTrigger').setAttribute('aria-expanded', 'false');
  });

  var PASS_EYE_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  var PASS_EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
  Array.prototype.forEach.call(document.querySelectorAll('.pass-eye'), function(btn) {
    btn.addEventListener('click', function() {
      var input = document.getElementById(btn.getAttribute('data-target'));
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? PASS_EYE_OFF_SVG : PASS_EYE_SVG;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  (function() {
    var eyeBtn = document.getElementById('loginPassEyeHold');
    var passInput = document.getElementById('loginPassInput');
    if (!eyeBtn || !passInput) return;
    var reveal = function() { passInput.type = 'text'; eyeBtn.classList.add('is-active'); };
    var hide = function() { passInput.type = 'password'; eyeBtn.classList.remove('is-active'); };
    eyeBtn.addEventListener('pointerdown', function(e) { e.preventDefault(); reveal(); });
    eyeBtn.addEventListener('pointerup', hide);
    eyeBtn.addEventListener('pointerleave', hide);
    eyeBtn.addEventListener('pointercancel', hide);
  })();

  var secondaryActionsRevision = 0;
  var secondaryActionsSettleTimer = null;
  var secondaryActions = document.getElementById('secondaryActions');
  var secondaryActionsWrap = document.getElementById('secondaryActionsWrap');
  var secondaryToggleBtn = document.getElementById('secondaryToggleBtn');

  secondaryActions.inert = true;
  secondaryToggleBtn.setAttribute('aria-expanded', 'false');
  secondaryToggleBtn.setAttribute('aria-controls', 'secondaryActions');

  // Warm up the first paint without showing the panel.
  requestAnimationFrame(function(){
    if (secondaryActions) {
      void secondaryActions.scrollWidth;
      void secondaryActions.offsetHeight;
    }
  });

  function setSecondaryActions(open, immediate) {
    var revision = ++secondaryActionsRevision;
    clearTimeout(secondaryActionsSettleTimer);
    secondaryActionsWrap.classList.remove('is-settled');

    /* Measure while the panel is available but still visually hidden. This avoids
       a zero-width read after responsive/user-specific controls change. */
    /* First prepare the content before starting the width transition.
       Previously the wrapper could become visible for one paint while its
       inner controls were still hidden/not composited, causing a black frame
       only on the first opening after page load. */
    if (open) {
      secondaryActions.classList.add('open');
      secondaryActionsWrap.classList.add('open', 'is-animating');
      secondaryActions.inert = false;
      void secondaryActions.offsetWidth;
    }

    var targetWidth = open ? Math.ceil(secondaryActions.scrollWidth) : 0;
    secondaryActionsWrap.style.setProperty('--secondary-panel-width', targetWidth + 'px');
    secondaryActionsWrap.style.width = targetWidth + 'px';

    secondaryToggleBtn.classList.toggle('open', open);
    if (!open) {
      secondaryActions.classList.remove('open');
      secondaryActionsWrap.classList.remove('open');
    }
    secondaryActions.inert = !open;
    secondaryToggleBtn.setAttribute('aria-expanded', String(open));

    if (!open) {
      document.getElementById('settingsWrap').classList.remove('open');
      document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
    }

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (immediate || reducedMotion) {
      secondaryActionsWrap.classList.remove('is-animating');
      if (open) secondaryActionsWrap.classList.add('is-settled');
      return;
    }

    secondaryActionsWrap.classList.add('is-animating');
    /* transitionend is primary; timeout is a safety net for hidden tabs and
       browsers that suppress the event after an interrupted transition. */
    secondaryActionsSettleTimer = setTimeout(function() {
      if (revision !== secondaryActionsRevision) return;
      secondaryActionsWrap.classList.remove('is-animating');
      if (open) secondaryActionsWrap.classList.add('is-settled');
    }, 520);
  }

  secondaryActionsWrap.addEventListener('transitionend', function(e) {
    if (e.target !== secondaryActionsWrap || e.propertyName !== 'width') return;
    clearTimeout(secondaryActionsSettleTimer);
    secondaryActionsWrap.classList.remove('is-animating');
    if (secondaryActions.classList.contains('open')) secondaryActionsWrap.classList.add('is-settled');
  });

  secondaryToggleBtn.addEventListener('click', function() {
    setSecondaryActions(!secondaryActions.classList.contains('open'));
  });

  var SITE_VERSION_CACHE_KEY = 'tj_site_version_global';
  var currentGlobalSiteVersion = 'default';
  var siteVersionUnsubscribe = null;
  function normalizeSiteVersion(version) {
    return version === 'winter' || version === 'autumn' || version === 'spring' || version === 'summer' ? version : 'default';
  }
  function isRetockerAuth() {
    // UI names and the account currently opened by the admin are not trusted.
    // Only the Firebase-authenticated retocker account receives this control.
    var authUser = firebase.auth().currentUser;
    return !!authUser && !!tjAdminUid && authUser.uid === tjAdminUid;
  }
  function applySiteVersion(version) {
    version = normalizeSiteVersion(version);
    if (version === 'autumn') ensureAutumnLeaves();
    if (version === 'winter') ensureWinterSnowflakes();
    if (version === 'spring') ensureSpringPetals();
    if (version === 'summer') ensureSummerLeaves();
    document.documentElement.classList.remove('season-autumn', 'season-winter', 'season-spring', 'season-summer');
    if (version !== 'default') document.documentElement.classList.add('season-' + version);
    Array.prototype.forEach.call(document.querySelectorAll('.version-option[data-version]'), function(option) {
      option.classList.toggle('active', option.getAttribute('data-version') === version);
    });
    try { localStorage.setItem(SITE_VERSION_CACHE_KEY, version); } catch (e) {}
  }
  function startSiteVersionSync() {
    if (siteVersionUnsubscribe) return;
    siteVersionUnsubscribe = db.collection('siteConfig').doc('global').onSnapshot(function(doc) {
      currentGlobalSiteVersion = normalizeSiteVersion(doc.exists ? doc.data().version : 'default');
      applySiteVersion(currentGlobalSiteVersion);
    }, function(err) {
      // An auth-protected read can fail before login. setupSiteVersionSettings()
      // will establish a fresh listener after Firebase authentication succeeds.
      console.error('Could not load the global site version:', err);
      siteVersionUnsubscribe = null;
    });
  }
  function saveGlobalSiteVersion(version) {
    if (!isRetockerAuth()) return Promise.reject(new Error('Only the admin can change the site version.'));
    version = normalizeSiteVersion(version);
    return db.collection('siteConfig').doc('global').set({ version: version }, { merge: true }).then(function() {
      currentGlobalSiteVersion = version;
      return version;
    });
  }
  // ---- Curve color toggle ----
  function updateCurveColorUI() {
    var normalizedColor = String(curveColor || '').toLowerCase();
    var isGrey = (normalizedColor === '#8fa3b8');
    var isGreen = (normalizedColor === '#34d399');
    var greenBtn = document.getElementById('curveGreenBtn');
    var greyBtn = document.getElementById('curveGreyBtn');
    // Keep the base/custom classes intact; replacing className made the controls
    // brittle when the menu was reopened after switching presets.
    if (greenBtn) {
      greenBtn.classList.toggle('active-green', isGreen);
      greenBtn.setAttribute('aria-pressed', isGreen ? 'true' : 'false');
    }
    if (greyBtn) {
      greyBtn.classList.toggle('active-grey', isGrey);
      greyBtn.setAttribute('aria-pressed', isGrey ? 'true' : 'false');
    }
    var customBtn = document.getElementById('curveCustomBtn');
    var isCustom = !isGrey && !isGreen;
    if (customBtn) {
      customBtn.classList.toggle('active-custom', isCustom);
      var customDot = document.getElementById('curveCustomDot');
      if (customDot) customDot.style.background = isCustom ? curveColor : (savedCustomCurveColor || '#a78bfa');
    }
    var previewDot = document.getElementById('curveColorPreviewDot');
    var previewHex = document.getElementById('curveColorHex');
    if (previewDot) previewDot.style.background = normalizedColor;
    if (previewHex) previewHex.textContent = normalizedColor.toUpperCase();
  }

  function setCurveColor(color, persist) {
    if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
    curveColor = String(color).toLowerCase();
    pendingCurveColor = curveColor;
    if (persist !== false && curveColor !== '#34d399' && curveColor !== '#8fa3b8') savedCustomCurveColor = curveColor;
    updateCurveColorUI();
    // Re-render both charts to apply new colour immediately
    if (currentUser) {
      var stats = computeStats(assetFiltered(trades));
      if (stats.percentChartData.length > 1) renderChart(stats.percentChartData);
      if (activeBacktestId) {
        var bt = backtests.filter(function(b) { return b.id === activeBacktestId; })[0];
        if (bt) { var renderOwner=viewingUser,renderGeneration=tjDataGeneration,renderBacktestId=bt.id; loadBacktestTrades(bt).then(function(btTrades) { if(viewingUser===renderOwner&&tjDataGeneration===renderGeneration&&activeBacktestId===renderBacktestId)renderBacktestChart(btTrades); }); }
      }
    }
    // Save to Firestore so it syncs across devices
    if (persist !== false && viewingUser) {
      clearTimeout(curveColorSaveTimer);
      var colourOwner=viewingUser, colourGeneration=tjDataGeneration;
      var payload = { curveColor: String(curveColor).toLowerCase() };
      if (savedCustomCurveColor) payload.customCurveColor = savedCustomCurveColor;
      curveColorSaveTimer = setTimeout(function() {
        if(viewingUser!==colourOwner || tjDataGeneration!==colourGeneration)return;
        db.collection('titles').doc(colourOwner).set(payload, { merge: true }).catch(function(err) { console.error('curveColor save failed:', err); });
      }, 220);
    }
  }

  (function() {
    var control = document.getElementById('curveColorControl');
    var trigger = document.getElementById('curveColorTrigger');
    var canvas = document.getElementById('curveColorWheel');
    var wrap = document.getElementById('curveColorWheelWrap');
    if (!control || !trigger || !canvas) return;
    var ctx = canvas.getContext('2d'), size = canvas.width, center = size / 2, radius = center - 2, picking = false;
    var image = ctx.createImageData(size, size);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var dx = x - center, dy = y - center, dist = Math.sqrt(dx * dx + dy * dy), i = (y * size + x) * 4;
      if (dist > radius) { image.data[i + 3] = 0; continue; }
      var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      var rgb = hslToRgb(hue / 360, Math.min(1, dist / radius), .5);
      image.data[i] = rgb[0]; image.data[i + 1] = rgb[1]; image.data[i + 2] = rgb[2]; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    function pick(clientX, clientY) {
      var rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
      var cx = rect.width / 2, cy = rect.height / 2, dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy), r = Math.max(1, rect.width / 2 - 9);
      if (dist > r) { dx *= r / dist; dy *= r / dist; x = cx + dx; y = cy + dy; }
      var px = Math.max(0, Math.min(size - 1, Math.round(x / rect.width * size))), py = Math.max(0, Math.min(size - 1, Math.round(y / rect.height * size)));
      var data = ctx.getImageData(px, py, 1, 1).data, color = rgbToHex(data[0], data[1], data[2]);
      pendingCurveColor = color;
      // Wheel movement is a live preview: make Custom the active choice and
      // repaint the curve, but defer the Firestore write until Save.
      document.getElementById('curveCustomBtn').classList.add('visible', 'active-custom');
      document.getElementById('curveCustomDot').style.background = color;
      setCurveColor(color, false);
      document.getElementById('curveColorKnob').style.left = x + 'px';
      document.getElementById('curveColorKnob').style.top = y + 'px';
      document.getElementById('curveColorKnob').style.background = color;
      document.getElementById('curveColorPreviewDot').style.background = color;
      document.getElementById('curveColorHex').textContent = color.toUpperCase();
    }
    function syncKnobToColor(color) {
      var rect = canvas.getBoundingClientRect();
      var value = String(color || '').replace('#', '');
      if (!/^[0-9a-f]{6}$/i.test(value)) return;
      var r = parseInt(value.slice(0, 2), 16) / 255, g = parseInt(value.slice(2, 4), 16) / 255, b = parseInt(value.slice(4, 6), 16) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
      if (max !== min) {
        var d = max - min;
        s = l > .5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
      }
      // Grey has no hue on the wheel; keep its marker in the center.
      var wheelRadius = Math.max(1, rect.width / 2 - 9);
      var distance = max === min ? 0 : Math.max(4, s * wheelRadius);
      var angle = h * Math.PI * 2;
      var x = rect.width / 2 + Math.cos(angle) * distance, y = rect.height / 2 + Math.sin(angle) * distance;
      var knob = document.getElementById('curveColorKnob');
      knob.style.left = x + 'px'; knob.style.top = y + 'px'; knob.style.background = color;
      document.getElementById('curveColorPreviewDot').style.background = color;
      document.getElementById('curveColorHex').textContent = String(color).toUpperCase();
    }
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var open = control.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        pendingCurveColor = curveColor;
        document.getElementById('curveCustomBtn').classList.toggle('visible', !!savedCustomCurveColor || curveColor !== '#34d399' && curveColor !== '#8fa3b8');
        syncKnobToColor(curveColor);
      }
    });
    function revealCustom() {
      document.getElementById('curveCustomBtn').classList.add('visible');
    }
    canvas.addEventListener('pointerdown', function(e) { picking = true; revealCustom(); canvas.setPointerCapture(e.pointerId); pick(e.clientX, e.clientY); });
    canvas.addEventListener('pointermove', function(e) { if (picking) pick(e.clientX, e.clientY); });
    canvas.addEventListener('pointerup', function(e) { picking = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointercancel', function(e) { picking = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
    window.addEventListener('pointerup', function() { picking = false; });
    window.addEventListener('pointercancel', function() { picking = false; });
    document.getElementById('curveGreenBtn').addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); setCurveColor('#34d399'); syncKnobToColor('#34d399'); });
    document.getElementById('curveGreyBtn').addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); setCurveColor('#8fa3b8'); syncKnobToColor('#8fa3b8'); });
    document.getElementById('curveColorSaveBtn').addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); setCurveColor(pendingCurveColor, true); control.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); });
    document.getElementById('curveCustomBtn').addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.add('visible');
      var customColor = savedCustomCurveColor || (curveColor !== '#34d399' && curveColor !== '#8fa3b8' ? curveColor : null);
      if (customColor) {
        pendingCurveColor = customColor;
        setCurveColor(customColor, false);
      }
    });
    document.addEventListener('click', function(e) { if (!control.contains(e.target)) { control.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); } });
  })();


  // ---- Local time in Settings (the time on the user's own device) ----
  (function() {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function tick() {
      var h = document.getElementById('usageClockH');
      if (h) {
        var d = new Date();
        h.textContent = pad(d.getHours());
        document.getElementById('usageClockM').textContent = pad(d.getMinutes());
        document.getElementById('usageClockS').textContent = pad(d.getSeconds());
        var dt = document.getElementById('usageClockDate');
        var label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        if (dt.textContent !== label) dt.textContent = label;
      }
      setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    }
    tick();
  })();
  // ---- Usage statistics: authenticated sessions + active-tab time ----
  // Usage data is stored inside the existing `titles/<login>` document.
  // This avoids depending on a new Firestore collection/rule that may not exist.
  var usageTracker = {
    uid: null,
    login: null,
    activeSince: null,
    timer: null,
    started: false,
    previousVisit: null,
    saving: Promise.resolve()
  };

  function usageDayKey(ts) {
    var d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function usageWeekKeys() {
    var keys = [], d = new Date();
    d.setHours(12, 0, 0, 0);
    var day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    for (var i = 0; i < 7; i++) {
      var x = new Date(d);
      x.setDate(d.getDate() + i);
      keys.push(usageDayKey(x));
    }
    return keys;
  }

  function formatUsage(ms) {
    ms = Math.max(0, Number(ms) || 0);
    var mins = Math.floor(ms / 60000);
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? (h + 'h ' + m + 'm') : (m + 'm');
  }

  function usageProfileForUid(uid) {
    for (var i = 0; i < USERS.length; i++) {
      if (USERS[i] && USERS[i].uid === uid) return USERS[i];
    }
    // A recreated Auth account may have a new UID while retaining its login/email.
    // Resolve only through Firebase's signed-in identity, never viewingUser.
    var authUser=firebase.auth().currentUser;
    if(authUser&&authUser.uid===uid&&authUser.email){
      var email=String(authUser.email).trim().toLowerCase();
      for(var j=0;j<USERS.length;j++)if(String(getAuthEmail(USERS[j])).toLowerCase()===email)return USERS[j];
    }
    return null;
  }

  function usageDoc() {
    var user=firebase.auth().currentUser;
    return user&&user.uid===usageTracker.uid&&usageTracker.login ? db.collection('titles').doc(usageTracker.login) : null;
  }

  function toUsageDate(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      var parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  function setUsageText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function queueUsageWrite(task, tracker) {
    // Serialize writes so a visibility event and the interval cannot double-count
    // the same active period at the same time.
    tracker = tracker || usageTracker;
    tracker.saving = tracker.saving.catch(function() {}).then(task);
    return tracker.saving;
  }

  function usagePendingPrefix(tracker) { return 'tj_usage_pending_v2_'+encodeURIComponent(tracker.uid)+'_'; }
  function usagePendingRead(tracker) {
    var records={};
    try {
      var prefix=usagePendingPrefix(tracker);
      for(var i=0;i<localStorage.length;i++){
        var key=localStorage.key(i);if(!key||key.indexOf(prefix)!==0)continue;
        var record=JSON.parse(localStorage.getItem(key));
        if(record&&/^\d{4}-\d{2}-\d{2}$/.test(record.day)&&Number(record.ms)>0)records[key]=record;
      }
    }catch(err){console.warn('Usage retry storage unavailable:',err);}
    return Object.assign(records,tracker.pending||{});
  }
  function usagePendingSave(tracker,day,ms) {
    // Independent records cannot overwrite another tab's failed interval. Persist
    // immediately, before awaiting a previous write or the cross-tab pump lock.
    var key=usagePendingPrefix(tracker)+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
    var record={day:day,ms:ms};
    try{localStorage.setItem(key,JSON.stringify(record));}
    catch(_){tracker.pending=tracker.pending||{};tracker.pending[key]=record;}
  }
  function flushUsageTime() {
    var tracker=usageTracker,ref=usageDoc();
    if(!tracker.login||!ref)return Promise.resolve();
    var now=Date.now(),delta=tracker.activeSince?now-tracker.activeSince:0;
    tracker.activeSince=document.hidden?null:now;
    if(isFinite(delta)&&delta>=1000)usagePendingSave(tracker,usageDayKey(now),Math.min(delta,5*60*1000));
    function drain(){
      var pending=usagePendingRead(tracker),keys=Object.keys(pending);
      if(!keys.length)return;
      var update={},total=0,days={};
      keys.forEach(function(key){var record=pending[key],ms=Number(record.ms)||0;total+=ms;days[record.day]=(days[record.day]||0)+ms;});
      Object.keys(days).forEach(function(day){update['usage.days.'+day]=firebase.firestore.FieldValue.increment(days[day]);});
      update['usage.totalMs']=firebase.firestore.FieldValue.increment(total);
      update['usage.updatedAt']=firebase.firestore.FieldValue.serverTimestamp();
      return ref.update(update).catch(function(err){
        if(err.code!=='not-found')throw err;
        return ref.set({uid:tracker.uid},{merge:true}).then(function(){return ref.update(update);});
      }).then(function(){
        keys.forEach(function(key){if(tracker.pending)delete tracker.pending[key];try{localStorage.removeItem(key);}catch(_){}});
      });
    }
    return queueUsageWrite(function(){
      return typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('syter-usage-sync-'+tracker.uid,drain):drain();
    },tracker).catch(function(err){console.warn('Usage time save failed; interval retained:',err);});
  }

  function refreshUsageStats() {
    var authUser=firebase.auth().currentUser;
    if(!authUser)return Promise.resolve();
    if(!usageTracker.started||usageTracker.uid!==authUser.uid)return startUsageTracking();
    var ref = usageDoc(), tracker=usageTracker;
    if (!ref) return Promise.resolve();

    return flushUsageTime().then(function(){return tracker.saving;}).then(function() {
      return ref.get();
    }).then(function(snap) {
      if(usageTracker!==tracker||!firebase.auth().currentUser||firebase.auth().currentUser.uid!==tracker.uid)return;
      var root = snap.exists ? snap.data() : {};
      var x = root.usage || {};
      var days = x.days || {};
      var today = Number(days[usageDayKey()]) || 0;
      var week = usageWeekKeys().reduce(function(sum, k) { return sum + (Number(days[k]) || 0); }, 0);
      var live = usageTracker.activeSince ? Math.max(0, Date.now() - usageTracker.activeSince) : 0;

      setUsageText('usageToday', formatUsage(today + live));
      setUsageText('usageWeek', formatUsage(week + live));
      setUsageText('usageTotal', formatUsage((Number(x.totalMs) || 0) + live));
      setUsageText('usageSessions', String(Number(x.sessions) || 0));

      var lv = usageTracker.previousVisit || toUsageDate(x.previousVisit);
      setUsageText('usageLastVisit', 'Last visit — ' + (lv ? lv.toLocaleString() : 'first session'));
    }).catch(function(err) {
      if(usageTracker!==tracker)return;
      console.warn('Usage stats load failed:', err);
      setUsageText('usageToday', '—');
      setUsageText('usageWeek', '—');
      setUsageText('usageTotal', '—');
      setUsageText('usageSessions', '—');
      setUsageText('usageLastVisit', 'Last visit — unavailable');
    });
  }

  function startUsageTracking() {
    var authUser = firebase.auth().currentUser;
    if (!authUser) return Promise.resolve();
    if (usageTracker.started&&usageTracker.uid===authUser.uid) return usageTracker.saving;
    if(usageTracker.uid!==authUser.uid){
      if(usageTracker.timer)clearInterval(usageTracker.timer);
      usageTracker={uid:null,login:null,activeSince:null,timer:null,started:false,previousVisit:null,saving:Promise.resolve()};
    }

    var profile = usageProfileForUid(authUser.uid);
    if (!profile || !profile.login) {
      console.warn('Usage tracking: signed-in UID has no matching local profile.');
      setUsageText('usageLastVisit','Last visit — account profile unavailable');
      return Promise.resolve();
    }

    usageTracker.started = true;
    usageTracker.uid = authUser.uid;
    usageTracker.login = profile.login;
    usageTracker.activeSince = document.hidden ? null : Date.now();

    var ref = usageDoc(),tracker=usageTracker;
    // Initialize only a confirmed missing root. A permission-denied read is not
    // evidence that it is missing: the administrator must repair legacy ownership.
    var session=queueUsageWrite(function(){
      return ref.get({source:'server'}).then(function(snap){
        if(!snap.exists)return ref.set({uid:authUser.uid},{merge:true});
      }).then(function(){return db.runTransaction(function(tx) {
      return tx.get(ref).then(function(snap) {
        var root = snap.exists ? snap.data() : {};
        var oldUsage = root.usage || {};
        var oldLastVisit = oldUsage.lastVisit || null;
        tracker.previousVisit = toUsageDate(oldLastVisit);

        var nextUsage = {
          totalMs: Number(oldUsage.totalMs) || 0,
          days: oldUsage.days || {},
          sessions: (Number(oldUsage.sessions) || 0) + 1,
          lastVisit: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (oldLastVisit) nextUsage.previousVisit = oldLastVisit;

        tx.set(ref, { uid: authUser.uid, usage: nextUsage }, { merge: true });
      });
    });});}).then(function() {
      if(usageTracker===tracker)return refreshUsageStats();
    }).catch(function(err) {
      console.warn('Usage session save failed:', err);
      if(usageTracker===tracker){
        tracker.started=false;
        if(tracker.timer)clearInterval(tracker.timer);
        tracker.timer=null;
        ['usageToday','usageWeek','usageTotal','usageSessions'].forEach(function(id){setUsageText(id,'—');});
        setUsageText('usageLastVisit','Last visit — unavailable. Reopen settings to retry.');
      }
    });

    // Short interval keeps active time safe even if the tab/browser closes abruptly.
    usageTracker.timer = setInterval(function() {
      if (usageTracker===tracker&&!document.hidden) flushUsageTime();
    }, 30000);
    return session;
  }

  document.addEventListener('visibilitychange', function() {
    if (!usageTracker.started) return;
    if (document.hidden) {
      flushUsageTime();
    } else if (!usageTracker.activeSince) {
      usageTracker.activeSince = Date.now();
    }
  });

  window.addEventListener('pagehide', function() {
    flushNotePanelSave(); flushBestNote(); flushBacktestRRDraft();
    flushUsageTime();
  });

  firebase.auth().onAuthStateChanged(function(u) {
    if (u) {
      tjLoadUserDirectory(u).then(function() {
        var now = firebase.auth().currentUser;
        if (!now || now.uid !== u.uid) return;
        startUsageTracking();
        setupSiteVersionSettings();
      });
    } else {
      tjDataGeneration++; stopLiveSync();
      tjResetUserDirectory();
      // Best effort final flush before resetting local tracker state.
      var signingOutTracker=usageTracker;
      var finalFlush = usageTracker.started ? flushUsageTime() : Promise.resolve();
      finalFlush.catch(function() {}).then(function() {
        if(usageTracker!==signingOutTracker||firebase.auth().currentUser)return;
        if (usageTracker.timer) clearInterval(usageTracker.timer);
        usageTracker = { uid: null, login: null, activeSince: null, timer: null, started: false, previousVisit: null, saving: Promise.resolve() };
      });
    }
  });

  function setupSiteVersionSettings() {
    var settingsWrap = document.getElementById('settingsWrap');
    if (!settingsWrap) return;
    var canManageVersion = isRetockerAuth();
    var hasAuth = !!firebase.auth().currentUser;
    // v3.22: Settings (with the Notes entry) are available in Mobile mode for every signed-in user,
    // exactly like Desktop. The site-version section stays retocker-only below.
    var allowSettingsHere = hasAuth;
    var regularMobileWithoutSettings = false;
    document.body.classList.toggle('mobile-regular-no-settings', regularMobileWithoutSettings);
    settingsWrap.style.display = allowSettingsHere ? 'flex' : 'none';
    var versionAdminSection = document.getElementById('versionAdminSection');
    if (versionAdminSection) versionAdminSection.classList.toggle('is-hidden', !canManageVersion);
    if (!allowSettingsHere) {
      settingsWrap.classList.remove('open');
      document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
    }

    // Settings visibility changes the width of the inline mobile action strip.
    // Drop any stale width measured while the gear existed, then measure only
    // the controls that are actually visible to this user.
    var secondaryWrap = document.getElementById('secondaryActionsWrap');
    var secondaryActions = document.getElementById('secondaryActions');
    if (secondaryWrap && secondaryActions && regularMobileWithoutSettings) {
      var syncSecondaryWidth = function() {
        var isOpen = secondaryActions.classList.contains('open');
        var width = isOpen ? secondaryActions.scrollWidth + 'px' : '0px';
        secondaryWrap.style.width = width;
        secondaryWrap.style.setProperty('--secondary-panel-width', width);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncSecondaryWidth);
      else syncSecondaryWidth();
    }

    var savedVersion = 'default';
    try { savedVersion = localStorage.getItem(SITE_VERSION_CACHE_KEY) || 'default'; } catch (e) {}
    applySiteVersion(savedVersion);
    startSiteVersionSync();
  }
  document.getElementById('settingsBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (!firebase.auth().currentUser) return;
    var settingsWrap = document.getElementById('settingsWrap');
    var isOpen = settingsWrap.classList.toggle('open');
    document.getElementById('settingsBtn').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    /* Let the popover paint first. Firestore's first connection can be slow on a
       cold start, but it must never delay the opening animation. */
    if (isOpen) requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (settingsWrap.classList.contains('open')) refreshUsageStats();
      });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.logo-box, .login-logo'), function(logo) {
    logo.addEventListener('dragstart', function(e) { e.preventDefault(); });
    logo.addEventListener('selectstart', function(e) {
      if (/(^|\s)season-/.test(document.documentElement.className)) e.preventDefault();
    });
    logo.addEventListener('contextmenu', function(e) {
      if (/(^|\s)season-/.test(document.documentElement.className)) e.preventDefault();
    });
    logo.addEventListener('click', function() {
      if (!document.documentElement.classList.contains('season-winter')) return;
      var wrap = logo.querySelector('.winter-logo-wrap');
      if (!wrap) return;
      wrap.classList.remove('wiggle');
      void wrap.offsetWidth;
      wrap.classList.add('wiggle');
    });
  });
  // Desktop app only: "Close SYTER" quits the program completely (not just into the tray).
  (function() {
    var section = document.getElementById('syterQuitSection'), btn = document.getElementById('syterQuitBtn'), bridge = window.syterDesktop;
    if (!section || !btn || !bridge || typeof bridge.quitApp !== 'function') return;
    section.style.display = '';
    btn.addEventListener('click', function() {
      btn.disabled = true;
      Promise.resolve().then(function() { return bridge.quitApp(); }).catch(function() { btn.disabled = false; });
    });
  })();
  // Only actual version choices may change the global site theme. Other settings
  // controls (for example Notes) intentionally reuse .version-option styling.
  Array.prototype.forEach.call(document.querySelectorAll('.version-option[data-version]'), function(option) {
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!isRetockerAuth()) return;
      var requestedVersion = normalizeSiteVersion(option.getAttribute('data-version'));
      var previousVersion = currentGlobalSiteVersion;
      applySiteVersion(requestedVersion);
      saveGlobalSiteVersion(requestedVersion).catch(function(err) {
        console.error('Could not save the global site version:', err);
        applySiteVersion(previousVersion);
      });
      document.getElementById('settingsWrap').classList.remove('open');
      document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', function(e) {
    var settingsWrap = document.getElementById('settingsWrap');
    if (!settingsWrap || settingsWrap.contains(e.target) || document.getElementById('versionPanel').contains(e.target)) return;
    settingsWrap.classList.remove('open');
    document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var settingsWrap = document.getElementById('settingsWrap');
    if (!settingsWrap) return;
    settingsWrap.classList.remove('open');
    document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
  });
  setupSiteVersionSettings();

  // Escapes text for element content AND quoted attributes. Journal data can be
  // written by another account (student -> administrator view), so quotes matter.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtDiaryDate(iso) {
    var d = new Date(iso);
    var day = pad2(d.getDate());
    var mon = RU_MONTHS_SHORT[d.getMonth()];
    var hh = pad2(d.getHours());
    var mm = pad2(d.getMinutes());
    return day + ' ' + mon + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  }

  function loadDiary() {
    var list = document.getElementById('diaryList');
    var empty = document.getElementById('diaryEmptyState');
    list.innerHTML = '';
    empty.style.display = 'none';
    var owner = findUser(viewingUser);
    if (!owner) { empty.style.display = 'block'; return; }
    var diaryOwner=viewingUser, diaryGeneration=tjDataGeneration;
    db.collection('diary').where('uid', '==', owner.uid).get().then(function(snapshot) {
      if (viewingUser!==diaryOwner || tjDataGeneration!==diaryGeneration) return;
      var entries = [];
      snapshot.forEach(function(d) { var entry=d.data(); entry.id=d.id; entries.push(entry); });
      entries.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      if (!entries.length) { empty.style.display = 'block'; return; }
      list.innerHTML = entries.map(function(e) {
        return '<div class="diary-entry" data-id="' + escapeAttr(e.id) + '">' +
          '<div class="diary-entry-head">' +
            '<span class="diary-entry-date mono">' + fmtDiaryDate(e.createdAt) + '</span>' +
            '<div class="diary-entry-actions">' +
              '<button class="edit-btn" data-id="' + escapeAttr(e.id) + '" title="Edit">✎</button>' +
              '<button class="del-btn" data-id="' + escapeAttr(e.id) + '">✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="diary-entry-text" data-id="' + escapeAttr(e.id) + '">' + escapeHtml(e.text) + '</div>' +
        '</div>';
      }).join('');

      Array.prototype.forEach.call(list.querySelectorAll('.del-btn'), function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.getAttribute('data-id');
          if(btn.disabled)return;
          var entry = entries.filter(function(x) { return x.id === id; })[0];
          tjConfirmAction({ title: 'Удалить запись?', message: 'Запись дневника' + (entry && entry.createdAt ? ' от ' + fmtDiaryDate(entry.createdAt) : '') + ' будет удалена. Это действие нельзя отменить.', confirmLabel: 'Удалить' }).then(function(confirmed) {
            if(!confirmed||btn.disabled||!btn.isConnected||viewingUser!==diaryOwner||tjDataGeneration!==diaryGeneration)return;
            btn.disabled=true;
            db.collection('diary').doc(id).delete().then(loadDiary).catch(function() {
              btn.disabled=false;var err=document.getElementById('diaryError');err.style.display='block';err.textContent='Could not delete note. Nothing was removed; retry.';
            });
          });
        });
      });

      Array.prototype.forEach.call(list.querySelectorAll('.edit-btn'), function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.getAttribute('data-id');
          var textEl = Array.prototype.find.call(list.querySelectorAll('.diary-entry-text'),function(node){return node.dataset.id===id;});
          if (!textEl || textEl.querySelector('textarea')) return; // already editing
          var current = textEl.textContent;
          var ta = document.createElement('textarea');
          ta.value = current;
          ta.style.cssText = 'width:100%;background:#0a0c10;border:1px solid rgba(96,165,250,0.45);color:var(--textMain);border-radius:10px;padding:8px 10px 36px 10px;font-size:13px;line-height:1.45;resize:vertical;min-height:60px;outline:none;font-family:inherit;box-shadow:0 0 0 3px rgba(96,165,250,0.12);transition:border-color .2s ease;display:block;';
          var saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.textContent = 'Save';
          saveBtn.style.cssText = 'position:absolute;bottom:8px;right:8px;padding:4px 14px;border-radius:8px;border:none;background:var(--green);color:#052e1e;font-weight:700;font-size:12px;cursor:pointer;transition:opacity .2s ease,transform .15s ease;z-index:1;';
          saveBtn.addEventListener('mouseenter', function() { saveBtn.style.opacity = '0.88'; });
          saveBtn.addEventListener('mouseleave', function() { saveBtn.style.opacity = '1'; });
          var wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative;';
          wrap.appendChild(ta);
          wrap.appendChild(saveBtn);
          textEl.innerHTML = '';
          textEl.appendChild(wrap);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;

          function save() {
            if(saveBtn.disabled)return;
            var newText = ta.value.trim();
            if (!newText || newText === current) { textEl.innerHTML = ''; textEl.textContent = current; return; }
            saveBtn.disabled=true;ta.readOnly=true;
            db.collection('diary').doc(id).update({ text: newText }).then(function() {
              textEl.innerHTML = ''; textEl.textContent = newText;
              document.getElementById('diaryError').style.display='none';
            }).catch(function() {
              var err=document.getElementById('diaryError');err.style.display='block';err.textContent='Not saved. Your edit is kept below; retry Save.';
              saveBtn.disabled=false;ta.readOnly=false;
            });
          }

          saveBtn.addEventListener('mousedown', function(e) { e.preventDefault(); }); // prevent blur before click
          saveBtn.addEventListener('click', function() { ta.removeEventListener('blur', save); save(); });

          ta.addEventListener('blur', save);
          ta.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { ta.blur(); }
            if (e.key === 'Escape') { ta.removeEventListener('blur', save); textEl.innerHTML = ''; textEl.textContent = current; }
          });
        });
      });

    }).catch(function(err) {
      console.error(err);
      var errEl = document.getElementById('diaryError');
      errEl.style.display = 'block';
      errEl.textContent = 'Failed to load notes.';
    });
  }

  document.getElementById('addDiaryBtn').addEventListener('click', function() {
    if(this.disabled)return;var button=this,saveOwner=viewingUser;
    var textEl = document.getElementById('newDiaryText');
    var val = textEl.value.trim();
    var errEl = document.getElementById('diaryError');
    errEl.style.display = 'none';
    if (!val) return;
    var owner = findUser(viewingUser);
    var entry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      user: viewingUser,
      uid: owner ? owner.uid : null,
      text: val,
      createdAt: new Date().toISOString()
    };
    button.disabled=true;
    db.collection('diary').doc(entry.id).set(entry).then(function() {
      if(viewingUser!==saveOwner)return;
      if(textEl.value.trim()===val)textEl.value = '';
      loadDiary();
    }).catch(function(err) {
      console.error(err);
      errEl.style.display = 'block';
      errEl.textContent = 'Failed to save note. Your draft was kept.';
    }).finally(function(){button.disabled=false;});
  });

  var passModalOverlay = document.getElementById('passModalOverlay');
  var passModalFirstInput = document.getElementById('newPass1Input');

  function setPasswordModal(open) {
    passModalOverlay.classList.toggle('open', open);
    passModalOverlay.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('modal-open', open);
    if (open) {
      document.getElementById('newPass1Input').value = '';
      document.getElementById('newPass2Input').value = '';
      document.getElementById('passError').style.display = 'none';
      document.getElementById('passSuccess').style.display = 'none';
      setSecondaryActions(false);
      window.setTimeout(function() { passModalFirstInput.focus(); }, 220);
    } else {
      passModalFirstInput.blur();
    }
  }

  document.getElementById('changePassBtn').addEventListener('click', function() {
    setPasswordModal(true);
  });
  document.getElementById('closePassModalBtn').addEventListener('click', function() {
    setPasswordModal(false);
  });
  passModalOverlay.addEventListener('click', function(e) {
    if (e.target === passModalOverlay) setPasswordModal(false);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && passModalOverlay.classList.contains('open')) setPasswordModal(false);
  });
  // Each Firebase failure gets its own explanation; only a real network failure
  // talks about the connection.
  function tjPasswordChangeError(err) {
    var code = err && err.code;
    switch (code) {
      case 'auth/requires-recent-login':
        return 'To change the password you need to have logged in recently — sign out and back in with the old password, then try again.';
      case 'auth/weak-password':
        return 'The new password is too weak. Use at least 6 characters.';
      case 'auth/network-request-failed':
        return 'Failed to change password. Check your internet connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a few minutes and try again.';
      case 'auth/user-token-expired':
      case 'auth/invalid-user-token':
      case 'auth/user-not-found':
      case 'auth/user-disabled':
        return 'Your session is no longer valid. Sign out and back in, then try again.';
      case 'auth/operation-not-allowed':
        return 'Password changes are disabled for this site. Contact the administrator.';
      default:
        return 'Failed to change password' + tjErrorReason(err) + '. Try again.';
    }
  }
  document.getElementById('passForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var p1 = document.getElementById('newPass1Input').value;
    var p2 = document.getElementById('newPass2Input').value;
    var errEl = document.getElementById('passError');
    var okEl = document.getElementById('passSuccess');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    if (p1 !== p2) {
      errEl.style.display = 'block';
      errEl.textContent = 'Passwords do not match.';
      return;
    }
    var user = firebase.auth().currentUser;
    if (!user) {
      errEl.style.display = 'block';
      errEl.textContent = 'Session expired — sign out and back in, then try again.';
      return;
    }
    user.updatePassword(p1).then(function() {
      okEl.style.display = 'block';
      document.getElementById('newPass1Input').value = '';
      document.getElementById('newPass2Input').value = '';
    }).catch(function(err) {
      errEl.style.display = 'block';
      errEl.textContent = tjPasswordChangeError(err);
    });
  });

  // ---- Device mode switch (login screen) ----
  // Default is always 'desktop' unless this browser has previously chosen 'mobile' here.
  var deviceMode = 'desktop';
  try { deviceMode = localStorage.getItem('journalDeviceMode') || 'desktop'; } catch (e) {}
  if (window.tjStorageUnavailable) tjNotice('keep:storage', 'warn', 'Браузер блокирует хранилище сайта. Журнал работает, но настройки этого устройства и черновики не сохранятся после закрытия вкладки.');

  function detectActualDevice() {
    // Heuristic only: combines UA sniffing + touch support + viewport width.
    // Not 100% reliable (tablets, resized desktop windows, "desktop site" mode on
    // phones can all fool it) — used only to show a soft hint, never to hard-block.
    var ua = navigator.userAgent || '';
    var isTouchUA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
    var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var narrow = window.innerWidth <= 820;
    if (isTouchUA && hasTouch) return narrow ? 'mobile' : 'desktop';
    return narrow && hasTouch ? 'mobile' : 'desktop';
  }

  function updateDeviceHint() {
    var hint = document.getElementById('deviceHint');
    var hintInner = hint.querySelector('.device-hint-inner');
    var actual = detectActualDevice();
    if (actual !== deviceMode) {
      hintInner.textContent = actual === 'mobile'
        ? 'Looks like you are on a phone — you might want to select Mobile.'
        : 'Looks like you are on a desktop — you might want to select Desktop.';
      hint.classList.add('show');
    } else {
      hint.classList.remove('show');
    }
  }

  function setDeviceMode(mode) {
    // v3.41: on a phone the Desktop layout is locked, not just discouraged.
    var phoneLocked = detectActualDevice() === 'mobile';
    if (phoneLocked) mode = 'mobile';
    var deskBtn = document.getElementById('deviceDesktopBtn');
    deskBtn.disabled = phoneLocked;
    deskBtn.classList.toggle('is-locked', phoneLocked);
    deskBtn.title = phoneLocked ? 'Desktop layout is not available on a phone' : '';
    deviceMode = mode;
    document.documentElement.classList.toggle('mobile-performance', mode === 'mobile');
    localStorage.setItem('journalDeviceMode', mode);
    document.getElementById('deviceDesktopBtn').classList.toggle('active', mode === 'desktop');
    document.getElementById('deviceMobileBtn').classList.toggle('active', mode === 'mobile');
    updateDeviceHint();
  }

  document.getElementById('deviceDesktopBtn').addEventListener('click', function() { setDeviceMode('desktop'); });
  document.getElementById('deviceMobileBtn').addEventListener('click', function() { setDeviceMode('mobile'); });
  setDeviceMode(deviceMode);

  // Purely cosmetic "rebuild" delay for the mobile layout switch — scaled loosely by
  // connection speed where the browser exposes it (not supported in Safari/iOS, which
  // falls back to a fixed delay). It does not reflect any real computation happening.
  function estimateRebuildDelay() {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && typeof conn.downlink === 'number' && conn.downlink > 0) {
      var ms = 3200 / conn.downlink;
      return Math.max(700, Math.min(ms, 3500));
    }
    return 1100;
  }


  // `resume` = the desktop app's animated auto sign-in: the password field only shows decorative
  // dots, so the sign-in reuses the Firebase session that is still stored from the manual sign-in.
  function proceedLogin(found, passVal, btn, resume) {
    var authUser = null, generation = null;
    function current() {
      var now = firebase.auth().currentUser;
      return !!(authUser && now && now.uid === authUser.uid && generation === tjDataGeneration);
    }
    var signIn = resume
      ? (firebase.auth().currentUser ? Promise.resolve({ user: firebase.auth().currentUser }) : Promise.reject({ code: 'auth/user-not-found' }))
      : firebase.auth().signInWithEmailAndPassword(getAuthEmail(found), passVal);
    signIn.then(function(cred) {
      authUser = (cred && cred.user) || firebase.auth().currentUser;
      generation = tjDataGeneration;
      if (!current()) return null;
      return tjLoadUserDirectory(authUser).then(function(profile) {
        if (!current()) return null;
        // Usage initialization creates the own settings document before journal
        // reads/listeners. Reuse an initialization already started by Auth.
        return startUsageTracking().catch(function() {}).then(function() {
          return current() ? profile : null;
        });
      });
    }).then(function(profile) {
      if (!profile || !current()) {
        if (!firebase.auth().currentUser) btn.classList.remove('is-loading');
        return;
      }
      currentUser = profile;
      viewingUser = profile.login;
      // Desktop app only: a manual sign-in (re)starts the 6 hour timer for the animated auto sign-in.
      if (!resume) {
        try { if (window.syterDesktop && window.syterDesktop.rememberLogin) window.syterDesktop.rememberLogin(found.login); } catch (e) {}
      }

      function enterApp() {
        document.getElementById('loginScreen').style.display = 'none';
        var appRoot = document.getElementById('appRoot');
        appRoot.style.display = 'block';
        appRoot.classList.remove('reveal');
        void appRoot.offsetWidth;
        appRoot.classList.add('reveal');
        setupAdminBar();
        setupSiteVersionSettings();
        activeTab = 'overview'; monthlySelectedMonth = null; quarterSel = null; yearSel = null; setAssetFilter('ALL', false); currentTradesPage = 1;
        setActiveTab('overview');
        loadData().then(function(load) { if (load) finishJournalCoreLoad(load, btn); });
      }

      if (deviceMode === 'mobile') {
        document.body.classList.add('mobile-mode');
        // Mobile layout is ready immediately; no cosmetic rebuild delay.
        enterApp();
      } else {
        document.body.classList.remove('mobile-mode');
        enterApp();
      }
      // passkey-login.js: offers Face ID after a manual phone sign-in and updates its Settings switch.
      try { window.dispatchEvent(new CustomEvent('tj:signed-in', { detail: { login: profile.login, manual: !resume } })); } catch (e) {}
    }).catch(function(authErr) {
      btn.classList.remove('is-loading');
      console.error('Firebase sign-in failed:', authErr);
      var code = authErr && authErr.code ? String(authErr.code) : '';
      var msg = code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential'
        ? 'Invalid login or password'
        : (code ? 'Firebase error: ' + code.replace('auth/', '') : 'Unable to sign in. Check Firebase connection.');
      showLoginError(msg);
    });
  }

  // Smoothly reveals the login error text and gives the card a gentle shake,
  // instead of the error snapping into view instantly.
  function showLoginError(message) {
    var err = document.getElementById('loginError');
    var card = document.querySelector('#loginScreen .login-card');
    err.style.display = 'none';
    // Force reflow so the display change is committed before we re-show it —
    // this lets the errorSlideIn animation restart every time, even on repeated failed attempts.
    void err.offsetWidth;
    err.style.display = 'block';
    err.textContent = message;
    if (card && card.animate) {
      // Uses the Web Animations API (not a CSS class) so it never touches the
      // card's own "animation" property — toggling a class there would reset
      // it and replay the loginCardIn entrance animation, making the whole
      // card fade/scale in again right after the shake finished.
      card.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(-1.5px)' },
        { transform: 'translateX(0)' }
      ], { duration: 520, easing: 'ease-in-out' });
    }
  }

  // Face ID / fingerprint sign-in (passkey-login.js) has already signed in to Firebase with the
  // passkey; continue through the same session-reuse path as the desktop auto sign-in.
  window.tjShowLoginError = showLoginError;
  window.tjPasskeyContinue = function(login, btn) {
    var found = tjLoginTarget(login);
    if (!found || !btn || !firebase.auth().currentUser) return false;
    tjTypedLogin = found.login;
    document.getElementById('loginError').style.display = 'none';
    btn.classList.add('is-loading');
    proceedLogin(found, '', btn, true);
    return true;
  };

  document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var loginVal = document.getElementById('loginUserInput').value.trim();
    var passVal  = document.getElementById('loginPassInput').value;
    var found = tjLoginTarget(loginVal);
    var err = document.getElementById('loginError');
    var resume = window.__tjDesktopResume === true; // set only by desktop-autologin.js
    window.__tjDesktopResume = false;
    if (!found) { showLoginError('Invalid login or password'); return; }
    tjTypedLogin = found.login;
    err.style.display = 'none';
    var btn = document.getElementById('loginSubmitBtn');
    btn.classList.add('is-busy');

    var delay = 900 + Math.random() * 500;
    setTimeout(function() {
      btn.classList.remove('is-busy');
      // Captcha removed: go straight to the loading state, then sign in.
      btn.classList.add('is-loading');
      setTimeout(function() {
        proceedLogin(found, passVal, btn, resume);
      }, 1000);
    }, delay);
  });

  // Mobile browsers fire 'resize' when the URL bar hides/shows during scroll,
  // even though the width hasn't changed — only re-render the chart when the
  // width actually changes, and debounce so a real resize doesn't spam it.
  var lastWindowWidth = window.innerWidth;
  // Chart resizing is handled by the shared container observers.
  window.addEventListener('resize', function() {
    if (window.innerWidth === lastWindowWidth) return;
    lastWindowWidth = window.innerWidth;
    hideChartTooltip();
    closeChartTradeCard();

  });
  window.addEventListener('orientationchange', function() {
    hideChartTooltip();
    closeChartTradeCard();
  });

  // ---- Decorative background particles (login screen + whole app) ----
  function fillParticles(containerId, count) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var html = '';
    for (var i = 0; i < count; i++) {
      var isStar = Math.random() < 0.72;
      var left = Math.random() * 100;
      var top = Math.random() * 100;
      var size = isStar ? (16 + Math.random() * 40) : (2 + Math.random() * 2);
      var opacity = 0.3 + Math.random() * 0.5;
      var glyph = isStar ? '*' : '•';
      var duration = (28 + Math.random() * 40).toFixed(1); // 28s–68s, very slow
      var delay = (-Math.random() * 60).toFixed(1); // negative delay = particles already "in flight" at start
      var driftX = Math.round(-50 + Math.random() * 100); // px, horizontal drift amplitude
      html += '<span class="login-particle" style="left:' + left + '%; top:' + top + '%; font-size:' + size + 'px; opacity:' + opacity + '; --driftX:' + driftX + 'px; animation-duration:' + duration + 's; animation-delay:' + delay + 's;">' + glyph + '</span>';
    }
    container.innerHTML = html;
  }

  // Autumn is generated only when it is first selected, so the default
  // version pays no rendering cost for the seasonal background.
  function ensureAutumnLeaves() {
    var container = document.getElementById('autumnParticles');
    if (!container || container.getAttribute('data-ready') === 'true') return;
    container.setAttribute('data-ready', 'true');

    var shapes = ['maple', 'maple', 'birch', 'rowan', 'oak'];
    var colors = ['#dc2626', '#ef4444', '#f97316', '#fb923c', '#f59e0b', '#eab308', '#ca8a04', '#b45309', '#a16207', '#92400e'];
    var count = window.innerWidth < 700 ? 58 : 88;
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var leaf = document.createElement('span');
      var shape = shapes[Math.floor(Math.random() * shapes.length)];
      var sizeRoll = Math.random();
      var size = sizeRoll < 0.72
        ? 12 + Math.random() * 17
        : (sizeRoll < 0.94 ? 30 + Math.random() * 16 : 48 + Math.random() * 22);
      var duration = 19 + Math.random() * 25;

      leaf.className = 'autumn-leaf ' + shape;
      leaf.style.setProperty('--leaf-left', (-4 + Math.random() * 108).toFixed(2) + '%');
      leaf.style.setProperty('--leaf-size', size.toFixed(1) + 'px');
      leaf.style.setProperty('--leaf-color', colors[Math.floor(Math.random() * colors.length)]);
      leaf.style.setProperty('--leaf-opacity', (0.38 + Math.random() * 0.46).toFixed(2));
      leaf.style.setProperty('--leaf-duration', duration.toFixed(1) + 's');
      leaf.style.setProperty('--leaf-delay', (-Math.random() * duration).toFixed(1) + 's');
      leaf.style.setProperty('--leaf-flutter', (1.8 + Math.random() * 3).toFixed(1) + 's');
      leaf.style.setProperty('--leaf-sway', (24 + Math.random() * 76).toFixed(1) + 'px');
      leaf.style.setProperty('--leaf-sway-duration', (9 + Math.random() * 13).toFixed(1) + 's');
      leaf.style.setProperty('--leaf-sway-delay', (-Math.random() * 18).toFixed(1) + 's');
      leaf.style.setProperty('--leaf-start-rotation', Math.round(-20 + Math.random() * 40) + 'deg');
      leaf.style.setProperty('--stem-angle', (-7 + Math.random() * 14).toFixed(1) + 'deg');

      var leafShape = document.createElement('span');
      leafShape.className = 'autumn-leaf-shape';
      var leafBlade = document.createElement('span');
      leafBlade.className = 'autumn-leaf-blade';
      var leafVein = document.createElement('span');
      leafVein.className = 'autumn-leaf-vein';
      var leafStem = document.createElement('span');
      leafStem.className = 'autumn-leaf-stem';
      leafShape.appendChild(leafBlade);
      leafShape.appendChild(leafVein);
      leafShape.appendChild(leafStem);
      leaf.appendChild(leafShape);
      fragment.appendChild(leaf);
    }

    container.appendChild(fragment);
  }

  // Winter snow is created lazily on first selection to keep the default view light.
  function ensureWinterSnowflakes() {
    var container = document.getElementById('winterParticles');
    if (!container || container.getAttribute('data-ready') === 'true') return;
    container.setAttribute('data-ready', 'true');

    var symbols = ['❄', '❅', '❆'];
    var colors = ['#f8fbff', '#eaf6ff', '#dbeeff', '#ffffff'];
    var count = window.innerWidth < 700 ? 80 : 120;
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var flake = document.createElement('span');
      var shape = document.createElement('span');
      var sizeRoll = Math.random();
      var size = sizeRoll < 0.7
        ? 5 + Math.random() * 7
        : (sizeRoll < 0.95 ? 12 + Math.random() * 10 : 24 + Math.random() * 13);
      var duration = 18 + Math.random() * 31;

      flake.className = 'winter-snowflake';
      flake.style.setProperty('--snow-left', (-4 + Math.random() * 108).toFixed(2) + '%');
      flake.style.setProperty('--snow-size', size.toFixed(1) + 'px');
      flake.style.setProperty('--snow-color', colors[Math.floor(Math.random() * colors.length)]);
      flake.style.setProperty('--snow-opacity', (0.32 + Math.random() * 0.6).toFixed(2));
      flake.style.setProperty('--snow-duration', duration.toFixed(1) + 's');
      flake.style.setProperty('--snow-delay', (-Math.random() * duration).toFixed(1) + 's');
      flake.style.setProperty('--snow-sway', (10 + Math.random() * 36).toFixed(1) + 'px');
      flake.style.setProperty('--snow-sway-duration', (14 + Math.random() * 18).toFixed(1) + 's');
      flake.style.setProperty('--snow-sway-delay', (-Math.random() * 24).toFixed(1) + 's');
      flake.style.setProperty('--snow-start-rotation', Math.round(Math.random() * 360) + 'deg');
      flake.style.setProperty('--snow-glow', (1 + Math.random() * 4).toFixed(1) + 'px');

      shape.className = 'winter-snowflake-shape';
      shape.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      flake.appendChild(shape);
      fragment.appendChild(flake);
    }
    container.appendChild(fragment);
  }

  // ===== v3.39: Spring (sakura petals) and Summer (calm fireflies) =====
  function ensureSpringPetals() {
    var container = document.getElementById('springParticles');
    if (!container || container.getAttribute('data-ready') === 'true') return;
    container.setAttribute('data-ready', 'true');
    var c1 = ['#ffe4ee', '#ffd1e1', '#ffc2d6', '#fff0f5', '#f9b8cf'];
    var c2 = ['#f7a8c4', '#f09ab9', '#ffd6e5', '#f4b3cb', '#e98fb0'];
    var count = window.innerWidth < 700 ? 40 : 64;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var petal = document.createElement('span');
      var roll = Math.random();
      var size = roll < 0.75 ? 8 + Math.random() * 7 : (roll < 0.95 ? 15 + Math.random() * 6 : 21 + Math.random() * 6);
      var dur = 26 + Math.random() * 6;
      petal.className = 'spring-petal';
      petal.style.setProperty('--pt-left', (-6 + Math.random() * 108).toFixed(2) + '%');
      petal.style.setProperty('--pt-size', size.toFixed(1) + 'px');
      petal.style.setProperty('--pt-op', (0.45 + Math.random() * 0.45).toFixed(2));
      petal.style.setProperty('--pt-dur', dur.toFixed(1) + 's');
      petal.style.setProperty('--pt-delay', (-Math.random() * dur).toFixed(1) + 's');
      petal.style.setProperty('--pt-drift', Math.round(-20 + Math.random() * 80) + 'px');
      petal.style.setProperty('--pt-sway', (10 + Math.random() * 18).toFixed(1) + 'px');
      petal.style.setProperty('--pt-sway-dur', (11 + Math.random() * 6).toFixed(1) + 's');
      petal.style.setProperty('--pt-sway-delay', (-Math.random() * 14).toFixed(1) + 's');
      petal.style.setProperty('--pt-flutter', (3.5 + Math.random() * 2.5).toFixed(1) + 's');
      petal.style.setProperty('--pt-rot', Math.round(Math.random() * 360) + 'deg');
      petal.style.setProperty('--pt-c1', c1[Math.floor(Math.random() * c1.length)]);
      petal.style.setProperty('--pt-c2', c2[Math.floor(Math.random() * c2.length)]);
      var shape = document.createElement('span');
      shape.className = 'spring-petal-shape';
      petal.appendChild(shape);
      fragment.appendChild(petal);
    }
    container.appendChild(fragment);
  }

  function ensureSummerLeaves() {
    // Summer: daisy petals mixed with fresh green leaves, same calm fall as spring.
    var container = document.getElementById('summerParticles');
    if (!container || container.getAttribute('data-ready') === 'true') return;
    container.setAttribute('data-ready', 'true');
    var count = window.innerWidth < 700 ? 34 : 54;
    var leafC1 = ['#a6e98a', '#8fdb72', '#b4e89a', '#86d16a', '#9fe07f'];
    var leafC2 = ['#4f9e3c', '#5aae44', '#3f8a33', '#68b84d', '#46923a'];
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var el = document.createElement('span');
      var leaf = true;
      var roll = Math.random();
      var size = roll < 0.55 ? 9 + Math.random() * 6 : (roll < 0.88 ? 15 + Math.random() * 7 : 22 + Math.random() * 8);
      var dur = 26 + Math.random() * 6;
      el.className = 'spring-petal summer-leaf' + (Math.random() < 0.4 ? ' long' : '');
      el.style.setProperty('--pt-left', (-6 + Math.random() * 108).toFixed(2) + '%');
      el.style.setProperty('--pt-size', size.toFixed(1) + 'px');
      el.style.setProperty('--pt-op', (0.55 + Math.random() * 0.35).toFixed(2));
      el.style.setProperty('--pt-dur', dur.toFixed(1) + 's');
      el.style.setProperty('--pt-delay', (-Math.random() * dur).toFixed(1) + 's');
      el.style.setProperty('--pt-drift', Math.round(-20 + Math.random() * 80) + 'px');
      el.style.setProperty('--pt-sway', (10 + Math.random() * 18).toFixed(1) + 'px');
      el.style.setProperty('--pt-sway-dur', (11 + Math.random() * 6).toFixed(1) + 's');
      el.style.setProperty('--pt-sway-delay', (-Math.random() * 14).toFixed(1) + 's');
      el.style.setProperty('--pt-flutter', (3.5 + Math.random() * 2.5).toFixed(1) + 's');
      el.style.setProperty('--pt-rot', Math.round(Math.random() * 360) + 'deg');
      if (leaf) {
        el.style.setProperty('--pt-c1', leafC1[Math.floor(Math.random() * leafC1.length)]);
        el.style.setProperty('--pt-c2', leafC2[Math.floor(Math.random() * leafC2.length)]);
      } else {
        el.style.setProperty('--pt-c1', '#ffffff');
        el.style.setProperty('--pt-c2', Math.random() < 0.5 ? '#f1f3ee' : '#e9ece4');
      }
      var shape = document.createElement('span');
      shape.className = 'spring-petal-shape';
      el.appendChild(shape);
      fragment.appendChild(el);
    }
    container.appendChild(fragment);
  }

  // ---- Inline edit: pencil click handlers (desktop + mobile) ----
  document.addEventListener('click', function(e) {
    var pencil = e.target.closest ? e.target.closest('.th-pencil') : null;
    if (!pencil) return;
    e.stopPropagation();
    var col = pencil.getAttribute('data-col');
    if (!col) return;
    setActiveEditCol(col);
    // Re-render to apply wiggle immediately — both editable tables
    ['allTradesBody', 'monthTradesBody', 'weekTradesBody', 'quarterTradesBody', 'yearTradesBody'].forEach(function(id) {
      var tbody = document.getElementById(id);
      if (tbody && activeEditCol) {
        Array.prototype.forEach.call(tbody.querySelectorAll('td[data-col="' + activeEditCol + '"]'), function(td) {
          td.classList.add('col-editing');
        });
      }
    });
  });

  // Clicking outside table deactivates edit mode
  document.addEventListener('click', function(e) {
    if (!activeEditCol) return;
    if (document.body.classList.contains('datetime-picker-open')) return;
    if (e.target.closest && e.target.closest('#allTradesBody')) return;
    if (e.target.closest && e.target.closest('#monthTradesBody')) return;
    if (e.target.closest && e.target.closest('#weekTradesBody')) return;
    if (e.target.closest && e.target.closest('#quarterTradesBody')) return;
    if (e.target.closest && e.target.closest('#yearTradesBody')) return;
    if (e.target.closest && e.target.closest('.th-editable')) return;
    if (e.target.closest && e.target.closest('.inline-edit-popup')) return;
    if (e.target.closest && e.target.closest('.datetime-picker-overlay')) return;
    // Deactivate
    activeEditCol = null;
    Array.prototype.forEach.call(document.querySelectorAll('.th-pencil.col-edit-active'), function(el) {
      el.classList.remove('col-edit-active');
    });
    Array.prototype.forEach.call(document.querySelectorAll('td.col-editing'), function(el) {
      el.classList.remove('col-editing');
    });
    closeInlineEditPopup();
    refreshTradeModelCells();
  });

  fillParticles('loginParticles', 160);
  fillParticles('appParticles', 220);
