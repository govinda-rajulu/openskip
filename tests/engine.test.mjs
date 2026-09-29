import test from 'node:test';
import assert from 'node:assert/strict';
import { read, loadBackground, fakeResponse, contentFns } from './harness.mjs';

const CONTENT = read('content-scripts/content.js');

// ── IntroDB (B1 + movies + response shape) ────────────────────────────────────
const IDB_EP = { imdb_id: 'tt0903747', season: 1, episode: 1,
  intro: { start_sec: 2.5, end_sec: 58, start_ms: 2500, end_ms: 58000, confidence: 0.9, submission_count: 12 },
  recap: null,
  outro: { start_sec: null, end_sec: null, start_ms: 2700000, end_ms: 2760000, submission_count: 3 } };

test('IntroDB is read with NO key and never sends a key', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, IDB_EP) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1 });
  const c = bg.calls.find(x => x.url.startsWith('https://api.introdb.app/'));
  assert.ok(c, 'IntroDB was not called without a key');
  assert.equal(c.url, 'https://api.introdb.app/segments?imdb_id=tt0903747&season=1&episode=1');
  assert.equal(JSON.stringify(c.opts?.headers || {}).includes('idb_'), false);
  assert.deepEqual(Object.keys(r.data).sort(), ['intro', 'outro']);
  assert.equal(r.data.intro.submission_count, 12);
  assert.equal(r.data.outro.start_sec, 2700);          // ms fallback
});

test('a saved IntroDB key is still not sent on reads', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, IDB_EP), storage: { introdbApiKey: 'idb_secret' } });
  await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1 });
  assert.equal(JSON.stringify(bg.calls).includes('idb_secret'), false);
});

test('movies use is_movie=true, skip Anime-Skip, never skip post_credits', async () => {
  const body = { imdb_id: 'tt0371746', media_type: 'movie', outro: { start_sec: 7140, end_sec: 7515 }, post_credits: { start_sec: 7515, end_sec: 7555 } };
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, body), storage: { animeSkipEnabled: true, animeSkipClientId: 'x' } });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0371746', season: 0, episode: 0, isMovie: true });
  assert.equal(bg.calls[0].url, 'https://api.introdb.app/segments?imdb_id=tt0371746&is_movie=true');
  assert.equal(bg.calls.some(c => c.url.includes('anime-skip')), false);
  assert.deepEqual(Object.keys(r.data), ['outro']);
});

test('an all-null IntroDB answer is "no data", not an empty success', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, { imdb_id: 'tt1', intro: null, recap: null, outro: null }) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 2 });
  assert.equal(r.data, null);
});

test('non-IMDb ids are never sent to IntroDB', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, IDB_EP) });
  await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'yt/abcdefghijk', season: 0, episode: 0 });
  assert.equal(bg.calls.length, 0);
});

// ── TMDB (B3 auth split + B4 null cache + movie ids) ──────────────────────────
test('TMDB v3 key goes as api_key, v4 token as Bearer', async () => {
  const bg3 = loadBackground({ fetchImpl: () => fakeResponse(200, { imdb_id: 'tt0944947' }), storage: { tmdbApiKey: 'abcdef0123456789abcdef0123456789' } });
  const r3 = await bg3.send({ type: 'TMDB_TO_IMDB', tmdbId: 1399 });
  assert.equal(r3.imdbId, 'tt0944947');
  assert.equal(bg3.calls[0].url, 'https://api.themoviedb.org/3/tv/1399/external_ids?api_key=abcdef0123456789abcdef0123456789');
  const bg4 = loadBackground({ fetchImpl: () => fakeResponse(200, { imdb_id: 'tt0944947' }), storage: { tmdbApiKey: 'hdr.payload.sig' } });
  await bg4.send({ type: 'TMDB_TO_IMDB', tmdbId: 1399 });
  assert.equal(bg4.calls[0].url, 'https://api.themoviedb.org/3/tv/1399/external_ids');
  assert.equal(bg4.calls[0].opts.headers.Authorization, 'Bearer hdr.payload.sig');
});

