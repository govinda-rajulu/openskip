/* SkipStream - popup v1.11.0 */
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
// Last mode that was not 'off', so switching the master toggle off and on
// restores the user's mode instead of silently becoming Auto All.
let lastActiveMode = null;
br.storage.local.get('skipstream_last_mode').then(s => { lastActiveMode = s.skipstream_last_mode || lastActiveMode; }).catch(() => {});
let popupRate = 1;

function applyModeToUI(mode, enabled) {
  popupMode = mode;
  if (mode && mode !== 'off') lastActiveMode = mode;
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

// Segment toggle click -> infer mode, update chips
['skipIntro', 'skipRecap', 'skipOutro'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    const i = $('skipIntro')?.checked ?? true;
    const r = $('skipRecap')?.checked ?? true;
    const o = $('skipOutro')?.checked ?? false;
    const inferred = inferMode(i, r, o);
    popupMode = inferred;
    document.querySelectorAll('.smode-chip').forEach(c => {
      const isSel = c.dataset.mode === inferred;
      c.classList.toggle('selected', isSel);
      c.setAttribute('aria-checked', isSel ? 'true' : 'false');
    });
    const badge = $('modeBadge');
    if (badge) {
      badge.textContent = MODE_LABELS[inferred] || inferred;
      badge.className = (!!$('masterToggle')?.checked && inferred !== 'off') ? 'mode-badge' : 'mode-badge off';
    }
    // Persist immediately
    br.storage.local.set({
      [KEYS.skipMode]:  inferred,
      [KEYS.enabled]:   inferred !== 'off',
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
    document.querySelectorAll('.speed-chip').forEach(c => {
      const isSel = c === chip;
      c.classList.toggle('selected', isSel);
      c.setAttribute('aria-checked', isSel ? 'true' : 'false');
    });
    br.storage.local.set({ [KEYS.playRate]: popupRate });
  });
});
['resumePlayback', 'autoNextEpisode'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    br.storage.local.set({
      [KEYS.resumePlay]: $('resumePlayback')?.checked ?? true,
      [KEYS.autoNext]:   $('autoNextEpisode')?.checked ?? false,
    });
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
  const todayTime = (st.statsDate === today) ? (st.timeSavedToday || 0) : 0;
  $('statTime').textContent = fmtTime(todayTime);
}

// -- Master toggle --
$('masterToggle')?.addEventListener('change', () => {
  const enabled = !!$('masterToggle')?.checked;
  const nextMode = enabled ? (popupMode !== 'off' ? popupMode : (lastActiveMode || 'auto-all')) : 'off';
  if (!enabled && popupMode !== 'off') br.storage.local.set({ skipstream_last_mode: popupMode }).catch(() => {});
  const nextSeg = MODE_TO_SEGS[nextMode] || { i: true, r: true, o: true };
  br.storage.local.set({
    [KEYS.enabled]: enabled,
    [KEYS.skipMode]: nextMode,
    [KEYS.skipIntro]: nextSeg.i,
    [KEYS.skipRecap]: nextSeg.r,
    [KEYS.skipOutro]: nextSeg.o,
  });
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';
  applyModeToUI(nextMode, enabled);
});



// -- Load all state --
async function loadState() {
  const data = await br.storage.local.get(Object.values(KEYS));
  const enabled  = data[KEYS.enabled] !== false;
  const mode     = data[KEYS.skipMode] || 'auto-all';
  currentTheme   = data[KEYS.theme] || ssSystemMode();
  currentSeedHex = data[KEYS.seedColor] || '#57A860';

  applyTheme(currentTheme);
  if (window.applyThemeFromSeed) applyThemeFromSeed(data[KEYS.seedColor] || '#57A860', currentTheme);
  const mtEl = $('masterToggle');
  if (mtEl) mtEl.checked = enabled;
  $('masterSub').textContent = enabled ? 'Extension is active' : 'Extension is paused';

  popupRate = parseFloat(data[KEYS.playRate]) || 1;
  document.querySelectorAll('.speed-chip').forEach(c => {
    const isSel = parseFloat(c.dataset.rate) === popupRate;
    c.classList.toggle('selected', isSel);
    c.setAttribute('aria-checked', isSel ? 'true' : 'false');
  });

  if ($('resumePlayback'))  $('resumePlayback').checked  = data[KEYS.resumePlay] !== false;
  if ($('autoNextEpisode')) $('autoNextEpisode').checked = !!data[KEYS.autoNext];

  applyModeToUI(mode, enabled);
  applyStats(data);

  // Subtitle state
  const subStatus = $('subStatus');
  if (subStatus && data[KEYS.subSrt]) subStatus.textContent = 'Your subtitle file is loaded';
  if ($('subLangSelect') && data[KEYS.subLang]) $('subLangSelect').value = data[KEYS.subLang];
}

