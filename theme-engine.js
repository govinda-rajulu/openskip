/* SkipStream - OKLCH Dynamic Theme Engine */
'use strict';
(function() {
  const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  let currentSeed = '#57A860';
  function hexToOklch(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.slice(0,2),16)/255;
    const g = parseInt(hex.slice(2,4),16)/255;
    const b = parseInt(hex.slice(4,6),16)/255;
    const toLinear = c => c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const l_ = 0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb;
    const m_ = 0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb;
    const s_ = 0.0883024619*lr + 0.2220049874*lg + 0.6896926158*lb;
    const l = Math.cbrt(l_), m = Math.cbrt(m_), s = Math.cbrt(s_);
    const L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
    const a = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
    const bVal = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
    const C = Math.sqrt(a*a + bVal*bVal);
    let H = Math.atan2(bVal, a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  }
  function oklchCSS(L, C, H, alpha) {
    if (alpha !== undefined) return 'oklch(' + L + ' ' + C + ' ' + H + ' / ' + alpha + ')';
    return 'oklch(' + L + ' ' + C + ' ' + H + ')';
  }
  function applyThemeFromSeed(hex, mode) {
    if (hex) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) hex = '#57A860';
      currentSeed = hex;
    }
    hex = currentSeed;
    mode = mode || 'dark';
    const seed = hexToOklch(hex);
    const h = seed.H;
    const c = Math.min(seed.C, 0.15);
    const el = document.documentElement.style;
    if (mode === 'dark') {
      el.setProperty('--bg-base', oklchCSS(0.06, 0.02, h));
      el.setProperty('--bg-card', oklchCSS(0.12, 0.02, h));
      el.setProperty('--bg-surface', oklchCSS(0.17, 0.02, h));
      el.setProperty('--bg-hover', oklchCSS(0.22, 0.02, h));
      el.setProperty('--accent', oklchCSS(0.75, c, h));
      el.setProperty('--on-accent', oklchCSS(0.20, c, h));
      el.setProperty('--accent-dim', oklchCSS(0.65, c, h));
      el.setProperty('--accent-glow', oklchCSS(0.75, c, h, 0.18));
      el.setProperty('--text-primary', oklchCSS(0.90, 0.02, h));
      el.setProperty('--text-secondary', oklchCSS(0.80, 0.04, h));
      el.setProperty('--text-muted', oklchCSS(0.60, 0.04, h));
      el.setProperty('--border', oklchCSS(0.80, 0.04, h, 0.10));
      el.setProperty('--border-strong', oklchCSS(0.80, 0.04, h, 0.18));
    } else {
      el.setProperty('--bg-base', oklchCSS(0.98, 0.02, h));
      el.setProperty('--bg-card', oklchCSS(1.00, 0.00, h));
      el.setProperty('--bg-surface', oklchCSS(0.96, 0.02, h));
      el.setProperty('--bg-hover', oklchCSS(0.92, 0.02, h));
      el.setProperty('--accent', oklchCSS(0.45, c, h));
      el.setProperty('--on-accent', oklchCSS(1.00, 0.00, h));
      el.setProperty('--accent-dim', oklchCSS(0.35, c, h));
      el.setProperty('--accent-glow', oklchCSS(0.45, c, h, 0.14));
      el.setProperty('--text-primary', oklchCSS(0.10, 0.02, h));
      el.setProperty('--text-secondary', oklchCSS(0.30, 0.04, h));
      el.setProperty('--text-muted', oklchCSS(0.50, 0.04, h));
      el.setProperty('--border', oklchCSS(0.30, 0.04, h, 0.10));
      el.setProperty('--border-strong', oklchCSS(0.30, 0.04, h, 0.18));
    }
  }
  br.storage.local.get(['skipstream_seed_color', 'skipstream_theme']).then(data => {
    applyThemeFromSeed(data.skipstream_seed_color || '#57A860', data.skipstream_theme || 'dark');
  }).catch(() => {
    applyThemeFromSeed('#57A860', 'dark');
  });
  window.applyThemeFromSeed = applyThemeFromSeed;
})();
