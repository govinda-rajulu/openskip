/* SkipStream - background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;
const badgeAPI = br.action || br.browserAction;

// ── Magic number constants ─────────────────────────────────────────────────────

const TMDB_CACHE_MAX = 200;
const OFFLINE_QUEUE_MAX = 50;
const OSUB_CACHE_MAX = 20;
const FETCH_RETRY_COUNT = 3;
const FETCH_RETRY_BASE_MS = 1000;
const QUEUE_FLUSH_INTERVAL_MIN = 5;
const HEARTBEAT_INTERVAL_MIN = 25 / 60;
const CONFIG_CACHE_TTL_MS = 30000;

// ── SW keepalive alarm ────────────────────────────────────────────────────────
// Chrome SW dies after ~30s idle. An alarm fires every 25s to keep it awake
// for pending operations. Only registered in SW context (Chrome MV3).

const ALARM_HEARTBEAT   = 'ss_heartbeat';
const ALARM_QUEUE_FLUSH = 'ss_queue_flush';

if (IS_SW) {
  br.alarms.create(ALARM_HEARTBEAT,   { periodInMinutes: HEARTBEAT_INTERVAL_MIN });
  br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: QUEUE_FLUSH_INTERVAL_MIN });
}

br.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_HEARTBEAT) {
    // No-op touch of storage keeps SW alive for pending fetch chains
    try { await br.storage.local.get('_ss_alive'); } catch { /* ok */ }
  }
  if (alarm.name === ALARM_QUEUE_FLUSH) {
    await flushOfflineQueue();
    await cleanupOldData();
  }
});

// ── In-memory caches (storage-backed on SW terminate) ─────────────────────────
// SW can die and restart at any time in Chrome. Hot caches are rebuilt from
// storage on wake so we avoid redundant API calls across SW restarts.

const TMDB_CACHE_KEY   = 'ss_tmdb_cache';
const USERID_CACHE_KEY = 'ss_userid_cache';

let _tmdbCache  = null;  // null = not yet loaded from storage
let _cachedUserId = null;
let _flushingQueue = false;  // Mutex: prevent concurrent offline queue flushes
let _configCache = null;
let _configCacheTs = 0;

async function getTmdbCache() {
  if (_tmdbCache) return _tmdbCache;
  try {
    const s = await br.storage.local.get(TMDB_CACHE_KEY);
    _tmdbCache = s[TMDB_CACHE_KEY] || {};
  } catch { _tmdbCache = {}; }
  return _tmdbCache;
}

async function setTmdbCache(key, value) {
  const cache = await getTmdbCache();
  cache[key] = value;
  // Cap at 200 entries; evict oldest by insertion order (Map would be better
  // but storage round-trips don't need insertion-order guarantees)
  const keys = Object.keys(cache);
  if (keys.length > TMDB_CACHE_MAX) {
    delete cache[keys[0]];
  }
  try { await br.storage.local.set({ [TMDB_CACHE_KEY]: cache }); } catch { /* ok */ }
}

// ── Error logging ring buffer ─────────────────────────────────────────────────────

const ERROR_LOG_KEY = 'skipstream_error_log';

async function logError(context, error) {
  try {
    const s = await br.storage.local.get(ERROR_LOG_KEY);
    const log = Array.isArray(s[ERROR_LOG_KEY]) ? s[ERROR_LOG_KEY] : [];
    log.push({
      ts: Date.now(),
      ctx: context,
      msg: String(error).slice(0, 200),
    });
    // Keep last 20 entries
    if (log.length > 20) log.shift();
    await br.storage.local.set({ [ERROR_LOG_KEY]: log });
  } catch { /* fail silently */ }
}

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTs) < CONFIG_CACHE_TTL_MS) return _configCache;
  try {
    const r = await br.storage.local.get([
      'supabaseUrl','supabaseAnonKey','tmdbApiKey','introdbApiKey',
      'animeSkipClientId','animeSkipAuthToken','animeSkipEnabled',
    ]);
    _configCache = {
      supabaseUrl:        r.supabaseUrl        || null,
      supabaseAnonKey:    r.supabaseAnonKey    || null,
      tmdbApiKey:         r.tmdbApiKey         || null,
      introdbApiKey:      r.introdbApiKey      || null,
      animeSkipClientId:  r.animeSkipClientId  || null,
      animeSkipAuthToken: r.animeSkipAuthToken || null,
      animeSkipEnabled:   r.animeSkipEnabled   ?? false,
    };
    _configCacheTs = now;
    return _configCache;
  } catch {
    return _configCache || {
      supabaseUrl:null,supabaseAnonKey:null,tmdbApiKey:null,
      introdbApiKey:null,
      animeSkipClientId:null,animeSkipAuthToken:null,animeSkipEnabled:false,
    };
  }
}

