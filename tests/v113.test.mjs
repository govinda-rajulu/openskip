// 1.13.0: resume that sticks, YouTube ads guard, mobile YouTube timeline, cloud
// push that cannot starve, new skip sources (TheIntroDB, AniSkip, Jikan, page
// chapters), better title matching, Supabase setup helper, deep site report,
// subtitle edge style, accurate AMO listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { read, ROOT, contentFns, loadBackground, fakeResponse, extractFunction, extractConst } from './harness.mjs';

const CONTENT = read('content-scripts/content.js');
const BG = read('background.js');
const OPTIONS = read('options.js');
const j = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise((r) => setImmediate(r));

// A fake clock: timers run only when the test moves time forward.
function clock(start = 1_000_000) {
  let t = start;
  const q = [];
  let seq = 0;
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }
  return {
    Date: FakeDate,
    now: () => t,
    setTimeout: (f, ms) => { const id = ++seq; q.push({ id, at: t + (Number(ms) || 0), f }); return id; },
    clearTimeout: (id) => { const i = q.findIndex((x) => x.id === id); if (i >= 0) q.splice(i, 1); },
    pending: () => q.length,
    async run(ms) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        const n = q[0];
        if (!n || n.at > end) break;
        q.shift();
        t = n.at;
        n.f();
        await tick(); await tick();
      }
      t = end;
    },
  };
}

// ── Resume ────────────────────────────────────────────────────────────────────
function resumeKit({ media = 'tv/1', ad = () => false } = {}) {
  const c = clock();
  const g = { getMediaId: () => g.media, media, _ytAdShowing: ad, _resumeHoldUntil: 0, setTimeout: c.setTimeout, Date: c.Date };
  const fns = contentFns(['_resumeSeek', '_saveBlocked'], [], g);
  return { c, g, fns, ctx: fns };
}
function fakeVideo({ time = 0, ready = 4, played = 0, snapBack = 0, kit }) {
  const v = { readyState: ready, isConnected: true, duration: 2400, played: { length: played }, seeks: [], plays: 0, _t: time, snaps: snapBack,
    play() { this.plays++; return Promise.resolve(); } };
  Object.defineProperty(v, 'currentTime', {
    get() { return this._t; },
    set(x) { this._t = x; this.seeks.push(x); if (this.snaps > 0) { this.snaps--; kit.c.setTimeout(() => { this._t = 0.4; }, 300); } },
  });
  return v;
}

test('resume: a warm load that already started playing is still resumed (old code gave up)', async () => {
  const kit = resumeKit();
  const v = fakeVideo({ time: 2.1, played: 1, kit });
  let ok = 0;
  kit.fns._resumeSeek(v, 600, 'tv/1', false, () => ok++);
  await kit.c.run(10000);
  assert.deepEqual(v.seeks, [600]);
  assert.equal(ok, 1, 'toast once, after the position held twice');
});

test('resume: the player snaps back to 0, SkipStream seeks again (at most 4 times)', async () => {
  const kit = resumeKit();
  const v = fakeVideo({ time: 0, snapBack: 2, kit });
  let ok = 0;
  kit.fns._resumeSeek(v, 600, 'tv/1', true, () => ok++);
  await kit.c.run(15000);
  assert.deepEqual(v.seeks, [600, 600, 600]);
  assert.equal(v.plays, 1, 'play() only on the first try');
  assert.equal(ok, 1);
  const k2 = resumeKit();
  const v2 = fakeVideo({ time: 0, snapBack: 99, kit: k2 });
  let ok2 = 0;
  k2.fns._resumeSeek(v2, 600, 'tv/1', false, () => ok2++);
  await k2.c.run(20000);
  assert.equal(v2.seeks.length, 4, 'gives up after 4 tries');
  assert.equal(ok2, 0);
});

test('resume: saving is held until the position settles, then released', async () => {
  const kit = resumeKit();
  const v = fakeVideo({ time: 0, snapBack: 1, kit });
  kit.fns._resumeSeek(v, 600, 'tv/1', false, null);
  const near0 = { duration: 2400, currentTime: 30 };
  assert.equal(kit.fns._saveBlocked(near0), true, 'a start-up position cannot overwrite the saved one');
  await kit.c.run(15000);
  assert.equal(kit.fns._saveBlocked(near0), false, 'hold released');
});

test('resume: the hold ends after 15 s even if the player never gets ready', async () => {
  const kit = resumeKit();
  const v = fakeVideo({ time: 0, ready: 0, kit });
  kit.fns._resumeSeek(v, 600, 'tv/1', false, null);
  await kit.c.run(16000);
  assert.equal(v.seeks.length, 0);
  assert.equal(kit.fns._saveBlocked({ duration: 2400, currentTime: 30 }), false);
  assert.equal(kit.c.pending(), 0, 'no timer left running');
});

test('resume: left alone when the user or the site already moved elsewhere, or the page changed', async () => {
  const kit = resumeKit();
  const v = fakeVideo({ time: 95, kit });
  let ok = 0;
  kit.fns._resumeSeek(v, 600, 'tv/1', false, () => ok++);
  await kit.c.run(5000);
  assert.deepEqual([v.seeks.length, ok], [0, 0]);
  const k2 = resumeKit();
  const v2 = fakeVideo({ time: 0, ready: 0, kit: k2 });
  k2.fns._resumeSeek(v2, 600, 'tv/1', false, null);
  k2.g.media = 'tv/2';
  v2.readyState = 4;
  await k2.c.run(5000);
  assert.equal(v2.seeks.length, 0, 'H10: page moved on');
});

test('resume: waits while a YouTube ad plays, then seeks', async () => {
  let ad = true;
  const kit = resumeKit({ media: 'yt/x', ad: () => ad });
  const v = fakeVideo({ time: 3, kit });
  kit.fns._resumeSeek(v, 600, 'yt/x', false, null);
  await kit.c.run(2000);
  assert.equal(v.seeks.length, 0, 'no seek during the ad');
  ad = false;
  await kit.c.run(4000);
  assert.deepEqual(v.seeks, [600]);
});

test('resume: an explicit start time in the address wins', () => {
  const { _urlHasStartTime } = contentFns(['_urlHasStartTime'], [], { location: { href: 'https://x.example/' } });
  for (const u of ['https://www.youtube.com/watch?v=abcdefghijk&t=90', 'https://youtu.be/abcdefghijk?t=1m5s', 'https://p.example/e/1?start=30',
    'https://www.youtube.com/watch?v=abcdefghijk&time_continue=12', 'https://v.example/watch#t=42']) assert.equal(_urlHasStartTime(u), true, u);
  for (const u of ['https://www.youtube.com/watch?v=abcdefghijk', 'https://1shows.bz/tv/1399-1-2', 'https://p.example/#top']) assert.equal(_urlHasStartTime(u), false, u);
  assert.match(CONTENT, /if \(_urlHasStartTime\(location\.href\)\) return;/);
});

test('resume: the history-click path uses the same sticky seek', () => {
  assert.match(CONTENT, /if \(pendingPos && pendingPos >= 10\) \{\n\s*_resumeSeek\(video, pendingPos, mediaId, true, null\);/);
  assert.doesNotMatch(CONTENT, /video\.played && video\.played\.length > 0\)\) return;/, 'the old give-up rule is gone');
});

// ── YouTube ads and the progress bar ──────────────────────────────────────────
test('youtube: an ad is detected from the player class or the ad overlay, only on YouTube', () => {
  const mk = (q, yt = true) => contentFns(['_ytAdShowing'], [], { _youtubeVideoId: () => (yt ? 'abcdefghijk' : null), document: { querySelector: q } });
  const pl = (cls) => ({ classList: { contains: (c) => cls.includes(c) } });
  assert.equal(mk((s) => (s.startsWith('#movie_player') ? pl(['ad-showing']) : null))._ytAdShowing(), true);
  assert.equal(mk((s) => (s.startsWith('#movie_player') ? pl(['ad-interrupting']) : null))._ytAdShowing(), true);
  assert.equal(mk((s) => (s.startsWith('#movie_player') ? pl([]) : s.includes('.ytp-skip-ad-button') ? {} : null))._ytAdShowing(), true);
  assert.equal(mk((s) => (s.startsWith('#movie_player') ? pl([]) : null))._ytAdShowing(), false);
  assert.equal(mk(() => pl(['ad-showing']), false)._ytAdShowing(), false, 'not YouTube');
  assert.equal(mk(() => { throw new Error('x'); })._ytAdShowing(), false);
});

test('youtube: no save, skip, resume or marks while an ad plays', () => {
  assert.match(extractFunction(CONTENT, '_saveBlocked'), /_ytAdShowing\(\)/);
  assert.match(CONTENT, /if \(!video\.isConnected\) return;\n\s*if \(_ytAdShowing\(\)\) return;\n\s*if \(segments\) _tlKeep\(\);/);
  assert.match(extractFunction(CONTENT, '_renderTimeline'), /if \(yt && _ytAdShowing\(\)\) return;/);
});

