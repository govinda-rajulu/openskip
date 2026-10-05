// 1.13.0 device test round 2 (5 Oct): player frames start at once, TheIntroDB API
// v3, one source per skip kind with the source named, Settings in 5S order.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, makeBrowser, loadBackground, fakeResponse, contentFns } from './harness.mjs';

const j = (x) => JSON.parse(JSON.stringify(x));
const OPTIONS_HTML = read('options.html');
const POPUP_HTML = read('popup.html');

// A browser timer called as a method of a plain object throws (WebIDL). node:vm
// does not, so this fake does what Firefox and Chrome do.
function strictTimers(ctx) {
  const mk = (name) => function () { if (this !== undefined && this !== ctx) throw new TypeError("'" + name + "' called on an object that does not implement interface Window."); return 0; };
  return { setTimeout: mk('setTimeout'), clearTimeout: mk('clearTimeout'), setInterval: mk('setInterval'), clearInterval: mk('clearInterval') };
}
const any = (p) => new Proxy(function () {}, {
  get(_t, k) {
    if (k === 'then') return undefined;
    if (k === Symbol.iterator) return function* () {};
    if (k === 'length') return 0;
    if (k === Symbol.toPrimitive) return () => '';
    return any(p + '.' + String(k));
  },
  apply() { return any(p + '()'); },
  construct() { return any(p + ' new'); },
});
function loadFrame(href) {
  const u = new URL(href);
  const listeners = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, requestAnimationFrame() {},
    location: { href, hostname: u.hostname, pathname: u.pathname, search: u.search, protocol: u.protocol },
    document: any('document'), history: any('history'), navigator: any('navigator'), getComputedStyle: () => any('cs'),
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    HTMLVideoElement: class {}, Node: class {}, Element: class {}, frames: [],
    addEventListener: (t, f) => { (listeners['window.' + t] ||= []).push(f); }, removeEventListener() {}, postMessage() {},
  };
  Object.assign(ctx, strictTimers(ctx));
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.top = { other: true };   // a player frame
  ctx.browser = makeBrowser(listeners, {});
  vm.createContext(ctx);
  let thrown = null;
  try { vm.runInContext(read('content-scripts/content.js'), ctx, { filename: 'content.js' }); } catch (e) { thrown = e; }
  return { ctx, thrown };
}

test('player frame with a video: start-up finishes (real browser timers, no play event needed)', () => {
  const { ctx, thrown } = loadFrame('https://www.viduki.net/1/movie/603');
  assert.equal(thrown, null, 'start-up threw: ' + (thrown && thrown.message));
  const r = ctx.__skipstream_diag();
  assert.equal(r.top, false);
  assert.equal(r.started, true, '"did not finish starting" on 1Shows came from this');
});

const route = (map) => (url) => { for (const [k, v] of Object.entries(map)) if (url.includes(k)) return fakeResponse(200, v); return fakeResponse(404, {}); };

