'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

// -- Storage keys (must match background.js + content.js) --
const KEYS = {
  enabled:       'skipEnabled',
  skipMode:      'skipMode',
  skipIntro:     'skipIntro',
  skipRecap:     'skipRecap',
  skipOutro:     'skipOutro',
  resumePlay:    'resumePlayback',
  autoNext:      'autoNextEpisode',
  playRate:      'playbackSpeed',
  statsSkips:    'statsSkipsToday',
  statsDate:     'statsDate',
  statsTotalSkips: 'statsTotalSkips',
  statsTotalTime:  'statsTotalTimeSaved',
  stats:         'skipstream_stats',
};

const $ = id => document.getElementById(id);

// -- DOM refs --
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

// -- Version badge --
const manifest = br.runtime.getManifest();
versionBadge.textContent = 'v' + manifest.version;

// -- Active tab domain detection --
async function detectDomain() {
  try {
    const [tab] = await br.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    const url = new URL(tab.url);
    if (!url.hostname || url.protocol === 'chrome:' || url.protocol === 'about:' || url.protocol === 'moz-extension:') {
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

// -- Skip mode badge helper --
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

// -- Child toggle disabled state --
function applyChildState(enabled) {
  [rowIntro, rowRecap, rowOutro].forEach(r => {
    r.classList.toggle('disabled', !enabled);
  });
}

// -- Master sub-label --
function applyMasterSub(enabled) {
  masterSub.textContent = enabled ? 'Extension is active' : 'Extension is paused';
}

// -- Stats display --
function fmtTime(seconds) {
  if (!seconds || seconds < 60) return (seconds || 0) + 's';
  const m = Math.floor(seconds / 60);
  return m + 'm';
}

function applyStats(data) {
  const stats = data[KEYS.stats] || {};
  const today = new Date().toDateString();
  const skipsToday = stats.statsDate === today ? (stats.skipsToday || 0) : 0;
  statSkips.textContent = skipsToday;
  const totalTime = stats.timeSavedSec || 0;
  statTime.textContent = fmtTime(totalTime);
}

// -- Load all state from storage --
async function loadState() {
  const data = await br.storage.local.get(Object.values(KEYS));
  const enabled = data[KEYS.enabled] !== false;
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

// -- Save helper --
function save(obj) {
  br.storage.local.set(obj);
}

// -- Master toggle --
masterToggle.addEventListener('change', () => {
  const enabled = masterToggle.checked;
  save({ [KEYS.enabled]: enabled });
  applyMasterSub(enabled);
  applyChildState(enabled);
  br.storage.local.get(KEYS.skipMode, d => {
    applyMode(d[KEYS.skipMode] || 'auto-all', enabled);
  });
});

// -- Granular segment toggles --
skipIntro.addEventListener('change', () => save({ [KEYS.skipIntro]: skipIntro.checked }));
skipRecap.addEventListener('change', () => save({ [KEYS.skipRecap]: skipRecap.checked }));
skipOutro.addEventListener('change', () => save({ [KEYS.skipOutro]: skipOutro.checked }));

// -- Action bar buttons --
// FIX: use tabs.create instead of openOptionsPage to avoid about:addons in Firefox
settingsBtn.addEventListener('click', () => {
  br.tabs.create({ url: br.runtime.getURL('options.html') });
});

historyBtn.addEventListener('click', () => {
  br.tabs.create({ url: br.runtime.getURL('options.html') + '#history' });
});

statsBtn.addEventListener('click', () => {
  br.tabs.create({ url: br.runtime.getURL('options.html') + '#stats' });
});

// -- Live stats update --
br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEYS.stats]) return;
  br.storage.local.get([KEYS.stats]).then(d => applyStats(d)).catch(() => {});
});

// -- Init --
detectDomain();
loadState();
