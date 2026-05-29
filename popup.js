/* SkipStream — popup */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const CHILD_KEYS = ['skipIntro', 'skipRecap', 'skipOutro'];
const ALL_TOGGLES = [...CHILD_KEYS, 'resumePlayback'];
const DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true };
const CACHE_KEY = 'skipstream_cache';

// ── Prefs ─────────────────────────────────────────────────────────────────────

async function loadPrefs() {
  const stored = await br.storage.local.get([...ALL_TOGGLES, 'skipMaster']);
  const prefs = { ...DEFAULTS, skipMaster: true };
  for (const key of ALL_TOGGLES) if (key in stored) prefs[key] = stored[key];
  if ('skipMaster' in stored) prefs.skipMaster = stored.skipMaster;
  return prefs;
}

// ── Master toggle + badge ─────────────────────────────────────────────────────

function updateMasterUI(masterChecked) {
  const childRows = document.getElementById('childRows');
  if (masterChecked) {
    childRows.classList.remove('collapsed');
  } else {
    childRows.classList.add('collapsed');
  }
  updateBadge();
}

function updateBadge() {
  const master = document.getElementById('skipMaster');
  const badge  = document.getElementById('skipBadge');
  if (!master.checked) { badge.classList.add('hidden'); return; }
  const active = CHILD_KEYS.filter(k => document.getElementById(k)?.checked).length;
  badge.textContent = `${active}/${CHILD_KEYS.length}`;
  badge.classList.toggle('hidden', false);
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
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      u.searchParams.set('t', Math.floor(entry.p));
    } else if (u.hostname.includes('vimeo.com')) {
      u.hash = `t=${Math.floor(entry.p)}s`;
    }
    return u.toString();
  } catch { return entry.url; }
}

let _allEntries = [];

async function renderHistory(titleFilter = '', siteFilter = '') {
  const list = document.getElementById('history-list');
  list.replaceChildren();

  const stored = await br.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY] || {};

  _allEntries = Object.entries(cache)
    .filter(([, v]) => v.url && v.p > 10)
    .sort(([, a], [, b]) => b.t - a.t);

  // Populate site filter dropdown
  const siteSelect = document.getElementById('historyFilter');
  if (siteSelect) {
    const sites = [...new Set(_allEntries.map(([, v]) => v.site).filter(Boolean))].sort();
    const current = siteSelect.value;
    siteSelect.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = ''; allOpt.textContent = 'All sites';
    siteSelect.appendChild(allOpt);
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === current) opt.selected = true;
      siteSelect.appendChild(opt);
    });
  }

  const q = titleFilter.trim().toLowerCase();
  const filtered = _allEntries.filter(([, v]) => {
    if (siteFilter && v.site !== siteFilter) return false;
    if (q && !(v.title || '').toLowerCase().includes(q)) return false;
    return true;
  });

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
  const site = document.getElementById('historyFilter')?.value || '';
  renderHistory(e.target.value, site);
});

document.getElementById('historyFilter')?.addEventListener('change', e => {
  const q = document.getElementById('historySearch')?.value || '';
  renderHistory(q, e.target.value);
});

// ── Report Segment flow ───────────────────────────────────────────────────────

let rfState = 'idle';  // idle | recording | stopped
let rfStartSec = null;
let rfEndSec   = null;
let rfType     = null;

const rfLabel     = document.getElementById('rfLabel');
const rfActionRow = document.getElementById('rfActionRow');
const rfTypeRow   = document.getElementById('rfTypeRow');
const rfSubmitRow = document.getElementById('rfSubmitRow');
const rfStartBtn  = document.getElementById('rfStartBtn');
const rfCancelBtn = document.getElementById('rfCancelBtn');
const rfSubmitBtn = document.getElementById('rfSubmitBtn');
const reportFlow  = document.getElementById('reportFlow');
const reportToggleBtn = document.getElementById('reportToggleBtn');

function rfReset() {
  rfState = 'idle'; rfStartSec = null; rfEndSec = null; rfType = null;
  rfLabel.textContent = 'Press Start when the segment begins playing.';
  rfStartBtn.textContent = '▶ Start';
  rfStartBtn.className = 'rf-btn primary';
  rfActionRow.style.display = '';
  rfTypeRow.style.display = 'none';
  rfSubmitRow.style.display = 'none';
  document.querySelectorAll('#rfTypeRow .rf-btn').forEach(b => b.classList.remove('selected'));
  reportToggleBtn.classList.remove('active');
  reportFlow.classList.remove('visible');
}