test('youtube: marks go into the desktop or mobile bar, never a hover preview', () => {
  const real = { closest: () => null, id: 'real' }, preview = { closest: () => ({}), id: 'preview' }, mobile = { closest: () => null, id: 'mobile' };
  const mk = (map) => contentFns(['_ytBar'], ['YT_BAR_SELECTORS'], { document: { querySelectorAll: (s) => map[s] || [] } })._ytBar();
  assert.equal(mk({ '.ytChapteredProgressBarHost': [preview, real] }).id, 'real');
  assert.equal(mk({ '.ytChapteredProgressBarHost': [preview], '.YtmProgressBarProgressBarLine': [mobile] }).id, 'mobile');
  assert.equal(mk({ '.ytp-progress-bar': [real] }).id, 'real');
  assert.equal(mk({ '.ytChapteredProgressBarHost': [preview] }), null);
  const { YT_BAR_SELECTORS } = contentFns([], ['YT_BAR_SELECTORS']);
  assert.deepEqual(j(YT_BAR_SELECTORS), ['.ytChapteredProgressBarHost', '.ytProgressBarLineHost', '.YtProgressBarLineHost',
    '.YtChapteredProgressBarHost', '.YtmProgressBarProgressBarLine', '.ytp-progress-bar']);
});

test('youtube: no bottom strip on YouTube; marks are redrawn when the player rebuilds its bar', () => {
  const r = extractFunction(CONTENT, '_renderTimeline');
  assert.match(r, /if \(yt && !ytBar\) return;/);
  assert.match(extractFunction(CONTENT, '_tlWatch'), /getElementById\('player-control-container'\)/);
  assert.match(extractFunction(CONTENT, '_tlKeep'), /_tlBox\.parentElement !== bar/);
});

test('sponsorblock: YouTube rows only; a row made for another length (> 3 s off) is dropped', async () => {
  const { ctx } = loadBackground();
  assert.deepEqual(j(ctx.sponsorBlockSegments([{ category: 'sponsor', actionType: 'skip', segment: [10, 40], videoDuration: 600.4 }])),
    { sponsor: [{ start_sec: 10, end_sec: 40, action: 'skip', votes: 0, video_duration: 600.4 }] });
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, []) });
  await bg.send({ type: 'FETCH_SEGMENTS_YT', videoId: 'dQw4w9WgXcQ' });
  assert.match(bg.calls[0].url, /&service=YouTube$/);
  const { _sbFitDuration } = contentFns(['_sbFitDuration'], [], { _ytAdShowing: () => false });
  const segs = { sponsor: [{ start_sec: 1, end_sec: 2, video_duration: 600 }, { start_sec: 3, end_sec: 4, video_duration: 612 }],
    intro: [{ start_sec: 5, end_sec: 6 }], full: 'exclusive_access' };
  assert.deepEqual(j(_sbFitDuration(segs, { duration: 602.5 })), { sponsor: [{ start_sec: 1, end_sec: 2, video_duration: 600 }], intro: [{ start_sec: 5, end_sec: 6 }], full: 'exclusive_access' });
  assert.equal(_sbFitDuration({ sponsor: [{ start_sec: 1, end_sec: 2, video_duration: 900 }] }, { duration: 600 }), null);
  assert.equal(_sbFitDuration(segs, { duration: NaN }), segs, 'length unknown yet: keep all');
});

// ── Cloud push ────────────────────────────────────────────────────────────────
function saveKit() {
  const c = clock();
  const sent = [];
  const w = {}; w.top = w;
  const g = {
    window: w, Date: c.Date, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, _resumeHoldUntil: 0, _ytAdShowing: () => false,
    getMediaId: () => 'tv/1', _refreshTabInfo: () => {}, cacheWrite: async () => {}, getUserId: async () => 'u-1',
    getSiteHostname: () => 'site.example', getSiteName: () => 'Site', getVideoTitle: () => 'Dark', _pageUrl: () => 'https://site.example/tv/1',
    prefs: { deviceName: 'Phone' }, navigator: { userAgent: 'Firefox' }, console,
    br: { runtime: { sendMessage: async (m) => { sent.push({ at: c.now(), m }); return { ok: true }; } }, storage: { local: { set: async () => {} } } },
  };
  const fns = contentFns(['savePlayback', '_saveBlocked', '_pushPlayback'], ['CLOUD_PUSH_MS'], g);
  return { c, sent, fns };
}

test('sync: a video that keeps playing reaches the cloud at least every 20 s (old code never pushed)', async () => {
  const { c, sent, fns } = saveKit();
  const v = { duration: 2400, currentTime: 60, isConnected: true };
  const timer = { id: null };
  const t0 = c.now();
  for (let i = 0; i < 12; i++) { v.currentTime += 5; fns.savePlayback(v, timer); await c.run(5000); }
  assert.ok(sent.length >= 3, 'pushes while playing: ' + sent.length);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 20000, 'at most every 20 s');
  assert.ok(sent[0].at - t0 <= 2000, 'first push soon after the first save');
  const pos = sent.map((s) => s.m.body.playback_time);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] >= pos[i - 1] + 20, 'each push carries the newest position: ' + pos.join(','));
});

test('sync: pause and switching away push at once', async () => {
  const { c, sent, fns } = saveKit();
  const v = { duration: 2400, currentTime: 300, isConnected: true };
  const timer = { id: null };
  fns.savePlayback(v, timer); await c.run(3000);
  const n = sent.length;
  v.currentTime = 321; fns.savePlayback(v, timer, true); await c.run(0);
  assert.equal(sent.length, n + 1);
  assert.equal(sent[sent.length - 1].m.body.playback_time, 321);
  assert.match(CONTENT, /video\.addEventListener\('pause', {2}\(\) => \{ savePlayback\(video, saveTimer, true\); \}\);/);
  assert.match(CONTENT, /document\.visibilityState === 'hidden' && video\.isConnected\) savePlayback\(video, saveTimer, true\)/);
});

test('sync: the background sends positions saved since its last run, every 5 minutes, oldest first', async () => {
  const cache = {
    'tv/1': { p: 600, d: 2400, t: 1000, title: 'Dark', site: 'a.example', url: 'https://a.example/tv/1' },
    'tv/2': { p: 5, d: 2400, t: 2000, title: 'Too early' },
    'tv/3': { p: 900, d: 2400, t: 3000, title: '' },
    'movie/603': { p: 1200, d: 8160, t: 4000, title: 'The Matrix', site: 'b.example' },
  };
  const storage = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon', skipstream_install_id: 'u-1', skipstream_cache: cache };
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage });
  assert.deepEqual(j(await bg.ctx.pushUnsyncedHistory()), { pushed: 2 });
  const rows = bg.calls.filter((x) => x.url.endsWith('/rpc/ss_put_playback')).map((x) => JSON.parse(x.opts.body).p_row);
  assert.deepEqual(rows.map((r) => r.media_id), ['tv/1', 'movie/603']);
  assert.equal(rows[0].updated_at, new Date(1000).toISOString(), 'the save time, so newer wins on the server');
  assert.equal(storage.skipstream_last_push_t, 4000);
  assert.deepEqual(j(await bg.ctx.pushUnsyncedHistory()), { pushed: 0 }, 'nothing new');
  assert.match(BG, /await flushOfflineQueue\(\);\n\s*await pushUnsyncedHistory\(\);/);
});

test('sync: a failed push keeps the mark, so the next run tries again', async () => {
  const storage = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon', skipstream_install_id: 'u-1',
    skipstream_cache: { 'tv/1': { p: 600, d: 2400, t: 1000, title: 'Dark' } } };
  const bg = loadBackground({ fetchImpl: () => fakeResponse(401, { message: 'no' }), storage });
  assert.deepEqual(j(await bg.ctx.pushUnsyncedHistory()), { pushed: 0 });
  assert.equal(storage.skipstream_last_push_t, undefined);
  const none = loadBackground({ storage: { skipstream_cache: storage.skipstream_cache } });
  assert.deepEqual(j(await none.ctx.pushUnsyncedHistory()), { pushed: 0 }, 'no Supabase: nothing sent');
  assert.equal(none.calls.length, 0);
});

// ── New skip sources ──────────────────────────────────────────────────────────
const route = (map) => (url) => { for (const [k, v] of Object.entries(map)) if (url.includes(k)) return typeof v === 'function' ? v(url) : fakeResponse(200, v); return fakeResponse(404, {}); };

