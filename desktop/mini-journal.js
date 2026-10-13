/* Desktop-only enhancement, injected into the trusted journal after load. */
(function () {
  'use strict';
  var api = window.syterDesktop;
  var form = document.getElementById('tradeForm');
  if (!api || !api.setMiniMode || !form || window.syterMiniInstalled) return;
  window.syterMiniInstalled = true;
  var $ = function (id) { return document.getElementById(id); };
  var overlay = $('modalOverlay'), mini = false, managedDraft = false;
  var journalView = window.syterJournalView;
  var switching = false, saving = false, imageBusy = false, imageRevision = 0, pendingTrade = null;
  var draftOwner = null;
  var header = document.createElement('div');
  header.className = 'syter-mini-header';
  header.innerHTML = '<div><span class="syter-mini-brand">SYTER <small>MINI</small></span><div id="syterMiniOwner"></div></div><div class="syter-mini-actions"><button type="button" id="syterMiniPin" aria-pressed="true" title="Поверх остальных окон">Закреплено</button><button type="button" id="syterMiniExpand" title="Вернуться в полный журнал">Развернуть ↗</button></div>';
  overlay.querySelector('.modal-box').prepend(header);
  var fullButton = document.createElement('button');
  fullButton.type = 'button'; fullButton.className = 'ghost-btn syter-to-mini';
  fullButton.textContent = 'Мини-журнал ↗';
  fullButton.title = 'Ctrl + Shift + Ё — переключить режим';
  $('syterMiniExpand').title = 'Ctrl + Shift + Ё — вернуться в полный журнал';
  $('closeModalBtn').before(fullButton);
  var capture = document.createElement('label'); capture.className='syter-capture-toggle';
  capture.innerHTML='<input type="checkbox" id="syterCaptureImages"> Подхватывать изображения <span id="syterCaptureState">выкл.</span>';
  $('tradeScreenshotField').prepend(capture);
  var captureOwner=null, captureRevision=0;
  async function setCapture(on){
    if(!api.setClipboardCapture||!window.TJMedia)return;
    if(on&&!signedIn())return;
    const owner=viewingUser,token=++captureRevision;
    captureOwner=on?owner:null;
    const active=await api.setClipboardCapture(on);
    if(token!==captureRevision||owner!==viewingUser)return;
    $('syterCaptureImages').checked=!!active;$('syterCaptureState').textContent=active?'● включено':'выкл.';
    if(signedIn())localStorage.setItem('syter_capture_'+viewingUser,active?'1':'0');
  }
  $('syterCaptureImages').onchange=function(){setCapture(this.checked);};
  var capturedQueue=[],captureDraining=false;
  async function drainCapture(){
    if(captureDraining||switching||saving||form.dataset.saving==='1')return;
    captureDraining=true;
    try{while(capturedQueue.length&&!saving&&form.dataset.saving!=='1'){
      const item=capturedQueue.shift();if(!signedIn()||item.owner!==viewingUser)continue;
      if(journalView)journalView.openDraft(viewingUser,function(){openModal(null);});
      else if(!$('modalOverlay').classList.contains('open'))openModal(null);
      if(!backtestTradeMode){managedDraft=true;draftOwner=viewingUser;}
      await TJMedia.addData(item.data);
    }}finally{captureDraining=false;}
  }
  if(api.onClipboardImage)api.onClipboardImage(function(payload){
    if(!signedIn()||captureOwner!==viewingUser){setCapture(false);return;}
    if(payload.error){error(payload.error);return;}
    if(capturedQueue.length>=10){error('Очередь заполнена. Сохраните позицию перед следующим копированием.');return;}
    capturedQueue.push({owner:viewingUser,data:payload.data});drainCapture();
  });
  let captureAccount=null;
  setInterval(function(){
    const account=signedIn()?viewingUser:null;
    if(account!==captureAccount){capturedQueue=[];captureAccount=account;if(window.TJMedia)TJMedia.clearCache();setCapture(!!account&&localStorage.getItem('syter_capture_'+account)==='1');}
    drainCapture();
  },1000);
  var notes = document.createElement('div');
  notes.className = 'field syter-trade-notes';
  notes.innerHTML = '<label class="field-label" for="syterTradeNotes">Комментарий</label><textarea id="syterTradeNotes" rows="2" maxlength="10000"></textarea>';
  $('tradeModalSubmitBtn').before(notes);
  var status = document.createElement('div');
  status.id = 'syterMiniStatus'; status.setAttribute('role', 'status');
  $('tradeModalSubmitBtn').after(status);
  var footer = document.createElement('div'); footer.className = 'syter-save-footer';
  form.append(footer); footer.append($('tradeModalSubmitBtn'), status, $('saveError'));


  var noticeTimer;
  function notice(message) {
    var box = $('syterModeNotice');
    if (!box) { box = document.createElement('div'); box.id = 'syterModeNotice'; box.setAttribute('role','status'); document.body.append(box); }
    box.textContent = message; box.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(function(){box.hidden=true;},4000);
  }
  // The compact window is the form itself, never a dismissible backdrop.
  overlay.addEventListener('click',function(e){
    if (document.body.classList.contains('syter-mini') && e.target === overlay) e.stopImmediatePropagation();
  },true);

  function error(message) {
    $('saveError').textContent = message; $('saveError').style.display = 'block';
  }
  function signedIn() {
    return typeof currentUser !== 'undefined' && currentUser && firebase.auth().currentUser && $('appRoot').style.display !== 'none';
  }
  async function changeMode(enabled) {
    if (enabled === mini || switching || saving || form.dataset.saving === '1') return;
    if (enabled && (!signedIn() || !tradingModelsReady || tradingModelsUser !== viewingUser)) {
      notice('Сначала войдите в журнал и дождитесь загрузки аккаунта.'); return;
    }
    if (enabled && (backtestTradeMode || $('modelCreateOverlay').classList.contains('open') || $('modelDeleteOverlay').classList.contains('open'))) {
      notice('Сначала завершите редактирование бэктеста или модели. Мини-журнал предназначен для обычных сделок.'); return;
    }
    switching = true;
    var modeOwner = viewingUser;
    document.body.dataset.syterModeTransition = '1';
    var wasInert = form.inert; form.inert = true;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      if (enabled && journalView) journalView.begin(modeOwner);
      // Freeze the ORIGINAL screen before opening the form or changing its layout.
      if (api.prepareMiniMode) await api.prepareMiniMode(enabled, !reducedMotion);
      if (enabled && (!signedIn() || viewingUser !== modeOwner)) {
        if (journalView) journalView.invalidate();
        return;
      }
      if (enabled) {
        if ($('syterModeNotice')) $('syterModeNotice').hidden = true;
        if (journalView) journalView.openDraft(viewingUser, function(){openModal(null);});
        else if (!overlay.classList.contains('open')) openModal(null);
        managedDraft = true; draftOwner = viewingUser;
        $('syterMiniOwner').textContent = '';
      }
      // Change the live layout only while the compositor cover conceals it.
      document.body.classList.toggle('syter-mini', enabled);
      if (!enabled && journalView) journalView.leave(modeOwner);
      var state = await api.setMiniMode(enabled, !reducedMotion);
      if (!state) throw new Error('Не удалось переключить окно.');
      // A logout/account change or closing the form can occur during the
      // native resize. Never finish in mini mode with a closed/foreign draft.
      if (enabled && (!signedIn() || viewingUser !== modeOwner ||
          !overlay.classList.contains('open') || backtestTradeMode)) {
        document.body.classList.remove('syter-mini');
        if (journalView) journalView.invalidate();
        state = await api.setMiniMode(false, false);
        if (!state) throw new Error('Не удалось вернуть полный журнал.');
      }
      mini = state.mini;
      document.body.classList.toggle('syter-mini', mini);
      $('syterMiniPin').setAttribute('aria-pressed', String(state.pinned));
      $('syterMiniPin').textContent = state.pinned ? 'Закреплено' : 'Закрепить';
      if (!mini && journalView) journalView.finish(viewingUser);
    } catch (err) { document.body.classList.toggle('syter-mini', mini); error(err.message); }
    finally {
      if (api.cancelMiniMode) await api.cancelMiniMode().catch(function(){});
      form.inert = wasInert; switching = false; delete document.body.dataset.syterModeTransition;
    }
  }
  api.onModeRequest(changeMode);
  fullButton.addEventListener('click', function () { changeMode(true); });
  $('syterMiniExpand').addEventListener('click', function () { changeMode(false); });
  $('syterMiniPin').addEventListener('click', async function () {
    try {
      var value = await api.setMiniPinned(this.getAttribute('aria-pressed') !== 'true');
      this.setAttribute('aria-pressed', String(value)); this.textContent = value ? 'Закреплено' : 'Закрепить';
    } catch (_) { error('Не удалось изменить закрепление окна.'); }
  });
  // Closing/hiding the native window keeps this page and its draft alive.
  // A logout/account switch closes the modal; never carry that draft to another user.
  document.addEventListener('syter:parked-draft-discarded', function () {
    imageRevision++; managedDraft = false; draftOwner = null; pendingTrade = null;
    capturedQueue = []; imageBusy = false; status.textContent = '';
  });
  new MutationObserver(function () {
    form.classList.toggle('syter-backtest-form', !!backtestTradeMode);
    fullButton.hidden = !!backtestTradeMode;
    if (!overlay.classList.contains('open') && !(journalView && journalView.isParked())) {
      imageRevision++; managedDraft = false; draftOwner = null; pendingTrade = null;
      imageBusy = false;  $('tradeModalSubmitBtn').disabled = saving;
      $('syterTradeNotes').value = ''; status.textContent = '';
      if (mini) changeMode(false);
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

  // Keep drafts on server rejection. Use one ID on retry and await the existing
  // journal's write function instead of optimistically closing an unsaved form.
  form.addEventListener('submit', async function (e) {
    if (backtestTradeMode) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (switching || saving || imageBusy || (window.TJMedia&&TJMedia.busy) || !signedIn()) return;
    clearTradeFormError(); status.textContent = '';
    var owner = findUser(viewingUser);
    if (!owner || !owner.uid || (managedDraft && draftOwner !== viewingUser)) { error('Аккаунт изменился. Откройте новую сделку.'); return; }
    var mag = Number($('magnitudeInput').value.replace(',', '.'));
    var risk = Number($('riskPercentInput').value.replace(',', '.'));
    if (!$('magnitudeInput').value || !Number.isFinite(mag) || mag < 0 || !$('riskPercentInput').value || !Number.isFinite(risk) || risk < 0) { error('Укажите корректные RR и Risk %.'); return; }
    var open = getDateTimeInputValue($('openInput')), close = getDateTimeInputValue($('closeInput'));
    if (!open || !close || open > currentLocalDateTimeKey() || close > currentLocalDateTimeKey()) { error('Дата сделки не может быть в будущем.'); return; }
    if (!validateTradeDateOrder(open, close)) return;
    var user = viewingUser, generation = tjDataGeneration;
    var record = { id: pendingTrade ? pendingTrade.id : Date.now().toString() + Math.random().toString(36).slice(2, 8),
      asset: $('assetInput').value, direction: isLong ? 'LONG' : 'SHORT', openDT: open, closeDT: close,
      r: isWin ? mag : -mag, riskPercent: risk, chart: currentScreenshot, _images: window.TJMedia?TJMedia.snapshot():(currentScreenshot?[currentScreenshot]:[]), uid: owner.uid, notes: $('syterTradeNotes').value.trim() };
    applyTradeModel(record, selectedTradeModelId); pendingTrade = record;
    saving = true; form.inert = true; $('tradeModalSubmitBtn').disabled = true;
    status.textContent = 'Сохранение на сервер…';
    try {
      var ok = await remoteSaveTrade(record, null, true);
      if (user !== viewingUser || generation !== tjDataGeneration) return;
      if (!ok) { error('Сделка не сохранена. Черновик оставлен — проверьте соединение и повторите.'); status.textContent = ''; return; }
      if (!trades.some(function (t) { return t.id === record.id; })) trades.push(record);
      invalidateTradeNumbers(); pendingTrade = null;
      $('magnitudeInput').value = ''; $('syterTradeNotes').value = '';
      currentScreenshot = null; imageRevision++; if(window.TJMedia)TJMedia.reset();
      $('screenshotInput').value = ''; $('screenshotPreview').src = '';
      $('screenshotPreviewWrap').style.display = 'none'; $('screenshotFileName').textContent = 'No file chosen';
      if (mini) { openModal(null); managedDraft = true; draftOwner = user; }
      else closeModal();
      render(); status.textContent = 'Сделка сохранена ✓';
    } catch (err) { if (user === viewingUser && generation === tjDataGeneration) { error('Не удалось сохранить сделку. Черновик оставлен для повтора.'); status.textContent = ''; } }
    finally { saving = false; form.inert = false; $('tradeModalSubmitBtn').disabled = imageBusy; drainCapture(); }
  }, true);
  document.addEventListener('tj:images-changed',function(){$('tradeModalSubmitBtn').disabled=saving||TJMedia.busy;});
  api.miniReady();
})();
