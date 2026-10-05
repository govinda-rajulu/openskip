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
  deviceName:         'deviceName',
  osobUsername:       'osub_username',
  osobPassword:       'osub_password',
  subLanguage:        'subtitle_language',
  subFontSize:        'subtitle_font_size',
  subEnabled:         'subtitle_enabled',
  subSync:            'subtitle_sync',
  subDragPos:         'subtitle_drag_pos',
  skipEnabled:        'skipEnabled',
  cache:              'skipstream_cache',
  theme:              'skipstream_theme',
  themeSeed:          'skipstream_seed_color',
  subColor:           'subtitle_color',
  subBg:              'subtitle_bg',
  subFont:            'subtitle_font',
  subOutline:         'subtitle_outline',
  subEdge:            'subtitle_edge',
  subOffsets:         'subtitle_offsets',
  sbModes:            'sbModes',
  showTimeline:       'showTimeline',
  skipNotice:         'skipNotice',
};

const DENY = new Set([
  'skipstream_install_id',
  'ss_userid_cache',
  'supabaseUrl',
  'supabaseAnonKey',
  'introdbApiKey',
  'tmdbApiKey',
  'animeSkipClientId',
  'animeSkipAuthToken',
  'osub_username',
  'osub_password',
  'osub_session',
  'skipstream_offline_queue',
  'ss_tab_state',
  'skipstream_error_log',
]);

const $ = id => document.getElementById(id);

// One messaging form for both browsers. Firefox's browser.* API is promise-only
// (no callback argument); Chrome MV3 returns a promise when no callback is given.
// Resolves undefined instead of throwing when the background is asleep or errors.
function bgSend(msg) {
  try { return Promise.resolve(br.runtime.sendMessage(msg)).catch(() => undefined); }
  catch (_) { return Promise.resolve(undefined); }
}

// Only these keys may arrive from cloud settings (same list as background.js
// SYNC_PREF_KEYS). Anything else in a cloud row, e.g. a credential, is ignored.
const CLOUD_PREF_ALLOW = ['skipEnabled', 'skipMode', 'skipIntro', 'skipRecap', 'skipOutro',
  'resumePlayback', 'autoNextEpisode', 'playbackSpeed',
  'subtitle_language', 'subtitle_font_size', 'subtitle_enabled',
  'subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'subtitle_edge', 'sbModes', 'showTimeline', 'skipNotice'];
const SUB_EDGE_VALUES = new Set(['outline', 'shadow', 'raised', 'none']);

const subFontSizeInput = $('subFontSize');
if (subFontSizeInput) {
  const persistSubFontSize = () => {
    let min = 10;
    let max = 30;
    if (subFontSizeInput.hasAttribute('min')) {
      const minValue = Number.parseFloat(subFontSizeInput.getAttribute('min'));
      if (Number.isFinite(minValue)) min = minValue;
    }
    if (subFontSizeInput.hasAttribute('max')) {
      const maxValue = Number.parseFloat(subFontSizeInput.getAttribute('max'));
      if (Number.isFinite(maxValue)) max = maxValue;
    }
    const parsed = Number.parseInt(subFontSizeInput.value, 10);
    if (!Number.isFinite(parsed)) {
      subFontSizeInput.value = '18';
      br.storage.local.set({ [S.subFontSize]: 18 }).catch(() => {});
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    subFontSizeInput.value = String(clamped);
    const out = $('subFontSizeValue'); if (out) out.textContent = clamped + 'px';
    br.storage.local.set({ [S.subFontSize]: clamped }).catch(() => {});
  };
  subFontSizeInput.addEventListener('input', persistSubFontSize);
}

// -- Subtitle look, YouTube segment modes, timeline (1.12) --
const SB_MODE_VALUES = new Set(['auto', 'ask', 'off']);
function cleanSbModes(v) {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of ['sponsor', 'selfpromo', 'interaction', 'preview', 'music_offtopic', 'filler', 'intro', 'outro']) if (SB_MODE_VALUES.has(v[k])) out[k] = v[k];
  }
  return out;
}
br.storage.local.get([S.subColor, S.subBg, S.subFont, S.subOutline, S.subEdge, S.sbModes, S.showTimeline, S.skipNotice]).then(d => {
  if ($('subEdge')) $('subEdge').value = SUB_EDGE_VALUES.has(d[S.subEdge]) ? d[S.subEdge] : (d[S.subOutline] === false ? 'none' : 'outline');
  if ($('skipNotice')) $('skipNotice').checked = d[S.skipNotice] === true;
  if ($('subColor')) $('subColor').value = /^#[0-9a-f]{6}$/i.test(d[S.subColor] || '') ? d[S.subColor] : '#ffffff';
  if ($('subFont')) $('subFont').value = ['sans', 'serif', 'mono'].includes(d[S.subFont]) ? d[S.subFont] : 'sans';
  const bg = Number.isFinite(Number(d[S.subBg])) && d[S.subBg] !== undefined ? Number(d[S.subBg]) : 38;
  if ($('subBg')) $('subBg').value = String(bg);
  if ($('subBgValue')) $('subBgValue').textContent = bg + '%';
  if ($('subOutline')) $('subOutline').checked = d[S.subOutline] !== false;
  if ($('showTimeline')) $('showTimeline').checked = d[S.showTimeline] !== false;
  const modes = cleanSbModes(d[S.sbModes]);
  document.querySelectorAll('select[data-sb]').forEach(sel => { sel.value = modes[sel.dataset.sb] || ''; });
}).catch(() => {});
$('subColor')?.addEventListener('change', e => br.storage.local.set({ [S.subColor]: e.target.value }).catch(() => {}));
$('subFont')?.addEventListener('change', e => br.storage.local.set({ [S.subFont]: e.target.value }).catch(() => {}));
$('subBg')?.addEventListener('input', e => {
  const v = Math.max(0, Math.min(90, Number.parseInt(e.target.value, 10) || 0));
  if ($('subBgValue')) $('subBgValue').textContent = v + '%';
  br.storage.local.set({ [S.subBg]: v }).catch(() => {});
});
$('subOutline')?.addEventListener('change', e => br.storage.local.set({ [S.subOutline]: !!e.target.checked }).catch(() => {}));
// subtitle_outline is kept in step for devices still on 1.12 (synced prefs).
$('subEdge')?.addEventListener('change', e => {
  const v = SUB_EDGE_VALUES.has(e.target.value) ? e.target.value : 'outline';
  br.storage.local.set({ [S.subEdge]: v, [S.subOutline]: v !== 'none' }).catch(() => {});
});
$('showTimeline')?.addEventListener('change', e => br.storage.local.set({ [S.showTimeline]: !!e.target.checked }).catch(() => {}));
$('skipNotice')?.addEventListener('change', e => br.storage.local.set({ [S.skipNotice]: !!e.target.checked }).catch(() => {}));