test('theintrodb: TMDB id, season, episode and length; credits without an end run to the end', async () => {
  const bg = loadBackground({ fetchImpl: route({ 'api.theintrodb.org': { intro: [{ start_ms: 5000, end_ms: 65000 }], credits: [{ start_ms: 3200000, end_ms: null }], recap: [] } }) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: null, season: 1, episode: 2, tmdbId: 1399, durationSec: 3300 });
  assert.deepEqual(j(r.data), { intro: { start_sec: 5, end_sec: 65 }, outro: { start_sec: 3200, end_sec: 3300 } });
  const u = bg.calls.find((x) => x.url.includes('api.theintrodb.org')).url;
  assert.equal(u, 'https://api.theintrodb.org/v1/media?tmdb_id=1399&season=1&episode=2&duration_ms=3300000');
  assert.equal(bg.calls.some((x) => x.url.includes('introdb.app') || x.url.includes('skipdb')), false, 'no IMDb id: IMDb sources are not asked');
});

test('theintrodb: IntroDB still wins for the same part; a movie sends no season', async () => {
  const bg = loadBackground({ fetchImpl: route({
    'api.introdb.app': { imdb_id: 'tt0133093', intro: { start_ms: 10000, end_ms: 40000 }, recap: null, outro: null },
    'api.theintrodb.org': { intro: [{ start_ms: 1000, end_ms: 2000 }], preview: [{ start_ms: 8000000, end_ms: 8100000 }] } }) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0133093', season: 0, episode: 0, isMovie: true, tmdbId: 603 });
  assert.equal(r.data.intro.start_sec, 10);
  assert.ok(r.data.preview);
  assert.ok(bg.calls.some((x) => x.url === 'https://api.theintrodb.org/v1/media?tmdb_id=603'));
});

test('theintrodb: an IMDb id becomes a TMDB id only with the user\'s own TMDB key', async () => {
  const fx = route({ '/find/tt0903747': { tv_results: [{ id: 1396 }] }, 'api.theintrodb.org': { intro: [{ start_ms: 1000, end_ms: 50000 }] } });
  const withKey = loadBackground({ fetchImpl: fx, storage: { tmdbApiKey: 'k123' } });
  const r = await withKey.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1 });
  assert.ok(withKey.calls.some((x) => x.url.startsWith('https://api.theintrodb.org/v1/media?tmdb_id=1396&season=1&episode=1')));
  assert.equal(r.data.intro.end_sec, 50);
  const noKey = loadBackground({ fetchImpl: fx });
  await noKey.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1 });
  assert.equal(noKey.calls.some((x) => x.url.includes('themoviedb') || x.url.includes('theintrodb')), false);
});

test('aniskip: openings, endings and recaps by MyAnimeList id and episode length', async () => {
  const bg = loadBackground({ fetchImpl: route({ 'api.aniskip.com': { found: true, results: [
    { skipType: 'op', interval: { startTime: 60, endTime: 150 } }, { skipType: 'ed', interval: { startTime: 1300, endTime: 1390 } },
    { skipType: 'recap', interval: { startTime: 0, endTime: -1 } }] } }) });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: null, season: 1, episode: 3, malId: 21, anime: true, durationSec: 1420.4 });
  assert.deepEqual(j(r.data), { intro: { start_sec: 60, end_sec: 150 }, outro: { start_sec: 1300, end_sec: 1390 } });
  assert.equal(bg.calls[0].url, 'https://api.aniskip.com/v2/skip-times/21/3?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=1420');
  const { ctx } = loadBackground();
  assert.equal(ctx.aniSkipSegments({ found: false, results: [] }), null);
});

test('jikan: an anime title gives a MyAnimeList id only on an exact, single match', async () => {
  const frieren = { mal_id: 52991, title: 'Sousou no Frieren', title_english: "Frieren: Beyond Journey's End", titles: [], title_synonyms: [] };
  const okBg = loadBackground({ fetchImpl: route({ 'api.jikan.moe': { data: [frieren, { mal_id: 1, title: 'Frieren Recap Special' }] },
    'api.aniskip.com': { found: true, results: [{ skipType: 'op', interval: { startTime: 0, endTime: 89 } }] } }) });
  const r = await okBg.send({ type: 'FETCH_SEGMENTS', imdbId: null, season: 1, episode: 3, anime: true, title: "Watch Frieren: Beyond Journey's End Episode 3 Eng Sub" });
  assert.ok(okBg.calls.some((x) => x.url.startsWith('https://api.aniskip.com/v2/skip-times/52991/3?')));
  assert.equal(r.data.intro.end_sec, 89);
  const amb = loadBackground({ fetchImpl: route({ 'api.jikan.moe': { data: [{ mal_id: 10, title: 'Monster' }, { mal_id: 11, title: 'Monster' }] } }) });
  await amb.send({ type: 'FETCH_SEGMENTS', imdbId: null, season: 1, episode: 1, anime: true, title: 'Monster' });
  assert.equal(amb.calls.some((x) => x.url.includes('aniskip')), false, 'two shows with one name: no answer');
  const notAnime = loadBackground({ fetchImpl: route({}) });
  await notAnime.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1, title: 'Breaking Bad' });
  assert.equal(notAnime.calls.some((x) => x.url.includes('jikan')), false, 'Jikan only on anime sites');
});

test('anime: MyAnimeList ids are read from the page (link, data attribute, script)', () => {
  const f = CONTENT.slice(CONTENT.indexOf('if (!info.malId) {'), CONTENT.indexOf('if (!info.imdbId) {\n      document.querySelectorAll(\'meta[content]\')'));
  assert.match(f, /a\[href\*="myanimelist\.net\/anime\/"\]/);
  assert.match(f, /\[data-mal-id\],\[data-malid\],\[data-mal\]/);
  assert.match(f, /mal_id\|malId\|idMal\|malID/);
  const { _animeSite } = contentFns(['_animeSite'], [], { _siteHost: () => globalThis.__h });
  for (const [h, want] of [['hianime.to', true], ['www.crunchyroll.com', true], ['aniwatch.to', true], ['1shows.bz', false], ['www.youtube.com', false]]) {
    globalThis.__h = h;
    assert.equal(contentFns(['_animeSite'], [], { _siteHost: () => h })._animeSite(), want, h);
  }
  delete globalThis.__h;
  void _animeSite;
});

test('chapters: <track kind=chapters> cues and JSON-LD clips named Intro, Recap, Credits', () => {
  const ld = { '@type': 'VideoObject', hasPart: [{ '@type': 'Clip', name: 'Recap', startOffset: 0, endOffset: 60 },
    { '@type': 'Clip', name: 'End credits', startOffset: 1300, endOffset: 1400 }, { '@type': 'Clip', name: 'The big fight', startOffset: 400, endOffset: 500 }] };
  const doc = { querySelectorAll: (s) => (s.includes('ld+json') ? [{ textContent: JSON.stringify(ld) }, { textContent: '{bad json' }] : []) };
  const { _pageChapters } = contentFns(['_pageChapters', '_chapterKey'], ['CHAPTER_KEY'], { document: doc });
  const track = { kind: 'chapters', mode: 'disabled', cues: [{ text: 'Intro', startTime: 0, endTime: 85 }, { text: 'Part 1', startTime: 85, endTime: 900 }] };
  const r = j(_pageChapters({ textTracks: [track, { kind: 'subtitles', cues: [{ text: 'Intro', startTime: 1, endTime: 2 }] }] }));
  assert.deepEqual(r, { intro: { start_sec: 0, end_sec: 85 }, recap: { start_sec: 0, end_sec: 60 }, outro: { start_sec: 1300, end_sec: 1400 } });
  assert.equal(track.mode, 'hidden', 'cues load only when the track is not disabled');
  const empty = contentFns(['_pageChapters', '_chapterKey'], ['CHAPTER_KEY'], { document: { querySelectorAll: () => [] } });
  assert.equal(empty._pageChapters({ textTracks: [] }), null);
  assert.match(CONTENT, /if \(!fetched && !ytId\) fetched = _pageChapters\(video\);/, 'lowest priority, never on YouTube');
});

// ── Titles and ids ────────────────────────────────────────────────────────────
test('titles: release tags, brackets and emoji are removed; the year in brackets stays', () => {
  const { ctx } = loadBackground();
  assert.equal(ctx._stripRelease('The Matrix (1999) [1080p] WEB-DL x264 Eng Sub 🎬 HD'), 'The Matrix (1999)');
  assert.equal(ctx._stripRelease('Dune Part Two 2160p BluRay HEVC Dual Audio Watch Online Free'), 'Dune Part Two');
  assert.equal(ctx._stripRelease('Spirited Away (Dubbed) (HD)'), 'Spirited Away');
  assert.equal(ctx._stripRelease('Love, Death & Robots (Volume 3)'), 'Love, Death & Robots (Volume 3)', 'real words in brackets stay');
  assert.equal(ctx.cleanMediaTitle('Watch Oppenheimer (2023) [1080p] Online Free | 1Shows').q, 'Oppenheimer');
});

