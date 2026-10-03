// What is playing, where: titles, ids, embedded players, posters, title search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, contentFns, loadBackground, fakeResponse } from './harness.mjs';

const CONTENT = read('content-scripts/content.js');
const BG = read('background.js');
const j = (x) => JSON.parse(JSON.stringify(x));

// ── Titles ────────────────────────────────────────────────────────────────────
test('titles: site names and streaming filler go, real dashes stay', () => {
  const { _cleanTitle } = contentFns(['_cleanTitle'], ['_FILLER_RE']);
  assert.equal(_cleanTitle('Watch The Matrix (1999) Online Free HD | 1Shows', ['1Shows', '1shows.bz']), 'The Matrix (1999)');
  assert.equal(_cleanTitle('Spider-Man - Into the Spider-Verse | Netflix', ['Netflix', 'netflix.com']), 'Spider-Man - Into the Spider-Verse');
  assert.equal(_cleanTitle('Dark - S01E02 - Lies - Netflix', ['Netflix', 'netflix.com']), 'Dark - S01E02 - Lies');
  assert.equal(_cleanTitle('Breaking Bad | Watch Online | MySite', ['Mysite', 'mysite.to']), 'Breaking Bad');
  assert.equal(_cleanTitle('', ['x']), '');
});

test('titles: an embedded player uses the tab title, not its own', () => {
  const f = CONTENT.slice(CONTENT.indexOf('function getVideoTitle'), CONTENT.indexOf('const _FILLER_RE'));
  assert.match(f, /window !== window\.top && _tabInfo && _tabInfo\.title/);
});

// ── Ids from addresses ────────────────────────────────────────────────────────
function urlFns(href) {
  const u = new URL(href);
  return contentFns(['parseUrlInfo', 'extractSeEpisode', 'clampSE', 'parsePathTitle', 'titleFromSlug'], ['SE_REGEX', 'URL_SE_PATTERNS'],
    { location: { href: u.href, pathname: u.pathname, search: u.search }, parseInt, Number, Math, isFinite });
}
const blank = () => ({ imdbId: null, tmdbId: null, tmdbKind: null, season: null, episode: null, year: null });

test('ids: aggregator and embed addresses give TMDB id, kind and S/E', () => {
  const cases = [
    ['https://1shows.bz/movies/603-the-matrix', { tmdbId: 603, tmdbKind: 'movie' }],
    ['https://www.viduki.net/1/movie/603', { tmdbId: 603, tmdbKind: 'movie' }],
    ['https://vidsrc.xyz/embed/tv/1399/1/2', { tmdbId: 1399, tmdbKind: 'tv', season: 1, episode: 2 }],
    ['https://player.example/embed?tmdb=603&type=movie', { tmdbId: 603, tmdbKind: 'movie' }],
    ['https://site.example/tv/1399-game-of-thrones/season-2/episode-5', { tmdbId: 1399, tmdbKind: 'tv', season: 2, episode: 5 }],
  ];
  for (const [href, want] of cases) {
    const { parseUrlInfo } = urlFns(href);
    const info = blank();
    parseUrlInfo(info);
    for (const [k, v] of Object.entries(want)) assert.equal(info[k], v, href + ' ' + k);
  }
});

test('ids: a player frame can read the top page address it is given', () => {
  const { parseUrlInfo } = urlFns('https://player.example/e/abc123');
  const info = blank();
  parseUrlInfo(info, 'https://1shows.bz/tv/1399-got/1/9');
  assert.deepEqual([info.tmdbId, info.season, info.episode], [1399, 1, 9]);
});

test('ids: the season/episode pattern no longer treats "/-_" as a range', () => {
  assert.ok(CONTENT.includes('/\\/season[s]?[\\/_-](\\d+)[\\/_-]episode[s]?[\\/_-](\\d+)/i'));
  assert.ok(!CONTENT.includes('[\\/-_]'));
});

test('ids: slugs give a clean title and year', () => {
  const { parsePathTitle } = urlFns('https://1shows.bz/movies/603-the-matrix-1999');
  const info = blank();
  assert.equal(parsePathTitle(info), 'The Matrix');
  assert.equal(info.year, 1999);
  assert.equal(info.tmdbKind, 'movie');
  const p2 = urlFns('https://www.viduki.net/1/movie/603');
  assert.equal(p2.parsePathTitle(blank()), null, 'a bare number is not a title');
});

