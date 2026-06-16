'use strict';

// -- Storage keys (must match background.js + content.js) --
const S = {
  supabaseUrl:        'supabaseUrl',
  supabaseAnonKey:    'supabaseAnonKey',
  introdbApiKey:      'introdbApiKey',
  tmdbApiKey:         'tmdbApiKey',
  animeSkipEnabled:   'animeSkipEnabled',
  animeSkipClientId:  'animeSkipClientId',
  animeSkipAuthToken: 'animeSkipAuthToken',
  skipMode:           'skipMode',
  skipIntro:          'skipIntro',
  skipRecap:          'skipRecap',
  skipOutro:          'skipOutro',
  resumePlayback:     'resumePlayback',
  autoNextEpisode:    'autoNextEpisode',
  playbackRate:       'playbackRate',
  siteRules:          'skipstream_site_rules',
  statsSkipsToday:    'statsSkipsToday',
  statsDate:          'statsDate',
  statsTotalSkips:    'statsTotalSkips',
  statsTotalTimeSaved:'statsTotalTimeSaved',
  statsSessions:      'statsSessions',
};

const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// -- Version badge --
const manifest = chrome.runtime.getManifest();
$('sidebarVer').textContent = 'v' + manifest.version;

// -- Sidebar nav --
const navItems = document.querySelectorAll('.nav-item[data-panel]');
const panels   = document.querySelectorAll('.panel');

function showPanel(id) {
  panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.panel === id));
  history.replaceState(null, '', '#' + id);
}

navItems.forEach(item => {
  item.addEventListener('click', () => showPanel(item.dataset.panel));
});

// Deep-link from popup (History / Stats buttons open options with #hash)
const initialHash = location.hash.replace('#', '');
if (initialHash && document.getElementById('panel-' + initialHash)) {
  showPanel(initialHash);
}

// -- Alert helpers --
function showAlert(el, type, msg) {
  if (!el) return;
  el.className = 'alert show ' + type;
  el.textContent = msg;
}
function hideAlert(el) {
  if (!el) return;
  el.className = 'alert';
  el.textContent = '';
}

// -- Status dot helpers --
function setDot(dotEl, state, msg, msgEl) {
  if (!dotEl) return;
  dotEl.className = 'status-dot ' + state;
  if (msgEl) {
    msgEl.className = 'status-msg' + (state === 'ok' || state === 'warn' || state === 'err' ? ' ' + state : '');
    msgEl.textContent = msg;
  }
}

function setNavDot(key, state) {
  const el = $('navDot' + key.charAt(0).toUpperCase() + key.slice(1));
  if (!el) return;
  el.className = 'nav-dot ' + (state === 'ok' ? 'ok' : state === 'err' ? 'err' : state === 'warn' ? 'warn' : state === 'checking' ? 'spin' : '');
}

