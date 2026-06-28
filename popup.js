'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const KEYS = {
  enabled:    'skipEnabled',
  skipMode:   'skipMode',
  skipIntro:  'skipIntro',
  skipRecap:  'skipRecap',
  skipOutro:  'skipOutro',
  resumePlay: 'resumePlayback',
  autoNext:   'autoNextEpisode',
  playRate:   'playbackSpeed',
  stats:      'skipstream_stats',
  theme:      'skipstream_theme',
};

const $ = id => document.getElementById(id);

// -- Version --
$('versionBadge').textContent = 'v' + br.runtime.getManifest().version;

// -- Theme --
let currentTheme = '';

function applyTheme(t) {
  document.body.classList.remove('theme-light', 'theme-dark');
  if (t === 'light') document.body.classList.add('theme-light');
  if (t === 'dark')  document.body.classList.add('theme-dark');
  const isDark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const sun  = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun)  sun.style.display  = isDark ? 'block' : 'none';
  if (moon) moon.style.display = isDark ? 'none'  : 'block';
}

$('themeBtn').addEventListener('click', () => {
  currentTheme = currentTheme === '' ? 'light' : currentTheme === 'light' ? 'dark' : '';
  applyTheme(currentTheme);
  br.storage.local.set({ [KEYS.theme]: currentTheme });
});

// -- Tabs --
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('page-hidden', p.id !== 'page-' + tab.dataset.tab));
    if (tab.dataset.tab === 'skip') loadSkipPage();
  });
});

// -- Domain --
async function detectDomain() {
  try {
    const [tab] = await br.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (!url.hostname || ['chrome:', 'about:', 'moz-extension:'].includes(url.protocol)) {
      $('domainLabel').textContent = 'No active video tab'; return;
    }
    $('domainLabel').textContent = 'Active on: ' + url.hostname.replace(/^www\./, '');
    $('domainDot').classList.add('active');
  } catch (_) { $('domainLabel').textContent = 'No active video tab'; }
}

// -- Mode badge --
const MODE_LABELS = { off:'Disabled', prompt:'Prompt', 'auto-intro':'Auto Intros', 'auto-recap':'Auto Recaps', 'auto-outro':'Auto Outros', 'auto-all':'Auto All' };

function applyMode(mode, enabled) {
  $('modeBadge').textContent = MODE_LABELS[mode] || 'Disabled';
  $('modeBadge').className = (!enabled || mode === 'off') ? 'mode-badge off' : 'mode-badge';
}

function applyChildState(enabled) {
  ['rowIntro','rowRecap','rowOutro'].forEach(id => $(id)?.classList.toggle('disabled', !enabled));
}

// -- Stats --
function fmtTime(s) {
  if (!s || s < 60) return (s || 0) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return (s / 3600).toFixed(1) + 'h';
}

function applyStats(data) {
  const st = data[KEYS.stats] || {};
  const today = new Date().toDateString();
  $('statSkips').textContent = st.statsDate === today ? (st.skipsToday || 0) : 0;
  $('statTime').textContent  = fmtTime(st.timeSavedSec || 0);
}

// -- Load status page --
async function loadState() {
  const data = await br.storage.local.get(Object.values(KEYS));
  const enabled = data[KEYS.enabled] !== false;
  const mode    = data[KEYS.skipMode] || 'auto-all';
  currentTheme  = data[KEYS.theme]    || '';
  applyTheme(currentTheme);
  $('masterToggle').checked = enabled;
  $('skipIntro').checked    = data[KEYS.skipIntro] !== false;
  $('skipRecap').checked    = data[KEYS.skipRecap] !== false;
  $('skipOutro').checked    = data[KEYS.skipOutro] !== false;
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';
  applyMode(mode, enabled);
  applyChildState(enabled);
  applyStats(data);
}

// -- Load skip settings page --
let popupMode = 'auto-all';
let popupRate = 1;

async function loadSkipPage() {
  const data = await br.storage.local.get([
    KEYS.skipMode, KEYS.playRate,
    KEYS.skipIntro, KEYS.skipRecap, KEYS.skipOutro,
    KEYS.resumePlay, KEYS.autoNext,
  ]);
  popupMode = data[KEYS.skipMode] || 'auto-all';
  popupRate = parseFloat(data[KEYS.playRate]) || 1;

  document.querySelectorAll('.smode-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.mode === popupMode));
  document.querySelectorAll('.speed-chip').forEach(c =>
    c.classList.toggle('selected', parseFloat(c.dataset.rate) === popupRate));

  const chk = (id, key, def = true) => { const el = $(id); if (el) el.checked = data[key] !== false; };
  chk('p-skipIntro',       KEYS.skipIntro);
  chk('p-skipRecap',       KEYS.skipRecap);
  chk('p-skipOutro',       KEYS.skipOutro);
  chk('p-resumePlayback',  KEYS.resumePlay);
  chk('p-autoNextEpisode', KEYS.autoNext);
}

document.querySelectorAll('.smode-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    popupMode = chip.dataset.mode;
    document.querySelectorAll('.smode-chip').forEach(c => c.classList.toggle('selected', c === chip));
  });
});

