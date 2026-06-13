/* SkipStream - options */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const CRED_KEYS = ['supabaseUrl', 'supabaseAnonKey', 'tmdbApiKey', 'introdbApiKey', 'animeSkipClientId', 'animeSkipAuthToken'];

const fields = {
  supabaseUrl:        document.getElementById('supabaseUrl'),
  supabaseAnonKey:    document.getElementById('supabaseAnonKey'),
  tmdbApiKey:         document.getElementById('tmdbApiKey'),
  introdbApiKey:      document.getElementById('introdbApiKey'),
  animeSkipClientId:  document.getElementById('animeSkipClientId'),
  animeSkipAuthToken: document.getElementById('animeSkipAuthToken'),
};

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(service, state, message) {
  const dot = document.getElementById(`dot-${service}`);
  const msg = document.getElementById(`msg-${service}`);
  if (!dot || !msg) return;
  dot.className = `status-dot ${state}`;
  msg.textContent = message;
  msg.className = `status-msg ${state === 'checking' ? '' : state}`;
}

function allChecking() {
  for (const s of ['supabase', 'tmdb', 'introdb']) setStatus(s, 'checking', 'Checking…');
}

function showAlert(id, type, html) {
  const el = document.getElementById(id);
  if (!el) return;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  el.replaceChildren(...doc.body.firstChild.childNodes);
  el.className = `alert ${type} show`;
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = 'alert';
}

let globalAlertTimer = null;
function showGlobal(type, text) {
  clearTimeout(globalAlertTimer);
  showAlert('globalAlert', type, text);
  globalAlertTimer = setTimeout(() => hideAlert('globalAlert'), 4000);
}


// ── Supabase setup SQL (embedded for in-app copy) ─────────────────────────────
const SUPABASE_SETUP_SQL = `-- SkipStream - Supabase Setup
-- Run once in your Supabase project: SQL Editor > New query > paste > Run.
-- Every statement is fully idempotent: safe to re-run without data loss.
-- Version: 2.0 (2026-06)

-- ── 1. playback_states table ──────────────────────────────────────────────────
create table if not exists public.playback_states (
  id            bigserial    primary key,
  user_id       text         not null,
  media_id      text         not null,
  playback_time integer      not null default 0,
  duration      integer,
  site          text,
  site_name     text,
  video_title   text,
  device_name   text,
  updated_at    timestamptz  not null default now(),
  constraint playback_states_user_media_key unique (user_id, media_id)
);

-- ── 2. Add columns to existing installs (idempotent) ─────────────────────────
do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='site_name') then
    alter table public.playback_states add column site_name text;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='video_title') then
    alter table public.playback_states add column video_title text;
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='playback_states' and column_name='device_name') then
    alter table public.playback_states add column device_name text;
  end if;
end $$;

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
create index if not exists playback_states_user_id_idx
  on public.playback_states (user_id);
create index if not exists playback_states_updated_at_idx
  on public.playback_states (updated_at desc);

-- ── 4. Row-level security ─────────────────────────────────────────────────────
alter table public.playback_states enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_select') then
    execute 'create policy ss_anon_select on public.playback_states for select using (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_insert') then
    execute 'create policy ss_anon_insert on public.playback_states for insert with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_update') then
    execute 'create policy ss_anon_update on public.playback_states for update using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='playback_states' and policyname='ss_anon_delete') then
    execute 'create policy ss_anon_delete on public.playback_states for delete using (true)';
  end if;
end $$;

-- ── 5. Auto-update updated_at trigger ────────────────────────────────────────
create or replace function public.ss_set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger
    where tgname='ss_playback_states_updated_at'
      and tgrelid='public.playback_states'::regclass) then
    create trigger ss_playback_states_updated_at
      before update on public.playback_states
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- ── 6. Drop legacy upsert rule (conflicts with REST ON CONFLICT syntax) ───────
drop rule if exists playback_states_upsert on public.playback_states;

-- ── 7. user_settings table ────────────────────────────────────────────────────
-- Stores stats, preferences, site rules, and theme per user.
-- Synced automatically; restores settings on new installs.
create table if not exists public.user_settings (
  user_id     text         primary key,
  stats       jsonb        not null default '{}',
  prefs       jsonb        not null default '{}',
  site_rules  jsonb        not null default '{}',
  theme       text,
  updated_at  timestamptz  not null default now()
);

alter table public.user_settings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='user_settings' and policyname='ss_settings_select') then
    execute 'create policy ss_settings_select on public.user_settings for select using (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='user_settings' and policyname='ss_settings_insert') then
    execute 'create policy ss_settings_insert on public.user_settings for insert with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='user_settings' and policyname='ss_settings_update') then
    execute 'create policy ss_settings_update on public.user_settings for update using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies
    where schemaname='public' and tablename='user_settings' and policyname='ss_settings_delete') then
    execute 'create policy ss_settings_delete on public.user_settings for delete using (true)';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger
    where tgname='ss_user_settings_updated_at'
      and tgrelid='public.user_settings'::regclass) then
    create trigger ss_user_settings_updated_at
      before update on public.user_settings
      for each row execute function public.ss_set_updated_at();
  end if;
end $$;

-- ── 8. Setup verification function ───────────────────────────────────────────
-- Call select public.ss_verify_setup() after running this script to confirm.
create or replace function public.ss_verify_setup()
  returns jsonb language plpgsql as $$
declare
  result jsonb := '{}';
begin
  -- Check tables
  result := result || jsonb_build_object(
    'playback_states_exists',
    exists(select 1 from information_schema.tables
      where table_schema='public' and table_name='playback_states'),
    'user_settings_exists',
    exists(select 1 from information_schema.tables
      where table_schema='public' and table_name='user_settings')
  );
  -- Check RLS enabled
  result := result || jsonb_build_object(
    'playback_states_rls',
    (select relrowsecurity from pg_class
      where relname='playback_states' and relnamespace='public'::regnamespace),
    'user_settings_rls',
    (select relrowsecurity from pg_class
      where relname='user_settings' and relnamespace='public'::regnamespace)
  );
  -- Check policy counts
  result := result || jsonb_build_object(
    'playback_states_policies',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='playback_states'),
    'user_settings_policies',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='user_settings')
  );
  -- Check triggers
  result := result || jsonb_build_object(
    'triggers_ok',
    (select count(*) from pg_trigger
      where tgname in ('ss_playback_states_updated_at','ss_user_settings_updated_at')) = 2
  );
  return result || jsonb_build_object('setup_complete', true);
end;
$$;

-- Run verification automatically
select public.ss_verify_setup();
`;