test('ids: another site\'s ?v= is not a YouTube video', () => {
  const mk = (href) => { const u = new URL(href); return contentFns(['getMediaId', '_youtubeVideoId'], [], { location: { href: u.href, hostname: u.hostname, pathname: u.pathname, search: u.search } }); };
  assert.equal(mk('https://www.youtube.com/watch?v=dQw4w9WgXcQ').getMediaId(), 'yt/dQw4w9WgXcQ');
  assert.equal(mk('https://www.youtube.com/shorts/dQw4w9WgXcQ').getMediaId(), 'yt/dQw4w9WgXcQ');
  assert.ok(!mk('https://example.com/play?v=abcdefghijk').getMediaId().startsWith('yt/'));
});

test('ids: a movie page never becomes an episode from sidebar text', () => {
  const f = CONTENT.slice(CONTENT.indexOf('function parsePageInfo'), CONTENT.indexOf('function titleFromSlug'));
  assert.match(f, /info\.tmdbKind !== 'movie'/);
  const r = CONTENT.slice(CONTENT.indexOf('async function resolveShowInfo'), CONTENT.indexOf('// ── Segments API'));
  assert.match(r, /if \(info\.tmdbKind === 'movie'\) \{ info\.season = null; info\.episode = null; \}/);
  assert.match(r, /parseUrlInfo\(info, top\)/, 'player frames parse the top page');
  assert.match(r, /TMDB_FIND_TITLE/);
  assert.match(r, /youtube\.com/, 'never title-matched on YouTube');
});

// ── Embedded players: real page address ──────────────────────────────────────
test('players: history keeps the real page address from the tab', async () => {
  const bg = loadBackground();
  const onMessage = bg.listeners['browser.runtime.onMessage.addListener'][0];
  const r = await new Promise(res => onMessage({ type: 'GET_TAB_INFO' }, { tab: { id: 3, url: 'https://1shows.bz/movies/603-the-matrix', title: 'The Matrix | 1Shows' }, frameId: 7 }, res));
  assert.deepEqual(j(r), { url: 'https://1shows.bz/movies/603-the-matrix', title: 'The Matrix | 1Shows' });
  const top = CONTENT.slice(CONTENT.indexOf('function _topHref'), CONTENT.indexOf('function _siteHost'));
  assert.match(top, /_tabInfo && _tabInfo\.url\) \|\| document\.referrer/);
  assert.match(CONTENT, /function _pageUrl\(\) \{\s*return _topHref\(\);/);
});

// ── TMDB: title -> id, id check, posters ──────────────────────────────────────
function tmdbBg(routes, storage = { tmdbApiKey: 'k' }) {
  return loadBackground({ storage, fetchImpl: (url) => {
    for (const [re, body, status] of routes) if (re.test(url)) return fakeResponse(status || 200, body);
    return fakeResponse(404, {});
  } });
}

test('tmdb: cleanMediaTitle', () => {
  const { ctx } = loadBackground();
  assert.deepEqual(j(ctx.cleanMediaTitle('Watch The Matrix (1999) Online Free | 1Shows')), { q: 'The Matrix', year: 1999, tv: false });
  assert.deepEqual(j(ctx.cleanMediaTitle('Dark - S01E02 - Lies')), { q: 'Dark', year: null, tv: true });
  assert.equal(ctx.cleanMediaTitle('Blade Runner 2049').q, 'Blade Runner 2049');
  assert.equal(ctx.cleanMediaTitle('1917').q, '1917');
});

test('tmdb: an exact title finds the IMDb id', async () => {
  const bg = tmdbBg([
    [/search\/movie\?query=The%20Matrix&.*year=1999/, { results: [{ id: 603, title: 'The Matrix', popularity: 80 }, { id: 604, title: 'The Matrix Reloaded', popularity: 50 }] }],
    [/\/movie\/603\/external_ids/, { imdb_id: 'tt0133093' }],
  ]);
  const r = await bg.send({ type: 'TMDB_FIND_TITLE', title: 'The Matrix', year: 1999, kind: 'movie' });
  assert.equal(r.imdbId, 'tt0133093');
  assert.equal(r.kind, 'movie');
});

test('tmdb: two works with one name and no year give no guess', async () => {
  const bg = tmdbBg([
    [/search\/tv/, { results: [{ id: 2316, name: 'The Office', popularity: 100 }, { id: 2996, name: 'The Office', popularity: 60 }] }],
    [/external_ids/, { imdb_id: 'tt0386676' }],
  ]);
  const r = await bg.send({ type: 'TMDB_FIND_TITLE', title: 'The Office', kind: 'tv' });
  assert.equal(r.imdbId, null);
  assert.equal(r.ambiguous, true);
});

