// 1.12.0: site report, all SponsorBlock categories, AnimeSkip ends, SkipDB,
// timeline markers, subtitle look, per-show sync offset.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, contentFns, loadBackground, fakeResponse, extractFunction, extractConst } from './harness.mjs';

const CONTENT = read('content-scripts/content.js');
const j = (x) => JSON.parse(JSON.stringify(x));

// ── Providers ─────────────────────────────────────────────────────────────────
test('animeskip: a section ends where the next starts; Credits is the outro', () => {
  const { ctx } = loadBackground();
  const r = j(ctx.animeSkipSegments([
    { at: 0, type: { name: 'Canon' } }, { at: 90, type: { name: 'Intro' } }, { at: 180, type: { name: 'Canon' } },
    { at: 1300, type: { name: 'Credits' } }, { at: 1390, type: { name: 'Preview' } },
  ]));
  assert.deepEqual(r, { intro: { start_sec: 90, end_sec: 180 }, outro: { start_sec: 1300, end_sec: 1390 }, preview: { start_sec: 1390, end_sec: 1990 } });
  assert.equal(ctx.animeSkipSegments([]), null);
  assert.doesNotMatch(read('background.js'), /timestamps \{ at duration/, 'no made-up duration field in the query');
});

test('skipdb: milliseconds become seconds, out-of-range matches are dropped', () => {
  const { ctx } = loadBackground();
  const r = j(ctx.skipDbSegments({ segments: { intro: { start_ms: 61000, end_ms: 91000, match: 'exact', confidence: 0.9 }, recap: null,
    outro: { start_ms: 2760000, end_ms: 2820000, match: 'out-of-range' } } }));
  assert.deepEqual(r, { intro: { start_sec: 61, end_sec: 91, confidence: 0.9 } });
  assert.equal(ctx.skipDbSegments({ segments: {} }), null);
});

test('providers: IntroDB wins over SkipDB, SkipDB fills what IntroDB lacks', async () => {
  const bg = loadBackground({ fetchImpl: (url) => {
    if (url.includes('api.introdb.app')) return fakeResponse(200, { imdb_id: 'tt0903747', intro: { start_ms: 10000, end_ms: 40000 }, recap: null, outro: null });
    if (url.includes('api.skipdb.tv')) return fakeResponse(200, { segments: { intro: { start_ms: 1000, end_ms: 2000, match: 'exact' }, preview: { start_ms: 2700000, end_ms: 2760000, match: 'exact' } } });
    return fakeResponse(404, {});
  } });
  const r = await bg.send({ type: 'FETCH_SEGMENTS', imdbId: 'tt0903747', season: 1, episode: 1 });
  assert.ok(r.data.preview, 'preview from SkipDB');
  assert.notEqual(r.data.intro.start_sec, 1, 'intro from IntroDB, not SkipDB');
  assert.ok(bg.calls.some(c => c.url.startsWith('https://api.skipdb.tv/api/segments?imdb_id=tt0903747&season=1&episode=1')));
});

test('sponsorblock: every category is asked for; mute, highlight and whole-video rows are kept', async () => {
  const { ctx } = loadBackground();
  const r = j(ctx.sponsorBlockSegments([
    { category: 'sponsor', actionType: 'skip', segment: [10, 40], votes: 3 },
    { category: 'music_offtopic', actionType: 'mute', segment: [0, 12] },
    { category: 'poi_highlight', actionType: 'poi', segment: [300, 300] },
    { category: 'exclusive_access', actionType: 'full', segment: [0, 0] },
    { category: 'made_up', actionType: 'skip', segment: [1, 2] },
    { category: 'filler', actionType: 'skip', segment: [50, 40] },
  ]));
  assert.deepEqual(r, { sponsor: [{ start_sec: 10, end_sec: 40, action: 'skip', votes: 3 }], music_offtopic: [{ start_sec: 0, end_sec: 12, action: 'mute', votes: 0 }],
    poi_highlight: [{ start_sec: 300, end_sec: 300, action: 'poi' }], full: 'exclusive_access' });
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, []) });
  await bg.send({ type: 'FETCH_SEGMENTS_YT', videoId: 'dQw4w9WgXcQ' });
  const u = decodeURIComponent(bg.calls[0].url);
  for (const c of ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler', 'poi_highlight', 'exclusive_access']) assert.ok(u.includes('"' + c + '"'), c);
  assert.match(u, /actionTypes=\["skip","mute","poi","full"\]/);
});

