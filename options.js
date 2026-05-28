/* SkipStream — options */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const CRED_KEYS = ['supabaseUrl', 'supabaseAnonKey', 'tmdbApiKey', 'introdbApiKey', 'omdbApiKey', 'animeSkipClientId', 'animeSkipAuthToken'];

const fields = {
  supabaseUrl:     document.getElementById('supabaseUrl'),
  supabaseAnonKey: document.getElementById('supabaseAnonKey'),
  tmdbApiKey:      document.getElementById('tmdbApiKey'),
  introdbApiKey:   document.getElementById('introdbApiKey'),
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

async function init() {
  await load();
  await runCheck();
}

init();
