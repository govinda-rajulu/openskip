import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, makeBrowser } from './harness.mjs';

// Loads the WHOLE content script with a permissive fake DOM. Catches init-time
// ReferenceErrors / TDZ bugs that node --check cannot see. Does not prove UI.
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

function loadContent(href) {
  const u = new URL(href);
  const listeners = {}, errors = [];
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    URL, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame() {}, location: { href, hostname: u.hostname, pathname: u.pathname, search: u.search },
    document: any('document'), history: any('history'), navigator: any('navigator'), getComputedStyle: () => any('cs'),
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    HTMLVideoElement: class {}, Node: class {}, Element: class {}, frames: [],
    addEventListener: (t, f) => { (listeners['window.' + t] ||= []).push(f); }, removeEventListener() {}, postMessage() {},
  };
  ctx.window = ctx; ctx.top = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.browser = makeBrowser(listeners, {});
  vm.createContext(ctx);
  vm.runInContext(read('content-scripts/content.js'), ctx, { filename: 'content.js' });
  return { listeners, errors };
}

for (const href of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://example.com/tv/1399/season/1/episode/1', 'https://example.com/movie/1726']) {
  test('content.js initialises without throwing: ' + href, async () => {
    const r = loadContent(href);
    await new Promise((res) => setImmediate(res));
    assert.ok(r.listeners['browser.runtime.onMessage.addListener'], 'message listener registered');
    assert.ok(r.listeners['window.message'], 'relay listener registered');
    assert.deepEqual(r.errors, []);
  });
}
