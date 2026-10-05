// AMO: release notes cut after a whole line, the add-on icon, listing-only runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const amo = require('../scripts/amo-update.js');
const SRC = readFileSync('scripts/amo-update.js', 'utf8');

test('notes: short notes stay as they are', () => {
  assert.equal(amo.fitNotes('- a\n- b', '1.0.0'), '- a\n- b');
});

test('notes: long notes are cut after a whole line and end with a link to the full notes', () => {
  const lines = Array.from({ length: 60 }, (_, i) => '- line ' + i + ' ' + 'x'.repeat(80));
  const out = amo.fitNotes(lines.join('\n'), '1.13.0');
  assert.ok(out.length <= 3000, String(out.length));
  const got = out.split('\n');
  assert.equal(got.pop(), '- More in the full release notes: https://github.com/govinda-rajulu/openskip/releases/tag/v1.13.0');
  got.forEach((l, i) => assert.equal(l, lines[i]));
});

test('notes: the 1.13.0 changelog fits AMO without a cut line', () => {
  const full = amo.extractChangelogNotes('1.13.0');
  assert.ok(full.length > 3000, 'the 1.13.0 notes are long');
  const out = amo.fitNotes(full, '1.13.0');
  assert.ok(out.length <= 3000);
  const body = out.split('\n').slice(0, -1);
  for (const l of body) assert.ok(full.split('\n').includes(l), 'whole line: ' + l.slice(0, 40));
  assert.doesNotMatch(SRC, /\.slice\(0, 3000\)/);
  assert.doesNotMatch(readFileSync('.github/workflows/amo-submit.yml', 'utf8'), /\[:3000\]/);
});

test('workflow: listing_only input reaches the script', () => {
  const wf = readFileSync('.github/workflows/amo-submit.yml', 'utf8');
  assert.match(wf, /\n      listing_only:\n/);
  assert.match(wf, /LISTING_ONLY: {3}\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.listing_only == 'true' && '1' \|\| '0' \}\}/);
});

// Runs the real script against a fake AMO (https.request replaced before the script loads).
function fakeRun(env, addon) {
  const dir = mkdtempSync(join(tmpdir(), 'amo-'));
  const log = join(dir, 'calls.json');
  const pre = join(dir, 'fake.cjs');
  writeFileSync(pre, `
const https = require('https'); const fs = require('fs'); const { EventEmitter } = require('events');
const calls = []; const addon = ${JSON.stringify(addon)};
https.request = (o, cb) => {
  const req = new EventEmitter(); let body = Buffer.alloc(0);
  req.write = (b) => { body = Buffer.concat([body, Buffer.from(b)]); };
  req.end = () => {
    calls.push({ m: o.method, p: o.path, ct: (o.headers['Content-Type'] || '').split(';')[0], body: body.toString('latin1').slice(0, 4000) });
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls));
    let status = 200, data = {};
    if (o.method === 'GET') data = addon;
    if (o.method === 'POST') status = 500;
    const res = new EventEmitter(); res.statusCode = status; res.headers = {};
    cb(res); res.emit('data', Buffer.from(JSON.stringify(data))); res.emit('end');
  };
  return req;
};`);
  const r = spawnSync(process.execPath, ['--require', pre, 'scripts/amo-update.js'], {
    env: { PATH: process.env.PATH, AMO_API_KEY: 'k', AMO_API_SECRET: 's', ...env }, encoding: 'utf8', timeout: 20000 });
  let calls = []; try { calls = JSON.parse(readFileSync(log, 'utf8')); } catch {}
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

test('listing only: notes of the current version, listing text, icon; nothing uploaded', () => {
  const { code, out, calls } = fakeRun({ LISTING_ONLY: '1' }, { current_version: { id: 6543062, version: '1.13.0' }, icon_url: 'https://addons.mozilla.org/static-server/img/addon-icons/default-64.png' });
  assert.equal(code, 0, out);
  const w = calls.filter((c) => c.m !== 'GET').map((c) => c.m + ' ' + c.p + ' ' + c.ct);
  assert.deepEqual(w, [
    'PATCH /api/v5/addons/addon/skipstream/versions/6543062/ application/json',
    'PATCH /api/v5/addons/addon/skipstream/ application/json',
    'PATCH /api/v5/addons/addon/skipstream/ multipart/form-data',
  ]);
  const notes = JSON.parse(calls.find((c) => c.p.includes('/versions/6543062/')).body).release_notes['en-US'];
  assert.ok(notes.length <= 3000 && notes.endsWith('releases/tag/v1.13.0'));
  const icon = calls[calls.length - 1].body;
  assert.match(icon, /name="icon"; filename="icon-128\.png"\r\nContent-Type: image\/png/);
  assert.ok(icon.includes('PNG'), 'the PNG bytes are sent');
});

test('listing only: refuses when AMO shows another version; an icon already set is left alone', () => {
  const a = fakeRun({ LISTING_ONLY: '1' }, { current_version: { id: 1, version: '1.12.0' }, icon_url: 'https://addons.mozilla.org/user-media/addon_icons/3018/3018048-64.png' });
  assert.equal(a.code, 1);
  assert.match(a.out, /AMO current version is 1\.12\.0, expected 1\.13\.0/);
  assert.equal(a.calls.filter((c) => c.m !== 'GET').length, 0);
  const b = fakeRun({ LISTING_ONLY: '1' }, { current_version: { id: 6543062, version: '1.13.0' }, icon_url: 'https://addons.mozilla.org/user-media/addon_icons/3018/3018048-64.png' });
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /icon already set/);
  assert.equal(b.calls.filter((c) => c.ct === 'multipart/form-data').length, 0);
});