// ── Skip modes ────────────────────────────────────────────────────────────────
test('modes: sponsors follow the Intros switch unless set; other YouTube kinds have their own', () => {
  const { _segMode } = contentFns(['_segMode'], ['SB_MODE_DEFAULTS', 'PREF_FOR_SEGMENT']);
  assert.equal(_segMode('sponsor', { skipIntro: true }, true), 'auto');
  assert.equal(_segMode('sponsor', { skipIntro: false }, true), 'ask');
  assert.equal(_segMode('sponsor', { skipIntro: true, sbModes: { sponsor: 'off' } }, true), 'off');
  assert.equal(_segMode('interaction', { skipIntro: true }, true), 'ask');
  assert.equal(_segMode('music_offtopic', {}, true), 'off');
  assert.equal(_segMode('filler', { sbModes: { filler: 'auto' } }, true), 'auto');
  assert.equal(_segMode('preview', { skipOutro: true }, false), 'auto', 'IntroDB/SkipDB previews follow Outros');
  assert.equal(_segMode('intro', { skipIntro: false, sbModes: { intro: 'bogus' } }, true), 'ask');
});

test('modes: off segments are ignored, mute segments mute, highlight is offered once', () => {
  const f = CONTENT.slice(CONTENT.indexOf('const checkSkipSegments'), CONTENT.indexOf('const throttledCheckSkip'));
  assert.match(f, /_segMode\(active\.key, effectivePrefs, yt\) === 'off'\) active = null;/);
  assert.match(f, /mode === 'auto' && active\.segment\.action === 'mute'/);
  assert.match(f, /video\.muted = false; video\._ssMutedUntil = 0;/);
  assert.match(f, /Jump to highlight/);
  assert.match(f, /if \(activeSegmentKey === 'poi'\) \{ if \(!active\) return; activeSegmentKey = ''; hideSkipBtn\(\); \}/, 'a segment beats the highlight button');
  assert.match(CONTENT, /const isAutoMode = _segMode\(segKey, _ssEffPrefs \|\| prefs, !!_youtubeVideoId\(\)\) === 'auto';/);
});

// ── Timeline ──────────────────────────────────────────────────────────────────
test('timeline: segments become percentage spans; the highlight is a thin mark', () => {
  const { _timelineSpans } = contentFns(['_timelineSpans'], ['SEG_KEYS'], { Math, Number, Array });
  const spans = j(_timelineSpans({ intro: { start_sec: 60, end_sec: 120 }, sponsor: [{ start_sec: 300, end_sec: 330 }], poi_highlight: [{ start_sec: 450 }], outro: { start_sec: 590, end_sec: 900 } }, 600));
  assert.deepEqual(spans, [
    { key: 'intro', left: 10, width: 10 }, { key: 'outro', left: 98.33, width: 1.67 }, { key: 'sponsor', left: 50, width: 5 }, { key: 'poi_highlight', left: 75, width: 0.6 },
  ]);
  assert.deepEqual(j(_timelineSpans({ intro: { start_sec: 700, end_sec: 800 } }, 600)), []);
  assert.deepEqual(j(_timelineSpans(null, 600)), []);
  assert.match(CONTENT, /document\.querySelector\('\.ytp-progress-bar'\)/);
  assert.match(CONTENT, /if \(!prefs\.showTimeline \|\| !video \|\| !video\.isConnected\) return;/);
});

// ── Subtitles ─────────────────────────────────────────────────────────────────
test('subtitles: colour, background, font and outline come from Settings, bad values fall back', () => {
  const { _subLook } = contentFns(['_subLook'], ['SUB_FONTS'], { Math, Number, String });
  const a = _subLook({ color: '#ffeb3b', bg: 60, font: 'serif', outline: false });
  assert.equal(a.color, '#ffeb3b'); assert.equal(a.background, 'rgba(0,0,0,0.6)'); assert.match(a.fontFamily, /Georgia/); assert.equal(a.textShadow, 'none');
  const b = _subLook({ color: 'red;x', bg: 500, font: 'comic' });
  assert.equal(b.color, '#ffffff'); assert.equal(b.background, 'rgba(0,0,0,0.9)'); assert.match(b.fontFamily, /system-ui/); assert.notEqual(b.textShadow, 'none');
});

test('subtitles: the sync offset is saved and restored per film or show', () => {
  assert.match(CONTENT, /_saveShowOffset\(_subLastInfo && _subLastInfo\.imdbId, _subState\.sync\);/);
  const f = extractFunction(CONTENT, 'initSubtitles');
  assert.match(f, /const savedOffset = await _showOffset\(info\.imdbId\);\n\s*if \(savedOffset !== null\) _subState\.sync = savedOffset;/);
});

