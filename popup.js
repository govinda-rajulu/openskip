'use strict';

// ── Storage key map (must match background.js + content.js exactly) ──
const KEYS = {
  enabled:       'skipEnabled',        // master toggle
  skipMode:      'skipMode',           // 'off'|'prompt'|'auto-intro'|'auto-recap'|'auto-outro'|'auto-all'
  skipIntro:     'skipIntro',          // bool - granular
  skipRecap:     'skipRecap',
  skipOutro:     'skipOutro',
  resumePlay:    'resumePlayback',
  autoNext:      'autoNextEpisode',
  playRate:      'playbackRate',
  statsSkips:    'statsSkipsToday',
  statsDate:     'statsDate',
  statsTotalSkips: 'statsTotalSkips',
  statsTotalTime:  'statsTotalTimeSaved',
};

const $ = id => document.getElementById(id);

// ── DOM refs ──────────────────────────────────────────────────────────
const masterToggle = $('masterToggle');
const masterSub    = $('masterSub');
const domainDot    = $('domainDot');
const domainLabel  = $('domainLabel');
const versionBadge = $('versionBadge');
const modeBadge    = $('modeBadge');
const statSkips    = $('statSkips');
const statTime     = $('statTime');
const skipIntro    = $('skipIntro');
const skipRecap    = $('skipRecap');
const skipOutro    = $('skipOutro');
const rowIntro     = $('rowIntro');
const rowRecap     = $('rowRecap');
const rowOutro     = $('rowOutro');
const historyBtn   = $('historyBtn');
const statsBtn     = $('statsBtn');
const settingsBtn  = $('settingsBtn');

// ── Version badge ─────────────────────────────────────────────────────
const manifest = chrome.runtime.getManifest();
versionBadge.textContent = 'v' + manifest.version;

// ── Active tab domain detection ───────────────────────────────────────
async function detectDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    const url = new URL(tab.url);
    if (!url.hostname || url.protocol === 'chrome:' || url.protocol === 'about:') {
      domainLabel.textContent = 'No active video tab';
      domainDot.className = 'domain-dot';
      return;
    }
    const host = url.hostname.replace(/^www\./, '');
    domainLabel.textContent = 'Active on: ' + host;
    domainDot.classList.add('active');
  } catch (_) {
    domainLabel.textContent = 'No active video tab';
  }
}

// ── Skip mode badge helper ────────────────────────────────────────────
const MODE_LABELS = {
  'off':        'Disabled',
  'prompt':     'Prompt',
  'auto-intro': 'Auto Intros',
  'auto-recap': 'Auto Recaps',
  'auto-outro': 'Auto Outros',
  'auto-all':   'Auto All',
};

function applyMode(mode, enabled) {
  const label = MODE_LABELS[mode] || 'Disabled';
  modeBadge.textContent = label;
  if (!enabled || mode === 'off') {
    modeBadge.className = 'mode-badge off';
  } else {
    modeBadge.className = 'mode-badge';
  }
}

// ── Child toggle disabled state ───────────────────────────────────────
function applyChildState(enabled) {
  [rowIntro, rowRecap, rowOutro].forEach(r => {
    r.classList.toggle('disabled', !enabled);
  });
}

// ── Master sub-label ──────────────────────────────────────────────────
function applyMasterSub(enabled) {
  masterSub.textContent = enabled ? 'Extension is active' : 'Extension is paused';
}

// ── Stats display ─────────────────────────────────────────────────────
function fmtTime(seconds) {
  if (!seconds || seconds < 60) return (seconds || 0) + 's';
  const m = Math.floor(seconds / 60);
  return m + 'm';
}

function applyStats(data) {
  // Reset daily counter if date changed
  const today = new Date().toDateString();
  const skipsToday = data[KEYS.statsDate] === today
    ? (data[KEYS.statsSkips] || 0)
    : 0;
  statSkips.textContent = skipsToday;

  // Time saved: derive from total skips * avg segment ~90s, or use stored value
  const totalTime = data[KEYS.statsTotalTime] || 0;
  statTime.textContent = fmtTime(totalTime);
}

// ── Load all state from storage ───────────────────────────────────────
async function loadState() {
  const data = await chrome.storage.local.get(Object.values(KEYS));

  const enabled = data[KEYS.enabled] !== false; // default true
  const mode    = data[KEYS.skipMode] || 'auto-all';

  masterToggle.checked = enabled;
  skipIntro.checked    = data[KEYS.skipIntro] !== false;
  skipRecap.checked    = data[KEYS.skipRecap] !== false;
  skipOutro.checked    = data[KEYS.skipOutro] !== false;

  applyMasterSub(enabled);
  applyMode(mode, enabled);
  applyChildState(enabled);
  applyStats(data);
}

// ── Save helper ───────────────────────────────────────────────────────
function save(obj) {
  chrome.storage.local.set(obj);
}

// ── Master toggle ─────────────────────────────────────────────────────
masterToggle.addEventListener('change', () => {
  const enabled = masterToggle.checked;
  save({ [KEYS.enabled]: enabled });
  applyMasterSub(enabled);
  applyChildState(enabled);
  // Re-read mode to update badge correctly
  chrome.storage.local.get(KEYS.skipMode, d => {
    applyMode(d[KEYS.skipMode] || 'auto-all', enabled);
  });
});

// ── Granular segment toggles ──────────────────────────────────────────
skipIntro.addEventListener('change', () => save({ [KEYS.skipIntro]: skipIntro.checked }));
skipRecap.addEventListener('change', () => save({ [KEYS.skipRecap]: skipRecap.checked }));
skipOutro.addEventListener('change', () => save({ [KEYS.skipOutro]: skipOutro.checked }));

// ── Action bar buttons ────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

historyBtn.addEventListener('click', () => {
  // Open options page and signal history tab via URL hash
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#history' });
});

statsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#stats' });
});

// ── Init ──────────────────────────────────────────────────────────────
detectDomain();
loadState();