// -- Supabase one-time setup helper --
// The anon key cannot create tables (Supabase allows that only to the project
// owner), so the user runs supabase_setup.sql once. This opens the project's SQL
// editor with the script filled in (?content=), offers a copy, and checks again.
function supabaseRef(url) {
  try { const h = new URL(url).hostname.toLowerCase(); return h.endsWith('.supabase.co') ? h.split('.')[0] : null; } catch { return null; }
}
async function setupSql() {
  try { const r = await fetch(br.runtime.getURL('supabase_setup.sql')); return r.ok ? await r.text() : ''; } catch { return ''; }
}
async function showSbSetup(url) {
  const box = $('sbSetup'); if (!box) return;
  box.hidden = false;
  const ref = supabaseRef(url);
  const sql = await setupSql();
  const link = $('sbOpenSql');
  if (link) {
    const base = ref ? 'https://supabase.com/dashboard/project/' + ref + '/sql/new' : 'https://supabase.com/dashboard';
    const enc = sql ? encodeURIComponent(sql) : '';
    link.href = ref && enc && enc.length < 60000 ? base + '?content=' + enc : base;
  }
}
function hideSbSetup() { const box = $('sbSetup'); if (box) box.hidden = true; }
$('sbCopySql')?.addEventListener('click', async () => {
  const st = $('sbSetupStatus'); const sql = await setupSql();
  try { await navigator.clipboard.writeText(sql); if (st) st.textContent = 'Script copied. Paste it into a new query in the Supabase SQL editor and press Run.'; }
  catch (_) { if (st) st.textContent = 'Copy did not work here. Open supabase_setup.sql from the SkipStream GitHub page instead.'; }
});
$('sbRecheck')?.addEventListener('click', async () => {
  const st = $('sbSetupStatus'); if (st) st.textContent = 'Checking...';
  const d = await br.storage.local.get([S.supabaseUrl, S.supabaseAnonKey]);
  const ok = await verifySupabase(d[S.supabaseUrl], d[S.supabaseAnonKey]);
  if (st) st.textContent = ok ? 'Done. Cloud sync is on.' : 'Not found yet. Make sure Run finished without errors in Supabase, then check again.';
});
document.querySelectorAll('select[data-sb]').forEach(sel => sel.addEventListener('change', async () => {
  const cur = cleanSbModes((await br.storage.local.get(S.sbModes))[S.sbModes]);
  if (sel.value) cur[sel.dataset.sb] = sel.value; else delete cur[sel.dataset.sb];
  br.storage.local.set({ [S.sbModes]: cur }).catch(() => {});
}));

function ssSystemMode() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch (e) { return 'dark'; }
}


// -- Apply dynamic theme on load --
br.storage.local.get(['skipstream_seed_color', 'skipstream_theme']).then(data => {
  if (window.applyThemeFromSeed) applyThemeFromSeed(data.skipstream_seed_color || '#57A860', data.skipstream_theme || ssSystemMode());
}).catch(() => {});

br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.skipstream_seed_color && !changes.skipstream_theme) return;
  br.storage.local.get(['skipstream_seed_color', 'skipstream_theme']).then(d => {
    if (window.applyThemeFromSeed) applyThemeFromSeed(d.skipstream_seed_color || '#57A860', d.skipstream_theme || ssSystemMode());
  }).catch(() => {});
});

// -- DOM-safe helper: replaces spinner+label pattern --
function setSpinnerLabel(el, text) {
  el.replaceChildren();
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  el.appendChild(spinner);
  el.appendChild(document.createTextNode(text));
}

// -- Version badge --
const manifest = br.runtime.getManifest();
const sidebarVerEl = $('sidebarVer');
if (sidebarVerEl) sidebarVerEl.textContent = 'v' + manifest.version;

// -- Sidebar nav --
const navItems = document.querySelectorAll('.nav-item[data-panel]');
const panels   = document.querySelectorAll('.panel');

