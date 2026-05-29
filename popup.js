/* SkipStream — popup v1.5 */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

// ── Constants ─────────────────────────────────────────────────────────────────

const CHILD_KEYS  = ['skipIntro', 'skipRecap', 'skipOutro'];
const ALL_TOGGLES = [...CHILD_KEYS, 'resumePlayback'];
const DEFAULTS    = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, skipMaster: true };
const CACHE_KEY   = 'skipstream_cache';

// ── Prefs ─────────────────────────────────────────────────────────────────────

async function loadPrefs() {
  try {
    const stored = await br.storage.local.get([...ALL_TOGGLES, 'skipMaster']);
    const prefs = { ...DEFAULTS };
    for (const key of [...ALL_TOGGLES, 'skipMaster']) {
      if (key in stored) prefs[key] = stored[key];
    }
    return prefs;
  } catch { return { ...DEFAULTS }; }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${days}d ago`;
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildDeepLink(entry) {
  if (!entry.url) return null;
  try {
    const u = new URL(entry.url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      u.searchParams.set('t', Math.floor(entry.p || 0));
    } else if (u.hostname.includes('vimeo.com')) {
      u.hash = `t=${Math.floor(entry.p || 0)}s`;
    }
    return u.toString();
  } catch { return entry.url || null; }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

// ── Skip folder (master + children) ──────────────────────────────────────────

function updateSkipBadge() {
  const master = document.getElementById('skipMaster');
  const badge  = document.getElementById('skipBadge');
  const sub    = document.getElementById('skipSub');
  if (!master.checked) {
    badge.classList.add('hidden');
    sub.textContent = 'Disabled';
    return;
  }
  const active = CHILD_KEYS.filter(k => document.getElementById(k)?.checked).length;
  badge.textContent = `${active}/${CHILD_KEYS.length}`;
  badge.classList.toggle('hidden', false);
  const typeNames = [];
  if (document.getElementById('skipIntro')?.checked) typeNames.push('Intro');
  if (document.getElementById('skipRecap')?.checked) typeNames.push('Recap');
  if (document.getElementById('skipOutro')?.checked) typeNames.push('Outro');
  sub.textContent = typeNames.length
    ? `Auto-skipping: ${typeNames.join(', ')}`
    : 'Enabled — all set to prompt';
}

function setSkipBodyOpen(open) {
  const body = document.getElementById('skipBody');
  body.classList.toggle('open', open);
}

// ── Add Segment folder ────────────────────────────────────────────────────────

// State machine: idle → recording → stopped → idle
let asState    = 'idle';
let asStartSec = null;
let asEndSec   = null;
let asType     = null;

function asSetStep(n) {
  document.querySelectorAll('.flow-step').forEach((s, i) => {
    s.classList.toggle('active', i + 1 === n);
  });
}

function asOpenFolder(open) {
  const body    = document.getElementById('addBody');
  const chevron = document.getElementById('addChevron');
  body.classList.toggle('open', open);
  chevron.classList.toggle('open', open);
  if (!open) asReset(false);
}

function asReset(closeFolder = true) {
  asState = 'idle'; asStartSec = null; asEndSec = null; asType = null;

  const startBtn = document.getElementById('flowStartBtn');
  startBtn.textContent = '';
  startBtn.appendChild(svgPlay());
  startBtn.appendChild(document.createTextNode(' Start'));
  startBtn.className = 'flow-btn primary';
  startBtn.disabled = false;

  document.getElementById('flowLabel').replaceChildren(
    document.createTextNode('Press '),
    Object.assign(document.createElement('strong'), { textContent: 'Start' }),
    document.createTextNode(' when the segment begins.'),
  );
  document.getElementById('addSub').textContent = 'Record a missing intro, recap, or outro';
  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('flowSubmitBtn').disabled = true;

  asSetStep(1);
  if (closeFolder) asOpenFolder(false);
}

function svgPlay() {
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','10'); s.setAttribute('height','10');
  s.setAttribute('viewBox','0 0 12 12'); s.setAttribute('fill','currentColor');
  const p = document.createElementNS('http://www.w3.org/2000/svg','polygon');
  p.setAttribute('points','2,1 11,6 2,11'); s.appendChild(p); return s;
}

document.getElementById('addHeader').addEventListener('click', () => {
  const open = document.getElementById('addBody').classList.contains('open');
  asOpenFolder(!open);
});

document.getElementById('flowCancelBtn').addEventListener('click', () => asReset(true));
document.getElementById('flowBackBtn').addEventListener('click', () => {
  asState = 'idle'; asEndSec = null; asType = null;
  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('flowSubmitBtn').disabled = true;
  asSetStep(1);
});

document.getElementById('flowStartBtn').addEventListener('click', async () => {
  const btn = document.getElementById('flowStartBtn');
  if (asState === 'idle') {
    // → recording
    asState = 'recording';
    asStartSec = null;
    btn.disabled = true;
    try {
      const tabs = await br.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const res = await br.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_TIME' });
        asStartSec = res?.time ?? null;
      }
    } catch { /* tab may not have content script */ }

    const label = document.getElementById('flowLabel');
    label.replaceChildren(
      document.createTextNode(
        asStartSec != null
          ? `Recording… started at ${fmtTime(asStartSec)}. Press `
          : 'Recording… Press '
      ),
      Object.assign(document.createElement('strong'), { textContent: 'Stop' }),
      document.createTextNode(' when it ends.'),
    );

    // Swap to Stop button
    btn.replaceChildren(
      Object.assign(document.createElementNS('http://www.w3.org/2000/svg','svg'), { /* blank */ }),
      document.createTextNode(' Stop'),
    );
    // Re-create with stop square icon
    btn.replaceChildren();
    const stopSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    stopSvg.setAttribute('width','10'); stopSvg.setAttribute('height','10');
    stopSvg.setAttribute('viewBox','0 0 12 12'); stopSvg.setAttribute('fill','currentColor');
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x','2'); rect.setAttribute('y','2'); rect.setAttribute('width','8'); rect.setAttribute('height','8'); rect.setAttribute('rx','1.5');
    stopSvg.appendChild(rect);
    btn.appendChild(stopSvg);
    btn.appendChild(document.createTextNode(' Stop'));
    btn.className = 'flow-btn stop';
    btn.disabled = false;

    document.getElementById('addSub').textContent = '⏺ Recording…';

  } else if (asState === 'recording') {
    // → stopped
    asState = 'stopped';
    asEndSec = null;
    btn.disabled = true;
    try {
      const tabs = await br.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const res = await br.tabs.sendMessage(tabs[0].id, { type: 'GET_VIDEO_TIME' });
        asEndSec = res?.time ?? null;
      }
    } catch { /* ok */ }

    // Show time pill
    const pill = document.getElementById('flowTimePill');
    document.getElementById('flowTimeText').textContent =
      (asStartSec != null && asEndSec != null)
        ? `${fmtTime(asStartSec)} – ${fmtTime(asEndSec)}`
        : 'Timestamps recorded';

    document.getElementById('addSub').textContent = 'Select type to submit';
    asSetStep(2);
  }
});

document.querySelectorAll('.type-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    asType = chip.dataset.type;
    document.getElementById('flowSubmitBtn').disabled = false;
  });
});

document.getElementById('flowSubmitBtn').addEventListener('click', async () => {
  if (!asType) return;
  const btn = document.getElementById('flowSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

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
      } catch { /* content script not on this page */ }
    }

    const res = await br.runtime.sendMessage({
      type:     'REPORT_SEGMENT',
      imdbId, season, episode, site,
      startSec: asStartSec,
      endSec:   asEndSec,
      segType:  asType,
    });

    const resultLabel = document.getElementById('flowResultLabel');
    if (res?.ok) {
      resultLabel.className = 'flow-label ok';
      resultLabel.textContent = '✓ Submitted — thank you for contributing!';
    } else {
      resultLabel.className = 'flow-label warn';
      resultLabel.textContent = '⚠ Submit failed — check your API key in Settings.';
    }
    document.getElementById('addSub').textContent = res?.ok ? 'Submitted ✓' : 'Submit failed';
    asSetStep(3);
    setTimeout(() => asReset(false), 3500);

  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Submit';
    document.getElementById('flowLabel').textContent = `Error: ${e.message}`;
  }
});

// ── History ───────────────────────────────────────────────────────────────────

let _localEntries  = {};   // mediaId → entry
let _cloudEntries  = {};   // mediaId → entry (from Supabase)
let _historySource = 'local';   // 'local' | 'cloud' | 'merged'

// Source pills
document.querySelectorAll('.source-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.source-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    _historySource = pill.dataset.source;
    applyHistoryFilters();
  });
});

async function loadLocalHistory() {
  try {
    const stored = await br.storage.local.get(CACHE_KEY);
    const cache = stored[CACHE_KEY] || {};
    _localEntries = cache;
  } catch { _localEntries = {}; }
}

async function loadCloudHistory(userId, supabaseUrl, supabaseAnonKey) {
  if (!userId || !supabaseUrl || !supabaseAnonKey) return;
  try {
    const url =
      `${supabaseUrl}/rest/v1/playback_states` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=media_id,playback_time,duration,site,updated_at` +
      `&order=updated_at.desc&limit=200`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });
    if (!res.ok) return;
    const rows = await res.json();
    _cloudEntries = {};
    for (const row of rows) {
      _cloudEntries[row.media_id] = {
        p:    row.playback_time,
        d:    row.duration,
        t:    row.updated_at ? new Date(row.updated_at).getTime() : null,
        site: row.site || '',
        fromCloud: true,
      };
    }
  } catch { /* network or parse error */ }
}

