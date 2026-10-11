// 1.13.1 (5 Oct 2026): no unlicensed streaming site names in the repository, anime
// sites by what they are, device names never empty, H6 clicks only over the video,
// YouTube film uploads can find subtitles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { ROOT, read, loadBackground, fakeResponse, contentFns, extractFunction } from './harness.mjs';

const j = (x) => JSON.parse(JSON.stringify(x));
const CONTENT = read('content-scripts/content.js');
const OPTIONS = read('options.js');

// The names are kept as hashes so this test does not name them either.
const BANNED = new Set(['935692bbc33dddd4', '2156e911290c8e4d', '19e15df04c07a773', '2f9bad7b791be024', '2b072a52b50caead',
  '858d9f8214f8dd04', '167dc31f526bb9fa', 'd13a094424561c30', '3b97b8eff0244f74', 'd751d926bdf5db2a', '8444417f5fdb471a',
  '022b57187b71a8f7', '632576c9c30d85fe', 'fdfee49755a5c5c1', 'fd350a999d788c21', 'e533d55ec58aa696']);
const TEXT = /\.(js|mjs|json|md|html|css|yml|yaml|sql|py|sh|txt|tsv)$/i;
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}
export function bannedHits(text) {
  const hits = new Set();
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (BANNED.has(createHash('sha256').update(w).digest('hex').slice(0, 16))) hits.add(w.length + ' chars');
  }
  return [...hits];
}

test('no unlicensed streaming site is named in code, tests or user docs (knowledge/ has its own test)', () => {
  const files = walk(ROOT).filter((p) => !path.relative(ROOT, p).startsWith('knowledge' + path.sep));
  assert.ok(files.length > 40, 'walked the repository');
  for (const p of files) assert.deepEqual(bannedHits(fs.readFileSync(p, 'utf8')), [], path.relative(ROOT, p));
  assert.deepEqual(bannedHits('see www.' + ['1', 'shows'].join('') + '.to'), ['6 chars'], 'the check itself finds a name');
});

test('anime sites: "anime" in the host, Crunchyroll or HIDIVE; no site list', () => {
  const src = extractFunction(CONTENT, '_animeSite');
  assert.match(src, /\[a-z0-9-\]\*anime\[a-z0-9-\]\*\|crunchyroll\|hidive\)/);
  for (const [h, want] of [['animeportal.to', true], ['www.hidive.com', true], ['www.crunchyroll.com', true], ['videohub.to', false]]) {
    const f = contentFns(['_animeSite'], [], { _siteHost: () => h });
    assert.equal(f._animeSite(), want, h);
  }
});

test('device name: the 5-minute push never sends an empty device; Sync Now sends this browser\'s name', async () => {
  const cache = { 'tv/1': { p: 600, d: 2400, t: 1000, title: 'Dark' } };
  const base = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon', skipstream_install_id: 'u-1' };
  const rowsOf = (bg) => bg.calls.filter((x) => x.url.endsWith('/rpc/ss_put_playback')).map((x) => JSON.parse(x.opts.body).p_row);
  const ff = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...base, skipstream_cache: { ...cache } },
    ctxExtra: { navigator: { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0' } } });
  await ff.ctx.pushUnsyncedHistory();
  assert.equal(rowsOf(ff)[0].device_name, 'Firefox');
  const named = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...base, deviceName: ' Mobile ', skipstream_cache: { ...cache } } });
  await named.ctx.pushUnsyncedHistory();
  assert.equal(rowsOf(named)[0].device_name, 'Mobile');
  const noUa = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...base, deviceName: '', skipstream_cache: { ...cache } } });
  await noUa.ctx.pushUnsyncedHistory();
  assert.equal(rowsOf(noUa)[0].device_name, 'Chrome');
  assert.equal(OPTIONS.includes('SkipStream Options Sync'), false);
  assert.match(OPTIONS, /device_name: {2}myDeviceName\(\),/);
});

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const elAt = (r, label = '') => ({ getBoundingClientRect: () => r, offsetParent: {}, disabled: false, clicked: 0,
  click() { this.clicked++; }, getAttribute: (k) => (k === 'aria-label' ? label : null), textContent: label });

