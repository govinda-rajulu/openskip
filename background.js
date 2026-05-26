/* SkipStream — background */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const tmdbCache = {};
let cachedUserId = null;

// ── Config ────────────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const r = await br.storage.local.get([
      'supabaseUrl', 'supabaseAnonKey', 'tmdbApiKey', 'introdbApiKey', 'omdbApiKey'
    ]);
    return {
      supabaseUrl:    r.supabaseUrl     || null,
      supabaseAnonKey:r.supabaseAnonKey || null,
      tmdbApiKey:     r.tmdbApiKey      || null,
      introdbApiKey:  r.introdbApiKey   || null,
      omdbApiKey:     r.omdbApiKey      || null,
    };
  } catch {
    return { supabaseUrl: null, supabaseAnonKey: null, tmdbApiKey: null, introdbApiKey: null, omdbApiKey: null };
  }
}

// ── Deterministic user ID ─────────────────────────────────────────────────────

async function getDerivedUserId(anonKey) {
  if (cachedUserId) return cachedUserId;
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('skipstream:uid:' + anonKey));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    cachedUserId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    return cachedUserId;
  } catch {
    return null;
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      // Don't retry on definitive auth/not-found errors
      if (res.status === 401 || res.status === 403 || res.status === 404) return res;
      if (res.ok) return res;
      lastErr = new Error(`Status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
  }
  throw lastErr;
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
  } catch (e) {
    return { ok: false, message: `Network error: ${String(e)}` };
  }
}

async function checkTmdb(tmdbApiKey) {
  if (!tmdbApiKey) return { ok: false, message: 'Not configured' };
  try {
    const r = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${tmdbApiKey}`);
    if (r.ok) return { ok: true, message: 'Connected' };
    if (r.status === 401) return { ok: false, message: 'Invalid API key' };
    return { ok: false, message: `Status ${r.status}` };
  } catch (e) {
    return { ok: false, message: `Network error: ${String(e)}` };
  }
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
  } catch (e) {
    return { ok: false, message: `Network error: ${String(e)}` };
  }
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

  // User-supplied OMDB key; falls back to public demo key only if user hasn't set one
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

  if (msg.type === 'FETCH_SEGMENTS') {
    getConfig().then(async ({ introdbApiKey }) => {
      if (!introdbApiKey) { sendResponse({ data: null, err: 'not_configured' }); return; }
      try {
        const r = await fetchWithRetry(
          `https://api.introdb.app/segments?imdb_id=${msg.imdbId}&season=${msg.season}&episode=${msg.episode}`,
          { headers: { 'x-api-key': introdbApiKey } }
        );
        if (!r.ok) { sendResponse({ data: null, err: `Status ${r.status}` }); return; }
        sendResponse({ data: await r.json() });
      } catch (e) {
        sendResponse({ data: null, err: String(e) });
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