test('titles: fuzzy similarity is 1 for the same name and low for different films', () => {
  const { ctx } = loadBackground();
  assert.equal(ctx._titleSim('The Matrix', 'Matrix'), 1);
  assert.ok(ctx._titleSim('Spider-Man: No Way Home', 'Spiderman No Way Home') >= 0.9);
  assert.ok(ctx._titleSim('Dark', 'Dune') < 0.5);
  assert.equal(ctx._titleSim('', 'x'), 0);
});

test('posters: closest name only when it is close (>= 0.75) and the year is within 1', async () => {
  const fx = (results) => route({ '/search/movie': { results }, '/search/tv': { results: [] } });
  const near = loadBackground({ fetchImpl: fx([{ title: 'Spiderman No Way Home', poster_path: '/p.jpg', release_date: '2021-12-15' }]) });
  assert.equal((await near.ctx.tmdbPoster('x/1', 'Spider-Man: No Way Home (2021)', 'k')).path, '/p.jpg');
  const far = loadBackground({ fetchImpl: fx([{ title: 'The Matrix Reloaded', poster_path: '/r.jpg', release_date: '2003-05-15' }]) });
  assert.equal((await far.ctx.tmdbPoster('x/1', 'The Matrix (1999)', 'k')).path, null, 'wrong film: no poster');
  const yearOff = loadBackground({ fetchImpl: fx([{ title: 'Spiderman No Way Home', poster_path: '/old.jpg', release_date: '2019-01-01' }]) });
  assert.equal((await yearOff.ctx.tmdbPoster('x/1', 'Spider-Man: No Way Home (2021)', 'k')).path, null, 'year more than 1 off');
});

test('title search: a near name counts only when it is the single >= 0.9 match of the same year', async () => {
  const fx = (results) => route({ '/search/movie': { results }, '/external_ids': { imdb_id: 'tt10872600' } });
  const one = loadBackground({ fetchImpl: fx([{ id: 634649, title: 'Spiderman No Way Home', release_date: '2021-12-15', popularity: 50 }]) });
  const r = await one.ctx.tmdbFindTitle('Spider-Man: No Way Home', 2021, 'movie', 'k');
  assert.deepEqual([r.imdbId, r.tmdbId], ['tt10872600', 634649]);
  const noYear = loadBackground({ fetchImpl: fx([{ id: 634649, title: 'Spiderman No Way Home', release_date: '2021-12-15' }]) });
  assert.equal((await noYear.ctx.tmdbFindTitle('Spider-Man: No Way Home', null, 'movie', 'k')).imdbId, null, 'no year: exact names only');
  const two = loadBackground({ fetchImpl: fx([{ id: 1, title: 'Spiderman No Way Home', release_date: '2021-01-01' }, { id: 2, title: 'Spiderman: No Way Home', release_date: '2021-02-01' }]) });
  assert.equal((await two.ctx.tmdbFindTitle('Spider-Man: No Way Home', 2021, 'movie', 'k')).imdbId, null, 'two near names: no answer');
});

test('ids: embed player addresses give the TMDB id, kind and S/E', () => {
  const blank = () => ({ imdbId: null, tmdbId: null, tmdbKind: null, season: null, episode: null, year: null });
  const fns = (href) => { const u = new URL(href); return contentFns(['parseUrlInfo', 'extractSeEpisode', 'clampSE', 'parsePathTitle', 'titleFromSlug'], ['SE_REGEX', 'URL_SE_PATTERNS'],
    { location: { href: u.href, pathname: u.pathname, search: u.search }, parseInt, Number, Math, isFinite }); };
  const cases = [
    ['https://player.example/play?video_id=1399&tmdb=1&s=1&e=2', { tmdbId: 1399, tmdbKind: 'tv', season: 1, episode: 2 }],
    ['https://player.example/play?video_id=603&tmdb=1', { tmdbId: 603, tmdbKind: 'movie' }],
    ['https://embed.example/movie/tmdb/603', { tmdbId: 603, tmdbKind: 'movie' }],
    ['https://embed.example/tv/tmdb/1399-1-2', { tmdbId: 1399, tmdbKind: 'tv', season: 1, episode: 2 }],
    ['https://embed.example/tv/1399-3-7', { tmdbId: 1399, season: 3, episode: 7 }],
  ];
  for (const [href, want] of cases) {
    const info = blank();
    fns(href).parseUrlInfo(info);
    for (const [k, v] of Object.entries(want)) assert.equal(info[k], v, href + ' ' + k);
  }
  const info = blank();
  fns('https://player.example/play?video_id=abc&tmdb=1').parseUrlInfo(info);
  assert.equal(info.tmdbId, null, 'video_id must be a number');
});

test('ids: several page names are tried for a TMDB match, at most 3, and network trouble stops the loop', () => {
  assert.match(CONTENT, /for \(const c of \[info\.title, info\.ldName, !yt \? pageTitle : '', h1\]\)/);
  assert.match(CONTENT, /for \(const q of yt \? \[\] : qs\.slice\(0, 3\)\)/);
  assert.match(CONTENT, /if \(!hit\) break;/);
});

// ── Supabase setup helper ─────────────────────────────────────────────────────
function setupKit(sql) {
  const els = { sbSetup: { hidden: true }, sbOpenSql: { href: '' } };
  const g = { URL, $: (id) => els[id] || null, br: { runtime: { getURL: (p) => 'moz-extension://x/' + p } },
    fetch: async (u) => (u === 'moz-extension://x/supabase_setup.sql' ? { ok: true, text: async () => sql } : { ok: false }) };
  const code = ['supabaseRef', 'setupSql', 'showSbSetup'].map((n) => extractFunction(OPTIONS, n)).join('\n') + '\n;({ supabaseRef, showSbSetup })';
  return { els, ...vm.runInContext(code, vm.createContext(g)) };
}

test('supabase: setup helper opens the project\'s SQL editor with the script filled in', async () => {
  const k = setupKit('create table x();');
  assert.equal(k.supabaseRef('https://abcdefghijklmnop.supabase.co'), 'abcdefghijklmnop');
  assert.equal(k.supabaseRef('https://evil.example/supabase.co'), null);
  await k.showSbSetup('https://abcdefghijklmnop.supabase.co');
  assert.equal(k.els.sbSetup.hidden, false);
  assert.equal(k.els.sbOpenSql.href, 'https://supabase.com/dashboard/project/abcdefghijklmnop/sql/new?content=' + encodeURIComponent('create table x();'));
  const big = setupKit('x'.repeat(61000));
  await big.showSbSetup('https://abcdefghijklmnop.supabase.co');
  assert.equal(big.els.sbOpenSql.href, 'https://supabase.com/dashboard/project/abcdefghijklmnop/sql/new', 'too long for an address: plain editor');
  const other = setupKit('x');
  await other.showSbSetup('https://db.example.com');
  assert.equal(other.els.sbOpenSql.href, 'https://supabase.com/dashboard');
});

test('supabase: the real setup script fits in the address, ships in every ZIP, and Settings may read it', () => {
  assert.ok(encodeURIComponent(read('supabase_setup.sql')).length < 60000);
  const wf = (n) => read('.github/workflows/' + n);
  assert.equal((wf('release.yml').match(/supabase_setup\.sql/g) || []).length >= 2, true, 'release: Firefox and Chrome');
  for (const n of ['amo-submit.yml', 'cws-submit.yml', 'validate.yml']) assert.ok(wf(n).includes('supabase_setup.sql'), n);
  assert.match(wf('validate.yml'), /for f in [^\n]*supabase_setup\.sql[^\n]*; do\n\s*if ! unzip -l skipstream-firefox\.zip/);
  assert.match(wf('validate.yml'), /for f in [^\n]*supabase_setup\.sql[^\n]*; do\n\s*if ! unzip -l skipstream-chrome\.zip/);
  const ff = JSON.parse(read('manifest.json')), cr = JSON.parse(read('manifest-chrome.json'));
  for (const csp of [ff.content_security_policy, cr.content_security_policy.extension_pages]) {
    assert.match(csp, /connect-src 'self' /, 'Settings fetches its own supabase_setup.sql');
    for (const h of ['https://api.theintrodb.org', 'https://api.aniskip.com', 'https://api.jikan.moe']) assert.ok(csp.includes(h), h);
  }
  assert.match(extractFunction(OPTIONS, 'verifySupabase'), /showSbSetup\(base\);/);
});

