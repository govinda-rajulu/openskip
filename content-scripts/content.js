/* SkipStream - content script */
(function () {
  'use strict';

  // ── Injection guard (Chrome MV3 can double-inject on some navigations) ──────
  if (window.__skipstream_injected__) return;
  window.__skipstream_injected__ = true;

  const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  // ── "Check this page" answers first (1.13) ─────────────────────────────────
  // Registered before anything else can fail, so every frame answers, and says
  // whether start-up finished. Up to 1.13 this listener was the last line: a frame
  // whose start-up stopped early never answered (1Shows showed only the top page).
  let _ssBootDone = false;
  function _ssDiagReport() {
    const base = { frame: (location.hostname || location.protocol) + location.pathname, top: window === window.top, started: _ssBootDone };
    try {
      const light = Array.from(document.querySelectorAll('video'));
      const hidden = _shadowVideos(document, 0, [], 6);
      let blank = 0;
      document.querySelectorAll('iframe').forEach(f => {
        const s = f.getAttribute('src');
        if (!s || s === 'about:blank' || f.hasAttribute('srcdoc')) blank++;
      });
      const attached = light.concat(hidden).filter(v => attachedVideos.has(v)).length;
      return Object.assign(base, { videos: light.length, hidden: hidden.length, blankFrames: blank, attached,
        ident: _diag.id, segs: _diag.segs, subs: _diag.subs, last: _diagLast(_diag.last, Date.now()), auto: _diagAuto(_ssEffPrefs || prefs) });
    } catch (e) {
      let n = 0; try { n = document.querySelectorAll('video').length; } catch { /* ok */ }
      return Object.assign(base, { videos: n, error: String(e && e.message || e).slice(0, 100) });
    }
  }
  // Site report (probe.js runs in this same extension world) reads it directly.
  try { window.__skipstream_diag = _ssDiagReport; } catch { /* ok */ }
  br.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SS_DIAG_PING') return false;
    try { br.runtime.sendMessage({ type: 'SS_DIAG_REPORT', report: _ssDiagReport() }).catch(() => {}); } catch { /* never break the page */ }
    return false;
  });

  // ── SPA navigation tracking ────────────────────────────────────────────────────
  // Each attached video tracks its own href (see _vidHref in attachVideo), so a
  // URL change is seen by every video, not only the first one to poll.

  // ── Module state ───────────────────────────────────────────────────────────
  let _masterJustEnabled = false;
  const _promptedVideos = new WeakSet();
  let _lastNativeSkipTs = 0;

  // ── Overlay palette: same OKLCH engine as theme-engine.js ──────────────────
  // Overlays sit on top of arbitrary video, so they derive their own surface
  // lightness from the seed rather than assuming the page is dark.
  let _seedHex = '#57A860';
  let _pal = null;

  function _hexToOklch(hex) {
    hex = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = '57A860';
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lr = lin(r), lg = lin(g), lb = lin(b);
    const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s_ = 0.0883024619 * lr + 0.2220049874 * lg + 0.6896926158 * lb;
    const l = Math.cbrt(l_), m = Math.cbrt(m_), s = Math.cbrt(s_);
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const bv = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    let H = Math.atan2(bv, a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { C: Math.sqrt(a * a + bv * bv), H };
  }

  function _ok(L, C, H, A) {
    return 'oklch(' + L + ' ' + C + ' ' + H + (A === undefined ? '' : ' / ' + A) + ')';
  }

  function buildPalette(hex) {
    const s = _hexToOklch(hex);
    const h = s.H;
    const c = Math.min(s.C, 0.15);
    return {
      bg:         _ok(0.16, 0.024, h, 0.94),
      edge:       _ok(0.90, 0.02, h, 0.16),
      edgeStrong: _ok(0.90, 0.02, h, 0.32),
      text:       _ok(0.95, 0.012, h),
      muted:      _ok(0.72, 0.03, h),
      accent:     _ok(0.74, c, h),
      onAccent:   _ok(0.18, c, h),
    };
  }

  function pal() {
    if (!_pal) _pal = buildPalette(_seedHex);
    return _pal;
  }

  br.storage.local.get('skipstream_seed_color').then(d => {
    if (d.skipstream_seed_color) _seedHex = d.skipstream_seed_color;
    _pal = buildPalette(_seedHex);
  }).catch(() => { _pal = buildPalette(_seedHex); });

  br.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.skipstream_seed_color) return;
    _seedHex = changes.skipstream_seed_color.newValue || _seedHex;
    _pal = buildPalette(_seedHex);
  });

  // Shared overlay mount: fullscreen-aware container, consistent stacking.
  // ── On-video toasts: one placement for all of them ─────────────────────────
  // Above the player's own controls, inside the phone's safe area, never wider
  // than the screen, and without motion when the system asks for less motion.
  const TOAST_BOTTOM = 'max(64px, calc(env(safe-area-inset-bottom, 0px) + 56px))';
  const TOAST_RADIUS = '14px';
  function _reducedMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
  function _toastFit(el) {
    el.style.maxWidth = 'calc(100vw - 24px)';
    el.style.boxSizing = 'border-box';
    if (_reducedMotion()) el.style.transition = 'none';
    return el;
  }

  function mountOverlay(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;
    const el = document.createElement('div');
    el.id = id;
    el.style.position = fsEl ? 'absolute' : 'fixed';
    el.style.zIndex = '2147483647';
    return { el, container };
  }

  function dismissOverlay(el, ms) {
    if (!el || !el.isConnected) return;
    el.style.transition = 'opacity 220ms cubic-bezier(.7,0,.84,0), transform 220ms cubic-bezier(.7,0,.84,0)';
    el.style.opacity = '0';
    el.style.transform = 'translate3d(-50%, 6px, 0) scale(.98)';
    setTimeout(() => { if (el.isConnected) el.remove(); }, ms || 240);
  }

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

  function clampSE(info) {
    if (info.season && (info.season < 1 || info.season > 100)) info.season = null;
    if (info.episode && (info.episode < 1 || info.episode > 9999)) info.episode = null;
  }

  // ── User prefs ─────────────────────────────────────────────────────────────

  const PREF_DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, skipEnabled: true, autoNextEpisode: false, deviceName: '', sbModes: null, showTimeline: true, skipNotice: false, resumeNotice: false, ccButton: 'on' };
  let prefs = { ...PREF_DEFAULTS };
