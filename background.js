/* SkipStream — background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;

const tmdbCache = {};
let cachedUserId = null;

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const r = await br.storage.local.get([
      'supabaseUrl','supabaseAnonKey','tmdbApiKey','introdbApiKey','omdbApiKey',
      'animeSkipClientId','animeSkipAuthToken','animeSkipEnabled',
    ]);
    return {
      supabaseUrl:        r.supabaseUrl        || null,
      supabaseAnonKey:    r.supabaseAnonKey    || null,
      tmdbApiKey:         r.tmdbApiKey         || null,
      introdbApiKey:      r.introdbApiKey      || null,
      omdbApiKey:         r.omdbApiKey         || null,
      animeSkipClientId:  r.animeSkipClientId  || null,
      animeSkipAuthToken: r.animeSkipAuthToken || null,
      animeSkipEnabled:   r.animeSkipEnabled   ?? false,
    };
  } catch {
    return {
      supabaseUrl:null,supabaseAnonKey:null,tmdbApiKey:null,
      introdbApiKey:null,omdbApiKey:null,
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

// AnimeSkip: GraphQL API — requires X-Client-ID header (user supplies their own)
// Get a client ID at https://anime-skip.com/account/api-clients
async function providerAnimeSkip(imdbId, season, episode, { animeSkipEnabled, animeSkipClientId, animeSkipAuthToken }) {
  if (!animeSkipEnabled || !animeSkipClientId) return null;

  const headers = {
    'Content-Type': 'application/json',
    'X-Client-ID': animeSkipClientId,
  };
  if (animeSkipAuthToken) headers['Authorization'] = `Bearer ${animeSkipAuthToken}`;

  try {
    // Step 1: find show by IMDB ID via search
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

    // Step 2: fetch episode timestamps
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

    // Normalise to SkipStream segment shape
    const segments = {};
    for (const ts of ep.timestamps) {
      const type = (ts.type?.name || '').toLowerCase();
      const end = ts.at + (ts.duration || 90);
      if (type.includes('intro') || type === 'op')  segments.intro  = { start_sec: ts.at, end_sec: end };
      if (type.includes('recap'))                    segments.recap  = { start_sec: ts.at, end_sec: end };
      if (type.includes('outro') || type === 'ed')   segments.outro  = { start_sec: ts.at, end_sec: end };
    }
    return Object.keys(segments).length ? segments : null;
  } catch { return null; }
}

// Merge: IntroDB wins on conflict
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
      message: 'Table missing — run supabase_setup.sql once.',
    };
    if (res.status === 401 || res.status === 403) return {
      ok: false, message: 'Invalid credentials.',
    };
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

br.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  // OMDB: only used if user provides their own key — no demo fallback
  if (msg.type === 'OMDB_LOOKUP') {
    if (!msg.title) { sendResponse({ imdbId: null }); return true; }
    getConfig().then(({ omdbApiKey }) => {
      if (!omdbApiKey) { sendResponse({ imdbId: null }); return; }
      fetchWithRetry(`https://www.omdbapi.com/?t=${encodeURIComponent(msg.title)}&type=series&apikey=${omdbApiKey}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          sendResponse({ imdbId: (data?.Response === 'True' && data?.imdbID) ? data.imdbID : null });
        })
        .catch(() => sendResponse({ imdbId: null }));
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
    getConfig().then(async ({ introdbApiKey }) => {
      if (!introdbApiKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      try {
        const r = await fetchWithRetry('https://api.introdb.app/segments/report', {
          method: 'POST',
          headers: { 'x-api-key': introdbApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imdb_id: msg.imdbId, season: msg.season, episode: msg.episode,
            site: msg.site, reported_at: new Date().toISOString(),
          }),
        });
        sendResponse({ ok: r.ok, status: r.status });
      } catch (e) { sendResponse({ ok: false, err: String(e) }); }
    });
    return true;
  }

  if (msg.type === 'SUPABASE_UPSERT') {
    getConfig().then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      fetchWithRetry(
        `${supabaseUrl}/rest/v1/playback_states?on_conflict=user_id,media_id`,
        {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(msg.body),
        }
      )
        .then(r => r.ok ? sendResponse({ ok: true }) : r.text().then(err => sendResponse({ ok: false, err })))
        .catch(err => sendResponse({ ok: false, err: String(err) }));
    });
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

  return false;
});