// ── Skipped notice ────────────────────────────────────────────────────────────
test('notice: "Skipped X, Undo" is off by default and synced, backed up and imported like other prefs', () => {
  assert.match(extractConst(CONTENT, 'PREF_DEFAULTS'), /skipNotice: false/);
  assert.ok(extractConst(BG, 'SYNC_PREF_KEYS').includes("'skipNotice'"));
  assert.ok(extractConst(OPTIONS, 'CLOUD_PREF_ALLOW').includes("'skipNotice'"));
  assert.match(OPTIONS, /'sbModes', 'showTimeline', 'skipNotice', 'resumeNotice', 'ccButton', 'subtitle_cc_pos'\];\n\s*const STATS/);
  assert.match(OPTIONS, /S\.subOutline, S\.showTimeline, S\.skipNotice/);
  assert.ok(read('options.html').includes('id="skipNotice"'));
});

test('undo: Alt+Z undoes the last automatic skip within 30 s, else goes back 15 s', () => {
  assert.match(CONTENT, /if \(ls && Date\.now\(\) - ls\.at < 30000 && ls\.media === getMediaId\(\)\) \{/);
  assert.match(CONTENT, /video\.currentTime = ls\.from;\n\s*\} else \{\n\s*video\.currentTime = Math\.max\(0, video\.currentTime - 15\);/);
});

// ── Subtitle edge style ───────────────────────────────────────────────────────
test('subtitles: letter edge is outline, drop shadow, raised or none; old outline switch still counts', () => {
  const { _subLook } = contentFns(['_subLook', '_subEdge'], ['SUB_FONTS', 'SUB_EDGES'], { Math, Number, String, Object });
  const look = (st) => _subLook(st).textShadow;
  assert.match(look({ edge: 'outline' }), /-1px -1px 0 #000/);
  assert.match(look({ edge: 'shadow' }), /^2px 2px 3px/);
  assert.match(look({ edge: 'raised' }), /rgba\(255,255,255,0\.45\)/);
  assert.equal(look({ edge: 'none' }), 'none');
  assert.equal(look({ outline: false }), 'none', '1.12 switch off, no edge saved');
  assert.equal(look({ outline: false, edge: 'shadow' }), look({ edge: 'shadow' }), 'a saved edge wins');
  assert.equal(look({ edge: 'constructor' }), look({}), 'unknown values fall back to outline');
  const html = read('options.html');
  assert.match(html, /<select id="subEdge">\s*<option value="outline">Outline<\/option>\s*<option value="shadow">Drop shadow<\/option>\s*<option value="raised">Raised<\/option>\s*<option value="depressed">Depressed<\/option>\s*<option value="glow">Soft glow<\/option>\s*<option value="none">None<\/option>/);
  assert.ok(html.includes('id="subFontSize"'), 'text size slider is still there');
});

test('subtitles: edge is saved with the old switch kept in step, synced, backed up and checked on import', () => {
  assert.match(OPTIONS, /br\.storage\.local\.set\(\{ \[S\.subEdge\]: v, \[S\.subOutline\]: v !== 'none' \}\)/);
  assert.ok(extractConst(BG, 'SYNC_PREF_KEYS').includes("'subtitle_edge'"));
  assert.ok(extractConst(OPTIONS, 'CLOUD_PREF_ALLOW').includes("'subtitle_edge'"));
  assert.match(OPTIONS, /'subtitle_outline', 'subtitle_edge', 'subtitle_weight', 'subtitle_offsets'/);
  const code = extractConst(OPTIONS, 'SUB_EDGE_VALUES') + '\nconst S = { subEdge: "subtitle_edge" }; const IMPORT_BOOL = new Set();\n' + extractFunction(OPTIONS, 'importValueOk') + '\n;importValueOk';
  const ok = vm.runInNewContext(code);
  assert.equal(ok('subtitle_edge', 'raised'), true);
  assert.equal(ok('subtitle_edge', 'sparkle'), false);
  assert.match(CONTENT, /if \('subtitle_edge' in changes\)/);
});

// ── Deep site report ──────────────────────────────────────────────────────────
function el(attrs = {}, text = '', extra = {}) { return { textContent: text, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, getBoundingClientRect: () => ({ width: 0, height: 0 }), ...extra }; }
function probeRun({ perf = true, wrapped = true, buttons = null } = {}) {
  const btns = buttons || [el({ 'data-link': 'https://vidsrc.xyz/embed/movie/603?token=SECRET' }, ' Server 1 '), el({ 'data-server': '2' }, 'Server 2')];
  const map = (s) => {
    if (s.includes('[data-link]')) return btns;
    if (s === 'a[href*="embed"]') return [el({ href: '//2embed.example/embed/603?sig=SECRET' }, 'Mirror')];
    if (s === '[onclick]') return [el({ onclick: "load('https://upstream.example/e/abc?x=SECRET')" }, 'Upstream')];
    if (s === 'script:not([src])') return [el({}, 'var f="https://cdn.example/hls/master.m3u8?sig=SECRET"; var g="https://x.example/app.js";')];
    if (s.startsWith('iframe[data-src]')) return [el({ 'data-src': '//lazy.example/embed/1' })];
    if (s === 'track') return [el({ kind: 'subtitles', srclang: 'en', label: 'English', src: 'en.vtt' }, '', { src: 'https://subs.example/en.vtt?k=SECRET' })];
    return [];
  };
  const ctx = vm.createContext({ document: { title: 'T', referrer: '', querySelector: () => null, querySelectorAll: map }, location: { href: 'https://1shows.bz/movie/603' }, URL });
  ctx.window = ctx; ctx.top = ctx;
  if (wrapped) ctx.wrappedJSObject = { jwplayer: Object.assign(function () {}, { version: '8.33.0' }), Hls: { version: '1.5.7' }, videojs: { VERSION: '<img onerror=x>' } };
  if (perf) ctx.performance = { getEntriesByType: () => [{ name: 'https://cdn.example/hls/index.m3u8?t=SECRET', initiatorType: 'xmlhttprequest' }, { name: 'https://x.example/style.css', initiatorType: 'link' }] };
  return j(vm.runInContext(read('content-scripts/probe.js'), ctx));
}

test('site report: deep scan lists source buttons, loaded media, script addresses, lazy frames, subtitle files, player code', () => {
  const r = probeRun();
  assert.deepEqual(r.sources, ['Server 1 -> vidsrc.xyz/embed/movie/603', 'Server 2 -> data-server "2"', 'Mirror -> 2embed.example/embed/603', 'Upstream -> upstream.example/e/abc']);
  assert.deepEqual(r.loaded, ['cdn.example/hls/index.m3u8 (xmlhttprequest)']);
  assert.deepEqual(r.inScripts, ['cdn.example/hls/master.m3u8']);
  assert.deepEqual(r.lazyFrames, ['lazy.example/embed/1 (not loaded yet)']);
  assert.deepEqual(r.trackFiles, ['subtitles:en English subs.example/en.vtt']);
  assert.deepEqual(r.globals, ['jwplayer 8.33.0', 'videojs', 'Hls 1.5.7'], 'odd version strings are not copied');
  assert.equal(JSON.stringify(r).includes('SECRET'), false, 'host and path only, never a query string');
  assert.equal(r.error, undefined);
});

test('site report: every list stops at 30; no performance or Firefox globals is not an error', () => {
  const many = Array.from({ length: 45 }, (_, i) => el({ 'data-url': 'https://s' + i + '.example/e/' + i }, 'S' + i));
  const r = probeRun({ perf: false, wrapped: false, buttons: many });
  assert.equal(r.sources.length, 30);
  assert.deepEqual([r.loaded, r.globals], [[], []]);
  assert.equal(r.error, undefined);
});

test('site report: the popup prints the deep scan in labelled groups', () => {
  const siteReportText = vm.runInNewContext('(' + extractFunction(read('popup.js'), 'siteReportText') + ')', { Array });
  const t = siteReportText({ ok: true, frames: [{ frame: '1shows.bz/movie/603', top: true, skipstream: true, ...probeRun() }] }, 'v1.13.0');
  for (const want of ['  page player code: jwplayer 8.33.0, videojs, Hls 1.5.7', '  source buttons (4):', '    Server 1 -> vidsrc.xyz/embed/movie/603',
    '  lazy frames (1):', '  subtitle files (1):', '  media loaded (1):', '    cdn.example/hls/index.m3u8 (xmlhttprequest)', '  media in scripts (1):'])
    assert.ok(t.includes(want), want + '\n---\n' + t);
});

// ── AMO listing ───────────────────────────────────────────────────────────────
test('amo: categories are a flat list (API v5), summary fits, text has no false claims', () => {
  // Child process: before 1.13 the script exits at load without AMO keys.
  const env = { ...process.env }; delete env.AMO_API_KEY; delete env.AMO_API_SECRET;
  const r = spawnSync(process.execPath, ['scripts/amo-update.js', '--print-listing'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, 'prints the listing offline: ' + r.stderr);
  const b = JSON.parse(r.stdout);
  assert.deepEqual(j(b.categories), ['photos-music-videos']);
  assert.ok(b.summary['en-US'].length <= 250);
  const d = b.description['en-US'];
  assert.doesNotMatch(d, /no telemetry|required for skip segments|IntroDB key/i);
  for (const w of ['TheIntroDB', 'AniSkip', 'SponsorBlock', 'PRIVACY.md', 'own Supabase project']) assert.ok(d.includes(w), w);
  assert.match(read('scripts/amo-update.js'), /if \(require\.main === module\)/);
});

// ── Hand-over addendum items ──────────────────────────────────────────────────
test('supabase: a publishable key goes in apikey only; a legacy JWT key also as Bearer', async () => {
  const { ctx } = loadBackground();
  assert.deepEqual(j(ctx.sbAuth('sb_publishable_abc123')), { apikey: 'sb_publishable_abc123' });
  assert.deepEqual(j(ctx.sbAuth('aaa.bbb.ccc')), { apikey: 'aaa.bbb.ccc', Authorization: 'Bearer aaa.bbb.ccc' });
  for (const src of [BG, OPTIONS]) {
    assert.doesNotMatch(src, /Bearer \$\{supabaseAnonKey\}|'Bearer ' \+ (?:key|sbKey)\b/, 'every Supabase call uses sbAuth');
  }
  const storage = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'sb_publishable_abc123', skipstream_install_id: 'u-1',
    skipstream_cache: { 'tv/1': { p: 600, d: 2400, t: 1000, title: 'Dark' } } };
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage });
  await bg.ctx.pushUnsyncedHistory();
  const h = bg.calls.find((x) => x.url.endsWith('/rpc/ss_put_playback')).opts.headers;
  assert.equal(h.apikey, 'sb_publishable_abc123');
  assert.equal('Authorization' in h, false);
  assert.match(read('options.html'), /placeholder="sb_publishable_… or eyJhbGci…"/);
});