let _ssEffPrefs = null;
// What this frame found, for the popup's "Check this page" (local only, never sent anywhere).
const _diag = { id: '', segs: '', last: null, subs: '' };
let _diagChapters = null;   // the page's own chapter list, when that is the source

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
      if (key in changes) {
        prefs[key] = changes[key].newValue;
        if (key === 'skipEnabled' && changes[key].newValue === true) {
          _masterJustEnabled = true;
          setTimeout(() => { _masterJustEnabled = false; }, 3000);
        }
      }
    }
    if ('playbackSpeed' in changes) {
      const rate = parseFloat(changes.playbackSpeed.newValue) || 1;
      document.querySelectorAll('video').forEach(v => {
        if (v.isConnected) v.playbackRate = rate;
      });
    }
  });

  // ── Per-site prefs override ──────────────────────────────────────────────────
  // Reads skipstream_site_rules from storage and merges into prefs for current host.
  // Read once at init, then kept current by storage.onChanged (no polling in
  // every frame). Rule keys are normalised (lowercase, no www.) so a rule saved
  // as www.example.com still matches. Inside a player iframe the parent site's
  // rule is checked first, because users name the site they visit, not the
  // player host. Callers that must not race the first read await _sitePrefsReady.
  const _sitePrefsCache = { rules: {} };

  function _normSiteRules(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
      for (const [d, m] of Object.entries(raw)) {
        const k = String(d || '').trim().toLowerCase().replace(/^www\./, '');
        if (k && typeof m === 'string') out[k] = m;
      }
    }
    return out;
  }

  const _sitePrefsReady = br.storage.local.get('skipstream_site_rules')
    .then(s => { _sitePrefsCache.rules = _normSiteRules(s.skipstream_site_rules); })
    .catch(() => { /* keep {} so skipping still follows global prefs */ });

  br.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.skipstream_site_rules) {
      _sitePrefsCache.rules = _normSiteRules(changes.skipstream_site_rules.newValue);
    }
  });

  function _siteRuleFor(rules, host) {
    if (!host) return null;
    for (const [domain, m] of Object.entries(rules)) {
      if (host === domain || host.endsWith('.' + domain)) return m;
    }
    // Same site on a new address (1shows.cx -> 1shows.to): same name before the ending.
    const fam = _siteFamily(host);
    for (const [domain, m] of Object.entries(rules)) {
      if (fam && fam === _siteFamily(domain)) return m;
    }
    return null;
  }

  function getSitePrefs(basePrefs) {
    const rules = _sitePrefsCache.rules;
    const own   = location.hostname.toLowerCase().replace(/^www\./, '');
    const mode  = _siteRuleFor(rules, _siteHost().toLowerCase()) || _siteRuleFor(rules, own);
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

  // One site, one name (1.13): "www.", "m." and "mobile." hosts are the same site.
  // History showed m.youtube.com and youtube.com as two sites.
  function _canonHost(h) {
    let x = String(h || '').toLowerCase().trim();
    for (;;) {
      const y = x.replace(/^(?:www\d?|m|mobile|mbasic|touch)\./, '');
      if (y === x || !y.includes('.')) return x;
      x = y;
    }
  }

  // The site's name without www./m. and without its ending: 1shows.cx and
  // 1shows.to are both "1shows", news.bbc.co.uk is "bbc". Streaming sites move to
  // a new ending often; rules, History and resume use this to stay with the site.
  function _siteFamily(h) {
    const x = _canonHost(h);
    const parts = x.split('.').filter(Boolean);
    if (parts.length < 2) return x;
    const two = parts.length >= 3 && /^(?:co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
    return parts[parts.length - (two ? 3 : 2)];
  }

  function getMediaId() {
    const url = location.href;
    // YouTube ids only on YouTube hosts: any other site's ?v= is not a YouTube video.
    const ytId = _youtubeVideoId();
    if (ytId) return `yt/${ytId}`;
    const vmMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vmMatch) return `vm/${vmMatch[1]}`;
    const movieMatch = location.pathname.match(/\/movies?\/(\d+)/);
    if (movieMatch) return `movie/${movieMatch[1]}`;
    const tvMatch = location.pathname.match(/\/(?:tv|tvs|shows?|series|episode)\/(\d+)/);
    if (tvMatch) return `tv/${tvMatch[1]}`;
    const paramKeys = ['season', 's', 'episode', 'ep', 'e', 'id', 'tmdb', 'imdb', 'series', 'show'];
    const sp = new URLSearchParams(location.search);
    const parts = [];
    for (const k of paramKeys) { const v = sp.get(k); if (v) parts.push(`${k}=${v}`); }
    const base = _canonHost(location.hostname) + location.pathname;
    return parts.length ? `${base}?${parts.join('&')}` : base;
  }
  // The id this page had before 1.13 (raw host). Resume still finds positions
  // saved under it. null when it is the same as the new id.
  function _legacyMediaId(id) {
    const cur = id || getMediaId();
    const h = String(location.hostname || '').toLowerCase();
    const canon = _canonHost(h);
    if (h === canon || !cur.startsWith(canon + '/')) return null;
    return h + cur.slice(canon.length);
  }

  // ── Human-readable site name ───────────────────────────────────────────────

  // When running inside an embedded player iframe, resolve site identity
  // from document.referrer (the parent page) not from the player hostname.
  // Exact host or a real subdomain of it; never a substring match (CodeQL js/incomplete-url-substring-sanitization).
  function _hostIs(h, d) { return typeof h === 'string' && (h === d || h.endsWith('.' + d)); }

  // Embedded players: browsers send only the parent's origin as the referrer
  // (no path), so history saved "https://site/" and the page title was the
  // player's ("Player", ""). The background knows the tab's real address and
  // title; frames ask once at start and on every save.
  let _tabInfo = null;
  function _refreshTabInfo() {
    if (window === window.top) return Promise.resolve(null);
    return br.runtime.sendMessage({ type: 'GET_TAB_INFO' }).then(r => {
      if (r && typeof r.url === 'string' && /^https?:/i.test(r.url)) _tabInfo = { url: r.url, title: String(r.title || '') };
      return _tabInfo;
    }).catch(() => _tabInfo);
  }

  // Address of the page the user is watching (the top page, also for players).
  function _topHref() {
    if (window === window.top) return location.href;
    return (_tabInfo && _tabInfo.url) || document.referrer || location.href;
  }

  function _siteHost() {
    if (window !== window.top) {
      try { return new URL(_topHref()).hostname.replace(/^www\./, ''); } catch { /* fall through */ }
    }
    return location.hostname.replace(/^www\./, '');
  }

  function getSiteHostname() { return _canonHost(_siteHost()); }

  // YouTube video id from watch / embed / shorts / live URLs on YouTube hosts only.
  function _youtubeVideoId() {
    const h = location.hostname.toLowerCase();
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(h)) return null;
    const v = new URLSearchParams(location.search).get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = location.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // YouTube ads play in the same <video> element. While one shows, nothing is
  // saved, skipped, drawn or resumed: its time and length are not the video's.
  function _ytAdShowing() {
    if (!_youtubeVideoId()) return false;
    try {
      const pl = document.querySelector('#movie_player, .html5-video-player');
      if (pl && (pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting'))) return true;
      return !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-preview-container, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
    } catch { return false; }
  }

  // The progress bar to draw skip marks in: desktop and the mobile site
  // (m.youtube.com) use different elements; hover previews on the home page
  // have bars too and are never used. Same order as SponsorBlock.
  const PLAYER_BAR_SELECTORS = ['.vds-time-slider .vds-slider-track', 'media-time-slider', '[data-media-time-slider]', '.vjs-progress-holder',
    '.plyr__progress', '.jw-slider-time .jw-rail', '.shaka-seek-bar-container', '.dplayer-bar-wrap', '.art-control-progress-inner',
    '.mejs__time-total', '.mejs-time-total', '.fluid_controls_progress_container', '.bar-background'];
  const YT_BAR_SELECTORS = ['.ytChapteredProgressBarHost', '.ytProgressBarLineHost', '.YtProgressBarLineHost',
    '.YtChapteredProgressBarHost', '.YtmProgressBarProgressBarLine', '.ytp-progress-bar'];
  function _ytBar() {
    for (const sel of YT_BAR_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('#video-preview, ytd-video-preview, #inline-preview-player')) continue;
        return el;
      }
    }
    return null;
  }

  // An explicit start time in the address (?t=90, &start=, time_continue=) wins over resume.
  function _urlHasStartTime(href) {
    try {
      const u = new URL(href || location.href);
      for (const k of ['t', 'start', 'time_continue']) if (u.searchParams.has(k)) return true;
      return /(^|[#&])t=\d/.test(u.hash.slice(1));
    } catch { return false; }
  }

function _pageUrl() {
  return _topHref();
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
      'hotstar.com': 'JioHotstar', 'jiohotstar.com': 'JioHotstar', 'jiocinema.com': 'JioCinema',
      'sonyliv.com': 'SonyLIV', 'zee5.com': 'ZEE5', 'mxplayer.in': 'MX Player', 'aha.video': 'aha',
      'sunnxt.com': 'Sun NXT', 'pluto.tv': 'Pluto TV', 'twitch.tv': 'Twitch', 'dailymotion.com': 'Dailymotion',
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
    const host = _siteHost();

    // YouTube: og:title is set on initial server render and never updated during
    // SPA navigation - stale across song/video changes in the same tab.
    // Read from YouTube's own live DOM title element instead.
    if (_hostIs(host, 'youtube.com') || _hostIs(host, 'youtu.be')) {
      const ytEl = document.querySelector(
        'h1.title yt-formatted-string, ' +
        'ytd-watch-metadata h1 yt-formatted-string, ' +
        '#title h1 yt-formatted-string, ' +
        'ytmusic-player-bar .title'
      );
      const ytTitle = ytEl?.textContent?.trim();
      if (ytTitle) return ytTitle.slice(0, 120);
      // Fallback to document.title (updates correctly on YT SPA nav unlike og:title)
      return (document.title || '').replace(/\s+[-|]\s+YouTube.*$/i, '').trim().slice(0, 120);
    }

    // Embedded player: the top page's title, not the player's.
    if (window !== window.top && _tabInfo && _tabInfo.title) return _cleanTitle(_tabInfo.title, [getSiteName(), host]);
    // All other sites: og:title is reliable, prefer it
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    return _cleanTitle(og || document.title || '', [getSiteName(), host]);
  }

  // "Watch The Matrix (1999) Online Free HD | 1Shows" -> "The Matrix (1999)".
  // Only trailing parts that name the site or are streaming filler go; a title
  // such as "Spider-Man - Into the Spider-Verse" keeps its own dash.
  const _FILLER_RE = /^(?:watch(?:\s+\w+)?\s+online|online|free|hd|full\s*hd|streaming|stream|watch\s+free|full\s+movie|full\s+episodes?|movies?|tv\s+shows?|series)$/i;
  function _cleanTitle(raw, siteNames) {
    const src = String(raw || '').slice(0, 300).replace(/\s+/g, ' ').trim();
    if (!src) return '';
    const norm = x => String(x || '').toLowerCase().replace(/^www\./, '').replace(/\.[a-z]{2,}$/, '').replace(/[^a-z0-9]+/g, '');
    const sites = (siteNames || []).map(norm).filter(Boolean);
    const isSite = part => {
      const n = norm(part);
      if (!n) return true;
      if (_FILLER_RE.test(part.trim())) return true;
      return sites.some(x => n === x || (x.length >= 4 && n.includes(x) && n.length <= x.length + 12));
    };
    const parts = src.split(/\s+[|\u2013\u2014]\s+|\s+-\s+|\s+::\s+|\s+\u00b7\s+/);
    while (parts.length > 1 && isSite(parts[parts.length - 1])) parts.pop();
    while (parts.length > 1 && isSite(parts[0])) parts.shift();
    let t = parts.join(' - ');
    t = t.replace(/\[[^\]]{0,60}\]/g, ' ')
         .replace(/\s*\b(?:2160p|1080p|720p|480p|4k|hdrip|web-?dl|web-?rip|blu-?ray|brrip|x26[45]|hevc|(?:english|eng)[\s-]sub(?:bed|s|titled)?|subbed|dubbed|esubs?)\b/gi, ' ')
         .replace(/\s+/g, ' ').trim()
         .replace(/^\s*watch\s+/i, '')
         .replace(/\s+(?:online\s+)?(?:for\s+)?free(?:\s+(?:online|hd|on\s+\S+))*\s*$/i, '')
         .replace(/\s+(?:watch\s+)?online(?:\s+hd)?\s*$/i, '')
         .replace(/\s+(?:in\s+)?(?:full\s+)?hd(?:\s+quality)?\s*$/i, '')
         .replace(/\s+full\s+movie\s*$/i, '')
         .trim();
    return (t || src).slice(0, 120);
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
  const PENDING_MAX_MS = 120000;

  async function checkPendingResume(mediaId) {
    try {
      const stored = await br.storage.local.get(PENDING_KEY);
      const pending = stored[PENDING_KEY];
      if (!pending || (pending.mediaId !== mediaId && pending.mediaId !== _legacyMediaId(mediaId))) return null;
      // 120 s: a slow phone can take longer than 30 s to open the tab and start the player.
      if (Date.now() - pending.ts > PENDING_MAX_MS) {
        await br.storage.local.remove(PENDING_KEY);
        return null;
      }
      await br.storage.local.remove(PENDING_KEY);
      return pending.position;
    } catch { return null; }
  }

  // ── Local playback cache (browser.storage.local) ───────────────────────────

  const CACHE_KEY = 'skipstream_cache';
  const CACHE_MAX = 300;   // local history entries (1.12: 100)

  // H11: cache writes are read-modify-write of one object; two at once used to
  // lose one video's entry. Every write in this frame now waits for the last.
  let _cacheChain = Promise.resolve();
  function _serialCache(fn) {
    const run = _cacheChain.then(fn, fn);
    _cacheChain = run.catch(() => {});
    return run;
  }
  function cacheWrite(mediaId, position, duration) {
    return _serialCache(() => _cacheWriteNow(mediaId, position, duration));
  }
  function cacheWriteWithMeta(mediaId, position, duration, meta = {}) {
    return _serialCache(() => _cacheWriteWithMetaNow(mediaId, position, duration, meta));
  }

  async function _cacheWriteNow(mediaId, position, duration) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      const cache  = stored[CACHE_KEY] || {};
      cache[mediaId] = {
        p:    Math.round(position * 10) / 10,
        d:    duration,
        t:    Date.now(),
        url:  _pageUrl(),
        title:     getVideoTitle(),
        site:      getSiteHostname(),
        site_name: getSiteName(),
      };
      const keys = Object.keys(cache);
      if (keys.length > CACHE_MAX) {
        keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - CACHE_MAX).forEach(k => delete cache[k]);
      }
      await br.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* storage unavailable */ }
  }

  // Cloud->local sync: accepts explicit meta when DOM title not yet available
  async function _cacheWriteWithMetaNow(mediaId, position, duration, meta = {}) {
    try {
      const stored = await br.storage.local.get(CACHE_KEY);
      const cache  = stored[CACHE_KEY] || {};
      cache[mediaId] = {
        p:         Math.round(position * 10) / 10,
        d:         duration,
        t:         Date.now(),
        url:       _pageUrl(),
        title:     meta.title     || getVideoTitle() || '',
        site:      meta.site      || getSiteHostname(),
        site_name: meta.site_name || getSiteName(),
      };
      const keys = Object.keys(cache);
      if (keys.length > CACHE_MAX) {
        keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - CACHE_MAX).forEach(k => delete cache[k]);
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

  // ── Playback save ──────────────────────────────────────────────────────────

  // Local cache: every save. Cloud: at most every CLOUD_PUSH_MS while playing,
  // with the newest position (up to 1.12 every save restarted a 3 s timer, so a
  // video that kept playing never reached the cloud until it was paused).
  const CLOUD_PUSH_MS = 20000;
  let _resumeHoldUntil = 0;
  function _saveBlocked(video) {
    return !video.duration || video.currentTime < 5 || Date.now() < _resumeHoldUntil || _ytAdShowing();
  }
  async function savePlayback(video, saveTimer, now) {
    if (_saveBlocked(video)) return;
    const mediaId = getMediaId();
    if (window !== window.top) _refreshTabInfo();   // no await: H12 ordering below stays synchronous
    const pos = Math.round(video.currentTime * 10) / 10;
    const dur = Math.round(video.duration);
    // H12: the cloud state is set synchronously (newest call wins), then the local write.
    saveTimer.pending = { mediaId, pos, dur };
    const wait = now ? 0 : Math.max(1500, (saveTimer.last || 0) + CLOUD_PUSH_MS - Date.now());
    if (now || !saveTimer.id) {
      clearTimeout(saveTimer.id);
      saveTimer.id = setTimeout(() => { saveTimer.id = null; saveTimer.last = Date.now(); _pushPlayback(saveTimer); }, wait);
    }
    await cacheWrite(mediaId, pos, dur);
  }
  async function _pushPlayback(saveTimer) {
      const job = saveTimer.pending; saveTimer.pending = null;
      if (!job) return;
      const { mediaId, pos, dur } = job;
      if (getMediaId() !== mediaId) return;
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
            page_url:    _pageUrl(),
            device_name: prefs.deviceName || (navigator.userAgent.includes('Firefox') ? 'Firefox' : /Edg(A|iOS)?\//.test(navigator.userAgent) ? 'Edge' : 'Chrome'),
            updated_at:  new Date().toISOString(),
          },
        });
        if (res.ok) {
          br.storage.local.set({ skipstream_last_sync: Date.now() }).catch(() => {});
        } else if (res.err !== 'not_configured') {
          console.warn('[SkipStream] Cloud save failed:', res.err);
        }
      } catch { /* background not ready: the background's 5-minute sync sends it later */ }
  }

  // Immediate synchronous-as-possible flush (beforeunload - no async guarantee)
  function flushPlaybackSync(video) {
    if (!video.isConnected || _saveBlocked(video)) return;
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
          page_url:    _pageUrl(),
          device_name: prefs.deviceName || (navigator.userAgent.includes('Firefox') ? 'Firefox' : /Edg(A|iOS)?\//.test(navigator.userAgent) ? 'Edge' : 'Chrome'),
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

  function showResumeToast(video, position) {
    const p = pal();
    const { el: toast, container } = mountOverlay('skipstream-resume-toast');

    Object.assign(toast.style, {
      left: '50%',
      bottom: TOAST_BOTTOM,
      transform: 'translate3d(-50%, 10px, 0) scale(.97)',
      opacity: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '11px',
      maxWidth: 'calc(100% - 28px)',
      padding: '9px 11px 9px 12px',
      borderRadius: '12px',
      background: p.bg,
      border: '1px solid ' + p.edge,
      boxShadow: '0 6px 22px ' + _ok(0.08, 0.02, _hexToOklch(_seedHex).H, 0.55) + '',
      color: p.text,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      pointerEvents: 'auto',
      transition: 'opacity 340ms cubic-bezier(.22,1,.36,1), transform 340ms cubic-bezier(.22,1,.36,1)',
    });

    const mark = document.createElement('span');
    Object.assign(mark.style, {
      width: '22px', height: '22px', borderRadius: '7px', flex: '0 0 auto',
      display: 'grid', placeItems: 'center',
      background: p.accent, color: p.onAccent,
      fontSize: '11px', fontWeight: '700', lineHeight: '1',
    });
    mark.textContent = '\u25B6';

    const txt = document.createElement('span');
    Object.assign(txt.style, { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: '0' });

    const lbl = document.createElement('span');
    Object.assign(lbl.style, {
      fontSize: '9.5px', fontWeight: '600', letterSpacing: '.12em',
      textTransform: 'uppercase', color: p.muted,
    });
    lbl.textContent = 'Picked up where you left off';

    const val = document.createElement('span');
    Object.assign(val.style, {
      fontSize: '13.5px', fontWeight: '600', letterSpacing: '-.01em', whiteSpace: 'nowrap',
    });
    val.textContent = fmtTime(position);

    txt.appendChild(lbl);
    txt.appendChild(val);

    const restart = document.createElement('button');
    Object.assign(restart.style, {
      all: 'unset', boxSizing: 'border-box', flex: '0 0 auto',
      height: '30px', padding: '0 11px', borderRadius: '8px',
      border: '1px solid ' + p.edge, color: p.muted,
      font: '600 12px/1 inherit', cursor: 'pointer', textAlign: 'center',
      transition: 'color 140ms cubic-bezier(.22,1,.36,1), border-color 140ms cubic-bezier(.22,1,.36,1)',
    });
    restart.textContent = 'Start over';
    restart.onmouseover = () => { restart.style.color = p.text; restart.style.borderColor = p.edgeStrong; };
    restart.onmouseout = () => { restart.style.color = p.muted; restart.style.borderColor = p.edge; };
    restart.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(hideTimer);
      try { if (video.isConnected) video.currentTime = 0; } catch { /* ok */ }
      dismissOverlay(toast);
    };

    toast.appendChild(mark);
    toast.appendChild(txt);
    toast.appendChild(restart);
    container.appendChild(_toastFit(toast));

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translate3d(-50%, 0, 0) scale(1)';
    });

    const hideTimer = setTimeout(() => dismissOverlay(toast), 4200);
  }

  async function restorePlayback(video) {
    if (!prefs.resumePlayback) return;
    if (_masterJustEnabled) return;
    await _sitePrefsReady;
    if (!getSitePrefs(prefs).skipEnabled) return;
    if (_promptedVideos.has(video)) return;
    _promptedVideos.add(video);
    const mediaId = getMediaId();

    // Check if this tab was opened via history click (pending resume)
    const pendingPos = await checkPendingResume(mediaId);
    if (pendingPos && pendingPos >= 10) {
      _resumeSeek(video, pendingPos, mediaId, true, null);
      return;
    }
    // ?t=90 in the address: the user (or the site) chose the start time.
    if (_urlHasStartTime(location.href)) return;

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
          // H9: newer wins by time. Position is only the tie-break for old rows with no time.
          const cloudT = Date.parse(res.data.updated_at || '') || 0;
          const cloudIsNewer = !existingLocal
            || (cloudT && existingLocal.t ? cloudT >= existingLocal.t : cloudSaved.p >= (existingLocal.p || 0) - 5);
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
    const legacyId = saved ? null : _legacyMediaId(mediaId);
    if (legacyId) {
      // Saved before 1.13 under the raw host (www., m.): local first, then the cloud.
      saved = await cacheRead(legacyId);
      if (!saved && userId) {
        try {
          const r2 = await br.runtime.sendMessage({ type: 'SUPABASE_GET', userId, mediaId: legacyId });
          if (r2 && r2.data) saved = { p: r2.data.playback_time, d: r2.data.duration };
        } catch { /* ok */ }
      }
    }
    // Saved on the site's old address (1shows.cx, now 1shows.to): same name, same path.
    if (!saved) saved = await _cacheReadMoved(mediaId);
    if (!saved || saved.p < 10) return;
    if (saved.d && saved.p / saved.d > 0.95 && saved.d - saved.p < 60) return;

    // Silent resume: seek, then a brief toast once the position holds.
    // "Continued from" is off by default (Settings > Skipping), like the skip notice.
    _resumeSeek(video, saved.p, mediaId, false, () => { if (prefs.resumeNotice) showResumeToast(video, saved.p); });
  }

  // Seek to a saved position and make it stick. YouTube and other players reset
  // the time while they start, and ads play in the same element: wait for the
  // ad, seek, check twice, and seek again (up to 4 times) if the player snapped
  // back near the start. Saving is off until this settles (at most 15 s), so a
  // start-up time near 0 can never overwrite the saved position.
  function _resumeSeek(video, pos, mediaId, play, onOk) {
    const until = Date.now() + 15000;
    let tries = 0, ok = 0;
    _resumeHoldUntil = until;
    const finish = (good) => { if (_resumeHoldUntil === until) _resumeHoldUntil = 0; if (good && onOk) { try { onOk(); } catch { /* ok */ } } };
    const step = () => {
      if (getMediaId() !== mediaId || !video.isConnected || Date.now() > until) return finish(false);   // H10: page moved on
      if (_ytAdShowing() || video.readyState < 1) { setTimeout(step, 400); return; }
      const cur = Number(video.currentTime) || 0;
      if (Math.abs(cur - pos) <= 3) {
        if (++ok >= 2) return finish(true);
        setTimeout(step, 1500);
        return;
      }
      ok = 0;
      // Already somewhere else on its own (the site's own resume, or the user): leave it.
      if (cur > 8) return finish(false);
      if (tries >= 4) return finish(false);
      tries++;
      try {
        video.currentTime = pos;
        if (play && tries === 1) video.play().catch(() => { /* autoplay policy - user will press play */ });
      } catch { /* ok */ }
      setTimeout(step, 700);
    };
    step();
  }

  // ── Show / episode detection ───────────────────────────────────────────────

  const SE_REGEX = /\bS(\d{1,2})\s*[:·•\-\s]\s*E(\d{1,3})\b/i;
  // "S4 Episode 2", "S04 Ep 2", "Season 4 Ep. 2" (JioHotstar tab titles, 1.13 round 5).
  const SE_WORDS_RE = /\bS(?:eason)?\s*(\d{1,2})\s*[,:·•\-]?\s*E(?:p(?:isode)?)?\.?\s*(\d{1,3})\b/i;

  const URL_SE_PATTERNS = [
    /\/season[s]?[\/_-](\d+)[\/_-]episode[s]?[\/_-](\d+)/i,
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

  function parseUrlInfo(info, hrefIn) {
    let u;
    try { u = new URL(hrefIn || location.href); } catch { return; }
    const href = u.href;
    const pathname = u.pathname;
    const imdbMatch = href.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch && !info.imdbId) info.imdbId = imdbMatch[1];
    const sp = new URLSearchParams(u.search);
    // Embed players: "?video_id=1399&tmdb=1&s=1&e=2" (tmdb=1 is a flag, not an id),
    // "/movie/tmdb/603" and "/tv/tmdb/1399-1-2".
    const vid = sp.get('video_id');
    if (!info.tmdbId && vid && /^\d+$/.test(vid) && sp.get('tmdb') === '1') {
      info.tmdbId = parseInt(vid, 10);
      info.tmdbKind = sp.get('s') && sp.get('e') ? 'tv' : 'movie';
    }
    const tmdbTag = pathname.match(/\/(movie|tv)\/tmdb\/(\d+)(?:-(\d{1,2})-(\d{1,3}))?(?=[\/?#]|$)/i);
    if (!info.tmdbId && tmdbTag) {
      info.tmdbId = parseInt(tmdbTag[2], 10);
      info.tmdbKind = tmdbTag[1].toLowerCase();
      if (tmdbTag[3] && !info.season) { info.season = parseInt(tmdbTag[3], 10); info.episode = parseInt(tmdbTag[4], 10); }
    }
    if (!info.tmdbId) {
      // "/movie/603", "/movies/603-the-matrix", "/embed/tv/1399/1/2"; the id must end the segment or be followed by "-".
      const tmdbMatch = pathname.match(/\/(tv|tvs|show|shows|series|movie|movies|film|films|watch)\/(\d+)(?=[-\/?#]|$)/i);
      if (tmdbMatch) {
        info.tmdbId = parseInt(tmdbMatch[2], 10);
        if (/^(movies?|films?)$/i.test(tmdbMatch[1])) info.tmdbKind = 'movie';
        else if (!/^watch$/i.test(tmdbMatch[1])) info.tmdbKind = 'tv';
      } else {
        const q = sp.get('tmdb') || sp.get('tmdb_id') || sp.get('tmdbid');
        // "?video_id=x&tmdb=1": there tmdb=1 is a flag, not TMDB id 1.
        if (q && /^\d+$/.test(q) && !(sp.has('video_id') && q === '1')) {
          info.tmdbId = parseInt(q, 10);
          const t = (sp.get('type') || '').toLowerCase();
          if (t === 'movie') info.tmdbKind = 'movie'; else if (t === 'tv' || t === 'series') info.tmdbKind = 'tv';
        }
      }
    }
    let seFromUrl = extractSeEpisode(href);
    if (!seFromUrl) {
      // "/tv/1399-1-2" (season and episode joined to the id)
      const j = pathname.match(/\/(?:tv|tvs|show|shows|series)\/\d+-(\d{1,2})-(\d{1,3})(?:[\/?#]|$)/i);
      if (j) seFromUrl = { season: parseInt(j[1], 10), episode: parseInt(j[2], 10) };
    }
    if (!seFromUrl) {
      const m = pathname.match(/\/(?:tv|tvs|show|shows|series)\/\d+[^\/]*\/(\d{1,2})\/(\d{1,3})(?:[\/?#]|$)/i);
      if (m) seFromUrl = { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
    }
    if (seFromUrl && seFromUrl.season && seFromUrl.episode) {
      if (!info.season)  info.season  = seFromUrl.season;
      if (!info.episode) info.episode = seFromUrl.episode;
    }
    if (!info.season)  { const s = sp.get('season') || sp.get('s'); if (s && /^\d+$/.test(s)) info.season  = parseInt(s, 10); }
    if (!info.episode) { const e = sp.get('episode') || sp.get('ep') || sp.get('e'); if (e && /^\d+$/.test(e)) info.episode = parseInt(e, 10); }
    clampSE(info);
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
        const nm = obj?.partOfSeries?.name || (/^(Movie|TVSeries|TVSeason|CreativeWork|VideoObject)$/.test(String(obj?.['@type'])) ? obj?.name : null);
        if (nm && !info.ldName) info.ldName = String(nm).slice(0, 120);
        const dt = String(obj?.datePublished || obj?.dateCreated || obj?.startDate || obj?.uploadDate || '').match(/^((?:19|20)\d{2})/);
        if (dt && !info.year && /^(Movie|TVSeries)$/.test(String(obj?.['@type']))) info.year = parseInt(dt[1], 10);
      } catch { /* malformed JSON-LD */ }
    });
    if (!info.malId) {
      const a = document.querySelector('a[href*="myanimelist.net/anime/"]');
      const m = a && String(a.getAttribute('href')).match(/myanimelist\.net\/anime\/(\d{1,7})/);
      const d = document.querySelector('[data-mal-id],[data-malid],[data-mal]');
      const dv = d && (d.getAttribute('data-mal-id') || d.getAttribute('data-malid') || d.getAttribute('data-mal'));
      if (m) info.malId = parseInt(m[1], 10);
      else if (dv && /^\d{1,7}$/.test(dv.trim())) info.malId = parseInt(dv, 10);
      else {
        for (const sc of document.querySelectorAll('script:not([src])')) {
          const t = sc.textContent || '';
          if (t.length > 200000) continue;
          const k = t.match(/["']?(?:mal_id|malId|idMal|malID)["']?\s*[:=]\s*["']?(\d{1,7})\b/);
          if (k) { info.malId = parseInt(k[1], 10); break; }
        }
      }
    }
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
    // The page says it is an episode (Open Graph): never look it up as a film.
    const ogType = String(document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '').trim().toLowerCase();
    if (!info.tmdbKind && (ogType === 'video.episode' || ogType === 'video.tv_show')) info.tmdbKind = 'tv';
    if ((!info.season || !info.episode) && info.tmdbKind !== 'movie') {
      const text = document.title + ' ' + (document.body?.textContent?.slice(0, 4000) || '');
      const textPatterns = [
        [/Season\s+(\d+)[,\s·•\-]+Episode\s+(\d+)/i, false],
        [SE_REGEX, false],
        [/\bS(\d{1,2})E(\d{1,3})\b/i, false],
        [SE_WORDS_RE, false],
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
    clampSE(info);
  }

  function titleFromSlug(slug) {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }

  function parsePathTitle(info, pathIn) {
    const segments = String(pathIn || location.pathname).toLowerCase().split('/').filter(Boolean);
    const idx = segments.findIndex(s => ['tv', 'tvs', 'series', 'show', 'shows', 'watch', 'stream', 'episode', 'anime', 'movie', 'movies', 'film', 'films'].includes(s));
    if (idx === -1 || !segments[idx + 1]) return null;
    if (/^(movies?|films?)$/.test(segments[idx]) && !info.tmdbKind) info.tmdbKind = 'movie';
    // "603-the-matrix", "the-matrix-1999", "the-matrix-1999-hd" -> "the-matrix" (+ year)
    let slug = segments[idx + 1].replace(/\.html?$/, '').replace(/^\d+-(?=[a-z])/, '');
    const yr = slug.match(/-((?:19|20)\d{2})(?:-[a-z0-9]{1,6})?$/);
    if (yr) { info.year = parseInt(yr[1], 10); slug = slug.slice(0, yr.index); }
    slug = slug.replace(/-(?:online|free|hd|full-movie|watch)$/g, '');
    if (!/[a-z]{2}/.test(slug)) return null;
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
    clampSE(info);
    return titleFromSlug(slug);
  }

  const imdbCache = new Map();

  async function tmdbToImdb(tmdbId, kind, title) {
    const k = kind === 'movie' ? 'movie' : 'tv';
    const key = `${k}:${tmdbId}`;
    if (imdbCache.has(key)) return imdbCache.get(key);
    try {
      const res = await br.runtime.sendMessage({ type: 'TMDB_TO_IMDB', tmdbId, kind: k, title: title || '' });
      if (res?.imdbId) imdbCache.set(key, res.imdbId);
      return res?.imdbId || null;
    } catch { return null; }
  }

  const _titleIdCache = new Map();

  async function resolveShowInfo() {
    const info = { imdbId: null, tmdbId: null, tmdbKind: null, season: null, episode: null, year: null, title: null };
    parseUrlInfo(info);
    // Embedded player: the page the user is on (its real address, from the
    // background) carries the ids and S/E far more often than the player URL.
    let top = null;
    if (window !== window.top) {
      await _refreshTabInfo();
      top = _topHref();
      if (top && top !== location.href) parseUrlInfo(info, top);
    }
    parsePageInfo(info);
    if (info.tmdbKind === 'movie') { info.season = null; info.episode = null; }

    const pageTitle = getVideoTitle();
    if (!info.imdbId && info.tmdbId) info.imdbId = await tmdbToImdb(info.tmdbId, info.tmdbKind, pageTitle);
    if (!info.imdbId) {
      let path = null;
      try { path = top ? new URL(top).pathname : null; } catch { /* ok */ }
      info.title = parsePathTitle(info) || (path && parsePathTitle(info, path)) || null;
      if (info.tmdbKind === 'movie') { info.season = null; info.episode = null; }
      // No id anywhere (aggregator sites): ask TMDB for an exact title match.
      // Never on YouTube, where the title is a video name, not a film.
      const yt = _hostIs(_siteHost(), 'youtube.com') || !!_youtubeVideoId();
      // Several names for the same page, best first: the address, structured
      // data, the page heading, the tab title. The first exact TMDB match wins.
      const h1 = !yt ? _cleanTitle((document.querySelector('h1')?.textContent || '').trim(), [getSiteName(), _siteHost()]) : '';
      const qs = [];
      for (const c of [info.title, info.ldName, !yt ? pageTitle : '', h1]) {
        const t = String(c || '').trim();
        if (t.length >= 2 && t.length <= 120 && !qs.some(x => x.toLowerCase() === t.toLowerCase())) qs.push(t);
      }
      for (const q of yt ? [] : qs.slice(0, 3)) {
        const kind = info.season && info.episode ? 'tv' : (info.tmdbKind || '');
        const key = kind + ':' + q.toLowerCase() + ':' + (info.year || '');
        if (!_titleIdCache.has(key)) {
          let r = null;
          try { r = await br.runtime.sendMessage({ type: 'TMDB_FIND_TITLE', title: q, year: info.year || null, kind }); } catch { r = null; }
          // Only definitive answers are kept; no key / network trouble stays retryable.
          if (r && (r.imdbId || r.answered)) _titleIdCache.set(key, r);
        }
        const hit = _titleIdCache.get(key);
        if (hit && hit.imdbId) {
          info.imdbId = hit.imdbId;
          info.byTitle = true;
          if (hit.tmdbId && !info.tmdbId) info.tmdbId = hit.tmdbId;
          if (hit.kind === 'movie') { info.tmdbKind = 'movie'; info.season = null; info.episode = null; }
          break;
        }
        if (!hit) break;   // no key or network trouble: the other names would fail the same way
      }
    }
    return info;
  }

  // ── Segments API ───────────────────────────────────────────────────────────

  const segmentCache = new Map();

  // Only real data is cached: a miss must stay retryable (API down, key added later).
  async function fetchSegments(imdbId, season, episode, isMovie, extra) {
    const x = extra || {};
    const key = (isMovie ? `${imdbId}:movie` : `${imdbId}:${season}:${episode}`) + (x.tmdbId ? ':t' + x.tmdbId : '') + (x.malId ? ':m' + x.malId : '');
    if (segmentCache.has(key)) return segmentCache.get(key);
    
    // If this is a YouTube video, try SponsorBlock first
    if (String(imdbId || '').startsWith('yt/')) {
      const ytVideoId = imdbId.slice(3); // extract 11-char ID
      try {
        const res = await br.runtime.sendMessage({ type: 'FETCH_SEGMENTS_YT', videoId: ytVideoId });
        if (res?.data) {
          segmentCache.set(key, res.data);
          return res.data;
        }
      } catch { /* fall through to regular path */ }
    }
    
    // Regular IntroDB/AnimeSkip path for non-YouTube
    try {
      const res = await br.runtime.sendMessage({ type: 'FETCH_SEGMENTS', imdbId, season, episode, isMovie: !!isMovie,
        tmdbId: x.tmdbId || null, malId: x.malId || null, anime: !!x.anime, title: x.title || '', durationSec: x.durationSec || 0 });
      const data = res?.data || null;
      if (data) segmentCache.set(key, data);
      return data;
    } catch { return null; }
  }

  const SEG_KEYS = ['intro', 'recap', 'outro', 'preview', 'sponsor', 'selfpromo', 'interaction', 'music_offtopic', 'filler'];

  // ── Segment markers on the timeline ─────────────────────────────────────────
  // YouTube: drawn inside its own progress bar, like SponsorBlock. Other sites:
  // a thin strip along the bottom of the video that shows while the mouse moves
  // over it. Settings > "Show skips on the timeline" turns both off.
  const SEG_COLORS = { intro: '#00e5ff', recap: '#ffb300', outro: '#3d5afe', preview: '#29b6f6', sponsor: '#00d400',
    selfpromo: '#ffeb3b', interaction: '#cc00ff', music_offtopic: '#ff9900', filler: '#7300ff', poi_highlight: '#ff1684' };
  function _timelineSpans(segs, duration) {
    const out = [];
    if (!segs || !(duration > 0)) return out;
    for (const key of [...SEG_KEYS, 'poi_highlight']) {
      const v = segs[key];
      for (const sg of (Array.isArray(v) ? v : v ? [v] : [])) {
        const a = Number(sg && sg.start_sec), b = key === 'poi_highlight' ? a : Number(sg && sg.end_sec);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a >= duration || b < a) continue;
        const left = Math.max(0, a / duration * 100);
        const width = key === 'poi_highlight' ? 0.6 : Math.min(100 - left, (Math.min(b, duration) - a) / duration * 100);
        if (width > 0) out.push({ key, left: Math.round(left * 100) / 100, width: Math.round(width * 100) / 100 });
      }
    }
    return out;
  }
  let _tlBox = null, _tlVideo = null, _tlSegs = null, _tlMoveOn = false, _tlObs = null;
  function _clearTimeline() { if (_tlBox) _tlBox.remove(); _tlBox = null; _tlSegs = null; }
  // Called from the skip loop and on player DOM changes: YouTube rebuilds its
  // controls (always on m.youtube.com), so marks are put back when they are gone.
  function _tlKeep() {
    if (!_tlSegs || !_tlVideo || !prefs.showTimeline || !_youtubeVideoId()) return;
    if (_ytAdShowing()) { if (_tlBox) { _tlBox.remove(); _tlBox = null; } return; }
    const bar = _ytBar();
    if (bar && (!_tlBox || !_tlBox.isConnected || _tlBox.parentElement !== bar)) _renderTimeline(_tlVideo, _tlSegs);
  }
  function _tlWatch() {
    if (_tlObs) return;
    const root = document.getElementById('player-control-container') || document.getElementById('movie_player') || document.getElementById('player');
    if (!root || typeof MutationObserver === 'undefined') return;
    _tlObs = new MutationObserver(throttle(_tlKeep, 300));
    _tlObs.observe(root, { childList: true, subtree: true });
  }
  // A local history entry for the same page on the site's old address: same site
  // name (_siteFamily), same path and ids. The newest one wins. Ids without a host
  // (movie/603, tv/1396) already stay the same when a site moves.
  async function _cacheReadMoved(id) {
    const HID = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/.*)$/i;
    const m = HID.exec(String(id || ''));
    if (!m) return null;
    const fam = _siteFamily(m[1]);
    try {
      const c = (await br.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
      let best = null;
      for (const [k, v] of Object.entries(c)) {
        if (k === id || !v || typeof v !== 'object') continue;
        const n = HID.exec(k);
        if (n && n[2] === m[2] && _siteFamily(n[1]) === fam && (!best || (v.t || 0) > (best.t || 0))) best = v;
      }
      return best;
    } catch { return null; }
  }

  // ── Marks on any player's progress bar (1.13 round 4) ───────────────────
  // Not tied to one player: SkipStream looks near the video for the element that
  // acts as the seek bar (a slider or a "progress / seek / timeline" element, as
  // wide as most of the video, low on it, not volume). Known class names from
  // popular players only add points. The marks are NOT put inside the player:
  // players such as Vidstack rebuild their bar and removed them (round 3). They
  // float exactly over the bar, follow it every 250 ms, and hide when the
  // player hides its controls. No bar found: a thin strip along the bottom of
  // the video, shown while the mouse moves, as before.
  function _seekBarScore(c, vr, dur) {
    let r;
    try { r = c.getBoundingClientRect(); } catch { return 0; }
    if (!(r.width >= vr.width * 0.4) || !(r.height >= 1) || r.height > 48) return 0;
    if (r.left < vr.left - 12 || r.right > vr.right + 12 || r.top < vr.top + vr.height * 0.45 || r.bottom > vr.bottom + 80) return 0;
    const name = String((c.className && c.className.baseVal !== undefined ? c.className.baseVal : c.className) || '') + ' ' + String(c.id || '');
    const label = String((c.getAttribute && (c.getAttribute('aria-label') || '')) || '') + ' ' + String((c.getAttribute && c.getAttribute('aria-valuetext')) || '');
    if (/volume|vol-|brightness|speed|rate|quality|zoom/i.test(name + ' ' + label)) return 0;
    let sc = 0;
    const role = c.getAttribute && c.getAttribute('role');
    const tag = String(c.tagName || '').toLowerCase();
    if (role === 'slider' || (tag === 'input' && String(c.type).toLowerCase() === 'range')) sc += 3;
    const max = Number(c.getAttribute && (c.getAttribute('aria-valuemax') || c.getAttribute('max')));
    if (dur > 0 && Number.isFinite(max) && Math.abs(max - dur) <= Math.max(2, dur * 0.02)) sc += 3;
    if (/\d:\d\d|seek|progress|time|position/i.test(label)) sc += 2;
    if (/progress|seek|scrub|timeline|time-?slider|slider-track|rail|track/i.test(name)) sc += 2;
    if (PLAYER_BAR_SELECTORS.some(sel => { try { return c.matches(sel); } catch { return false; } })) sc += 2;
    if (r.width >= vr.width * 0.7) sc += 1;
    return sc;
  }
  function _findSeekBar(video) {
    let vr;
    try { vr = video.getBoundingClientRect(); } catch { return null; }
    if (!(vr.width >= 120)) return null;
    const dur = Number(video.duration);
    // The player box: the highest ancestor (6 levels, out of shadow roots too)
    // that is still about the size of the video.
    let el = video, scope = null;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement || (el.getRootNode && el.getRootNode() && el.getRootNode().host) || null;
      if (!el || typeof el.querySelectorAll !== 'function') break;
      let rr; try { rr = el.getBoundingClientRect(); } catch { break; }
      if (rr.width > vr.width * 1.6 + 8 || rr.height > vr.height * 1.8 + 8) break;
      scope = el;
    }
    if (!scope) return null;
    const SEL = '[role="slider"],input[type="range"],[class*="progress" i],[class*="seek" i],[class*="scrub" i],[class*="timeline" i],[class*="slider" i],[class*="rail" i],[id*="progress" i],[id*="seek" i],' + PLAYER_BAR_SELECTORS.join(',');
    let best = null, bestSc = 0, n = 0;
    const look = (root, depth) => {
      let list = [];
      try { list = root.querySelectorAll(SEL); } catch { return; }
      for (const c of list) {
        if (++n > 400) return;
        const sc = _seekBarScore(c, vr, dur);
        if (sc > bestSc) { best = c; bestSc = sc; }
      }
      if (depth >= 2) return;
      try { root.querySelectorAll('*').forEach(x => { if (x.shadowRoot) look(x.shadowRoot, depth + 1); }); } catch { /* ok */ }
    };
    look(scope, 0);
    return bestSc >= 3 ? best : null;
  }
  let _tlBar = null, _tlBarAt = 0, _tlTick = null, _tlMouseAt = 0;
  function _tlPlace() {
    const box = _tlBox, video = _tlVideo;
    if (!box || box.dataset.ss !== 'over' || !video || !video.isConnected) { clearInterval(_tlTick); _tlTick = null; return; }
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const host = fs || document.body || document.documentElement;
    if (box.parentNode !== host) host.appendChild(box);
    const now = Date.now();
    if ((!_tlBar || !_tlBar.isConnected) && now - _tlBarAt > 1000) { _tlBarAt = now; _tlBar = _findSeekBar(video); }
    const put = (l, t, w, h, on) => Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', opacity: on ? '1' : '0' });
    if (_tlBar) {
      const r = _tlBar.getBoundingClientRect();
      let vis = r.width > 0 && r.height > 0;
      try { if (vis && typeof _tlBar.checkVisibility === 'function') vis = _tlBar.checkVisibility({ opacityProperty: true, visibilityProperty: true }); } catch { /* ok */ }
      const h = Math.max(3, Math.min(5, r.height));
      put(r.left, r.top + r.height / 2 - h / 2, r.width, h, vis);
      return;
    }
    const vr = video.getBoundingClientRect();
    put(vr.left, vr.bottom - 5, vr.width, 5, now - _tlMouseAt < 2500);
  }

  function _renderTimeline(video, segs) {
    _tlVideo = video; _tlSegs = segs;
    if (_tlBox) { _tlBox.remove(); _tlBox = null; }
    if (!prefs.showTimeline || !video || !video.isConnected) return;
    const d = Number(video.duration);
    if (!Number.isFinite(d) || d <= 0) { video.addEventListener('durationchange', () => { if (_tlSegs === segs) _renderTimeline(video, segs); }, { once: true }); return; }
    const spans = _timelineSpans(segs, d);
    if (!spans.length) return;
    const yt = !!_youtubeVideoId();
    // YouTube: only inside its own bar. The mobile site removes the bar while its
    // controls are hidden; _tlKeep() draws again when the bar comes back.
    if (yt && _ytAdShowing()) return;
    const ytBar = yt ? _ytBar() : null;
    if (yt && !ytBar) return;
    const box = document.createElement('div');
    box.id = 'skipstream-timeline';
    if (ytBar) {
      box.dataset.ss = 'yt';
      try { if (getComputedStyle(ytBar).position === 'static') ytBar.style.position = 'relative'; } catch { /* ok */ }
      Object.assign(box.style, { position: 'absolute', left: '0', right: '0', top: '0', bottom: '0', pointerEvents: 'none', zIndex: '40' });
      ytBar.appendChild(box);
      _tlWatch();
    } else {
      box.dataset.ss = 'over';
      Object.assign(box.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '4px', pointerEvents: 'none', zIndex: '2147483644', opacity: '0', transition: 'opacity 150ms ease' });
      (document.fullscreenElement || document.webkitFullscreenElement || document.body || document.documentElement).appendChild(box);
      _tlBar = null; _tlBarAt = 0;
      if (!_tlTick) _tlTick = setInterval(_tlPlace, 250);
      if (!_tlMoveOn) {
        _tlMoveOn = true;
        document.addEventListener('mousemove', throttle((e) => {
          if (!_tlVideo) return;
          const r = _tlVideo.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) _tlMouseAt = Date.now();
        }, 150), true);
      }
    }
    for (const sp of spans) {
      const m = document.createElement('div');
      Object.assign(m.style, { position: 'absolute', top: '0', bottom: '0', left: sp.left + '%', width: Math.max(sp.width, 0.4) + '%',
        background: SEG_COLORS[sp.key] || '#fff', opacity: '0.9', borderRadius: '1px' });
      box.appendChild(m);
    }
    _tlBox = box;
    if (box.dataset.ss === 'over') _tlPlace();
  }

  // SponsorBlock rows are made for one upload; a row made for a different length
  // (re-upload, edit) would skip the wrong part. Rule from yt-dlp: within 3 s.
  function _sbFitDuration(segs, video) {
    if (!segs || !video) return segs;
    const d = Number(video.duration);
    if (!Number.isFinite(d) || d <= 0 || _ytAdShowing()) return segs;
    const out = {};
    for (const [k, v] of Object.entries(segs)) {
      if (!Array.isArray(v)) { out[k] = v; continue; }
      const keep = v.filter(r => !(r && r.video_duration > 0) || Math.abs(r.video_duration - d) <= 3);
      if (keep.length) out[k] = keep;
    }
    return Object.keys(out).length ? out : null;
  }

  // Anime streaming sites (MyAnimeList ids are looked up by title there).
  function _animeSite() {
    const h = _siteHost();
    return /(^|\.)(?:[a-z0-9-]*anime[a-z0-9-]*|aniwatch[a-z]*|zoro|kaido|aniwave|animekai|gogoanime[a-z0-9]*|anitaku|animepahe|crunchyroll)\.[a-z.]+$/i.test(h);
  }

  // Chapters the page itself gives the player: <track kind="chapters"> cues and
  // JSON-LD Clip parts named "Intro", "Opening", "Recap", "Credits", "Preview".
  // Lowest priority: only used when no skip database answers.
  const CHAPTER_KEY = [[/\b(intro|opening|op)\b/i, 'intro'], [/\b(recap|previously)\b/i, 'recap'],
    [/\b(credits|ending|outro|ed|end credits)\b/i, 'outro'], [/\b(preview|next episode)\b/i, 'preview']];
  function _chapterKey(name) { const t = String(name || '').trim(); if (!t || t.length > 40) return null; const hit = CHAPTER_KEY.find(([re]) => re.test(t)); return hit ? hit[1] : null; }
  function _pageChapters(video) {
    const out = {};
    const add = (name, a, b) => { const k = _chapterKey(name); a = Number(a); b = Number(b); if (k && !out[k] && Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0) out[k] = { start_sec: a, end_sec: b }; };
    try {
      for (const t of Array.from((video && video.textTracks) || [])) {
        if (t.kind !== 'chapters') continue;
        if (t.mode === 'disabled') t.mode = 'hidden';
        for (const c of Array.from(t.cues || [])) add(c.text, c.startTime, c.endTime);
      }
    } catch { /* ok */ }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const d = JSON.parse(el.textContent || '');
        const parts = [].concat(d && d.hasPart || [], ...(Array.isArray(d) ? d.map(x => x && x.hasPart || []) : []));
        for (const c of parts) if (c && /Clip/.test(String(c['@type']))) add(c.name, c.startOffset, c.endOffset);
      } catch { /* malformed JSON-LD */ }
    });
    return Object.keys(out).length ? out : null;
  }

  function findActiveSegment(segments, currentTime) {
    // A segment needs numeric start < end; null/garbage rows never match.
    function hit(time, s) {
      if (!s || typeof s !== 'object') return false;
      const a = Number(s.start_sec), b = Number(s.end_sec);
      if (s.start_sec == null || s.end_sec == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
      return time >= a - 2 && time < b + 1;
    }
    function isInSegment(time, segmentOrArray) {
      if (!segmentOrArray) return null;
      if (Array.isArray(segmentOrArray)) {
        return segmentOrArray.find(s => hit(time, s)) || null;
      }
      return hit(time, segmentOrArray) ? segmentOrArray : null;
    }
    for (const key of SEG_KEYS) {
      const seg = segments[key];
      const active = isInSegment(currentTime, seg);
      if (active) return { key, segment: active };
    }
    return null;
  }

  const PREF_FOR_SEGMENT = { intro: 'skipIntro', recap: 'skipRecap', outro: 'skipOutro', preview: 'skipOutro', sponsor: 'skipIntro', selfpromo: 'skipIntro' };
  const SEGMENT_LABELS   = { intro: '⏭ Skip Intro', recap: '⏭ Skip Recap', outro: '⏭ Skip Outro', preview: '⏭ Skip Preview', sponsor: '⏭ Skip Sponsor', selfpromo: '⏭ Skip Self-promo',
    interaction: '⏭ Skip Reminder', music_offtopic: '⏭ Skip Non-music', filler: '⏭ Skip Filler' };

  // YouTube (SponsorBlock) categories each have a mode: auto, ask (button) or off
  // (only drawn on the timeline). Sponsors and self-promo follow the Intros
  // switch unless set in Settings, as they did before 1.12.
  const SB_MODE_DEFAULTS = { sponsor: null, selfpromo: null, interaction: 'ask', preview: 'ask', music_offtopic: 'off', filler: 'off', intro: null, outro: null };
  function _segMode(key, p, yt) {
    if (!p) return 'ask';
    if (yt && key in SB_MODE_DEFAULTS) {
      const set = p.sbModes && typeof p.sbModes === 'object' ? p.sbModes[key] : null;
      if (set === 'auto' || set === 'ask' || set === 'off') return set;
      if (SB_MODE_DEFAULTS[key]) return SB_MODE_DEFAULTS[key];
    }
    const pk = PREF_FOR_SEGMENT[key];
    return pk && p[pk] ? 'auto' : 'ask';
  }

  function segmentLabel(key, segment) {
    const base  = SEGMENT_LABELS[key] || `⏭ Skip ${key}`;
    const count = segment && (segment.submission_count ?? segment.report_count ?? segment.votes ?? null);
    if (!count || count < 2) return base;
    const badge = count >= 10 ? ' ★' : count >= 5 ? ' ◆' : '';
    return base + badge;
  }

  // ── Skip countdown toast ──────────────────────────────────────────────────

  const COUNTDOWN_ID = 'skipstream-countdown';
  let _countdownTimer = null;
  let _countdownDetach = null;

  // C9: stats are read-modify-write too; chain them so two skips never count as one.
  let _statsChain = Promise.resolve();
  function _serialStats(fn) {
    _statsChain = _statsChain.then(fn, fn).catch(() => {});
    return _statsChain;
  }

  // Small easter egg: a one-off note at 100, 500, 1000, 5000 and 10000 skips.
  const MILESTONES = [100, 500, 1000, 5000, 10000];
  function _milestone(total) { return MILESTONES.includes(Number(total)) ? Number(total) : 0; }
  function _milestoneText(n, sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    const saved = h ? h + ' h ' + m + ' min' : m + ' min';
    const extra = s >= 7200 ? ' That is about ' + Math.floor(s / 5400) + ' films.' : '';
    return n + ' skips. ' + saved + ' of your life back.' + extra;
  }
  function _showMilestone(n, sec) {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body;
    if (!container) return;
    const p = pal();
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.textContent = '🎉 ' + _milestoneText(n, sec);
    Object.assign(el.style, { all: 'unset', position: fsEl ? 'absolute' : 'fixed', bottom: TOAST_BOTTOM, left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '10px 16px', background: p.bg, color: p.text, border: '1px solid ' + p.edge, borderRadius: TOAST_RADIUS,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif', fontSize: '14px', fontWeight: '600', opacity: '0', transition: 'opacity 240ms ease' });
    container.appendChild(_toastFit(el));
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => el.remove(), 4500);
  }

  function recordSkipStat(timeSavedSec) {
    _serialStats(() => br.storage.local.get('skipstream_stats').then(s => {
      const st = s.skipstream_stats || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0, skipsToday: 0, statsDate: '', timeSavedToday: 0, skipsBySite: {} };
      const today = new Date().toDateString();
      const site = _siteHost();
      
      // Reset daily counters if new day
      if (st.statsDate !== today) {
        st.statsDate = today;
        st.skipsToday = 0;
        st.timeSavedToday = 0;
      }
      
      const savedSec = Math.max(0, Math.round(timeSavedSec));
      st.skipsToday = (st.skipsToday || 0) + 1;
      st.timeSavedToday = (st.timeSavedToday || 0) + savedSec;
      st.skipsTotal = (st.skipsTotal || 0) + 1;
      st.timeSavedSec = (st.timeSavedSec || 0) + savedSec;
      
      // Per-site tracking
      if (!st.skipsBySite) st.skipsBySite = {};
      st.skipsBySite[site] = (st.skipsBySite[site] || 0) + 1;

      const mile = _milestone(st.skipsTotal);
      if (mile) setTimeout(() => _showMilestone(mile, st.timeSavedSec), 5600);
      return br.storage.local.set({ skipstream_stats: st });
    }).catch(() => {}));
  }

  // After an automatic skip: a short "Skipped intro, Undo" notice (SponsorBlock's
  // best pattern, written fresh here). Undo jumps back and that segment is left
  // alone until it has played past, for this video only.
  const SKIPPED_ID = 'skipstream-skipped-notice';
  const SKIPPED_NAMES = { intro: 'intro', recap: 'recap', outro: 'outro', preview: 'preview', sponsor: 'sponsor', selfpromo: 'self-promo', interaction: 'reminder', music_offtopic: 'non-music', filler: 'filler' };
  let _skippedTimer = null;
  function showSkippedNotice(segKey, segment, video, prevTime) {
    clearTimeout(_skippedTimer);
    const old = document.getElementById(SKIPPED_ID);
    if (old) old.remove();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;
    if (!container) return;
    const p = pal();
    const box = document.createElement('div');
    box.id = SKIPPED_ID;
    box.setAttribute('role', 'status');
    Object.assign(box.style, {
      all: 'unset', position: fsEl ? 'absolute' : 'fixed', bottom: TOAST_BOTTOM, right: '3%',
      zIndex: '2147483647', display: 'flex', alignItems: 'center', gap: '12px',
      padding: '8px 8px 8px 14px', background: p.bg, color: p.text,
      border: '1px solid ' + p.edge, borderRadius: TOAST_RADIUS,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      fontSize: '14px', fontWeight: '600', pointerEvents: 'auto',
      opacity: '0', transform: 'translate3d(0, 10px, 0)',
      transition: 'opacity 240ms ease, transform 240ms ease',
    });
    const msg = document.createElement('span');
    msg.textContent = 'Skipped ' + (SKIPPED_NAMES[segKey] || segKey);
    const undo = document.createElement('button');
    undo.textContent = 'Undo';
    Object.assign(undo.style, {
      all: 'unset', boxSizing: 'border-box', cursor: 'pointer', minHeight: '44px', minWidth: '44px',
      padding: '0 16px', display: 'grid', placeItems: 'center', background: p.accent,
      borderRadius: '8px', fontSize: '14px', fontWeight: '600', color: p.onAccent, fontFamily: 'inherit',
    });
    const close = () => { clearTimeout(_skippedTimer); if (box.isConnected) box.remove(); };
    undo.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      video._ssUndone = { key: segKey, until: segment.end_sec, media: getMediaId() };
      if (_diag.last) _diag.last.undone = true;
      try { if (video.isConnected) video.currentTime = prevTime; } catch { /* ok */ }
      close();
    };
    box.appendChild(msg);
    box.appendChild(undo);
    container.appendChild(_toastFit(box));
    if (_diag.last) _diag.last.notice = true;
    requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translate3d(0, 0, 0)'; });
    _skippedTimer = setTimeout(close, 5000);
  }

  // True while an undone segment should be left alone (same video, not yet past it).
  function _skipUndone(video, key, now, mediaId) {
    const u = video._ssUndone;
    if (!u) return false;
    if (u.media !== mediaId || now >= u.until) { video._ssUndone = null; return false; }
    return u.key === key;
  }

  function showSkipCountdown(segKey, segment, video, onDone) {
    // Clear any existing countdown (its pause listener must not fire later)
    clearInterval(_countdownTimer);
    if (_countdownDetach) { _countdownDetach(); _countdownDetach = null; }
    const existing = document.getElementById(COUNTDOWN_ID);
    if (existing) existing.remove();

    const isAutoMode = _segMode(segKey, _ssEffPrefs || prefs, !!_youtubeVideoId()) === 'auto'; // auto = instant, ask = prompt

    // FIX 1: Auto mode = instant skip, no countdown
    if (isAutoMode) {
      const prevTime = video.currentTime;
      video.currentTime = segment.end_sec;
      video._ssCooldownUntil = Date.now() + 1500;
      recordSkipStat(segment.end_sec - prevTime);
      _diag.last = { key: segKey, at: Date.now(), auto: true, notice: false, undone: false };
      video._ssLastSkip = { key: segKey, from: prevTime, until: segment.end_sec, at: Date.now(), media: getMediaId() };
      // "Skipped X, Undo" is off by default (Settings > Skipping): Alt+Z still undoes.
      if (prefs.skipNotice) showSkippedNotice(segKey, segment, video, prevTime);
      onDone();
      return;
    }

    // Prompt mode = show countdown with undo button
    const fullLabel = segmentLabel(segKey, segment);
    let secs = 3;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (_countdownDetach === detach) _countdownDetach = null;
      detach();
      onDone();
    };
    const detach = () => { video.removeEventListener('pause', onPause); };

    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const container = fsEl || document.body || document.documentElement;

    const toast = document.createElement('div');
    toast.id = COUNTDOWN_ID;
    const p = pal();
    Object.assign(toast.style, {
      all: 'unset', position: fsEl ? 'absolute' : 'fixed',
      bottom: TOAST_BOTTOM, right: '3%', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', gap: '11px',
      padding: '9px 11px 9px 14px',
      background: p.bg,
      color: p.text, border: '1px solid ' + p.edge,
      borderRadius: TOAST_RADIUS, boxShadow: '0 6px 22px ' + _ok(0.08, 0.02, _hexToOklch(_seedHex).H, 0.55) + '',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      fontSize: '13.5px', fontWeight: '600', letterSpacing: '-.01em',
      pointerEvents: 'auto',
      opacity: '0', transform: 'translate3d(0, 10px, 0) scale(.97)',
      transition: 'opacity 340ms cubic-bezier(.22,1,.36,1), transform 340ms cubic-bezier(.22,1,.36,1)',
    });

    const msgEl = document.createElement('span');
    const undoBtn = document.createElement('button');
    Object.assign(undoBtn.style, {
      all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
      height: '30px', padding: '0 13px', display: 'grid', placeItems: 'center',
      background: p.accent, borderRadius: '8px',
      fontSize: '12px', fontWeight: '600', color: p.onAccent,
      fontFamily: 'inherit',
      transition: 'transform 110ms cubic-bezier(.22,1,.36,1)',
    });
    undoBtn.onmousedown = () => { undoBtn.style.transform = 'scale(.95)'; };
    undoBtn.onmouseup = () => { undoBtn.style.transform = 'scale(1)'; };
    undoBtn.textContent = 'Undo';

    const doSkip = () => {
      clearInterval(_countdownTimer);
      if (toast.isConnected) toast.remove();
      const prevTime = video.currentTime;
      video.currentTime = segment.end_sec;
      video._ssCooldownUntil = Date.now() + 1500;
      recordSkipStat(segment.end_sec - prevTime);
      _diag.last = { key: segKey, at: Date.now(), auto: false, notice: false, undone: false };
      finish();
    };

    undoBtn.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      clearInterval(_countdownTimer);
      toast.remove();
      // Without this the same segment started a new countdown half a second later.
      video._ssUndone = { key: segKey, until: segment.end_sec, media: getMediaId() };
      finish();
    };

    const update = () => {
      msgEl.textContent = `${fullLabel} in ${secs}s`;
    };
    update();
    toast.appendChild(msgEl);
    toast.appendChild(undoBtn);
    container.appendChild(_toastFit(toast));
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translate3d(0, 0, 0) scale(1)';
    });

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
    function onPause() {
      clearInterval(_countdownTimer);
      if (toast.isConnected) toast.remove();
      finish();
    }
    video.addEventListener('pause', onPause, { once: true });
    _countdownDetach = detach;
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
      // No "click the first button" fallback: in a random overlay that could be
      // Cancel, Sign out or an ad (C5).
    }
    return false;
  }

  // Poll every 3s - only when a video is playing
  // Stored so onNavigation can clear and restart it safely
  let _stillWatchingInterval = setInterval(() => {
    if (prefs.skipEnabled === false) return;   // C5: master switch off = hands off the page
    const vid = document.querySelector('video');
    if (vid && !vid.paused) tryDismissStillWatching();
  }, 3000);

  // ── Native platform button clicking ─────────────────────────────────────────
  // Clicks the platform's own "Skip Intro", "Skip Recap", "Next Episode" buttons.
  // Selector list based on public documentation and widely-used open-source extensions.
  // Works independently of IntroDB - no API key required.

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

  const NATIVE_SKIP_SITES = {
    'netflix.com': ['.watch-video--skip-content-button', '[data-uia="player-skip-intro"]', '[data-uia="next-episode-seamless-button"]'],
    'primevideo.com': ['.atvwebplayersdk-skipelement-button', '.skipElement'],
    'amazon.com': ['.atvwebplayersdk-skipelement-button', '.skipElement'],
    'disneyplus.com': ['.skip__button', '[data-testid="SkipIntroButton"]'],
    'hulu.com': ['.SkipButton'],
    'max.com': ['[data-testid="SkipButton"]'],
    'crunchyroll.com': ['[data-testid="skipIntroText"]', '.skip-button'],
    'peacocktv.com': ['.skip-button'],
    'paramountplus.com': ['.skip-button'],
    'tubi.tv': ['.skip-button'],
  };

  // Unlisted OTT fallback: match a visible control whose own label reads like a skip