// ── Unique per-install user ID (UUID v4, persisted in storage) ────────────────
// Each browser installation gets a random UUID v4. Survives SW termination.

const INSTALL_ID_KEY = 'skipstream_install_id';

async function getDerivedUserId() {
  if (_cachedUserId) return _cachedUserId;
  
  // Try storage first (avoid UUID regenerate on SW wake)
  try {
    const s = await br.storage.local.get(INSTALL_ID_KEY);
    if (s[INSTALL_ID_KEY]) { 
      _cachedUserId = s[INSTALL_ID_KEY]; 
      return _cachedUserId; 
    }
  } catch { /* compute fresh */ }
  
  try {
    // Generate random UUID v4
    const uuid = crypto.randomUUID();
    _cachedUserId = uuid;
    // Persist so next SW wake uses same ID
    await br.storage.local.set({ [INSTALL_ID_KEY]: uuid });
    return uuid;
  } catch (e) { 
    logError('get_user_id', e);
    return null; 
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, retries = FETCH_RETRY_COUNT) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if ([400, 401, 403, 404, 409, 422].includes(res.status)) return res;
      if (res.ok) return res;
      lastErr = new Error(`Status ${res.status}`);
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await new Promise(r => setTimeout(r, FETCH_RETRY_BASE_MS * Math.pow(2, i)));
  }
  throw lastErr;
}

// ── Tab playback state (storage-backed to survive SW termination) ─────────────
// tabId → { userId, body } stored in ss_tab_state; cleared when tab closes.

const TAB_STATE_KEY = 'ss_tab_state';

async function getTabState() {
  try {
    const s = await br.storage.local.get(TAB_STATE_KEY);
    return s[TAB_STATE_KEY] || {};
  } catch { return {}; }
}

async function setTabState(tabId, value) {
  try {
    const state = await getTabState();
    if (value === null) delete state[tabId];
    else state[String(tabId)] = value;
    await br.storage.local.set({ [TAB_STATE_KEY]: state });
  } catch { /* best-effort */ }
}

// ── Supabase URL validation ───────────────────────────────────────────────────────

function isValidSupabaseUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (!parsed.hostname.endsWith('.supabase.co')) return false;
    return true;
  } catch { return false; }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function supabaseUpsert(body, { keepalive = false } = {}) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, err: 'not_configured' };
  if (!isValidSupabaseUrl(supabaseUrl)) return { ok: false, err: 'invalid_url' };
  try {
    const res = await fetchWithRetry(
      `${supabaseUrl}/rest/v1/playback_states?on_conflict=user_id,media_id`,
      {
        method: 'POST',
        keepalive,
        headers: {
          apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) return { ok: true };
    let detail = '';
    try { detail = await res.text(); } catch (_) {}
    return { ok: false, err: `HTTP ${res.status}${detail ? ' - ' + detail.slice(0, 200) : ''}` };
  } catch (e) {
    logError('supabase_upsert', e);
    // Network failure - queue for retry
    const QUEUE_KEY = 'skipstream_offline_queue';
    try {
      const stored = await br.storage.local.get(QUEUE_KEY);
      const queue = stored[QUEUE_KEY] || [];
      const idx = queue.findIndex(q => q.user_id === body.user_id && q.media_id === body.media_id);
      if (idx >= 0) queue[idx] = body; else queue.push(body);
      if (queue.length > OFFLINE_QUEUE_MAX) queue.splice(0, queue.length - OFFLINE_QUEUE_MAX);
      await br.storage.local.set({ [QUEUE_KEY]: queue });
    } catch { /* storage unavailable */ }
    return { ok: false, err: String(e) };
  }
}

// ── Offline queue flush ───────────────────────────────────────────────────────
// Called on 'online' event AND on ALARM_QUEUE_FLUSH (every 5 min in Chrome SW).

async function flushOfflineQueue() {
  if (_flushingQueue) return;
  _flushingQueue = true;
  try {
    const QUEUE_KEY = 'skipstream_offline_queue';
    try {
      const stored = await br.storage.local.get(QUEUE_KEY);
      const queue = stored[QUEUE_KEY];
      if (!queue || queue.length === 0) return;
      const remaining = [];
      for (const body of queue) {
        const result = await supabaseUpsert(body);
        if (!result.ok && result.err !== 'not_configured') remaining.push(body);
      }
      await br.storage.local.set({ [QUEUE_KEY]: remaining });
    } catch (e) { logError('queue_flush', e); }
  } finally {
    _flushingQueue = false;
  }
}

async function cleanupOldData() {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return;
  const userId = await getDerivedUserId();
  if (!userId) return;
  try {
    const stored = await br.storage.local.get('skipstream_last_cleanup');
    const last = stored.skipstream_last_cleanup || 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(
      `${supabaseUrl}/rest/v1/playback_states?user_id=eq.${userId}&updated_at=lt.${cutoff}`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          Prefer: 'return=minimal',
        },
      }
    );
    await br.storage.local.set({ skipstream_last_cleanup: Date.now() });
  } catch (e) { logError('data_cleanup', e); }
}

self.addEventListener('online', flushOfflineQueue);

// ── Tab-close flush ───────────────────────────────────────────────────────────
// Uses storage-backed tab state so it works even if SW was terminated and restarted.

if (br.tabs && br.tabs.onRemoved) {
  br.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getTabState();
    const entry = state[String(tabId)];
    await setTabState(tabId, null);
    if (!entry?.body) return;
    try {
      await supabaseUpsert(entry.body, { keepalive: true });
    } catch { /* best-effort */ }
  });
}

// ── Segment providers ─────────────────────────────────────────────────────────

