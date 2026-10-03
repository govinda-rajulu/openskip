/* SkipStream - background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;
const badgeAPI = br.action || br.browserAction;

// ── Magic number constants ─────────────────────────────────────────────────────

const TMDB_CACHE_MAX = 500;
const OFFLINE_QUEUE_MAX = 50;
const OSUB_CACHE_MAX = 20;
const FETCH_RETRY_COUNT = 3;
const FETCH_RETRY_BASE_MS = 1000;
const QUEUE_FLUSH_INTERVAL_MIN = 5;
const CONFIG_CACHE_TTL_MS = 30000;

// ── Alarms ────────────────────────────────────────────────────────────────────
// Up to 1.10 a 30-second "keepalive" alarm held the Chrome service worker awake.
// Chrome discourages that: events (messages, alarms, fetches) wake the worker and
// state lives in storage. Older installs still have the alarm, so clear it.

const ALARM_HEARTBEAT   = 'ss_heartbeat';
const ALARM_QUEUE_FLUSH = 'ss_queue_flush';

if (IS_SW) {
  try { Promise.resolve(br.alarms.clear(ALARM_HEARTBEAT)).catch(() => {}); } catch { /* ok */ }
}
// The queue flush + daily cleanup alarm is needed on Firefox too (it was SW-only,
// so Firefox never flushed the offline queue or pruned old rows). get-then-create:
// a background wake must not restart the 5-minute timer.
Promise.resolve(br.alarms.get(ALARM_QUEUE_FLUSH))
  .then(a => { if (!a) br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: QUEUE_FLUSH_INTERVAL_MIN }); })
  .catch(() => { try { br.alarms.create(ALARM_QUEUE_FLUSH, { periodInMinutes: QUEUE_FLUSH_INTERVAL_MIN }); } catch { /* ok */ } });

br.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_QUEUE_FLUSH) {
    await flushOfflineQueue();
    await cleanupOldData();
  }
});

// ── In-memory caches (storage-backed on SW terminate) ─────────────────────────
// SW can die and restart at any time in Chrome. Hot caches are rebuilt from
// storage on wake so we avoid redundant API calls across SW restarts.

const TMDB_CACHE_KEY   = 'ss_tmdb_cache';

let _tmdbCache  = null;  // null = not yet loaded from storage
let _cachedUserId = null;
let _flushingQueue = false;  // Mutex: prevent concurrent offline queue flushes
let _configCache = null;
let _configCacheTs = 0;

