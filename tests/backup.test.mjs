// Backup v2: one file restores settings, rules, stats, history, and on request
// the sync identity and the API keys (encrypted). Version 1 files still import.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, extractFunction, extractConst, loadBackground, fakeResponse } from './harness.mjs';

const OPTS = read('options.js');
const code = ['S', 'IMPORT_BOOL', 'IMPORT_MODES', 'DENY'].map(c => extractConst(OPTS, c)).join('\n') + '\n' +
  ['backupKit', 'importValueOk', 'mergeImportedStats', 'migrateImportData'].map(n => extractFunction(OPTS, n)).join('\n') +
  '\n;({ kit: backupKit(crypto.subtle, n => crypto.getRandomValues(new Uint8Array(n))), importValueOk, mergeImportedStats, migrateImportData, S, DENY })';
const M = vm.runInContext(code, vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, Object, Number, String, Math, Array, Set, Error }));
const opts = (pass = '') => ({ passphrase: pass, valueOk: M.importValueOk, mergeStats: M.mergeImportedStats,
  migrate: M.migrateImportData, legacyKeys: Object.values(M.S).filter(k => !M.DENY.has(k)) });
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const FULL = {
  skipMode: 'auto-intro', skipIntro: true, resumePlayback: true, playbackSpeed: 1.25, deviceName: 'Work Laptop',
  subtitle_language: 'ta', subtitle_font_size: 22, skipstream_theme: 'dark', skipstream_seed_color: '#57a860',
  skipstream_site_rules: { 'hianime.to': 'auto-all' }, skipstream_stats: { skipsTotal: 12, timeSavedSec: 600 },
  statsTotalSkips: 12,
  skipstream_cache: { 'tv/1': { p: 300, d: 1200, t: 2000, title: 'Ep 1' }, 'movie/603': { p: 50, d: 8160, t: 1000 } },
  supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon-SECRET-1', tmdbApiKey: 'tmdb-SECRET-2',
  osub_username: 'govind', osub_password: 'pw-SECRET-3', skipstream_install_id: ID,
  osub_session: { token: 'tok' }, osub_sub_cache: { f1: 'subtitle text' }, ss_tmdb_cache: { a: 1 },
  skipstream_offline_queue: [{ x: 1 }], skipstream_error_log: [{ msg: 'e' }], ss_tab_state: { 1: {} },
};

test('backup v2: settings, rules, stats and history restore into an empty browser', async () => {
  const file = JSON.parse(JSON.stringify(await M.kit.buildBackup(FULL)));
  const r = await M.kit.readBackup(file, {}, opts());
  assert.equal(r.set.skipMode, 'auto-intro');
  assert.equal(r.set.deviceName, 'Work Laptop');
  assert.equal(r.set.subtitle_language, 'ta');
  assert.equal(JSON.stringify(r.set.skipstream_site_rules), JSON.stringify({ 'hianime.to': 'auto-all' }));
  assert.equal(r.set.skipstream_stats.skipsTotal, 12);
  assert.equal(r.set.skipstream_cache['tv/1'].p, 300);
  assert.equal(r.report.history, 2);
  assert.equal(r.installId, null, 'identity only when asked for');
});

test('backup v2: keys, logins, caches, sessions, queues and the error log are not in a plain backup', async () => {
  const text = JSON.stringify(await M.kit.buildBackup(FULL));
  for (const s of ['SECRET', 'govind', 'tok', 'subtitle text', 'error_log', 'offline_queue', 'ss_tab_state', ID]) {
    assert.equal(text.includes(s), false, 'leaked: ' + s);
  }
});

test('backup v2: keys and logins are encrypted and come back only with the passphrase', async () => {
  const file = JSON.parse(JSON.stringify(await M.kit.buildBackup(FULL, { passphrase: 'correct horse' })));
  const text = JSON.stringify(file);
  assert.equal(text.includes('SECRET'), false, 'plaintext secret in file');
  assert.equal(file.secrets.alg, 'AES-GCM');
  const r = await M.kit.readBackup(file, {}, opts('correct horse'));
  assert.equal(r.set.supabaseAnonKey, 'anon-SECRET-1');
  assert.equal(r.set.osub_password, 'pw-SECRET-3');
  assert.equal(r.report.secrets, 5);
  await assert.rejects(M.kit.readBackup(file, {}, opts('wrong horse')), /wrong_passphrase/);
  await assert.rejects(M.kit.readBackup(file, {}, opts('')), /need_passphrase/);
});