test('resume: a history click is honoured for 120 s (slow phones); local history keeps 300', () => {
  assert.match(CONTENT, /const PENDING_MAX_MS = 120000;/);
  assert.match(CONTENT, /if \(Date\.now\(\) - pending\.ts > PENDING_MAX_MS\) \{/);
  assert.match(CONTENT, /const CACHE_MAX = 300;/);
  assert.equal((CONTENT.match(/keys\.length > CACHE_MAX\) \{\n\s*keys\.sort\(\(a, b\) => cache\[a\]\.t - cache\[b\]\.t\)\.slice\(0, keys\.length - CACHE_MAX\)/g) || []).length, 2);
  assert.doesNotMatch(CONTENT, /keys\.length > 100/);
  assert.match(OPTIONS, /const HISTORY_MAX = 300;/);
});

test('supabase: the setup script no longer makes ss_put_creds and drops it on old projects', () => {
  const sql = read('supabase_setup.sql');
  assert.doesNotMatch(sql, /create or replace function public\.ss_put_creds/);
  assert.doesNotMatch(sql, /grant execute on function public\.ss_put_creds/);
  assert.match(sql, /drop function if exists public\.ss_put_creds\(text, jsonb\);/);
  assert.match(sql, /'rpc_ss_put_creds_gone',\n\s*not exists/);
  for (const src of [BG, OPTIONS, CONTENT]) assert.equal(src.includes('ss_put_creds'), false);
});

// ── Release 1.13.0 ────────────────────────────────────────────────────────────
test('release: 1.13.0 in all 7 places and updates.json', () => {
  const v = '1.13.0';
  assert.equal(JSON.parse(read('manifest.json')).version, v);
  assert.equal(JSON.parse(read('manifest-chrome.json')).version, v);
  assert.ok(read('popup.js').startsWith('/* SkipStream - popup v' + v + ' */'));
  assert.ok(read('popup.css').startsWith('/* SkipStream popup - v' + v));
  assert.ok(read('README.md').includes('version-' + v + '-green') && read('README.md').includes('releases/tag/v' + v));
  assert.match(read('CHANGELOG.md'), new RegExp('^# Changelog\\n\\n## \\[' + v.replace(/\./g, '\\.') + '\\] - 2026-10-05\\n'));
  const u = JSON.parse(read('updates.json')).addons['skipstream@extension'].updates;
  assert.equal(u[u.length - 1].version, v);
  assert.ok(u[u.length - 1].update_link.endsWith('/v' + v + '/skipstream-' + v + '-firefox.zip'));
});

test('privacy: every host the extension may contact is named in PRIVACY.md', () => {
  const p = read('PRIVACY.md');
  const csp = JSON.parse(read('manifest.json')).content_security_policy;
  const hosts = csp.split('connect-src')[1].split(/\s+/).filter((x) => x.startsWith('https://')).map((x) => x.replace('https://', '').replace('*.', ''));
  assert.ok(hosts.length >= 15);
  for (const h of hosts) assert.ok(p.includes(h), h);
  assert.equal(JSON.parse(read('manifest-chrome.json')).content_security_policy.extension_pages, csp, 'both manifests allow the same hosts');
  for (const w of ['TheIntroDB', 'AniSkip', 'Jikan', 'last 300 videos', 'ss_put_creds', 'Site report']) assert.ok(p.includes(w), w);
});

// ── One site, one name ────────────────────────────────────────────────────────
test('sites: www., m. and mobile. hosts are one site; real subdomains stay', () => {
  const { _canonHost } = contentFns(['_canonHost'], [], {});
  for (const [h, want] of [['m.youtube.com', 'youtube.com'], ['www.youtube.com', 'youtube.com'], ['WWW.Netflix.com', 'netflix.com'], ['mobile.twitter.com', 'twitter.com'],
    ['www.m.example.com', 'example.com'], ['www2.site.org', 'site.org'], ['music.youtube.com', 'music.youtube.com'], ['app.plex.tv', 'app.plex.tv'], ['m.tv', 'm.tv'], ['', '']])
    assert.equal(_canonHost(h), want, h);
  const canonO = vm.runInNewContext(extractFunction(OPTIONS, 'canonHost') + ';canonHost');
  assert.equal(canonO('m.youtube.com'), 'youtube.com', 'Settings uses the same rule');
});

test('sites: the same page on www. and m. gets one id; positions saved under the old id still resume', () => {
  const mk = (href) => { const u = new URL(href); return contentFns(['getMediaId', '_youtubeVideoId', '_canonHost', '_legacyMediaId'], [], { location: { href: u.href, hostname: u.hostname, pathname: u.pathname, search: u.search } }); };
  const a = mk('https://m.example.com/watch/the-matrix?id=603'), b = mk('https://www.example.com/watch/the-matrix?id=603');
  assert.equal(a.getMediaId(), 'example.com/watch/the-matrix?id=603');
  assert.equal(b.getMediaId(), a.getMediaId());
  assert.equal(a._legacyMediaId(), 'm.example.com/watch/the-matrix?id=603');
  assert.equal(mk('https://example.com/watch/x').getMediaId(), 'example.com/watch/x');
  assert.equal(mk('https://example.com/watch/x')._legacyMediaId(), null);
  assert.equal(mk('https://m.youtube.com/watch?v=dQw4w9WgXcQ').getMediaId(), 'yt/dQw4w9WgXcQ');
  assert.equal(mk('https://m.youtube.com/watch?v=dQw4w9WgXcQ')._legacyMediaId(), null);
  assert.match(CONTENT, /pending\.mediaId !== mediaId && pending\.mediaId !== _legacyMediaId\(mediaId\)/);
  assert.match(CONTENT, /saved = await cacheRead\(legacyId\);/);
  assert.match(CONTENT, /function getSiteHostname\(\) \{ return _canonHost\(_siteHost\(\)\); \}/);
});

test('sites: History shows one entry and one filter name for www., m. and desktop', () => {
  const code = ['_ssTs', 'canonHost', 'canonMediaKey', 'getHistoryItems'].map((n) => extractFunction(OPTIONS, n)).join('\n') + ';getHistoryItems';
  const g = { historySource: 'all', _histLocal: [{ mediaId: 'm.example.com/watch/x', site: 'example.com', updated: 2000, ts: 2000 }],
    _histCloud: [{ mediaId: 'www.example.com/watch/x', site: 'example.com', updated: new Date(1000).toISOString() }, { mediaId: 'yt/dQw4w9WgXcQ', site: 'youtube.com', updated: new Date(500).toISOString() }] };
  const items = vm.runInNewContext(code, g)();
  assert.equal(items.length, 2, 'www. and m. copies are one entry');
  assert.equal(items[0].mediaId, 'm.example.com/watch/x', 'newest copy wins');
  assert.match(OPTIONS, /site: {5}canonHost\(entry\.site\),/);
  assert.match(OPTIONS, /site: {5}canonHost\(row\.site\) \|\| row\.site_name \|\| '',/);
  assert.match(OPTIONS, /map\(i => canonHost\(i\.site \|\| i\.siteName\)\)/);
});

// ── Device test round 1 (5 Oct): notices, OpenSubtitles numbers, History, subtitles ──
test('resume: "Continued from" is off by default, a switch in Settings, synced and backed up', () => {
  assert.match(extractConst(CONTENT, 'PREF_DEFAULTS'), /resumeNotice: false/);
  assert.match(CONTENT, /_resumeSeek\(video, saved\.p, mediaId, false, \(\) => \{ if \(prefs\.resumeNotice\) showResumeToast\(video, saved\.p\); \}\);/);
  assert.ok(read('options.html').includes('id="resumeNotice"'));
  for (const list of [extractConst(BG, 'SYNC_PREF_KEYS'), extractConst(OPTIONS, 'CLOUD_PREF_ALLOW')]) for (const k of ['resumeNotice', 'subtitle_weight']) assert.ok(list.includes("'" + k + "'"), k);
  assert.match(OPTIONS, /S\.skipNotice, S\.resumeNotice\]\);/, 'import checks it is a true/false value');
});