test('TMDB movie ids use the movie endpoint', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, { imdb_id: 'tt0371746' }), storage: { tmdbApiKey: 'k' } });
  const r = await bg.send({ type: 'TMDB_TO_IMDB', tmdbId: 1726, kind: 'movie' });
  assert.match(bg.calls[0].url, /\/3\/movie\/1726\/external_ids/);
  assert.equal(r.imdbId, 'tt0371746');
});

test('no key / 401 does not poison the cache forever', async () => {
  let status = 401;
  const storage = {};
  const bg = loadBackground({ fetchImpl: () => fakeResponse(status, status === 200 ? { imdb_id: 'tt0944947' } : { status_message: 'bad key' }), storage });
  const r1 = await bg.send({ type: 'TMDB_TO_IMDB', tmdbId: 1399 });
  assert.equal(r1.imdbId, null);                            // no key at all: no call
  assert.equal(bg.calls.length, 0);
  storage.tmdbApiKey = 'k';
  await new Promise(r => setTimeout(r, 0));
  // config is cached for 30s inside background; reload to simulate a later session
  const bg2 = loadBackground({ fetchImpl: () => fakeResponse(status, { status_message: 'bad key' }), storage });
  assert.equal((await bg2.send({ type: 'TMDB_TO_IMDB', tmdbId: 1399 })).imdbId, null);
  status = 200;
  const bg3 = loadBackground({ fetchImpl: () => fakeResponse(200, { imdb_id: 'tt0944947' }), storage });
  assert.equal((await bg3.send({ type: 'TMDB_TO_IMDB', tmdbId: 1399 })).imdbId, 'tt0944947');
});

// ── Content engine (pure functions extracted from the real file) ──────────────
test('findActiveSegment ignores null / inverted segments', () => {
  const { findActiveSegment } = contentFns(['findActiveSegment']);
  assert.equal(findActiveSegment({ intro: { start_sec: null, end_sec: null } }, 0.5), null);
  assert.equal(findActiveSegment({ intro: { start_sec: 50, end_sec: 10 } }, 20), null);
  assert.equal(findActiveSegment({ intro: { start_sec: 10, end_sec: 50 } }, 20).key, 'intro');
  assert.equal(findActiveSegment({ sponsor: [{ start_sec: 5, end_sec: 9 }, { start_sec: 100, end_sec: 130 }] }, 120).segment.start_sec, 100);
});

test('badge reads IntroDB submission_count', () => {
  const f = contentFns(['segmentLabel'], ['SEGMENT_LABELS']);
  assert.equal(f.segmentLabel('intro', { submission_count: 12 }), '\u23ED Skip Intro \u2605');
  assert.equal(f.segmentLabel('intro', { submission_count: 6 }), '\u23ED Skip Intro \u25C6');
  assert.equal(f.segmentLabel('intro', { submission_count: 1 }), '\u23ED Skip Intro');
});

test('iframe relay accepts every real label and rejects others (C4)', () => {
  const f = contentFns(['_isRelayLabel', 'segmentLabel'], ['SEGMENT_LABELS']);
  for (const k of ['intro', 'recap', 'outro', 'sponsor', 'selfpromo'])
    for (const n of [0, 6, 12]) assert.ok(f._isRelayLabel(f.segmentLabel(k, { submission_count: n })), k + n);
  for (const bad of ['Skip Intro', '<img src=x>', '\u23ED Skip Intro <b>', 'x'.repeat(60), 42, null])
    assert.equal(f._isRelayLabel(bad), false, String(bad));
});

test('site rules: www / case normalised, parent-domain match (C6)', () => {
  const f = contentFns(['_normSiteRules', '_siteRuleFor']);
  const rules = f._normSiteRules({ 'WWW.Example.com': 'off', 'hianime.to': 'auto-all', bad: 3 });
  assert.equal(JSON.stringify(rules), JSON.stringify({ 'example.com': 'off', 'hianime.to': 'auto-all' }));
  assert.equal(f._siteRuleFor(rules, 'example.com'), 'off');
  assert.equal(f._siteRuleFor(rules, 'player.example.com'), 'off');
  assert.equal(f._siteRuleFor(rules, 'notexample.com'), null);
});