test('H6: generic Next and Skip controls are clicked only over the playing video', () => {
  const video = { getBoundingClientRect: () => rect(100, 100, 800, 450) };
  const over = elAt(rect(760, 480, 120, 40), 'Next episode');      // bottom-right of the player
  const side = elAt(rect(1000, 200, 200, 40), 'Next episode');     // a side list next to it
  const f = contentFns(['_overVideo'], []);
  assert.equal(f._overVideo(over, video), true);
  assert.equal(f._overVideo(side, video), false);
  assert.equal(f._overVideo(over, null), false, 'no video, no click');
  assert.equal(f._overVideo(over, { getBoundingClientRect: () => rect(0, 0, 0, 0) }), false, 'hidden video');
  assert.equal(f._overVideo(elAt(rect(905, 300, 30, 30)), video), true, 'just outside the edge (10 %) still counts');

  const run = (fn, nodes, sel) => {
    const doc = { querySelectorAll: () => nodes, querySelector: () => sel };
    const code = extractFunction(CONTENT, '_overVideo') + '\n' + extractFunction(CONTENT, fn) + `\n;${fn}`;
    const ctx = vm.createContext({ document: doc, Date, _lastNextScanTs: 0, _lastLabelScanTs: 0,
      NEXT_EP_TEXT_RE: /^(next episode|next ep|play next|watch next)$/i, SKIP_TEXT_RE: /^(skip|skip intro)$/i });
    return vm.runInContext(code, ctx);
  };
  const side2 = elAt(rect(1000, 200, 200, 40), 'Next episode'), over2 = elAt(rect(760, 480, 120, 40), 'Next episode');
  assert.equal(run('clickNextByLabel', [side2, over2])(video), true);
  assert.equal(side2.clicked, 0, 'the side list was not clicked');
  assert.equal(over2.clicked, 1);
  const skipSide = elAt(rect(0, 0, 80, 30), 'Skip');
  assert.equal(run('clickSkipByLabel', [skipSide])(video), false, 'a "Skip" link in the page header is not a player control');
  assert.equal(skipSide.clicked, 0);
  const card = elAt(rect(1000, 200, 200, 40));
  assert.equal(run('clickFirst', [], card)(['[class*="NextEpisode"]'], video), false);
  assert.equal(card.clicked, 0);
  assert.match(CONTENT, /clickFirst\(NEXT_EP_SELECTORS, video\) \|\| clickNextByLabel\(video\)/);
  assert.equal((CONTENT.match(/&& clickNativeSkipButton\(video\)/g) || []).length, 2, "both callers pass the video");
});

test('YouTube: a film upload with its year in brackets can find subtitles (popup button only)', () => {
  const f = contentFns(['_ytFilmTitle'], [], { Date, parseInt });
  assert.deepEqual(j(f._ytFilmTitle('Heat (1995) Full Movie 4K HD (5.1) with English Subtitles - Al Pacino')), { q: 'Heat', year: 1995 });
  assert.deepEqual(j(f._ytFilmTitle('The Third Man [1949] | restored')), { q: 'The Third Man', year: 1949 });
  for (const t of ['lofi beats to relax', 'My trip 2023 vlog', '(1995)', 'Space film (2999)', '']) assert.equal(f._ytFilmTitle(t), null, t);
  const src = extractFunction(CONTENT, 'fetchSubsNow');
  assert.match(src, /const ytFilm = yt && !info\?\.imdbId \? _ytFilmTitle\(getVideoTitle\(\)\) : null;/);
  assert.match(src, /yt \? \(ytFilm \? ytFilm\.q : ''\)/);
  assert.match(src, /reason: yt \? 'youtube' : 'no_id'/);
  assert.equal(CONTENT.includes('initSubtitles(video, { ...info, query'), false, 'automatic subtitles still never search YouTube by title');
});

test('release: one version in all 7 places and updates.json (read from manifest.json)', () => {
  const v = JSON.parse(read('manifest.json')).version;
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.equal(JSON.parse(read('manifest-chrome.json')).version, v);
  assert.ok(read('popup.js').startsWith('/* SkipStream - popup v' + v + ' */'));
  assert.ok(read('popup.css').startsWith('/* SkipStream popup - v' + v));
  assert.ok(read('README.md').includes('version-' + v + '-green') && read('README.md').includes('releases/tag/v' + v));
  assert.match(read('CHANGELOG.md'), new RegExp('^# Changelog\\n\\n## \\[' + esc + '\\] - \\d{4}-\\d{2}-\\d{2}\\n'));
  const u = JSON.parse(read('updates.json')).addons['skipstream@extension'].updates;
  assert.equal(u[u.length - 1].version, v);
  assert.ok(u[u.length - 1].update_link.endsWith('/v' + v + '/skipstream-' + v + '-firefox.zip'));
});