// action. Text is matched whole so "Skip" never hits "Skipped" or "Skip settings".
let _lastLabelScanTs = 0;
const SKIP_TEXT_RE = /^(skip|skip intro|skip recap|skip opening|skip credits|skip outro|skip ending|skip titles)$/i;

function clickSkipByLabel() {
  // Layout-forcing scan: floor it so a mutation storm cannot run it per mutation.
  const _now = Date.now();
  if (_now - _lastLabelScanTs < 700) return false;
  _lastLabelScanTs = _now;
  const nodes = document.querySelectorAll('button,[role="button"],a[href="#"]');
  for (const el of nodes) {
    if (el.disabled || el.offsetParent === null) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!label || label.length > 24) continue;
    if (!SKIP_TEXT_RE.test(label)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    el.click();
    return true;
  }
  return false;
}

// Unlisted OTT fallback for next-episode controls. Bare "Next" is deliberately
// excluded: it matches pagination and carousel arrows.
const NEXT_EP_TEXT_RE = /^(next episode|next ep|play next|watch next)$/i;
let _lastNextScanTs = 0;

function clickNextByLabel() {
  const now = Date.now();
  if (now - _lastNextScanTs < 700) return false;
  _lastNextScanTs = now;
  const nodes = document.querySelectorAll('button,[role="button"],a[href="#"]');
  for (const el of nodes) {
    if (el.disabled || el.offsetParent === null) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!label || label.length > 24) continue;
    if (!NEXT_EP_TEXT_RE.test(label)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    el.click();
    return true;
  }
  return false;
}

