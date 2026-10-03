// Audit H23b: stats, the settings backup and the device name are Firefox
// "technicalAndInteraction" data. That category can only be optional, so the
// user can switch it off; SkipStream must then stop sending it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, loadBackground, fakeResponse } from './harness.mjs';

const SUPA = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon-test-key',
  skipstream_stats: { skipsTotal: 7 }, skipMode: 'auto-intro', skipstream_install_id: 'u-1' };
const OFF = { 'browser.permissions.getAll': async () => ({ permissions: [], origins: [], data_collection: [] }) };
const ON = { 'browser.permissions.getAll': async () => ({ permissions: [], origins: [], data_collection: ['technicalAndInteraction'] }) };
const ROW = { user_id: 'u-1', media_id: 'tv/1', playback_time: 50, duration: 1200, device_name: 'Work Laptop' };
const bodies = (bg, rpc) => bg.calls.filter(c => c.url.endsWith('/rpc/' + rpc)).map(c => JSON.parse(c.opts.body));

test('H23b: manifest keeps the required list and adds technicalAndInteraction as optional', () => {
  const dcp = JSON.parse(read('manifest.json')).browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(dcp.required, ['browsingActivity', 'websiteContent', 'authenticationInfo']);
  assert.deepEqual(dcp.optional, ['technicalAndInteraction']);
});

test('H23b: with technical data off, a settings backup is not sent', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...SUPA }, overrides: OFF });
  const r = await bg.send({ type: 'SUPABASE_SETTINGS_UPSERT', body: { user_id: 'u-1', site_rules: {} } });
  assert.equal(r.ok, false);
  assert.equal(r.err, 'tech_data_off');
  assert.equal(bodies(bg, 'ss_put_settings').length, 0);
});

test('H23b: with technical data off, a pref change is not pushed', async () => {
  const timers = [];
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...SUPA }, overrides: OFF,
    ctxExtra: { setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {} } });
  for (const l of bg.listeners['browser.storage.onChanged.addListener']) l({ skipMode: { newValue: 'prompt' } }, 'local');
  const push = timers.find(t => t.ms === 5000);
  assert.ok(push, 'no debounced push scheduled');
  await push.f();
  assert.equal(bodies(bg, 'ss_put_settings').length, 0);
});

test('H23b: with technical data off, playback still syncs but without the device name', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...SUPA }, overrides: OFF });
  await bg.send({ type: 'SUPABASE_UPSERT', body: { ...ROW } });
  const [b] = bodies(bg, 'ss_put_playback');
  assert.ok(b, 'playback row was not sent');
  assert.equal(b.p_row.media_id, 'tv/1');
  assert.equal(b.p_row.device_name, null);
});

test('H23b: with technical data on (Firefox default), settings and device name are sent', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...SUPA }, overrides: ON });
  const r = await bg.send({ type: 'SUPABASE_SETTINGS_UPSERT', body: { user_id: 'u-1' } });
  assert.equal(r.ok, true);
  assert.equal(bodies(bg, 'ss_put_settings')[0].p_stats.skipsTotal, 7);
  await bg.send({ type: 'SUPABASE_UPSERT', body: { ...ROW } });
  assert.equal(bodies(bg, 'ss_put_playback')[0].p_row.device_name, 'Work Laptop');
});

test('H23b: Chrome has no data_collection key, so nothing is withheld there', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...SUPA },
    overrides: { 'browser.permissions.getAll': async () => ({ permissions: [], origins: [] }) } });
  await bg.send({ type: 'SUPABASE_UPSERT', body: { ...ROW } });
  assert.equal(bodies(bg, 'ss_put_playback')[0].p_row.device_name, 'Work Laptop');
});
