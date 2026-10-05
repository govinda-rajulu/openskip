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

test('sources page: 10 sources, each with a link, logos only from the icon service and only when the page opens', () => {
  const rows = [...OPTIONS_HTML.matchAll(/<li class="src-row">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 10);
  for (const r of rows) {
    assert.match(r, /<img class="src-logo" data-logo="https:\/\/icons\.duckduckgo\.com\/ip3\/[a-z0-9.-]+\.ico" alt="" width="20" height="20" referrerpolicy="no-referrer" hidden>/);
    assert.match(r, /<a href="https:\/\/[^"]+" target="_blank" rel="noopener"><strong>/);
  }
  assert.equal(/<img[^>]* src="https?:/.test(OPTIONS_HTML), false, 'no remote image loads when Settings opens');
  assert.match(OPTIONS_HTML, /not endorsed, certified or otherwise approved by TMDB/);
});