// TMDB accepts a v4 read token (a three-part JWT) as Bearer, or a v3 key as
// ?api_key=. Users paste either, so every TMDB call goes through here.
function tmdbFetch(path, key) {
  const k = String(key || '').trim();
  const v4 = k.split('.').length === 3;
  const url = 'https://api.themoviedb.org/3' + path +
    (v4 ? '' : (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(k));
  return fetchWithRetry(url, v4 ? { headers: { Authorization: `Bearer ${k}` } } : {});
}

// ── Title matching (posters, title -> IMDb id) ───────────────────────────────
const _TITLE_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to']);
function _normTitle(t) {
  return String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function _sameTitle(a, b) {
  const x = _normTitle(a).replace(/^the /, ''), y = _normTitle(b).replace(/^the /, '');
  return !!x && x === y;
}
// Most of the work's own words appear in the page title.
function _looseTitle(pageTitle, workTitle) {
  const page = new Set(_normTitle(pageTitle).split(' '));
  const words = _normTitle(workTitle).split(' ').filter(w => w && !_TITLE_STOP.has(w));
  if (!words.length) return true;
  return words.filter(w => page.has(w)).length / words.length >= 0.6;
}
// "Watch The Matrix (1999) Online Free | 1Shows" -> { q: "The Matrix", year: 1999, tv: false }
// "Dark - S01E02 - Lies" -> { q: "Dark", year: null, tv: true }
function cleanMediaTitle(raw) {
  let t = String(raw || '').slice(0, 300).replace(/\s+/g, ' ').trim();
  let tv = false, year = null;
  t = t.split(/\s+\|\s+/)[0];
  t = t.replace(/^\s*watch\s+/i, '');
  const se = /\b(?:S\d{1,2}\s*[:\u00b7\u2022-]?\s*E\d{1,3}|Season\s+\d+|Episode\s+\d+|Ep\.?\s*\d+|\d{1,2}x\d{1,3})\b.*$/i;
  if (se.test(t)) { tv = true; t = t.replace(se, ''); }
  const maxYear = new Date().getFullYear() + 1;
  const y = t.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/) || t.match(/\s((?:19|20)\d{2})\s*$/);
  if (y && parseInt(y[1], 10) <= maxYear) {
    const rest = t.replace(y[0], ' ').trim();
    if (/[a-z]{2}/i.test(rest)) { year = parseInt(y[1], 10); t = rest; }
  }
  t = t.replace(/\s+(?:online|free|hd|full movie|full episodes?|streaming|english sub(?:bed)?|dubbed)(?=\s|$)/gi, ' ')
       .replace(/[\s:|\u00b7\u2013\u2014-]+$/, '').replace(/^[\s:|\u00b7\u2013\u2014-]+/, '').replace(/\s+/g, ' ').trim();
  return { q: t.slice(0, 100), year, tv };
}

function _tmdbYearParam(kind, year) {
  if (!year) return '';
  return kind === 'movie' ? `&year=${year}` : `&first_air_date_year=${year}`;
}

// Title -> IMDb id for sites that carry no ids. Exact name only; two works
// with the same name and nothing to tell them apart give no answer.
async function tmdbFindTitle(title, year, kind, key) {
  const c = cleanMediaTitle(title);
  const q = c.q;
  const y = /^(19|20)\d{2}$/.test(String(year || '')) ? Number(year) : c.year;
  const k = kind === 'movie' || kind === 'tv' ? kind : (c.tv ? 'tv' : '');
  if (!q || q.length < 2) return { answered: true, imdbId: null };
  let answered = true;
  const hits = [];
  for (const kd of (k ? [k] : ['movie', 'tv'])) {
    const r = await tmdbFetch(`/search/${kd}?query=${encodeURIComponent(q)}&page=1&include_adult=false${_tmdbYearParam(kd, y)}`, key);
    if (!r.ok) { answered = false; continue; }
    const d = await r.json();
    for (const x of (d.results || []).slice(0, 10)) {
      if ([x.title, x.name, x.original_title, x.original_name].some(n => _sameTitle(n, q))) {
        hits.push({ kind: kd, id: x.id, pop: Number(x.popularity) || 0 });
      }
    }
  }
  if (!hits.length) return { answered, imdbId: null };
  hits.sort((a, b) => b.pop - a.pop);
  if (hits.length > 1 && !y && hits[0].pop < hits[1].pop * 3) return { answered, imdbId: null, ambiguous: true };
  const best = hits[0];
  const r = await tmdbFetch(`/${best.kind}/${best.id}/external_ids`, key);
  if (!r.ok) return { answered: false, imdbId: null };
  const ext = await r.json();
  const imdbId = /^tt\d{7,8}$/.test(String(ext?.imdb_id || '')) ? ext.imdb_id : null;
  return { answered: true, imdbId, kind: best.kind, tmdbId: best.id };
}

// History artwork. A known TMDB id (movie/603, tv/1399) is used directly when
// its name matches the saved title; otherwise an exact-name search, preferring
// the kind the title suggests. Portrait posters first: the history slot is tall.
async function tmdbPoster(mediaId, title, key) {
  const pick = x => (x ? (x.poster_path || x.backdrop_path || null) : null);
  const c = cleanMediaTitle(title);
  let allOk = true;
  const m = /^(movie|tv)\/(\d+)$/.exec(String(mediaId || ''));
  if (m) {
    const r = await tmdbFetch(`/${m[1]}/${m[2]}`, key);
    if (r.ok) {
      const d = await r.json();
      if (!c.q || _looseTitle(title, d.title || d.name || '')) { const pp = pick(d); if (pp) return { path: pp, allOk }; }
    } else if (r.status !== 404) allOk = false;
  }
  if (!c.q) return { path: null, allOk };
  let first = null;
  for (const kd of (c.tv ? ['tv', 'movie'] : ['movie', 'tv'])) {
    const r = await tmdbFetch(`/search/${kd}?query=${encodeURIComponent(c.q)}&page=1${_tmdbYearParam(kd, c.year)}`, key);
    if (!r.ok) { allOk = false; continue; }
    const d = await r.json();
    const res = (d.results || []).filter(x => pick(x));
    const exact = res.find(x => [x.title, x.name, x.original_title, x.original_name].some(n => _sameTitle(n, c.q)));
    if (exact) return { path: pick(exact), allOk };
    if (!first && res[0]) first = res[0];
  }
  return { path: pick(first), allOk };
}

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

let _logChain = Promise.resolve();
function logError(context, error) {
  // Serialised: two failures at once used to read the same old log and one was lost.
  _logChain = _logChain.then(() => _logErrorNow(context, error));
  return _logChain;
}

async function _logErrorNow(context, error) {
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
    else state[String(tabId)] = { ...value, _ts: Date.now() };
    await br.storage.local.set({ [TAB_STATE_KEY]: state });
  } catch { /* best-effort */ }
}

// ── Firefox data consent (audit H23b) ─────────────────────────────────────────
// Stats, the settings backup and the browser/device name are "technical and
// interaction data". Firefox only allows that category as optional: on by
// default, switchable at install and in about:addons. Check it before every
// send. Chrome has no data_collection key, so nothing changes there.
async function techDataAllowed() {
  try {
    const p = await br.permissions.getAll();
    if (!p || !Array.isArray(p.data_collection)) return true;
    return p.data_collection.includes('technicalAndInteraction');
  } catch { return false; }
}

// ── Supabase URL validation ───────────────────────────────────────────────────────

function isValidSupabaseUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/.test(hostname)) return false;
    return true;
  } catch { return false; }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function supabaseUpsert(body, { keepalive = false } = {}) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, err: 'not_configured' };
  if (!isValidSupabaseUrl(supabaseUrl)) return { ok: false, err: 'invalid_url' };
  if (body && body.device_name != null && !(await techDataAllowed())) body = { ...body, device_name: null };
  try {
    const res = await fetchWithRetry(
      `${supabaseUrl}/rest/v1/rpc/ss_put_playback`,
      {
        method: 'POST',
        keepalive,
        headers: {
          apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ p_row: body }),
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
        const permanent = /^HTTP 4\d\d/.test(result.err || '') && !/^HTTP 40[8]|^HTTP 429/.test(result.err || '');
        if (!result.ok && result.err !== 'not_configured' && !permanent) remaining.push(body);
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
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rpc/ss_prune_playback`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ p_user_id: userId, p_days: 90 }),
      }
    );
    if (!res.ok) { logError('data_cleanup', new Error('HTTP ' + res.status)); return; }
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
    if (entry._ts && Date.now() - entry._ts > 60000) return;
    try {
      await supabaseUpsert(entry.body, { keepalive: true });
    } catch { /* best-effort */ }
  });
}

// ── Segment providers ─────────────────────────────────────────────────────────

// IntroDB reads are public ("No API key needed to read", introdb.app/docs/api).
// Only the IMDb id and season/episode are sent. The key is never sent on reads;
// it is reserved for submitting timings.
async function providerIntroDB(imdbId, season, episode, _config, isMovie) {
  if (!/^tt\d{7,8}$/.test(String(imdbId || ''))) return null;
  try {
    const params = isMovie
      ? new URLSearchParams({ imdb_id: imdbId, is_movie: 'true' })
      : new URLSearchParams({ imdb_id: imdbId, season: String(season), episode: String(episode) });
    const r = await fetchWithRetry(`https://api.introdb.app/segments?${params}`);
    if (!r.ok) return null;
    return normalizeIntroDB(await r.json());
  } catch { return null; }
}

// Response: { imdb_id, season, episode, intro, recap, outro[, post_credits] },
// each segment { start_sec, end_sec, start_ms, end_ms, confidence, submission_count }
// or null. Keep only usable intro/recap/outro so a null here can never overwrite
// an Anime-Skip segment in the merge. post_credits is a scene to WATCH: never skipped.
function normalizeIntroDB(data) {
  if (!data || typeof data !== 'object') return null;
  const out = {};
  for (const k of ['intro', 'recap', 'outro']) {
    const s = data[k];
    if (!s || typeof s !== 'object') continue;
    const a = s.start_sec != null ? Number(s.start_sec) : (s.start_ms != null ? Number(s.start_ms) / 1000 : NaN);
    const b = s.end_sec   != null ? Number(s.end_sec)   : (s.end_ms   != null ? Number(s.end_ms)   / 1000 : NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a < 0) continue;
    out[k] = { start_sec: a, end_sec: b, submission_count: s.submission_count ?? null, confidence: s.confidence ?? null };
  }
  return Object.keys(out).length ? out : null;
}

async function providerAnimeSkip(imdbId, season, episode, { animeSkipEnabled, animeSkipClientId, animeSkipAuthToken }) {
  if (!animeSkipEnabled || !animeSkipClientId) return null;
  if (!/^tt\d{7,8}$/.test(imdbId)) return null;

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
    if (!/^[a-zA-Z0-9_-]+$/.test(showId)) return null;

    const epQuery = `{
      findEpisodesByShowId(showId: "${showId}", season: ${season}) {
        items {
          seasonNumber
          number
          timestamps { at type { name } }
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

    return animeSkipSegments(ep.timestamps);
  } catch { return null; }
}

// Anime Skip timestamps mark where a section STARTS; it ends where the next one
// starts (the last one runs to the end, given here as +600 s, cut by the player).
// Up to 1.11 the query asked for a "duration" field the API does not have.
const ANIMESKIP_KEY = [
  [/^(new |mixed )?intro$|^op$|opening/, 'intro'], [/recap/, 'recap'],
  [/^(new |mixed )?credits$|^ed$|outro|ending/, 'outro'], [/preview/, 'preview'], [/filler/, 'filler'],
];
function animeSkipSegments(timestamps) {
  const ts = (Array.isArray(timestamps) ? timestamps : [])
    .filter(t => t && Number.isFinite(Number(t.at)))
    .map(t => ({ at: Number(t.at), type: String(t.type?.name || '').toLowerCase().trim() }))
    .sort((a, b) => a.at - b.at);
  const segments = {};
  for (let i = 0; i < ts.length; i++) {
    const hit = ANIMESKIP_KEY.find(([re]) => re.test(ts[i].type));
    if (!hit || segments[hit[1]]) continue;
    let end = ts[i].at + 600;
    for (let j = i + 1; j < ts.length; j++) { if (ts[j].at > ts[i].at) { end = ts[j].at; break; } }
    segments[hit[1]] = { start_sec: ts[i].at, end_sec: end };
  }
  return Object.keys(segments).length ? segments : null;
}

// SkipDB (api.skipdb.tv, ODbL 1.0): public intro/recap/outro/preview by IMDb id.
// Used where IntroDB has nothing; IntroDB wins when both answer.
async function providerSkipDB(imdbId, season, episode, isMovie) {
  if (!/^tt\d{7,8}$/.test(String(imdbId || ''))) return null;
  try {
    const params = new URLSearchParams({ imdb_id: imdbId });
    if (!isMovie) { params.set('season', String(season)); params.set('episode', String(episode)); }
    const r = await fetchWithRetry(`https://api.skipdb.tv/api/segments?${params}`);
    if (!r.ok) return null;
    return skipDbSegments(await r.json());
  } catch { return null; }
}
function skipDbSegments(data) {
  const src = data && typeof data === 'object' ? data.segments : null;
  if (!src || typeof src !== 'object') return null;
  const out = {};
  for (const k of ['intro', 'recap', 'outro', 'preview']) {
    const v = src[k];
    if (!v || typeof v !== 'object') continue;
    if (v.match === 'out-of-range') continue;
    const a = Number(v.start_ms) / 1000, b = Number(v.end_ms) / 1000;
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) out[k] = { start_sec: a, end_sec: b, confidence: Number(v.confidence) || null };
  }
  return Object.keys(out).length ? out : null;
}