function mergeHistoryEntries() {
  // Merge cloud into local: cloud provides fresher timestamps; local provides title/url
  const merged = {};
  // Start with all local
  for (const [id, entry] of Object.entries(_localEntries)) {
    merged[id] = { ...entry };
  }
  // Overlay cloud data
  for (const [id, cloud] of Object.entries(_cloudEntries)) {
    if (merged[id]) {
      // Prefer cloud's playback_time if more recent
      const localTime = merged[id].t || 0;
      const cloudTime = cloud.t || 0;
      if (cloudTime > localTime || merged[id].p < cloud.p) {
        merged[id].p = cloud.p;
        merged[id].d = cloud.d || merged[id].d;
        merged[id].t = Math.max(localTime, cloudTime) || merged[id].t;
      }
      merged[id].fromCloud = true;
    } else {
      // Cloud-only entry (no local metadata)
      merged[id] = { ...cloud };
    }
  }
  return merged;
}

function getDisplayEntries() {
  if (_historySource === 'cloud') {
    return Object.entries(_cloudEntries);
  }
  if (_historySource === 'local') {
    return Object.entries(_localEntries);
  }
  // merged
  return Object.entries(mergeHistoryEntries());
}

function applyHistoryFilters() {
  const q       = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
  const siteVal = document.getElementById('historyFilter')?.value || '';

  let entries = getDisplayEntries()
    .filter(([, v]) => v.p > 10)
    .sort(([, a], [, b]) => (b.t || 0) - (a.t || 0));

  if (siteVal)  entries = entries.filter(([, v]) => v.site === siteVal);
  if (q)        entries = entries.filter(([, v]) => (v.title || v.site || '').toLowerCase().includes(q));

  renderHistoryList(entries);
}

