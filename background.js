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
    await pushUnsyncedHistory();
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
// "Watch The Matrix (1999) Online Free | StreamSite" -> { q: "The Matrix", year: 1999, tv: false }
// "Dark - S01E02 - Lies" -> { q: "Dark", year: null, tv: true }
// Release and streaming tags that are never part of a film's name.
const _RELEASE_JUNK = /\s*(?:\b(?:2160p|1080p|720p|480p|360p|4k|uhd|hdr10\+?|hdr|hdrip|hdtv|web-?dl|web-?rip|blu-?ray|brrip|bdrip|dvdrip|dvdscr|hdcam|camrip|x26[45]|h\.?26[45]|hevc|10bit|aac(?:2\.0)?|dd[p+]?5\.1|dual[\s-]audio|multi[\s-]audio|esubs?|(?:english|eng)[\s-]sub(?:bed|s|titled)?|subbed|dubbed|(?:hindi|english|tamil|telugu|japanese)[\s-]dub(?:bed)?|full[\s-]movie|full[\s-]episodes?|watch[\s-]online|free[\s-]download)\b)/gi;
const _RELEASE_JUNK_1 = new RegExp(_RELEASE_JUNK.source, 'i');
function _stripRelease(t) {
  return String(t || '')
    .replace(/\[[^\]]{0,60}\]/g, ' ')                                             // [1080p] [Eng Sub]
    .replace(/\((?![^)]*\b(?:19|20)\d{2}\b)[^)]{0,40}\)/g, m => (/[a-z]{3}/i.test(m) && !_RELEASE_JUNK_1.test(m) ? m : ' ')) // (HD), keeps (1999)
    .replace(_RELEASE_JUNK, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, ' ')                          // emoji
    .replace(/(?:\s+(?:hd|online|free|watch|streaming|now))+\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}