const SB_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler', 'poi_highlight', 'exclusive_access'];
const SB_ACTIONS = ['skip', 'mute', 'poi', 'full'];

// SponsorBlock rows -> { category: [ {start_sec, end_sec, action, votes} ] }.
// poi_highlight is a single moment ("jump to the good part"); a "full" row labels
// the whole video and is kept as { full: 'sponsor' } with no times.
function sponsorBlockSegments(rows) {
  const segments = {};
  for (const seg of Array.isArray(rows) ? rows : []) {
    const key = String(seg && seg.category || '');
    if (!SB_CATEGORIES.includes(key) || !Array.isArray(seg.segment)) continue;
    const action = SB_ACTIONS.includes(seg.actionType) ? seg.actionType : 'skip';
    if (action === 'full') { segments.full = key; continue; }
    const start = Number(seg.segment[0]), end = Number(seg.segment[1]);
    if (!Number.isFinite(start)) continue;
    if (action === 'poi' || key === 'poi_highlight') { segments.poi_highlight = [{ start_sec: start, end_sec: start, action: 'poi' }]; continue; }
    if (!Number.isFinite(end) || end <= start) continue;
    (segments[key] ||= []).push({ start_sec: start, end_sec: end, action, votes: Number(seg.votes) || 0 });
  }
  return Object.keys(segments).length ? segments : null;
}

async function providerSponsorBlock(videoId) {
  // Only for YouTube (11-char video ID)
  if (!videoId || videoId.length !== 11) return null;
  try {
    // Privacy: hash videoID, send only first 4 chars (k-anonymity)
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(videoId));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const prefix = hex.slice(0, 4);

    const r = await fetchWithRetry(
      `https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${encodeURIComponent(JSON.stringify(SB_CATEGORIES))}&actionTypes=${encodeURIComponent(JSON.stringify(SB_ACTIONS))}`
    );
    if (!r.ok) return null;
    const results = await r.json();

    // Find our video in results (multiple videos returned for privacy)
    const match = results.find(v => v.videoID === videoId);
    if (!match || !match.segments?.length) return null;

    return sponsorBlockSegments(match.segments);
  } catch { return null; }
}

async function fetchSegmentsMulti(imdbId, season, episode, isMovie) {
  const config = await getConfig();
  const [introdb, animeskip, skipdb] = await Promise.all([
    providerIntroDB(imdbId, season, episode, config, isMovie),
    isMovie ? null : providerAnimeSkip(imdbId, season, episode, config),
    providerSkipDB(imdbId, season, episode, isMovie),
  ]);
  if (!introdb && !animeskip && !skipdb) return null;
  const merged = Object.assign({}, animeskip || {}, skipdb || {}, introdb || {});
  return Object.keys(merged).length ? merged : null;
}

// OpenSubtitles returns a base_url after login; the session bearer token is sent
// there. Only OpenSubtitles hosts are accepted, anything else falls back.
function osubHost(h) {
  const v = String(h || '').trim().toLowerCase();
  return /^([a-z0-9-]+\.)*opensubtitles\.(com|org)$/.test(v) ? v : 'api.opensubtitles.com';
}

