/* SkipStream - background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;

const tmdbCache  = {};
let cachedUserId = null;

// Per-tab last-known playback state: tabId → { userId, body }
// Used by tabs.onRemoved to force a final sync flush
const tabPlaybackState = new Map();

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

async function getDerivedUserId(anonKey) {
  if (cachedUserId) return cachedUserId;
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('skipstream:uid:' + anonKey));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    cachedUserId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    return cachedUserId;
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

// ── Supabase upsert (internal helper, used by both message handler and tab flush) ──

async function supabaseUpsert(body, { keepalive = false } = {}) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, err: 'not_configured' };
  try {
    const res = await fetchWithRetry(
      `${supabaseUrl}/rest/v1/playback_states?on_conflict=user_id,media_id`,
      {
        method: 'POST',
        keepalive,   // true on unload path - survives page/tab death on mobile
        headers: {
          apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      }
    );
    return res.ok ? { ok: true } : { ok: false, err: `HTTP ${res.status}` };
  } catch (e) { return { ok: false, err: String(e) }; }
}

// ── Tab-close flush ───────────────────────────────────────────────────────────
// When a tab is removed, fire a final upsert for its last-known playback state.

if (br.tabs && br.tabs.onRemoved) {
  br.tabs.onRemoved.addListener(async (tabId) => {
    const state = tabPlaybackState.get(tabId);
    if (!state) return;
    tabPlaybackState.delete(tabId);
    if (!state.userId || !state.body) return;
    try {
      await supabaseUpsert(state.body, { keepalive: true });
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
      if (type.includes('intro') || type === 'op')  segments.intro  = { start_sec: ts.at, end_sec: end };
      if (type.includes('recap'))                    segments.recap  = { start_sec: ts.at, end_sec: end };
      if (type.includes('outro') || type === 'ed')   segments.outro  = { start_sec: ts.at, end_sec: end };
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
    cachedUserId = null;
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
    if (cacheKey in tmdbCache) { sendResponse({ imdbId: tmdbCache[cacheKey] }); return true; }
    getConfig().then(({ tmdbApiKey }) => {
      if (!tmdbApiKey) { tmdbCache[cacheKey] = null; sendResponse({ imdbId: null }); return; }
      fetchWithRetry(`https://api.themoviedb.org/3/tv/${msg.tmdbId}/external_ids?api_key=${tmdbApiKey}`)
        .then(r => r.json())
        .then(data => {
          const id = data.imdb_id || null;
          tmdbCache[cacheKey] = id;
          sendResponse({ imdbId: id });
        })
        .catch(() => { tmdbCache[cacheKey] = null; sendResponse({ imdbId: null }); });
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
          const headers = {
            'Content-Type': 'application/json',
            'X-Client-ID': animeSkipClientId,
          };
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
                showId: msg.animeSkipShowId || '',
                epNum: msg.episode, season: msg.season,
                at: msg.startSec, dur: msg.endSec - msg.startSec,
                typeId: typeMap[msg.segType] || '1',
              },
            }),
          });
          results.push({ provider: 'animeskip', ok: r.ok, status: r.status });
        } catch (e) { results.push({ provider: 'animeskip', ok: false, err: String(e) }); }
      }

      const anyOk = results.some(r => r.ok);
      sendResponse({ ok: anyOk, results });
    });
    return true;
  }

  if (msg.type === 'SUPABASE_UPSERT') {
    // Cache last-known state per tab for tab-close flush
    if (sender?.tab?.id && msg.body) {
      getConfig().then(async ({ supabaseAnonKey }) => {
        const userId = supabaseAnonKey ? await getDerivedUserId(supabaseAnonKey) : null;
        if (userId) {
          tabPlaybackState.set(sender.tab.id, { userId, body: msg.body });
        }
      });
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
        `&select=playback_time,duration&limit=1`;
      fetchWithRetry(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } })
        .then(r => r.json())
        .then(data => sendResponse({ data: data[0] || null }))
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  // SUPABASE_GET_ALL - used by popup to fetch all history rows for the user
  if (msg.type === 'SUPABASE_GET_ALL') {
    getConfig().then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      const url = `${supabaseUrl}/rest/v1/playback_states` +
        `?user_id=eq.${encodeURIComponent(msg.userId)}` +
        `&select=media_id,playback_time,duration,site,site_name,video_title,updated_at` +
        `&order=updated_at.desc&limit=200`;
      fetchWithRetry(url, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } })
        .then(r => r.json())
        .then(data => sendResponse({ data: Array.isArray(data) ? data : [] }))
        .catch(err => sendResponse({ data: null, err: String(err) }));
    });
    return true;
  }

  return false;
});