// Letter-pair similarity (Dice), 0..1, on normalised titles.
function _titleSim(a, b) {
  const x = _normTitle(a).replace(/^the /, ''), y = _normTitle(b).replace(/^the /, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const pairs = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const px = pairs(x), py = pairs(y);
  let hit = 0, n = 0;
  for (const [p, c] of px) { n += c; if (py.has(p)) hit += Math.min(c, py.get(p)); }
  for (const c of py.values()) n += c;
  return n ? (2 * hit) / n : 0;
}
function _yearOf(x) { const m = String((x && (x.release_date || x.first_air_date)) || '').match(/^(\d{4})/); return m ? Number(m[1]) : null; }

function cleanMediaTitle(raw) {
  let t = _stripRelease(String(raw || '').slice(0, 300).replace(/\s+/g, ' ').trim());
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
  const hits = [], fuzzy = [];
  for (const kd of (k ? [k] : ['movie', 'tv'])) {
    const r = await tmdbFetch(`/search/${kd}?query=${encodeURIComponent(q)}&page=1&include_adult=false${_tmdbYearParam(kd, y)}`, key);
    if (!r.ok) { answered = false; continue; }
    const d = await r.json();
    for (const x of (d.results || []).slice(0, 10)) {
      if ([x.title, x.name, x.original_title, x.original_name].some(n => _sameTitle(n, q))) {
        hits.push({ kind: kd, id: x.id, pop: Number(x.popularity) || 0 });
      } else if (y && _yearOf(x) === y && [x.title, x.name].some(n => _titleSim(n, q) >= 0.9)) {
        fuzzy.push({ kind: kd, id: x.id, pop: Number(x.popularity) || 0 });
      }
    }
  }
  if (!hits.length && y && fuzzy.length === 1) hits.push(fuzzy[0]);
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
  let best = null, bestSim = 0;
  for (const kd of (c.tv ? ['tv', 'movie'] : ['movie', 'tv'])) {
    const r = await tmdbFetch(`/search/${kd}?query=${encodeURIComponent(c.q)}&page=1${_tmdbYearParam(kd, c.year)}`, key);
    if (!r.ok) { allOk = false; continue; }
    const d = await r.json();
    const res = (d.results || []).filter(x => pick(x));
    const exact = res.find(x => [x.title, x.name, x.original_title, x.original_name].some(n => _sameTitle(n, c.q)));
    if (exact) return { path: pick(exact), allOk };
    for (const x of res.slice(0, 10)) {
      if (c.year && _yearOf(x) && Math.abs(_yearOf(x) - c.year) > 1) continue;
      const sim = Math.max(...[x.title, x.name, x.original_title, x.original_name].map(n => _titleSim(n, c.q)));
      if (sim > bestSim) { bestSim = sim; best = x; }
    }
  }
  // Closest name only when it is close: no artwork beats the wrong film's poster.
  return { path: bestSim >= 0.75 ? pick(best) : null, allOk };
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
      // 406: OpenSubtitles' "daily downloads used up". Never temporary, never retried.
      if ([400, 401, 403, 404, 406, 409, 422].includes(res.status)) return res;
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

// Supabase keys (1.13): legacy anon keys are JWTs and go in apikey and as Bearer.
// New publishable keys (sb_publishable_...) are not JWTs. Supabase says: send
// them in apikey only, never as a Bearer token.
function sbAuth(key) {
  const k = String(key || '').trim();
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(k) && !k.startsWith('sb_') ? { apikey: k, Authorization: `Bearer ${k}` } : { apikey: k };
}

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
          ...sbAuth(supabaseAnonKey),
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

// Every 5 minutes: positions saved on this device since the last run go to the
// cloud too, so a phone that closed the tab mid-video (no pause, no pagehide)
// still reaches the other devices. Newer wins on the server (updated_at).
const LAST_PUSH_KEY = 'skipstream_last_push_t';
// The name a row gets when the user set none: the same browser name that the
// content script sends (Firefox, Edge or Chrome), never an empty device (1.13.1).
function defaultDeviceName() {
  const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  return ua.includes('Firefox') ? 'Firefox' : /Edg(A|iOS)?\//.test(ua) ? 'Edge' : 'Chrome';
}
let _pushingHistory = false;
async function pushUnsyncedHistory() {
  if (_pushingHistory) return { pushed: 0 };
  _pushingHistory = true;
  try {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    if (!supabaseUrl || !supabaseAnonKey || !isValidSupabaseUrl(supabaseUrl)) return { pushed: 0 };
    const userId = await getDerivedUserId();
    if (!userId) return { pushed: 0 };
    const st = await br.storage.local.get(['skipstream_cache', LAST_PUSH_KEY, 'deviceName']);
    const cache = st.skipstream_cache || {};
    const since = Number(st[LAST_PUSH_KEY]) || 0;
    const due = Object.entries(cache)
      .filter(([, e]) => e && Number(e.t) > since && Number(e.p) >= 10 && e.title)
      .sort((a, b) => (Number(a[1].t) || 0) - (Number(b[1].t) || 0)).slice(0, 25);
    let pushed = 0, mark = since;
    for (const [mediaId, e] of due) {
      const r = await supabaseUpsert({
        user_id: userId, media_id: mediaId, playback_time: Math.floor(e.p), duration: e.d || 0,
        site: e.site || '', site_name: e.site_name || e.site || '', video_title: e.title || '', page_url: e.url || '',
        device_name: String(st.deviceName || '').trim() || defaultDeviceName(), updated_at: new Date(Math.min(Number(e.t), Date.now())).toISOString(),
      });
      if (!r.ok) break;              // offline or not set up: try again next run
      pushed++; mark = Number(e.t);
    }
    if (mark > since) await br.storage.local.set({ [LAST_PUSH_KEY]: mark, skipstream_last_sync: Date.now() });
    return { pushed };
  } catch (e) { logError('push_history', e); return { pushed: 0 }; }
  finally { _pushingHistory = false; }
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
          ...sbAuth(supabaseAnonKey),
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
async function providerSkipDB(imdbId, season, episode, isMovie, durationSec) {
  if (!/^tt\d{7,8}$/.test(String(imdbId || ''))) return null;
  try {
    const params = new URLSearchParams({ imdb_id: imdbId });
    if (!isMovie) { params.set('season', String(season)); params.set('episode', String(episode)); }
    // The stream length lets SkipDB pick, and shift, the times made for this release.
    if (durationSec > 0) params.set('duration', String(Math.round(durationSec)));
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
    (segments[key] ||= []).push({ start_sec: start, end_sec: end, action, votes: Number(seg.votes) || 0,
      ...(Number(seg.videoDuration) > 0 ? { video_duration: Number(seg.videoDuration) } : {}) });
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
      `https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${encodeURIComponent(JSON.stringify(SB_CATEGORIES))}&actionTypes=${encodeURIComponent(JSON.stringify(SB_ACTIONS))}&service=YouTube`
    );
    if (!r.ok) return null;
    const results = await r.json();

    // Find our video in results (multiple videos returned for privacy)
    const match = results.find(v => v.videoID === videoId);
    if (!match || !match.segments?.length) return null;

    return sponsorBlockSegments(match.segments);
  } catch { return null; }
}

// TheIntroDB (theintrodb.org, API v3): intro, recap, credits, preview by TMDB id,
// or by IMDb id when no TMDB id is known; reads need no key. Up to 1.13 rounds
// 1-2 this asked v1, which no longer answers, so TheIntroDB never gave a skip.
// A start of null means "from the beginning"; a credits/preview end of null
// means "to the end of the video". A kind can have more than one entry (two
// recaps, credits with a scene between): all are kept.
async function providerTheIntroDB(tmdbId, season, episode, isMovie, durationSec, imdbId) {
  const byTmdb = /^\d{1,9}$/.test(String(tmdbId || ''));
  if (!byTmdb && !/^tt\d{7,8}$/.test(String(imdbId || ''))) return null;
  try {
    const params = new URLSearchParams(byTmdb ? { tmdb_id: String(tmdbId) } : { imdb_id: String(imdbId) });
    if (!isMovie) { params.set('season', String(season)); params.set('episode', String(episode)); }
    if (durationSec > 0) params.set('duration_ms', String(Math.round(durationSec * 1000)));
    const r = await fetchWithRetry(`https://api.theintrodb.org/v3/media?${params}`, {}, 1);
    if (!r.ok) return null;
    return theIntroDbSegments(await r.json(), durationSec);
  } catch { return null; }
}
function theIntroDbSegments(data, durationSec) {
  if (!data || typeof data !== 'object') return null;
  const out = {};
  for (const [src, key] of [['intro', 'intro'], ['recap', 'recap'], ['credits', 'outro'], ['preview', 'preview']]) {
    const list = Array.isArray(data[src]) ? data[src] : (data[src] && typeof data[src] === 'object' ? [data[src]] : []);
    for (const sg of list) {
      if (!sg || typeof sg !== 'object') continue;
      const a = sg.start_ms != null ? Number(sg.start_ms) / 1000 : (sg.start_sec != null ? Number(sg.start_sec) : 0);
      let b = sg.end_ms != null ? Number(sg.end_ms) / 1000 : (sg.end_sec != null ? Number(sg.end_sec) : NaN);
      if (!Number.isFinite(b) && (key === 'outro' || key === 'preview')) b = durationSec > a ? durationSec : a + 600;
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) continue;
      (out[key] ||= []).push({ start_sec: a, end_sec: b });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => x.start_sec - y.start_sec);
  return Object.keys(out).length ? out : null;
}

// AniSkip (api.aniskip.com, open CORS): anime openings, endings and recaps by
// MyAnimeList id and episode number. episodeLength picks timings made for a
// release of the same length (0 = any).
async function providerAniSkip(malId, episode, durationSec) {
  if (!/^\d{1,7}$/.test(String(malId || '')) || !(Number(episode) > 0)) return null;
  try {
    const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].map(t => 'types[]=' + t).join('&');
    const len = durationSec > 0 ? Math.round(durationSec) : 0;
    const r = await fetchWithRetry(`https://api.aniskip.com/v2/skip-times/${malId}/${Number(episode)}?${types}&episodeLength=${len}`, {}, 1);
    if (!r.ok) return null;
    return aniSkipSegments(await r.json());
  } catch { return null; }
}
const ANISKIP_KEY = { op: 'intro', 'mixed-op': 'intro', ed: 'outro', 'mixed-ed': 'outro', recap: 'recap' };
function aniSkipSegments(data) {
  if (!data || !data.found || !Array.isArray(data.results)) return null;
  const out = {};
  for (const r of data.results) {
    const key = ANISKIP_KEY[r && r.skipType];
    const a = Number(r && r.interval && r.interval.startTime), b = Number(r && r.interval && r.interval.endTime);
    if (!key || out[key] || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) continue;
    out[key] = { start_sec: a, end_sec: b };
  }
  return Object.keys(out).length ? out : null;
}

// Anime title -> MyAnimeList id (Jikan, the public MyAnimeList API): only an exact
// title match counts, and two different shows with that name give no answer.
const _malCache = new Map();
async function jikanMalId(title) {
  const q = cleanMediaTitle(title).q;
  if (!q || q.length < 2) return null;
  const ck = _normTitle(q);
  if (_malCache.has(ck)) return _malCache.get(ck);
  try {
    const r = await fetchWithRetry(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=10&sfw=true`, {}, 1);
    if (!r.ok) return null;
    const d = await r.json();
    const ids = new Set();
    for (const x of (d && Array.isArray(d.data) ? d.data : [])) {
      const names = [x.title, x.title_english, x.title_japanese, ...((x.titles || []).map(t => t && t.title)), ...((x.title_synonyms) || [])];
      if (names.some(n => _sameTitle(n, q))) ids.add(x.mal_id);
    }
    const id = ids.size === 1 ? [...ids][0] : null;
    _malCache.set(ck, id);
    if (_malCache.size > 200) _malCache.delete(_malCache.keys().next().value);
    return id;
  } catch { return null; }
}

// IMDb id -> TMDB id, only with the user's own TMDB key (for TheIntroDB).
async function tmdbIdFromImdb(imdbId, isMovie) {
  const { tmdbApiKey } = await getConfig();
  if (!tmdbApiKey || !/^tt\d{7,8}$/.test(String(imdbId || ''))) return null;
  try {
    const r = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`, tmdbApiKey);
    if (!r.ok) return null;
    const d = await r.json();
    const hit = (isMovie ? d.movie_results : d.tv_results || d.tv_episode_results) || [];
    return hit[0] && hit[0].id ? hit[0].id : null;
  } catch { return null; }
}

// Every skip source answers on its own; mergeSkipSources makes one list.
// Kinds (intro, recap, outro, preview) combine across sources: if IntroDB has
// the intro and SkipDB the credits, both are used. Inside one kind, ONE source
// gives all its parts: the first in this order that has that kind: IntroDB,
// TheIntroDB, SkipDB, AniSkip, Anime Skip. Parts from two sources are never
// mixed in one kind: their times can come from different releases of the same
// video, and a mix could skip the same intro twice, plus real content between.
// A source can give two or more parts of a kind (two recaps; credits with a
// scene between): all are kept. Each part keeps "src", the source's name. One
// part stays an object (as before 1.13); two or more become a list by start.
const SKIP_SOURCE_ORDER = ['IntroDB', 'TheIntroDB', 'SkipDB', 'AniSkip', 'Anime Skip'];
function mergeSkipSources(bySource) {
  const out = {};
  for (const src of SKIP_SOURCE_ORDER) {
    const segs = bySource && bySource[src];
    if (!segs || typeof segs !== 'object') continue;
    for (const [k, v] of Object.entries(segs)) {
      if (out[k]) continue;   // a higher source already gave this kind
      const parts = [];
      for (const sg of [].concat(v)) {
        const a = Number(sg && sg.start_sec), b = Number(sg && sg.end_sec);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) continue;
        parts.push(Object.assign({}, sg, { start_sec: a, end_sec: b, src }));
      }
      if (!parts.length) continue;
      parts.sort((x, y) => x.start_sec - y.start_sec);
      out[k] = parts.length === 1 ? parts[0] : parts;
    }
  }
  return Object.keys(out).length ? out : null;
}

