/* SkipStream - popup v1.10.0 */
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
  seedColor:  'skipstream_seed_color',
};

const $ = id => document.getElementById(id);

function ssSystemMode() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch (e) { return 'dark'; }
}


// Version
const verBadgeEl = $('versionBadge');
if (verBadgeEl) verBadgeEl.textContent = 'v' + br.runtime.getManifest().version;

// -- Theme: simple light/dark toggle, no system intermediate state --
let currentTheme = ssSystemMode();
let currentSeedHex = '#57A860';

function applyTheme(t) {
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(t === 'light' ? 'theme-light' : 'theme-dark');
  const isDark = t !== 'light';
  const sun  = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun)  sun.style.display  = isDark ? 'none' : 'block';
  if (moon) moon.style.display = isDark ? 'block' : 'none';
}

$('themeBtn')?.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  br.storage.local.set({ [KEYS.theme]: currentTheme });
  if (window.applyThemeFromSeed) applyThemeFromSeed(currentSeedHex, currentTheme);
});

// -- Tabs --
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    document.body.dataset.tab = tab.dataset.tab;
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
  if (!i && !r && !o) return 'prompt';
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
  document.querySelectorAll('.smode-chip').forEach(c => {
    const isSel = c.dataset.mode === mode;
    c.classList.toggle('selected', isSel);
    c.setAttribute('aria-checked', isSel ? 'true' : 'false');
  });
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
    applyModeToUI(chip.dataset.mode, !!$('masterToggle')?.checked);
    // Persist immediately
    const seg = MODE_TO_SEGS[chip.dataset.mode] || { i: true, r: true, o: true };
    br.storage.local.set({
      [KEYS.skipMode]:  chip.dataset.mode,
      [KEYS.enabled]: chip.dataset.mode !== 'off',
      [KEYS.skipIntro]: seg.i,
      [KEYS.skipRecap]: seg.r,
      [KEYS.skipOutro]: seg.o,
    });
    const mt = $('masterToggle');
    if (mt) mt.checked = chip.dataset.mode !== 'off';
    const ms = $('masterSub');
    if (ms) ms.textContent = chip.dataset.mode !== 'off' ? 'Extension is active' : 'Extension is paused';
  });
});

// Segment toggle event listeners removed - mode chips handle persistence

// Speed chips