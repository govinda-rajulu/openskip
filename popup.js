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
  subLang:    'subtitle_language',
  subSrt:     'subtitle_override_srt',
};

const $ = id => document.getElementById(id);

// Version
$('versionBadge').textContent = 'v' + br.runtime.getManifest().version;

// -- Theme: simple light/dark toggle, no system intermediate state --
let currentTheme = 'dark';

function applyTheme(t) {
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(t === 'light' ? 'theme-light' : 'theme-dark');
  const isDark = t !== 'light';
  const sun  = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun)  sun.style.display  = isDark ? 'block' : 'none';
  if (moon) moon.style.display = isDark ? 'none'  : 'block';
}

$('themeBtn').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  br.storage.local.set({ [KEYS.theme]: currentTheme });
});

// -- Tabs --
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    const targetId = 'page-' + tab.dataset.tab;
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('page-hidden', p.id !== targetId));
  });
});

// -- Domain --
async function detectDomain() {
  try {
    const [tab] = await br.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (!url.hostname || ['chrome:', 'about:', 'moz-extension:', 'chrome-extension:'].includes(url.protocol)) {
      $('domainLabel').textContent = 'No active video tab'; return;
    }
    $('domainLabel').textContent = url.hostname.replace(/^www\./, '');
    $('domainDot').classList.add('active');
  } catch { $('domainLabel').textContent = 'No active video tab'; }
}

// -- Mode labels --
const MODE_LABELS = {
  off: 'Disabled', prompt: 'Prompt',
  'auto-intro': 'Auto Intros', 'auto-recap': 'Auto Recaps',
  'auto-outro': 'Auto Outros', 'auto-all': 'Auto All',
};

// -- Mode <-> Toggle bidirectional mapping --
const MODE_TO_SEGS = {
  'off':        { i: false, r: false, o: false },
  'prompt':     { i: false, r: false, o: false },
  'auto-intro': { i: true,  r: false, o: false },
  'auto-recap': { i: false, r: true,  o: false },
  'auto-outro': { i: false, r: false, o: true  },
  'auto-all':   { i: true,  r: true,  o: true  },
};

function inferMode(i, r, o) {
  if (!i && !r && !o) return 'off';
  if (i  && !r && !o) return 'auto-intro';
  if (!i && r  && !o) return 'auto-recap';
  if (!i && !r && o)  return 'auto-outro';
  return 'auto-all';
}

let popupMode = 'auto-all';
let popupRate = 1;

function applyModeToUI(mode, enabled) {
  popupMode = mode;
  // Chips
  document.querySelectorAll('.smode-chip').forEach(c => c.classList.toggle('selected', c.dataset.mode === mode));
  // Segment toggles
  const seg = MODE_TO_SEGS[mode] || { i: true, r: true, o: true };
  if ($('skipIntro')) $('skipIntro').checked = seg.i;
  if ($('skipRecap')) $('skipRecap').checked = seg.r;
  if ($('skipOutro')) $('skipOutro').checked = seg.o;
  // Status badge
  const badge = $('modeBadge');
  if (badge) {
    badge.textContent = MODE_LABELS[mode] || mode;
    badge.className = (!enabled || mode === 'off') ? 'mode-badge off' : 'mode-badge';
  }
}

// Mode chip click -> update toggles
document.querySelectorAll('.smode-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    applyModeToUI(chip.dataset.mode, $('masterToggle').checked);
    // Persist immediately
    const seg = MODE_TO_SEGS[chip.dataset.mode] || { i: true, r: true, o: true };
    br.storage.local.set({
      [KEYS.skipMode]:  chip.dataset.mode,
      [KEYS.skipIntro]: seg.i,
      [KEYS.skipRecap]: seg.r,
      [KEYS.skipOutro]: seg.o,
    });
  });
});

// Segment toggle click -> infer mode, update chips
['skipIntro', 'skipRecap', 'skipOutro'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    const i = $('skipIntro')?.checked ?? true;
    const r = $('skipRecap')?.checked ?? true;
    const o = $('skipOutro')?.checked ?? false;
    const inferred = inferMode(i, r, o);
    popupMode = inferred;
    document.querySelectorAll('.smode-chip').forEach(c => c.classList.toggle('selected', c.dataset.mode === inferred));
    const badge = $('modeBadge');
    if (badge) {
      badge.textContent = MODE_LABELS[inferred] || inferred;
      badge.className = ($('masterToggle').checked && inferred !== 'off') ? 'mode-badge' : 'mode-badge off';
    }
    // Persist immediately
    br.storage.local.set({
      [KEYS.skipMode]:  inferred,
      [KEYS.skipIntro]: i,
      [KEYS.skipRecap]: r,
      [KEYS.skipOutro]: o,
    });
  });
});