test('tmdb: no key = not answered (retryable), no call', async () => {
  const bg = tmdbBg([], {});
  const r = await bg.send({ type: 'TMDB_FIND_TITLE', title: 'The Matrix' });
  assert.equal(r.answered, false);
  assert.equal(bg.calls.length, 0);
});

test('tmdb: a site\'s own number that is a different work on TMDB is refused', async () => {
  const bg = tmdbBg([[/\/movie\/603\?append_to_response=external_ids/, { title: 'The Matrix', external_ids: { imdb_id: 'tt0133093' } }]]);
  assert.equal((await bg.send({ type: 'TMDB_TO_IMDB', tmdbId: 603, kind: 'movie', title: 'Finding Nemo (2003)' })).imdbId, null);
  const bg2 = tmdbBg([[/\/movie\/603\?append_to_response=external_ids/, { title: 'The Matrix', external_ids: { imdb_id: 'tt0133093' } }]]);
  assert.equal((await bg2.send({ type: 'TMDB_TO_IMDB', tmdbId: 603, kind: 'movie', title: 'The Matrix (1999)' })).imdbId, 'tt0133093');
});

test('posters: a known TMDB id is used directly, portrait first', async () => {
  const bg = tmdbBg([[/\/3\/movie\/603\?/, { title: 'The Matrix', poster_path: '/p.jpg', backdrop_path: '/b.jpg' }]]);
  const r = await bg.send({ type: 'TMDB_SEARCH_POSTER', title: 'The Matrix (1999)', mediaId: 'movie/603' });
  assert.equal(r.posterUrl, 'https://image.tmdb.org/t/p/w185/p.jpg');
  assert.equal(bg.calls.length, 1);
});

test('posters: exact name beats the first search hit; a film title searches films first', async () => {
  const bg = tmdbBg([
    [/search\/movie/, { results: [{ id: 1, title: 'Matrix Resurrections', poster_path: '/wrong.jpg' }, { id: 603, title: 'The Matrix', poster_path: '/right.jpg' }] }],
    [/search\/tv/, { results: [{ id: 9, name: 'The Matrix', poster_path: '/tv.jpg' }] }],
  ]);
  const r = await bg.send({ type: 'TMDB_SEARCH_POSTER', title: 'Watch The Matrix (1999) Online Free', mediaId: '1shows.bz/x' });
  assert.equal(r.posterUrl, 'https://image.tmdb.org/t/p/w185/right.jpg');
  assert.match(bg.calls[0].url, /search\/movie\?query=The%20Matrix&page=1&year=1999/);
  assert.match(BG, /poster2:/, 'old cached artwork is not reused');
});

// ── Subtitles by title (popup button only) ────────────────────────────────────
test('subtitles: no id -> OpenSubtitles title search, YouTube says why', async () => {
  const bg = loadBackground({ fetchImpl: (url) => fakeResponse(200, { data: [] }) });
  await bg.send({ type: 'OSUB_SEARCH_AND_FETCH', imdbId: null, query: 'The Matrix', year: 1999, language: 'en' });
  const u = bg.calls.find(c => /\/subtitles\?/.test(c.url))?.url || '';
  assert.match(u, /query=The\+Matrix/);
  assert.match(u, /year=1999/);
  assert.doesNotMatch(u, /imdb_id=|type=/);
  const f = CONTENT.slice(CONTENT.indexOf('async function fetchSubsNow'), CONTENT.indexOf('// Listen for subtitle file uploaded'));
  assert.match(f, /reason: yt \? 'youtube' : 'no_id'/);
  const init = CONTENT.slice(CONTENT.indexOf('async function initSubtitles'), CONTENT.indexOf('async function fetchSubsNow'));
  assert.doesNotMatch(init, /query:/, 'automatic subtitles never search by title');
});

// ── Skipping ──────────────────────────────────────────────────────────────────
test('skip: automatic skip waits for the real start (no 2 s of content lost)', () => {
  assert.match(CONTENT, /if \(effectivePrefs\[prefKey\] && video\.currentTime < Number\(active\.segment\.start_sec\) - 0\.3\) return;/);
});

test('skip: next YouTube video looks segments up at once, not 1.5 s later', () => {
  const i = CONTENT.indexOf('[1500, 5000, 12000].forEach');
  assert.match(CONTENT.slice(i - 40, i), /resolveSegments\(\);\s*$/);
});

test('skip: a show page without S/E is not looked up as a movie', () => {
  assert.match(CONTENT, /info\.imdbId && !info\.season && !info\.episode && info\.tmdbKind !== 'tv'/);
});

test('keys: Alt+Z works on macOS (Option+Z types a symbol)', () => {
  assert.match(CONTENT, /e\.altKey && \(e\.code === 'KeyZ'/);
});
