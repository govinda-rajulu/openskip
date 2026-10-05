/* SkipStream - site report probe. Injected on request only (popup "Site report"),
   into every frame. Reads the page, sends nothing anywhere: the result goes back
   to the popup, which shows it and lets you copy it. Addresses are cut to host +
   path (no query strings, which can hold tokens). Every list is capped (CAP).
   1.13 deep scan: source/server buttons, media and embed addresses the page has
   loaded, addresses in inline scripts, lazy frames, <track> files and (Firefox
   only) which player libraries the page itself has loaded. */
(() => {
  const cut = (u) => {
    try {
      const x = new URL(String(u || ''), location.href);
      if (x.protocol === 'blob:') return 'blob (stream built in the page)';
      if (x.protocol === 'data:') return 'data:';
      if (!/^https?:$/.test(x.protocol)) return x.protocol;
      return x.host + x.pathname.slice(0, 80);
    } catch { return String(u || '').slice(0, 40); }
  };
  const PLAYERS = [
    ['JW Player', '.jwplayer, .jw-wrapper'], ['Video.js', '.video-js'], ['Plyr', '.plyr'],
    ['Vidstack', 'media-player, media-provider'], ['Artplayer', '.art-video-player'], ['DPlayer', '.dplayer'],
    ['Shaka', '.shaka-video-container'], ['Flowplayer', '.flowplayer, .fp-engine'], ['MediaElement', '.mejs__container'],
    ['Fluid Player', '.fluid_video_wrapper'], ['Bitmovin', '.bitmovinplayer-container'], ['THEOplayer', '.theoplayer-container'],
    ['Clappr', '[data-player] .container, .clappr-player'], ['YouTube', '.html5-video-player'], ['Netflix', '.watch-video'],
  ];
  const LIB_RE = /(jwplayer|video\.?js|videojs|plyr|hls(?:\.light)?(?:\.min)?\.js|dash(?:\.all)?(?:\.min)?\.js|shaka|artplayer|dplayer|clappr|vidstack|flowplayer|bitmovin|theoplayer|mediaelement|fluidplayer|p2p-media-loader|mux)/i;
  const out = {
    frame: cut(location.href), top: window === window.top,
    skipstream: !!window.__skipstream_injected__,
    title: String(document.title || '').slice(0, 100),
    referrer: document.referrer ? cut(document.referrer) : '',
    players: [], libs: [], videos: [], iframes: [], ids: [],
    sources: [], loaded: [], inScripts: [], lazyFrames: [], trackFiles: [], globals: [],
  };
  const CAP = 30;
  const MEDIA_RE = /\.(?:m3u8|mpd|mp4|webm|mkv|vtt|srt|ass)(?:$|[?#])|\/(?:embed|e|v|player|play|stream|watch)\/|\/hls\/|\/dash\//i;
  const addTo = (list, seen, v) => { if (v && !seen.has(v) && list.length < CAP) { seen.add(v); list.push(v); } };
  try {
    for (const [name, sel] of PLAYERS) { try { if (document.querySelector(sel)) out.players.push(name); } catch { /* bad selector */ } }
    const libs = new Set();
    document.querySelectorAll('script[src]').forEach(s => { const m = String(s.getAttribute('src')).match(LIB_RE); if (m) libs.add(m[1].toLowerCase() + ' (' + cut(s.src).split('/')[0] + ')'); });
    out.libs = Array.from(libs).slice(0, 12);
    const vids = Array.from(document.querySelectorAll('video'));
    const walk = (root, depth) => { if (depth > 4) return; root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { el.shadowRoot.querySelectorAll('video').forEach(v => { v._ssInShadow = true; vids.push(v); }); walk(el.shadowRoot, depth + 1); } }); };
    if (!vids.length) walk(document, 0);
    for (const v of vids.slice(0, 6)) {
      const r = v.getBoundingClientRect();
      const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src) || '';
      const kind = /^blob:/.test(src) ? 'stream (HLS/DASH via script)' : /\.m3u8/i.test(src) ? 'HLS file' : /\.mpd/i.test(src) ? 'DASH file' : /\.(mp4|webm|mkv)/i.test(src) ? 'plain file' : src ? 'other' : 'no source yet';
      const tracks = [];
      try { for (const t of Array.from(v.textTracks || [])) tracks.push((t.kind || '') + ':' + (t.language || '?') + (t.label ? ' ' + String(t.label).slice(0, 20) : '') + ' ' + t.mode); } catch { /* ok */ }
      out.videos.push({
        size: Math.round(r.width) + 'x' + Math.round(r.height), source: cut(src), kind,
        duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
        playing: !v.paused, ready: v.readyState, muted: !!v.muted, inShadow: !!v._ssInShadow,
        tracks: tracks.slice(0, 8),
      });
    }
    document.querySelectorAll('iframe').forEach(f => {
      if (out.iframes.length >= 12) return;
      const r = f.getBoundingClientRect();
      const s = f.getAttribute('src');
      out.iframes.push({ src: s ? cut(f.src) : (f.hasAttribute('srcdoc') ? 'srcdoc' : 'about:blank'), size: Math.round(r.width) + 'x' + Math.round(r.height),
        sandbox: f.hasAttribute('sandbox') ? (f.getAttribute('sandbox') || 'all') : '', allow: String(f.getAttribute('allow') || '').slice(0, 60) });
    });
    const ids = new Set();
    const scan = (txt) => { const m = String(txt || '').match(/\btt\d{7,8}\b/g); if (m) m.slice(0, 3).forEach(x => ids.add('imdb ' + x)); };
    scan(location.href);
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => scan(s.textContent));
    document.querySelectorAll('[data-tmdb],[data-tmdb-id],[data-imdb],[data-imdb-id],[data-season],[data-episode]').forEach(el => {
      for (const a of ['data-tmdb', 'data-tmdb-id', 'data-imdb', 'data-imdb-id', 'data-season', 'data-episode']) { const v = el.getAttribute(a); if (v && ids.size < 10) ids.add(a.replace('data-', '') + ' ' + String(v).slice(0, 20)); }
    });
    const og = document.querySelector('meta[property="og:type"]'); if (og) ids.add('og:type ' + String(og.getAttribute('content')).slice(0, 20));
    out.ids = Array.from(ids).slice(0, 10);
  } catch (e) { out.error = String(e).slice(0, 80); }
  // Deep scan. Each part has its own try, so one failure keeps the others.
  try {
    // Source / server buttons: data-* addresses, embed links, onclick addresses.
    const seen = new Set();
    const label = (el) => String(el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const ATTRS = ['data-link', 'data-src', 'data-url', 'data-embed', 'data-server', 'data-video', 'data-file'];
    document.querySelectorAll(ATTRS.map(a => '[' + a + ']:not(iframe):not(img):not(script)').join(',')).forEach(el => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || v.length > 2000) continue;
        const looksUrl = /^(?:https?:)?\/\//i.test(v) || v.startsWith('/');
        addTo(out.sources, seen, (label(el) || a) + ' -> ' + (looksUrl ? cut(v) : a + ' "' + v.slice(0, 24) + '"'));
      }
    });
    document.querySelectorAll('a[href*="embed"]').forEach(a => addTo(out.sources, seen, (label(a) || 'link') + ' -> ' + cut(a.getAttribute('href'))));
    document.querySelectorAll('[onclick]').forEach(el => {
      const m = String(el.getAttribute('onclick') || '').slice(0, 2000).match(/(?:https?:)?\/\/[^\s'"`)]+|\/(?:embed|e|player|play)\/[^\s'"`)]+/i);
      if (m) addTo(out.sources, seen, (label(el) || 'onclick') + ' -> ' + cut(m[0]));
    });
  } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'sources: ' + String(e).slice(0, 60); }
  try {
    // Addresses the page has loaded (media, players, subtitles), from the browser's timing list.
    const seen = new Set();
    const list = (typeof performance !== 'undefined' && performance.getEntriesByType) ? performance.getEntriesByType('resource') : [];
    for (const r of list) {
      if (out.loaded.length >= CAP) break;
      const n = String(r && r.name || '');
      if (!/^https?:/i.test(n) || !(MEDIA_RE.test(n) || /^(?:video|audio|track)$/.test(String(r.initiatorType || '')))) continue;
      addTo(out.loaded, seen, cut(n) + (r.initiatorType && r.initiatorType !== 'other' ? ' (' + r.initiatorType + ')' : ''));
    }
  } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'loaded: ' + String(e).slice(0, 60); }
  try {
    // Media and embed addresses written in the page's own scripts.
    const seen = new Set();
    const URL_RE = /https?:\/\/[^\s'"`<>\\]+/gi;
    for (const sc of document.querySelectorAll('script:not([src])')) {
      if (out.inScripts.length >= CAP) break;
      const t = String(sc.textContent || '');
      if (!t || t.length > 500000) continue;
      for (const m of t.match(URL_RE) || []) { if (MEDIA_RE.test(m)) addTo(out.inScripts, seen, cut(m)); }
    }
  } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'scripts: ' + String(e).slice(0, 60); }
  try {
    // Frames that load later (the address waits in data-src until a click or scroll).
    const seen = new Set();
    document.querySelectorAll('iframe[data-src], iframe[data-lazy-src], iframe[data-url]').forEach(f => {
      const v = f.getAttribute('data-src') || f.getAttribute('data-lazy-src') || f.getAttribute('data-url');
      addTo(out.lazyFrames, seen, cut(v) + (f.getAttribute('src') ? '' : ' (not loaded yet)'));
    });
    // Subtitle files given to the player.
    const seenT = new Set();
    document.querySelectorAll('track').forEach(t => {
      const src = t.getAttribute('src');
      if (!src) return;
      addTo(out.trackFiles, seenT, (t.getAttribute('kind') || 'subtitles') + ':' + (t.getAttribute('srclang') || '?') + (t.getAttribute('label') ? ' ' + String(t.getAttribute('label')).slice(0, 20) : '') + ' ' + cut(t.src || src));
    });
  } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'frames: ' + String(e).slice(0, 60); }
  try {
    // Firefox: player libraries the page loaded (names and versions only; nothing is called).
    const w = window.wrappedJSObject;
    if (w) {
      const GLOBALS = [['jwplayer', 'version'], ['videojs', 'VERSION'], ['Hls', 'version'], ['Plyr', null], ['Artplayer', 'version'],
        ['Clappr', 'version'], ['dashjs', null], ['shaka', null], ['DPlayer', 'version'], ['flowplayer', 'version']];
      for (const [name, vk] of GLOBALS) {
        let present = false, ver = '';
        try { present = typeof w[name] !== 'undefined' && w[name] !== null; } catch { present = false; }
        if (!present) continue;
        try { const v = vk ? w[name][vk] : ''; if (typeof v === 'string' && /^[\w.+-]{1,20}$/.test(v)) ver = ' ' + v; } catch { /* getter refused */ }
        out.globals.push(name + ver);
      }
    }
  } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'globals: ' + String(e).slice(0, 60); }
  return out;
})();