test('opensubtitles: the texts match OpenSubtitles (5 without an account, 20 with a free one); live numbers win', () => {
  const html = read('options.html');
  assert.match(html, /Without an account: 5 downloads a day\. With a <a [^>]+>free account<\/a>: 20 a day\./);
  for (const src of [html, OPTIONS, read('README.md')]) assert.doesNotMatch(src, /200\/day|up to 200|200 subtitle downloads/);
  assert.match(BG, /downloads_allowed: data\.user\?\.allowed_downloads \?\? null,\n\s*downloads_remaining: null,/, 'the allowance is not "remaining"');
  const q = vm.runInNewContext(extractFunction(OPTIONS, 'osubQuotaText') + ';osubQuotaText');
  assert.equal(q({ downloads_remaining: 17, downloads_allowed: 20 }, 'x'), 'Logged in: 17 downloads left today');
  assert.equal(q({ downloads_remaining: null, downloads_allowed: 20 }, 'x'), 'Logged in: your account allows 20 downloads a day');
  assert.equal(q({}, 'Logged in'), 'Logged in');
  assert.doesNotMatch(OPTIONS, /downloads remaining today/);
});

function histKit(deviceName = '', ua = 'Mozilla/5.0 Firefox/142.0') {
  const made = [];
  const doc = { createElement: (t) => { const e = { tag: t, _l: {}, addEventListener(n, f) { this._l[n] = f; }, replaceWith(x) { this.replaced = x; } }; made.push(e); return e; } };
  const code = ['canonHost', 'siteDisplayName', 'siteIcon', 'myDeviceName', 'itemDevice'].map((n) => extractFunction(OPTIONS, n)).join('\n')
    + '\n' + OPTIONS.slice(OPTIONS.indexOf('const KNOWN_SITE_NAMES'), OPTIONS.indexOf('function siteDisplayName')) + ';({ siteDisplayName, siteIcon, itemDevice, myDeviceName })';
  return { made, ...vm.runInNewContext(code, { document: doc, navigator: { userAgent: ua }, $: (id) => (id === 'deviceName' ? { value: deviceName } : null) }) };
}

test('history: popular sites by name (JioHotstar, YouTube), others by their own name', () => {
  const k = histKit();
  assert.equal(k.siteDisplayName('m.youtube.com', 'Youtube'), 'YouTube');
  assert.equal(k.siteDisplayName('www.hotstar.com', 'Hotstar'), 'JioHotstar');
  assert.equal(k.siteDisplayName('tv.apple.com', ''), 'Apple TV+');
  assert.equal(k.siteDisplayName('www.1shows.cx', '1shows'), '1shows');
  assert.equal(k.siteDisplayName('obscure.example', ''), 'obscure.example');
  assert.match(OPTIONS, /opt\.value = s; opt\.textContent = siteDisplayName\(s, ''\);/, 'the site filter shows names');
});

test('history: each site shows its own icon from the site; a missing icon becomes a letter', () => {
  const k = histKit();
  const img = k.siteIcon('m.youtube.com', 'YouTube');
  assert.equal(img.src, 'https://youtube.com/favicon.ico');
  assert.equal(img.referrerPolicy, 'no-referrer');
  img._l.error();
  assert.equal(img.replaced.textContent, 'Y');
  assert.equal(img.replaced.className, 'h-site-letter');
  assert.equal(k.siteIcon('YouTube', 'YouTube'), null, 'a name is not a host: no request');
});

test('history: rows show and filter by the device that played them last', () => {
  const k = histKit('Govind laptop');
  assert.equal(k.itemDevice({ device: 'Pixel 8', fromCloud: true }), 'Pixel 8');
  assert.equal(k.itemDevice({ fromCloud: false }), 'Govind laptop', 'this browser\'s own rows use its device name');
  assert.equal(k.itemDevice({ fromCloud: true }), 'Unknown device', 'technical data off on the other device');
  assert.equal(histKit('', 'Mozilla/5.0 (Android) EdgA/120').myDeviceName(), 'Edge');
  assert.ok(read('options.html').includes('<select id="historyDevice" class="hist-select" aria-label="Device">'));
  assert.match(OPTIONS, /&& \(!devFilter \|\| itemDevice\(item\) === devFilter\);/);
  assert.match(OPTIONS, /\$\('historyDevice'\)\?\.addEventListener\('change', \(\) => renderHistory\(allHistory\)\);/);
});

