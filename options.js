'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

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
  playbackRate:       'playbackSpeed',
  siteRules:          'skipstream_site_rules',
  statsSkipsToday:    'statsSkipsToday',
  statsDate:          'statsDate',
  statsTotalSkips:    'statsTotalSkips',
  statsTotalTimeSaved:'statsTotalTimeSaved',
  statsSessions:      'statsSessions',
  stats:              'skipstream_stats',
};

const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// -- Version badge --
const manifest = br.runtime.getManifest();
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
// NOTE: IntroDB's public API has no key-validation endpoint. /intro and /segments
// are unauthenticated reads; only POST /submit requires X-API-Key. So this check
// can only confirm (a) a key string is saved, and (b) the service is reachable.
// It cannot confirm the key itself is valid - that's only provable on a real submit.
async function verifyIntrodb(key) {
  const dotMain  = $('dot-introdb');
  const msgMain  = $('msg-introdb');
  const dotCard  = $('dot-introdb-card');
  const alertEl  = $('alert-introdb');

  [dotMain, dotCard].forEach(d => d && (d.className = 'status-dot checking'));
  if (msgMain) { msgMain.className = 'status-msg'; msgMain.textContent = 'Checking...'; }
  setNavDot('introdb', 'checking');

  if (!key) {
    setDot(dotMain, 'err', 'Not configured', msgMain);
    setDot(dotCard, 'err');
    setNavDot('introdb', 'err');
    if (alertEl) showAlert(alertEl, 'warn', 'Paste your IntroDB API key and click Save & Verify.');
    return false;
  }

  try {
    // Reachability check only - this endpoint is public and ignores the key.
    const r = await fetch('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    if (r.ok) {
      setDot(dotMain, 'ok', 'Configured - IntroDB service reachable', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('introdb', 'ok');
      if (alertEl) hideAlert(alertEl);
      return true;
    }
    setDot(dotMain, 'warn', 'Configured - service returned HTTP ' + r.status, msgMain);
    setDot(dotCard, 'warn');
    setNavDot('introdb', 'warn');
    return false;
  } catch (e) {
    setDot(dotMain, 'warn', 'Configured - network error reaching service', msgMain);
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
  const data = await br.storage.local.get([
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
  const data = await br.storage.local.get(Object.values(S));

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
      br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
    );
    if (userId) {
      const cloudResult = await new Promise(res =>
        br.runtime.sendMessage({ type: 'SUPABASE_SETTINGS_GET', userId }, r => res(r))
      );
      if (cloudResult?.data?.prefs) {
        // Only apply cloud prefs if local has no skipMode set (fresh install / new device)
        const hasLocal = !!data[S.skipMode];
        if (!hasLocal) {
          await br.storage.local.set(cloudResult.data.prefs);
          const merged = { ...data, ...cloudResult.data.prefs };
          loadSkipBehavior(merged);
        }
      }
      if (cloudResult?.data?.site_rules) {
        const hasLocalRules = Object.keys(data['skipstream_site_rules'] || {}).length > 0;
        if (!hasLocalRules) {
          await br.storage.local.set({ skipstream_site_rules: cloudResult.data.site_rules });
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
    await br.storage.local.set({ [S.introdbApiKey]: key });
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
    await br.storage.local.set({ [S.supabaseUrl]: url, [S.supabaseAnonKey]: key });
    const ok = await verifySupabase(url, key);
    saveSupabaseBtn.disabled = false;
    saveSupabaseBtn.textContent = 'Save & Verify';
    if (ok) showAlert($('alert-supabase'), 'ok', 'Supabase credentials saved.');
  });
}

// -- Save: TMDB --
const saveTmdbBtn = $('saveTmdb');
if (saveTmdbBtn) {
  saveTmdbBtn.addEventListener('click', async () => {
    const key = ($('tmdbApiKey').value || '').trim();
    saveTmdbBtn.disabled = true;
    saveTmdbBtn.innerHTML = '<span class="spinner"></span>Verifying...';
    await br.storage.local.set({ [S.tmdbApiKey]: key });
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
    await br.storage.local.set({
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
    await br.storage.local.set({
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
        br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
      );
      if (userId) {
        const prefs = await br.storage.local.get([
          S.skipMode, S.skipIntro, S.skipRecap, S.skipOutro,
          S.resumePlayback, S.autoNextEpisode, S.playbackRate
        ]);
        const currentSiteRules = await new Promise(res => {
          br.storage.local.get('skipstream_site_rules', r =>
            res(r.skipstream_site_rules || {})
          );
        });
        br.runtime.sendMessage({
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
      await br.storage.local.set({ [S.siteRules]: siteRules });
      renderSiteRules();
      try {
        const uid = await new Promise(res =>
          br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
        );
        if (uid) br.runtime.sendMessage({
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
    await br.storage.local.set({ [S.siteRules]: siteRules });
    domainInput.value = '';
    renderSiteRules();
    // Push updated site rules to cloud
    try {
      const uid = await new Promise(res =>
        br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
      );
      if (uid) br.runtime.sendMessage({
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
  const stats = data[S.stats] || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0, skipsToday: 0, statsDate: '' };
  const today = new Date().toDateString();
  const skipsToday = stats.statsDate === today ? (stats.skipsToday || 0) : 0;
  const totalSkips = stats.skipsTotal    || 0;
  const totalTime  = stats.timeSavedSec  || 0;
  const sessions   = stats.sessionsTotal || 0;

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
let historySource = 'merged';
let allHistory    = [];
let historyListenersAttached = false;

// In-memory poster cache: title -> poster_url (null = not found)
const _posterCache = {};

// Concurrency-limited queue - avoids firing 50-100 TMDB calls at once on large history
let _posterInFlight = 0;
const _posterQueue = [];
const POSTER_MAX_CONCURRENT = 4;

function scheduleFetchPoster(title, itemEl) {
  _posterQueue.push([title, itemEl]);
  drainPosterQueue();
}

function drainPosterQueue() {
  while (_posterInFlight < POSTER_MAX_CONCURRENT && _posterQueue.length) {
    const [title, itemEl] = _posterQueue.shift();
    _posterInFlight++;
    fetchPoster(title, itemEl).finally(() => {
      _posterInFlight--;
      drainPosterQueue();
    });
  }
}

async function fetchPoster(title, itemEl) {
  if (!title) return;
  const key = title.toLowerCase().trim();
  if (key in _posterCache) {
    if (_posterCache[key]) applyPoster(itemEl, _posterCache[key]);
    return;
  }
  try {
    const result = await new Promise(res =>
      br.runtime.sendMessage({ type: 'TMDB_SEARCH_POSTER', title }, r => res(r))
    );
    _posterCache[key] = result?.posterUrl || null;
    if (_posterCache[key]) applyPoster(itemEl, _posterCache[key]);
  } catch { _posterCache[key] = null; }
}

function fmtDate(updated) {
  if (!updated) return '';
  const ms = typeof updated === 'number' ? updated : Date.parse(updated);
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today ' + time;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function applyPoster(el, url) {
  const img = el.querySelector('.h-poster');
  if (img) { img.src = url; img.style.display = 'block'; }
}

function getYoutubeThumb(url) {
  if (!url) return null;
  let m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (!m) m = url.match(/^yt\/([a-zA-Z0-9_-]{11})/);
  if (!m) m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function getOembedSite(site) {
  const s = (site || '').toLowerCase();
  if (s.includes('spotify')) return 'spotify';
  if (s.includes('soundcloud')) return 'soundcloud';
  return null;
}

const _oembedCache = {};

async function fetchOembedThumb(pageUrl, platform, itemEl) {
  if (!pageUrl) return;
  const key = platform + ':' + pageUrl;
  if (key in _oembedCache) {
    if (_oembedCache[key]) applyPoster(itemEl, _oembedCache[key]);
    return;
  }
  try {
    const endpoint = platform === 'spotify'
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(pageUrl)}`
      : `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`;
    const r = await fetch(endpoint);
    if (!r.ok) { _oembedCache[key] = null; return; }
    const data = await r.json();
    _oembedCache[key] = data.thumbnail_url || null;
    if (_oembedCache[key]) applyPoster(itemEl, _oembedCache[key]);
  } catch (_) { _oembedCache[key] = null; }
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
    const dateStr = fmtDate(item.updated);

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
            ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
          </div>
          ${pct > 0 ? `<div class="h-bar"><div class="h-fill" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>
    `;
    list.appendChild(el);
    const ytThumb = getYoutubeThumb(url);
    const isYoutubeish = /youtube|youtu\.be/i.test(site || '');
    const oembedPlatform = getOembedSite(site);
    if (ytThumb) {
      applyPoster(el, ytThumb);
    } else if (oembedPlatform) {
      const pageUrl = url && url.startsWith('http') ? url : (url ? 'https://' + url : '');
      fetchOembedThumb(pageUrl, oembedPlatform, el);
    } else if (!isYoutubeish && title && title !== 'Unknown') {
      scheduleFetchPoster(title, el);
    }
  });
}

async function loadHistory(data) {
  const list = $('historyList');
  if (!list) return;

  let localItems = [];
  try {
    const raw = await br.storage.local.get('skipstream_cache');
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
    localItems.forEach(e => { e.updated = e.ts; });
  } catch (_) {}

  let cloudItems = [];
  const url = data[S.supabaseUrl];
  const key = data[S.supabaseAnonKey];
  const syncDot  = $('syncDot');
  const syncText = $('syncText');

  if (url && key) {
    try {
      const userId = await new Promise(res => {
        br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null));
      });
      if (userId) {
        const result = await new Promise(res => {
          br.runtime.sendMessage({ type: 'SUPABASE_GET_ALL', userId }, r => res(r));
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

  if (!historyListenersAttached) {
  historyListenersAttached = true;
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
      let pushed = 0, failed = 0, pushErr = null;
      try {
        const userId = await new Promise(res =>
          br.runtime.sendMessage({ type: 'GET_USER_ID' }, r => res(r?.userId || null))
        );
        if (userId) {
          const raw = await br.storage.local.get('skipstream_cache');
          const cache = raw['skipstream_cache'] || {};
          const entries = Object.entries(cache);
          for (const [mediaId, entry] of entries) {
            if (!entry.p || !entry.title) continue;
            const r = await new Promise(res => br.runtime.sendMessage({
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
            if (r && r.ok) pushed++; else { failed++; pushErr = r?.err || pushErr; }
          }
          br.storage.local.set({ skipstream_last_sync: Date.now() });
        } else {
          pushErr = 'no_user_id';
        }
      } catch (e) { pushErr = String(e); }
      await loadHistory(data);
      syncBtn.textContent = 'Sync';
      if (failed > 0) {
        const syncText = $('syncText');
        if (syncText) syncText.textContent = `Sync: ${pushed} pushed, ${failed} failed (${pushErr || 'unknown error'})`;
      }
    });
  }
  }
}

// -- Export --
const exportBtn = $('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    if (!confirm('This file will contain your API keys and Supabase credentials in plain text. Keep it private. Continue?')) return;
    try {
      const data = await br.storage.local.get(null);
      data._exportVersion = br.runtime.getManifest().version;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = 'skipstream-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      showAlert($('alert-export'), 'ok', 'Download triggered - check your Downloads folder.');
    } catch (e) {
      showAlert($('alert-export'), 'err', 'Export failed: ' + e.message);
    }
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
  // 1.6.5 used 'skipMaster' instead of 'skipEnabled'
  if (data.skipMaster !== undefined && data.skipEnabled === undefined) {
    data.skipEnabled = data.skipMaster;
    delete data.skipMaster;
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

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        showAlert($('alert-export'), 'err', 'Import failed: not a valid backup file.');
        importFile.value = '';
        return;
      }

      // Run migration shim before merging
      parsed = migrateImportData(parsed);

      const existing = await br.storage.local.get(null);

      if (parsed.supabaseUrl && parsed.supabaseUrl !== existing.supabaseUrl) {
        const msg = existing.supabaseUrl
          ? `Backup has a different Supabase project (${parsed.supabaseUrl}). Your current one (${existing.supabaseUrl}) stays active, this won't override it. Continue importing the rest?`
          : `This backup will set your Supabase project to ${parsed.supabaseUrl}. Only continue if you trust this file. Continue?`;
        if (!confirm(msg)) { delete parsed.supabaseUrl; delete parsed.supabaseAnonKey; }
      }

      const merged = { ...parsed, ...existing };

      // Combine stats additively (skipstream_stats blob)
      const pStats = parsed[S.stats]   || {};
      const eStats = existing[S.stats] || {};
      merged[S.stats] = {
        skipsTotal:    (pStats.skipsTotal    || 0) + (eStats.skipsTotal    || 0),
        timeSavedSec:  (pStats.timeSavedSec  || 0) + (eStats.timeSavedSec  || 0),
        sessionsTotal: (pStats.sessionsTotal || 0) + (eStats.sessionsTotal || 0),
        skipsToday:    eStats.skipsToday || 0,
        statsDate:     eStats.statsDate || '',
      };

      await br.storage.local.set(merged);
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
    await br.storage.local.clear();
    try { await new Promise(res => br.runtime.sendMessage({ type: 'INVALIDATE_USER_ID' }, res)); } catch (_) {}
    showAlert($('alert-export'), 'warn', 'All data cleared. Reload the extension to start fresh.');
    loadCredentials();
  });
}

function showWelcomeToast(returningUser) {
  const msg = returningUser
    ? 'Welcome back! Your SkipStream services are connected.'
    : 'Welcome to SkipStream — set up your services below to get started.';
  const toast = document.createElement('div');
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', top: '18px', right: '18px', zIndex: '9999',
    background: returningUser ? 'var(--ok-dim)' : 'var(--accent-dim)',
    color: returningUser ? 'var(--ok)' : 'var(--accent)',
    border: '1px solid ' + (returningUser ? 'var(--ok-border)' : 'var(--accent)'),
    borderRadius: '10px', padding: '11px 18px', fontSize: '12px', fontWeight: '600',
    fontFamily: 'var(--font)', boxShadow: 'var(--shadow)', maxWidth: '320px',
    opacity: '0', transition: 'opacity 220ms ease',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// -- Init --
loadCredentials();
verifyAll().then(() => {
  const supaOk = $('dot-supabase')?.classList.contains('ok');
  showWelcomeToast(supaOk);
});