function renderHistoryList(entries) {
  const list = document.getElementById('historyList');
  list.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'h-empty';
    // Film icon
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','32'); svg.setAttribute('height','32');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.5');
    svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r1.setAttribute('x','2'); r1.setAttribute('y','4');
    r1.setAttribute('width','20'); r1.setAttribute('height','16'); r1.setAttribute('rx','2');
    svg.appendChild(r1);
    const p1 = document.createElementNS('http://www.w3.org/2000/svg','path');
    p1.setAttribute('d','M16 2v4M8 2v4M2 10h20M7 14h.01M12 14h.01M17 14h.01');
    svg.appendChild(p1);
    empty.appendChild(svg);
    const msg = document.createElement('div');
    msg.textContent = _historySource === 'cloud' && !Object.keys(_cloudEntries).length
      ? 'No cloud history — configure Supabase in Settings.'
      : 'Nothing here yet. Watch something first.';
    empty.appendChild(msg);
    list.appendChild(empty);
    return;
  }

  for (const [, entry] of entries) {
    const href = buildDeepLink(entry);
    const pct  = entry.d ? Math.min(100, Math.round((entry.p / entry.d) * 100)) : 0;

    const a = document.createElement('a');
    a.className = 'h-item';
    a.href = href || '#';
    if (href) a.target = '_blank';
    a.rel = 'noopener noreferrer';

    // Top row: thumb + info
    const top = document.createElement('div');
    top.className = 'h-item-top';

    const thumb = document.createElement('div');
    thumb.className = 'h-thumb';
    const tSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    tSvg.setAttribute('width','16'); tSvg.setAttribute('height','16');
    tSvg.setAttribute('viewBox','0 0 16 16'); tSvg.setAttribute('fill','none');
    tSvg.setAttribute('stroke','currentColor'); tSvg.setAttribute('stroke-width','1.5');
    const tPoly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    tPoly.setAttribute('points','3,2 13,8 3,14'); tSvg.appendChild(tPoly);
    thumb.appendChild(tSvg);

    const info = document.createElement('div');
    info.className = 'h-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'h-title';
    titleEl.textContent = entry.title || entry.site || 'Unknown';

    const meta = document.createElement('div');
    meta.className = 'h-meta';

    if (entry.site) {
      const sitePill = document.createElement('span');
      sitePill.className = 'h-site';
      sitePill.textContent = entry.site;
      meta.appendChild(sitePill);
    }
    if (entry.fromCloud) {
      const cloud = document.createElement('span');
      cloud.className = 'h-cloud';
      cloud.textContent = '☁';
      meta.appendChild(cloud);
    }
    if (entry.t) {
      const dateEl = document.createElement('span');
      dateEl.textContent = fmtDate(entry.t);
      meta.appendChild(dateEl);
    }

    info.appendChild(titleEl);
    info.appendChild(meta);

    top.appendChild(thumb);
    top.appendChild(info);

    // Progress bar
    const bar  = document.createElement('div'); bar.className = 'h-bar';
    const fill = document.createElement('div'); fill.className = 'h-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    // Time label
    const timeEl = document.createElement('div');
    timeEl.className = 'h-time';
    timeEl.textContent = `${fmtTime(entry.p)}${entry.d ? ` / ${fmtTime(entry.d)} · ${pct}%` : ''}`;

    a.appendChild(top);
    a.appendChild(bar);
    a.appendChild(timeEl);
    list.appendChild(a);
  }
}