// -- Subtitle handlers --
// No file picker here: Firefox closes the popup the moment a file dialog opens
// (Mozilla bug 1378527). Your own file goes in through the CC button on the video.
const SUB_REASONS = {
  no_player:  'No video player found on this tab. Start the video, then try again.',
  no_id:      'Could not identify this video. A TMDB key in Options lets SkipStream match titles, or load your own file with the CC button on the video.',
  youtube:    'YouTube videos are not films or episodes, so OpenSubtitles has nothing to match. Load your own file with the CC button on the video.',
  no_results: 'OpenSubtitles has no subtitles for this video in your language or English.',
  navigated:  'The page changed while searching. Try again.',
  unreadable: 'A subtitle file came back but had no readable lines.',
};

function subReason(r) {
  if (!r) return SUB_REASONS.no_player;
  if (r.ok) return 'Loaded ' + r.count + ' lines' + (r.name ? ' from ' + r.name : '');
  return SUB_REASONS[r.reason] || ('OpenSubtitles said: ' + String(r.reason || 'no answer').slice(0, 120));
}

$('subFetchBtn')?.addEventListener('click', async () => {
  const btn = $('subFetchBtn'); const s = $('subStatus');
  if (btn) btn.disabled = true;
  if (s) s.textContent = 'Searching OpenSubtitles...';
  let r = null;
  try {
    const [tab] = await br.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) r = await br.tabs.sendMessage(tab.id, { type: 'SUBS_FETCH_NOW' });
  } catch (_) { r = null; }
  if (s) s.textContent = subReason(r);
  if (btn) btn.disabled = false;
});

// "Check this page": every frame reports what it sees (background runPageCheck).
function diagText(r) {
  if (!r || !r.ok) return 'Could not check this page. Reload it and try again.';
  const f = Array.isArray(r.frames) ? r.frames : [];
  if (!f.length) return 'SkipStream is not running on this page. Browser pages and the add-ons store are off limits; on other sites, reload the page.';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const lines = f.map(x => (x.top ? 'Page ' : 'Frame ') + x.frame + ': ' + plural(x.videos, 'video')
    + (x.hidden ? ', ' + x.hidden + ' inside a player' : '')
    + (x.blankFrames ? ', ' + plural(x.blankFrames, 'blank frame') : '')
    + (x.attached ? ', in use' : ''));
  const head = f.some(x => x.attached) ? 'SkipStream is watching a video here.'
    : 'No video in use yet. Start the video, then check again.';
  return head + '\n' + lines.join('\n');
}

$('diagBtn')?.addEventListener('click', async () => {
  const btn = $('diagBtn'); const s = $('diagStatus');
  if (btn) btn.disabled = true;
  if (s) s.textContent = 'Checking every frame...';
  let r = null;
  try {
    const [tab] = await br.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) r = await br.runtime.sendMessage({ type: 'SS_DIAG_RUN', tabId: tab.id });
  } catch (_) { r = null; }
  if (s) s.textContent = diagText(r);
  if (btn) btn.disabled = false;
});

$('subClearBtn')?.addEventListener('click', async () => {
  await br.storage.local.remove(KEYS.subSrt);
  const s = $('subStatus');
  if (s) s.textContent = 'Subtitles removed. Your own .srt / .vtt: click CC on the video';
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

// ── Easter egg: 5-click version badge ──────────────────────────────────────────
(() => {
  let clickCount = 0;
  let lastClickTime = 0;
  let easterEggTriggered = false;
  const vBadge = $('versionBadge');
  if (!vBadge) return;
  
  vBadge.style.cursor = 'pointer';
  vBadge.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastClickTime > 1000) clickCount = 0; // Reset if >1sec between clicks
    clickCount++;
    lastClickTime = now;
    
    if (clickCount === 5 && !easterEggTriggered) {
      easterEggTriggered = true;
      const overlay = document.createElement('div');
      overlay.className = 'easter-egg-overlay';
      overlay.textContent = 'Made with ❤️ for you';
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 3800); // Remove after animation
    }
  });
})();

// -- Theme color picker --
(() => {
  const picker = document.getElementById('seedColorPicker');
  if (!picker) return;
  const br2 = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  br2.storage.local.get([KEYS.seedColor]).then(data => {
    if (data[KEYS.seedColor]) picker.value = data[KEYS.seedColor];
  }).catch(() => {});

  picker.addEventListener('input', () => {
    currentSeedHex = picker.value;
    br2.storage.local.set({ [KEYS.seedColor]: picker.value });
    if (window.applyThemeFromSeed) applyThemeFromSeed(picker.value, currentTheme);
  });

  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const color = dot.dataset.color;
      picker.value = color;
      currentSeedHex = color;
      br2.storage.local.set({ [KEYS.seedColor]: color });
      if (window.applyThemeFromSeed) applyThemeFromSeed(color, currentTheme);
    });
  });
})();