// ── Load saved values ─────────────────────────────────────────────────────────

function toggleAnimeSkipFields() {
  const checked = document.getElementById('animeSkipEnabled')?.checked;
  const fieldsDiv = document.getElementById('animeSkipFields');
  if (fieldsDiv) fieldsDiv.style.display = checked ? 'block' : 'none';
}

async function load() {
  const stored = await br.storage.local.get([...CRED_KEYS, 'animeSkipEnabled']);
  for (const key of CRED_KEYS) {
    if (fields[key] && stored[key]) fields[key].value = stored[key];
  }
  const asEl = document.getElementById('animeSkipEnabled');
  if (asEl) {
    asEl.checked = stored.animeSkipEnabled === true;
    asEl.addEventListener('change', toggleAnimeSkipFields);
    toggleAnimeSkipFields();
  }
}

// ── Run simultaneous verification via background ───────────────────────────────

async function runCheck() {
  allChecking();
  hideAlert('sqlAlert');
  hideAlert('globalAlert');

  let result;
  try {
    result = await br.runtime.sendMessage({ type: 'CHECK_CONFIG' });
  } catch (e) {
    showGlobal('err', `Extension error: ${e}`);
    for (const s of ['supabase', 'tmdb', 'introdb']) setStatus(s, 'err', 'Could not reach background');
    return;
  }

  const sb = result.supabase;
  if (!sb) {
    setStatus('supabase', 'err', 'No response');
  } else if (sb.ok) {
    setStatus('supabase', 'ok', `✓ ${sb.message || 'Connected'}`);
  } else if (sb.needsManualSetup) {
    setStatus('supabase', 'warn', sb.message);
    // Extract project ref from URL for deep link
    const _projRef = (supabaseUrl || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || '';
    const _editorUrl = _projRef
      ? `https://supabase.com/dashboard/project/${_projRef}/sql/new`
      : 'https://supabase.com/dashboard';
    showAlert('sqlAlert', 'warn',
      '⚠ <strong>One-time setup needed.</strong> ' +
      'Copy the SQL below and run it in your Supabase SQL Editor, then click <em>Save &amp; Verify</em>.' +
      `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">` +
      `<button id="copySqlBtn" style="font-size:11px;padding:4px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);cursor:pointer">📋 Copy SQL</button>` +
      `<a href="${_editorUrl}" target="_blank" rel="noopener" style="font-size:11px;padding:4px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--accent);color:#fff;text-decoration:none">Open SQL Editor ↗</a>` +
      `<button id="verifySqlBtn" style="font-size:11px;padding:4px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);cursor:pointer">✓ Verify Setup</button>` +
      `</div>`
    );
    // Wire up copy and verify buttons
    const _copyBtn = document.getElementById('copySqlBtn');
    if (_copyBtn) {
      _copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
          _copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { _copyBtn.textContent = '📋 Copy SQL'; }, 2000);
        } catch { /* fallback: select textarea */
          const ta = Object.assign(document.createElement('textarea'), { value: SUPABASE_SETUP_SQL, style: 'position:fixed;opacity:0' });
          document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
          _copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { _copyBtn.textContent = '📋 Copy SQL'; }, 2000);
        }
      };
    }
    const _verifyBtn = document.getElementById('verifySqlBtn');
    if (_verifyBtn) {
      _verifyBtn.onclick = async () => {
        _verifyBtn.textContent = '…Verifying';
        _verifyBtn.disabled = true;
        try {
          const vr = await br.runtime.sendMessage({ type: 'SUPABASE_VERIFY_SETUP' });
          if (vr?.ok) {
            hideAlert('sqlAlert');
            setStatus('supabase', 'ok', '✓ Setup verified — connected');
            showGlobal('ok', '✓ Supabase setup verified successfully.');
          } else {
            _verifyBtn.textContent = '✓ Verify Setup';
            _verifyBtn.disabled = false;
            showGlobal('err', `Verify failed: ${vr?.message || 'unknown error'}`);
          }
        } catch (e) {
          _verifyBtn.textContent = '✓ Verify Setup';
          _verifyBtn.disabled = false;
          showGlobal('err', `Verify error: ${e}`);
        }
      };
    }
  } else {
    setStatus('supabase', 'err', sb.message || 'Error');
  }

  const tm = result.tmdb;
  if (!tm) {
    setStatus('tmdb', 'err', 'No response');
  } else if (tm.ok) {
    setStatus('tmdb', 'ok', '✓ Connected');
  } else {
    setStatus('tmdb', tm.message === 'Not configured' ? 'warn' : 'err', tm.message);
  }

  const idb = result.introdb;
  if (!idb) {
    setStatus('introdb', 'err', 'No response');
  } else if (idb.ok) {
    setStatus('introdb', 'ok', '✓ Connected');
  } else {
    setStatus('introdb', idb.message === 'Not configured' ? 'warn' : 'err', idb.message);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  const btn  = document.getElementById('saveBtn');
  const data = {};

  for (const key of CRED_KEYS) {
    const val = fields[key]?.value.trim() || '';
    if (key === 'supabaseUrl' && val && !/^https?:\/\/.+/.test(val)) {
      showGlobal('err', 'Supabase URL must start with https://');
      return;
    }
    data[key] = val;
  }

  btn.disabled  = true;
  const sp = document.createElement('span'); sp.className = 'spinner'; btn.replaceChildren(sp, document.createTextNode('Saving…'));

  const asEl2 = document.getElementById('animeSkipEnabled');
  if (asEl2) data.animeSkipEnabled = asEl2.checked;
  await br.storage.local.set(data);
  try { await br.runtime.sendMessage({ type: 'INVALIDATE_USER_ID' }); } catch { /* ok */ }
  await runCheck();

  btn.disabled    = false;
  btn.textContent = 'Save & Verify';
  showGlobal('ok', '✓ Credentials saved.');
  pushSettingsToCloud();
}

