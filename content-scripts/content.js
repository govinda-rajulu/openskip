/* SkipStream — content script */
(function () {
  'use strict';

  const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── User prefs ─────────────────────────────────────────────────────────────

  const PREF_DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, skipMaster: true };
  let prefs = { ...PREF_DEFAULTS };

  async function loadPrefs() {
    try {
      const stored = await br.storage.local.get(Object.keys(PREF_DEFAULTS));
      for (const key of Object.keys(PREF_DEFAULTS)) {
        if (key in stored) prefs[key] = stored[key];
      }
    } catch { /* use defaults */ }
  }

  // ── Media ID ───────────────────────────────────────────────────────────────

  function getMediaId() {
    const url = location.href;
    const ytMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `yt/${ytMatch[1]}`;
    const vmMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vmMatch) return `vm/${vmMatch[1]}`;
    const paramKeys = ['season', 's', 'episode', 'ep', 'e', 'id', 'tmdb', 'imdb', 'series', 'show'];
    const sp = new URLSearchParams(location.search);
    const parts = [];
    for (const k of paramKeys) { const v = sp.get(k); if (v) parts.push(`${k}=${v}`); }
    const base = location.hostname + location.pathname;
    return parts.length ? `${base}?${parts.join('&')}` : base;
  }

  // ── Deterministic user ID (derived in background, never localStorage) ──────

  let _userIdCache = null;
  let _userIdFetched = false;

  async function getUserId() {
    if (_userIdFetched) return _userIdCache;
    try {
      const res = await br.runtime.sendMessage({ type: 'GET_USER_ID' });
      _userIdCache = res?.userId || null;
    } catch {
      _userIdCache = null;
    }
    _userIdFetched = true;
    return _userIdCache;
  }

  // ── Local playback cache (browser.storage.local) ───────────────────────────

  const CACHE_KEY = 'skipstream_cache';

  async function cacheWrite(mediaId, position, duration) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      const cache = stored[CACHE_KEY] || {};
      cache[mediaId] = {
        p: Math.round(position * 10) / 10,
        d: duration,
        t: Date.now(),
        url: location.href,
        title: document.title.slice(0, 120),
        site: location.hostname,
      };
      const keys = Object.keys(cache);
      if (keys.length > 100) {
        keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - 100).forEach(k => delete cache[k]);
      }
      await br.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* storage unavailable */ }
  }

  async function cacheRead(mediaId) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      return (stored[CACHE_KEY] || {})[mediaId] || null;
    } catch { return null; }
  }

  // ── Playback save / restore ────────────────────────────────────────────────

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
            user_id: userId,
            media_id: mediaId,
            playback_time: Math.floor(pos),
            duration: dur,
            site: location.hostname,
            updated_at: new Date().toISOString(),
          },
        });
        if (!res.ok && res.err !== 'not_configured') {
          console.warn('[SkipStream] Cloud save failed:', res.err);
        }
      } catch { /* background not ready */ }
    }, 3000);
  }

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

    // Cancel and clean up if user presses play manually (they chose to start fresh)
    const onPlay = () => {
      clearTimeout(autoTimer);
      if (prompt.isConnected) prompt.remove();
    };
    video.addEventListener('play', onPlay, { once: true });

    // Auto-confirm resume after 12s if user hasn't interacted
    const autoTimer = setTimeout(() => {
      video.removeEventListener('play', onPlay);
      if (prompt.isConnected) {
        try { if (video.isConnected && video.currentTime < 3) video.currentTime = position; } catch { /* ok */ }
        prompt.remove();
      }
    }, 12000);
  }

  async function restorePlayback(video) {
    if (!prefs.resumePlayback) return;
    const mediaId = getMediaId();
    const userId = await getUserId();
    let saved = null;

    if (userId) {
      try {
        const res = await br.runtime.sendMessage({ type: 'SUPABASE_GET', userId, mediaId });
        if (res.data) saved = { p: res.data.playback_time, d: res.data.duration };
      } catch { /* fall through to local cache */ }
    }

    if (!saved) saved = await cacheRead(mediaId);
    if (!saved || saved.p < 10 || (saved.d && saved.p / saved.d > 0.95)) return;

    const doPrompt = () => {
      // Don't show if user already started playing or video has been seeked
      if (video.currentTime > 3 || (video.played && video.played.length > 0)) return;
      // Don't show if prompt already visible for this video
      if (document.getElementById('skipstream-resume-prompt')) return;
      try { showResumePrompt(video, saved.p); } catch { /* ok */ }
    };

    if (video.readyState >= 1) {
      doPrompt();
    } else {
      video.addEventListener('loadedmetadata', doPrompt, { once: true });
    }
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
      if (!info.season) info.season = seFromUrl.season;
      if (!info.episode) info.episode = seFromUrl.episode;
    }
    const sp = new URLSearchParams(location.search);
    if (!info.season) { const s = sp.get('season') || sp.get('s'); if (s && /^\d+$/.test(s)) info.season = parseInt(s, 10); }
    if (!info.episode) { const e = sp.get('episode') || sp.get('ep') || sp.get('e'); if (e && /^\d+$/.test(e)) info.episode = parseInt(e, 10); }
  }

  function parsePageInfo(info) {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const data = JSON.parse(el.textContent || '');
        const json = JSON.stringify(data);
        if (!info.imdbId) { const m = json.match(/\b(tt\d{7,8})\b/); if (m) info.imdbId = m[1]; }
        const obj = Array.isArray(data) ? data[0] : data;
        if (!info.season && obj?.partOfSeason?.seasonNumber) info.season = parseInt(obj.partOfSeason.seasonNumber, 10);
        if (!info.episode && obj?.episodeNumber) info.episode = parseInt(obj.episodeNumber, 10);
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
          if (!info.season) info.season = parseInt(swapped ? m[2] : m[1], 10);
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
      if (!info.season) info.season = parseInt(combo[2], 10);
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
        if (season === null) season = parseInt(numMatch[1], 10);
        else if (episode === null) episode = parseInt(numMatch[1], 10);
      }
    }
    if (!info.season && season) info.season = season;
    if (!info.episode && episode) info.episode = episode;
    return titleFromSlug(slug);
  }

  // ── iframe parent URL resolution ──────────────────────────────────────────
  // (logic inlined into resolveShowInfo below)

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

    // Parse current window URL + page DOM
    parseUrlInfo(info);
    parsePageInfo(info);

    // iframe fix: if running inside an embedded player iframe (e.g. vidup.to inside 1shows.org),
    // also try extracting IMDb ID and S×E from document.referrer (the parent site URL)
    if (window !== window.top && document.referrer) {
      const ref = document.referrer;
      if (!info.imdbId) {
        const m = ref.match(/\b(tt\d{7,8})\b/);
        if (m) info.imdbId = m[1];
      }
      if (!info.season || !info.episode) {
        const se = extractSeEpisode(ref);
        if (se) {
          if (!info.season)  info.season  = se.season;
          if (!info.episode) info.episode = se.episode;
        }
      }
    }

    // TMDB → IMDb
    if (!info.imdbId && info.tmdbId) info.imdbId = await tmdbToImdb(info.tmdbId);

    // Slug-based path title extraction (sets season/episode as side-effect)
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
        console.warn('[SkipStream] IntroDB API key not set — skipping disabled. Add your key in Settings.');
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
      if (seg && currentTime >= seg.start_sec - 2 && currentTime < seg.end_sec) {
        return { key, segment: seg };
      }
    }
    return null;
  }

  const PREF_FOR_SEGMENT = { intro: 'skipIntro', recap: 'skipRecap', outro: 'skipOutro' };
  const SEGMENT_LABELS   = { intro: '⏭ Skip Intro', recap: '⏭ Skip Recap', outro: '⏭ Skip Outro' };

  // ── Skip button ────────────────────────────────────────────────────────────

  const SKIP_BTN_ID = 'skipstream-skip-btn';
  const MSG_SHOW    = 'SKIPSTREAM_SHOW_BTN';
  const MSG_HIDE    = 'SKIPSTREAM_HIDE_BTN';
  const MSG_DO      = 'SKIPSTREAM_DO_SKIP';

  let btnAutoHideTimer = null;
  let pendingSkipFn    = null;
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
    // Attach to fullscreen element if active, else document body
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;

    // Position relative to viewport; ensure visible in fullscreen
    const isFs = !!fsEl;
    Object.assign(btn.style, {
      all: 'unset',
      position: isFs ? 'absolute' : 'fixed',
      bottom: '10%',
      right: '3%',
      zIndex: '2147483647',
      display: 'inline-flex',
      alignItems: 'center',
      padding: '11px 24px',
      background: 'rgba(10,10,18,0.88)',
      color: '#fff',
      border: '1.5px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '700',
      fontFamily: 'system-ui,-apple-system,sans-serif',
      letterSpacing: '0.03em',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      transition: 'background 0.15s,transform 0.1s',
      userSelect: 'none',
      pointerEvents: 'auto',
      WebkitFontSmoothing: 'antialiased',
    });
    btn.onmouseover = () => { btn.style.background = 'rgba(37,99,235,0.95)'; btn.style.transform = 'scale(1.04)'; };
    btn.onmouseout  = () => { btn.style.background = 'rgba(10,10,18,0.88)'; btn.style.transform = 'scale(1)'; };
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); onSkip(); removeSkipBtn(); };
    container.appendChild(btn);

    // Re-anchor if user enters/exits fullscreen while button is visible
    const onFsChange = () => {
      if (document.getElementById(SKIP_BTN_ID)) {
        const newFs = document.fullscreenElement || document.webkitFullscreenElement;
        btn.style.position = newFs ? 'absolute' : 'fixed';
        (newFs || document.body || document.documentElement).appendChild(btn);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange, { once: true });
    document.addEventListener('webkitfullscreenchange', onFsChange, { once: true });

    // Auto-hide: reset timer on mousemove near button
    let _moved = false;
    const _onMove = () => { _moved = true; clearTimeout(btnAutoHideTimer); btnAutoHideTimer = setTimeout(removeSkipBtn, 8000); };
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

  // Minimum size: 25% viewport width AND 16:9-compatible height (avoids carousels/thumbnails)
  function isMainPlayer(video) {
    const vw = window.innerWidth  || 800;
    const vh = window.innerHeight || 600;
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return null; // not laid out yet — defer
    if (rect.width  < vw * 0.25) return false;
    if (rect.height < vh * 0.20) return false;
    // Aspect ratio guard: main players are roughly 4:3 to 21:9
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
      // Layout not established yet — defer to loadedmetadata
      video.addEventListener('loadedmetadata', () => attachVideo(video), { once: true });
      return;
    }
    if (!ready) return;

    attachedVideos.add(video);
    await restorePlayback(video);

    const saveTimer = { id: null };
    let saveInterval = null;

    video.addEventListener('play', () => {
      clearInterval(saveInterval);
      saveInterval = setInterval(() => {
        if (!video.isConnected) { clearInterval(saveInterval); saveInterval = null; return; }
        savePlayback(video, saveTimer);
      }, 10000);
    });
    video.addEventListener('pause',  () => { clearInterval(saveInterval); saveInterval = null; savePlayback(video, saveTimer); });
    video.addEventListener('seeked', () => savePlayback(video, saveTimer));
    window.addEventListener('pagehide',     () => savePlayback(video, saveTimer));
    window.addEventListener('beforeunload', () => savePlayback(video, saveTimer));

    // ── Segment resolution ──
    let segments = null;
    let resolved = false;
    let activeSegmentKey = '';

    async function resolveSegments() {
      if (resolved) return;
      const info = await resolveShowInfo();
      if (!info.imdbId || !info.season || !info.episode) {
        console.warn('[SkipStream] Could not identify episode — skip segments unavailable.');
        return;
      }
      resolved = true;
      segments = await fetchSegments(info.imdbId, info.season, info.episode);
      if (!segments) {
        console.warn('[SkipStream] No segment data for', info.imdbId, `S${info.season}E${info.episode}`);
      }
    }

    video.addEventListener('loadedmetadata', resolveSegments);
    if (video.readyState >= 1) resolveSegments();
    [2000, 5000, 10000, 20000].forEach(ms => setTimeout(() => { if (!resolved) resolveSegments(); }, ms));

    // ── Skip polling ──
    const pollInterval = setInterval(() => {
      if (!video.isConnected) { clearInterval(pollInterval); return; }
      if (video.paused || !segments) return;

      const active = findActiveSegment(segments, video.currentTime);

      if (active) {
        const prefKey = PREF_FOR_SEGMENT[active.key];
        // Master off → do nothing (no auto-skip, no button)
        if (!prefs.skipMaster) {
          if (activeSegmentKey) { activeSegmentKey = ''; hideSkipBtn(); }
          return;
        }
        if (active.key !== activeSegmentKey) {
          activeSegmentKey = active.key;
          if (prefs[prefKey]) {
            // Child toggle ON → auto-skip silently
            video.currentTime = active.segment.end_sec;
            activeSegmentKey = '';
            hideSkipBtn();
          } else {
            // Child toggle OFF → show skip button prompt
            showSkipBtn(SEGMENT_LABELS[active.key], () => {
              video.currentTime = active.segment.end_sec;
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
  new MutationObserver(debouncedScan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(scanVideos, 1000));

  // SPA navigation: intercept pushState/replaceState + popstate (no polling)
  let lastHref = location.href;

  function onNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    hideSkipBtn();
    _userIdFetched = false;
    _userIdCache = null;
    segmentCache.clear();
    loadPrefs();
    setTimeout(scanVideos, 1500);
    setTimeout(scanVideos, 4000);
  }

  window.addEventListener('popstate', onNavigation);

  // Intercept history.pushState and history.replaceState for SPA frameworks
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      original.apply(this, args);
      onNavigation();
    };
  }

  // ── Popup message handlers ─────────────────────────────────────────────────

  br.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_VIDEO_TIME') {
      // Return currentTime of the first playing (or any attached) video
      let time = null;
      for (const v of document.querySelectorAll('video')) {
        if (!v.paused || v.currentTime > 0) { time = v.currentTime; break; }
      }
      sendResponse({ time });
      return true;
    }
    if (msg.type === 'GET_SHOW_INFO') {
      resolveShowInfo().then(info => {
        sendResponse({ imdbId: info.imdbId, season: info.season, episode: info.episode, site: location.hostname });
      });
      return true;
    }
    return false;
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  loadPrefs().then(scanVideos);

})();