// ── Settings sync snapshot ───────────────────────────────────────────────────
// ss_put_settings overwrites every column, so a write carrying only site_rules
// used to wipe cloud prefs, stats and theme. Every write now sends a full
// snapshot: parts the caller supplied win, the rest come from local storage.
// SYNC_PREF_KEYS is also the allowlist options.js applies when pulling.
const SYNC_PREF_KEYS = ['skipEnabled', 'skipMode', 'skipIntro', 'skipRecap', 'skipOutro',
  'resumePlayback', 'autoNextEpisode', 'playbackSpeed',
  'subtitle_language', 'subtitle_font_size', 'subtitle_enabled',
  'subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'sbModes', 'showTimeline'];

function pickSyncPrefs(obj) {
  const out = {};
  if (obj && typeof obj === 'object') for (const k of SYNC_PREF_KEYS) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function settingsSnapshot(body) {
  const s = await br.storage.local.get([...SYNC_PREF_KEYS, 'skipstream_site_rules', 'skipstream_stats', 'skipstream_theme']);
  const given = pickSyncPrefs(body.prefs);
  const stats = body.stats && typeof body.stats === 'object' && Object.keys(body.stats).length ? body.stats : s.skipstream_stats;
  const theme = typeof body.theme === 'string' && body.theme ? body.theme : s.skipstream_theme;
  return {
    prefs:      Object.keys(given).length ? given : pickSyncPrefs(s),
    site_rules: body.site_rules && typeof body.site_rules === 'object' ? body.site_rules : (s.skipstream_site_rules || {}),
    stats:      stats && typeof stats === 'object' ? stats : {},
    theme:      typeof theme === 'string' && theme ? theme : null,
  };
}

// Prefs are written by the popup, which never pushed them (69ad02c removed the
// options-page push). Push a snapshot 5s after any synced key changes locally.
let _settingsPushTimer = null;
br.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (!keys.some(k => SYNC_PREF_KEYS.includes(k) || k === 'skipstream_site_rules' || k === 'skipstream_theme')) return;
  clearTimeout(_settingsPushTimer);
  _settingsPushTimer = setTimeout(async () => {
    try {
      const { supabaseUrl, supabaseAnonKey } = await getConfig();
      if (!supabaseUrl || !supabaseAnonKey || !isValidSupabaseUrl(supabaseUrl)) return;
      if (!(await techDataAllowed())) return;
      const userId = await getDerivedUserId();
      if (!userId) return;
      const snap = await settingsSnapshot({});
      const res = await fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/ss_put_settings`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: userId, p_stats: snap.stats, p_prefs: snap.prefs, p_site_rules: snap.site_rules, p_theme: snap.theme }),
      });
      if (!res.ok) logError('settings_push', new Error('HTTP ' + res.status));
    } catch (e) { logError('settings_push', e); }
  }, 5000);
});

// ── Service checks ────────────────────────────────────────────────────────────

async function checkSupabase(supabaseUrl, supabaseAnonKey) {
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, message: 'Not configured' };
  if (!isValidSupabaseUrl(supabaseUrl)) return { ok: false, message: 'Invalid URL - must be https://*.supabase.co' };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/ss_verify_setup`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.ok) return { ok: true, message: 'Connected' };
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
const OSUB_UA        = 'SkipStream v' + (br.runtime?.getManifest?.()?.version || 'dev');
const OSUB_SESS_KEY  = 'osub_session';
const OSUB_SUB_CACHE = 'osub_sub_cache'; // file_id → srt text, capped 20 entries and OSUB_CACHE_CHARS
const OSUB_CACHE_CHARS = 2000000;         // about 2 MB of text; storage is shared with history and settings

let _osubReloginTs = 0;
async function osubGetSession() {
  try {
    const s = await br.storage.local.get([OSUB_SESS_KEY, 'osub_username', 'osub_password']);
    const sess = s[OSUB_SESS_KEY];
    if (sess?.token && sess.expiry > Date.now()) return sess;
    // Expired (23h) or missing: log in again with the saved account instead of
    // silently dropping to the 5-a-day anonymous quota. At most once per 10 min.
    const user = String(s.osub_username || '').trim();
    const pass = String(s.osub_password || '');
    if (user && pass && Date.now() - _osubReloginTs > 10 * 60 * 1000) {
      _osubReloginTs = Date.now();
      const r = await osubLogin(user, pass);
      if (r.ok) return (await br.storage.local.get(OSUB_SESS_KEY))[OSUB_SESS_KEY] || null;
    }
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
      base_url: osubHost(data.base_url),
      downloads_remaining: data.user?.allowed_downloads ?? null,
      expiry:   Date.now() + 23 * 60 * 60 * 1000,
    };
    await br.storage.local.set({ [OSUB_SESS_KEY]: sess });
    return { ok: true, downloads_remaining: sess.downloads_remaining };
  } catch (e) { return { ok: false, err: String(e) }; }
}

async function osubSearch(imdbId, season, episode, language, sess, query, year) {
  const base = `https://${osubHost(sess?.base_url)}/api/v1`;
  const headers = { 'Api-Key': OSUB_API_KEY, 'User-Agent': OSUB_UA };
  if (sess?.token) headers['Authorization'] = 'Bearer ' + sess.token;

  const numericId = /^tt\d{7,8}$/.test(String(imdbId || '')) ? String(imdbId).slice(2) : '';
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!numericId && !q) return null;

  const params = new URLSearchParams({
    languages:       language || 'en',
    order_by:        'download_count',
    order_direction: 'desc',
  });
  if (numericId) params.set('imdb_id', numericId);
  else {
    params.set('query', q);
    if (/^(19|20)\d{2}$/.test(String(year || ''))) params.set('year', String(year));
  }
  if (season)  params.set('season_number',  String(season));
  if (episode) params.set('episode_number', String(episode));
  // A title search without S/E may be either kind: let OpenSubtitles decide.
  if (numericId || (season && episode)) params.set('type', (season && episode) ? 'episode' : 'movie');

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
    const hit = cache['f' + file_id] || cache[file_id];   // 'f' prefix keeps insertion order (numeric keys sort first)
    if (hit) return { ok: true, text: hit };
  } catch { /* miss */ }

  const base = `https://${osubHost(sess?.base_url)}/api/v1`;
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

    // Cache: at most 20 files and OSUB_CACHE_CHARS in total, oldest out first.
    // One file bigger than half the budget is used but not cached.
    try {
      if (text.length <= OSUB_CACHE_CHARS / 2) {
        const c = await br.storage.local.get(OSUB_SUB_CACHE);
        const cache = c[OSUB_SUB_CACHE] || {};
        const ck = 'f' + file_id;
        delete cache[file_id]; delete cache[ck];
        let keys = Object.keys(cache);
        let total = keys.reduce((a, k) => a + String(cache[k] || '').length, 0);
        while (keys.length && (keys.length >= OSUB_CACHE_MAX || total + text.length > OSUB_CACHE_CHARS)) {
          total -= String(cache[keys[0]] || '').length;
          delete cache[keys.shift()];
        }
        cache[ck] = text;
        await br.storage.local.set({ [OSUB_SUB_CACHE]: cache });
      }
    } catch (e) { logError('osub_cache', e); }

    return { ok: true, text, remaining: data.remaining };
  } catch (e) { logError('osub_download', e); return { ok: false, err: String(e) }; }
}