// Speed chips
document.querySelectorAll('.speed-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    popupRate = parseFloat(chip.dataset.rate);
    document.querySelectorAll('.speed-chip').forEach(c => c.classList.toggle('selected', c === chip));
  });
});

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

// -- Master toggle --
$('masterToggle').addEventListener('change', () => {
  const enabled = $('masterToggle').checked;
  br.storage.local.set({ [KEYS.enabled]: enabled });
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';
  applyModeToUI(popupMode, enabled);
});

// -- Save all settings --
$('saveSettingsBtn').addEventListener('click', async () => {
  const seg = MODE_TO_SEGS[popupMode] || { i: true, r: true, o: true };
  await br.storage.local.set({
    [KEYS.skipMode]:  popupMode,
    [KEYS.playRate]:  popupRate,
    [KEYS.skipIntro]: $('skipIntro')?.checked ?? seg.i,
    [KEYS.skipRecap]: $('skipRecap')?.checked ?? seg.r,
    [KEYS.skipOutro]: $('skipOutro')?.checked ?? seg.o,
    [KEYS.resumePlay]:$('resumePlayback')?.checked ?? true,
    [KEYS.autoNext]:  $('autoNextEpisode')?.checked ?? false,
  });
  const btn = $('saveSettingsBtn');
  btn.textContent = 'Saved!';
  setTimeout(() => { btn.textContent = 'Save Settings'; }, 1800);
});

// -- Load all state --
async function loadState() {
  const data = await br.storage.local.get(Object.values(KEYS));
  const enabled  = data[KEYS.enabled] !== false;
  const mode     = data[KEYS.skipMode] || 'auto-all';
  currentTheme   = data[KEYS.theme] || 'dark';

  applyTheme(currentTheme);
  $('masterToggle').checked = enabled;
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';

  popupRate = parseFloat(data[KEYS.playRate]) || 1;
  document.querySelectorAll('.speed-chip').forEach(c =>
    c.classList.toggle('selected', parseFloat(c.dataset.rate) === popupRate));

  if ($('resumePlayback'))  $('resumePlayback').checked  = data[KEYS.resumePlay] !== false;
  if ($('autoNextEpisode')) $('autoNextEpisode').checked = !!data[KEYS.autoNext];

  applyModeToUI(mode, enabled);
  applyStats(data);

  // Subtitle state
  const subStatus = $('subStatus');
  if (subStatus) subStatus.textContent = data[KEYS.subSrt] ? 'Subtitle loaded' : 'No subtitle loaded';
  if ($('subLangSelect') && data[KEYS.subLang]) $('subLangSelect').value = data[KEYS.subLang];
}

// -- Subtitle handlers --
const subUploadBtn = $('subUploadBtn');
const subFileInput = $('subFileInput');

if (subUploadBtn && subFileInput) {
  subUploadBtn.addEventListener('click', () => { subFileInput.value = ''; subFileInput.click(); });
  subFileInput.addEventListener('change', async () => {
    const file = subFileInput.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['srt','vtt'].includes(ext)) { alert('Only .srt or .vtt files.'); return; }
    const text = await file.text();
    await br.storage.local.set({ [KEYS.subSrt]: text });
    const s = $('subStatus');
    if (s) s.textContent = file.name;
  });
}

$('subClearBtn')?.addEventListener('click', async () => {
  await br.storage.local.remove(KEYS.subSrt);
  const s = $('subStatus');
  if (s) s.textContent = 'No subtitle loaded';
});

$('subLangSelect')?.addEventListener('change', async () => {
  await br.storage.local.set({ [KEYS.subLang]: $('subLangSelect').value });
});

// -- Action bar --
$('settingsBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') }));
$('historyBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') + '#history' }));
$('statsBtn').addEventListener('click', () => br.tabs.create({ url: br.runtime.getURL('options.html') + '#stats' }));

// -- Live stats --
br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEYS.stats]) return;
  br.storage.local.get([KEYS.stats]).then(d => applyStats(d)).catch(() => {});
});

// -- Init --
detectDomain();
loadState();