'use strict';
const bridge = window.syterLifecycle;
const el = id => document.getElementById(id);
let primaryAction = '', state;
function render(s) {
  state = s;
  const install = s.mode === 'install';
  const titles = { welcome: 'Your journal, on desktop.', available: 'A new version is ready.', checking: 'Checking for updates…', verifying: 'Preparing SYTER…', installing: 'Installing SYTER…', downloading: 'Downloading update…', ready: install ? 'SYTER is installed.' : 'Ready to restart.', restarting: 'Restarting SYTER…', launching: 'Opening SYTER…', error: 'Let’s try that again.' };
  el('eyebrow').textContent = install ? 'DESKTOP INSTALLER' : 'SYTER UPDATE';
  el('title').textContent = titles[s.phase] || 'SYTER';
  el('subtitle').textContent = install ? (s.phase === 'ready' ? 'Everything is ready. Open your journal.' : 'The same SYTER. A dedicated desktop app.') : (s.phase === 'ready' ? 'Restart to finish installing the update.' : 'Your journal and settings stay with you.');
  el('version-label').textContent = install ? 'Version' : 'Version update';
  el('version').textContent = install ? s.version : `${s.currentVersion} → ${s.version || '…'}`;
  el('notes').hidden = !s.notes; el('notes-text').textContent = s.notes || '';
  const busy = ['verifying','installing','downloading','restarting','launching','checking'].includes(s.phase);
  el('progress-area').hidden = !busy;
  el('stage').textContent = ({verifying:'Verifying installer',installing:'Installing files',downloading:'Download',restarting:'Restart and install',launching:'Launch',checking:'Checking'})[s.phase] || '';
  if (Number.isFinite(s.percent)) el('progress').value = s.percent; else el('progress').removeAttribute('value');
  el('percent').textContent = Number.isFinite(s.percent) ? `${Math.floor(s.percent)}%` : '';
  const mb = n => (n / 1048576).toFixed(1);
  el('transfer').textContent = s.phase === 'downloading' && s.total > 0 ? `${mb(s.transferred)} / ${mb(s.total)} MB` : '';
  el('error').hidden = s.phase !== 'error'; el('error').textContent = s.error || '';
  primaryAction = s.phase === 'welcome' ? 'install' : s.phase === 'available' ? 'download' : s.phase === 'ready' ? (install ? 'launch' : 'restart') : s.phase === 'error' ? 'retry' : '';
  el('primary').textContent = ({install:'Install SYTER →',download:'Update now →',launch:'Launch SYTER →',restart:'Restart and install →',retry:'Try again →'})[primaryAction] || 'Please wait…';
  el('primary').disabled = !primaryAction;
  el('secondary').hidden = install || busy; el('secondary').textContent = 'Later';
  el('close').disabled = install && busy || s.phase === 'restarting';
  el('footnote').textContent = install ? 'Trading Journal · Windows' : (s.phase === 'downloading' ? 'You can continue using SYTER.' : 'SYTER Desktop');
}
el('primary').addEventListener('click', () => { if (primaryAction) bridge?.action(primaryAction); });
el('secondary').addEventListener('click', () => bridge?.action('later'));
el('close').addEventListener('click', () => bridge?.action('close'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el('close').disabled) bridge?.action('close'); });
if (bridge) { bridge.subscribe(render); render(bridge.snapshot()); } else { render({mode:'install',phase:'welcome',version:'1.3.1'}); }