function showPanel(id) {
  panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
  navItems.forEach(n => {
    const isActive = n.dataset.panel === id;
    n.classList.toggle('active', isActive);
    if (isActive) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  history.replaceState(null, '', '#' + id);
  if (id === 'stats') {
    br.storage.local.get([S.stats]).then(d => loadStats(d)).catch(() => {});
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => showPanel(item.dataset.panel));
});

// Deep-link from popup (History / Stats buttons open options with #hash)
const HASH_REDIRECTS = { exportimport: 'dataadvanced', advanced: 'dataadvanced', subtitles: 'dataadvanced', skipbehavior: 'connections' };
const rawHash = location.hash.replace('#', '');
const initialHash = HASH_REDIRECTS[rawHash] || rawHash;
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
// NOTE: IntroDB reads are public, so skipping works with no key. The key is only
// for submitting timings (POST /submit, X-API-Key). This check confirms the
// service is reachable; a key cannot be validated without a real submit.
async function verifyIntrodb(key) {
  const dotMain  = $('dot-introdb');
  const msgMain  = $('msg-introdb');
  const dotCard  = $('dot-introdb-card');
  const alertEl  = $('alert-introdb');

  [dotMain, dotCard].forEach(d => d && (d.className = 'status-dot checking'));
  if (msgMain) { msgMain.className = 'status-msg'; msgMain.textContent = 'Checking...'; }
  setNavDot('introdb', 'checking');

  try {
    // Reachability check only - this endpoint is public and ignores the key.
    const r = await fetch('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    if (r.ok) {
      setDot(dotMain, 'ok', key ? 'Reachable - key saved for submitting timings' : 'Reachable - no key needed to skip', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('introdb', 'ok');
      if (alertEl) hideAlert(alertEl);
      return true;
    }
    setDot(dotMain, 'warn', 'IntroDB returned HTTP ' + r.status, msgMain);
    setDot(dotCard, 'warn');
    setNavDot('introdb', 'warn');
    return false;
  } catch (e) {
    setDot(dotMain, 'warn', 'Network error reaching IntroDB', msgMain);
    setDot(dotCard, 'warn');
    setNavDot('introdb', 'warn');
    return false;
  }
}

// -- Verify: Supabase --
// Supabase keys (1.13): legacy anon keys are JWTs and go in apikey and as Bearer.
// New publishable keys (sb_publishable_...) are not JWTs. Supabase says: send
// them in apikey only, never as a Bearer token.
function sbAuth(key) {
  const k = String(key || '').trim();
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(k) && !k.startsWith('sb_') ? { apikey: k, Authorization: 'Bearer ' + k } : { apikey: k };
}

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
    const r = await fetch(base + '/rest/v1/rpc/ss_verify_setup', {
      method: 'POST',
      headers: {
        ...sbAuth(key),
        'Content-Type': 'application/json'
      },
      body: '{}'
    });

    if (r.ok) {
      setDot(dotMain, 'ok', 'Connected - cloud sync active', msgMain);
      setDot(dotCard, 'ok');
      setNavDot('supabase', 'ok');
      if (alertEl) hideAlert(alertEl);
      [sqlEl, sqlEl2].forEach(el => { if (el) el.className = 'alert'; });
      hideSbSetup();
      return true;
    }

    if (r.status === 404 || r.status === 406) {
      const sqlMsg = 'Connected, but the SkipStream tables are not in your project yet. Run the setup script once (below).';
      setDot(dotMain, 'warn', 'Connected, setup script not run yet', msgMain);
      setDot(dotCard, 'warn');
      setNavDot('supabase', 'warn');
      [sqlEl, sqlEl2].forEach(el => { if (el) showAlert(el, 'warn', sqlMsg); });
      showSbSetup(base);
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
    // v4 read token (three-part JWT) -> Bearer; v3 key -> ?api_key= (same rule as background tmdbFetch)
    const k = String(key).trim();
    const r = k.split('.').length === 3
      ? await fetch('https://api.themoviedb.org/3/configuration', { headers: { Authorization: 'Bearer ' + k } })
      : await fetch('https://api.themoviedb.org/3/configuration?api_key=' + encodeURIComponent(k));
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
async function osubEnsureLogin() {
  const data = await br.storage.local.get([S.osobUsername, S.osobPassword]);
  const user = (data[S.osobUsername] || '').trim();
  const pass = (data[S.osobPassword] || '').trim();

  const status = await bgSend({ type: 'OSUB_STATUS' });
  if (status?.loggedIn) return status;
  if (!user || !pass) return { loggedIn: false, anonymous: true };

  const login = await bgSend({ type: 'OSUB_LOGIN', username: user, password: pass });
  if (!login || !login.ok) {
    return { loggedIn: false, anonymous: false };
  }
  return bgSend({ type: 'OSUB_STATUS' });
}

async function verifyAll() {
  const data = await br.storage.local.get([
    S.introdbApiKey, S.supabaseUrl, S.supabaseAnonKey,
    S.tmdbApiKey, S.animeSkipEnabled, S.animeSkipClientId
  ]);
  setNavDot('connections', 'checking');
  await Promise.all([
    verifyIntrodb(data[S.introdbApiKey]),
    verifySupabase(data[S.supabaseUrl], data[S.supabaseAnonKey]),
    verifyTmdb(data[S.tmdbApiKey]),
    verifyAnimeskip(data[S.animeSkipEnabled], data[S.animeSkipClientId]),
  ]);
  const res = await osubEnsureLogin();
  const dotOsub = $('dot-osub');
  const msgOsub = $('msg-osub');
  if (res?.loggedIn) {
    const msg = res.downloads_remaining != null
      ? `Logged in - ${res.downloads_remaining} downloads remaining today`
      : 'Logged in';
    if (dotOsub) dotOsub.className = 'status-dot ok';
    if (msgOsub) { msgOsub.className = 'status-msg ok'; msgOsub.textContent = msg; }
  } else {
    if (dotOsub) dotOsub.className = 'status-dot warn';
    if (msgOsub) { msgOsub.className = 'status-msg warn'; msgOsub.textContent = 'Anonymous - 5 downloads/day (login to increase)'; }
  }
  const d = $('dot-introdb');
  const overall = d?.classList.contains('ok') ? 'ok' :
    d?.classList.contains('warn') ? 'warn' : 'err';
  setNavDot('connections', overall);
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
  if ($('deviceName'))         $('deviceName').value         = data[S.deviceName]         || '';
  if ($('osobUsername'))       $('osobUsername').value       = data[S.osobUsername]       || '';
  if ($('osobPassword'))       $('osobPassword').value       = data[S.osobPassword]       || '';
  if ($('subLanguage'))        $('subLanguage').value        = data[S.subLanguage]        || 'en';
  if ($('subFontSize'))        $('subFontSize').value        = data[S.subFontSize]        || 18;
  if ($('subFontSizeValue'))   $('subFontSizeValue').textContent = (parseInt(data[S.subFontSize], 10) || 18) + 'px';

  const osubStatus = await osubEnsureLogin();
  const dotOsub = $('dot-osub');
  if (dotOsub) {
    if (osubStatus?.loggedIn) {
      setDot(dotOsub, 'ok');
      const msg = osubStatus.downloads_remaining != null ? `Logged in — ${osubStatus.downloads_remaining} downloads remaining today` : 'Logged in';
      showAlert($('alert-osub'), 'ok', msg);
    } else {
      setDot(dotOsub, '');
    }
  }

  loadStats(data);
  loadSiteRules(data[S.siteRules] || data['skipstream_site_rules'] || {});
  // Pull cloud settings if Supabase configured and cloud is newer
  try {
    const userId = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
    if (userId) {
      const cloudResult = await bgSend({ type: 'SUPABASE_SETTINGS_GET', userId });
      if (cloudResult?.data?.prefs) {
        // Only apply cloud prefs if local has no skipMode set (fresh install / new device)
        const hasLocal = !!data[S.skipMode];
        if (!hasLocal) {
          const safe = {};
          for (const k of CLOUD_PREF_ALLOW) if (cloudResult.data.prefs[k] !== undefined && !DENY.has(k)) safe[k] = cloudResult.data.prefs[k];
          if (Object.keys(safe).length) await br.storage.local.set(safe);
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
    setSpinnerLabel(saveIntrodbBtn, 'Verifying...');
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
    setSpinnerLabel(saveSupabaseBtn, 'Verifying...');
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
    setSpinnerLabel(saveTmdbBtn, 'Verifying...');
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
    setSpinnerLabel(saveAnimeskipBtn, 'Verifying...');
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

// -- Per-site rules --
let siteRules = {};

function renderSiteRules() {
  const list = $('siteRulesList');
  if (!list) return;
  list.replaceChildren();
  const domains = Object.keys(siteRules);
  if (!domains.length) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.cssText = 'font-size:12px;color:var(--text3);padding:4px 0';
    emptyMsg.textContent = 'No rules yet. Add a domain below.';
    list.appendChild(emptyMsg);
    return;
  }
  domains.forEach(domain => {
    const row = document.createElement('div');
    row.className = 'site-rule-row';
    const domainSpan = document.createElement('span');
    domainSpan.className = 'site-rule-domain';
    domainSpan.textContent = domain;
    const modeSpan = document.createElement('span');
    modeSpan.className = 'site-rule-mode';
    modeSpan.textContent = siteRules[domain];
    const delBtn = document.createElement('button');
    delBtn.className = 'site-rule-del';
    delBtn.dataset.domain = domain;
    delBtn.title = 'Remove rule';
    delBtn.textContent = 'x';
    row.appendChild(domainSpan);
    row.appendChild(modeSpan);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
  list.querySelectorAll('.site-rule-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      delete siteRules[btn.dataset.domain];
      await br.storage.local.set({ [S.siteRules]: siteRules });
      renderSiteRules();
      try {
        const uid = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
        if (uid) bgSend({
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
      const uid = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
      if (uid) bgSend({
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
  const valEl = document.createElement('div');
  valEl.className = 'stat-val';
  valEl.textContent = val;
  const lblEl = document.createElement('div');
  lblEl.className = 'stat-lbl';
  lblEl.textContent = lbl;
  d.appendChild(valEl);
  d.appendChild(lblEl);
  return d;
}

function loadStats(data) {
  const stats = data[S.stats] || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0, skipsToday: 0, statsDate: '' };
  const today = new Date().toDateString();
  const skipsToday = stats.statsDate === today ? (stats.skipsToday || 0) : 0;
  const totalSkips = stats.skipsTotal    || 0;
  const totalTime  = stats.timeSavedSec  || 0;
  const todayTime = (stats.statsDate === today) ? (stats.timeSavedToday || 0) : 0;
  const sessions   = stats.sessionsTotal || 0;
  const siteCounts = stats.skipsBySite && typeof stats.skipsBySite === 'object' ? stats.skipsBySite : null;

  const sessionGrid = $('statsGrid');
  const allGrid     = $('statsAllGrid');
  const siteGrid    = $('statsSiteBreakdown');

  if (sessionGrid) {
    sessionGrid.replaceChildren();
    sessionGrid.appendChild(makeStatCard(skipsToday, 'Skips today'));
    sessionGrid.appendChild(makeStatCard(fmtTime(todayTime), 'Time saved today'));
  }
  if (allGrid) {
    allGrid.replaceChildren();
    allGrid.appendChild(makeStatCard(totalSkips, 'Total skips'));
    allGrid.appendChild(makeStatCard(sessions,   'Sessions'));
    allGrid.appendChild(makeStatCard(fmtTime(totalTime), 'Total time saved'));
  }

  if (siteGrid) {
    siteGrid.replaceChildren();
    if (siteCounts) {
      const entries = Object.entries(siteCounts)
        .filter(([site, count]) => !!site && Number.isFinite(Number(count)) && Number(count) > 0)
        .map(([site, count]) => [site.replace(/^www\./i, ''), Number(count)])
        .sort((a, b) => b[1] - a[1]);

      if (entries.length > 0) {
        const card = document.createElement('div');
        card.className = 'card';
        const header = document.createElement('div');
        header.className = 'card-header';
        const icon = document.createElement('div');
        icon.className = 'card-icon blue';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'var(--accent)');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p1.setAttribute('d', 'M1 1v14h14');
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p2.setAttribute('d', 'M4 11l3-4 3 2 4-5');
        svg.appendChild(p1);
        svg.appendChild(p2);
        icon.appendChild(svg);
        const titleWrap = document.createElement('div');
        titleWrap.className = 'card-title-wrap';
        const title = document.createElement('h2');
        title.className = 'card-title';
        title.textContent = 'Top Sites';
        titleWrap.appendChild(title);
        header.appendChild(icon);
        header.appendChild(titleWrap);
        card.appendChild(header);
        const body = document.createElement('div');
        body.className = 'card-body';
        const grid = document.createElement('div');
        grid.className = 'stats-grid';
        entries.slice(0, 8).forEach(([name, count]) => grid.appendChild(makeStatCard(count, name)));
        body.appendChild(grid);
        if (entries.length > 8) {
          const more = document.createElement('p');
          more.style.cssText = 'font-size:11px;color:var(--text3);margin-top:12px;text-align:center';
          more.textContent = `+${entries.length - 8} more sites`;
          body.appendChild(more);
        }
        card.appendChild(body);
        siteGrid.appendChild(card);
      }
    }
  }
}

// -- History --
let historySource = 'merged';
let allHistory    = [];
let historyListenersAttached = false;
let _histLocal = [];
let _histCloud = [];

function _ssTs(item) {
  const v = item.ts ?? item.updated ?? 0;
  if (typeof v === 'number') return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

// One site, one name (1.13): "www.", "m." and "mobile." hosts are the same site,
// and a page saved under both is one history entry.
function canonHost(h) {
  let x = String(h || '').toLowerCase().trim();
  for (;;) {
    const y = x.replace(/^(?:www\d?|m|mobile|mbasic|touch)\./, '');
    if (y === x || !y.includes('.')) return x;
    x = y;
  }
}
function canonMediaKey(id) {
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/.*)?$/i.exec(String(id || ''));
  return m ? canonHost(m[1]) + (m[2] || '') : String(id || '');
}

function getHistoryItems() {
  if (historySource === 'local') return _histLocal;
  if (historySource === 'cloud') return _histCloud;

  const merged = new Map();
  for (const item of [..._histLocal, ..._histCloud]) {
    const key = canonMediaKey(item.mediaId) || item.url || item.title || '';
    if (!key) {
      merged.set(`${Math.random()}:${Math.random()}`, item);
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    const existingTs = _ssTs(existing);
    const nextTs = _ssTs(item);
    if (nextTs > existingTs) merged.set(key, item);
  }

  return [...merged.values()].sort((a, b) => _ssTs(b) - _ssTs(a));
}

// In-memory poster cache: title -> poster_url (null = not found)
const _posterCache = {};

// Concurrency-limited queue - avoids firing 50-100 TMDB calls at once on large history
let _posterInFlight = 0;
const _posterQueue = [];
const POSTER_MAX_CONCURRENT = 4;

function scheduleFetchPoster(title, itemEl, mediaId) {
  _posterQueue.push([title, itemEl, mediaId]);
  drainPosterQueue();
}

function drainPosterQueue() {
  while (_posterInFlight < POSTER_MAX_CONCURRENT && _posterQueue.length) {
    const [title, itemEl, mediaId] = _posterQueue.shift();
    _posterInFlight++;
    fetchPoster(title, itemEl, mediaId).finally(() => {
      _posterInFlight--;
      drainPosterQueue();
    });
  }
}

async function fetchPoster(title, itemEl, mediaId) {
  if (!title) return;
  const key = title.toLowerCase().trim();
  if (key in _posterCache) {
    if (_posterCache[key]) applyPoster(itemEl, _posterCache[key]);
    return;
  }
  try {
    const result = await bgSend({ type: 'TMDB_SEARCH_POSTER', title, mediaId });
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
  // Only the bare page address goes to Spotify / SoundCloud: no query string or
  // fragment (share ids, session tokens, playlist context).
  pageUrl = String(pageUrl || '').split(/[?#]/)[0];
  if (!/^https:\/\/(open\.spotify\.com|(www\.|m\.)?soundcloud\.com)\//.test(pageUrl)) return;
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
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'h-empty';
    empty.appendChild(document.createTextNode('No history yet.'));
    empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('Start watching to build your log.'));
    list.appendChild(empty);
    return;
  }
  const search = ($('historySearch') || {}).value || '';
  const filter = ($('historyFilter') || {}).value || '';
  const filtered = items.filter(item => {
    const title = (item.title || item.videoTitle || '').toLowerCase();
    const site = canonHost(item.site || item.siteName);
    return (!search || title.includes(search.toLowerCase()))
      && (!filter || site === filter.toLowerCase());
  });

  if (!filtered.length) {
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'h-empty';
    empty.textContent = 'No matches found.';
    list.appendChild(empty);
    return;
  }

  list.replaceChildren();
  filtered.slice(0, 300).forEach(item => {
    const title   = item.title || item.videoTitle || 'Unknown';
    const site    = canonHost(item.site) || item.siteName || '';
    const pos     = item.position || item.currentTime || 0;
    const dur     = item.duration || 0;
    const pct     = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
    const isCloud = !!item.fromCloud;
    const url     = item.url || item.pageUrl || '#';
    const posStr  = pos > 0 ? fmtTime(Math.round(pos)) : '';
    const dateStr = fmtDate(item.updated);

    const el = document.createElement('a');
    el.className = 'h-item';
    el.href = (url && (url.startsWith('http://') || url.startsWith('https://'))) ? url : '#';
    if (item.mediaId && pos >= 10) {
      el.addEventListener('click', () => {
        br.storage.local.set({
          skipstream_pending_resume: { mediaId: item.mediaId, position: pos, ts: Date.now() }
        }).catch(() => {});
      });
    }
    el.target = '_blank';
    el.rel = 'noopener';

    const inner = document.createElement('div');
    inner.className = 'h-item-inner';

    const poster = document.createElement('img');
    poster.className = 'h-poster';
    poster.src = '';
    poster.alt = '';
    poster.style.cssText = 'display:none;width:36px;height:54px;object-fit:cover;border-radius:4px;flex-shrink:0;';
    inner.appendChild(poster);

    const body = document.createElement('div');
    body.className = 'h-item-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'h-title';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = 'h-meta';
    if (site) {
      const siteEl = document.createElement('span');
      siteEl.className = 'h-site';
      siteEl.textContent = site;
      meta.appendChild(siteEl);
    }
    if (isCloud) {
      const cloudEl = document.createElement('span');
      cloudEl.className = 'h-cloud';
      cloudEl.textContent = 'Cloud';
      meta.appendChild(cloudEl);
    }
    if (item.device) {
      const deviceEl = document.createElement('span');
      deviceEl.className = 'h-device';
      deviceEl.textContent = item.device;
      meta.appendChild(deviceEl);
    }
    if (posStr) {
      const posEl = document.createElement('span');
      posEl.textContent = posStr;
      meta.appendChild(posEl);
    }
    if (pct > 0) {
      const pctEl = document.createElement('span');
      pctEl.textContent = pct + '%';
      meta.appendChild(pctEl);
    }
    if (dateStr) {
      const dateEl = document.createElement('span');
      dateEl.textContent = dateStr;
      meta.appendChild(dateEl);
    }
    body.appendChild(meta);

    if (pct > 0) {
      const bar = document.createElement('div');
      bar.className = 'h-bar';
      const fill = document.createElement('div');
      fill.className = 'h-fill';
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      body.appendChild(bar);
    }

    inner.appendChild(body);
    el.appendChild(inner);
    list.appendChild(el);
    const ytThumb = getYoutubeThumb(url);
    const isYoutubeish = /youtube|youtu\.be/i.test(site || '');
    const oembedPlatform = getOembedSite(site);
    if (ytThumb) {
      applyPoster(el, ytThumb);
    } else if (oembedPlatform) {
      const pageUrl = url && url.startsWith('http') ? url : (url ? 'https://' + url : '');
      fetchOembedThumb(pageUrl, oembedPlatform, el);
    } else if (item.mediaId && /^yt\/[A-Za-z0-9_-]{11}$/.test(item.mediaId)) {
      scheduleFetchPoster(title || 'video', el, item.mediaId);
    } else if (!isYoutubeish && title && title !== 'Unknown') {
      scheduleFetchPoster(title, el, item.mediaId);
    }
  });
}

async function loadHistory(data) {
  const list = $('historyList');
  if (!list) return;

  _histLocal = [];
  try {
    const raw = await br.storage.local.get('skipstream_cache');
    const cache = raw['skipstream_cache'] || {};
    _histLocal = Object.entries(cache).map(([mediaId, entry]) => ({
      title:    entry.title    || '',
      site:     canonHost(entry.site),
      siteName: entry.site_name || entry.site || '',
      url:      entry.url      || mediaId,
      position: entry.p        || 0,
      mediaId,
      duration: entry.d        || 0,
      ts:       entry.t        || 0,
      fromCloud: false,
    })).filter(e => e.title).sort((a, b) => b.ts - a.ts);
    _histLocal.forEach(e => { e.updated = e.ts; });
  } catch (_) {}

  let cloudItems = [];
  const url = data[S.supabaseUrl];
  const key = data[S.supabaseAnonKey];
  const syncDot  = $('syncDot');
  const syncText = $('syncText');

  if (url && key) {
    try {
      const userId = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
      if (userId) {
        const result = await bgSend({ type: 'SUPABASE_GET_ALL', userId });
        // An empty cloud list is real (history cleared elsewhere): show it as empty.
        if (Array.isArray(result?.data)) {
          _histCloud = result.data.map(row => ({
            title:    row.video_title || '',
            site:     canonHost(row.site) || row.site_name || '',
            siteName: row.site_name   || '',
            url:      row.page_url    || '',
            position: row.playback_time || 0,
            duration: row.duration    || 0,
            device:   row.device_name || '',
            updated:  row.updated_at  || '',
            mediaId:  row.media_id    || '',
            fromCloud: true,
          })).filter(r => r.title);
          cloudItems = _histCloud;
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
    const sites = [...new Set((getHistoryItems() || []).map(i => canonHost(i.site || i.siteName)).filter(Boolean))].sort();
    filterEl.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All sites';
    filterEl.appendChild(allOpt);
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      filterEl.appendChild(opt);
    });
  }

  allHistory = getHistoryItems();
  renderHistory(allHistory);

  if (!historyListenersAttached) {
  historyListenersAttached = true;
  document.querySelectorAll('.source-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      historySource = pill.dataset.source;
      document.querySelectorAll('.source-pill').forEach(p => p.classList.toggle('active', p === pill));
      allHistory = getHistoryItems();
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
      const syncText = $('syncText');
      try {
        const userId = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
        if (userId) {
          const raw = await br.storage.local.get('skipstream_cache');
          const cache = raw['skipstream_cache'] || {};
          const entries = Object.entries(cache);
          // Newer-wins: read the cloud first and only push rows this device changed
          // more recently. A failed read aborts: pushing blind overwrote other devices.
          const cloud = await bgSend({ type: 'SUPABASE_GET_ALL', userId });
          if (!cloud || !Array.isArray(cloud.data)) throw new Error('cloud read failed: ' + (cloud?.err || 'no data'));
          const cloudTs = {};
          for (const row of cloud.data) if (row && row.media_id) cloudTs[row.media_id] = new Date(row.updated_at || 0).getTime() || 0;
          for (const [mediaId, entry] of entries) {
            if (!entry.p || !entry.title) continue;
            const localTs = Number(entry.t) || 0;
            if (mediaId in cloudTs && cloudTs[mediaId] >= localTs) continue;
            const r = await bgSend({
              type: 'SUPABASE_UPSERT',
              body: {
                user_id:      userId,
                media_id:     mediaId,
                playback_time: Math.floor(entry.p),
                duration:     entry.d || 0,
                site:         entry.site || '',
                site_name:    entry.site_name || entry.site || '',
                video_title:  entry.title || '',
                page_url:     entry.url   || '',
                device_name:  'SkipStream Options Sync',
                ...(localTs ? { updated_at: new Date(Math.min(localTs, Date.now())).toISOString() } : {}),
              }
            });
            if (r && r.ok) pushed++; else { failed++; pushErr = r?.err || pushErr; }
          }
          await br.storage.local.set({ skipstream_last_sync: Date.now() });
        } else {
          failed++;
          pushErr = 'no_user_id';
        }
        await loadHistory(data);
      } catch (e) {
        failed++;
        pushErr = String(e);
      } finally {
        syncBtn.textContent = 'Sync';
        if (syncText) {
          if (failed === 0) {
            syncText.textContent = `Synced: ${pushed} entries pushed`;
          } else if (pushed > 0) {
            syncText.textContent = `Sync: ${pushed} pushed, ${failed} failed`;
          } else {
            syncText.textContent = 'Sync failed: ' + (pushErr || 'unknown error');
          }
        }
      }
    });
  }
  }
}

// -- Backup v2 (3 Oct 2026) --
// One file restores the whole extension on another browser or after a reinstall:
// settings, per-site rules, stats and local history (merged, newer wins). On
// request it also carries the sync identity, which links this browser's history
// to the one you restore on, and your API keys and logins, encrypted with a
// passphrase (AES-GCM, key from PBKDF2-SHA-256 with 600,000 rounds). Without the
// passphrase they cannot be read. Caches, sessions, queues and the error log
// are never exported. Version 1 files (1.10 and older) still import.
function backupKit(subtle, randomBytes) {
  const SETTINGS = ['skipEnabled', 'skipMode', 'skipIntro', 'skipRecap', 'skipOutro', 'resumePlayback',
    'autoNextEpisode', 'playbackSpeed', 'animeSkipEnabled', 'skipstream_site_rules', 'deviceName',
    'subtitle_language', 'subtitle_font_size', 'subtitle_enabled', 'subtitle_sync', 'subtitle_drag_pos',
    'skipstream_theme', 'skipstream_seed_color',
    'subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'subtitle_edge', 'subtitle_offsets', 'sbModes', 'showTimeline', 'skipNotice'];
  const STATS = ['skipstream_stats', 'statsSkipsToday', 'statsDate', 'statsTotalSkips', 'statsTotalTimeSaved', 'statsSessions'];
  const SECRETS = ['supabaseUrl', 'supabaseAnonKey', 'introdbApiKey', 'tmdbApiKey', 'animeSkipClientId',
    'animeSkipAuthToken', 'osub_username', 'osub_password'];
  const ITER = 600000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HISTORY_MAX = 300;   // same as the local cache (content.js CACHE_MAX)
  const enc = new TextEncoder();
  const b64 = u8 => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(String(s)), ch => ch.charCodeAt(0));
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  async function keyFor(pass, salt, iter, use) {
    const base = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, [use]);
  }
  async function seal(obj, pass) {
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = await keyFor(pass, salt, ITER, 'encrypt');
    const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    return { alg: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }
  async function unseal(box, pass) {
    if (!isObj(box) || box.alg !== 'AES-GCM' || !Number.isInteger(box.iter) || box.iter < 100000 || box.iter > 5000000) throw new Error('bad_secrets');
    const key = await keyFor(pass, unb64(box.salt), box.iter, 'decrypt');
    let plain;
    try { plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data)); }
    catch { throw new Error('wrong_passphrase'); }
    const obj = JSON.parse(new TextDecoder().decode(plain));
    if (!isObj(obj)) throw new Error('bad_secrets');
    return obj;
  }

  function mergeHistory(mine, theirs) {
    const out = { ...(isObj(mine) ? mine : {}) };
    let taken = 0;
    for (const [id, e] of Object.entries(isObj(theirs) ? theirs : {})) {
      if (!isObj(e) || typeof e.p !== 'number' || !Number.isFinite(e.p)) continue;
      if (!out[id] || Number(e.t || 0) > Number(out[id].t || 0)) { out[id] = e; taken++; }
    }
    const keys = Object.keys(out);
    if (keys.length > HISTORY_MAX) {
      keys.sort((x, y) => Number(out[y].t || 0) - Number(out[x].t || 0)).slice(HISTORY_MAX).forEach(k => delete out[k]);
    }
    return { merged: out, taken };
  }

  async function buildBackup(all, { passphrase = '', includeIdentity = false, appVersion = '', now = '' } = {}) {
    const out = { format: 'skipstream-backup', schemaVersion: 2, appVersion, exportedAt: now,
      settings: {}, stats: {}, history: isObj(all.skipstream_cache) ? all.skipstream_cache : {} };
    for (const k of SETTINGS) if (k in all) out.settings[k] = all[k];
    for (const k of STATS) if (k in all) out.stats[k] = all[k];
    if (includeIdentity && UUID.test(String(all.skipstream_install_id || ''))) out.identity = { installId: all.skipstream_install_id };
    if (passphrase) {
      const sec = {};
      for (const k of SECRETS) if (typeof all[k] === 'string' && all[k]) sec[k] = all[k];
      if (Object.keys(sec).length) out.secrets = await seal(sec, passphrase);
    }
    return out;
  }

  // Returns what to write; throws need_passphrase / wrong_passphrase / bad_file and then nothing is written.
  async function readBackup(file, existing, { passphrase = '', valueOk, mergeStats, migrate, legacyKeys } = {}) {
    if (!isObj(file)) throw new Error('bad_file');
    const set = {}, skipped = [];
    const report = { settings: 0, history: 0, secrets: 0 };
    let installId = null;
    const take = (k, v) => { if (valueOk(k, v)) { set[k] = v; return true; } skipped.push(k); return false; };
    const statsInto = (src) => {
      for (const k of STATS) {
        if (!(k in src)) continue;
        const v = src[k];
        if (k === 'skipstream_stats') { if (isObj(v)) set[k] = mergeStats(isObj(existing[k]) ? existing[k] : {}, v); else skipped.push(k); }
        else if (typeof v === 'number' && Number.isFinite(v) && typeof existing[k] === 'number') set[k] = Math.max(existing[k], v);
        else take(k, v);
      }
    };
    const rulesInto = (v) => {
      if (!isObj(v)) { skipped.push('skipstream_site_rules'); return; }
      set.skipstream_site_rules = { ...(isObj(existing.skipstream_site_rules) ? existing.skipstream_site_rules : {}), ...v };
      report.settings++;
    };
    const historyInto = (v) => {
      if (!isObj(v)) return;
      const { merged, taken } = mergeHistory(existing.skipstream_cache, v);
      set.skipstream_cache = merged; report.history = taken;
    };

    if (file.format === 'skipstream-backup') {
      if (file.schemaVersion !== 2) throw new Error('bad_file');
      if (file.secrets && !passphrase) throw new Error('need_passphrase');
      for (const [k, v] of Object.entries(isObj(file.settings) ? file.settings : {})) {
        if (!SETTINGS.includes(k)) continue;
        if (k === 'skipstream_site_rules') rulesInto(v);
        else if (take(k, v)) report.settings++;
      }
      statsInto(isObj(file.stats) ? file.stats : {});
      historyInto(file.history);
      if (file.secrets) {
        const sec = await unseal(file.secrets, passphrase);
        for (const k of SECRETS) {
          if (typeof sec[k] === 'string' && sec[k] && sec[k].length <= 4096) { set[k] = sec[k]; report.secrets++; }
        }
      }
      if (isObj(file.identity) && UUID.test(String(file.identity.installId || ''))) installId = file.identity.installId;
      return { set, installId, report, skipped };
    }

    // Version 1 (flat keys). Credentials were never in these files.
    const data = migrate({ ...file });
    for (const [k, v] of Object.entries(data)) {
      if (!legacyKeys.includes(k)) continue;
      if (k === 'skipstream_cache') historyInto(v);
      else if (k === 'skipstream_site_rules') rulesInto(v);
      else if (STATS.includes(k)) statsInto({ [k]: v });
      else if (take(k, v)) report.settings++;
    }
    return { set, installId, report, skipped };
  }

  return { buildBackup, readBackup, mergeHistory, SETTINGS, STATS, SECRETS };
}

const BACKUP = backupKit(crypto.subtle, n => crypto.getRandomValues(new Uint8Array(n)));

// -- Export --
const exportBtn = $('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const withSecrets = !!$('backupSecrets')?.checked;
    const pass = $('backupPass')?.value || '';
    if (withSecrets && pass.length < 8) {
      showAlert($('alert-export'), 'err', 'Type a passphrase of at least 8 characters to include keys and logins.');
      return;
    }
    const note = withSecrets
      ? 'This file holds your keys and logins, locked with your passphrase. Without the passphrase they cannot be restored. Continue?'
      : 'This file holds your settings and history, without keys or logins. Continue?';
    if (!confirm(note)) return;
    try {
      const all = await br.storage.local.get(null);
      const data = await BACKUP.buildBackup(all, {
        passphrase: withSecrets ? pass : '', includeIdentity: !!$('backupIdentity')?.checked,
        appVersion: br.runtime.getManifest?.()?.version || '', now: new Date().toISOString(),
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = 'skipstream-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      showAlert($('alert-export'), 'ok', 'Backup saved to your Downloads folder.');
    } catch (e) {
      showAlert($('alert-export'), 'err', 'Export failed: ' + e.message);
    }
  });
}

// -- Import migration shim: handles schema changes from 1.6.5 and earlier --
// H18: an imported value must have the type the extension reads, or it is skipped.
const IMPORT_BOOL = new Set([S.animeSkipEnabled, S.skipIntro, S.skipRecap, S.skipOutro, S.resumePlayback,
  S.autoNextEpisode, S.subEnabled, S.skipEnabled, S.subOutline, S.showTimeline, S.skipNotice]);
const IMPORT_MODES = new Set(['off', 'prompt', 'auto-intro', 'auto-recap', 'auto-outro', 'auto-all']);
function importValueOk(key, v) {
  const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  if (IMPORT_BOOL.has(key)) return typeof v === 'boolean';
  switch (key) {
    case S.skipMode:     return IMPORT_MODES.has(v);
    case S.playbackRate: return num(Number(v), 0.25, 4) && (typeof v === 'number' || typeof v === 'string');
    case S.subLanguage:  return typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v);
    case S.subFontSize:  return num(Number(v), 10, 48);
    case S.subSync:      return num(Number(v), -600, 600);
    case S.subDragPos:   return !!v && typeof v === 'object' && !Array.isArray(v) && num(v.x, 0, 100) && num(v.bottom, 0, 100);
    case S.deviceName:   return typeof v === 'string' && v.length <= 64;
    case S.theme:        return v === 'light' || v === 'dark';
    case S.themeSeed:    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    case S.subColor:     return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    case S.subBg:        return num(Number(v), 0, 90) && typeof v === 'number';
    case S.subFont:      return v === 'sans' || v === 'serif' || v === 'mono';
    case S.subEdge:      return SUB_EDGE_VALUES.has(v);
    case S.sbModes:      return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 12 && Object.values(v).every(x => SB_MODE_VALUES.has(x));
    case S.subOffsets:   return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 200 && Object.entries(v).every(([k, x]) => /^tt\d{7,8}$/.test(k) && num(Number(x), -600, 600));
    case S.siteRules:
    case S.cache:
    case S.stats:        return !!v && typeof v === 'object' && !Array.isArray(v);
    case S.statsDate:    return typeof v === 'string' && v.length <= 40;
    default:             return v === null || ['string', 'number', 'boolean'].includes(typeof v);
  }
}

function mergeImportedStats(mine, backup) {
  const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const out = { ...mine };
  for (const k of ['skipsTotal', 'timeSavedSec', 'sessionsTotal']) out[k] = Math.max(n(mine[k]), n(backup[k]));
  const sites = { ...(mine.skipsBySite || {}) };
  for (const [site, c] of Object.entries(backup.skipsBySite || {})) sites[site] = Math.max(n(sites[site]), n(c));
  out.skipsBySite = sites;
  return out;
}

function migrateImportData(data) {
  // Guard: legacy string fields must actually be strings before being trusted
  // downstream as e.g. HTTP header values. Drops anything malformed instead
  // of passing it through.
  const STR_FIELDS = ['apiKey', 'supabaseKey', 'autoSkip', 'siteRules'];
  for (const f of STR_FIELDS) {
    if (f in data && typeof data[f] !== 'string' && typeof data[f] !== 'boolean' && typeof data[f] !== 'object') {
      delete data[f];
    }
  }
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
const IMPORT_ERRORS = {
  need_passphrase: 'This backup holds keys and logins. Type its passphrase above, then import again. Nothing was changed.',
  wrong_passphrase: 'Wrong passphrase. Nothing was changed.',
  bad_secrets: 'The keys section of this backup is damaged. Nothing was changed.',
  bad_file: 'Not a SkipStream backup file. Nothing was changed.',
};
const importBtn  = $('importBtn');
const importFile = $('importFile');
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1048576) throw new Error('bad_file');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('bad_file'); }
      const existing = await br.storage.local.get(null);
      const res = await BACKUP.readBackup(parsed, existing, {
        passphrase: $('backupPass')?.value || '', valueOk: importValueOk, mergeStats: mergeImportedStats,
        migrate: migrateImportData, legacyKeys: Object.values(S).filter(key => !DENY.has(key)),
      });
      await br.storage.local.set(res.set);
      let link = '';
      if (res.installId) {
        const r = await bgSend({ type: 'ADOPT_INSTALL_ID', installId: res.installId });
        if (r && r.ok) link = r.same ? ' Already linked to that device.' : ' This browser now shares history with the backup\'s browser' + (r.moved ? ' (' + r.moved + ' cloud entries moved over).' : '.');
        else link = ' Devices were NOT linked: this browser\'s cloud history could not be copied. Check the connection and import again.';
      }
      const n = res.report;
      const parts = [n.settings + ' settings', n.history + ' history entries'];
      if (n.secrets) parts.push(n.secrets + ' keys and logins');
      const skipped = res.skipped.length ? ' Skipped (wrong type): ' + res.skipped.join(', ') + '.' : '';
      showAlert($('alert-export'), 'ok', 'Restored ' + parts.join(', ') + '.' + skipped + link + ' Refreshing this page...');
      importFile.value = '';
      setTimeout(() => location.reload(), 4000);
    } catch (e) {
      showAlert($('alert-export'), 'err', IMPORT_ERRORS[e.message] || ('Import failed: ' + e.message));
      importFile.value = '';
    }
  });
}

// -- Clear all --
const clearBtn = $('clearBtn');
if (clearBtn) {
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all SkipStream data? This cannot be undone.')) return;
    await br.storage.local.clear();
    try { await bgSend({ type: 'INVALIDATE_USER_ID' }); } catch (_) {}
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

// -- Advanced: save device name --
const saveAdvancedBtn = $('saveAdvanced');
if (saveAdvancedBtn) {
  saveAdvancedBtn.addEventListener('click', async () => {
    const name = ($('deviceName')?.value || '').trim();
    await br.storage.local.set({ [S.deviceName]: name });
    showAlert($('alert-device'), 'ok', 'Device name saved.');
    setTimeout(() => hideAlert($('alert-device')), 2500);
  });
}

// -- Advanced: clear cloud history --
// -- Advanced: clear local history --
const clearLocalHistoryBtn = $('clearLocalHistoryBtn');
if (clearLocalHistoryBtn) {
  clearLocalHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Remove all local watch history from this device? Cloud history and credentials are unaffected.')) return;
    clearLocalHistoryBtn.disabled = true;
    clearLocalHistoryBtn.textContent = 'Clearing...';
    try {
      await br.storage.local.remove('skipstream_cache');
      _histLocal = [];
      allHistory = getHistoryItems();
      renderHistory(allHistory);
      showAlert($('alert-local'), 'ok', 'Local history cleared.');
    } catch (e) {
      showAlert($('alert-local'), 'err', 'Error: ' + e.message);
    } finally {
      clearLocalHistoryBtn.disabled = false;
      clearLocalHistoryBtn.textContent = 'Clear Local History';
    }
  });
}

// -- Advanced: clear cloud history --
const clearCloudHistoryBtn = $('clearCloudHistoryBtn');
if (clearCloudHistoryBtn) {
  clearCloudHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Delete all watch history from Supabase cloud? Cannot be undone. Local history unaffected. Affects all devices sharing these credentials.')) return;
    clearCloudHistoryBtn.disabled = true;
    clearCloudHistoryBtn.textContent = 'Clearing...';
    try {
      const userId = await bgSend({ type: 'GET_USER_ID' }).then(r => r?.userId || null);
      if (!userId) { showAlert($('alert-cloud'), 'err', 'No user ID — check Supabase credentials.'); return; }
      const creds = await br.storage.local.get([S.supabaseUrl, S.supabaseAnonKey]);
      const sbUrl = (creds[S.supabaseUrl] || '').replace(/\/$/, '');
      const sbKey = creds[S.supabaseAnonKey];
      if (!sbUrl || !sbKey) { showAlert($('alert-cloud'), 'warn', 'Supabase not configured.'); return; }
      // Same rule as background isValidSupabaseUrl: the anon key only goes to *.supabase.co
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(sbUrl)) { showAlert($('alert-cloud'), 'err', 'Supabase URL must be https://<project>.supabase.co'); return; }
      const r = await fetch(`${sbUrl}/rest/v1/rpc/ss_clear_playback`, {
        method: 'POST',
        headers: { ...sbAuth(sbKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: userId })
      });
      if (r.ok) {
        _histCloud = [];
        historySource = 'cloud';
        document.querySelectorAll('.source-pill').forEach(p =>
          p.classList.toggle('active', p.dataset.source === 'cloud'));
        allHistory = getHistoryItems();
        renderHistory(allHistory);
        showAlert($('alert-cloud'), 'ok', 'Cloud history cleared.');
      } else {
        const txt = await r.text().catch(() => '');
        showAlert($('alert-cloud'), 'err', `HTTP ${r.status}${txt ? ' - ' + txt.slice(0, 120) : ''}`);
      }
    } catch (e) { showAlert($('alert-cloud'), 'err', 'Error: ' + e.message); }
    finally { clearCloudHistoryBtn.disabled = false; clearCloudHistoryBtn.textContent = 'Clear Cloud History'; }
  });
}

// -- OpenSubtitles login --
const saveOsubBtn = $('saveOsub');
if (saveOsubBtn) {
  saveOsubBtn.addEventListener('click', async () => {
    const user = ($('osobUsername')?.value || '').trim();
    const pass = ($('osobPassword')?.value || '').trim();
    if (!user || !pass) { showAlert($('alert-osub'), 'warn', 'Enter username and password.'); return; }
    saveOsubBtn.disabled = true;
    setSpinnerLabel(saveOsubBtn, 'Logging in…');
    await br.storage.local.set({ [S.osobUsername]: user, [S.osobPassword]: pass });
    const res = await bgSend({ type: 'OSUB_LOGIN', username: user, password: pass });
    saveOsubBtn.disabled = false;
    saveOsubBtn.textContent = 'Save & Login';
    const dotOsub = $('dot-osub');
    if (res?.ok) {
      setDot(dotOsub, 'ok');
      const msg = res.downloads_remaining != null ? `Logged in — ${res.downloads_remaining} downloads remaining today` : 'Logged in successfully.';
      showAlert($('alert-osub'), 'ok', msg);
    } else {
      setDot(dotOsub, 'err');
      showAlert($('alert-osub'), 'err', 'Login failed: ' + (res?.err || 'unknown error'));
    }
  });
}

const logoutOsubBtn = $('logoutOsub');
if (logoutOsubBtn) {
  logoutOsubBtn.addEventListener('click', async () => {
    await bgSend({ type: 'OSUB_LOGOUT' });
    await br.storage.local.remove([S.osobUsername, S.osobPassword]);
    if ($('osobUsername')) $('osobUsername').value = '';
    if ($('osobPassword')) $('osobPassword').value = '';
    setDot($('dot-osub'), '');
    showAlert($('alert-osub'), 'warn', 'Logged out.');
  });
}

// -- Mobile sidebar toggle --
const sidebarToggle = $('sidebarToggle');
const sidebarOverlay = $('sidebarOverlay');
if (sidebarToggle) sidebarToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => document.body.classList.remove('nav-open'));
document.querySelectorAll('.nav-item[data-panel]').forEach(item =>
  item.addEventListener('click', () => document.body.classList.remove('nav-open'))
);

// -- Live stats update --
br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[S.stats]) return;
  const statsPanel = $('panel-stats');
  if (statsPanel?.classList.contains('active')) {
    br.storage.local.get([S.stats]).then(d => loadStats(d)).catch(() => {});
  }
});

// -- Theme: follow the user's popup theme choice (no separate toggle here) --
function applyStoredTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark', theme === 'dark');
}
br.storage.local.get([S.theme]).then(d => applyStoredTheme(d[S.theme])).catch(() => {});
br.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[S.theme]) applyStoredTheme(changes[S.theme].newValue);
});

// -- Init --
loadCredentials();
verifyAll().then(() => {
  const supaOk = $('dot-supabase')?.classList.contains('ok');
  showWelcomeToast(supaOk);
});