async function providerIntroDB(imdbId, season, episode, { introdbApiKey }) {
  // /segments is a public read endpoint - no auth required or checked.
  // introdbApiKey is intentionally not sent here; it's only used for POST /submit.
  if (!introdbApiKey) return null;
  try {
    const r = await fetchWithRetry(
      `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function providerAnimeSkip(imdbId, season, episode, { animeSkipEnabled, animeSkipClientId, animeSkipAuthToken }) {
  if (!animeSkipEnabled || !animeSkipClientId) return null;

  const headers = {
    'Content-Type': 'application/json',
    'X-Client-ID': animeSkipClientId,
  };
  if (animeSkipAuthToken) headers['Authorization'] = `Bearer ${animeSkipAuthToken}`;

  try {
    const searchQuery = `{ searchShowsByExternalId(externalId: "${imdbId}", service: "imdb") { id name } }`;
    const searchRes = await fetchWithRetry(
      'https://api.anime-skip.com/graphql',
      { method: 'POST', headers, body: JSON.stringify({ query: searchQuery }) }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const shows = searchData?.data?.searchShowsByExternalId;
    if (!shows?.length) return null;
    const showId = shows[0].id;

    const epQuery = `{
      findEpisodesByShowId(showId: "${showId}", season: ${season}) {
        items {
          seasonNumber
          number
          timestamps { at duration type { name } }
        }
      }
    }`;
    const epRes = await fetchWithRetry(
      'https://api.anime-skip.com/graphql',
      { method: 'POST', headers, body: JSON.stringify({ query: epQuery }) }
    );
    if (!epRes.ok) return null;
    const epData = await epRes.json();
    const episodes = epData?.data?.findEpisodesByShowId?.items || [];
    const ep = episodes.find(e => e.number === episode || e.number === String(episode));
    if (!ep?.timestamps?.length) return null;

    const segments = {};
    for (const ts of ep.timestamps) {
      const type = (ts.type?.name || '').toLowerCase();
      const end  = ts.at + (ts.duration || 90);
      if ((type.includes('intro') || type === 'op')  && !segments.intro)  segments.intro  = { start_sec: ts.at, end_sec: end };
      if (type.includes('recap')                      && !segments.recap)  segments.recap  = { start_sec: ts.at, end_sec: end };
      if ((type.includes('outro') || type === 'ed')   && !segments.outro)  segments.outro  = { start_sec: ts.at, end_sec: end };
    }
    return Object.keys(segments).length ? segments : null;
  } catch { return null; }
}

async function fetchSegmentsMulti(imdbId, season, episode) {
  const config = await getConfig();
  const [introdb, animeskip] = await Promise.all([
    providerIntroDB(imdbId, season, episode, config),
    providerAnimeSkip(imdbId, season, episode, config),
  ]);
  if (!introdb && !animeskip) return null;
  const merged = Object.assign({}, animeskip || {}, introdb || {});
  return Object.keys(merged).length ? merged : null;
}

// ── Service checks ────────────────────────────────────────────────────────────

async function checkSupabase(supabaseUrl, supabaseAnonKey) {
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, message: 'Not configured' };
  if (!isValidSupabaseUrl(supabaseUrl)) return { ok: false, message: 'Invalid URL - must be https://*.supabase.co' };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/playback_states?limit=0`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    if (res.ok || res.status === 406) return { ok: true, message: 'Connected' };
    if (res.status === 404 || res.status === 400) return {
      ok: false, needsManualSetup: true,
      message: 'Table missing - run supabase_setup.sql once.',
    };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid credentials.' };
    return { ok: false, message: `Status ${res.status}` };
  } catch (e) { return { ok: false, message: `Network error: ${String(e)}` }; }
}

// ── OpenSubtitles ─────────────────────────────────────────────────────────────

const OSUB_API_KEY   = 'bBSwDAWRcnDjnw12mKLGHHu0SMSAUL34';
const OSUB_UA        = 'SkipStream v1.8.0';
const OSUB_SESS_KEY  = 'osub_session';
const OSUB_SUB_CACHE = 'osub_sub_cache'; // file_id → srt text, capped 20 entries

async function osubGetSession() {
  try {
    const s = await br.storage.local.get(OSUB_SESS_KEY);
    const sess = s[OSUB_SESS_KEY];
    if (sess?.token && sess.expiry > Date.now()) return sess;
  } catch { /* fall through */ }
  return null;
}

async function osubLogin(username, password) {
  try {
    const r = await fetch('https://api.opensubtitles.com/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': OSUB_API_KEY, 'User-Agent': OSUB_UA },
      body: JSON.stringify({ username, password }),
    });
    if (r.status === 401) return { ok: false, err: 'Invalid credentials (401). Stop retrying.' };
    if (!r.ok) return { ok: false, err: `HTTP ${r.status}` };
    const data = await r.json();
    const sess = {
      token:    data.token,
      base_url: data.base_url || 'api.opensubtitles.com',
      downloads_remaining: data.user?.allowed_downloads ?? null,
      expiry:   Date.now() + 23 * 60 * 60 * 1000,
    };
    await br.storage.local.set({ [OSUB_SESS_KEY]: sess });
    return { ok: true, downloads_remaining: sess.downloads_remaining };
  } catch (e) { return { ok: false, err: String(e) }; }
}