// -- Verify: IntroDB --
async function verifyIntrodb(key) {
  const dotMain  = $('dot-introdb');
  const msgMain  = $('msg-introdb');
  const dotCard  = $('dot-introdb-card');
  const alertEl  = $('alert-introdb');

  [dotMain, dotCard].forEach(d => d && (d.className = 'status-dot checking'));
  if (msgMain) { msgMain.className = 'status-msg'; msgMain.textContent = 'Checking...'; }
  setNavDot('introdb', 'checking');

  if (!key) {
    setDot(dotMain, 'err', 'No API key configured', msgMain);
    setDot(dotCard, 'err');
    setNavDot('introdb', 'err');
    if (alertEl) showAlert(alertEl, 'warn', 'Paste your IntroDB API key and click Save & Verify.');
    return false;
  }

  try {
    const r = await fetch('https://api.introdb.app/v1/shows?limit=1', {
      headers: { 'x-api-key': key }
    });
    if (r.ok || r.status === 200) {
      setDot(dotMain, 'ok', 'Connected - IntroDB API active', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('introdb', 'ok');
      if (alertEl) hideAlert(alertEl);
      return true;
    }
    const err = r.status === 401 ? 'Invalid API key (401 Unauthorized)' : 'HTTP ' + r.status;
    setDot(dotMain, 'err', err, msgMain);
    setDot(dotCard, 'err');
    setNavDot('introdb', 'err');
    if (alertEl) showAlert(alertEl, 'err', err);
    return false;
  } catch (e) {
    setDot(dotMain, 'warn', 'Network error - check connection', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('introdb', 'warn');
    return false;
  }
}

// -- Verify: Supabase --
async function verifySupabase(url, key) {
  const dotMain = $('dot-supabase');
  const msgMain = $('msg-supabase');
  const dotCard = $('dot-supabase-card');
  const alertEl = $('alert-supabase');
  const sqlEl   = $('sqlAlert');
  const sqlEl2  = $('sqlAlert2');

  [dotMain, dotCard].forEach(d => d && (d.className = 'status-dot checking'));
  if (msgMain) { msgMain.className = 'status-msg'; msgMain.textContent = 'Checking...'; }
  setNavDot('supabase', 'checking');

  if (!url || !key) {
    setDot(dotMain, 'warn', 'Not configured (optional)', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('supabase', 'warn');
    return false;
  }

  try {
    const base = url.replace(/\/$/, '');
    const r = await fetch(base + '/rest/v1/playback_states?limit=1', {
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      }
    });

    if (r.ok) {
      setDot(dotMain, 'ok', 'Connected - cloud sync active', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('supabase', 'ok');
      if (alertEl) hideAlert(alertEl);
      [sqlEl, sqlEl2].forEach(el => { if (el) el.className = 'alert'; });
      return true;
    }

    if (r.status === 404 || r.status === 406) {
      const sqlMsg = 'Table not found. Run supabase_setup.sql in your Supabase SQL Editor, then click Save & Verify again.';
      setDot(dotMain, 'warn', 'Connected but table missing', msgMain);
      setDot(dotCard, 'warn');
      setNavDot('supabase', 'warn');
      [sqlEl, sqlEl2].forEach(el => { if (el) showAlert(el, 'warn', sqlMsg); });
      return false;
    }

    if (r.status === 401) {
      setDot(dotMain, 'err', 'Invalid anon key (401)', msgMain);
      setDot(dotCard, 'err');
      setNavDot('supabase', 'err');
      if (alertEl) showAlert(alertEl, 'err', 'Invalid anon key. Check Project Settings > API.');
      return false;
    }

    setDot(dotMain, 'err', 'HTTP ' + r.status, msgMain);
    setDot(dotCard, 'err');
    setNavDot('supabase', 'err');
    return false;
  } catch (e) {
    setDot(dotMain, 'warn', 'Network error - check Project URL', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('supabase', 'warn');
    if (alertEl) showAlert(alertEl, 'warn', 'Could not reach Supabase. Check your Project URL.');
    return false;
  }
}

// -- Verify: TMDB --
async function verifyTmdb(key) {
  const dotMain = $('dot-tmdb');
  const msgMain = $('msg-tmdb');
  const dotCard = $('dot-tmdb-card');
  const alertEl = $('alert-tmdb');

  [dotMain, dotCard].forEach(d => d && (d.className = 'status-dot checking'));
  if (msgMain) { msgMain.className = 'status-msg'; msgMain.textContent = 'Checking...'; }
  setNavDot('tmdb', 'checking');

  if (!key) {
    setDot(dotMain, 'warn', 'Not configured (optional)', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('tmdb', 'warn');
    return false;
  }

  try {
    const r = await fetch('https://api.themoviedb.org/3/configuration?api_key=' + encodeURIComponent(key));
    if (r.ok) {
      setDot(dotMain, 'ok', 'Connected - TMDB metadata active', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('tmdb', 'ok');
      if (alertEl) hideAlert(alertEl);
      return true;
    }
    const err = r.status === 401 ? 'Invalid API key (401)' : 'HTTP ' + r.status;
    setDot(dotMain, 'err', err, msgMain);
    setDot(dotCard, 'err');
    setNavDot('tmdb', 'err');
    if (alertEl) showAlert(alertEl, 'err', err);
    return false;
  } catch (e) {
    setDot(dotMain, 'warn', 'Network error', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('tmdb', 'warn');
    return false;
  }
}

// -- Verify: AnimeSkip --
async function verifyAnimeskip(enabled, clientId) {
  const dotMain = $('dot-animeskip');
  const msgMain = $('msg-animeskip');
  const alertEl = $('alert-animeskip');

  if (!enabled) {
    setDot(dotMain, '', 'Disabled', msgMain);
    setNavDot('animeskip', '');
    return;
  }
  if (!clientId) {
    setDot(dotMain, 'warn', 'Enabled but no Client ID', msgMain);
    setNavDot('animeskip', 'warn');
    if (alertEl) showAlert(alertEl, 'warn', 'Paste your AnimeSkip Client ID to enable anime detection.');
    return;
  }

  if (dotMain) dotMain.className = 'status-dot checking';
  if (msgMain) msgMain.textContent = 'Checking...';
  setNavDot('animeskip', 'checking');

  try {
    const r = await fetch('https://api.anime-skip.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-ID': clientId },
      body: JSON.stringify({ query: '{ __typename }' })
    });
    if (r.ok) {
      setDot(dotMain, 'ok', 'Connected - AnimeSkip active', msgMain);
      setNavDot('animeskip', 'ok');
      if (alertEl) hideAlert(alertEl);
    } else {
      setDot(dotMain, 'err', 'Invalid Client ID (HTTP ' + r.status + ')', msgMain);
      setNavDot('animeskip', 'err');
    }
  } catch (e) {
    setDot(dotMain, 'warn', 'Network error', msgMain);
    setNavDot('animeskip', 'warn');
  }
}

// -- Run all verifications --
async function verifyAll() {
  const data = await chrome.storage.local.get([
    S.introdbApiKey, S.supabaseUrl, S.supabaseAnonKey,
    S.tmdbApiKey, S.animeSkipEnabled, S.animeSkipClientId
  ]);
  await Promise.all([
    verifyIntrodb(data[S.introdbApiKey]),
    verifySupabase(data[S.supabaseUrl], data[S.supabaseAnonKey]),
    verifyTmdb(data[S.tmdbApiKey]),
    verifyAnimeskip(data[S.animeSkipEnabled], data[S.animeSkipClientId]),
  ]);
}

// -- Load credentials into inputs --
async function loadCredentials() {
  const data = await chrome.storage.local.get(Object.values(S));

  if ($('introdbApiKey'))    $('introdbApiKey').value    = data[S.introdbApiKey]    || '';
  if ($('supabaseUrl'))      $('supabaseUrl').value      = data[S.supabaseUrl]      || '';
  if ($('supabaseAnonKey'))  $('supabaseAnonKey').value  = data[S.supabaseAnonKey]  || '';
  if ($('tmdbApiKey'))       $('tmdbApiKey').value       = data[S.tmdbApiKey]       || '';

  const asEnabled = !!data[S.animeSkipEnabled];
  if ($('animeSkipEnabled')) {
    $('animeSkipEnabled').checked = asEnabled;
    const fields = $('animeSkipFields');
    if (fields) fields.style.display = asEnabled ? 'block' : 'none';
  }
  if ($('animeSkipClientId'))  $('animeSkipClientId').value  = data[S.animeSkipClientId]  || '';
  if ($('animeSkipAuthToken')) $('animeSkipAuthToken').value = data[S.animeSkipAuthToken] || '';

  loadSkipBehavior(data);
  loadStats(data);
  loadSiteRules(data[S.siteRules] || data['skipstream_site_rules'] || {});
  // Pull cloud settings if Supabase configured and cloud is newer
  try {
    const userId = await new Promise(res =>
      chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
    );
    if (userId) {
      const cloudResult = await new Promise(res =>
        chrome.runtime.sendMessage({ type: 'SUPABASE_SETTINGS_GET', userId }, r => res(r))
      );
      if (cloudResult?.data?.prefs) {
        // Only apply cloud prefs if local has no skipMode set (fresh install / new device)
        const hasLocal = !!data[S.skipMode];
        if (!hasLocal) {
          await chrome.storage.local.set(cloudResult.data.prefs);
          const merged = { ...data, ...cloudResult.data.prefs };
          loadSkipBehavior(merged);
        }
      }
      if (cloudResult?.data?.site_rules) {
        const hasLocalRules = Object.keys(data['skipstream_site_rules'] || {}).length > 0;
        if (!hasLocalRules) {
          await chrome.storage.local.set({ skipstream_site_rules: cloudResult.data.site_rules });
          loadSiteRules(cloudResult.data.site_rules);
        }
      }
    }
  } catch (_) {}
  loadHistory(data);
}

// -- AnimeSkip toggle shows/hides fields --
const asToggle = $('animeSkipEnabled');
if (asToggle) {
  asToggle.addEventListener('change', () => {
    const fields = $('animeSkipFields');
    if (fields) fields.style.display = asToggle.checked ? 'block' : 'none';
  });
}

// -- Save: IntroDB --
const saveIntrodbBtn = $('saveIntrodb');
if (saveIntrodbBtn) {
  saveIntrodbBtn.addEventListener('click', async () => {
    const key = ($('introdbApiKey').value || '').trim();
    saveIntrodbBtn.disabled = true;
    saveIntrodbBtn.innerHTML = '<span class="spinner"></span>Verifying...';
    await chrome.storage.local.set({ [S.introdbApiKey]: key });
    await verifyIntrodb(key);
    saveIntrodbBtn.disabled = false;
    saveIntrodbBtn.textContent = 'Save & Verify';
    if (key) showAlert($('alert-introdb'), 'ok', 'IntroDB key saved.');
  });
}

// -- Save: Supabase --
const saveSupabaseBtn = $('saveSupabase');
if (saveSupabaseBtn) {
  saveSupabaseBtn.addEventListener('click', async () => {
    const url = ($('supabaseUrl').value || '').trim();
    const key = ($('supabaseAnonKey').value || '').trim();
    saveSupabaseBtn.disabled = true;
    saveSupabaseBtn.innerHTML = '<span class="spinner"></span>Verifying...';
    await chrome.storage.local.set({ [S.supabaseUrl]: url, [S.supabaseAnonKey]: key });
    await verifySupabase(url, key);
    saveSupabaseBtn.disabled = false;
    saveSupabaseBtn.textContent = 'Save & Verify';
  });
}

// -- Save: TMDB --
const saveTmdbBtn = $('saveTmdb');
if (saveTmdbBtn) {
  saveTmdbBtn.addEventListener('click', async () => {
    const key = ($('tmdbApiKey').value || '').trim();
    saveTmdbBtn.disabled = true;
    saveTmdbBtn.innerHTML = '<span class="spinner"></span>Verifying...';
    await chrome.storage.local.set({ [S.tmdbApiKey]: key });
    await verifyTmdb(key);
    saveTmdbBtn.disabled = false;
    saveTmdbBtn.textContent = 'Save & Verify';
    if (key) showAlert($('alert-tmdb'), 'ok', 'TMDB key saved.');
  });
}

// -- Save: AnimeSkip --
const saveAnimeskipBtn = $('saveAnimeskip');
if (saveAnimeskipBtn) {
  saveAnimeskipBtn.addEventListener('click', async () => {
    const enabled   = $('animeSkipEnabled')  ? $('animeSkipEnabled').checked  : false;
    const clientId  = $('animeSkipClientId') ? ($('animeSkipClientId').value  || '').trim() : '';
    const authToken = $('animeSkipAuthToken')? ($('animeSkipAuthToken').value || '').trim() : '';
    saveAnimeskipBtn.disabled = true;
    saveAnimeskipBtn.innerHTML = '<span class="spinner"></span>Verifying...';
    await chrome.storage.local.set({
      [S.animeSkipEnabled]:   enabled,
      [S.animeSkipClientId]:  clientId,
      [S.animeSkipAuthToken]: authToken,
    });
    await verifyAnimeskip(enabled, clientId);
    saveAnimeskipBtn.disabled = false;
    saveAnimeskipBtn.textContent = 'Save & Verify';
    showAlert($('alert-animeskip'), 'ok', 'AnimeSkip settings saved.');
  });
}

// -- Re-verify all --
const reVerifyBtn = $('reVerifyBtn');
if (reVerifyBtn) {
  reVerifyBtn.addEventListener('click', () => verifyAll());
}

// -- Skip behavior: mode chips --
let currentMode = 'auto-all';
let currentRate = 1;

function loadSkipBehavior(data) {
  currentMode = data[S.skipMode] || 'auto-all';
  currentRate = parseFloat(data[S.playbackRate]) || 1;

  document.querySelectorAll('.mode-chip[data-mode]').forEach(chip => {
    chip.classList.toggle('selected', chip.dataset.mode === currentMode);
  });
  document.querySelectorAll('.mode-chip[data-rate]').forEach(chip => {
    chip.classList.toggle('selected', parseFloat(chip.dataset.rate) === currentRate);
  });

  const set = (id, val) => { const el = $(id); if (el) el.checked = val !== false; };
  set('skipIntro',       data[S.skipIntro]);
  set('skipRecap',       data[S.skipRecap]);
  set('skipOutro',       data[S.skipOutro]);
  set('resumePlayback',  data[S.resumePlayback]);
  set('autoNextEpisode', data[S.autoNextEpisode]);
}

document.querySelectorAll('.mode-chip[data-mode]').forEach(chip => {
  chip.addEventListener('click', () => {
    currentMode = chip.dataset.mode;
    document.querySelectorAll('.mode-chip[data-mode]').forEach(c =>
      c.classList.toggle('selected', c.dataset.mode === currentMode)
    );
  });
});

document.querySelectorAll('.mode-chip[data-rate]').forEach(chip => {
  chip.addEventListener('click', () => {
    currentRate = parseFloat(chip.dataset.rate);
    document.querySelectorAll('.mode-chip[data-rate]').forEach(c =>
      c.classList.toggle('selected', parseFloat(c.dataset.rate) === currentRate)
    );
  });
});

const saveBehaviorBtn = $('saveBehavior');
if (saveBehaviorBtn) {
  saveBehaviorBtn.addEventListener('click', async () => {
    const get = id => { const el = $(id); return el ? el.checked : true; };
    await chrome.storage.local.set({
      [S.skipMode]:        currentMode,
      [S.playbackRate]:    currentRate,
      [S.skipIntro]:       get('skipIntro'),
      [S.skipRecap]:       get('skipRecap'),
      [S.skipOutro]:       get('skipOutro'),
      [S.resumePlayback]:  get('resumePlayback'),
      [S.autoNextEpisode]: get('autoNextEpisode'),
    });
    showAlert($('alert-behavior'), 'ok', 'Skip behavior saved.');
    setTimeout(() => hideAlert($('alert-behavior')), 2500);
    // Push settings to cloud if Supabase configured
    try {
      const userId = await new Promise(res =>
        chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
      );
      if (userId) {
        const prefs = await chrome.storage.local.get([
          S.skipMode, S.skipIntro, S.skipRecap, S.skipOutro,
          S.resumePlayback, S.autoNextEpisode, S.playbackRate
        ]);
        const currentSiteRules = await new Promise(res => {
          chrome.storage.local.get('skipstream_site_rules', r =>
            res(r.skipstream_site_rules || {})
          );
        });
        chrome.runtime.sendMessage({
          type: 'SUPABASE_SETTINGS_UPSERT',
          body: { user_id: userId, prefs, site_rules: currentSiteRules }
        });
      }
    } catch (_) {}
  });
}

// -- Per-site rules --
let siteRules = {};

function renderSiteRules() {
  const list = $('siteRulesList');
  if (!list) return;
  list.innerHTML = '';
  const domains = Object.keys(siteRules);
  if (!domains.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text3);padding:4px 0">No rules yet. Add a domain below.</p>';
    return;
  }
  domains.forEach(domain => {
    const row = document.createElement('div');
    row.className = 'site-rule-row';
    row.innerHTML = `
      <span class="site-rule-domain">${escapeHtml(domain)}</span>
      <span class="site-rule-mode">${escapeHtml(siteRules[domain])}</span>
      <button class="site-rule-del" data-domain="${escapeHtml(domain)}" title="Remove rule">x</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('.site-rule-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      delete siteRules[btn.dataset.domain];
      await chrome.storage.local.set({ [S.siteRules]: siteRules });
      renderSiteRules();
      try {
        const uid = await new Promise(res =>
          chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
        );
        if (uid) chrome.runtime.sendMessage({
          type: 'SUPABASE_SETTINGS_UPSERT',
          body: { user_id: uid, site_rules: siteRules }
        });
      } catch (_) {}
    });
  });
}

function loadSiteRules(rules) {
  siteRules = rules || {};
  renderSiteRules();
}

const siteRuleAddBtn = $('siteRuleAddBtn');
if (siteRuleAddBtn) {
  siteRuleAddBtn.addEventListener('click', async () => {
    const domainInput = $('siteRuleDomain');
    const modeSelect  = $('siteRuleMode');
    if (!domainInput || !modeSelect) return;
    const domain = domainInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain) return;
    siteRules[domain] = modeSelect.value;
    await chrome.storage.local.set({ [S.siteRules]: siteRules });
    domainInput.value = '';
    renderSiteRules();
    // Push updated site rules to cloud
    try {
      const uid = await new Promise(res =>
        chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
      );
      if (uid) chrome.runtime.sendMessage({
        type: 'SUPABASE_SETTINGS_UPSERT',
        body: { user_id: uid, site_rules: siteRules }
      });
    } catch (_) {}
  });
}

// -- Stats --
function fmtTime(sec) {
  if (!sec) return '0s';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return (sec / 3600).toFixed(1) + 'h';
}

function makeStatCard(val, lbl) {
  const d = document.createElement('div');
  d.className = 'stat-card';
  d.innerHTML = `<div class="stat-val">${val}</div><div class="stat-lbl">${lbl}</div>`;
  return d;
}

function loadStats(data) {
  const today = new Date().toDateString();
  const skipsToday = data[S.statsDate] === today ? (data[S.statsSkipsToday] || 0) : 0;
  const totalSkips = data[S.statsTotalSkips] || 0;
  const totalTime  = data[S.statsTotalTimeSaved] || 0;
  const sessions   = data[S.statsSessions] || 0;

  const sessionGrid = $('statsGrid');
  const allGrid     = $('statsAllGrid');

  if (sessionGrid) {
    sessionGrid.innerHTML = '';
    sessionGrid.appendChild(makeStatCard(skipsToday, 'Skips today'));
    sessionGrid.appendChild(makeStatCard(fmtTime(totalTime), 'Time saved today'));
  }
  if (allGrid) {
    allGrid.innerHTML = '';
    allGrid.appendChild(makeStatCard(totalSkips, 'Total skips'));
    allGrid.appendChild(makeStatCard(sessions,   'Sessions'));
    allGrid.appendChild(makeStatCard(fmtTime(totalTime), 'Total time saved'));
  }
}

// -- History --
let historySource = 'local';
let allHistory    = [];

// In-memory poster cache: title -> poster_url (null = not found)
const _posterCache = {};

async function fetchPoster(title, itemEl) {
  if (!title) return;
  const key = title.toLowerCase().trim();
  if (key in _posterCache) {
    if (_posterCache[key]) applyPoster(itemEl, _posterCache[key]);
    return;
  }
  try {
    const result = await new Promise(res =>
      chrome.runtime.sendMessage({ type: 'TMDB_SEARCH_POSTER', title }, r => res(r))
    );
    _posterCache[key] = result?.posterUrl || null;
    if (_posterCache[key]) applyPoster(itemEl, _posterCache[key]);
  } catch { _posterCache[key] = null; }
}

function applyPoster(el, url) {
  const img = el.querySelector('.h-poster');
  if (img) { img.src = url; img.style.display = 'block'; }
}

function renderHistory(items) {
  const list = $('historyList');
  if (!list) return;
  if (!items || !items.length) {
    list.innerHTML = '<div class="h-empty">No history yet.<br>Start watching to build your log.</div>';
    return;
  }
  const search = ($('historySearch') || {}).value || '';
  const filter = ($('historyFilter') || {}).value || '';
  const filtered = items.filter(item => {
    const title = (item.title || item.videoTitle || '').toLowerCase();
    const site  = (item.site  || item.siteName  || '').toLowerCase();
    return (!search || title.includes(search.toLowerCase()))
      && (!filter || site === filter.toLowerCase());
  });

  if (!filtered.length) {
    list.innerHTML = '<div class="h-empty">No matches found.</div>';
    return;
  }

  list.innerHTML = '';
  filtered.slice(0, 100).forEach(item => {
    const title   = item.title || item.videoTitle || 'Unknown';
    const site    = item.site  || item.siteName  || '';
    const pos     = item.position || item.currentTime || 0;
    const dur     = item.duration || 0;
    const pct     = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
    const isCloud = !!item.fromCloud;
    const url     = item.url || item.pageUrl || '#';
    const posStr  = pos > 0 ? fmtTime(Math.round(pos)) : '';

    const el = document.createElement('a');
    el.className = 'h-item';
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener';
    el.innerHTML = `
      <div class="h-item-inner">
        <img class="h-poster" src="" alt="" style="display:none;width:36px;height:54px;object-fit:cover;border-radius:4px;flex-shrink:0;">
        <div class="h-item-body">
          <div class="h-title">${escapeHtml(title)}</div>
          <div class="h-meta">
            ${site ? `<span class="h-site">${escapeHtml(site)}</span>` : ''}
            ${isCloud ? '<span class="h-cloud">Cloud</span>' : ''}
            ${item.device ? `<span class="h-device">${escapeHtml(item.device)}</span>` : ''}
            ${posStr ? `<span>${posStr}</span>` : ''}
            ${pct > 0 ? `<span>${pct}%</span>` : ''}
          </div>
          ${pct > 0 ? `<div class="h-bar"><div class="h-fill" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>
    `;
    list.appendChild(el);
    // Lazy-load poster (non-blocking)
    if (title && title !== 'Unknown') fetchPoster(title, el);
  });
}

async function loadHistory(data) {
  const list = $('historyList');
  if (!list) return;

  let localItems = [];
  try {
    const raw = await chrome.storage.local.get('skipstream_cache');
    const cache = raw['skipstream_cache'] || {};
    localItems = Object.entries(cache).map(([mediaId, entry]) => ({
      title:    entry.title    || '',
      site:     entry.site     || '',
      siteName: entry.site_name || entry.site || '',
      url:      entry.url      || mediaId,
      position: entry.p        || 0,
      duration: entry.d        || 0,
      ts:       entry.t        || 0,
      fromCloud: false,
    })).filter(e => e.title).sort((a, b) => b.ts - a.ts);
  } catch (_) {}

  let cloudItems = [];
  const url = data[S.supabaseUrl];
  const key = data[S.supabaseAnonKey];
  const syncDot  = $('syncDot');
  const syncText = $('syncText');

  if (url && key) {
    try {
      const userId = await new Promise(res => {
        chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null));
      });
      if (userId) {
        const result = await new Promise(res => {
          chrome.runtime.sendMessage({ type: 'SUPABASE_GET_ALL', userId }, r => res(r));
        });
        if (result?.data && result.data.length > 0) {
          cloudItems = result.data.map(row => ({
            title:    row.video_title || '',
            site:     row.site_name   || row.site || '',
            siteName: row.site_name   || '',
            url:      row.media_id    || '',
            position: row.playback_time || 0,
            duration: row.duration    || 0,
            device:   row.device_name || '',
            updated:  row.updated_at  || '',
            fromCloud: true,
          })).filter(r => r.title);
          if (syncDot)  syncDot.className  = 'sync-dot ok';
          if (syncText) syncText.textContent = 'Synced with Supabase - ' + cloudItems.length + ' cloud entries';
        } else {
          if (syncText) syncText.textContent = 'Cloud connected - no history yet';
        }
      } else {
        if (syncText) syncText.textContent = 'Cloud sync unavailable - check credentials';
      }
    } catch (_) {
      if (syncText) syncText.textContent = 'Cloud sync offline';
    }
  } else {
    if (syncText) syncText.textContent = 'Local only - Supabase not configured';
  }

  const filterEl = $('historyFilter');
  if (filterEl) {
    const sites = [...new Set([...localItems, ...cloudItems].map(i => i.site || i.siteName).filter(Boolean))];
    filterEl.innerHTML = '<option value="">All sites</option>';
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      filterEl.appendChild(opt);
    });
  }

  function getItems() {
    if (historySource === 'local') return localItems;
    if (historySource === 'cloud') return cloudItems;
    const seen = new Set();
    return [...cloudItems, ...localItems].filter(i => {
      const k = i.url || i.pageUrl || i.title || i.videoTitle;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  allHistory = getItems();
  renderHistory(allHistory);

  document.querySelectorAll('.source-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      historySource = pill.dataset.source;
      document.querySelectorAll('.source-pill').forEach(p => p.classList.toggle('active', p === pill));
      allHistory = getItems();
      renderHistory(allHistory);
    });
  });

  const searchEl = $('historySearch');
  if (searchEl) searchEl.addEventListener('input', () => renderHistory(allHistory));
  if (filterEl) filterEl.addEventListener('change', () => renderHistory(allHistory));

  const syncBtn = $('syncNowBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.textContent = 'Syncing...';
      // Push all local cache entries to cloud first (local->cloud)
      try {
        const userId = await new Promise(res =>
          chrome.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
        );
        if (userId) {
          const raw = await chrome.storage.local.get('skipstream_cache');
          const cache = raw['skipstream_cache'] || {};
          const entries = Object.entries(cache);
          for (const [mediaId, entry] of entries) {
            if (!entry.p || !entry.title) continue;
            await new Promise(res => chrome.runtime.sendMessage({
              type: 'SUPABASE_UPSERT',
              body: {
                user_id:      userId,
                media_id:     mediaId,
                playback_time: Math.floor(entry.p),
                duration:     entry.d || 0,
                site:         entry.site || '',
                site_name:    entry.site_name || entry.site || '',
                video_title:  entry.title || '',
                device_name:  'SkipStream Options Sync',
              }
            }, res));
          }
          chrome.storage.local.set({ skipstream_last_sync: Date.now() });
        }
      } catch (_) {}
      // Then pull from cloud (cloud->local already happens via SUPABASE_GET_ALL in loadHistory)
      await loadHistory(data);
      syncBtn.textContent = 'Sync';
    });
  }
}