// ── First install / update handler ───────────────────────────────────────────

br.runtime.onInstalled.addListener(async ({ reason }) => {
  // Re-register alarms in case they were cleared by browser update or SW restart
  if (IS_SW) {
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

// ── Device linking (backup restore) ──────────────────────────────────────────
// Restoring a backup that carries a sync identity makes this browser share
// history with the browser that made it. This browser's own cloud rows move to
// that id first (the newer position wins), so nothing it saved is lost. If the
// move fails, the id is not switched.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adoptInstallId(newId) {
  if (!UUID_RE.test(String(newId || ''))) return { ok: false, err: 'bad_id' };
  const oldId = await getDerivedUserId();
  if (oldId === newId) return { ok: true, moved: 0, same: true };
  let moved = 0;
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (oldId && supabaseUrl && supabaseAnonKey && isValidSupabaseUrl(supabaseUrl)) {
    try {
      const r = await fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/ss_get_playback_all`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: oldId }),
      });
      if (!r.ok) return { ok: false, err: 'move_failed' };
      const rows = await r.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || !row.media_id) continue;
        const res = await supabaseUpsert({ ...row, user_id: newId });
        if (!res.ok) return { ok: false, err: 'move_failed', moved };
        moved++;
      }
    } catch { return { ok: false, err: 'move_failed', moved }; }
  }
  await br.storage.local.set({ [INSTALL_ID_KEY]: newId });
  try { await br.storage.local.remove('_ss_cloud_sync_ts'); } catch { /* ok */ }
  _cachedUserId = newId;
  return { ok: true, moved };
}

// ── "Check this page" (popup) ────────────────────────────────────────────────
// A tab message reaches every frame, but only the first answer comes back. So
// each frame reports to the background instead, and the popup reads them all.
const _diagReports = {};

async function runPageCheck(tabId) {
  _diagReports[tabId] = [];
  try { await br.tabs.sendMessage(tabId, { type: 'SS_DIAG_PING' }); } catch { /* frames may not answer */ }
  await new Promise(r => setTimeout(r, 1200));
  const out = _diagReports[tabId] || [];
  delete _diagReports[tabId];
  return { ok: true, frames: out.slice(0, 40) };
}

// ── "Site report" (popup) ─────────────────────────────────────────────────────
// Runs content-scripts/probe.js once in every frame of the tab, including blank
// and srcdoc frames, and returns what each one sees. Nothing leaves the browser.
async function runSiteReport(tabId) {
  try {
    if (globalThis.chrome?.scripting?.executeScript && !globalThis.browser?.tabs?.executeScript) {
      const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content-scripts/probe.js'] });
      return { ok: true, frames: (res || []).map(r => r && r.result).filter(Boolean).slice(0, 40) };
    }
    const res = await br.tabs.executeScript(tabId, { file: '/content-scripts/probe.js', allFrames: true, matchAboutBlank: true, runAt: 'document_idle' });
    return { ok: true, frames: (res || []).filter(x => x && typeof x === 'object').slice(0, 40) };
  } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 120) }; }
}

// ── Message router ────────────────────────────────────────────────────────────

br.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message;

  
  if (msg.type === 'ADOPT_INSTALL_ID') {
    adoptInstallId(msg.installId).then(sendResponse, e => sendResponse({ ok: false, err: String(e) }));
    return true;
  }

  if (msg.type === 'SS_SITE_REPORT') {
    if (!Number.isInteger(msg.tabId)) { sendResponse({ ok: false, err: 'no_tab' }); return; }
    runSiteReport(msg.tabId).then(sendResponse, () => sendResponse({ ok: false, err: 'failed' }));
    return true;
  }

  if (msg.type === 'SS_DIAG_RUN') {
    if (!Number.isInteger(msg.tabId)) { sendResponse({ ok: false, err: 'no_tab' }); return; }
    runPageCheck(msg.tabId).then(sendResponse, () => sendResponse({ ok: false, err: 'failed' }));
    return true;
  }

  if (msg.type === 'SS_DIAG_REPORT') {
    const tabId = sender?.tab?.id;
    if (Number.isInteger(tabId) && _diagReports[tabId] && msg.report && typeof msg.report === 'object') {
      const r = msg.report;
      _diagReports[tabId].push({
        frame: String(r.frame || '').slice(0, 120), top: !!r.top,
        videos: Number(r.videos) || 0, hidden: Number(r.hidden) || 0,
        blankFrames: Number(r.blankFrames) || 0, attached: Number(r.attached) || 0,
        ident: String(r.ident || '').slice(0, 120), segs: String(r.segs || '').slice(0, 120),
        subs: String(r.subs || '').slice(0, 120), last: String(r.last || '').slice(0, 120),
        auto: String(r.auto || '').slice(0, 80),
      });
    }
    sendResponse({ ok: true });
    return;
  }

  // Embedded players ask which page they are on (address and title of the tab).
  if (msg.type === 'GET_TAB_INFO') {
    const t = sender?.tab;
    sendResponse({ url: typeof t?.url === 'string' ? t.url : null, title: typeof t?.title === 'string' ? t.title : null });
    return;
  }

  if (msg.type === 'TMDB_FIND_TITLE') {
    const title = typeof msg.title === 'string' ? msg.title.slice(0, 200) : '';
    const kind = msg.kind === 'movie' || msg.kind === 'tv' ? msg.kind : '';
    const year = /^(19|20)\d{2}$/.test(String(msg.year || '')) ? Number(msg.year) : null;
    const cacheKey = `find:${kind}:${_normTitle(title)}:${year || ''}`;
    getTmdbCache().then(async (cache) => {
      if (cacheKey in cache) { sendResponse({ answered: true, ...(cache[cacheKey] || { imdbId: null }) }); return; }
      const { tmdbApiKey } = await getConfig();
      if (!tmdbApiKey || !title) { sendResponse({ answered: false, imdbId: null }); return; }
      try {
        const r = await tmdbFindTitle(title, year, kind, tmdbApiKey);
        if (r.answered) await setTmdbCache(cacheKey, r.imdbId ? { imdbId: r.imdbId, kind: r.kind } : null);
        sendResponse(r);
      } catch { sendResponse({ answered: false, imdbId: null }); }
    });
    return true;
  }

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
    if (!/^\d+$/.test(String(msg.tmdbId))) { sendResponse({ imdbId: null }); return; }
    const kind = msg.kind === 'movie' ? 'movie' : 'tv';
    const cacheKey = `${kind}:${msg.tmdbId}`;
    getTmdbCache().then(async (cache) => {
      // Only real ids are trusted from cache; old null entries are retried.
      if (cache[cacheKey]) { sendResponse({ imdbId: cache[cacheKey] }); return; }
      const { tmdbApiKey } = await getConfig();
      if (!tmdbApiKey) { sendResponse({ imdbId: null }); return; }
      const title = typeof msg.title === 'string' ? msg.title.trim() : '';
      try {
        // With a page title, check the number really is this work on TMDB:
        // many sites use their own numbers in /movie/123 style addresses.
        const r = await tmdbFetch(title ? `/${kind}/${msg.tmdbId}?append_to_response=external_ids` : `/${kind}/${msg.tmdbId}/external_ids`, tmdbApiKey);
        if (!r.ok) { sendResponse({ imdbId: null }); return; }
        const raw = await r.json();
        if (title && !_looseTitle(title, raw?.title || raw?.name || '')) { sendResponse({ imdbId: null, mismatch: true }); return; }
        const data = title ? (raw?.external_ids || {}) : raw;
        const id = /^tt\d{7,8}$/.test(String(data?.imdb_id || '')) ? data.imdb_id : null;
        if (id) await setTmdbCache(cacheKey, id);
        sendResponse({ imdbId: id });
      } catch { sendResponse({ imdbId: null }); }
    });
    return true;
  }

  if (msg.type === 'FETCH_SEGMENTS') {
    fetchSegmentsMulti(msg.imdbId, msg.season, msg.episode, !!msg.isMovie)
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

  if (msg.type === 'FETCH_SEGMENTS_YT') {
    providerSponsorBlock(msg.videoId)
      .then(data => {
        const tabId = sender?.tab?.id;
        if (tabId && badgeAPI?.setBadgeText) {
          badgeAPI.setBadgeText({ text: data ? '' : '', tabId });
        }
        sendResponse({ data: data || null, err: data ? null : 'no_data' });
      })
      .catch(e => {
        logError('sponsorblock', e);
        sendResponse({ data: null, err: String(e) });
      });
    return true;
  }

  if (msg.type === 'SUPABASE_UPSERT') {
    // Store last-known tab state in storage (SW-restart safe)
    if (sender?.tab?.id && msg.body) {
      getConfig().then(async ({ supabaseAnonKey }) => {
        const userId = supabaseAnonKey ? await getDerivedUserId() : null;
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
      fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/ss_get_playback`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: msg.userId, p_media_id: msg.mediaId }),
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => {
          const row = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length ? data : null;
          sendResponse({ data: row });
        })
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  if (msg.type === 'SUPABASE_SETTINGS_UPSERT') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ ok: false, err: 'invalid_url' }); return; }
      if (!(await techDataAllowed())) { sendResponse({ ok: false, err: 'tech_data_off' }); return; }
      try {
        const snap = await settingsSnapshot(msg.body || {});
        const res = await fetchWithRetry(
          `${supabaseUrl}/rest/v1/rpc/ss_put_settings`,
          {
            method: 'POST',
            headers: {
              apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              p_user_id:    msg.body.user_id,
              p_stats:      snap.stats,
              p_prefs:      snap.prefs,
              p_site_rules: snap.site_rules,
              p_theme:      snap.theme,
            }),
          }
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          sendResponse({ ok: false, err: `HTTP ${res.status}: ${detail}` });
          return;
        }
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, err: String(e) }); }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_SETTINGS_GET') {
    getConfig().then(async ({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ data: null, err: 'invalid_url' }); return; }
      try {
        const res = await fetchWithRetry(
          `${supabaseUrl}/rest/v1/rpc/ss_get_settings`,
          {
            method: 'POST',
            headers: {
              apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              p_user_id: msg.userId,
            }),
          }
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          sendResponse({ data: null, err: `HTTP ${res.status}: ${detail}` });
          return;
        }
        const result = await res.json();
        sendResponse({ data: result || null });
      } catch (e) { sendResponse({ data: null, err: String(e) }); }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_GET_ALL') {
    getConfig().then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      if (!isValidSupabaseUrl(supabaseUrl)) { sendResponse({ data: null, err: 'invalid_url' }); return; }
      fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/ss_get_playback_all`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: msg.userId }),
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => sendResponse({ data: Array.isArray(data) ? data : [] }))
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  if (msg.type === 'TMDB_SEARCH_POSTER') {
    // Search TMDB for a title and return poster_path as full URL
    // Tries TV search first, then movie search, returns first result
    const ytMatch = /^yt\/([A-Za-z0-9_-]{11})$/.exec(msg.mediaId || '');
    if (ytMatch) {
      sendResponse({ posterUrl: `https://i.ytimg.com/vi/${ytMatch[1]}/mqdefault.jpg` });
      return;
    }
    // poster2: entries from the old lookup (first search hit, wide backdrops) are not reused.
    const posterCacheKey = msg.mediaId
      ? `poster2:${String(msg.mediaId).toLowerCase().trim()}:${(msg.title || '').toLowerCase().trim()}`
      : `poster2:${(msg.title || '').toLowerCase().trim()}`;
    getTmdbCache().then(async (cache) => {
      if (posterCacheKey in cache) {
        sendResponse({ posterUrl: cache[posterCacheKey] });
        return;
      }
      const { tmdbApiKey } = await getConfig();
      if (!tmdbApiKey) {
        // Not cached: adding a key later must be able to fill this in.
        sendResponse({ posterUrl: null });
        return;
      }
      try {
        const { path: posterPath, allOk } = await tmdbPoster(msg.mediaId, msg.title || '', tmdbApiKey);
        const posterUrl = posterPath
          ? `https://image.tmdb.org/t/p/w185${posterPath}`
          : null;
        // Cache hits, and misses only when TMDB really answered (not 401/5xx).
        if (posterUrl || allOk) await setTmdbCache(posterCacheKey, posterUrl);
        sendResponse({ posterUrl });
      } catch {
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
      const { imdbId, season, episode, language, query, year } = msg;
      const sess = await osubGetSession();
      let result = await osubSearch(imdbId, season, episode, language, sess, query, year);

      // Fallback to English if primary language has no results
      if (!result && language && language !== 'en') {
        result = await osubSearch(imdbId, season, episode, 'en', sess, query, year);
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
