/* SkipStream — popup */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const TOGGLES  = ['skipIntro', 'skipRecap', 'skipOutro', 'resumePlayback', 'addSegment'];
const DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, addSegment: false };
const CACHE_KEY = 'skipstream_cache';

// ── Prefs ─────────────────────────────────────────────────────────────────────

async function loadPrefs() {
  const stored = await br.storage.local.get(TOGGLES);
  const prefs = { ...DEFAULTS };
  for (const key of TOGGLES) if (key in stored) prefs[key] = stored[key];
  return prefs;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add('active');
    if (btn.dataset.tab === 'history') renderHistory();
  });
});

// ── History ───────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (!secs) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${m}:${String(s).padStart(2,'0')}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000)   return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000)return `${Math.floor(diff/3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

function buildDeepLink(entry) {
  if (!entry.url) return null;
  try {
    const u = new URL(entry.url);
    // Inject timestamp param where supported
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      u.searchParams.set('t', Math.floor(entry.p));
    } else if (u.hostname.includes('vimeo.com')) {
      u.hash = `t=${Math.floor(entry.p)}s`;
    }
    // Other sites: return base URL — content script will restore position on load
    return u.toString();
  } catch { return entry.url; }
}

let _allEntries = [];

async function renderHistory(filter = '') {
  const list = document.getElementById('history-list');
  list.replaceChildren();

  const stored = await br.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY] || {};

  _allEntries = Object.entries(cache)
    .filter(([, v]) => v.url && v.p > 10)
    .sort(([, a], [, b]) => b.t - a.t);

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? _allEntries.filter(([, v]) =>
        (v.title || '').toLowerCase().includes(q) ||
        (v.site  || '').toLowerCase().includes(q))
    : _allEntries;

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'h-empty';
    empty.textContent = q ? 'No results.' : 'No history yet — play something first.';
    list.appendChild(empty);
    return;
  }

  filtered.forEach(([, entry]) => {
    const href = buildDeepLink(entry);
    const pct  = entry.d ? Math.min(100, Math.round((entry.p / entry.d) * 100)) : 0;

    const a = document.createElement('a');
    a.className = 'h-item';
    a.href = href || '#';
    if (href) a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const title = document.createElement('div');
    title.className = 'h-title';
    title.textContent = entry.title || entry.site || 'Unknown';

    const meta = document.createElement('div');
    meta.className = 'h-meta';
    const siteSpan = document.createElement('span');
    siteSpan.textContent = entry.site || '';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = `${fmtTime(entry.p)}${entry.d ? ` / ${fmtTime(entry.d)}` : ''} · ${fmtDate(entry.t)}`;
    meta.appendChild(siteSpan);
    meta.appendChild(timeSpan);

    const bar = document.createElement('div');
    bar.className = 'h-bar';
    const fill = document.createElement('div');
    fill.className = 'h-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    a.appendChild(title);
    a.appendChild(meta);
    a.appendChild(bar);
    list.appendChild(a);
  });
}

document.getElementById('historySearch').addEventListener('input', e => {
  renderHistory(e.target.value);
});

// ── Status & toggles ──────────────────────────────────────────────────────────

async function init() {
  // Load and apply toggle prefs
  const prefs = await loadPrefs();
  for (const key of TOGGLES) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.checked = prefs[key];
    el.addEventListener('change', () => br.storage.local.set({ [key]: el.checked }));
  }

  const statusEl = document.getElementById('status');
  const noConfig = document.getElementById('noConfig');

  let result;
  try {
    result = await br.runtime.sendMessage({ type: 'CHECK_CONFIG' });
  } catch {
    statusEl.textContent = '⚠ Extension error';
    statusEl.className = 'warn';
    return;
  }

  const sbOk   = result?.supabase?.ok;
  const idbOk  = result?.introdb?.ok;
  const tmdbOk = result?.tmdb?.ok;
  const needsSQL = result?.supabase?.needsManualSetup;
  const sbMsg  = result?.supabase?.message || '';
  const idbMsg = result?.introdb?.message || '';

  const warnings = [];
  if (!idbOk) warnings.push(idbMsg === 'Not configured'
    ? '⚠ IntroDB key missing — skipping disabled.'
    : `⚠ IntroDB: ${idbMsg}`);
  if (!sbOk && !sbMsg.includes('configured')) warnings.push(needsSQL
    ? '⚠ Supabase table missing — run supabase_setup.sql.'
    : '⚠ Supabase not configured — sync disabled.');

  if (warnings.length) {
    noConfig.style.display = 'block';
    noConfig.replaceChildren();
    warnings.forEach((w, i) => {
      noConfig.appendChild(document.createTextNode(w));
      if (i < warnings.length - 1) noConfig.appendChild(document.createElement('br'));
    });
  }

  const parts = [];
  if (idbOk)  parts.push('IntroDB ✓');
  if (sbOk)   parts.push('Supabase ✓');
  if (tmdbOk) parts.push('TMDB ✓');
  if (!parts.length) parts.push('No services configured');

  statusEl.textContent = parts.join(' · ');
  statusEl.className = idbOk && sbOk ? 'ok' : 'warn';

  document.getElementById('optionsBtn').addEventListener('click', () => br.runtime.openOptionsPage());
}

init();
