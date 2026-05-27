/* SkipStream — background */
/* Compatible with Firefox MV2 and Chrome MV3 service workers */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

// MV3 Chrome service worker: re-register listener on each wake-up
// (service workers can be terminated between messages)
const IS_SW = typeof ServiceWorkerGlobalScope !== 'undefined' &&
              self instanceof ServiceWorkerGlobalScope;

const tmdbCache = {};
let cachedUserId = null;

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const r = await br.storage.local.get([
      'supabaseUrl','supabaseAnonKey','tmdbApiKey','introdbApiKey','omdbApiKey',
      'animeSkipEnabled','subDLApiKey',
    ]);
    return {
      supabaseUrl:      r.supabaseUrl      || null,
      supabaseAnonKey:  r.supabaseAnonKey  || null,
      tmdbApiKey:       r.tmdbApiKey       || null,
      introdbApiKey:    r.introdbApiKey    || null,
      omdbApiKey:       r.omdbApiKey       || null,
      animeSkipEnabled: r.animeSkipEnabled ?? true,
      subDLApiKey:      r.subDLApiKey      || null,
    };
  } catch {
    return { supabaseUrl:null, supabaseAnonKey:null, tmdbApiKey:null,
             introdbApiKey:null, omdbApiKey:null, animeSkipEnabled:true, subDLApiKey:null };
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
      if (res.status === 401 || res.status === 403 || res.status === 404) return res;
      if (res.ok) return res;
      lastErr = new Error(`Status ${res.status}`);
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
  }
  throw lastErr;
}

// ── Segment providers ─────────────────────────────────────────────────────────
// Provider interface: async fn(imdbId, season, episode, config) → segments|null
// segments shape: { intro?:{start_sec,end_sec}, recap?:{...}, outro?:{...} }

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

async function providerAnimeSkip(imdbId, season, episode, { animeSkipEnabled }) {
  if (!animeSkipEnabled) return null;
  // AnimeSkip uses AniDB/MAL IDs — we attempt a lookup by IMDB id via their search endpoint
  try {
    const searchRes = await fetchWithRetry(
      `https://api.animeskip.online/shows?imdb_id=${imdbId}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!searchRes.ok) return null;
    const shows = await searchRes.json();
    const show = Array.isArray(shows) ? shows[0] : shows;
    if (!show?.id) return null;

    const epRes = await fetchWithRetry(
      `https://api.animeskip.online/episodes/${show.id}/${season}/${episode}`
    );
    if (!epRes.ok) return null;
    const ep = await epRes.json();
    if (!ep?.timestamps) return null;

    // Normalise AnimeSkip timestamps → SkipStream segment shape
    const segments = {};
    for (const ts of ep.timestamps) {
      const type = (ts.type?.name || '').toLowerCase();
      if (type.includes('intro') || type === 'op')  segments.intro  = { start_sec: ts.at, end_sec: ts.at + (ts.duration || 90) };
      if (type.includes('recap'))                    segments.recap  = { start_sec: ts.at, end_sec: ts.at + (ts.duration || 60) };
      if (type.includes('outro') || type === 'ed')   segments.outro  = { start_sec: ts.at, end_sec: ts.at + (ts.duration || 90) };
    }
    return Object.keys(segments).length ? segments : null;
  } catch { return null; }
}

async function providerSubDL(imdbId, season, episode, { subDLApiKey }) {
  // SubDL provides subtitle/chapter data; we use chapter markers as segment hints
  if (!subDLApiKey) return null;
  try {
    const r = await fetchWithRetry(
      `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&season=${season}&episode=${episode}&type=episode`,
      { headers: { 'Api-Key': subDLApiKey } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    // SubDL chapters: look for intro/recap/credits markers in chapter data
    const chapters = data?.chapters || data?.subtitles?.[0]?.chapters || [];
    if (!chapters.length) return null;
    const segments = {};
    for (const ch of chapters) {
      const label = (ch.label || ch.title || '').toLowerCase();
      if (label.includes('intro') || label.includes('opening')) {
        segments.intro = { start_sec: ch.start_time, end_sec: ch.end_time };
      }
      if (label.includes('recap')) {
        segments.recap = { start_sec: ch.start_time, end_sec: ch.end_time };
      }
      if (label.includes('outro') || label.includes('credits') || label.includes('ending')) {
        segments.outro = { start_sec: ch.start_time, end_sec: ch.end_time };
      }
    }
    return Object.keys(segments).length ? segments : null;
  } catch { return null; }
}

// Fetch from all providers, merge results (IntroDB wins on conflict)
async function fetchSegmentsMulti(imdbId, season, episode) {
  const config = await getConfig();
  const [introdb, animeskip, subdl] = await Promise.all([
    providerIntroDB(imdbId, season, episode, config),
    providerAnimeSkip(imdbId, season, episode, config),
    providerSubDL(imdbId, season, episode, config),
  ]);

  if (!introdb && !animeskip && !subdl) return null;

  // Merge: IntroDB > AnimeSkip > SubDL
  const merged = {};
  for (const src of [subdl, animeskip, introdb]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      merged[k] = v;
    }
  }
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
      message: 'Table missing — run supabase_setup.sql in your Supabase SQL Editor once.',
    };
    if (res.status === 401 || res.status === 403) return {
      ok: false, message: 'Invalid credentials — check your URL and anon key.',
    };
    return { ok: false, message: `Unexpected status ${res.status}` };
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
      const userId = await getDerivedUserId(supabaseAnonKey);
      sendResponse({ userId });
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

  if (msg.type === 'OMDB_LOOKUP') {
    if (!msg.title) { sendResponse({ imdbId: null }); return true; }
    getConfig().then(({ omdbApiKey }) => {
      const key = omdbApiKey || 'trilogy';
      fetchWithRetry(`https://www.omdbapi.com/?t=${encodeURIComponent(msg.title)}&type=series&apikey=${key}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const id = (data?.Response === 'True' && data?.imdbID) ? data.imdbID : null;
          sendResponse({ imdbId: id });
        })
        .catch(() => sendResponse({ imdbId: null }));
    });
    return true;
  }

  // Multi-provider segment fetch (IntroDB + AnimeSkip + SubDL)
  if (msg.type === 'FETCH_SEGMENTS') {
    fetchSegmentsMulti(msg.imdbId, msg.season, msg.episode)
      .then(data => {
        if (!data) {
          sendResponse({ data: null, err: 'no_data' });
          return;
        }
        sendResponse({ data });
      })
      .catch(e => sendResponse({ data: null, err: String(e) }));
    return true;
  }

  // IntroDB segment reporting — fires when user toggles addSegment and a video has no data
  if (msg.type === 'REPORT_SEGMENT') {
    getConfig().then(async ({ introdbApiKey }) => {
      if (!introdbApiKey) { sendResponse({ ok: false, err: 'not_configured' }); return; }
      try {
        const r = await fetchWithRetry(
          'https://api.introdb.app/segments/report',
          {
            method: 'POST',
            headers: {
              'x-api-key': introdbApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imdb_id:  msg.imdbId,
              season:   msg.season,
              episode:  msg.episode,
              site:     msg.site,
              reported_at: new Date().toISOString(),
            }),
          }
        );
        sendResponse({ ok: r.ok, status: r.status });
      } catch (e) {
        sendResponse({ ok: false, err: String(e) });
      }
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
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(msg.body),
        }
      )
        .then(r => r.ok
          ? sendResponse({ ok: true })
          : r.text().then(err => sendResponse({ ok: false, err })))
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