test('settings: new keys are backed up, synced and checked on import', () => {
  const opts = read('options.js');
  for (const k of ['subtitle_color', 'subtitle_bg', 'subtitle_font', 'subtitle_outline', 'subtitle_offsets', 'sbModes', 'showTimeline'])
    assert.ok(extractFunction(opts, 'backupKit').includes("'" + k + "'"), 'backup ' + k);
  const code = extractConst(opts, 'S') .replace(/^const S/, 'var S') ;
  assert.ok(code.includes('subOffsets'));
  const bg = read('background.js');
  for (const k of ['subtitle_color', 'sbModes', 'showTimeline']) assert.ok(extractConst(bg, 'SYNC_PREF_KEYS').includes("'" + k + "'"), 'sync ' + k);
  const html = read('options.html');
  for (const id of ['subColor', 'subFont', 'subBg', 'subOutline', 'showTimeline', 'sbm-sponsor', 'sbm-filler']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /SkipDB<\/a>, data licensed <a href="https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\/"/);
});

// ── Site report ───────────────────────────────────────────────────────────────
test('site report: Firefox runs the probe in every frame, blank frames too, and returns each frame', async () => {
  let opts = null;
  const bg = loadBackground({ overrides: { 'browser.tabs.executeScript': async (tabId, o) => { opts = o; return [{ frame: '1shows.bz/movies/603', top: true }, { frame: 'viduki.net/1/movie/603', top: false }, null]; } } });
  const r = await bg.send({ type: 'SS_SITE_REPORT', tabId: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.frames.length, 2);
  assert.deepEqual(j(opts), { file: '/content-scripts/probe.js', allFrames: true, matchAboutBlank: true, runAt: 'document_idle' });
  assert.equal((await bg.send({ type: 'SS_SITE_REPORT' })).ok, false);
});

test('site report: the probe runs on a bare page and returns a plain report', () => {
  const doc = { title: 'The Matrix', referrer: '', querySelector: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ document: doc, location: { href: 'https://www.viduki.net/1/movie/603?token=SECRET' }, URL, String, Number, Math, Array, Set });
  ctx.window = ctx; ctx.window.top = ctx;
  const r = j(vm.runInContext(read('content-scripts/probe.js'), ctx));
  assert.equal(r.frame, 'www.viduki.net/1/movie/603', 'query string (tokens) cut off');
  assert.equal(r.top, true);
  assert.deepEqual([r.players, r.videos, r.iframes], [[], [], []]);
});

test('site report: the popup turns frames into readable lines', () => {
  const siteReportText = vm.runInNewContext('(' + extractFunction(read('popup.js'), 'siteReportText') + ')', { Array });
  const t = siteReportText({ ok: true, frames: [
    { frame: 'www.1shows.bz/movies/603-the-matrix', top: true, skipstream: true, players: [], libs: [], videos: [], iframes: [{ src: 'vidsrc.example/embed/movie/603', size: '1280x720', sandbox: '' }], ids: [] },
    { frame: 'vidsrc.example/embed/movie/603', top: false, skipstream: false, referrer: 'www.1shows.bz/', players: ['JW Player'], libs: ['hls.js (cdn.example)'],
      videos: [{ size: '1280x720', kind: 'stream (HLS/DASH via script)', source: 'blob (stream built in the page)', duration: 8160, playing: true, tracks: ['subtitles:en English showing'] }], iframes: [], ids: ['tmdb 603'] },
  ] }, 'v1.12.0');
  for (const want of ['SkipStream v1.12.0 site report, 2 frames', 'iframe vidsrc.example/embed/movie/603 1280x720', 'FRAME vidsrc.example/embed/movie/603  [SkipStream not running here]',
    'players: JW Player', 'scripts: hls.js (cdn.example)', 'video 1280x720, stream (HLS/DASH via script)', 'subtitle tracks: subtitles:en English showing', 'ids: tmdb 603'])
    assert.ok(t.includes(want), want + '\n---\n' + t);
});

test('manifests: SkipDB may be fetched; Chrome may run the probe', () => {
  const ff = JSON.parse(read('manifest.json')), cr = JSON.parse(read('manifest-chrome.json'));
  assert.ok(ff.content_security_policy.includes('https://api.skipdb.tv'));
  assert.ok(cr.content_security_policy.extension_pages.includes('https://api.skipdb.tv'));
  assert.ok(cr.permissions.includes('scripting'));
  assert.ok(!ff.permissions.includes('scripting'), 'Firefox MV2 needs no new permission');
});
