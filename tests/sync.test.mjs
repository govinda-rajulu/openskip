import test from 'node:test';
import assert from 'node:assert/strict';
import { read, loadBackground, fakeResponse } from './harness.mjs';

const SUPA = { supabaseUrl: 'https://abcdefghijklmnop.supabase.co', supabaseAnonKey: 'anon-test-key' };
const LOCAL = { ...SUPA, skipMode: 'auto-intro', skipIntro: true, skipRecap: false, skipOutro: false, skipEnabled: true,
  playbackSpeed: 1.25, skipstream_theme: 'dark', skipstream_stats: { skipsTotal: 41 },
  skipstream_site_rules: { 'hianime.to': 'auto-all' }, skipstream_install_id: 'secret-install' };

const settingsCalls = (bg) => bg.calls.filter(c => c.url.endsWith('/rpc/ss_put_settings')).map(c => JSON.parse(c.opts.body));

test('O1: a site-rule-only write still sends local prefs, stats and theme', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...LOCAL } });
  const r = await bg.send({ type: 'SUPABASE_SETTINGS_UPSERT', body: { user_id: 'u1', site_rules: { 'x.com': 'off' } } });
  assert.equal(r.ok, true);
  const [body] = settingsCalls(bg);
  assert.deepEqual(body.p_site_rules, { 'x.com': 'off' });
  assert.equal(body.p_prefs.skipMode, 'auto-intro');
  assert.equal(body.p_prefs.playbackSpeed, 1.25);
  assert.equal(body.p_stats.skipsTotal, 41);
  assert.equal(body.p_theme, 'dark');
});

test('O1: prefs never carry credentials or ids', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...LOCAL } });
  await bg.send({ type: 'SUPABASE_SETTINGS_UPSERT', body: { user_id: 'u1', prefs: { skipMode: 'off', supabaseAnonKey: 'leak', tmdbApiKey: 'leak' } } });
  const [body] = settingsCalls(bg);
  assert.deepEqual(body.p_prefs, { skipMode: 'off' });
  assert.equal(JSON.stringify(body).includes('leak'), false);
  assert.equal(JSON.stringify(body).includes('secret-install'), false);
});

test('O1: a popup pref change is pushed to the cloud (debounced)', async () => {
  const timers = [];
  const bg = loadBackground({ fetchImpl: () => fakeResponse(200, null), storage: { ...LOCAL },
    ctxExtra: { setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {} } });
  const onChanged = bg.listeners['browser.storage.onChanged.addListener'];
  for (const l of onChanged) l({ skipMode: { newValue: 'prompt' } }, 'local');
  const push = timers.find(t => t.ms === 5000);
  assert.ok(push, 'no debounced push scheduled');
  await push.f();
  const [body] = settingsCalls(bg);
  assert.ok(body && body.p_prefs.skipMode, 'push did not post ss_put_settings');
  // unrelated keys never trigger a push
  timers.length = 0;
  for (const l of onChanged) l({ skipstream_cache: { newValue: {} } }, 'local');
  assert.equal(timers.some(t => t.ms === 5000), false);
});

test('B5: an HTTP error from PostgREST is an error, not a row', async () => {
  const bg = loadBackground({ fetchImpl: () => fakeResponse(400, { message: 'boom' }), storage: { ...SUPA } });
  const all = await bg.send({ type: 'SUPABASE_GET_ALL', userId: 'u1' });
  assert.equal(all.data, null);
  const one = await bg.send({ type: 'SUPABASE_GET', userId: 'u1', mediaId: 'm' });
  assert.equal(one.data, null);
  assert.ok(one.err);
});

test('B2: queue-flush alarm is created without a service worker (Firefox)', () => {
  const bg = loadBackground({ storage: {} });
  const creates = (bg.listeners.__calls || []).filter(([p]) => p.endsWith('.alarms.create')).map(([, a]) => a[0]);
  return new Promise(r => setTimeout(r, 10)).then(() => {
    const later = (bg.listeners.__calls || []).filter(([p]) => p.endsWith('.alarms.create')).map(([, a]) => a[0]);
    assert.ok(later.includes('ss_queue_flush'), 'created: ' + JSON.stringify(later));
    assert.equal(later.includes('ss_heartbeat'), false, 'heartbeat is SW-only');
    void creates;
  });
});

test('O2: Sync Now reads the cloud first and skips rows the cloud has newer', () => {
  const src = read('options.js');
  const blk = src.slice(src.indexOf("const syncBtn = $('syncNowBtn');"), src.indexOf('// -- Export --'));
  const iRead = blk.indexOf("type: 'SUPABASE_GET_ALL'");
  const iLoop = blk.indexOf('for (const [mediaId, entry] of entries)');
  assert.ok(iRead > 0 && iLoop > iRead, 'cloud read must precede the push loop');
  assert.ok(blk.includes('cloudTs[mediaId] >= localTs) continue;'));
  assert.ok(blk.includes("throw new Error('cloud read failed"));
});

test('O1: the cloud pull applies only allowlisted pref keys', () => {
  const src = read('options.js');
  assert.ok(src.includes('for (const k of CLOUD_PREF_ALLOW)'));
  assert.equal(src.includes('await br.storage.local.set(cloudResult.data.prefs)'), false);
});

test('allowlists in background.js and options.js are identical', () => {
  const grab = (s, name) => JSON.parse(s.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"').replace(/\s+/g, ''));
  assert.deepEqual(grab(read('options.js'), 'CLOUD_PREF_ALLOW'), grab(read('background.js'), 'SYNC_PREF_KEYS'));
});

// ── Second audit (H-series) ───────────────────────────────────────────────────
test('H14: the OpenSubtitles token only ever goes to an OpenSubtitles host', () => {
  const bg = loadBackground({});
  const h = bg.ctx.osubHost;
  assert.equal(h('vip-api.opensubtitles.com'), 'vip-api.opensubtitles.com');
  assert.equal(h('api.opensubtitles.com'), 'api.opensubtitles.com');
  for (const bad of ['evil.com', 'opensubtitles.com.evil.com', 'api.opensubtitles.com/x', '', null, 'evil.com#.opensubtitles.com'])
    assert.equal(h(bad), 'api.opensubtitles.com', String(bad));
});

test('H17/H19/H20: history + clear-cloud hardening present', () => {
  const src = read('options.js');
  assert.ok(src.includes('if (!/^https:\\/\\/[a-z0-9-]+\\.supabase\\.co$/i.test(sbUrl))'));
  assert.ok(src.includes('if (Array.isArray(result?.data)) {'));
  assert.ok(src.includes('return [...merged.values()].sort((a, b) => _ssTs(b) - _ssTs(a));'));
});

test('H27: master toggle restores the last non-off mode', () => {
  const src = read('popup.js');
  assert.ok(src.includes("(popupMode !== 'off' ? popupMode : (lastActiveMode || 'auto-all'))"));
  assert.equal(src.includes("popupMode === 'off' ? 'auto-all' : popupMode"), false);
});
