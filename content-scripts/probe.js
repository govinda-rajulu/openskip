/* SkipStream - site report probe. Injected on request only (popup "Site report"),
   into every frame. Reads the page, sends nothing anywhere: the result goes back
   to the popup, which shows it and lets you copy it. Addresses are cut to host +
   path (no query strings, which can hold tokens). */
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
  };
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
  return out;
})();