// -- Export --
const exportBtn = $('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(null);
    // Tag export with version for future migration checks
    data._exportVersion = chrome.runtime.getManifest().version;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'skipstream-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    showAlert($('alert-export'), 'ok', 'Exported successfully.');
    setTimeout(() => hideAlert($('alert-export')), 3000);
  });
}

// -- Import migration shim: handles schema changes from 1.6.5 and earlier --
function migrateImportData(data) {
  // 1.6.5 used 'apiKey' instead of 'introdbApiKey'
  if (data.apiKey && !data.introdbApiKey) {
    data.introdbApiKey = data.apiKey;
    delete data.apiKey;
  }
  // 1.6.5 used 'supabaseKey' instead of 'supabaseAnonKey'
  if (data.supabaseKey && !data.supabaseAnonKey) {
    data.supabaseAnonKey = data.supabaseKey;
    delete data.supabaseKey;
  }
  // 1.6.5 skipMode may have been boolean 'enabled' only
  if (data.skipMode === undefined) {
    data.skipMode = data.skipEnabled === false ? 'off' : 'auto-all';
  }
  // 1.6.5 used 'autoSkip' for skipIntro
  if (data.autoSkip !== undefined && data.skipIntro === undefined) {
    data.skipIntro = data.autoSkip;
    delete data.autoSkip;
  }
  // 1.6.5 used 'siteRules' key; content.js expects 'skipstream_site_rules'
  if (data.siteRules !== undefined && data.skipstream_site_rules === undefined) {
    data.skipstream_site_rules = data.siteRules;
    delete data.siteRules;
  }
  // 1.6.5 stat keys
  if (data.totalSkips !== undefined && data.statsTotalSkips === undefined) {
    data.statsTotalSkips = data.totalSkips;
    delete data.totalSkips;
  }
  if (data.timeSaved !== undefined && data.statsTotalTimeSaved === undefined) {
    data.statsTotalTimeSaved = data.timeSaved;
    delete data.timeSaved;
  }
  return data;
}

// -- Import --
const importBtn  = $('importBtn');
const importFile = $('importFile');
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed = JSON.parse(text);

      // Run migration shim before merging
      parsed = migrateImportData(parsed);

      const existing = await chrome.storage.local.get(null);
      const merged = { ...parsed, ...existing };

      // Combine numeric stats additively
      for (const k of [S.statsTotalSkips, S.statsTotalTimeSaved, S.statsSessions]) {
        merged[k] = (parsed[k] || 0) + (existing[k] || 0);
      }

      await chrome.storage.local.set(merged);
      showAlert($('alert-export'), 'ok', 'Imported and merged successfully. Reload to see changes.');
      importFile.value = '';
    } catch (e) {
      showAlert($('alert-export'), 'err', 'Import failed: ' + e.message);
    }
  });
}

// -- Clear all --
const clearBtn = $('clearBtn');
if (clearBtn) {
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all SkipStream data? This cannot be undone.')) return;
    await chrome.storage.local.clear();
    showAlert($('alert-export'), 'warn', 'All data cleared. Reload the extension to start fresh.');
    loadCredentials();
  });
}

// -- Init --
loadCredentials();
verifyAll();