function populateSiteFilter() {
  const merged = mergeHistoryEntries();
  const sites = [...new Set(
    Object.values(merged).map(v => v.site).filter(Boolean)
  )].sort();

  const sel = document.getElementById('historyFilter');
  const cur = sel.value;
  sel.replaceChildren();
  const allOpt = document.createElement('option');
  allOpt.value = ''; allOpt.textContent = 'All sites';
  sel.appendChild(allOpt);
  for (const s of sites) {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (s === cur) o.selected = true;
    sel.appendChild(o);
  }
}

document.getElementById('historySearch').addEventListener('input', applyHistoryFilters);
document.getElementById('historyFilter').addEventListener('change', applyHistoryFilters);

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(dotClass, text) {
  const dot  = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  dot.className  = `status-dot ${dotClass}`;
  span.textContent = text;
}

function setSyncStatus(dotClass, text) {
  document.getElementById('syncDot').className  = `sync-dot ${dotClass}`;
  document.getElementById('syncText').textContent = text;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {

  // ── Prefs & toggles ──────────────────────────────────────────────────────

  const prefs = await loadPrefs();

  // Master skip toggle
  const masterEl = document.getElementById('skipMaster');
  masterEl.checked = prefs.skipMaster;
  setSkipBodyOpen(prefs.skipMaster);
  updateSkipBadge();

  masterEl.addEventListener('change', () => {
    br.storage.local.set({ skipMaster: masterEl.checked });
    setSkipBodyOpen(masterEl.checked);
    updateSkipBadge();
  });

  // Child toggles
  for (const key of CHILD_KEYS) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.checked = prefs[key];
    el.addEventListener('change', () => {
      br.storage.local.set({ [key]: el.checked });
      updateSkipBadge();
    });
  }

  // Resume toggle
  const resumeEl = document.getElementById('resumePlayback');
  if (resumeEl) {
    resumeEl.checked = prefs.resumePlayback;
    resumeEl.addEventListener('change', () =>
      br.storage.local.set({ resumePlayback: resumeEl.checked })
    );
  }

  // Settings gear
  document.getElementById('optionsBtn')
    .addEventListener('click', () => br.runtime.openOptionsPage());

  // ── Load history eagerly (local) ─────────────────────────────────────────

  await loadLocalHistory();
  populateSiteFilter();
  applyHistoryFilters();

  // ── Service health check ─────────────────────────────────────────────────

  let result;
  try {
    result = await br.runtime.sendMessage({ type: 'CHECK_CONFIG' });
  } catch {
    setStatus('err', 'Extension error — try reloading');
    return;
  }

  const sbOk  = result?.supabase?.ok;
  const idbOk = result?.introdb?.ok;
  const tmOk  = result?.tmdb?.ok;
  const sbMsg = result?.supabase?.message || '';
  const idbMsg= result?.introdb?.message  || '';
  const needsSQL = result?.supabase?.needsManualSetup;

  // Status pill
  const activeSvcs = [idbOk && 'IntroDB', sbOk && 'Supabase', tmOk && 'TMDB'].filter(Boolean);
  if (activeSvcs.length) {
    setStatus('ok', activeSvcs.join(' · ') + ' · Connected');
  } else {
    setStatus('warn', 'No services configured — open Settings');
  }

  // Alert banner
  const banner = document.getElementById('alertBanner');
  const warnings = [];
  if (!idbOk && idbMsg !== 'Not configured')
    warnings.push(`IntroDB: ${idbMsg}`);
  if (!sbOk && needsSQL)
    warnings.push('Supabase: run supabase_setup.sql once to create the table.');
  else if (!sbOk && sbMsg && !sbMsg.includes('configured'))
    warnings.push(`Supabase: ${sbMsg}`);

  if (warnings.length) {
    banner.className = 'alert warn';
    banner.replaceChildren();
    for (const [i, w] of warnings.entries()) {
      banner.appendChild(document.createTextNode(`⚠ ${w}`));
      if (i < warnings.length - 1) banner.appendChild(document.createElement('br'));
    }
  }

  // ── Load Supabase history in background ──────────────────────────────────

  if (sbOk) {
    setSyncStatus('', 'Syncing cloud history…');
    try {
      // Get userId
      const uidRes = await br.runtime.sendMessage({ type: 'GET_USER_ID' });
      const userId = uidRes?.userId;

      // Get Supabase credentials directly from storage for the popup-side fetch
      const stored = await br.storage.local.get(['supabaseUrl','supabaseAnonKey']);
      const supabaseUrl     = stored.supabaseUrl;
      const supabaseAnonKey = stored.supabaseAnonKey;

      if (userId && supabaseUrl && supabaseAnonKey) {
        await loadCloudHistory(userId, supabaseUrl, supabaseAnonKey);
        populateSiteFilter();
        applyHistoryFilters();

        const cloudCount = Object.keys(_cloudEntries).length;
        setSyncStatus('ok', `Cloud: ${cloudCount} item${cloudCount !== 1 ? 's' : ''} synced`);
      } else {
        setSyncStatus('warn', 'Cloud: missing credentials');
      }
    } catch (e) {
      setSyncStatus('warn', `Cloud sync failed: ${e.message}`);
    }
  } else {
    const localCount = Object.keys(_localEntries).length;
    setSyncStatus('', `Local: ${localCount} item${localCount !== 1 ? 's' : ''} · Supabase not connected`);
  }
}

init();