async function osubSearch(imdbId, season, episode, language, sess) {
  const base = `https://${sess?.base_url || 'api.opensubtitles.com'}/api/v1`;
  const headers = { 'Api-Key': OSUB_API_KEY, 'User-Agent': OSUB_UA };
  if (sess?.token) headers['Authorization'] = 'Bearer ' + sess.token;

  const numericId = (imdbId || '').replace(/^tt/, '');
  if (!numericId) return null;

  const params = new URLSearchParams({
    imdb_id:         numericId,
    languages:       language || 'en',
    order_by:        'download_count',
    order_direction: 'desc',
  });
  if (season)  params.set('season_number',  String(season));
  if (episode) params.set('episode_number', String(episode));
  params.set('type', (season && episode) ? 'episode' : 'movie');

  try {
    const r = await fetchWithRetry(`${base}/subtitles?${params}`, { headers });
    if (!r.ok) return null;
    const data = await r.json();
    const best = (data.data || [])[0];
    if (!best) return null;
    const file = best.attributes?.files?.[0];
    return file ? { file_id: file.file_id, name: file.file_name || '' } : null;
  } catch { return null; }
}

async function osubDownload(file_id, sess) {
  // Cache hit
  try {
    const c = await br.storage.local.get(OSUB_SUB_CACHE);
    const cache = c[OSUB_SUB_CACHE] || {};
    if (cache[file_id]) return { ok: true, text: cache[file_id] };
  } catch { /* miss */ }

  const base = `https://${sess?.base_url || 'api.opensubtitles.com'}/api/v1`;
  const headers = { 'Api-Key': OSUB_API_KEY, 'User-Agent': OSUB_UA, 'Content-Type': 'application/json' };
  if (sess?.token) headers['Authorization'] = 'Bearer ' + sess.token;

  try {
    const r = await fetchWithRetry(`${base}/download`, {
      method: 'POST', headers, body: JSON.stringify({ file_id, sub_format: 'srt' }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, err: `HTTP ${r.status}${txt ? ' - ' + txt.slice(0, 120) : ''}` };
    }
    const data = await r.json();
    if (!data.link) return { ok: false, err: 'No download link' };

    // Update remaining downloads in session cache
    if (data.remaining !== undefined) {
      try {
        const s = await br.storage.local.get(OSUB_SESS_KEY);
        const sess2 = s[OSUB_SESS_KEY];
        if (sess2) { sess2.downloads_remaining = data.remaining; await br.storage.local.set({ [OSUB_SESS_KEY]: sess2 }); }
      } catch { /* ok */ }
    }

    const dl = await fetch(data.link);
    if (!dl.ok) return { ok: false, err: `CDN HTTP ${dl.status}` };
    const text = await dl.text();

    // Cache (cap 20)
    try {
      const c = await br.storage.local.get(OSUB_SUB_CACHE);
      const cache = c[OSUB_SUB_CACHE] || {};
      const keys = Object.keys(cache);
      if (keys.length >= OSUB_CACHE_MAX) delete cache[keys[0]];
      cache[file_id] = text;
      await br.storage.local.set({ [OSUB_SUB_CACHE]: cache });
    } catch { /* ok */ }

    return { ok: true, text, remaining: data.remaining };
  } catch (e) { logError('osub_download', e); return { ok: false, err: String(e) }; }
}

// ── First install / update handler ───────────────────────────────────────────

br.runtime.onInstalled.addListener(async ({ reason }) => {
  // Re-register alarms in case they were cleared by browser update or SW restart
  if (IS_SW) {
    br.alarms.get(ALARM_HEARTBEAT).then(a => {
      if (!a) br.alarms.create(ALARM_HEARTBEAT, { periodInMinutes: 25 / 60 });
    }).catch(() => { br.alarms.create(ALARM_HEARTBEAT, { periodInMinutes: 25 / 60 }); });
    br.alarms.get(ALARM_QUEUE_FLUSH).then(a => {
      if (!a) br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: 5 });
    }).catch(() => { br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: 5 }); });
  }

  if (reason === 'install') {
    br.tabs.create({ url: br.runtime.getURL('options.html') });
  }
  if (reason === 'install' || reason === 'update') {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    if (supabaseUrl && supabaseAnonKey) {
      const check = await checkSupabase(supabaseUrl, supabaseAnonKey);
      if (check.needsManualSetup) {
        await br.storage.local.set({ _supabaseNeedsSetup: true });
      } else if (check.ok) {
        await br.storage.local.remove('_supabaseNeedsSetup');
      }
    }
    // Flush any offline queue that accumulated while extension was off
    await flushOfflineQueue();
    await cleanupOldData();
  }
});

