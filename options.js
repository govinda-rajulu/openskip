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
    showAlert('sqlAlert', 'warn',
      '⚠ <strong>One-time setup needed:</strong> your Supabase project is missing the ' +
      '<code>playback_states</code> table. Run <strong>supabase_setup.sql</strong> ' +
      'once in your Supabase project → SQL Editor, then click <em>Save &amp; Verify</em> again.');
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

async function init() {
  await load();
  await runCheck();
  await initSiteRules();
}

init();