// One lookup, every source (see mergeSkipSources for who wins).
async function fetchSegmentsMulti(imdbId, season, episode, isMovie, extra = {}) {
  const config = await getConfig();
  const imdb = /^tt\d{7,8}$/.test(String(imdbId || '')) ? imdbId : null;
  const dur = Number(extra.durationSec) > 0 ? Number(extra.durationSec) : 0;
  let tmdbId = /^\d{1,9}$/.test(String(extra.tmdbId || '')) ? Number(extra.tmdbId) : null;
  if (!tmdbId && imdb) tmdbId = await tmdbIdFromImdb(imdb, isMovie);
  let malId = /^\d{1,7}$/.test(String(extra.malId || '')) ? Number(extra.malId) : null;
  if (!malId && extra.anime && extra.title && Number(episode) > 0) malId = await jikanMalId(extra.title);
  const [introdb, animeskip, skipdb, tidb, aniskip] = await Promise.all([
    imdb ? providerIntroDB(imdb, season, episode, config, isMovie) : null,
    isMovie || !imdb ? null : providerAnimeSkip(imdb, season, episode, config),
    imdb ? providerSkipDB(imdb, season, episode, isMovie, dur) : null,
    (tmdbId || imdb) && (isMovie || (season && episode)) ? providerTheIntroDB(tmdbId, season, episode, isMovie, dur, imdb) : null,
    malId && !isMovie ? providerAniSkip(malId, episode, dur) : null,
  ]);
  if (!introdb && !animeskip && !skipdb && !tidb && !aniskip) return null;
  return mergeSkipSources({ IntroDB: introdb, TheIntroDB: tidb, SkipDB: skipdb, AniSkip: aniskip, 'Anime Skip': animeskip });
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
  'subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'subtitle_edge', 'subtitle_weight', 'sbModes', 'showTimeline', 'skipNotice', 'resumeNotice', 'ccButton'];

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
        headers: { ...sbAuth(supabaseAnonKey), 'Content-Type': 'application/json' },
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
      headers: { ...sbAuth(supabaseAnonKey), 'Content-Type': 'application/json' },
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
// A saved, still valid session only. Never logs in (login is slow and rate limited).
async function osubCachedSession() {
  try { const s = (await br.storage.local.get(OSUB_SESS_KEY))[OSUB_SESS_KEY]; return s?.token && s.expiry > Date.now() ? s : null; } catch { return null; }
}

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
      // allowed_downloads is the daily allowance (free account: 20), not what is left.
      downloads_allowed: data.user?.allowed_downloads ?? null,
      downloads_remaining: null,
      expiry:   Date.now() + 23 * 60 * 60 * 1000,
    };
    await br.storage.local.set({ [OSUB_SESS_KEY]: sess });
    return { ok: true, downloads_remaining: sess.downloads_remaining, downloads_allowed: sess.downloads_allowed };
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
      return { ok: false, status: r.status, err: `HTTP ${r.status}${txt ? ' - ' + txt.slice(0, 120) : ''}` };
    }
    const data = await r.json();
    if (!data.link) return { ok: false, err: 'No download link' };

    // Update remaining downloads in session cache (account downloads only)
    if (data.remaining !== undefined && sess?.token) {
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
        headers: { ...sbAuth(supabaseAnonKey), 'Content-Type': 'application/json' },
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
        started: r.started !== false, error: String(r.error || '').slice(0, 120),
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
        if (r.answered) await setTmdbCache(cacheKey, r.imdbId ? { imdbId: r.imdbId, kind: r.kind, tmdbId: r.tmdbId || null } : null);
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
    fetchSegmentsMulti(msg.imdbId, msg.season, msg.episode, !!msg.isMovie,
      { tmdbId: msg.tmdbId, malId: msg.malId, anime: !!msg.anime, title: msg.title, durationSec: msg.durationSec })
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
        headers: { ...sbAuth(supabaseAnonKey), 'Content-Type': 'application/json' },
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
              ...sbAuth(supabaseAnonKey),
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
              ...sbAuth(supabaseAnonKey),
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
        headers: { ...sbAuth(supabaseAnonKey), 'Content-Type': 'application/json' },
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
            ...sbAuth(supabaseAnonKey),
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
      downloads_allowed: sess?.downloads_allowed ?? null,
    }));
    return true;
  }

  if (msg.type === 'OSUB_SEARCH_AND_FETCH') {
    (async () => {
      const { imdbId, season, episode, language, query, year } = msg;
      // Search with a saved session if there is one (searches cost nothing).
      const sess = await osubCachedSession();
      let result = await osubSearch(imdbId, season, episode, language, sess, query, year);

      // Fallback to English if primary language has no results
      if (!result && language && language !== 'en') {
        result = await osubSearch(imdbId, season, episode, 'en', sess, query, year);
      }

      if (!result) { sendResponse({ ok: false, err: 'no_results' }); return; }
      // Download without the account first (5 a day per address), so the account's
      // own 20 a day are used only when that is refused (owner request, 5 Oct).
      let dl = await osubDownload(result.file_id, null);
      let via = 'no account';
      if (!dl.ok && dl.status && dl.status !== 404) {
        const acct = await osubGetSession();
        if (acct?.token) { dl = await osubDownload(result.file_id, acct); via = 'account'; }
      }
      sendResponse({ ...dl, via, file_id: result.file_id, name: result.name });
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