// ── Config cache invalidation on storage changes ───────────────────────────────────

br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const configKeys = ['supabaseUrl','supabaseAnonKey','tmdbApiKey','introdbApiKey','animeSkipClientId','animeSkipAuthToken','animeSkipEnabled'];
  if (configKeys.some(k => k in changes)) {
    _configCache = null;
    _configCacheTs = 0;
  }
});

// ── Message router ────────────────────────────────────────────────────────────

br.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message;

  
  if (msg.type === 'INVALIDATE_USER_ID') {
    _cachedUserId = null;
    br.storage.local.remove(INSTALL_ID_KEY).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_USER_ID') {
    getDerivedUserId().then(userId => {
      sendResponse({ userId });
    });
    return true;
  }

  if (msg.type === 'TMDB_TO_IMDB') {
    const cacheKey = `tv:${msg.tmdbId}`;
    getTmdbCache().then(async (cache) => {
      if (cacheKey in cache) { sendResponse({ imdbId: cache[cacheKey] }); return; }
      const { tmdbApiKey } = await getConfig();
      if (!tmdbApiKey) { await setTmdbCache(cacheKey, null); sendResponse({ imdbId: null }); return; }
      try {
        const r = await fetchWithRetry(`https://api.themoviedb.org/3/tv/${msg.tmdbId}/external_ids?api_key=${tmdbApiKey}`);
        const data = await r.json();
        const id = data.imdb_id || null;
        await setTmdbCache(cacheKey, id);
        sendResponse({ imdbId: id });
      } catch { await setTmdbCache(cacheKey, null); sendResponse({ imdbId: null }); }
    });
    return true;
  }

  if (msg.type === 'FETCH_SEGMENTS') {
    fetchSegmentsMulti(msg.imdbId, msg.season, msg.episode)
      .then(data => {
        const tabId = sender?.tab?.id;
        if (tabId && badgeAPI?.setBadgeText) {
          if (data) {
            badgeAPI.setBadgeText({ text: '', tabId });
          } else {
            badgeAPI.setBadgeText({ text: '!', tabId });
            badgeAPI.setBadgeBackgroundColor({ color: '#F59E0B', tabId });
          }
        }
        sendResponse({ data: data || null, err: data ? null : 'no_data' });
      })
      .catch(e => {
        const tabId = sender?.tab?.id;
        if (tabId && badgeAPI?.setBadgeText) {
          badgeAPI.setBadgeText({ text: '!', tabId });
          badgeAPI.setBadgeBackgroundColor({ color: '#F59E0B', tabId });
        }
        logError('fetch_segments', e);
        sendResponse({ data: null, err: String(e) });
      });
    return true;
  }

  if (msg.type === 'REPORT_SEGMENT') {
    getConfig().then(async ({ introdbApiKey, animeSkipEnabled, animeSkipClientId, animeSkipAuthToken }) => {
      if (!introdbApiKey && !animeSkipClientId) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      const results = [];

      if (introdbApiKey) {
        try {
          const body = {
            imdb_id: msg.imdbId, season: msg.season, episode: msg.episode,
            site: msg.site, reported_at: new Date().toISOString(),
          };
          if (msg.startSec != null) body.start_sec = msg.startSec;
          if (msg.endSec   != null) body.end_sec   = msg.endSec;
          if (msg.segType)          body.type       = msg.segType;
          const r = await fetchWithRetry('https://api.introdb.app/segments/report', {
            method: 'POST',
            headers: { 'x-api-key': introdbApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          results.push({ provider: 'introdb', ok: r.ok, status: r.status });
        } catch (e) { results.push({ provider: 'introdb', ok: false, err: String(e) }); }
      }

      if (animeSkipEnabled && animeSkipClientId && msg.startSec != null && msg.endSec != null && msg.segType) {
        try {
          const headers = { 'Content-Type': 'application/json', 'X-Client-ID': animeSkipClientId };
          if (animeSkipAuthToken) headers['Authorization'] = `Bearer ${animeSkipAuthToken}`;
          const mutation = `mutation($showId:ID!,$epNum:Int!,$season:Int!,$at:Float!,$dur:Float!,$typeId:ID!){
            createTimestamp(showId:$showId,episodeNumber:$epNum,season:$season,at:$at,duration:$dur,typeId:$typeId){id}
          }`;
          const typeMap = { intro: '1', recap: '3', outro: '2' };
          const r = await fetchWithRetry('https://api.anime-skip.com/graphql', {
            method: 'POST', headers,
            body: JSON.stringify({
              query: mutation,
              variables: {
                showId: msg.animeSkipShowId || '', epNum: msg.episode, season: msg.season,
                at: msg.startSec, dur: msg.endSec - msg.startSec, typeId: typeMap[msg.segType] || '1',
              },
            }),
          });
          results.push({ provider: 'animeskip', ok: r.ok, status: r.status });
        } catch (e) { results.push({ provider: 'animeskip', ok: false, err: String(e) }); }
      }

      sendResponse({ ok: results.some(r => r.ok), results });
    });
    return true;
  }

  if (msg.type === 'SUPABASE_UPSERT') {
    // Store last-known tab state in storage (SW-restart safe)
    if (sender?.tab?.id && msg.body) {
      getConfig().then(async ({ supabaseAnonKey }) => {
        const userId = supabaseAnonKey ? await getDerivedUserId(supabaseAnonKey) : null;
        if (userId) {
          await setTabState(sender.tab.id, { userId, body: msg.body });
        }
      }).catch(() => {});
    }
    supabaseUpsert(msg.body, { keepalive: !!msg.keepalive })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, err: String(err) }));
    return true;
  }

  if (msg.type === 'SUPABASE_GET') {
    getConfig().then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ data: null, err: 'invalid_url' }); return; }
      const url = `${supabaseUrl}/rest/v1/playback_states` +
        `?user_id=eq.${encodeURIComponent(msg.userId)}` +
        `&media_id=eq.${encodeURIComponent(msg.mediaId)}` +
        `&select=playback_time,duration,site,site_name,video_title&limit=1`;
      fetchWithRetry(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } })
        .then(r => r.json())
        .then(data => sendResponse({ data: data[0] || null }))
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  if (msg.type === 'SUPABASE_SETTINGS_UPSERT') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ ok: false, err: 'invalid_url' }); return; }
      try {
        const res = await fetchWithRetry(
          `${supabaseUrl}/rest/v1/user_settings?on_conflict=user_id`,
          {
            method: 'POST',
            headers: {
              apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              user_id:    msg.body.user_id,
              stats:      msg.body.stats      || {},
              prefs:      msg.body.prefs      || {},
              site_rules: msg.body.site_rules || {},
              theme:      msg.body.theme      || null,
              updated_at: new Date().toISOString(),
            }),
          }
        );
        sendResponse({ ok: res.ok });
      } catch (e) { sendResponse({ ok: false, err: String(e) }); }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_SETTINGS_GET') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ data: null, err: 'invalid_url' }); return; }
      try {
        const url = `${supabaseUrl}/rest/v1/user_settings` +
          `?user_id=eq.${encodeURIComponent(msg.userId)}` +
          `&select=stats,prefs,site_rules,theme,updated_at&limit=1`;
        const res = await fetchWithRetry(url, {
          headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
        });
        const rows = await res.json();
        sendResponse({ data: rows?.[0] || null });
      } catch (e) { sendResponse({ data: null, err: String(e) }); }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_GET_ALL') {
    getConfig().then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ data: null, err: 'invalid_url' }); return; }
      const url = `${supabaseUrl}/rest/v1/playback_states` +
        `?user_id=eq.${encodeURIComponent(msg.userId)}` +
        `&select=media_id,playback_time,duration,site,site_name,video_title,device_name,page_url,updated_at` +
        `&order=updated_at.desc&limit=200`;
      fetchWithRetry(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } })
        .then(r => r.json())
        .then(data => sendResponse({ data: Array.isArray(data) ? data : [] }))
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  if (msg.type === 'TMDB_SEARCH_POSTER') {
    // Search TMDB for a title and return poster_path as full URL
    // Tries TV search first, then movie search, returns first result
    const posterCacheKey = `poster:${(msg.title || '').toLowerCase().trim()}`;
    getTmdbCache().then(async (cache) => {
      if (posterCacheKey in cache) {
        sendResponse({ posterUrl: cache[posterCacheKey] });
        return;
      }
      const { tmdbApiKey } = await getConfig();
      if (!tmdbApiKey) {
        await setTmdbCache(posterCacheKey, null);
        sendResponse({ posterUrl: null });
        return;
      }
      const q = encodeURIComponent((msg.title || '').replace(/\s*S\d+\s*E\d+.*/i,'').trim());
      try {
        // Try TV first
        let posterPath = null;
        const tvRes = await fetchWithRetry(
          `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${q}&page=1`
        );
        if (tvRes.ok) {
          const tvData = await tvRes.json();
          posterPath = tvData.results?.[0]?.poster_path || null;
        }
        // Fallback to movie if no TV result
        if (!posterPath) {
          const mvRes = await fetchWithRetry(
            `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${q}&page=1`
          );
          if (mvRes.ok) {
            const mvData = await mvRes.json();
            posterPath = mvData.results?.[0]?.poster_path || null;
          }
        }
        const posterUrl = posterPath
          ? `https://image.tmdb.org/t/p/w92${posterPath}`
          : null;
        await setTmdbCache(posterCacheKey, posterUrl);
        sendResponse({ posterUrl });
      } catch {
        await setTmdbCache(posterCacheKey, null);
        sendResponse({ posterUrl: null });
      }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_VERIFY_SETUP') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      try {
        const res = await fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/ss_verify_setup`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (res.ok) {
          const data = await res.json();
          const complete = data?.setup_complete === true;
          sendResponse({
            ok: complete, data,
            message: complete
              ? 'Setup verified — all tables, RLS policies, and triggers present.'
              : 'Setup incomplete — some objects missing. Re-run supabase_setup.sql.',
          });
        } else if (res.status === 404) {
          sendResponse({ ok: false, needsSetup: true, message: 'ss_verify_setup() not found — run supabase_setup.sql first.' });
        } else {
          sendResponse({ ok: false, message: `Verify failed: HTTP ${res.status}` });
        }
      } catch (e) { sendResponse({ ok: false, message: `Network error: ${String(e)}` }); }
    });
    return true;
  }
if (msg.type === 'OSUB_LOGIN') {
    osubLogin(msg.username, msg.password).then(res => sendResponse(res));
    return true;
  }

  if (msg.type === 'OSUB_LOGOUT') {
    br.storage.local.remove(OSUB_SESS_KEY).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'OSUB_STATUS') {
    osubGetSession().then(sess => sendResponse({
      loggedIn: !!sess,
      downloads_remaining: sess?.downloads_remaining ?? null,
    }));
    return true;
  }

  if (msg.type === 'OSUB_SEARCH_AND_FETCH') {
    (async () => {
      const { imdbId, season, episode, language } = msg;
      const sess = await osubGetSession();
      let result = await osubSearch(imdbId, season, episode, language, sess);

      // Fallback to English if primary language has no results
      if (!result && language && language !== 'en') {
        result = await osubSearch(imdbId, season, episode, 'en', sess);
      }

      if (!result) { sendResponse({ ok: false, err: 'no_results' }); return; }
      const dl = await osubDownload(result.file_id, sess);
      sendResponse({ ...dl, file_id: result.file_id, name: result.name });
    })();
    return true;
  }

  if (msg.type === 'GET_ERROR_LOG') {
    br.storage.local.get(ERROR_LOG_KEY).then(s => {
      const log = Array.isArray(s[ERROR_LOG_KEY]) ? s[ERROR_LOG_KEY] : [];
      sendResponse({ log });
    }).catch(() => sendResponse({ log: [] }));
    return true;
  }

  return false;
});