test('subtitles: more fonts (rounded, casual, condensed, small capitals), weight, two more edges, colours', () => {
  const { _subLook } = contentFns(['_subLook', '_subEdge'], ['SUB_FONTS', 'SUB_EDGES'], { Math, Number, String, Object });
  assert.match(_subLook({ font: 'rounded' }).fontFamily, /ui-rounded/);
  assert.match(_subLook({ font: 'casual' }).fontFamily, /Comic/);
  assert.match(_subLook({ font: 'condensed' }).fontFamily, /Condensed/);
  assert.equal(_subLook({ font: 'smallcaps' }).fontVariant, 'small-caps');
  assert.equal(_subLook({}).fontWeight, '700', 'bold stays the default look');
  assert.equal(_subLook({ weight: 'regular' }).fontWeight, '500');
  assert.match(_subLook({ edge: 'glow' }).textShadow, /0 0 18px/);
  assert.match(_subLook({ edge: 'depressed' }).textShadow, /^1px 1px 0 rgba\(255,255,255/);
  const html = read('options.html');
  for (const v of ['rounded', 'casual', 'condensed', 'smallcaps']) assert.ok(html.includes('<option value="' + v + '">'), v);
  for (const v of ['#ffb74d', '#ff9be0']) assert.ok(html.includes('<option value="' + v + '">'), v);
  assert.ok(html.includes('id="subWeight"') && html.includes('id="subPreview"'));
});

test('subtitles: the Settings preview uses exactly the same fonts and edges as the video', () => {
  const ev = (src, name) => JSON.stringify(vm.runInNewContext(extractConst(src, name) + ';' + name));
  assert.equal(ev(OPTIONS, 'SUB_FONTS'), ev(CONTENT, 'SUB_FONTS'));
  assert.equal(ev(OPTIONS, 'SUB_EDGES'), ev(CONTENT, 'SUB_EDGES'));
  const vals = vm.runInNewContext(extractConst(OPTIONS, 'SUB_FONT_VALUES') + ';[...SUB_FONT_VALUES]');
  assert.deepEqual(j(vals).sort(), Object.keys(JSON.parse(ev(CONTENT, 'SUB_FONTS'))).sort());
  const code = extractConst(OPTIONS, 'SUB_EDGE_VALUES') + extractConst(OPTIONS, 'SUB_FONT_VALUES') + '\nconst S = { subEdge: "subtitle_edge", subFont: "subtitle_font", subWeight: "subtitle_weight" }; const IMPORT_BOOL = new Set();\n' + extractFunction(OPTIONS, 'importValueOk') + '\n;importValueOk';
  const ok = vm.runInNewContext(code);
  assert.deepEqual([ok('subtitle_font', 'casual'), ok('subtitle_font', 'comic'), ok('subtitle_weight', 'regular'), ok('subtitle_weight', 'heavy'), ok('subtitle_edge', 'glow')], [true, false, true, false, true]);
});

test('site report: long random path parts (tokens) are hidden; YouTube trailer embeds are not listed', () => {
  const doc = { title: 'T', referrer: '', querySelector: () => null,
    querySelectorAll: (s) => (s === 'script:not([src])' ? [{ textContent: 'a="https://www.youtube.com/embed/L0fw0WzFaBM";b="https://cdn1.example/e/DwYRNhFGQkNR/master.m3u8"' }] : []) };
  const ctx = vm.createContext({ document: doc, location: { href: 'https://srv.example/aes/0/c071ea7831662d08935948f3c55a42e7/x.m3u8' }, URL,
    performance: { getEntriesByType: () => [{ name: 'https://srv308.example/aes/0/c071ea7831662d08935948f3c55a42e7/GRh6sY0xcroQVm3IcQR6HQ/1/seg.m3u8', initiatorType: 'xmlhttprequest' }] } });
  ctx.window = ctx; ctx.top = ctx;
  const r = j(vm.runInContext(read('content-scripts/probe.js'), ctx));
  assert.equal(r.frame, 'srv.example/aes/0/<id>/x.m3u8');
  assert.deepEqual(r.loaded, ['srv308.example/aes/0/<id>/GRh6sY0xcroQVm3IcQR6HQ/1/seg.m3u8 (xmlhttprequest)']);
  assert.deepEqual(r.inScripts, ['cdn1.example/e/DwYRNhFGQkNR/master.m3u8']);
});

// ── Device test round 1, part 2 (5 Oct) ───────────────────────────────────────
const OSUB_RES = { data: [{ attributes: { files: [{ file_id: 7, file_name: 'x.srt' }] } }] };
function osubBg(downloadStatus) {
  const calls = [];
  const bg = loadBackground({ storage: { osub_session: { token: 'tok', base_url: 'api.opensubtitles.com', expiry: Date.now() + 1e8 } },
    fetchImpl: (url, opts) => {
      if (url.includes('/subtitles?')) return fakeResponse(200, OSUB_RES);
      if (url.endsWith('/download')) { const auth = !!(opts.headers && opts.headers.Authorization); calls.push(auth); return auth || downloadStatus === 200 ? fakeResponse(200, { link: 'https://dl.example/x.srt', remaining: auth ? 19 : 4 }) : fakeResponse(downloadStatus, { message: 'quota' }); }
      if (url === 'https://dl.example/x.srt') return { ok: true, status: 200, text: async () => '1\n00:00:01,000 --> 00:00:02,000\nHi\n' };
      return fakeResponse(404, {});
    } });
  return { bg, calls };
}

test('opensubtitles: downloads without the account first; the account is used only when that is refused', async () => {
  const a = osubBg(200);
  const r = await a.bg.send({ type: 'OSUB_SEARCH_AND_FETCH', imdbId: 'tt0133093', language: 'en' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(a.calls, [false], 'one download, without Authorization');
  assert.equal(r.via, 'no account');
  assert.equal(a.bg.storage.osub_session.downloads_remaining, undefined, 'the no-account count is not shown as the account\'s');
  const b = osubBg(406);
  const r2 = await b.bg.send({ type: 'OSUB_SEARCH_AND_FETCH', imdbId: 'tt0133093', language: 'en' });
  assert.equal(r2.ok, true);
  assert.deepEqual(b.calls, [false, true], 'refused without the account, then with it');
  assert.equal(r2.via, 'account');
  assert.equal(b.bg.storage.osub_session.downloads_remaining, 19);
});

test('page check: every frame answers, even if SkipStream stopped while starting there', () => {
  const early = CONTENT.indexOf("msg.type !== 'SS_DIAG_PING'");
  assert.ok(early > 0 && early < CONTENT.indexOf('const PREF_DEFAULTS'), 'the listener comes first');
  assert.equal(CONTENT.split("msg.type !== 'SS_DIAG_PING'").length, 2, 'only one listener');
  assert.match(CONTENT, /_ssBootDone = true;[^\n]*\n\n\}\)\(\);\s*$/, 'start-up marks itself finished at the very end');
  assert.match(extractFunction(CONTENT, '_ssDiagReport'), /catch \(e\) \{[\s\S]*error: String\(e && e\.message \|\| e\)/);
  assert.match(BG, /started: r\.started !== false, error: String\(r\.error \|\| ''\)\.slice\(0, 120\),/);
  const diagText = vm.runInNewContext('(' + extractFunction(read('popup.js'), 'diagText') + ')', { Array });
  const t = diagText({ ok: true, frames: [{ frame: 'www.viduki.net/1/movie/603', top: false, videos: 1, started: false, error: 'x is not defined' }] });
  assert.ok(t.includes('SkipStream did not finish starting in this frame: x is not defined'), t);
});

test('site report: each frame also shows what SkipStream itself sees, and the video position', () => {
  const ctx = vm.createContext({ document: { title: 'T', referrer: '', querySelector: () => null,
    querySelectorAll: (s) => (s === 'video' ? [{ getBoundingClientRect: () => ({ width: 1792, height: 947 }), currentSrc: 'blob:x', duration: 8181, paused: false, currentTime: 612.4, readyState: 4, textTracks: [], querySelector: () => null }] : []) },
    location: { href: 'https://www.viduki.net/1/movie/603' }, URL });
  ctx.window = ctx; ctx.top = ctx;
  ctx.__skipstream_diag = () => ({ started: true, attached: 1, ident: 'movie tt0133093', segs: 'intro, outro' });
  const r = j(vm.runInContext(read('content-scripts/probe.js'), ctx));
  assert.deepEqual(r.ss, { started: true, attached: 1, ident: 'movie tt0133093', segs: 'intro, outro' });
  assert.equal(r.videos[0].at, 612);
  const siteReportText = vm.runInNewContext('(' + extractFunction(read('popup.js'), 'siteReportText') + ')', { Array });
  const t = siteReportText({ ok: true, frames: [{ frame: 'www.viduki.net/1/movie/603', top: false, skipstream: true, ...r }] }, 'v1.13.0');
  assert.ok(t.includes('  SkipStream: running, 1 video(s) in use, what: movie tt0133093, skips: intro, outro'), t);
  assert.ok(t.includes('8181 s, playing at 612 s'), t);
});

test('subtitles: Netflix and Prime Video styles use their fonts only if the device has them', () => {
  const { _subLook } = contentFns(['_subLook', '_subEdge'], ['SUB_FONTS', 'SUB_EDGES'], { Math, Number, String, Object });
  assert.match(_subLook({ font: 'netflix' }).fontFamily, /^"Netflix Sans",.*Arial,sans-serif$/);
  assert.match(_subLook({ font: 'prime' }).fontFamily, /^"Amazon Ember",.*sans-serif$/);
  const html = read('options.html');
  assert.ok(html.includes('<option value="netflix">Streaming: Netflix style</option>') && html.includes('<option value="prime">Streaming: Prime Video style</option>'));
  assert.match(html, /SkipStream cannot include them/);
  assert.doesNotMatch(read('manifest.json') + read('options.css'), /@font-face|fonts\.googleapis/, 'no font is downloaded');
});

test('cc button: a Settings switch; hides after 5 s in full screen; drag on a normal page; only with a visible video', () => {
  assert.match(extractConst(CONTENT, 'PREF_DEFAULTS'), /ccButton: 'on'/);
  const ensure = extractFunction(CONTENT, 'ensureCCBtn');
  assert.match(ensure, /if \(prefs\.ccButton === 'off'\) \{ if \(_subCCBtn\) \{ _subCCBtn\.remove\(\); _subCCBtn = null; \}/);
  assert.match(ensure, /_ccSetup\(btn, video\);/);
  assert.match(ensure, /if \(btn\._ssDragged && Date\.now\(\) - btn\._ssDragged < 400\) return;/);
  const setup = extractFunction(CONTENT, '_ccSetup');
  assert.match(CONTENT, /const CC_IDLE_MS = 5000;/);
  assert.match(setup, /if \(_ccFs\(\)\) _ccIdleT = setTimeout\(\(\) => \{ if \(_ccFs\(\)\) btn\.style\.visibility = 'hidden'; \}, CC_IDLE_MS\);/);
  assert.match(setup, /br\.storage\.local\.set\(\{ subtitle_cc_pos: pos \}\)/);
  assert.match(setup, /btn\.style\.display = r && r\.width >= 120 && r\.height >= 68 \? 'flex' : 'none';/);
  const { _ccApplyPos } = contentFns(['_ccApplyPos', '_ccFs'], [], { document: {}, window: { innerHeight: 800 }, Number, Math });
  const b = { style: {} };
  _ccApplyPos(b, { left: 50, bottom: 120 }); assert.deepEqual(j(b.style), { left: '50%', bottom: '120px' });
  _ccApplyPos(b, { left: 400, bottom: 9000 }); assert.deepEqual(j(b.style), { left: '94%', bottom: '760px' }, 'kept on screen');
  _ccApplyPos(b, null); assert.deepEqual(j(b.style), { left: '3%', bottom: '68px' });
  assert.ok(read('options.html').includes('<select id="ccButton">'));
  for (const list of [extractConst(BG, 'SYNC_PREF_KEYS'), extractConst(OPTIONS, 'CLOUD_PREF_ALLOW')]) assert.ok(list.includes("'ccButton'"));
});