test('backup v2: importing merges history (newer wins) instead of replacing it', async () => {
  const file = await M.kit.buildBackup(FULL);
  const mine = { skipstream_cache: { 'tv/1': { p: 900, t: 5000 }, 'local/only': { p: 10, t: 10 } } };
  const r = await M.kit.readBackup(file, mine, opts());
  assert.equal(r.set.skipstream_cache['tv/1'].p, 900, 'newer local position kept');
  assert.equal(r.set.skipstream_cache['local/only'].p, 10, 'local-only entry kept');
  assert.equal(r.set.skipstream_cache['movie/603'].p, 50, 'backup-only entry added');
});

test('backup v2: per-site rules merge, the backup wins per domain', async () => {
  const file = await M.kit.buildBackup(FULL);
  const r = await M.kit.readBackup(file, { skipstream_site_rules: { 'hianime.to': 'off', 'x.com': 'prompt' } }, opts());
  assert.equal(JSON.stringify(r.set.skipstream_site_rules), JSON.stringify({ 'hianime.to': 'auto-all', 'x.com': 'prompt' }));
});

test('backup v2: "link devices" carries the sync identity; a bad id is ignored', async () => {
  const file = await M.kit.buildBackup(FULL, { includeIdentity: true });
  assert.equal((await M.kit.readBackup(file, {}, opts())).installId, ID);
  file.identity.installId = 'not-a-uuid';
  assert.equal((await M.kit.readBackup(file, {}, opts())).installId, null);
});

test('backup: a version 1 file (1.10 and older) still imports, and its history merges', async () => {
  const v1 = { schemaVersion: 1, skipMode: 'prompt', skipstream_cache: { 'tv/9': { p: 70, t: 3 } }, osub_session: { token: 'x' } };
  const r = await M.kit.readBackup(v1, { skipstream_cache: { 'tv/8': { p: 5, t: 1 } } }, opts());
  assert.equal(r.set.skipMode, 'prompt');
  assert.equal(JSON.stringify(Object.keys(r.set.skipstream_cache).sort()), JSON.stringify(['tv/8', 'tv/9']));
  assert.equal('osub_session' in r.set, false);
});

test('backup: wrong types are skipped, not written', async () => {
  const file = await M.kit.buildBackup(FULL);
  file.settings.skipMode = 'explode'; file.settings.subtitle_font_size = 999;
  const r = await M.kit.readBackup(file, {}, opts());
  assert.equal('skipMode' in r.set, false);
  assert.equal(JSON.stringify([...r.skipped].sort()), JSON.stringify(['skipMode', 'subtitle_font_size']));
});

// ── background: linking moves this browser's cloud rows first ───────────────
const SUPA = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon', skipstream_install_id: '11111111-1111-4111-8111-111111111111' };

test('link devices: this browser\'s cloud rows move to the new id, then the id switches', async () => {
  const bg = loadBackground({ storage: { ...SUPA }, fetchImpl: (url) => url.endsWith('ss_get_playback_all')
    ? fakeResponse(200, [{ user_id: SUPA.skipstream_install_id, media_id: 'tv/1', playback_time: 40 }, { user_id: 'x', media_id: 'tv/2', playback_time: 9 }])
    : fakeResponse(200, null) });
  const r = await bg.send({ type: 'ADOPT_INSTALL_ID', installId: ID });
  assert.equal(r.ok, true);
  assert.equal(r.moved, 2);
  const puts = bg.calls.filter(c => c.url.endsWith('ss_put_playback')).map(c => JSON.parse(c.opts.body).p_row);
  assert.deepEqual(puts.map(p => p.user_id), [ID, ID]);
  assert.equal(bg.storage.skipstream_install_id, ID);
});

test('link devices: if the cloud copy fails, the id does not switch', async () => {
  const bg = loadBackground({ storage: { ...SUPA }, fetchImpl: () => fakeResponse(500, {}) });
  const r = await bg.send({ type: 'ADOPT_INSTALL_ID', installId: ID });
  assert.equal(r.ok, false);
  assert.equal(bg.storage.skipstream_install_id, SUPA.skipstream_install_id);
});