test('YouTube id from watch / embed / shorts, never from other hosts (C15)', () => {
  const run = (href) => {
    const u = new URL(href);
    return contentFns(['_youtubeVideoId'], [], { location: { hostname: u.hostname, search: u.search, pathname: u.pathname } })._youtubeVideoId();
  };
  assert.equal(run('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'dQw4w9WgXcQ');
  assert.equal(run('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(run('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(run('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(run('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
});

// ── Static regressions: shapes that caused the audited bugs must not return ──
test('C1: isInSegment is only called inside findActiveSegment', () => {
  const calls = CONTENT.split('\n').filter(l => /isInSegment\(/.test(l) && !/function isInSegment/.test(l));
  assert.equal(calls.length, 1, calls.join('\n'));
});

test('C2: URL change resets resolved and bumps the generation', () => {
  const block = CONTENT.slice(CONTENT.indexOf('if (location.href !== _vidHref)'), CONTENT.indexOf('startNativeSkipObserver(video);', CONTENT.indexOf('if (location.href !== _vidHref)')));
  for (const s of ['resolved = false', '_segGen++', 'segments = null', '_promptedVideos.delete(video)', 'resolveSegments()'])
    assert.ok(block.includes(s), 'missing: ' + s);
  assert.equal(/checkUrlChange|_lastHref/.test(CONTENT), false);
});

test('C6: getSitePrefs no longer polls storage', () => {
  const f = CONTENT.slice(CONTENT.indexOf('function getSitePrefs'), CONTENT.indexOf('// ── Media ID'));
  assert.equal(f.includes('storage.local.get'), false);
  assert.ok(f.includes('_siteHost()'));
});

test('C8: countdown settles once and detaches its pause listener', () => {
  const f = CONTENT.slice(CONTENT.indexOf('function showSkipCountdown'), CONTENT.indexOf('// ── "Still watching?"'));
  assert.ok(f.includes("video.removeEventListener('pause', onPause)"));
  assert.equal((f.match(/\bonDone\(\);/g) || []).length, 2, 'only auto path + finish() may call onDone');
});

test('C10: cloud history keeps the page url', () => {
  assert.ok(CONTENT.includes('url:       row.page_url || row.media_id,'));
});

test('no segment miss is cached forever in the page (fetchSegments)', () => {
  const f = CONTENT.slice(CONTENT.indexOf('async function fetchSegments'), CONTENT.indexOf('function findActiveSegment'));
  assert.equal(/segmentCache\.set\(key, null\)/.test(f), false);
});

// ── Second audit (H-series) ───────────────────────────────────────────────────
test('H26: subtitle timestamps with 1-2 fractional digits parse', () => {
  // parseSubs holds regex braces, so slice it by its 2-space closing line instead
  const i = CONTENT.indexOf('  function parseSubs(raw) {');
  const src = CONTENT.slice(i, CONTENT.indexOf('\n  }\n', i) + 4);
  const parseSubs = new Function(src + '\nreturn parseSubs;')();
  const subs = parseSubs('1\r\n00:00:01,5 --> 00:00:02,25\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n');
  assert.equal(subs.length, 2);
  assert.equal(subs[0].start ?? subs[0].s ?? subs[0][0], 1.5);
});

test('H7: an iframe relays first and draws its own button only without an ack', () => {
  const f = CONTENT.slice(CONTENT.indexOf('function showSkipBtn'), CONTENT.indexOf('function hideSkipBtn'));
  assert.ok(f.includes("if (window === window.top) { createSkipBtn(label, onSkip); return; }"));
  assert.ok(f.includes('if (!_relayAcked && pendingSkipFn === onSkip) createSkipBtn(label, onSkip)'));
  assert.ok(CONTENT.includes("e.source?.postMessage({ type: MSG_ACK }, '*')"));
});

test('H2: no OpenSubtitles request while subtitles are off', () => {
  const f = CONTENT.slice(CONTENT.indexOf('async function initSubtitles'), CONTENT.indexOf('// Listen for subtitle file uploaded'));
  const gate = f.indexOf('if (!_subState.enabled) { syncCCBtn(); return; }');
  assert.ok(gate > 0 && gate < f.indexOf("type: 'OSUB_SEARCH_AND_FETCH'"));
  assert.ok(f.includes('if (location.href === reqHref && result?.ok && result.text)'));
});