document.querySelectorAll('.speed-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    popupRate = parseFloat(chip.dataset.rate);
    document.querySelectorAll('.speed-chip').forEach(c => c.classList.toggle('selected', c === chip));
  });
});

$('saveSkipBtn').addEventListener('click', async () => {
  await br.storage.local.set({
    [KEYS.skipMode]:  popupMode,
    [KEYS.playRate]:  popupRate,
    [KEYS.skipIntro]: $('p-skipIntro')?.checked   ?? true,
    [KEYS.skipRecap]: $('p-skipRecap')?.checked   ?? true,
    [KEYS.skipOutro]: $('p-skipOutro')?.checked   ?? false,
    [KEYS.resumePlay]:$('p-resumePlayback')?.checked ?? true,
    [KEYS.autoNext]:  $('p-autoNextEpisode')?.checked ?? false,
  });
  // Sync status tab badges + toggles
  $('skipIntro').checked = $('p-skipIntro')?.checked;
  $('skipRecap').checked = $('p-skipRecap')?.checked;
  $('skipOutro').checked = $('p-skipOutro')?.checked;
  applyMode(popupMode, $('masterToggle').checked);
  const btn = $('saveSkipBtn');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save Settings'; }, 1800);
});

// -- Master toggle --
$('masterToggle').addEventListener('change', () => {
  const enabled = $('masterToggle').checked;
  br.storage.local.set({ [KEYS.enabled]: enabled });
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';
  applyChildState(enabled);
  br.storage.local.get([KEYS.skipMode]).then(d => applyMode(d[KEYS.skipMode] || 'auto-all', enabled));
});

// -- Segment toggles --
$('skipIntro').addEventListener('change', () => br.storage.local.set({ [KEYS.skipIntro]: $('skipIntro').checked }));
$('skipRecap').addEventListener('change', () => br.storage.local.set({ [KEYS.skipRecap]: $('skipRecap').checked }));
$('skipOutro').addEventListener('change', () => br.storage.local.set({ [KEYS.skipOutro]: $('skipOutro').checked }));

// -- Action bar --
$('settingsBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') }));
$('historyBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') + '#history' }));
$('statsBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') + '#stats' }));

// -- Subtitle file upload --
async function loadSubtitlePageState() {
  const s = await br.storage.local.get(['subtitle_override_srt', 'subtitle_language']);
  const hasFile = !!s.subtitle_override_srt;
  const subStatus = $('subStatus');
  if (subStatus) subStatus.textContent = hasFile ? 'Subtitle loaded ✓' : 'No subtitle loaded';
  const langSel = $('subLangSelect');
  if (langSel && s.subtitle_language) langSel.value = s.subtitle_language;
}

const subUploadBtn = $('subUploadBtn');
const subFileInput = $('subFileInput');
const subClearBtn  = $('subClearBtn');
const subLangSel   = $('subLangSelect');

if (subUploadBtn && subFileInput) {
  subUploadBtn.addEventListener('click', () => { subFileInput.value = ''; subFileInput.click(); });
  subFileInput.addEventListener('change', async () => {
    const file = subFileInput.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['srt','vtt'].includes(ext)) { alert('Only .srt or .vtt files supported.'); return; }
    const text = await file.text();
    await br.storage.local.set({ subtitle_override_srt: text });
    const subStatus = $('subStatus');
    if (subStatus) subStatus.textContent = '✓ ' + file.name;
  });
}

if (subClearBtn) {
  subClearBtn.addEventListener('click', async () => {
    await br.storage.local.remove('subtitle_override_srt');
    const subStatus = $('subStatus');
    if (subStatus) subStatus.textContent = 'No subtitle loaded';
  });
}

if (subLangSel) {
  subLangSel.addEventListener('change', async () => {
    await br.storage.local.set({ subtitle_language: subLangSel.value });
  });
}

// Extend loadSkipPage to also init subtitle state
const _origLoadSkipPage = loadSkipPage;
async function loadSkipPage() {
  await _origLoadSkipPage();
  await loadSubtitlePageState();
}

// -- Live stats --
br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEYS.stats]) return;
  br.storage.local.get([KEYS.stats]).then(d => applyStats(d)).catch(() => {});
});

// -- Init --
detectDomain();
loadState();