// Video detection in embedded players, the "Skipped, Undo" guard, the page
// check, and the removed Chrome keepalive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, contentFns, loadBackground } from './harness.mjs';

const CONTENT = read('content-scripts/content.js');

// Minimal DOM: elements with optional shadow roots; querySelectorAll('*') walks children.
function el(tag, kids = [], shadowKids = null) {
  const e = { tag, kids, shadowRoot: null };
  if (shadowKids) e.shadowRoot = root(shadowKids);
  return e;
}
function root(kids) {
  const all = () => { const out = []; const walk = n => { for (const k of n.kids) { out.push(k); walk(k); } }; walk({ kids }); return out; };
  return { kids, querySelectorAll: (sel) => sel === '*' ? all() : all().filter(x => x.tag === sel),
    querySelector: (sel) => all().find(x => x.tag === sel) || null };
}

test('detect: a <video> inside a player component (shadow root) is found', () => {
  const { _shadowVideos } = contentFns(['_shadowVideos']);
  const doc = root([el('div', [el('media-player', [], [el('div', [el('video')])])])]);
  assert.equal(_shadowVideos(doc, 0, [], 6).length, 1);
  assert.equal(doc.querySelector('video'), null, 'plain lookup cannot see it');
});

function fakeTimers() {
  let now = 0, id = 0; const t = [];
  return {
    setTimeout: (f, ms) => { t.push({ id: ++id, at: now + ms, f }); return id; },
    clearTimeout: (x) => { const i = t.findIndex(e => e.id === x); if (i >= 0) t.splice(i, 1); },
    setInterval: (f, ms) => { const e = { id: ++id, at: now + ms, f, every: ms }; t.push(e); return e.id; },
    clearInterval: (x) => { const i = t.findIndex(e => e.id === x); if (i >= 0) t.splice(i, 1); },
    advance(ms) { const end = now + ms; for (;;) { t.sort((a, b) => a.at - b.at); const e = t[0]; if (!e || e.at > end) break; now = e.at; if (e.every) e.at += e.every; else t.shift(); e.f(); } now = end; },
  };
}

test('detect: an embedded player whose video appears after 30 s still starts (no 5 s cutoff)', () => {
  const kids = [];
  const doc = { ...root(kids), documentElement: {}, addEventListener() {}, removeEventListener() {} };
  doc.querySelector = (s) => kids.find(k => k.tag === s) || null;
  doc.querySelectorAll = (s) => s === '*' ? kids : kids.filter(k => k.tag === s);
  const T = fakeTimers();
  let started = 0;
  const { _waitForVideo } = contentFns(['_waitForVideo', '_shadowVideos'], [], { MutationObserver: class { observe() {} disconnect() {} } });
  _waitForVideo(doc, () => started++, T);
  T.advance(29000);
  assert.equal(started, 0);
  kids.push(el('video'));       // the user finally picked a source
  T.advance(2500);
  assert.equal(started, 1);
  T.advance(10000);
  assert.equal(started, 1, 'starts once');
});

test('detect: the old 5-second give-up is gone', () => {
  assert.equal(/_waitObs\.disconnect\(\);\s*\},\s*5000\)/.test(CONTENT), false);
});

test('undo: an undone segment is left alone until it has played past, same video only', () => {
  const { _skipUndone } = contentFns(['_skipUndone']);
  const v = { _ssUndone: { key: 'intro', until: 90, media: 'tv/1' } };
  assert.equal(_skipUndone(v, 'intro', 40, 'tv/1'), true);
  assert.equal(_skipUndone(v, 'recap', 40, 'tv/1'), false);
  assert.equal(_skipUndone(v, 'intro', 40, 'tv/2'), false, 'other video');
  assert.equal(v._ssUndone, null);
  const w = { _ssUndone: { key: 'intro', until: 90, media: 'tv/1' } };
  assert.equal(_skipUndone(w, 'intro', 95, 'tv/1'), false, 'played past');
});

test('undo: automatic skips show the notice only when asked (1.13), and prompt-mode Undo no longer restarts the countdown', () => {
  assert.match(CONTENT, /recordSkipStat\(segment\.end_sec - prevTime\);\n\s*_diag\.last = [^\n]*\n\s*video\._ssLastSkip = [^\n]*\n[^\n]*\n\s*if \(prefs\.skipNotice\) showSkippedNotice\(segKey, segment, video, prevTime\);/);
  assert.match(CONTENT, /toast\.remove\(\);\n\s*\/\/ Without this[^\n]*\n\s*video\._ssUndone = /);
});

test('page check: the popup gets one report per frame', async () => {
  const bg = loadBackground({ storage: {} });
  const run = bg.send({ type: 'SS_DIAG_RUN', tabId: 1 });
  await new Promise(r => setTimeout(r, 50));
  await bg.send({ type: 'SS_DIAG_REPORT', report: { frame: 'www.1shows.bz/movies/603', top: true, videos: 0, blankFrames: 1 } });
  await bg.send({ type: 'SS_DIAG_REPORT', report: { frame: 'www.viduki.net/1/movie/603', top: false, videos: 1, attached: 1 } });
  const r = await run;
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.frames.map(f => [f.frame, f.videos, f.attached])), JSON.stringify([['www.1shows.bz/movies/603', 0, 0], ['www.viduki.net/1/movie/603', 1, 1]]));
});

test('chrome: no 30-second keepalive alarm is created any more', () => {
  const bgSrc = read('background.js');
  assert.equal(/alarms\.create\(ALARM_HEARTBEAT/.test(bgSrc), false);
});

test('device name: Edge on Android (EdgA/) is labelled Edge', () => {
  assert.match(CONTENT, /\/Edg\(A\|iOS\)\?\\\/\/\.test\(navigator\.userAgent\) \? 'Edge'/);
});