reportToggleBtn.addEventListener('click', () => {
  const open = reportFlow.classList.contains('visible');
  if (open) { rfReset(); } else {
    reportFlow.classList.add('visible');
    reportToggleBtn.classList.add('active');
  }
});

rfCancelBtn.addEventListener('click', rfReset);

rfStartBtn.addEventListener('click', async () => {
  if (rfState === 'idle') {
    // Query active tab for current video time
    rfState = 'recording';
    rfStartSec = null;
    try {
      const tabs = await br.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const res = await br.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_TIME' });
        rfStartSec = res?.time ?? null;
      }
    } catch { /* tab not reachable */ }
    rfLabel.textContent = rfStartSec != null
      ? `Start recorded at ${fmtTime(rfStartSec)}. Press Stop when segment ends.`
      : 'Start recorded (no video time). Press Stop when segment ends.';
    rfStartBtn.textContent = '⏹ Stop';
    rfStartBtn.className = 'rf-btn danger';
  } else if (rfState === 'recording') {
    rfState = 'stopped';
    rfEndSec = null;
    try {
      const tabs = await br.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const res = await br.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_TIME' });
        rfEndSec = res?.time ?? null;
      }
    } catch { /* tab not reachable */ }
    const timeInfo = (rfStartSec != null && rfEndSec != null)
      ? ` (${fmtTime(rfStartSec)}–${fmtTime(rfEndSec)})`
      : '';
    rfLabel.textContent = `Segment recorded${timeInfo}. Select type:`;
    rfActionRow.style.display = 'none';
    rfTypeRow.style.display = '';
  }
});

document.querySelectorAll('#rfTypeRow .rf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#rfTypeRow .rf-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    rfType = btn.dataset.type;
    rfSubmitRow.style.display = '';
  });
});

rfSubmitBtn.addEventListener('click', async () => {
  if (!rfType) return;
  rfSubmitBtn.disabled = true;
  rfSubmitBtn.textContent = 'Submitting…';
  try {
    const tabs = await br.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    let imdbId = null, season = null, episode = null, site = null;
    if (tabId) {
      try {
        const info = await br.tabs.sendMessage(tabId, { type: 'GET_SHOW_INFO' });
        imdbId  = info?.imdbId  || null;
        season  = info?.season  || null;
        episode = info?.episode || null;
        site    = info?.site    || null;
      } catch { /* not reachable */ }
    }
    const res = await br.runtime.sendMessage({
      type: 'REPORT_SEGMENT',
      imdbId, season, episode, site,
      startSec: rfStartSec,
      endSec:   rfEndSec,
      segType:  rfType,
    });
    rfLabel.textContent = res?.ok ? '✓ Submitted! Thanks for contributing.' : '⚠ Submit failed — check your API key in Settings.';
    rfActionRow.style.display = 'none';
    rfTypeRow.style.display = 'none';
    rfSubmitRow.style.display = 'none';
    setTimeout(rfReset, 3000);
  } catch (e) {
    rfLabel.textContent = `Error: ${e.message}`;
    rfSubmitBtn.disabled = false;
    rfSubmitBtn.textContent = 'Submit';
  }
});

// ── Status & toggles ──────────────────────────────────────────────────────────

async function init() {
  // Load and apply toggle prefs
  const prefs = await loadPrefs();

  // Master toggle
  const masterEl = document.getElementById('skipMaster');
  masterEl.checked = prefs.skipMaster;
  updateMasterUI(prefs.skipMaster);
  masterEl.addEventListener('change', () => {
    br.storage.local.set({ skipMaster: masterEl.checked });
    updateMasterUI(masterEl.checked);
  });

  // Child toggles
  for (const key of CHILD_KEYS) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.checked = prefs[key];
    el.addEventListener('change', () => {
      br.storage.local.set({ [key]: el.checked });
      updateBadge();
    });
  }

  // Other toggles
  const resumeEl = document.getElementById('resumePlayback');
  if (resumeEl) {
    resumeEl.checked = prefs.resumePlayback;
    resumeEl.addEventListener('change', () => br.storage.local.set({ resumePlayback: resumeEl.checked }));
  }

  updateBadge();

  // Load history eagerly in background (task 1)
  renderHistory();

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
