// Test harness: loads the real extension files into node:vm with stubbed
// browser APIs. No build step, no dependencies: node --test tests/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Any-shaped stub: every property exists, every call resolves to {}.
// Calls to *.addListener(fn) are recorded under their dotted path.
export function makeBrowser(listeners, storage = {}, overrides = {}) {
  const mk = (p) => new Proxy(function () {}, {
    get(_t, k) {
      if (k === 'then') return undefined;
      if ((p + '.' + String(k)) in overrides) return overrides[p + '.' + String(k)];
      if (p === 'browser.runtime' && k === 'id') return 'skipstream@test';
      if (p === 'browser.storage.local' && k === 'get') return async (keys) => {
        const ks = keys == null ? Object.keys(storage) : [].concat(keys);
        const o = {}; for (const x of ks) if (x in storage) o[x] = storage[x]; return o;
      };
      if (p === 'browser.storage.local' && k === 'set') return async (o) => { Object.assign(storage, o); };
      return mk(p + '.' + String(k));
    },
    apply(_t, _this, args) {
      if (p.endsWith('.addListener')) { (listeners[p] ||= []).push(args[0]); return undefined; }
      (listeners.__calls ||= []).push([p, args]);
      if (p.endsWith('.alarms.get')) return Promise.resolve(undefined);   // no alarm exists yet
      return Promise.resolve({});
    },
  });
  return mk('browser');
}

export function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
           headers: { get: () => 'application/json' } };
}

// Loads background.js; fetchImpl(url, opts) returns a fakeResponse.
export function loadBackground({ fetchImpl, storage = {}, ctxExtra = {}, overrides = {} } = {}) {
  const listeners = {};
  const calls = [];
  const ctx = {
    console, URL, URLSearchParams, TextEncoder, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON,
    fetch: async (url, opts) => { calls.push({ url: String(url), opts }); return fetchImpl ? fetchImpl(String(url), opts) : fakeResponse(404, {}); },
  };
  Object.assign(ctx, ctxExtra);
  ctx.self = { addEventListener: () => {} };
  ctx.globalThis = ctx;
  ctx.browser = makeBrowser(listeners, storage, overrides);
  vm.createContext(ctx);
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
  const onMessage = listeners['browser.runtime.onMessage.addListener']?.[0];
  const send = (msg) => new Promise((res) => {
    const r = onMessage(msg, { tab: { id: 1 } }, res);
    if (r !== true) setTimeout(() => res(undefined), 50);
  });
  return { ctx, calls, send, listeners, storage };
}

// Pulls one named function's exact source text out of a file (brace matched).
export function extractFunction(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i;
  // skip the parameter list's closing paren first
  let depthP = 1, j = m.index + m[0].length;
  while (depthP && j < src.length) { if (src[j] === '(') depthP++; else if (src[j] === ')') depthP--; j++; }
  i = src.indexOf('{', j);
  let depth = 0, k = i;
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) break; } }
  if (depth) throw new Error('unbalanced: ' + name);
  return src.slice(m.index, k + 1);
}

export function extractConst(src, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*[^;]*;`).exec(src);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// Evaluates chosen content.js functions together in one sandbox.
export function contentFns(names, consts = [], globals = {}) {
  const src = read('content-scripts/content.js');
  const code = consts.map(c => extractConst(src, c)).join('\n') + '\n' +
    names.map(n => extractFunction(src, n)).join('\n') +
    `\n;({${[...names, ...consts].join(',')}})`;
  const ctx = vm.createContext({ URLSearchParams, URL, Number, Object, String, ...globals });
  return vm.runInContext(code, ctx);
}