test('theintrodb v3: start null = 0:00, every credits part kept, end null = end of video', async () => {
  const bg = loadBackground({ fetchImpl: route({ 'api.theintrodb.org': { tmdb_id: 603, type: 'movie',
    intro: [{ start_ms: null, end_ms: 40000 }], credits: [{ start_ms: 6408000, end_ms: null }, { start_ms: 5801777, end_ms: 6371111 }] } }) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0133093', season: 0, episode: 0, isMovie: true, tmdbId: 603, durationSec: 6500 });
  assert.deepEqual(j(r.data.intro), { start_sec: 0, end_sec: 40, src: 'TheIntroDB' });
  assert.deepEqual(j(r.data.outro), [{ start_sec: 5801.777, end_sec: 6371.111, src: 'TheIntroDB' }, { start_sec: 6408, end_sec: 6500, src: 'TheIntroDB' }]);
  assert.ok(bg.calls.some((x) => x.url === 'https://api.theintrodb.org/v3/media?tmdb_id=603&duration_ms=6500000'));
  assert.equal(bg.calls.some((x) => x.url.includes('/v1/')), false, 'v1 no longer answers');
});

test('merge: kinds combine across sources, one source per kind, never mixed', () => {
  const { ctx } = loadBackground();
  const m = j(ctx.mergeSkipSources({
    IntroDB: { outro: { start_sec: 3431, end_sec: 3500 } },
    TheIntroDB: { intro: [{ start_sec: 228.65, end_sec: 246.025 }], outro: [{ start_sec: 3431, end_sec: 3600 }] },
    SkipDB: { recap: { start_sec: 0, end_sec: 30 }, intro: { start_sec: 300, end_sec: 330 } },
    'Anime Skip': null }));
  assert.deepEqual(m, {
    outro: { start_sec: 3431, end_sec: 3500, src: 'IntroDB' },
    intro: { start_sec: 228.65, end_sec: 246.025, src: 'TheIntroDB' },
    recap: { start_sec: 0, end_sec: 30, src: 'SkipDB' } });
  assert.equal(ctx.mergeSkipSources({}), null);
  assert.equal(ctx.mergeSkipSources({ SkipDB: { intro: { start_sec: 50, end_sec: 10 } } }), null, 'bad times are dropped');
});

test('check this page names each skip, its times and its source', () => {
  const { _diagSegs } = contentFns(['_diagSegs', '_diagClock'], [], { _diagChapters: null });
  assert.equal(_diagSegs({ intro: { start_sec: 0, end_sec: 40, src: 'TheIntroDB' }, outro: { start_sec: 7765, end_sec: 8178.7, src: 'SkipDB' } }),
    'intro 0:00-0:40 (TheIntroDB), outro 2:09:25-2:16:19 (SkipDB)');
  assert.equal(_diagSegs({ sponsor: [{ start_sec: 61, end_sec: 90 }, { start_sec: 300, end_sec: 330 }], full: 'sponsor' }, 'SponsorBlock'),
    'sponsor 1:01-1:30 (SponsorBlock), sponsor 5:00-5:30 (SponsorBlock), whole video: sponsor');
});

test('settings 5S: one page per kind of control, every nav item has its page', () => {
  const navs = [...OPTIONS_HTML.matchAll(/class="nav-item[^"]*" data-panel="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(navs, ['features', 'customise', 'accounts', 'history', 'stats', 'data', 'sources']);
  const panelOf = (id) => {
    const i = OPTIONS_HTML.indexOf('id="' + id + '"');
    assert.ok(i > 0, id);
    return [...OPTIONS_HTML.slice(0, i).matchAll(/<section id="panel-([a-z]+)"/g)].pop()[1];
  };
  for (const id of ['featSkipMode', 'featResume', 'featAutoNext', 'skipNotice', 'resumeNotice', 'showTimeline', 'ccButton', 'sbm-sponsor', 'siteRulesList']) assert.equal(panelOf(id), 'features', id);
  for (const id of ['subFontSize', 'subColor', 'subFont', 'subWeight', 'subBg', 'subEdge', 'subPreview', 'optSeedColor']) assert.equal(panelOf(id), 'customise', id);
  for (const id of ['osobUsername', 'supabaseUrl', 'tmdbApiKey', 'introdbApiKey', 'animeSkipClientId', 'deviceName', 'dot-introdb']) assert.equal(panelOf(id), 'accounts', id);
  for (const id of ['exportBtn', 'importBtn', 'clearBtn']) assert.equal(panelOf(id), 'data', id);
  assert.equal(panelOf('aboutVer'), 'sources');
  assert.equal(OPTIONS_HTML.match(/<section id="panel-/g).length, 7);
});

test('settings 5S: popup and Settings write the same skip-mode keys; accent lives only in Settings', () => {
  const grab = (src) => src.slice(src.indexOf('const MODE_TO_SEGS = {'), src.indexOf('};', src.indexOf('const MODE_TO_SEGS = {')));
  assert.equal(grab(read('options.js')), grab(read('popup.js')));
  assert.equal(POPUP_HTML.includes('seedColorPicker'), false);
  assert.ok(POPUP_HTML.includes('id="sourcesLink"'));
  assert.match(read('options.js'), /connections: 'accounts', siterules: 'features', dataadvanced: 'data'/, 'old links still open the right page');
});

test('sources page: 10 sources, each with a link; logos from the official site first, only when the page opens', () => {
  const rows = [...OPTIONS_HTML.matchAll(/<li class="src-row">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 10);
  for (const r of rows) {
    assert.match(r, /<img class="src-logo" data-logo="https:\/\/(?:[a-z0-9.-]+\/favicon\.ico|github\.com\/[a-z0-9-]+\.png\?size=40)" data-logo-alt="https:\/\/icons\.duckduckgo\.com\/ip3\/[a-z0-9.-]+\.ico" alt="" width="20" height="20" referrerpolicy="no-referrer" hidden>/);
    assert.match(r, /<a href="https:\/\/[^"]+" target="_blank" rel="noopener"><strong>/);
  }
  assert.equal(/<img[^>]* src="https?:/.test(OPTIONS_HTML), false, 'no remote image loads when Settings opens');
  assert.match(OPTIONS_HTML, /not endorsed, certified or otherwise approved by TMDB/);
});

// Settings and the popup load as whole files. Up to os-133 nothing ran options.js
// end to end: one line read `manifest` before its `const`, and the whole page died.
test('options.js and popup.js run to the end without throwing (whole file, fake DOM)', () => {
  const anyP = (p) => new Proxy(function () {}, { get(_t, k) { if (k === 'then') return undefined; if (k === Symbol.iterator) return function* () {}; if (k === 'length') return 0; if (k === Symbol.toPrimitive) return () => ''; return anyP(p + '.' + String(k)); }, apply() { return anyP(p + '()'); }, construct() { return anyP(p + ' new'); } });
  for (const f of ['options.js', 'popup.js']) {
    const ctx = { console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      location: { hash: '', href: 'moz-extension://x/' + f }, document: anyP('document'), history: anyP('history'), navigator: anyP('navigator'),
      matchMedia: () => anyP('mm'), getComputedStyle: () => anyP('cs'), addEventListener() {}, Blob: class {}, FileReader: class {},
      MutationObserver: class { observe() {} }, crypto: globalThis.crypto, TextEncoder, TextDecoder, Intl, Date, Math, JSON,
      requestAnimationFrame() {}, alert() {}, confirm: () => false, prompt: () => null, fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" }) };
    ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
    ctx.browser = makeBrowser({}, {}, { 'browser.runtime.getManifest': () => ({ version: '1.13.0' }) });
    vm.createContext(ctx);
    vm.runInContext(read('theme-engine.js'), ctx, { filename: 'theme-engine.js' });
    assert.doesNotThrow(() => vm.runInContext(read(f), ctx, { filename: f }), f);
  }
});

// ── Round 3 (5 Oct): a site on a new address, marks in the player's own bar, Accounts logos ──
test('site moved (1shows.cx -> 1shows.to): rules, History filter and resume follow the site name', async () => {
  const f = contentFns(['_siteFamily', '_canonHost', '_siteRuleFor'], [], {});
  for (const [h, want] of [['www.1shows.cx', '1shows'], ['1shows.to', '1shows'], ['player.viduki.net', 'viduki'], ['news.bbc.co.uk', 'bbc'], ['m.youtube.com', 'youtube'], ['localhost', 'localhost']]) assert.equal(f._siteFamily(h), want, h);
  assert.equal(f._siteRuleFor({ '1shows.cx': 'off' }, '1shows.to'), 'off', 'a rule for the old address still applies');
  assert.equal(f._siteRuleFor({ 'example.com': 'off' }, 'other.com'), null);
  const OPT = read('options.js');
  const fam = vm.runInNewContext(['canonHost', 'siteFamily'].map((n) => { const src = OPT; const i = src.indexOf('function ' + n + '('); let d = 0, k = src.indexOf('{', i); for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) break; } return src.slice(i, k + 1); }).join('\n') + ';siteFamily');
  assert.equal(fam('www.1shows.cx'), fam('1shows.to'));
  const storage = { skipstream_cache: { '1shows.cx/watch/abc': { p: 600, d: 3000, t: 5 }, 'other.cx/watch/abc': { p: 900, t: 9 }, '1shows.cx/watch/zzz': { p: 50, t: 9 } } };
  const listeners = {};
  const g = contentFns(['_cacheReadMoved', '_siteFamily', '_canonHost'], [], { br: makeBrowser(listeners, storage), CACHE_KEY: 'skipstream_cache' });
  assert.deepEqual(j(await g._cacheReadMoved('1shows.to/watch/abc')), { p: 600, d: 3000, t: 5 });
  assert.equal(await g._cacheReadMoved('movie/603'), null, 'host-free ids need no search');
});

test('timeline: any player\'s seek bar is found by what it is, not by its name; marks float over it', () => {
  const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const mk = (attrs, r, cls = '') => ({ className: cls, id: '', tagName: 'DIV', getAttribute: (k) => (k in attrs ? attrs[k] : null), getBoundingClientRect: () => r, matches: () => false });
  const seek = mk({ role: 'slider', 'aria-label': 'Seek', 'aria-valuemax': '8181' }, rect(20, 520, 960, 20), 'x-a1b2');   // no known class name
  const volume = mk({ role: 'slider', 'aria-label': 'Volume' }, rect(800, 520, 900, 20));
  const topbar = mk({ role: 'slider' }, rect(0, 10, 1000, 4), 'progress');
  const player = { parentElement: null, getBoundingClientRect: () => rect(0, 0, 1000, 600),
    querySelectorAll: (q) => (q === '*' ? [] : [topbar, volume, seek]) };
  const video = { parentElement: player, duration: 8181, getBoundingClientRect: () => rect(0, 0, 1000, 560) };
  const f = contentFns(['_findSeekBar', '_seekBarScore'], ['PLAYER_BAR_SELECTORS'], {});
  assert.equal(f._findSeekBar(video), seek, 'the wide slider low on the video, length = video length');
  assert.equal(f._seekBarScore(volume, rect(0, 0, 1000, 560), 8181), 0, 'volume is never the seek bar');
  assert.equal(f._seekBarScore(topbar, rect(0, 0, 1000, 560), 8181), 0, 'a bar at the top is not the seek bar');
  const none = { parentElement: { parentElement: null, getBoundingClientRect: () => rect(0, 0, 1000, 600), querySelectorAll: () => [] }, duration: 100, getBoundingClientRect: () => rect(0, 0, 1000, 560) };
  assert.equal(f._findSeekBar(none), null, 'no bar: the strip under the video is used');
  const C = read('content-scripts/content.js');
  assert.match(C, /box\.dataset\.ss = 'over';/, 'marks float over the bar');
  assert.equal(/pBar\.appendChild|bar\.appendChild\(box\)/.test(C), false, 'nothing is put inside another player\'s bar');
  assert.match(C, /checkVisibility\(\{ opacityProperty: true, visibilityProperty: true \}\)/, 'marks hide with the controls');
});

test('accounts: each service card has its logo from its own site (DuckDuckGo as fallback), loaded only when Accounts opens', () => {
  const H = read('options.html');
  const acc = H.slice(H.indexOf('<section id="panel-accounts"'), H.indexOf('</section>', H.indexOf('<section id="panel-accounts"')));
  const logos = [...acc.matchAll(/<img class="src-logo acct-logo" data-logo="(https:\/\/[^"]+\/favicon\.ico)" data-logo-alt="https:\/\/icons\.duckduckgo\.com\/ip3\/[a-z0-9.-]+\.ico"/g)].map((m) => m[1]);
  assert.deepEqual(logos.sort(), ['https://anime-skip.com/favicon.ico', 'https://introdb.app/favicon.ico', 'https://supabase.com/favicon.ico', 'https://www.opensubtitles.com/favicon.ico', 'https://www.themoviedb.org/favicon.ico']);
  assert.match(read('options.js'), /if \(id === 'sources' \|\| id === 'accounts'\) loadSourceLogos\(\$\('panel-' \+ id\)\);/);
});

test('skip mode shown = what the player does: a fresh install shows "Intros + recaps", not "Auto all"', () => {
  for (const f of ['popup.js', 'options.js']) {
    const src = read(f);
    const a = src.indexOf('const MODE_TO_SEGS = {'), b = src.indexOf('\n}', src.indexOf('function modeFromPrefs(')) + 2;
    const modeFromPrefs = vm.runInNewContext(src.slice(a, b) + ';modeFromPrefs');
    assert.equal(modeFromPrefs({}), 'auto-ir', f + ': defaults (outros ask)');
    assert.equal(modeFromPrefs({ skipMode: 'auto-all' }), 'auto-ir', f + ': a stored "auto-all" with skipOutro off is not shown as Auto all');
    assert.equal(modeFromPrefs({ skipIntro: true, skipRecap: true, skipOutro: true }), 'auto-all', f);
    assert.equal(modeFromPrefs({ skipEnabled: false, skipOutro: true }), 'off', f);
    assert.equal(modeFromPrefs({ skipIntro: false, skipRecap: false, skipOutro: false }), 'prompt', f);
    assert.equal(modeFromPrefs({ skipIntro: true, skipRecap: false }), 'auto-intro', f);
  }
  assert.ok(read('popup.html').includes('data-mode="auto-ir"'));
  assert.ok(read('options.html').includes('<option value="auto-ir">'));
  assert.match(read('popup.js'), /const mode {5}= modeFromPrefs\(data\);/);
});

test('links: no source points to a parked or wrong domain (aniskip.com is parked; AniSkip lives on GitHub)', () => {
  for (const f of ['options.html', 'README.md']) assert.equal(/https:\/\/aniskip\.com/.test(read(f)), false, f);
  assert.ok(read('options.html').includes('href="https://github.com/aniskip"'));
});

test('skipdb: the video length is sent, so SkipDB picks the times made for this release', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(404, {}) });
  await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0133093', season: 0, episode: 0, isMovie: true, durationSec: 8181.4 });
  assert.ok(bg.calls.some((x) => x.url === 'https://api.skipdb.tv/api/segments?imdb_id=tt0133093&duration=8181'));
});
