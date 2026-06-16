/* SkipStream - background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;

// ── SW keepalive alarm ────────────────────────────────────────────────────────
// Chrome SW dies after ~30s idle. An alarm fires every 25s to keep it awake
// for pending operations. Only registered in SW context (Chrome MV3).

const ALARM_HEARTBEAT   = 'ss_heartbeat';
const ALARM_QUEUE_FLUSH = 'ss_queue_flush';

if (IS_SW) {
  br.alarms.create(ALARM_HEARTBEAT,   { periodInMinutes: 25 / 60 }); // ~25s
  br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: 5 });        // retry offline queue every 5min
}

br.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_HEARTBEAT) {
    // No-op touch of storage keeps SW alive for pending fetch chains
    try { await br.storage.local.get('_ss_alive'); } catch { /* ok */ }
  }
  if (alarm.name === ALARM_QUEUE_FLUSH) {
    await flushOfflineQueue();
  }
});

// ── In-memory caches (storage-backed on SW terminate) ─────────────────────────
// SW can die and restart at any time in Chrome. Hot caches are rebuilt from
// storage on wake so we avoid redundant API calls across SW restarts.

const TMDB_CACHE_KEY   = 'ss_tmdb_cache';
const USERID_CACHE_KEY = 'ss_userid_cache';

let _tmdbCache  = null;  // null = not yet loaded from storage
let _cachedUserId = null;

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
  if (keys.length > 200) {
    delete cache[keys[0]];
  }
  try { await br.storage.local.set({ [TMDB_CACHE_KEY]: cache }); } catch { /* ok */ }
}

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const r = await br.storage.local.get([
      'supabaseUrl','supabaseAnonKey','tmdbApiKey','introdbApiKey',
      'animeSkipClientId','animeSkipAuthToken','animeSkipEnabled',
    ]);
    return {
      supabaseUrl:        r.supabaseUrl        || null,
      supabaseAnonKey:    r.supabaseAnonKey    || null,
      tmdbApiKey:         r.tmdbApiKey         || null,
      introdbApiKey:      r.introdbApiKey      || null,
      animeSkipClientId:  r.animeSkipClientId  || null,
      animeSkipAuthToken: r.animeSkipAuthToken || null,
      animeSkipEnabled:   r.animeSkipEnabled   ?? false,
    };
  } catch {
    return {
      supabaseUrl:null,supabaseAnonKey:null,tmdbApiKey:null,
      introdbApiKey:null,
      animeSkipClientId:null,animeSkipAuthToken:null,animeSkipEnabled:false,
    };
  }
}

// ── Deterministic user ID ─────────────────────────────────────────────────────
// Storage-backed: survives SW termination without recompute.

async function getDerivedUserId(anonKey) {
  if (_cachedUserId) return _cachedUserId;
  // Try storage first (avoids SHA-256 recompute on SW wake)
  try {
    const s = await br.storage.local.get(USERID_CACHE_KEY);
    if (s[USERID_CACHE_KEY]) { _cachedUserId = s[USERID_CACHE_KEY]; return _cachedUserId; }
  } catch { /* compute fresh */ }
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('skipstream:uid:' + anonKey));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    _cachedUserId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    // Persist so next SW wake skips recompute
    await br.storage.local.set({ [USERID_CACHE_KEY]: _cachedUserId });
    return _cachedUserId;
  } catch { return null; }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if ([401, 403, 404].includes(res.status)) return res;
      if (res.ok) return res;
      lastErr = new Error(`Status ${res.status}`);
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
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

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function supabaseUpsert(body, { keepalive = false } = {}) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, err: 'not_configured' };
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
    return res.ok ? { ok: true } : { ok: false, err: `HTTP ${res.status}` };
  } catch (e) {
    // Network failure - queue for retry
    const QUEUE_KEY = 'skipstream_offline_queue';
    try {
      const stored = await br.storage.local.get(QUEUE_KEY);
      const queue = stored[QUEUE_KEY] || [];
      const idx = queue.findIndex(q => q.user_id === body.user_id && q.media_id === body.media_id);
      if (idx >= 0) queue[idx] = body; else queue.push(body);
      if (queue.length > 50) queue.splice(0, queue.length - 50);
      await br.storage.local.set({ [QUEUE_KEY]: queue });
    } catch { /* storage unavailable */ }
    return { ok: false, err: String(e) };
  }
}

// ── Offline queue flush ───────────────────────────────────────────────────────
// Called on 'online' event AND on ALARM_QUEUE_FLUSH (every 5 min in Chrome SW).

async function flushOfflineQueue() {
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
  } catch { /* best-effort */ }
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
  if (!introdbApiKey) return null;
  try {
    const r = await fetchWithRetry(
      `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`,
      { headers: { 'x-api-key': introdbApiKey } }
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

async function checkTmdb(tmdbApiKey) {
  if (!tmdbApiKey) return { ok: false, message: 'Not configured' };
  try {
    const r = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${tmdbApiKey}`);
    if (r.ok) return { ok: true, message: 'Connected' };
    if (r.status === 401) return { ok: false, message: 'Invalid API key' };
    return { ok: false, message: `Status ${r.status}` };
  } catch (e) { return { ok: false, message: `Network error: ${String(e)}` }; }
}

async function checkIntroDB(introdbApiKey) {
  if (!introdbApiKey) return { ok: false, message: 'Not configured' };
  try {
    const r = await fetch('https://api.introdb.app/intro?imdb_id=tt0944947&season=1&episode=1', {
      headers: { 'x-api-key': introdbApiKey },
    });
    if (r.ok) return { ok: true, message: 'Connected' };
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Invalid API key' };
    return { ok: false, message: `Status ${r.status}` };
  } catch (e) { return { ok: false, message: `Network error: ${String(e)}` }; }
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
  }
});

// ── Message router ────────────────────────────────────────────────────────────

br.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message;

  if (msg.type === 'CHECK_CONFIG') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey, tmdbApiKey, introdbApiKey }) => {
      const [supabase, tmdb, introdb] = await Promise.all([
        checkSupabase(supabaseUrl, supabaseAnonKey),
        checkTmdb(tmdbApiKey),
        checkIntroDB(introdbApiKey),
      ]);
      sendResponse({ supabase, tmdb, introdb });
    });
    return true;
  }

  if (msg.type === 'INVALIDATE_USER_ID') {
    _cachedUserId = null;
    br.storage.local.remove(USERID_CACHE_KEY).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_USER_ID') {
    getConfig().then(async ({ supabaseAnonKey }) => {
      if (!supabaseAnonKey) { sendResponse({ userId: null }); return; }
      sendResponse({ userId: await getDerivedUserId(supabaseAnonKey) });
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
      .then(data => sendResponse({ data: data || null, err: data ? null : 'no_data' }))
      .catch(e => sendResponse({ data: null, err: String(e) }));
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
      const url = `${supabaseUrl}/rest/v1/playback_states` +
        `?user_id=eq.${encodeURIComponent(msg.userId)}` +
        `&select=media_id,playback_time,duration,site,site_name,video_title,device_name,updated_at` +
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

  return false;
});
