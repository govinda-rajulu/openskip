import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, loadBackground, extractFunction, extractConst } from './harness.mjs';

const OPTS = read('options.js');
const POPUP_HTML = read('popup.html');
const POPUP_JS = read('popup.js');
const CONTENT = read('content-scripts/content.js');

function block(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('not found: ' + head);
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
  return src.slice(i, k + 1) + ';';
}

// ── H1: options page talks to background with promises only ─────────────────
test('options.js has one sendMessage call, inside bgSend (no callback form)', () => {
  const n = (OPTS.match(/sendMessage\(/g) || []).length;
  assert.equal(n, 1, 'sendMessage calls outside bgSend: ' + (n - 1));
  assert.match(extractFunction(OPTS, 'bgSend'), /sendMessage\(msg\)/);
});

test('bgSend resolves undefined instead of throwing when background is gone', async () => {
  const code = extractFunction(OPTS, 'bgSend') + ';bgSend';
  const bad = vm.runInContext(code, vm.createContext({ Promise, br: { runtime: { sendMessage: () => { throw new Error('x'); } } } }));
  assert.equal(await bad({ type: 'X' }), undefined);
  const rej = vm.runInContext(code, vm.createContext({ Promise, br: { runtime: { sendMessage: () => Promise.reject(new Error('y')) } } }));
  assert.equal(await rej({ type: 'X' }), undefined);
  const ok = vm.runInContext(code, vm.createContext({ Promise, br: { runtime: { sendMessage: async (m) => ({ echo: m.type }) } } }));
  assert.deepEqual(await ok({ type: 'Z' }), { echo: 'Z' });
});

// ── Popup: no file input (Firefox closes the popup), online fetch instead ───
test('popup has no file input, no empty Segments block, and a Find subtitles button', () => {
  assert.equal(/type=["']file["']/.test(POPUP_HTML), false);
  assert.equal(POPUP_JS.includes('subFileInput'), false);
  assert.equal(/<h2 class="skip-label">Segments<\/h2>\s*<div class="stog-list">\s*<\/div>/.test(POPUP_HTML), false);
  assert.match(POPUP_HTML, /id="subFetchBtn"/);
  assert.match(POPUP_JS, /tabs\.sendMessage\(tab\.id, \{ type: 'SUBS_FETCH_NOW' \}\)/);
});

test('every fetch failure reason has words in the popup', () => {
  const code = extractConst(POPUP_JS, 'SUB_REASONS') + extractFunction(POPUP_JS, 'subReason') + ';subReason';
  const subReason = vm.runInContext(code, vm.createContext({ String }));
  for (const r of ['no_id', 'youtube', 'no_results', 'navigated', 'unreadable']) {
    const t = subReason({ ok: false, reason: r });
    assert.ok(t && !t.startsWith('OpenSubtitles said'), r + ' has no text');
  }
  assert.match(subReason(undefined), /\S/);
  assert.match(subReason({ ok: true, count: 12, name: 'a.srt' }), /12 lines from a\.srt/);
  assert.match(subReason({ ok: false, reason: 'HTTP 429' }), /HTTP 429/);
});

test('content.js answers SUBS_FETCH_NOW only from the frame with the player', () => {
  const i = CONTENT.indexOf("msg.type === 'SUBS_FETCH_NOW'");
  assert.ok(i > 0, 'handler missing');
  const h = CONTENT.slice(i, i + 400);
  assert.match(h, /if \(!_subVideo\) return false;/);
  assert.match(h, /fetchSubsNow\(\)\.then\(sendResponse/);
  assert.match(extractFunction(CONTENT, 'fetchSubsNow'), /reason: 'unreadable'/);
});

// ── Options: font-size slider replaces the position slider ───────────────────
test('options has a subtitle text-size slider and no position slider', () => {
  const html = read('options.html');
  assert.match(html, /id="subFontSize"[^>]*min="12"[^>]*max="40"/);
  assert.equal(html.includes('id="subPosition"'), false);
  assert.equal(OPTS.includes('subPosition'), false);
});

// ── H18 + O3: import checks types, merges stats instead of replacing ─────────
function importFns() {
  const code = block(OPTS, 'const S = {') + extractConst(OPTS, 'IMPORT_BOOL') + extractConst(OPTS, 'IMPORT_MODES') +
    extractFunction(OPTS, 'importValueOk') + extractFunction(OPTS, 'mergeImportedStats') + ';({importValueOk, mergeImportedStats})';
  return vm.runInContext(code, vm.createContext({ Set, Number, Math, Object, Array, String }));
}

test('import rejects wrong types and accepts the right ones', () => {
  const { importValueOk } = importFns();
  assert.equal(importValueOk('skipIntro', 'yes'), false);
  assert.equal(importValueOk('skipIntro', true), true);
  assert.equal(importValueOk('skipMode', 'auto-all'), true);
  assert.equal(importValueOk('skipMode', 'turbo'), false);
  assert.equal(importValueOk('playbackSpeed', 1.5), true);
  assert.equal(importValueOk('playbackSpeed', 99), false);
  assert.equal(importValueOk('subtitle_drag_pos', { x: 50, bottom: 10 }), true);
  assert.equal(importValueOk('subtitle_drag_pos', 'middle'), false);
  assert.equal(importValueOk('skipstream_seed_color', '#12abEF'), true);
  assert.equal(importValueOk('skipstream_site_rules', ['x']), false);
});

test('imported stats keep the larger numbers and merge per-site counts', () => {
  const { mergeImportedStats } = importFns();
  const out = mergeImportedStats({ skipsTotal: 10, timeSavedSec: 500, sessionsTotal: 'x', skipsBySite: { a: 3 } },
                                 { skipsTotal: 4, timeSavedSec: 900, sessionsTotal: 7, skipsBySite: { a: 1, b: 5 } });
  assert.equal(out.skipsTotal, 10);
  assert.equal(out.timeSavedSec, 900);
  assert.equal(out.sessionsTotal, 7);
  assert.deepEqual({ ...out.skipsBySite }, { a: 3, b: 5 });
});

// ── Background: H24 log chain, H15 relogin, H22 cache budget ────────────────
test('two errors logged at once are both kept', async () => {
  const bg = loadBackground({});
  await Promise.all([bg.ctx.logError('a', 'one'), bg.ctx.logError('b', 'two')]);
  await bg.ctx.logError('c', 'three');
  const log = bg.storage.skipstream_error_log;
  assert.equal(JSON.stringify(log.map(e => e.ctx)), '["a","b","c"]');
});

test('expired OpenSubtitles session logs in again with the saved account, at most once per 10 min', async () => {
  let logins = 0;
  const bg = loadBackground({
    storage: { osub_session: { token: 'old', expiry: 1 }, osub_username: 'me', osub_password: 'pw' },
    fetchImpl: (url) => { if (url.endsWith('/login')) { logins++; return { ok: true, status: 200, json: async () => ({ token: 'new', base_url: 'api.opensubtitles.com', user: { allowed_downloads: 20 } }) }; } return { ok: false, status: 404 }; },
  });
  const s = await bg.ctx.osubGetSession();
  assert.equal(s.token, 'new');
  assert.equal(logins, 1);
  bg.storage.osub_session.expiry = 1;
  assert.equal(await bg.ctx.osubGetSession(), null);
  assert.equal(logins, 1, 'relogin must wait 10 minutes');
});

test('no saved account means no login attempt', async () => {
  const bg = loadBackground({ storage: { osub_session: { token: 'old', expiry: 1 } }, fetchImpl: () => ({ ok: false, status: 500 }) });
  assert.equal(await bg.ctx.osubGetSession(), null);
  assert.equal(bg.calls.length, 0);
});

function dlBackground(storage, text) {
  return loadBackground({
    storage,
    fetchImpl: (url) => url.endsWith('/download')
      ? { ok: true, status: 200, json: async () => ({ link: 'https://cdn.example/f.srt', remaining: 9 }) }
      : { ok: true, status: 200, text: async () => text },
  });
}

test('subtitle cache stays under its size budget, oldest out first', async () => {
  const big = 'x'.repeat(700000);
  const bg = dlBackground({ osub_sub_cache: { f900: big, f100: big } }, 'y'.repeat(700000));
  const r = await bg.ctx.osubDownload(3, null);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(Object.keys(bg.storage.osub_sub_cache)), '["f100","f3"]');
  const again = await bg.ctx.osubDownload(3, null);
  assert.equal(again.text.length, 700000);
  assert.equal(bg.calls.length, 2, 'second read must come from the cache');
});

test('one huge subtitle file is used but not cached', async () => {
  const bg = dlBackground({ osub_sub_cache: { keep: 'k' } }, 'z'.repeat(1500000));
  const r = await bg.ctx.osubDownload(4, null);
  assert.equal(r.ok, true);
  assert.equal(r.text.length, 1500000);
  assert.equal(JSON.stringify(Object.keys(bg.storage.osub_sub_cache)), '["keep"]');
});

// ── Engine guards (static: these live inside the content IIFE) ──────────────
test('engine: serialised stats and cache writes, no NaN sessions, no first-button fallback', () => {
  assert.match(CONTENT, /function _serialStats\(fn\)/);
  assert.match(CONTENT, /function _serialCache\(fn\)/);
  assert.match(CONTENT, /st\.sessionsTotal = \(Number\(st\.sessionsTotal\) \|\| 0\) \+ 1;/);
  assert.equal(/sessionsTotal = \(st\.sessionsTotal \|\| 0\) \+ 1/.test(CONTENT), false);
});