function clickNativeSkipButton() {
    const host = location.hostname.replace(/^www\./, '');
    let selectors = null;
    for (const [domain, sels] of Object.entries(NATIVE_SKIP_SITES)) {
      if (host === domain || host.endsWith('.' + domain)) { selectors = sels; break; }
    }
    if (!selectors) return clickSkipByLabel();
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null && !btn.disabled) { btn.click(); return true; }
      } catch { /* invalid selector */ }
    }
    return false;
  }

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
        const now = Date.now();
        if (now - _lastNativeSkipTs > 10000 && clickNativeSkipButton()) {
          _lastNativeSkipTs = now;
          recordSkipStat(0); // Native platform button: click logged, duration unknown
        }
      }

      // Next episode: fire when within 10s of end
      if (ep.skipEnabled && prefs.autoNextEpisode &&
          video.duration > 60 &&
          video.currentTime > 0 &&
          video.duration - video.currentTime < 10 &&
          !_nextEpTriggered) {
        if (clickFirst(NEXT_EP_SELECTORS) || clickNextByLabel()) {
          _nextEpTriggered = true;
          setTimeout(() => { _nextEpTriggered = false; }, 30000);
        }
      }
    }, 800);
  }

  let _skipBtnObserver = null;
  function startNativeSkipObserver(video) {
    if (_skipBtnObserver) return;
    _skipBtnObserver = new MutationObserver(() => {
      if (!video || !video.isConnected) return;
      const ep = getSitePrefs(prefs);
      if (ep.skipEnabled) {
        const now = Date.now();
        if (now - _lastNativeSkipTs > 10000 && clickNativeSkipButton()) {
          _lastNativeSkipTs = now;
          recordSkipStat(0); // Native platform button: click logged, duration unknown
        }
      }
    });
    _skipBtnObserver.observe(document.documentElement, { childList: true, subtree: true });   // H13: survives a new <body>
  }



  // ── Skip button ────────────────────────────────────────────────────────────

  const SKIP_BTN_ID     = 'skipstream-skip-btn';
  const MSG_SHOW        = 'SKIPSTREAM_SHOW_BTN';
  const MSG_HIDE        = 'SKIPSTREAM_HIDE_BTN';
  const MSG_DO          = 'SKIPSTREAM_DO_SKIP';
  const MSG_ACK         = 'SKIPSTREAM_ACK_BTN';
  let _relayAcked       = false;

  let btnAutoHideTimer  = null;
  let pendingSkipFn     = null;

  function removeSkipBtn() {
    clearTimeout(btnAutoHideTimer);
    btnAutoHideTimer = null;
    document.querySelectorAll(`#${SKIP_BTN_ID},[data-skipstream-btn]`).forEach(el => {
      if (typeof el._ssCleanupFs === 'function') el._ssCleanupFs();
      if (typeof el._ssCleanupMove === 'function') el._ssCleanupMove();
      el.remove();
    });
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
    const p = pal();
    Object.assign(btn.style, {
      all: 'unset', position: isFs ? 'absolute' : 'fixed',
      bottom: TOAST_BOTTOM, right: '3%', zIndex: '2147483647',
      display: 'inline-flex', alignItems: 'center',
      padding: '12px 22px', background: p.accent,
      color: p.onAccent, border: '1px solid transparent',
      borderRadius: TOAST_RADIUS, cursor: 'pointer',
      fontSize: '14px', fontWeight: '600',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      letterSpacing: '-.005em', boxShadow: '0 6px 22px ' + _ok(0.08, 0.02, _hexToOklch(_seedHex).H, 0.55) + '',
      opacity: '0', transform: 'translate3d(0, 10px, 0) scale(.97)',
      transition: 'opacity 300ms cubic-bezier(.22,1,.36,1), transform 300ms cubic-bezier(.22,1,.36,1)',
      userSelect: 'none', pointerEvents: 'auto',
      WebkitFontSmoothing: 'antialiased',
    });
    btn.onmouseover = () => { btn.style.transform = 'translate3d(0, 0, 0) scale(1.04)'; };
    btn.onmouseout  = () => { btn.style.transform = 'translate3d(0, 0, 0) scale(1)'; };
    btn.onmousedown = () => { btn.style.transform = 'translate3d(0, 0, 0) scale(.97)'; };
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); onSkip(); removeSkipBtn(); };
    container.appendChild(_toastFit(btn));
    requestAnimationFrame(() => {
      btn.style.opacity = '1';
      btn.style.transform = 'translate3d(0, 0, 0) scale(1)';
    });

    const onFsChange = () => {
      if (document.getElementById(SKIP_BTN_ID)) {
        const newFs = document.fullscreenElement || document.webkitFullscreenElement;
        btn.style.position = newFs ? 'absolute' : 'fixed';
        (newFs || document.body || document.documentElement).appendChild(btn);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    btn._ssCleanupFs = () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };

    const _onMove = () => {
      clearTimeout(btnAutoHideTimer);
      btnAutoHideTimer = setTimeout(removeSkipBtn, 8000);
    };
    document.addEventListener('mousemove', _onMove, { passive: true });
    btn._ssCleanupMove = () => document.removeEventListener('mousemove', _onMove);
    btnAutoHideTimer = setTimeout(removeSkipBtn, 8000);
  }

  // In a player iframe the top frame draws the button (it sits over the whole
  // player, not inside a tiny frame). The iframe draws its own only if the top
  // frame does not acknowledge within 400ms, so there is never a second button.
  function showSkipBtn(label, onSkip) {
    pendingSkipFn = onSkip;
    if (window === window.top) { createSkipBtn(label, onSkip); return; }
    _relayAcked = false;
    try { window.top.postMessage({ type: MSG_SHOW, label }, '*'); } catch { /* cross-origin */ }
    setTimeout(() => { if (!_relayAcked && pendingSkipFn === onSkip) createSkipBtn(label, onSkip); }, 400);
  }

  function hideSkipBtn() {
    removeSkipBtn();
    if (window !== window.top) {
      try { window.top.postMessage({ type: MSG_HIDE }, '*'); } catch { /* cross-origin */ }
    }
  }

  // Only labels this script itself produces (segmentLabel) may be drawn by the top frame.
  function _isRelayLabel(l) {
    if (typeof l !== 'string' || l.length > 48) return false;
    const base = l.replace(/ [\u2605\u25C6]$/, '');
    return Object.values(SEGMENT_LABELS).includes(base) || /^\u23ED Skip [A-Za-z_-]{1,20}$/.test(base);
  }

  if (window === window.top) {
    window.addEventListener('message', e => {
      if (!e.data || typeof e.data !== 'object') return;
if (e.data.type !== MSG_SHOW && e.data.type !== MSG_HIDE) return;
if (e.data.type === MSG_SHOW && !_isRelayLabel(e.data.label)) return;
      if (e.data.type === MSG_SHOW) {
        createSkipBtn(e.data.label, () => { try { e.source?.postMessage({ type: MSG_DO }, '*'); } catch { /* ok */ } });
        try { e.source?.postMessage({ type: MSG_ACK }, '*'); } catch { /* ok */ }
      }
      if (e.data.type === MSG_HIDE) removeSkipBtn();
    });
  }

  if (window !== window.top) {
    window.addEventListener('message', e => {
      if (e.source !== window.top) return;
if (e.data?.type === MSG_ACK) { _relayAcked = true; return; }
if (e.data?.type === MSG_DO && pendingSkipFn) { pendingSkipFn(); pendingSkipFn = null; }
    });
  }

  // ── Subtitle system ────────────────────────────────────────────────────────

  let _subState = { enabled: true, language: 'en', fontSize: 18, position: 12, sync: 0, subs: [], loading: false, dragPos: { x: 50, bottom: 10 } };
  let _subOverlay = null;
  let _subCCBtn   = null;
  // CC button (1.13): only while its video is on the page and big enough; hides
  // after 5 s without mouse, touch or keys in full screen; drag it on a normal page
  // (the spot is remembered); Settings > Subtitles can switch it off.
  const CC_IDLE_MS = 5000;
  let _ccVideo = null, _ccIdleT = null, _ccWatchT = null;
  function _ccFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function _ccApplyPos(btn, pos) {
    if (!btn) return;
    if (_ccFs() || !pos) { btn.style.left = '3%'; btn.style.bottom = '68px'; return; }
    const l = Number(pos.left), b = Number(pos.bottom);
    if (Number.isFinite(l) && Number.isFinite(b)) {
      btn.style.left = Math.max(0, Math.min(94, l)) + '%';
      btn.style.bottom = Math.max(0, Math.min((window.innerHeight || 600) - 40, b)) + 'px';
    }
  }
  function _ccSetup(btn, video) {
    br.storage.local.get('subtitle_cc_pos').then(s => _ccApplyPos(btn, s.subtitle_cc_pos)).catch(() => {});
    const show = () => {
      if (!btn.isConnected) return;
      btn.style.visibility = 'visible';
      clearTimeout(_ccIdleT);
      if (_ccFs()) _ccIdleT = setTimeout(() => { if (_ccFs()) btn.style.visibility = 'hidden'; }, CC_IDLE_MS);
    };
    if (window._ssCCWake) for (const ev of ['mousemove', 'touchstart', 'keydown']) document.removeEventListener(ev, window._ssCCWake, true);
    window._ssCCWake = throttle(show, 250);
    window._ssCCShow = show;
    for (const ev of ['mousemove', 'touchstart', 'keydown']) document.addEventListener(ev, window._ssCCWake, { capture: true, passive: true });
    let drag = null;
    btn.addEventListener('pointerdown', e => {
      if (_ccFs() || e.button !== 0) return;
      const r = btn.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, b: (window.innerHeight || 0) - r.bottom, moved: false };
      try { btn.setPointerCapture(e.pointerId); } catch { /* ok */ }
    });
    btn.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      btn.style.left = Math.max(0, drag.l + dx) + 'px';
      btn.style.bottom = Math.max(0, drag.b - dy) + 'px';
    });
    btn.addEventListener('pointerup', () => {
      if (drag && drag.moved) {
        const r = btn.getBoundingClientRect();
        const pos = { left: Math.round(r.left / (window.innerWidth || 1) * 1000) / 10, bottom: Math.round((window.innerHeight || 0) - r.bottom) };
        _ccApplyPos(btn, pos);
        br.storage.local.set({ subtitle_cc_pos: pos }).catch(() => {});
        btn._ssDragged = Date.now();
      }
      drag = null;
    });
    clearInterval(_ccWatchT);
    _ccWatchT = setInterval(() => {
      if (!btn.isConnected) { clearInterval(_ccWatchT); return; }
      const r = video.isConnected ? video.getBoundingClientRect() : null;
      btn.style.display = r && r.width >= 120 && r.height >= 68 ? 'flex' : 'none';
    }, 1500);
    show();
  }

  // Subtitle look (Settings > Subtitles): colour, background, font, letter edge.
  // Edge styles as in TV caption settings (and CloudStream): outline, drop
  // shadow, raised, none. Before 1.13 there was only an outline on/off switch
  // (subtitle_outline); it still decides when no edge is saved.
  let _subStyle = { color: '#ffffff', bg: 38, font: 'sans', outline: true, edge: null, weight: 'bold' };
  const SUB_FONTS = {
    sans: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    mono: 'ui-monospace,Consolas,"Courier New",monospace',
    rounded: 'ui-rounded,"SF Pro Rounded","Nunito","Varela Round","Arial Rounded MT Bold",system-ui,sans-serif',
    casual: '"Comic Neue","Comic Sans MS","Chalkboard SE","Segoe Print",cursive,sans-serif',
    condensed: '"Roboto Condensed","Arial Narrow","Sofia Sans Condensed","Helvetica Neue",sans-serif',
    smallcaps: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    netflix: '"Netflix Sans","Helvetica Neue",Helvetica,Arial,sans-serif',
    prime: '"Amazon Ember","Segoe UI","Helvetica Neue",Arial,sans-serif',
  };
  const SUB_EDGES = {
    outline: '0 2px 8px rgba(0,0,0,0.7), 0 0 3px rgba(0,0,0,0.9), 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
    shadow: '2px 2px 3px rgba(0,0,0,0.95), 3px 3px 6px rgba(0,0,0,0.6)',
    raised: '-1px -1px 0 rgba(255,255,255,0.45), 1px 1px 0 rgba(0,0,0,0.95), 2px 2px 0 rgba(0,0,0,0.6)',
    depressed: '1px 1px 0 rgba(255,255,255,0.45), -1px -1px 0 rgba(0,0,0,0.95), -2px -2px 0 rgba(0,0,0,0.6)',
    glow: '0 0 4px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.6)',
    none: 'none',
  };
  function _subEdge(st) {
    const e = st && st.edge;
    if (typeof e === 'string' && Object.prototype.hasOwnProperty.call(SUB_EDGES, e)) return e;
    return st && st.outline === false ? 'none' : 'outline';
  }
  function _subLook(st) {
    const color = /^#[0-9a-f]{6}$/i.test(String(st && st.color)) ? st.color : '#ffffff';
    const bgN = Number(st && st.bg);
    const bg = Number.isFinite(bgN) ? Math.max(0, Math.min(90, bgN)) / 100 : 0.38;
    return {
      color, fontFamily: SUB_FONTS[st && st.font] || SUB_FONTS.sans, background: 'rgba(0,0,0,' + bg + ')',
      textShadow: SUB_EDGES[_subEdge(st)],
      fontWeight: st && st.weight === 'regular' ? '500' : '700',
      fontVariant: st && st.font === 'smallcaps' ? 'small-caps' : 'normal',
    };
  }
  function _applySubStyle(el) { if (el) Object.assign(el.style, _subLook(_subStyle)); }

  // The sync offset is remembered per film or show (same IMDb id), since each
  // release is off by its own amount. Shows without a saved offset use the last one.
  async function _showOffset(id) {
    if (!id) return null;
    try { const m = (await br.storage.local.get('subtitle_offsets')).subtitle_offsets || {}; const v = Number(m[id]); return Number.isFinite(v) ? v : null; } catch { return null; }
  }
  async function _saveShowOffset(id, v) {
    if (!id || !Number.isFinite(v)) return;
    try {
      const m = (await br.storage.local.get('subtitle_offsets')).subtitle_offsets || {};
      delete m[id]; m[id] = v;
      const keys = Object.keys(m); while (keys.length > 200) delete m[keys.shift()];
      await br.storage.local.set({ subtitle_offsets: m });
    } catch { /* ok */ }
  }

  async function loadSubPrefs() {
    try {
      const st = await br.storage.local.get(['subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'subtitle_edge', 'subtitle_weight']);
      if (st.subtitle_color)               _subStyle.color   = st.subtitle_color;
      if (st.subtitle_bg !== undefined)    _subStyle.bg      = Number(st.subtitle_bg);
      if (st.subtitle_font)                _subStyle.font    = st.subtitle_font;
      if (st.subtitle_outline !== undefined) _subStyle.outline = !!st.subtitle_outline;
      if (st.subtitle_edge)                _subStyle.edge    = st.subtitle_edge;
      if (st.subtitle_weight)              _subStyle.weight  = st.subtitle_weight;
    } catch { /* defaults ok */ }
    try {
      const s = await br.storage.local.get(['subtitle_enabled','subtitle_language','subtitle_font_size','subtitle_sync','subtitle_drag_pos']);
      if (s.subtitle_enabled !== undefined) _subState.enabled  = !!s.subtitle_enabled;
      if (s.subtitle_language)              _subState.language  = s.subtitle_language;
      if (s.subtitle_font_size)             _subState.fontSize  = parseInt(s.subtitle_font_size) || 18;
      if (s.subtitle_sync     !== undefined) _subState.sync     = parseFloat(s.subtitle_sync) || 0;
      if (s.subtitle_drag_pos) _subState.dragPos = s.subtitle_drag_pos;
    } catch { /* defaults ok */ }
  }

  function parseSubs(raw) {
    if (!raw) return [];
    raw = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n/, '');
    const result = [];
    for (const blk of raw.split(/\n{2,}/)) {
      const lines = blk.trim().split(/\r?\n/);
      const arrow = lines.findIndex(l => l.includes('-->'));
      if (arrow < 0) continue;
      const [sStr, eStr] = lines[arrow].split('-->').map(s => s.trim());
      const ts = str => { const m = str.match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})(?!\d)/); return m ? (+(m[1]||0))*3600 + +m[2]*60 + +m[3] + +(m[4].padEnd(3, '0'))/1000 : NaN; };
      const start = ts(sStr), end = ts(eStr);
      if (isNaN(start) || isNaN(end) || start >= end) continue;
      const text = lines.slice(arrow + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
      if (text) result.push({ start, end, text });
    }
    return result;
  }

  function subContainer(video) {
    return document.fullscreenElement || document.webkitFullscreenElement || document.body;
  }

  function positionSub(el, video) {
    if (!video.isConnected) return;
    const r    = video.getBoundingClientRect();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    el.style.position  = fsEl ? 'absolute' : 'fixed';

    const savedDragPos = _subState.dragPos && typeof _subState.dragPos === 'object' ? _subState.dragPos : null;
    const xPos = savedDragPos?.x ?? 50;
    const bottomPos = savedDragPos?.bottom ?? _subState.position;
    const safeBottom = Number.isFinite(bottomPos) ? Math.min(60, Math.max(2, bottomPos)) : 12;

    if (fsEl) {
      el.style.left   = (xPos) + '%';
      el.style.bottom = (safeBottom) + '%';
      el.style.transform = 'translateX(-50%)';
    } else {
      el.style.left   = (r.left + r.width * xPos / 100) + 'px';
      el.style.bottom = (window.innerHeight - r.bottom + r.height * safeBottom / 100) + 'px';
      el.style.transform = 'translateX(-50%)';
    }

    const scale = Math.max(0.6, Math.min(2.0, r.width / 640));
    el.style.fontSize  = Math.max(10, Math.min(60, _subState.fontSize * scale)) + 'px';
  }

  function ensureSubOverlay(video) {
    if (_subOverlay?.isConnected) return _subOverlay;
    if (_subOverlay) _subOverlay.remove();
    const el = document.createElement('div');
    el.id = 'skipstream-subs';
    Object.assign(el.style, {
      zIndex:'2147483645', fontFamily:'system-ui,-apple-system,sans-serif', fontWeight:'700',
      color:'#fff', textShadow:'0 2px 8px rgba(0,0,0,0.7), 0 0 3px rgba(0,0,0,0.9)', textAlign:'center',
      pointerEvents:'auto', userSelect:'none', maxWidth:'80%', lineHeight:'1.4',
      cursor:'grab', whiteSpace:'pre-wrap', display:'none',
      padding:'3px 10px', borderRadius:'4px', background:'rgba(0,0,0,0.38)',
    });
    subContainer(video).appendChild(el);
    _subOverlay = el;
    _applySubStyle(el);

    // Drag: full x/y control with pointer capture
    let drag = false, sx = 0, sy = 0, sp = { x: _subState.dragPos?.x ?? 50, bottom: _subState.dragPos?.bottom ?? _subState.position };
    el.addEventListener('pointerdown', e => { 
      if (e.pointerType === 'touch' || e.pointerType === 'pen') e.preventDefault();
      drag = true; sx = e.clientX; sy = e.clientY; 
      sp = { x: _subState.dragPos?.x ?? 50, bottom: _subState.dragPos?.bottom ?? _subState.position };
      el.style.cursor = 'grabbing'; 
      el.setPointerCapture(e.pointerId); 
    });
    
    el.addEventListener('pointermove', e => { 
      if (!drag) return; 
      const r = video.getBoundingClientRect();
      const vw = r.width;
      const vh = r.height;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      
      if (fsEl) {
        // In fullscreen: move by viewport %
        const dxPx = e.clientX - sx;
        const dyPx = e.clientY - sy;
        _subState.dragPos = _subState.dragPos || { x: sp.x, bottom: sp.bottom };
        _subState.dragPos.x = Math.max(5, Math.min(95, sp.x + (dxPx / window.innerWidth * 100)));
        _subState.dragPos.bottom = Math.max(2, Math.min(60, sp.bottom - (dyPx / window.innerHeight * 100)));
      } else {
        // Normal: move by video %
        const dxPx = e.clientX - sx;
        const dyPx = e.clientY - sy;
        _subState.dragPos = _subState.dragPos || { x: sp.x, bottom: sp.bottom };
        _subState.dragPos.x = Math.max(5, Math.min(95, sp.x + (dxPx / vw * 100)));
        _subState.dragPos.bottom = Math.max(2, Math.min(60, sp.bottom - (dyPx / vh * 100)));
      }
      positionSub(el, video);
    });
    
    el.addEventListener('pointerup', e => { 
      drag = false; 
      el.style.cursor = 'grab'; 
      el.releasePointerCapture(e.pointerId);
      br.storage.local.set({ subtitle_drag_pos: _subState.dragPos }).catch(() => {});
    });

    // Fullscreen: move overlay into/out of fullscreen container
    const onFs = () => {
      if (!_subOverlay?.isConnected) return;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const newContainer = fsEl || document.body;
      if (_subOverlay.parentElement !== newContainer) {
        newContainer.appendChild(_subOverlay);
      }
      positionSub(_subOverlay, video);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    
    // ResizeObserver: reposition on video resize
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObs = new ResizeObserver(() => positionSub(el, video));
      try { resizeObs.observe(video); } catch { /* ok */ }
    }
    
    return el;
  }

  function renderSubFrame(video) {
    if (!_subOverlay || !_subState.enabled || !_subState.subs.length) {
      if (_subOverlay) _subOverlay.style.display = 'none';
      return;
    }
    const t = video.currentTime + _subState.sync;
    const sub = _subState.subs.find(s => t >= s.start && t <= s.end);
    _subOverlay.textContent = sub?.text || '';
    _subOverlay.style.display = sub?.text ? 'block' : 'none';
    if (sub) positionSub(_subOverlay, video);
  }

  function syncCCBtn() {
    if (!_subCCBtn) return;
    const hasText = _subState.subs.length > 0;
    const loading = _subState.loading;
    _subCCBtn.querySelector('.cc-lbl').textContent = loading ? '…' : 'CC';
    const on = hasText && _subState.enabled;
    const p = pal();
    _subCCBtn.style.opacity = hasText ? '1' : '0.55';
    _subCCBtn.style.background = on ? p.accent : p.bg;
    _subCCBtn.style.color = on ? p.onAccent : p.muted;
    _subCCBtn.style.borderColor = on ? 'transparent' : p.edge;
  }

  function ensureCCBtn(video) {
    _ccVideo = video;
    if (prefs.ccButton === 'off') { if (_subCCBtn) { _subCCBtn.remove(); _subCCBtn = null; } clearInterval(_ccWatchT); return null; }
    if (_subCCBtn?.isConnected) return _subCCBtn;
    if (_subCCBtn) _subCCBtn.remove();
    const btn = document.createElement('button');
    btn.id = 'skipstream-cc-btn';
    btn.replaceChildren();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 16 11');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '1');
    rect.setAttribute('y', '1');
    rect.setAttribute('width', '14');
    rect.setAttribute('height', '9');
    rect.setAttribute('rx', '1.5');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 7h3M9 7h3');
    svg.appendChild(rect);
    svg.appendChild(path);
    const lbl = document.createElement('span');
    lbl.className = 'cc-lbl';
    lbl.textContent = 'CC';
    btn.appendChild(svg);
    btn.appendChild(lbl);
    const p = pal();
    Object.assign(btn.style, {
      all:'unset', boxSizing:'border-box',
      position:(document.fullscreenElement||document.webkitFullscreenElement)?'absolute':'fixed',
      bottom:'68px', left:'3%', zIndex:'2147483646',
      display:'flex', alignItems:'center', gap:'6px', padding:'8px 12px',
      background: p.bg, color: p.muted,
      border:'1px solid ' + p.edge, borderRadius:'10px',
      cursor:'pointer', fontSize:'12px', fontWeight:'600',
      fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
      transition:'opacity 150ms cubic-bezier(.22,1,.36,1), transform 110ms cubic-bezier(.22,1,.36,1)',
      pointerEvents:'auto',
    });
    btn.onmousedown = () => { btn.style.transform = 'scale(.95)'; };
    btn.onmouseup = () => { btn.style.transform = 'scale(1)'; };
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (btn._ssDragged && Date.now() - btn._ssDragged < 400) return;   // the end of a drag is not a click
      if (!_subState.subs || _subState.subs.length === 0) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.srt,.vtt';
        inp.style.display = 'none';
        document.documentElement.appendChild(inp);
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) { inp.remove(); return; }
          f.text().then(t => br.storage.local.set({ subtitle_override_srt: t }))
           .catch(() => { console.warn('[SkipStream] subtitle file unreadable'); })
           .then(() => inp.remove());
        });
        inp.click();
        return;
      }
      _subState.enabled = !_subState.enabled;
      br.storage.local.set({ subtitle_enabled: _subState.enabled }).catch(() => {});
      renderSubFrame(video); syncCCBtn();
    });
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      const v = prompt('Subtitle sync offset (seconds, e.g. -1.5):', String(_subState.sync));
      if (v !== null && !isNaN(parseFloat(v))) {
        _subState.sync = parseFloat(v);
        br.storage.local.set({ subtitle_sync: _subState.sync }).catch(() => {});
        _saveShowOffset(_subLastInfo && _subLastInfo.imdbId, _subState.sync);
      }
    });
    subContainer(video).appendChild(btn);
    _subCCBtn = btn;
    _ccSetup(btn, video);
    const onFs = () => {
      if (!_subCCBtn?.isConnected) return;
      _subCCBtn.style.position = _ccFs() ? 'absolute' : 'fixed';
      subContainer(video).appendChild(_subCCBtn);
      br.storage.local.get('subtitle_cc_pos').then(s => _ccApplyPos(_subCCBtn, s.subtitle_cc_pos)).catch(() => {});
      if (window._ssCCShow) window._ssCCShow();
    };
    if (window._ssCCFsHandler) {
      document.removeEventListener('fullscreenchange', window._ssCCFsHandler);
      document.removeEventListener('webkitfullscreenchange', window._ssCCFsHandler);
    }
    window._ssCCFsHandler = onFs;
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return btn;
  }

  let _subLastInfo = null;
  async function initSubtitles(video, info) {
    await loadSubPrefs();
    ensureCCBtn(video);
    ensureSubOverlay(video);

    // Offline override: user-uploaded .srt takes priority
    try {
      const s = await br.storage.local.get('subtitle_override_srt');
      if (s.subtitle_override_srt) {
        _subState.subs = parseSubs(s.subtitle_override_srt);
        _subState.source = 'override';
        _diag.subs = 'your file';
        syncCCBtn();
        return;
      }
    } catch { /* ok */ }

    if (!info?.imdbId) { syncCCBtn(); return; }
    _subLastInfo = info;
    const savedOffset = await _showOffset(info.imdbId);
    if (savedOffset !== null) _subState.sync = savedOffset;
    // Subtitles off = nothing is sent to OpenSubtitles (no quota, no viewing data).
    if (!_subState.enabled) { syncCCBtn(); return; }

    _subState.loading = true; syncCCBtn();
    const reqHref = location.href;
    try {
      const result = await br.runtime.sendMessage({
        type: 'OSUB_SEARCH_AND_FETCH',
        imdbId: info.imdbId, season: info.season || null,
        episode: info.episode || null, language: _subState.language,
      });
      // A late answer for the previous episode must not land on this one.
      if (location.href === reqHref && result?.ok && result.text) {
        _subState.subs = parseSubs(result.text);
        _subState.source = 'osub';
      }
      _diag.subs = _subState.subs.length ? 'OpenSubtitles, ' + _subState.subs.length + ' lines' : 'none (' + String(result?.err || 'no answer').slice(0, 60) + ')';
    } catch { /* subtitle fetch failed, extension still works */ }
    _subState.loading = false; syncCCBtn();
  }

  // Popup "Find subtitles for this video": fetch now, even if subtitles were off,
  // and report why when nothing loads.
  async function fetchSubsNow() {
    const video = _subVideo;
    const info = await resolveShowInfo().catch(() => null);
    const yt = !!_youtubeVideoId() || _hostIs(_siteHost(), 'youtube.com');
    // No id: search OpenSubtitles by the cleaned title (this button only, never automatic).
    const byName = !info?.imdbId && !yt ? (info?.title || getVideoTitle() || '').trim() : '';
    if (!info?.imdbId && !byName) return { ok: false, reason: yt ? 'youtube' : 'no_id' };
    if (info?.imdbId) _subLastInfo = info;
    _subState.loading = true; syncCCBtn();
    if (!_subState.enabled) { _subState.enabled = true; br.storage.local.set({ subtitle_enabled: true }).catch(() => {}); }
    const reqHref = location.href;
    let result = null;
    try {
      result = await br.runtime.sendMessage({
        type: 'OSUB_SEARCH_AND_FETCH',
        imdbId: info?.imdbId || null, query: info?.imdbId ? null : byName, year: info?.year || null,
        season: info?.season || null, episode: info?.episode || null, language: _subState.language,
      });
    } catch { result = null; }
    _subState.loading = false;
    if (location.href !== reqHref) { syncCCBtn(); return { ok: false, reason: 'navigated' }; }
    if (!result?.ok || !result.text) { _diag.subs = 'none (' + String(result?.err || 'no answer').slice(0, 60) + ')'; syncCCBtn(); return { ok: false, reason: result?.err || 'no_answer' }; }
    const subs = parseSubs(result.text);
    if (!subs.length) { syncCCBtn(); return { ok: false, reason: 'unreadable' }; }
    _subState.subs = subs; _subState.source = 'osub';
    _diag.subs = 'OpenSubtitles, ' + subs.length + ' lines';
    syncCCBtn();
    if (video) renderSubFrame(video);
    return { ok: true, count: subs.length, name: result.name || '' };
  }

  // Listen for subtitle file uploaded from popup/options, or any settings change
  br.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('subtitle_override_srt' in changes) {
      const raw = changes.subtitle_override_srt.newValue;
      _subState.subs = raw ? parseSubs(raw) : [];
      syncCCBtn();
      if (_subVideo) renderSubFrame(_subVideo);
    }
    if ('subtitle_enabled' in changes) {
      _subState.enabled = !!changes.subtitle_enabled.newValue;
      if (_subState.enabled && !_subState.subs.length && !_subState.loading && _subVideo && _subLastInfo) {
        initSubtitles(_subVideo, _subLastInfo).catch(() => {});
      }
      syncCCBtn();
      if (_subVideo) renderSubFrame(_subVideo);
    }
    if ('subtitle_language' in changes) {
      _subState.language = changes.subtitle_language.newValue || 'en';
    }
    if ('subtitle_font_size' in changes) {
      _subState.fontSize = parseInt(changes.subtitle_font_size.newValue) || 18;
      if (_subOverlay && _subVideo) positionSub(_subOverlay, _subVideo);
    }
    if ('subtitle_sync' in changes) {
      _subState.sync = parseFloat(changes.subtitle_sync.newValue) || 0;
      if (_subVideo) renderSubFrame(_subVideo);
    }
    let restyle = false;
    if ('subtitle_color' in changes)   { _subStyle.color = changes.subtitle_color.newValue || '#ffffff'; restyle = true; }
    if ('subtitle_bg' in changes)      { _subStyle.bg = Number(changes.subtitle_bg.newValue); restyle = true; }
    if ('subtitle_font' in changes)    { _subStyle.font = changes.subtitle_font.newValue || 'sans'; restyle = true; }
    if ('subtitle_outline' in changes) { _subStyle.outline = changes.subtitle_outline.newValue !== false; restyle = true; }
    if ('subtitle_edge' in changes)    { _subStyle.edge = changes.subtitle_edge.newValue || null; restyle = true; }
    if ('subtitle_weight' in changes)  { _subStyle.weight = changes.subtitle_weight.newValue || 'bold'; restyle = true; }
    if ('ccButton' in changes) { prefs.ccButton = changes.ccButton.newValue; if (prefs.ccButton === 'off') ensureCCBtn(_ccVideo); else if (_ccVideo && _ccVideo.isConnected) { ensureCCBtn(_ccVideo); syncCCBtn(); } }
    if (restyle) _applySubStyle(_subOverlay);
    if ('showTimeline' in changes && _tlVideo) { if (changes.showTimeline.newValue === false) { if (_tlBox) { _tlBox.remove(); _tlBox = null; } } else if (_tlSegs) _renderTimeline(_tlVideo, _tlSegs); }
    if ('subtitle_drag_pos' in changes) {
      _subState.dragPos = changes.subtitle_drag_pos.newValue || { x: 50, bottom: 10 };
      if (_subOverlay && _subVideo) positionSub(_subOverlay, _subVideo);
    }
  });

  let _subVideo = null;

  // ── Video attachment ───────────────────────────────────────────────────────

  const attachedVideos = new WeakSet();

  // Some players keep their <video> inside their own component (an open shadow
  // root), where document.querySelectorAll cannot see it. onRoot, if given, is
  // called once per shadow root found so the caller can watch it.
  function _shadowVideos(root, depth, out, maxDepth, onRoot) {
    if (depth > maxDepth || out.length >= 20) return out;
    for (const el of root.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      if (onRoot) onRoot(sr);
      sr.querySelectorAll('video').forEach(v => out.push(v));
      _shadowVideos(sr, depth + 1, out, maxDepth, onRoot);
    }
    return out;
  }

  function isMainPlayer(video) {
    const vw = window.innerWidth  || 800;
    const vh = window.innerHeight || 600;
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (rect.width  < vw * 0.25) return false;
    if (rect.height < vh * 0.20) return false;
    const ar = rect.width / rect.height;
    if (ar > 3.0) return false;
    // H4: portrait / square (Shorts, phone streams) only when the player is tall,
    // so grid thumbnails stay out.
    if (ar < 1.2 && rect.height < vh * 0.5) return false;
    const cs = window.getComputedStyle(video);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  async function attachVideo(video) {
    if (attachedVideos.has(video)) return;

    const ready = isMainPlayer(video);
    if (ready === null) {
      video.addEventListener('loadedmetadata', () => attachVideo(video), { once: true });
    }
    if (!ready) {
      // H5: hidden / not laid out yet. Look again when it actually plays.
      video.addEventListener('playing', () => attachVideo(video), { once: true });
      return;
    }

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
      renderSubFrame(video);
    });

    // Event-based saves for pause / seek / unload
    video.addEventListener('pause',  () => { savePlayback(video, saveTimer, true); });
    // Phones: switching app or tab often never fires pagehide. Send the position now.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && video.isConnected) savePlayback(video, saveTimer, true);
    });
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
    _serialStats(() => br.storage.local.get('skipstream_stats').then(s => {
      const st = s.skipstream_stats || { skipsTotal: 0, timeSavedSec: 0, sessionsTotal: 0 };
      st.sessionsTotal = (Number(st.sessionsTotal) || 0) + 1;
      return br.storage.local.set({ skipstream_stats: st });
    }).catch(() => {}));

    // ── Segment resolution ──
    let segments = null;
    let resolved = false;
    let activeSegmentKey = '';
    let _vidHref = location.href;   // per-video: every video sees a URL change
    let _segGen = 0;                // bumps on URL change; stale fetches are dropped
    let _resolving = false;

    async function resolveSegments() {
      if (resolved || _resolving) return;
      _resolving = true;
      const gen = _segGen;
      try { await _resolveSegmentsOnce(gen); } finally { _resolving = false; }
    }

    async function _resolveSegmentsOnce(gen) {
      await _sitePrefsReady;
      const info = await resolveShowInfo();
      if (gen !== _segGen) return;
      _diag.id = _youtubeVideoId() ? 'YouTube video'
        : info.imdbId ? info.imdbId + (info.season && info.episode ? ' S' + info.season + 'E' + info.episode : info.tmdbKind === 'tv' ? ' (show, no episode)' : ' (movie)') + (info.byTitle ? ', matched by title' : '')
        : 'not identified' + (info.title ? ' (title "' + String(info.title).slice(0, 60) + '")' : '');

      // Init subtitles for any identified content (movies + TV), not just skippable episodes
      if (!_subState.subs.length && !_subState.loading) {
        _subVideo = video;
        initSubtitles(video, info).catch(() => {});
      }

      // YouTube -> SponsorBlock (keyed by video id, never by IMDb id).
      // Episode -> IntroDB/Anime-Skip. IMDb id with no season/episode -> movie
      // (IntroDB end credits). Anything else: nothing to look up.
      const ytId = _youtubeVideoId();
      let fetched = null;
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : 0;
      const anime = !!info.malId || _animeSite();
      const extra = { tmdbId: info.tmdbId, malId: info.malId, anime, title: anime ? (info.title || info.ldName || getVideoTitle()) : '', durationSec: dur };
      const ids = info.imdbId || info.tmdbId;
      if (ytId) {
        fetched = _sbFitDuration(await fetchSegments('yt/' + ytId, 0, 0), video);
      } else if (ids && info.season && info.episode) {
        fetched = await fetchSegments(info.imdbId, info.season, info.episode, false, extra);
      } else if (ids && !info.season && !info.episode && info.tmdbKind !== 'tv' && !anime) {
        // A show page without S/E is not a movie: nothing to look up yet.
        fetched = await fetchSegments(info.imdbId, 0, 0, true, extra);
      } else if (anime && info.episode) {
        fetched = await fetchSegments(info.imdbId, info.season || 1, info.episode, false, extra);
      }
      if (!fetched && !ytId) { fetched = _pageChapters(video); _diagChapters = fetched; }
      if (!fetched && !ytId && !ids && !(anime && info.episode)) {
        _diag.segs = 'nothing to look up';
        return;
      }
      if (gen !== _segGen) return;
      _diag.segs = fetched ? _diagSegs(fetched, ytId ? 'SponsorBlock' : '') : 'none found (yet)';
      if (fetched) {
        resolved = true;
        segments = fetched;
        _renderTimeline(video, segments);
      }
      // else resolved stays false so the timed retries can try again
    }

    video.addEventListener('loadedmetadata', resolveSegments);
    if (video.readyState >= 1) resolveSegments();
    [2000, 5000, 10000, 20000].forEach(ms => setTimeout(() => { if (!resolved) resolveSegments(); }, ms));

    // Start native platform button poller (skip intro buttons, next episode)
    startNativeBtnPoller(video);
    startNativeSkipObserver(video);

    // ── Skip detection: timeupdate event + throttle (replaces 500ms polling) ──
    
    // Segment check logic - called on timeupdate
    const checkSkipSegments = () => {
      if (location.href !== _vidHref) {
        // Same <video>, new title (YouTube next, next episode): start over.
        _vidHref = location.href;
        _segGen++;
        segments = null;
        resolved = false;
        activeSegmentKey = '';
        hideSkipBtn();
        _clearTimeline();
        video._ssPoiShown = false;
        if (video._ssMutedUntil) { video.muted = false; video._ssMutedUntil = 0; }
        _promptedVideos.delete(video);
        if (_subState.source === 'osub') { _subState.subs = []; _subState.source = null; renderSubFrame(video); syncCCBtn(); }
        const resumeOnce = () => { restorePlayback(video).catch(() => {}); };
        video.addEventListener('loadedmetadata', resumeOnce, { once: true });
        setTimeout(() => { video.removeEventListener('loadedmetadata', resumeOnce); resumeOnce(); }, 2500);
        resolveSegments();
        [1500, 5000, 12000].forEach(ms => setTimeout(() => { if (!resolved) resolveSegments(); }, ms));
        if (_skipBtnObserver) { _skipBtnObserver.disconnect(); _skipBtnObserver = null; }
        startNativeSkipObserver(video);
        startNativeBtnPoller(video);
        br.storage.local.get('playbackSpeed').then(s => {
          const rate = parseFloat(s.playbackSpeed) || 1;
          if (rate !== 1 && video && video.isConnected) video.playbackRate = rate;
        }).catch(() => {});
        return;
      }
      if (!video.isConnected) return;
      if (_ytAdShowing()) return;
      if (segments) _tlKeep();
      if (video.paused || !segments) return;
      if (video._ssCooldownUntil && Date.now() < video._ssCooldownUntil) return;

      const effectivePrefs = getSitePrefs(prefs); _ssEffPrefs = effectivePrefs;
      if (!effectivePrefs.skipEnabled) {
        if (activeSegmentKey) { activeSegmentKey = ''; hideSkipBtn(); }
        return;
      }

      const yt = !!_youtubeVideoId();
      // Muted by a "mute" segment: give the sound back once it is over.
      if (video._ssMutedUntil && (video.currentTime >= video._ssMutedUntil || video.currentTime < (video._ssMutedFrom || 0) - 1)) {
        video.muted = false; video._ssMutedUntil = 0;
      }
      let active = findActiveSegment(segments, video.currentTime);
      if (active && _segMode(active.key, effectivePrefs, yt) === 'off') active = null;
      if (active && video._ssCooldownUntil && Date.now() < video._ssCooldownUntil) return;
      if (active && _skipUndone(video, active.key, video.currentTime, getMediaId())) return;

      // SponsorBlock highlight: offer "Jump to highlight" in the first minute.
      const poi = Array.isArray(segments.poi_highlight) ? segments.poi_highlight[0] : null;
      if (!active && poi && !video._ssPoiShown && video.currentTime < 60 && video.currentTime < Number(poi.start_sec) - 3) {
        video._ssPoiShown = true;
        activeSegmentKey = 'poi';
        showSkipBtn('⤼ Jump to highlight', () => {
          video.currentTime = Number(poi.start_sec);
          _diag.last = { key: 'highlight', at: Date.now(), auto: false, notice: false, undone: false };
          activeSegmentKey = '';
          hideSkipBtn();
        });
        setTimeout(() => { if (activeSegmentKey === 'poi') { activeSegmentKey = ''; hideSkipBtn(); } }, 8000);
        return;
      }
      // A real segment beats the highlight offer.
      if (activeSegmentKey === 'poi') { if (!active) return; activeSegmentKey = ''; hideSkipBtn(); }

      if (active) {
        const mode = _segMode(active.key, effectivePrefs, yt);
        // The 2 s lead is for showing the button; an automatic skip waits for the
        // real start so no content before a sponsor/intro is lost.
        if (mode === 'auto' && video.currentTime < Number(active.segment.start_sec) - 0.3) return;
        // "Mute" segments (SponsorBlock): automatic mode mutes instead of jumping.
        if (mode === 'auto' && active.segment.action === 'mute') {
          if (!video._ssMutedUntil && !video.muted) {
            video.muted = true; video._ssMutedFrom = Number(active.segment.start_sec); video._ssMutedUntil = Number(active.segment.end_sec);
            _diag.last = { key: active.key + ' (muted)', at: Date.now(), auto: true, notice: true, undone: false };
          }
          return;
        }
        if (active.key !== activeSegmentKey) {
          activeSegmentKey = active.key;
          if (mode === 'auto') {
            showSkipCountdown(active.key, active.segment, video, () => {
              activeSegmentKey = '';
              hideSkipBtn();
            });
          } else {
            showSkipBtn(segmentLabel(active.key, active.segment), () => {
              const prevTime = video.currentTime;
              video.currentTime = active.segment.end_sec;
              video._ssCooldownUntil = Date.now() + 1500;
              recordSkipStat(active.segment.end_sec - prevTime);
              _diag.last = { key: active.key, at: Date.now(), auto: false, notice: false, undone: false };
              activeSegmentKey = '';
              hideSkipBtn();
            });
          }
        }
      } else if (!active && activeSegmentKey) {
        activeSegmentKey = '';
        hideSkipBtn();
      }
    };

    // Throttled check: fires at most once per 500ms on timeupdate
    const throttledCheckSkip = throttle(checkSkipSegments, 500);
    
    // Listen for timeupdate event (fires ~4x/sec during playback, 0x when paused)
    video.addEventListener('timeupdate', throttledCheckSkip);
    
    // Keyboard shortcuts: Alt+Right (skip segment), Alt+Z (undo/go back 15s)
    document.addEventListener('keydown', (e) => {
      if (!video || !video.isConnected) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      
      // Alt+Right: skip current segment manually
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (segments) {
          const hitSeg = findActiveSegment(segments, video.currentTime);
          if (hitSeg) {
            const _ssPrevT = video.currentTime;
            video.currentTime = hitSeg.segment.end_sec;
            video._ssCooldownUntil = Date.now() + 1500;
            recordSkipStat(hitSeg.segment.end_sec - _ssPrevT);
          }
        }
      }
      
      // Alt+Z: undo the last automatic skip (within 30 s), otherwise back 15 seconds
      if (e.altKey && (e.code === 'KeyZ' || String(e.key).toLowerCase() === 'z')) {
        e.preventDefault();
        const ls = video._ssLastSkip;
        if (ls && Date.now() - ls.at < 30000 && ls.media === getMediaId()) {
          video._ssUndone = { key: ls.key, until: ls.until, media: ls.media };
          video._ssLastSkip = null;
          if (_diag.last) _diag.last.undone = true;
          video.currentTime = ls.from;
        } else {
          video.currentTime = Math.max(0, video.currentTime - 15);
        }
      }
    });
    
    // Cleanup: remove listener when video is disconnected or on navigation
    // (existing observer/mutation handlers will call cleanup logic)
  }

  // ── Early-exit for iframes without video ────────────────────────────────────
  // Wrap main init logic in a function so iframes can skip if no video present

  function initSkipStream() {
    // ── DOM scanning + SPA navigation ─────────────────────────────────────────

    const _watchedShadows = new WeakSet();
    // The walk into player components looks at every element, so on busy pages
    // with no plain <video> (YouTube home, store grids) it runs at most every 2 s,
    // with one trailing run so a late player is still found.
    let _shadowAt = 0, _shadowTimer = null;
    function scanVideos() {
      const light = document.querySelectorAll('video');
      light.forEach(v => attachVideo(v));
      if (light.length) return;
      const wait = 2000 - (Date.now() - _shadowAt);
      if (wait > 0) {
        if (!_shadowTimer) _shadowTimer = setTimeout(() => { _shadowTimer = null; scanVideos(); }, wait);
        return;
      }
      _shadowAt = Date.now();
      _shadowVideos(document, 0, [], 6, sr => {
        if (_watchedShadows.has(sr)) return;
        _watchedShadows.add(sr);
        try { _domObserver.observe(sr, { childList: true, subtree: true }); } catch { /* ok */ }
      }).forEach(v => attachVideo(v));
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
      // ... existing navigation logic (lines 1445-1497) ...
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
    if (msg.type === 'SUBS_FETCH_NOW') {
      // Only the frame that owns the player answers; the others stay silent so it can.
      if (!_subVideo) return false;
      fetchSubsNow().then(sendResponse, () => sendResponse({ ok: false, reason: 'no_answer' }));
      return true;
    }
    if (msg.type === 'GET_SHOW_INFO') {
      resolveShowInfo().then(info => {
        sendResponse({ imdbId: info.imdbId, season: info.season, episode: info.episode, site: getSiteHostname(), title: getVideoTitle() });
      });
      return true;
    }
    return false;
  });

    // ── Boot ───────────────────────────────────────────────────────────────────
    // Boot: load prefs + scan, then async bulk-pull cloud positions into local cache
    _refreshTabInfo();
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
              url:       row.page_url || row.media_id,
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
  } // End initSkipStream()

  // ── Conditional init: an iframe starts once it has a video ──────────────────
  // Embedded players often create their <video> only after you pick a source or
  // press play. Up to 1.10 a frame gave up after 5 seconds and then never
  // skipped or answered the popup, so a player "worked sometimes". A frame now
  // keeps a cheap watch (DOM changes, play events, and a 2 s look inside player
  // components) until a video appears, then starts once.
  function _waitForVideo(doc, onFound, timers) {
    // Wrappers, not the bare functions: a browser timer called as a method of a
    // plain object (T.setInterval) throws "does not implement interface Window".
    // Up to 1.13 round 2 that stopped start-up in every player frame, so a frame
    // started only on a play event and "Check this page" said "did not finish".
    const T = timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id),
      setInterval: (f, ms) => setInterval(f, ms), clearInterval: (id) => clearInterval(id) };
    let done = false, pending = null, poll = null, obs = null;
    const has = () => !!doc.querySelector('video') || _shadowVideos(doc, 0, [], 4).length > 0;
    const fire = () => {
      if (done || !has()) return;
      done = true;
      if (obs) obs.disconnect();
      doc.removeEventListener('play', fire, true);
      if (pending) T.clearTimeout(pending);
      if (poll) T.clearInterval(poll);
      onFound();
    };
    obs = new MutationObserver(() => {
      if (pending || done) return;
      pending = T.setTimeout(() => { pending = null; fire(); }, 250);
    });
    obs.observe(doc.documentElement, { childList: true, subtree: true });
    doc.addEventListener('play', fire, true);
    poll = T.setInterval(fire, 2000);
    fire();
    return () => done;
  }

  let _ssStarted = false;
  const _ssStart = () => { if (_ssStarted) return; _ssStarted = true; initSkipStream(); };
  if (window === window.top) _ssStart();
  else _waitForVideo(document, _ssStart);

  // "intro 0:00-0:40 (TheIntroDB), outro 2:09:25-2:16:19 (SkipDB)": what was
  // found, when, and which source gave it, so a user can check it at the source.
  function _diagClock(sec) {
    const t = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = String(t % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }
  function _diagSegs(segs, fallbackSrc) {
    if (!segs || typeof segs !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(segs)) {
      if (k === 'full') { parts.push('whole video: ' + v); continue; }
      for (const sg of [].concat(v)) {
        if (!sg || typeof sg !== 'object') continue;
        const a = Number(sg.start_sec), b = Number(sg.end_sec);
        const when = Number.isFinite(a) ? ' ' + _diagClock(a) + (Number.isFinite(b) && b > a ? '-' + _diagClock(b) : '') : '';
        const src = sg.src || fallbackSrc || (segs === _diagChapters ? 'page chapters' : '');
        parts.push(k + when + (src ? ' (' + src + ')' : ''));
      }
    }
    return parts.slice(0, 12).join(', ');
  }
  function _diagLast(l, now) {
    if (!l) return '';
    const ago = Math.max(0, Math.round((now - l.at) / 1000));
    return l.key + ' ' + ago + ' s ago, ' + (l.auto ? 'automatic' : 'by you')
      + (l.auto ? (l.notice ? ', notice shown' : ', NO notice') : '') + (l.undone ? ', undone' : '');
  }
  function _diagAuto(p) {
    if (!p) return '';
    if (!p.skipEnabled) return 'skipping off';
    const on = [p.skipIntro && 'intros and sponsors', p.skipRecap && 'recaps', p.skipOutro && 'outros'].filter(Boolean);
    return on.length ? 'auto: ' + on.join(', ') : 'ask first (button)';
  }

  // "Check this page" in the popup: every frame reports what it sees, even one
  // still waiting for a video. Reports go to the background (local only).
  _ssBootDone = true;   // start-up reached the end (Check this page reports it)

})();