// ── Clear ─────────────────────────────────────────────────────────────────────

async function clearAll() {
  await br.storage.local.remove(CRED_KEYS);
  for (const key of CRED_KEYS) { if (fields[key]) fields[key].value = ''; }
  for (const s of ['supabase', 'tmdb']) setStatus(s, 'warn', 'Not configured');
  setStatus('introdb', 'warn', 'Not configured');
  hideAlert('sqlAlert');
  showGlobal('ok', 'Credentials cleared.');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('clearBtn').addEventListener('click', clearAll);

// ── Import / Export ───────────────────────────────────────────────────────────
// Export includes credentials, preferences, watch history, stats, site rules, and theme.
// Offline queue and pending-resume are session-only and excluded.

const PREF_KEYS  = ['skipIntro', 'skipRecap', 'skipOutro', 'skipMaster',
                    'resumePlayback', 'autoNextEpisode', 'playbackSpeed',
                    'animeSkipEnabled'];
const DATA_KEYS  = ['skipstream_cache', 'skipstream_stats', 'skipstream_site_rules',
                    'skipstream_theme', 'skipstream_last_sync'];
const EXPORT_KEYS = [...CRED_KEYS, ...PREF_KEYS, ...DATA_KEYS];

async function exportSettings() {
  const stored = await br.storage.local.get(EXPORT_KEYS);
  const out = {
    _version:   br.runtime.getManifest().version,
    _exported:  new Date().toISOString(),
    ...stored,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `skipstream-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showGlobal('ok', `Exported ${Object.keys(stored).length} items.`);
}

async function importSettings(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const safe = {};
    let count = 0;
    for (const key of EXPORT_KEYS) {
      if (key in data) { safe[key] = data[key]; count++; }
    }
    if (count === 0) { showGlobal('err', 'No recognised settings found in file.'); return; }
    // Merge skipstream_cache: keep newer entry per media_id
    if (data.skipstream_cache) {
      const existing = (await br.storage.local.get('skipstream_cache')).skipstream_cache || {};
      const merged = { ...existing };
      for (const [id, entry] of Object.entries(data.skipstream_cache)) {
        if (!merged[id] || (entry.t || 0) > (merged[id].t || 0)) merged[id] = entry;
      }
      safe.skipstream_cache = merged;
    }
    // Merge stats: keep higher values
    if (data.skipstream_stats) {
      const existing = (await br.storage.local.get('skipstream_stats')).skipstream_stats || {};
      safe.skipstream_stats = {
        skipsTotal:   Math.max(data.skipstream_stats.skipsTotal   || 0, existing.skipsTotal   || 0),
        timeSavedSec: Math.max(data.skipstream_stats.timeSavedSec || 0, existing.timeSavedSec || 0),
        sessionsTotal: (data.skipstream_stats.sessionsTotal || 0) + (existing.sessionsTotal || 0),
      };
    }
    await br.storage.local.set(safe);
    showGlobal('ok', `Imported ${count} items. Reloading settings…`);
    await load();
    await runCheck();
    await initSiteRules();
  } catch (e) {
    showGlobal('err', `Import failed: ${e.message}`);
  }
}

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

if (exportBtn) exportBtn.addEventListener('click', exportSettings);
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importSettings(file);
    importFile.value = '';
  });
}

// ── Per-site skip rules ───────────────────────────────────────────────────────
const SITE_RULES_KEY = 'skipstream_site_rules';

const MODE_LABELS = {
  off: 'Off', prompt: 'Prompt',
  'auto-intro': 'Auto Intro', 'auto-recap': 'Auto Recap',
  'auto-outro': 'Auto Outro', 'auto-all': 'Auto All',
};

async function loadSiteRules() {
  const stored = await br.storage.local.get(SITE_RULES_KEY);
  return stored[SITE_RULES_KEY] || {};
}

async function saveSiteRules(rules) {
  await br.storage.local.set({ [SITE_RULES_KEY]: rules });
}

function renderSiteRules(rules) {
  const list = document.getElementById('siteRulesList');
  if (!list) return;
  list.replaceChildren();
  const entries = Object.entries(rules);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--text-muted);padding:6px 0';
    empty.textContent = 'No rules yet. Global settings apply everywhere.';
    list.appendChild(empty);
    return;
  }
  for (const [domain, mode] of entries) {
    const row = document.createElement('div');
    row.className = 'site-rule-row';
    const dom = document.createElement('span'); dom.className = 'site-rule-domain'; dom.textContent = domain;
    const mod = document.createElement('span'); mod.className = 'site-rule-mode'; mod.textContent = MODE_LABELS[mode] || mode;
    const del = document.createElement('button'); del.className = 'site-rule-del'; del.textContent = '×';
    del.title = 'Remove rule';
    del.addEventListener('click', async () => {
      const r = await loadSiteRules();
      delete r[domain];
      await saveSiteRules(r);
      renderSiteRules(r);
    });
    row.append(dom, mod, del);
    list.appendChild(row);
  }
}

async function initSiteRules() {
  const rules = await loadSiteRules();
  renderSiteRules(rules);

  const addBtn    = document.getElementById('siteRuleAddBtn');
  const domainEl  = document.getElementById('siteRuleDomain');
  const modeEl    = document.getElementById('siteRuleMode');

  if (!addBtn || !domainEl || !modeEl) return;

  addBtn.addEventListener('click', async () => {
    let domain = domainEl.value.trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!domain) return;
    const rules = await loadSiteRules();
    rules[domain] = modeEl.value;
    await saveSiteRules(rules);
    renderSiteRules(rules);
    domainEl.value = '';
  });

  domainEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') addBtn.click();
  });
}

// ── Cloud settings sync ───────────────────────────────────────────────────────

async function getUserId() {
  try {
    const res = await br.runtime.sendMessage({ type: 'GET_USER_ID' });
    return res?.userId || null;
  } catch { return null; }
}

async function pushSettingsToCloud() {
  const userId = await getUserId();
  if (!userId) return;
  try {
    const stored = await br.storage.local.get([
      ...PREF_KEYS, ...DATA_KEYS.filter(k => k !== 'skipstream_cache' && k !== 'skipstream_last_sync')
    ]);
    await br.runtime.sendMessage({
      type: 'SUPABASE_SETTINGS_UPSERT',
      body: {
        user_id:    userId,
        stats:      stored.skipstream_stats      || {},
        prefs: Object.fromEntries(PREF_KEYS.map(k => [k, stored[k] ?? null])),
        site_rules: stored.skipstream_site_rules || {},
        theme:      stored.skipstream_theme      || null,
      },
    });
  } catch { /* best-effort */ }
}

async function checkCloudSettingsRestore() {
  const userId = await getUserId();
  if (!userId) return;
  try {
    const res = await br.runtime.sendMessage({ type: 'SUPABASE_SETTINGS_GET', userId });
    if (!res?.data) return;
    const cloud = res.data;
    const cloudTs = cloud.updated_at ? new Date(cloud.updated_at).getTime() : 0;

    // Check if local settings are empty (fresh install) or cloud is newer
    const localStored = await br.storage.local.get([...PREF_KEYS, 'skipstream_stats', 'skipstream_site_rules']);
    const hasLocalPrefs = PREF_KEYS.some(k => k in localStored);
    const localSyncTs = (await br.storage.local.get('skipstream_last_sync')).skipstream_last_sync || 0;
    const cloudIsNewer = cloudTs > localSyncTs + 60000; // 1 min buffer

    if (!hasLocalPrefs || cloudIsNewer) {
      const reason = !hasLocalPrefs ? 'No local settings found.' : 'Cloud has newer settings.';
      const msg = `${reason} Restore from cloud? (stats, preferences, site rules, theme)`;
      if (!confirm(msg)) return;

      // Apply cloud settings locally
      const toSet = {};
      if (cloud.prefs) {
        for (const [k, v] of Object.entries(cloud.prefs)) {
          if (v !== null && PREF_KEYS.includes(k)) toSet[k] = v;
        }
      }
      if (cloud.stats && Object.keys(cloud.stats).length)        toSet.skipstream_stats      = cloud.stats;
      if (cloud.site_rules && Object.keys(cloud.site_rules).length) toSet.skipstream_site_rules = cloud.site_rules;
      if (cloud.theme)                                            toSet.skipstream_theme      = cloud.theme;
      toSet.skipstream_last_sync = cloudTs;

      await br.storage.local.set(toSet);
      showGlobal('ok', 'Settings restored from cloud.');
      await load();
      await initSiteRules();
    }
  } catch { /* Supabase not configured or network error - skip silently */ }
}

async function init() {
  await load();
  await runCheck();
  await initSiteRules();
  // Check for cloud restore (fresh install or cloud is newer)
  await checkCloudSettingsRestore();
}

init();
