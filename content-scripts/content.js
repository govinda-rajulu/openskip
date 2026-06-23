/* SkipStream - content script */
(function () {
  'use strict';

  // ── Injection guard (Chrome MV3 can double-inject on some navigations) ──────
  if (window.__skipstream_injected__) return;
  window.__skipstream_injected__ = true;

  const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
    };
  }

  // ── User prefs ─────────────────────────────────────────────────────────────

  const PREF_DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, skipEnabled: true, autoNextEpisode: false };
  let prefs = { ...PREF_DEFAULTS };

  async function loadPrefs() {
    try {
      const stored = await br.storage.local.get(Object.keys(PREF_DEFAULTS));
      for (const key of Object.keys(PREF_DEFAULTS)) {
        if (key in stored) prefs[key] = stored[key];
      }
    } catch { /* use defaults */ }
  }

  // Keep prefs live: re-apply any change made in popup/options without needing page reload
  br.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (key in changes) prefs[key] = changes[key].newValue;
    }
  });

  // ── Per-site prefs override ──────────────────────────────────────────────────
  // Reads skipstream_site_rules from storage and merges into prefs for current host.
  const _sitePrefsCache = { host: null, rules: null, ts: 0 };

  function getSitePrefs(basePrefs) {
    const host = location.hostname.replace(/^www\./, '');
    const now  = Date.now();
    // Refresh cache every 5s so option changes apply quickly
    if (_sitePrefsCache.host !== host || now - _sitePrefsCache.ts > 5000) {
      _sitePrefsCache.host = host;
      _sitePrefsCache.ts   = now;
      br.storage.local.get('skipstream_site_rules').then(s => {
        _sitePrefsCache.rules = s.skipstream_site_rules || {};
      }).catch(() => {});
    }
    const rules = _sitePrefsCache.rules;
    if (!rules) return basePrefs;
    // Match host or any parent domain
    let mode = null;
    for (const [domain, m] of Object.entries(rules)) {
      if (host === domain || host.endsWith('.' + domain)) { mode = m; break; }
    }
    if (!mode) return basePrefs;
    // Map mode string to pref flags
    const override = { skipEnabled: true, skipIntro: false, skipRecap: false, skipOutro: false };
    if (mode === 'off')        return { ...basePrefs, skipEnabled: false };
    if (mode === 'auto-intro') return { ...basePrefs, ...override, skipIntro: true };
    if (mode === 'auto-recap') return { ...basePrefs, ...override, skipRecap: true };
    if (mode === 'auto-outro') return { ...basePrefs, ...override, skipOutro: true };
    if (mode === 'auto-all')   return { ...basePrefs, ...override, skipIntro: true, skipRecap: true, skipOutro: true };
    if (mode === 'prompt')     return { ...basePrefs, ...override }; // master on, all auto off
    return basePrefs;
  }

  // ── Media ID ───────────────────────────────────────────────────────────────

  function getMediaId() {
    const url = location.href;
    const ytMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `yt/${ytMatch[1]}`;
    const vmMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vmMatch) return `vm/${vmMatch[1]}`;
    const movieMatch = location.pathname.match(/\/movie\/(\d+)/);
    if (movieMatch) return `movie/${movieMatch[1]}`;
    const tvMatch = location.pathname.match(/\/(?:tv|episode)\/(\d+)/);
    if (tvMatch) return `tv/${tvMatch[1]}`;
    const paramKeys = ['season', 's', 'episode', 'ep', 'e', 'id', 'tmdb', 'imdb', 'series', 'show'];
    const sp = new URLSearchParams(location.search);
    const parts = [];
    for (const k of paramKeys) { const v = sp.get(k); if (v) parts.push(`${k}=${v}`); }
    const base = location.hostname + location.pathname;
    return parts.length ? `${base}?${parts.join('&')}` : base;
  }

  // ── Human-readable site name ───────────────────────────────────────────────

  // When running inside an embedded player iframe, resolve site identity
  // from document.referrer (the parent page) not from the player hostname.
  function _siteHost() {
    if (window !== window.top && document.referrer) {
      try { return new URL(document.referrer).hostname.replace(/^www\./, ''); } catch { /* fall through */ }
    }
    return location.hostname.replace(/^www\./, '');
  }

  function getSiteHostname() {
    if (window !== window.top && document.referrer) {
      try { return new URL(document.referrer).hostname; } catch { /* fall through */ }
    }
    return location.hostname;
  }

  function getSiteName() {
    const h = _siteHost();
    const KNOWN = {
      'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
      'vimeo.com': 'Vimeo',
      'netflix.com': 'Netflix',
      'primevideo.com': 'Prime Video', 'amazon.com': 'Prime Video',
      'disneyplus.com': 'Disney+',
      'hulu.com': 'Hulu',
      'max.com': 'Max', 'hbomax.com': 'Max',
      'crunchyroll.com': 'Crunchyroll',
      'app.plex.tv': 'Plex',
      'jellyfin.org': 'Jellyfin',
      'emby.media': 'Emby',
      'peacocktv.com': 'Peacock',
      'paramountplus.com': 'Paramount+',
      'appletv.apple.com': 'Apple TV+',
      'tubi.tv': 'Tubi',
      '1shows.org': '1Shows',
      'fmovies.to': 'FMovies',
      'soap2day.ac': 'Soap2Day',
      'goojara.to': 'Goojara',
      'spotify.com': 'Spotify', 'open.spotify.com': 'Spotify',
      'soundcloud.com': 'SoundCloud',
    };
    for (const [key, name] of Object.entries(KNOWN)) {
      if (h === key || h.endsWith('.' + key)) return name;
    }
    return h.split('.')[0].replace(/^\w/, c => c.toUpperCase());
  }

  // ── Video title ────────────────────────────────────────────────────────────

  function getVideoTitle() {
    // Try OG title first, then document.title, strip site suffix
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const raw = og || document.title || '';
    // Strip common " - SiteName" / " | SiteName" suffixes (require 2+ char site name)
    return raw.replace(/\s+[-|]\s+\S.{2,}$/, '').trim().slice(0, 120) || raw.slice(0, 120);
  }

  // ── Deterministic user ID (derived in background) ──────────────────────────

  let _userIdCache   = null;
  let _userIdFetched = false;

  async function getUserId() {
    if (_userIdFetched) return _userIdCache;
    try {
      const res = await br.runtime.sendMessage({ type: 'GET_USER_ID' });
      _userIdCache = res?.userId || null;
    } catch { _userIdCache = null; }
    _userIdFetched = true;
    return _userIdCache;
  }

  // ── Pending-resume cache (for history click → new tab flow) ───────────────
  // Key: mediaId, Value: { position, ts }
  // Written by popup via INJECT_RESUME message; consumed once on video attach.

  const PENDING_KEY = 'skipstream_pending_resume';

  async function checkPendingResume(mediaId) {
    try {
      const stored = await br.storage.local.get(PENDING_KEY);
      const pending = stored[PENDING_KEY];
      if (!pending || pending.mediaId !== mediaId) return null;
      // Expire after 30s - enough time for a new tab to fully load
      if (Date.now() - pending.ts > 30000) {
        await br.storage.local.remove(PENDING_KEY);
        return null;
      }
      await br.storage.local.remove(PENDING_KEY);
      return pending.position;
    } catch { return null; }
  }

  // ── Local playback cache (browser.storage.local) ───────────────────────────

  const CACHE_KEY = 'skipstream_cache';

  async function cacheWrite(mediaId, position, duration) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      const cache  = stored[CACHE_KEY] || {};
      cache[mediaId] = {
        p:    Math.round(position * 10) / 10,
        d:    duration,
        t:    Date.now(),
        url:  location.href,
        title:     getVideoTitle(),
        site:      getSiteHostname(),
        site_name: getSiteName(),
      };
      const keys = Object.keys(cache);
      if (keys.length > 100) {
        keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - 100).forEach(k => delete cache[k]);
      }
      await br.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* storage unavailable */ }
  }

  // Cloud->local sync: accepts explicit meta when DOM title not yet available
  async function cacheWriteWithMeta(mediaId, position, duration, meta = {}) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      const cache  = stored[CACHE_KEY] || {};
      cache[mediaId] = {
        p:         Math.round(position * 10) / 10,
        d:         duration,
        t:         Date.now(),
        url:       location.href,
        title:     meta.title     || getVideoTitle() || '',
        site:      meta.site      || getSiteHostname(),
        site_name: meta.site_name || getSiteName(),
      };
      await br.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* storage unavailable */ }
  }

  async function cacheRead(mediaId) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      return (stored[CACHE_KEY] || {})[mediaId] || null;
    } catch { return null; }
  }

  // ── Playback save ──────────────────────────────────────────────────────────

  // Writes local cache immediately; queues cloud upsert 3s later.
  async function savePlayback(video, saveTimer) {
    if (!video.duration || video.currentTime < 5) return;
    const mediaId = getMediaId();
    const pos = Math.round(video.currentTime * 10) / 10;
    const dur = Math.round(video.duration);
    await cacheWrite(mediaId, pos, dur);

    clearTimeout(saveTimer.id);
    saveTimer.id = setTimeout(async () => {
      const userId = await getUserId();
      if (!userId) return;
      try {
        const res = await br.runtime.sendMessage({
          type: 'SUPABASE_UPSERT',
          body: {
            user_id:     userId,
            media_id:    mediaId,
            playback_time: Math.floor(pos),
            duration:    dur,
            site:        getSiteHostname(),
            site_name:   getSiteName(),
            video_title: getVideoTitle(),
            page_url:    location.href,
            device_name: navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
            updated_at:  new Date().toISOString(),
          },
        });
        if (res.ok) {
          br.storage.local.set({ skipstream_last_sync: Date.now() }).catch(() => {});
        } else if (res.err !== 'not_configured') {
          console.warn('[SkipStream] Cloud save failed:', res.err);
        }
      } catch { /* background not ready */ }
    }, 3000);
  }

  // Immediate synchronous-as-possible flush (beforeunload - no async guarantee)
  function flushPlaybackSync(video) {
    if (!video.isConnected || !video.duration || video.currentTime < 5) return;
    const mediaId = getMediaId();
    const pos  = Math.round(video.currentTime * 10) / 10;
    const dur  = Math.round(video.duration);
    // Write local cache synchronously via a fire-and-forget
    cacheWrite(mediaId, pos, dur);
    // Best-effort cloud message (background may still be alive)
    getUserId().then(userId => {
      if (!userId) return;
      br.runtime.sendMessage({
        type: 'SUPABASE_UPSERT',
        keepalive: true,   // survives page death on mobile
        body: {
          user_id:     userId,
          media_id:    mediaId,
          playback_time: Math.floor(pos),
          duration:    dur,
          site:        getSiteHostname(),
          site_name:   getSiteName(),
          video_title: getVideoTitle(),
          page_url:    location.href,
          device_name: navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
          updated_at:  new Date().toISOString(),
        },
      }).catch(() => { /* page is unloading */ });
    });
  }

  // ── Resume helpers ─────────────────────────────────────────────────────────

  function fmtTime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
  }

  function showResumePrompt(video, position) {
    const existing = document.getElementById('skipstream-resume-prompt');
    if (existing) existing.remove();

    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;

    const prompt = document.createElement('div');
    prompt.id = 'skipstream-resume-prompt';
    Object.assign(prompt.style, {
      all: 'unset', position: fsEl ? 'absolute' : 'fixed',
      top: '12%', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '10px',
      background: 'rgba(10,10,18,0.92)', color: '#fff',
      border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: '12px',
      padding: '14px 20px', boxShadow: '0 4px 32px rgba(0,0,0,0.7)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      fontFamily: 'system-ui,-apple-system,sans-serif', textAlign: 'center',
      pointerEvents: 'auto',
    });

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;font-weight:600;line-height:1.4';
    msg.textContent = `Resume from ${fmtTime(position)}?`;

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px';

    const makeBtn = (label, primary, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        all: 'unset', cursor: 'pointer', padding: '7px 16px',
        borderRadius: '8px', fontSize: '12px', fontWeight: '700',
        fontFamily: 'inherit',
        background: primary ? 'rgba(37,99,235,0.95)' : 'rgba(255,255,255,0.12)',
        color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
        transition: 'background .15s',
      });
      b.onmouseover = () => { b.style.background = primary ? '#1d4ed8' : 'rgba(255,255,255,0.2)'; };
      b.onmouseout  = () => { b.style.background = primary ? 'rgba(37,99,235,0.95)' : 'rgba(255,255,255,0.12)'; };
      b.onclick = e => { e.preventDefault(); e.stopPropagation(); onClick(); prompt.remove(); };
      return b;
    };

    btns.appendChild(makeBtn(`▶ Continue from ${fmtTime(position)}`, true, () => {
      try { if (video.isConnected) video.currentTime = position; } catch { /* ok */ }
    }));
    btns.appendChild(makeBtn('↩ Start over', false, () => {
      try { if (video.isConnected) video.currentTime = 0; } catch { /* ok */ }
    }));

    prompt.appendChild(msg);
    prompt.appendChild(btns);
    container.appendChild(prompt);

    const onPlay = () => { clearTimeout(autoTimer); if (prompt.isConnected) prompt.remove(); };
    video.addEventListener('play', onPlay, { once: true });

    const autoTimer = setTimeout(() => {
      video.removeEventListener('play', onPlay);
      if (prompt.isConnected) {
        try {
        if (video.isConnected && video.currentTime < 3) {
          video.currentTime = position;
          video.play().catch(() => { /* autoplay policy - ok */ });
        }
      } catch { /* ok */ }
        prompt.remove();
      }
    }, 12000);
  }

  async function restorePlayback(video) {
    if (!prefs.resumePlayback) return;
    const mediaId = getMediaId();

    // Check if this tab was opened via history click (pending resume)
    const pendingPos = await checkPendingResume(mediaId);
    if (pendingPos && pendingPos >= 10) {
      const doSeek = () => {
        if (video.currentTime > 3 || (video.played && video.played.length > 0)) return;
        try {
          video.currentTime = pendingPos;
          video.play().catch(() => { /* autoplay policy - user will press play */ });
        } catch { /* ok */ }
      };
      if (video.readyState >= 1) doSeek();
      else video.addEventListener('loadedmetadata', doSeek, { once: true });
      return;
    }

    const userId = await getUserId();
    let saved = null;

    if (userId) {
      try {
        const res = await br.runtime.sendMessage({ type: 'SUPABASE_GET', userId, mediaId });
        if (res.data) {
          const cloudSaved = { p: res.data.playback_time, d: res.data.duration };
          // Don't blindly trust cloud - if local has unsynced progress further along
          // (e.g. offline session, crash before the 3s upsert fired), keep it.
          const existingLocal = await cacheRead(mediaId);
          const cloudIsNewer = !existingLocal || cloudSaved.p >= (existingLocal.p || 0) - 5;
          if (cloudIsNewer) {
            saved = cloudSaved;
            // Write cloud data back to local cache - use cloud title/site if DOM not ready yet
            await cacheWriteWithMeta(mediaId, saved.p, saved.d, {
              title:     res.data.video_title || getVideoTitle(),
              site:      res.data.site        || getSiteHostname(),
              site_name: res.data.site_name   || getSiteName(),
            });
          } else {
            saved = existingLocal;
          }
        }
      } catch { /* fall through */ }
    }
    if (!saved) saved = await cacheRead(mediaId);
    if (!saved || saved.p < 10 || (saved.d && saved.p / saved.d > 0.95)) return;

    const doPrompt = () => {
      if (video.currentTime > 3 || (video.played && video.played.length > 0)) return;
      if (document.getElementById('skipstream-resume-prompt')) return;
      try { showResumePrompt(video, saved.p); } catch { /* ok */ }
    };

    if (video.readyState >= 1) doPrompt();
    else video.addEventListener('loadedmetadata', doPrompt, { once: true });
  }

  // ── Show / episode detection ───────────────────────────────────────────────

  const SE_REGEX = /\bS(\d{1,2})\s*[:·•\-\s]\s*E(\d{1,3})\b/i;

  const URL_SE_PATTERNS = [
    /\/season[s]?[\/-_](\d+)[\/-_]episode[s]?[\/-_](\d+)/i,
    /season[_-](\d+)[_-]episode[_-](\d+)/i,
    /[-\/_.s]s(\d{1,2})[-_.]?e(\d{1,3})[-\/_.?#]/i,
    SE_REGEX,
    /\bs(\d{1,2})e(\d{1,3})\b/i,
    /\/(\d+)x(\d{1,3})(?:[\/\-?#]|$)/i,
    /[?&]season=(\d+).*?[?&](?:ep(?:isode)?|e)=(\d+)/i,
    /[?&]s=(\d+).*?[?&]e=(\d+)/i,
  ];

  function extractSeEpisode(text) {
    for (const re of URL_SE_PATTERNS) {
      const m = text.match(re);
      if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
    }
    return null;
  }

  function parseUrlInfo(info) {
    const href = location.href;
    const pathname = location.pathname;
    const imdbMatch = href.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch) info.imdbId = imdbMatch[1];
    if (!info.tmdbId) {
      const tmdbMatch = pathname.match(/\/(?:tv|show|shows|series|movie|film|watch)\/(\d+)/);
      if (tmdbMatch) info.tmdbId = parseInt(tmdbMatch[1], 10);
    }
    const seFromUrl = extractSeEpisode(href);
    if (seFromUrl) {
      if (!info.season)  info.season  = seFromUrl.season;
      if (!info.episode) info.episode = seFromUrl.episode;
    }
    const sp = new URLSearchParams(location.search);
    if (!info.season)  { const s = sp.get('season') || sp.get('s'); if (s && /^\d+$/.test(s)) info.season  = parseInt(s, 10); }
    if (!info.episode) { const e = sp.get('episode') || sp.get('ep') || sp.get('e'); if (e && /^\d+$/.test(e)) info.episode = parseInt(e, 10); }
  }

  function parsePageInfo(info) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const data = JSON.parse(el.textContent || '');
        const json = JSON.stringify(data);
        if (!info.imdbId) { const m = json.match(/\b(tt\d{7,8})\b/); if (m) info.imdbId = m[1]; }
        const obj = Array.isArray(data) ? data[0] : data;
        if (!info.season  && obj?.partOfSeason?.seasonNumber) info.season  = parseInt(obj.partOfSeason.seasonNumber, 10);
        if (!info.episode && obj?.episodeNumber)               info.episode = parseInt(obj.episodeNumber, 10);
      } catch { /* malformed JSON-LD */ }
    });
    if (!info.imdbId) {
      document.querySelectorAll('meta[content]').forEach(el => {
        const m = (el.getAttribute('content') || '').match(/\b(tt\d{7,8})\b/);
        if (m && !info.imdbId) info.imdbId = m[1];
      });
    }
    document.querySelectorAll('[data-imdb],[data-imdb-id],[data-tmdb],[data-tmdb-id],[data-season],[data-episode],[data-ep],[data-season-number],[data-episode-number]').forEach(el => {
      if (!info.imdbId) {
        for (const attr of ['data-imdb', 'data-imdb-id', 'data-imdbid']) {
          const v = el.getAttribute(attr);
          if (v && /tt\d{7,8}/.test(v)) { info.imdbId = v.match(/tt\d{7,8}/)[0]; break; }
        }
      }
      if (!info.tmdbId) {
        for (const attr of ['data-tmdb', 'data-tmdb-id', 'data-tmdbid']) {
          const v = el.getAttribute(attr)?.trim();
          if (v && /^\d+$/.test(v)) { info.tmdbId = parseInt(v, 10); break; }
        }
      }
      if (!info.season) {
        for (const attr of ['data-season', 'data-season-number']) {
          const v = el.getAttribute(attr)?.trim();
          if (v && /^\d+$/.test(v)) { info.season = parseInt(v, 10); break; }
        }
      }
      if (!info.episode) {
        for (const attr of ['data-episode', 'data-episode-number', 'data-ep']) {
          const v = el.getAttribute(attr)?.trim();
          if (v && /^\d+$/.test(v)) { info.episode = parseInt(v, 10); break; }
        }
      }
    });
    if (!info.season || !info.episode) {
      const text = document.title + ' ' + (document.body?.innerText?.slice(0, 4000) || '');
      const textPatterns = [
        [/Season\s+(\d+)[,\s·•\-]+Episode\s+(\d+)/i, false],
        [SE_REGEX, false],
        [/\bS(\d{1,2})E(\d{1,3})\b/i, false],
        [/\bSeason\s+(\d+)\b.*?\bEpisode\s+(\d+)\b/i, false],
        [/\bEp(?:isode)?\s*(\d+)\s+Season\s+(\d+)/i, true],
      ];
      for (const [re, swapped] of textPatterns) {
        const m = text.match(re);
        if (m) {
          if (!info.season)  info.season  = parseInt(swapped ? m[2] : m[1], 10);
          if (!info.episode) info.episode = parseInt(swapped ? m[1] : m[2], 10);
          break;
        }
      }
    }
  }

  function titleFromSlug(slug) {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }

  function parsePathTitle(info) {
    const segments = location.pathname.toLowerCase().split('/').filter(Boolean);
    const idx = segments.findIndex(s => ['tv', 'series', 'show', 'watch', 'stream', 'episode', 'anime'].includes(s));
    if (idx === -1 || !segments[idx + 1]) return null;
    const slug = segments[idx + 1];
    const combo = slug.match(/^(.+?)-s(\d+)e(\d+)$/i);
    if (combo) {
      if (!info.season)  info.season  = parseInt(combo[2], 10);
      if (!info.episode) info.episode = parseInt(combo[3], 10);
      return titleFromSlug(combo[1]);
    }
    let season = null, episode = null;
    for (let i = idx + 2; i < segments.length; i++) {
      const seg = segments[i];
      const sMatch = seg.match(/^(?:season-?|s)(\d+)$/i);
      if (sMatch) { season = parseInt(sMatch[1], 10); continue; }
      const eMatch = seg.match(/^(?:episode-?|e)(\d+)$/i);
      if (eMatch) { episode = parseInt(eMatch[1], 10); continue; }
      const numMatch = seg.match(/^(\d+)$/);
      if (numMatch) {
        if (season  === null) season  = parseInt(numMatch[1], 10);
        else if (episode === null) episode = parseInt(numMatch[1], 10);
      }
    }
    if (!info.season  && season)  info.season  = season;
    if (!info.episode && episode) info.episode = episode;
    return titleFromSlug(slug);
  }

  const imdbCache = new Map();

  async function tmdbToImdb(tmdbId) {
    const key = `tv:${tmdbId}`;
    if (imdbCache.has(key)) return imdbCache.get(key);
    try {
      const res = await br.runtime.sendMessage({ type: 'TMDB_TO_IMDB', tmdbId });
      imdbCache.set(key, res.imdbId);
      return res.imdbId;
    } catch { imdbCache.set(key, null); return null; }
  }

  async function resolveShowInfo() {
    const info = { imdbId: null, tmdbId: null, season: null, episode: null };
    parseUrlInfo(info);
    parsePageInfo(info);

    // iframe fix: also check document.referrer
    if (window !== window.top && document.referrer) {
      const ref = document.referrer;
      if (!info.imdbId) { const m = ref.match(/\b(tt\d{7,8})\b/); if (m) info.imdbId = m[1]; }
      if (!info.season || !info.episode) {
        const se = extractSeEpisode(ref);
        if (se) {
          if (!info.season)  info.season  = se.season;
          if (!info.episode) info.episode = se.episode;
        }
      }
    }

    if (!info.imdbId && info.tmdbId) info.imdbId = await tmdbToImdb(info.tmdbId);
    if (!info.imdbId) parsePathTitle(info);
    return info;
  }

  // ── Segments API ───────────────────────────────────────────────────────────

  const segmentCache = new Map();

  async function fetchSegments(imdbId, season, episode) {
    const key = `${imdbId}:${season}:${episode}`;
    if (segmentCache.has(key)) return segmentCache.get(key);
    try {
      const res = await br.runtime.sendMessage({ type: 'FETCH_SEGMENTS', imdbId, season, episode });
      if (res.err === 'not_configured') {
        console.warn('[SkipStream] IntroDB API key not set - skipping disabled. Add your key in Settings.');
        segmentCache.set(key, null);
        return null;
      }
      const data = res.data || null;
      segmentCache.set(key, data);
      return data;
    } catch { return null; }
  }

  function findActiveSegment(segments, currentTime) {
    for (const key of ['intro', 'recap', 'outro']) {
      const seg = segments[key];
      // -2s grace before start; +1s grace after end to catch near-end seeks
      if (seg && currentTime >= seg.start_sec - 2 && currentTime < seg.end_sec + 1) {
        return { key, segment: seg };
      }
    }
    return null;
  }

  const PREF_FOR_SEGMENT = { intro: 'skipIntro', recap: 'skipRecap', outro: 'skipOutro' };
  const SEGMENT_LABELS   = { intro: '⏭ Skip Intro', recap: '⏭ Skip Recap', outro: '⏭ Skip Outro' };

  function segmentLabel(key, segment) {
    const base  = SEGMENT_LABELS[key] || `⏭ Skip ${key}`;
    const count = segment && (segment.report_count ?? segment.votes ?? segment.confidence ?? null);
    if (!count || count < 2) return base;
    const badge = count >= 10 ? ' ★' : count >= 5 ? ' ◆' : '';
    return base + badge;
  }

  // ── Skip countdown toast ──────────────────────────────────────────────────

  const COUNTDOWN_ID = 'skipstream-countdown';
  let _countdownTimer = null;

  function recordSkipStat(timeSavedSec) {
    br.storage.local.get('skipstream_stats').then(s => {
      const st = s.skipstream_stats || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0, skipsToday: 0, statsDate: '' };
      const today = new Date().toDateString();
      if (st.statsDate !== today) { st.statsDate = today; st.skipsToday = 0; }
      st.skipsTotal++;
      st.skipsToday = (st.skipsToday || 0) + 1;
      st.timeSavedSec += Math.max(0, Math.round(timeSavedSec));
      br.storage.local.set({ skipstream_stats: st });
    }).catch(() => {});
  }

  function showSkipCountdown(segKey, segment, video, onDone) {
    // Clear any existing countdown
    clearInterval(_countdownTimer);
    const existing = document.getElementById(COUNTDOWN_ID);
    if (existing) existing.remove();

    const label = { intro: 'Intro', recap: 'Recap', outro: 'Outro' }[segKey] || segKey;
    const fullLabel = segmentLabel(segKey, segment);
    let secs = 3;

    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;

    const toast = document.createElement('div');
    toast.id = COUNTDOWN_ID;
    Object.assign(toast.style, {
      all: 'unset', position: fsEl ? 'absolute' : 'fixed',
      bottom: '10%', right: '3%', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 16px',
      background: 'rgba(10,10,18,0.88)',
      color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)',
      borderRadius: '10px', boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      fontFamily: 'system-ui,-apple-system,sans-serif',
      fontSize: '13px', fontWeight: '600',
      pointerEvents: 'auto',
    });

    const msgEl = document.createElement('span');
    const undoBtn = document.createElement('button');
    Object.assign(undoBtn.style, {
      all: 'unset', cursor: 'pointer', padding: '4px 10px',
      background: 'rgba(255,255,255,0.12)', borderRadius: '6px',
      fontSize: '11px', fontWeight: '700', color: '#fff',
      border: '1px solid rgba(255,255,255,0.2)',
    });
    undoBtn.textContent = 'Undo';

    const doSkip = () => {
      clearInterval(_countdownTimer);
      if (toast.isConnected) toast.remove();
      const prevTime = video.currentTime;
      video.currentTime = segment.end_sec;
      video._ssCooldownUntil = Date.now() + 1500;
      recordSkipStat(segment.end_sec - prevTime);
      onDone();
    };

    undoBtn.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      clearInterval(_countdownTimer);
      toast.remove();
      onDone();
    };

    const update = () => {
      msgEl.textContent = `${fullLabel} in ${secs}s`;
    };
    update();
    toast.appendChild(msgEl);
    toast.appendChild(undoBtn);
    container.appendChild(toast);

    _countdownTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(_countdownTimer);
        doSkip();
      } else {
        update();
      }
    }, 1000);

    // If video pauses during countdown - cancel skip
    const onPause = () => {
      clearInterval(_countdownTimer);
      if (toast.isConnected) toast.remove();
      onDone();
    };
    video.addEventListener('pause', onPause, { once: true });
  }

  // ── "Still watching?" auto-dismiss ──────────────────────────────────────────
  // Clicks platform "Continue Watching" / "Are you still watching?" overlays.
  // Uses generic text matching - works on any site without platform-specific code.

  const STILL_WATCHING_RE = /continue watching|still watching|are you there|are you still/i;
  const STILL_WATCHING_BTN_RE = /continue|yes|i.?m here|keep watching|play|resume/i;

  function tryDismissStillWatching() {
    // Look for an overlay/dialog containing the phrase
    const allEls = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .overlay, [class*="overlay"], [class*="modal"], [class*="dialog"], [class*="inactivity"], [class*="inactive"], [class*="idle"]'
    );
    for (const el of allEls) {
      if (!STILL_WATCHING_RE.test(el.textContent)) continue;
      // Found the overlay - click the continue button
      const btns = el.querySelectorAll('button, [role="button"], a');
      for (const btn of btns) {
        if (STILL_WATCHING_BTN_RE.test(btn.textContent)) {
          btn.click();
          return true;
        }
      }
      // Fallback: click first button in the overlay
      const firstBtn = el.querySelector('button, [role="button"]');
      if (firstBtn) { firstBtn.click(); return true; }
    }
    return false;
  }

  // Poll every 3s - only when a video is playing
  // Stored so onNavigation can clear and restart it safely
  let _stillWatchingInterval = setInterval(() => {
    const vid = document.querySelector('video');
    if (vid && !vid.paused) tryDismissStillWatching();
  }, 3000);

  // ── Native platform button clicking ─────────────────────────────────────────
  // Clicks the platform's own "Skip Intro", "Skip Recap", "Next Episode" buttons.
  // Selector list based on public documentation and widely-used open-source extensions.
  // Works independently of IntroDB - no API key required.

  const SKIP_SELECTORS = [
    // Netflix
    'button[data-uia="player-skip-intro"]',
    'button[data-uia="player-skip-recap"]',
    'button[data-uia="player-skip-credits"]',
    '.skip-intro button',
    // Prime Video
    '.skipeIntro',
    '.atvwebplayersdk-skip-intro-button',
    '[class*="SkipButton"] button',
    // Disney+
    '[class*="SkipButton"]',
    // Hulu
    '.SkipButton',
    // Max / HBO Max
    '[class*="skip-intro"]',
    '[data-testid*="skip-intro"]',
    // Crunchyroll
    '.skip-button:not([disabled])',
    '[data-testid="skipButton"]',
    // Peacock
    '.progress-bar__skip-button',
    // Paramount+
    '[class*="skip-intro-button"]',
    // Apple TV+
    '[class*="skip-button"]',
    // Tubi
    'button.skip-intro-button',
    // Generic fallback - buttons labelled "Skip Intro" or "Skip Recap"
  ];

  const NEXT_EP_SELECTORS = [
    // Netflix
    'button[data-uia="next-episode-seamless-button"]',
    '.watch-video--next-episode-button',
    // Prime Video
    '.nextButton',
    '.atvwebplayersdk-nextupcard-accept',
    '[class*="nextEpisode"] button',
    // Disney+
    '[class*="NextEpisode"]',
    // Max
    '[data-testid="next-episode-button"]',
    // Hulu
    '.PlayerNextButton',
    // Crunchyroll
    '[class*="nextEpisode"]',
    '.player-bar__next-episode',
    // Peacock
    '[data-testid="next-episode"]',
    // Paramount+
    '.PlaybackControls--next',
    // Generic
    '[aria-label*="Next Episode" i]',
    '[title*="Next Episode" i]',
  ];

  let _nativeBtnInterval = null;
  let _nextEpTriggered   = false;

  function clickFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null && !el.disabled) {
          el.click();
          return true;
        }
      } catch { /* invalid selector - skip */ }
    }
    return false;
  }

  function startNativeBtnPoller(video) {
    if (_nativeBtnInterval) return;
    _nativeBtnInterval = setInterval(() => {
      if (!video.isConnected) {
        clearInterval(_nativeBtnInterval);
        _nativeBtnInterval = null;
        return;
      }
      if (video.paused) return;

      // Respect per-site overrides for native skip buttons
      const ep = getSitePrefs(prefs);
      if (ep.skipEnabled) {
        clickFirst(SKIP_SELECTORS);
      }

      // Next episode: fire when within 10s of end
      if (ep.skipEnabled && prefs.autoNextEpisode &&
          video.duration > 60 &&
          video.currentTime > 0 &&
          video.duration - video.currentTime < 10 &&
          !_nextEpTriggered) {
        if (clickFirst(NEXT_EP_SELECTORS)) {
          _nextEpTriggered = true;
          setTimeout(() => { _nextEpTriggered = false; }, 30000);
        }
      }
    }, 800);
  }



  // ── Skip button ────────────────────────────────────────────────────────────

  const SKIP_BTN_ID     = 'skipstream-skip-btn';
  const MSG_SHOW        = 'SKIPSTREAM_SHOW_BTN';
  const MSG_HIDE        = 'SKIPSTREAM_HIDE_BTN';
  const MSG_DO          = 'SKIPSTREAM_DO_SKIP';

  let btnAutoHideTimer  = null;
  let pendingSkipFn     = null;
  let topFrameListening = false;

  function removeSkipBtn() {
    clearTimeout(btnAutoHideTimer);
    btnAutoHideTimer = null;
    document.querySelectorAll(`#${SKIP_BTN_ID},[data-skipstream-btn]`).forEach(el => el.remove());
  }

  function createSkipBtn(label, onSkip) {
    removeSkipBtn();
    const btn = document.createElement('button');
    btn.id = SKIP_BTN_ID;
    btn.setAttribute('data-skipstream-btn', '1');
    btn.textContent = label;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;
    const isFs = !!fsEl;
    Object.assign(btn.style, {
      all: 'unset', position: isFs ? 'absolute' : 'fixed',
      bottom: '10%', right: '3%', zIndex: '2147483647',
      display: 'inline-flex', alignItems: 'center',
      padding: '11px 24px', background: 'rgba(10,10,18,0.88)',
      color: '#fff', border: '1.5px solid rgba(255,255,255,0.18)',
      borderRadius: '10px', cursor: 'pointer',
      fontSize: '14px', fontWeight: '700',
      fontFamily: 'system-ui,-apple-system,sans-serif',
      letterSpacing: '0.03em', boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      transition: 'background 0.15s,transform 0.1s',
      userSelect: 'none', pointerEvents: 'auto',
      WebkitFontSmoothing: 'antialiased',
    });
    btn.onmouseover = () => { btn.style.background = 'rgba(37,99,235,0.95)'; btn.style.transform = 'scale(1.04)'; };
    btn.onmouseout  = () => { btn.style.background = 'rgba(10,10,18,0.88)'; btn.style.transform = 'scale(1)'; };
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); onSkip(); removeSkipBtn(); };
    container.appendChild(btn);

    const onFsChange = () => {
      if (document.getElementById(SKIP_BTN_ID)) {
        const newFs = document.fullscreenElement || document.webkitFullscreenElement;
        btn.style.position = newFs ? 'absolute' : 'fixed';
        (newFs || document.body || document.documentElement).appendChild(btn);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange, { once: true });
    document.addEventListener('webkitfullscreenchange', onFsChange, { once: true });

    let _moved = false;
    const _onMove = () => {
      _moved = true;
      clearTimeout(btnAutoHideTimer);
      btnAutoHideTimer = setTimeout(removeSkipBtn, 8000);
    };
    document.addEventListener('mousemove', _onMove, { passive: true });
    btnAutoHideTimer = setTimeout(() => { document.removeEventListener('mousemove', _onMove); removeSkipBtn(); }, 8000);
  }

  function showSkipBtn(label, onSkip) {
    pendingSkipFn = onSkip;
    createSkipBtn(label, onSkip);
    if (window !== window.top) {
      try { window.top.postMessage({ type: MSG_SHOW, label }, '*'); } catch { /* cross-origin */ }
    }
  }

  function hideSkipBtn() {
    removeSkipBtn();
    if (window !== window.top) {
      try { window.top.postMessage({ type: MSG_HIDE }, '*'); } catch { /* cross-origin */ }
    }
  }

  if (!topFrameListening && window === window.top) {
    topFrameListening = true;
    window.addEventListener('message', e => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === MSG_SHOW) {
        createSkipBtn(e.data.label, () => { try { e.source?.postMessage({ type: MSG_DO }, '*'); } catch { /* ok */ } });
      }
      if (e.data.type === MSG_HIDE) removeSkipBtn();
    });
  }

  if (window !== window.top) {
    window.addEventListener('message', e => {
      if (e.data?.type === MSG_DO && pendingSkipFn) { pendingSkipFn(); pendingSkipFn = null; }
    });
  }

  // ── Video attachment ───────────────────────────────────────────────────────

  const attachedVideos = new WeakSet();

  function isMainPlayer(video) {
    const vw = window.innerWidth  || 800;
    const vh = window.innerHeight || 600;
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (rect.width  < vw * 0.25) return false;
    if (rect.height < vh * 0.20) return false;
    const ar = rect.width / rect.height;
    if (ar < 1.2 || ar > 3.0) return false;
    const cs = window.getComputedStyle(video);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  async function attachVideo(video) {
    if (attachedVideos.has(video)) return;

    const ready = isMainPlayer(video);
    if (ready === null) {
      video.addEventListener('loadedmetadata', () => attachVideo(video), { once: true });
      return;
    }
    if (!ready) return;

    attachedVideos.add(video);
    await restorePlayback(video);

    // Restore saved playback speed
    br.storage.local.get('playbackSpeed').then(s => {
      const r = s.playbackSpeed;
      if (r && r !== 1 && video.isConnected) video.playbackRate = parseFloat(r);
    }).catch(() => {});

    const saveTimer = { id: null };

    // Throttled timeupdate - fires at most once every 2.5s while playing
    const throttledSave = throttle(() => savePlayback(video, saveTimer), 2500);
    video.addEventListener('timeupdate', () => {
      if (!video.paused && video.currentTime > 5) throttledSave();
    });

    // Event-based saves for pause / seek / unload
    video.addEventListener('pause',  () => { savePlayback(video, saveTimer); });
    video.addEventListener('seeked', () => {
      savePlayback(video, saveTimer);
      // Reset so a seek INTO an active segment re-shows the skip button/countdown
      if (segments) {
        const nowActive = findActiveSegment(segments, video.currentTime);
        if (!nowActive || nowActive.key !== activeSegmentKey) {
          activeSegmentKey = '';
          if (!nowActive) hideSkipBtn();
        }
      }
    });

    // beforeunload: synchronous best-effort flush
    const flushHandler = () => flushPlaybackSync(video);
    window.addEventListener('pagehide',     flushHandler);
    window.addEventListener('beforeunload', flushHandler);

    // Track session count for stats
    br.storage.local.get('skipstream_stats').then(s => {
      const st = s.skipstream_stats || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0 };
      st.sessionsTotal++;
      br.storage.local.set({ skipstream_stats: st });
    }).catch(() => {});

    // ── Segment resolution ──
    let segments = null;
    let resolved = false;
    let activeSegmentKey = '';

    async function resolveSegments() {
      if (resolved) return;
      const info = await resolveShowInfo();
      if (!info.imdbId || !info.season || !info.episode) {
        if (!/\/movie\/\d+/.test(location.pathname)) {
          console.warn('[SkipStream] Could not identify episode - skip segments unavailable.');
        }
        return;
      }
      const fetched = await fetchSegments(info.imdbId, info.season, info.episode);
      if (fetched) {
        resolved = true;
        segments = fetched;
      } else {
        // resolved stays false so timed retries can still attempt if API was temporarily unavailable
        console.warn('[SkipStream] No segment data for', info.imdbId, `S${info.season}E${info.episode}`);
      }
    }

    video.addEventListener('loadedmetadata', resolveSegments);
    if (video.readyState >= 1) resolveSegments();
    [2000, 5000, 10000, 20000].forEach(ms => setTimeout(() => { if (!resolved) resolveSegments(); }, ms));

    // Start native platform button poller (skip intro buttons, next episode)
    startNativeBtnPoller(video);

    // ── Skip polling (tracked so navigation cleanup can clear it) ──
    let _videoPollInterval;
    _videoPollInterval = setInterval(() => {
      if (!video.isConnected) { clearInterval(_videoPollInterval); return; }
      if (video.paused || !segments) return;
      if (video._ssCooldownUntil && Date.now() < video._ssCooldownUntil) return;

      const active = findActiveSegment(segments, video.currentTime);

      if (active) {
        // Per-site override: check if this domain has a custom skip mode
        const effectivePrefs = getSitePrefs(prefs);
        const prefKey = PREF_FOR_SEGMENT[active.key];
        if (!effectivePrefs.skipEnabled) {
          if (activeSegmentKey) { activeSegmentKey = ''; hideSkipBtn(); }
          return;
        }
        if (active.key !== activeSegmentKey) {
          activeSegmentKey = active.key;
          if (effectivePrefs[prefKey]) {
            // pref ON = auto-skip with 3s countdown + undo
            showSkipCountdown(active.key, active.segment, video, () => {
              activeSegmentKey = '';
              hideSkipBtn();
            });
          } else {
            // pref OFF = show manual skip button so user can choose
            showSkipBtn(segmentLabel(active.key, active.segment), () => {
              const prevTime = video.currentTime;
              video.currentTime = active.segment.end_sec;
              video._ssCooldownUntil = Date.now() + 1500;
              recordSkipStat(active.segment.end_sec - prevTime);
              activeSegmentKey = '';
              hideSkipBtn();
            });
          }
        }
      } else if (!active && activeSegmentKey) {
        activeSegmentKey = '';
        hideSkipBtn();
      }
    }, 500);
  }

  // ── DOM scanning + SPA navigation ─────────────────────────────────────────

  function scanVideos() {
    document.querySelectorAll('video').forEach(v => attachVideo(v));
  }

  const debouncedScan = debounce(scanVideos, 400);
  const _domObserver = new MutationObserver(debouncedScan);
  _domObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(scanVideos, 1000));

  let lastHref = location.href;

  function onNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    hideSkipBtn();
    _userIdFetched    = false;
    _userIdCache      = null;
    _nextEpTriggered  = false;
    // Clear and restart still-watching poller (picks up new page's video elements)
    clearInterval(_stillWatchingInterval);
    _stillWatchingInterval = setInterval(() => {
      const vid = document.querySelector('video');
      if (vid && !vid.paused) tryDismissStillWatching();
    }, 3000);
    if (_nativeBtnInterval) { clearInterval(_nativeBtnInterval); _nativeBtnInterval = null; }
    segmentCache.clear();
    // Reconnect MO in case SPA swapped document.documentElement subtree
    _domObserver.disconnect();
    _domObserver.observe(document.documentElement, { childList: true, subtree: true });
    loadPrefs();
    setTimeout(scanVideos, 1500);
    setTimeout(scanVideos, 4000);
  }

  window.addEventListener('popstate', onNavigation);

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      original.apply(this, args);
      onNavigation();
    };
  }

  // ── Popup message handlers ─────────────────────────────────────────────────

  br.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SET_PLAYBACK_RATE') {
      document.querySelectorAll('video').forEach(v => {
        if (!v.paused || v.currentTime > 0) v.playbackRate = msg.rate;
      });
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'GET_VIDEO_TIME') {
      let time = null;
      for (const v of document.querySelectorAll('video')) {
        if (!v.paused || v.currentTime > 0) { time = v.currentTime; break; }
      }
      sendResponse({ time });
      return true;
    }
    if (msg.type === 'GET_SHOW_INFO') {
      resolveShowInfo().then(info => {
        sendResponse({ imdbId: info.imdbId, season: info.season, episode: info.episode, site: getSiteHostname() });
      });
      return true;
    }
    return false;
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Boot: load prefs + scan, then async bulk-pull cloud positions into local cache
  loadPrefs().then(scanVideos);

  // Cloud->local background sync: pull all cloud positions into skipstream_cache
  // Runs once per page load. Means resume works offline after first sync.
  (async () => {
    try {
      const userId = await getUserId();
      if (!userId) return;
      // Throttle: only sync every 5 min per tab
      const tsKey = '_ss_cloud_sync_ts';
      const stored = await br.storage.local.get(tsKey);
      if (stored[tsKey] && Date.now() - stored[tsKey] < 5 * 60 * 1000) return;
      await br.storage.local.set({ [tsKey]: Date.now() });

      const result = await br.runtime.sendMessage({ type: 'SUPABASE_GET_ALL', userId });
      if (!result?.data?.length) return;

      const cacheStored = await br.storage.local.get(CACHE_KEY);
      const cache = cacheStored[CACHE_KEY] || {};
      let updated = false;
      for (const row of result.data) {
        const mid = row.media_id;
        if (!mid) continue;
        const existing = cache[mid];
        const cloudTs = new Date(row.updated_at || 0).getTime() || 0;
        // Compare by recency (timestamp), not playback position - position alone
        // can't tell "user rewound on purpose" apart from "stale data".
        if (!existing || cloudTs > (existing.t || 0)) {
          cache[mid] = {
            p:         row.playback_time || 0,
            d:         row.duration      || 0,
            t:         cloudTs || Date.now(),
            url:       row.media_id,
            title:     row.video_title   || '',
            site:      row.site          || '',
            site_name: row.site_name     || '',
          };
          updated = true;
        }
      }
      if (updated) await br.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* best-effort, never block */ }
  })();

})();