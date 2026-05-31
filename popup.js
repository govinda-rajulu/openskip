/* SkipStream - popup v1.5.6 */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

// ── Constants ─────────────────────────────────────────────────────────────────

const CHILD_KEYS  = ['skipIntro', 'skipRecap', 'skipOutro'];
const ALL_TOGGLES = [...CHILD_KEYS, 'resumePlayback'];
const DEFAULTS    = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true, skipMaster: true };
const CACHE_KEY   = 'skipstream_cache';
const PENDING_KEY = 'skipstream_pending_resume';

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
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Deep link builder ─────────────────────────────────────────────────────────

function buildDeepLink(entry) {
  if (!entry.url) return null;
  try {
    const u = new URL(entry.url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      u.searchParams.set('t', Math.floor(entry.p || 0));
    } else if (u.hostname.includes('vimeo.com')) {
      u.hash = `t=${Math.floor(entry.p || 0)}s`;
    } else {
      // Generic: append skipstream_t param so content script can pick it up
      u.searchParams.set('skipstream_t', Math.floor(entry.p || 0));
    }
    return u.toString();
  } catch { return entry.url || null; }
}

// ── Open history entry in new tab + inject resume position ───────────────────

async function openHistoryEntry(entry) {
  const url  = entry.url;
  const pos  = entry.p;
  const mediaId = entry.mediaId || null;

  if (!url) return;

  // Write a pending-resume record so the content script on the new tab can consume it
  if (pos && pos >= 10 && mediaId) {
    try {
      await br.storage.local.set({
        [PENDING_KEY]: { mediaId, position: pos, ts: Date.now() },
      });
    } catch { /* ok */ }
  }

  try {
    await br.tabs.create({ url });
  } catch {
    // Fallback: just open the URL without tab API
    window.open(url, '_blank', 'noopener');
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t  => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

// ── Skip folder (master + children) ──────────────────────────────────────────

// Accepts the prefs object so badge is always computed from live storage values,
// eliminating the "0/3" race condition on init.
function updateSkipBadge(prefs) {
  const masterEl = document.getElementById('skipMaster');
  const badge    = document.getElementById('skipBadge');
  const sub      = document.getElementById('skipSub');
  if (!masterEl || !badge || !sub) return;

  const masterOn = prefs ? prefs.skipMaster : masterEl.checked;

  if (!masterOn) {
    badge.classList.add('hidden');
    sub.textContent = 'Disabled - all skip detection off';
    return;
  }

  // Count active children from prefs (or DOM if no prefs given)
  const activeKeys = CHILD_KEYS.filter(k => {
    if (prefs) return prefs[k];
    return document.getElementById(k)?.checked;
  });

  badge.textContent = `${activeKeys.length}/${CHILD_KEYS.length}`;
  badge.classList.remove('hidden');

  const typeNames = [];
  const pSrc = prefs || {};
  if (pSrc.skipIntro ?? document.getElementById('skipIntro')?.checked) typeNames.push('Intro');
  if (pSrc.skipRecap ?? document.getElementById('skipRecap')?.checked) typeNames.push('Recap');
  if (pSrc.skipOutro ?? document.getElementById('skipOutro')?.checked) typeNames.push('Outro');

  sub.textContent = typeNames.length
    ? `Auto-skipping: ${typeNames.join(', ')}`
    : 'Enabled - all types set to prompt mode';
}

function setSkipBodyOpen(open) {
  const body = document.getElementById('skipBody');
  if (body) body.classList.toggle('open', open);
}

// ── Add Segment folder ────────────────────────────────────────────────────────

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
  if (body)    body.classList.toggle('open', open);
  if (chevron) chevron.classList.toggle('open', open);
  if (!open) asReset(false);
}

function asReset(closeFolder = true) {
  asState = 'idle'; asStartSec = null; asEndSec = null; asType = null;

  const startBtn = document.getElementById('flowStartBtn');
  if (startBtn) {
    startBtn.replaceChildren();
    startBtn.appendChild(svgPlay());
    startBtn.appendChild(document.createTextNode(' Start'));
    startBtn.className = 'flow-btn primary';
    startBtn.disabled = false;
  }

  const flowLabel = document.getElementById('flowLabel');
  if (flowLabel) {
    flowLabel.replaceChildren(
      document.createTextNode('Press '),
      Object.assign(document.createElement('strong'), { textContent: 'Start' }),
      document.createTextNode(' when the segment begins.'),
    );
  }

  const addSub = document.getElementById('addSub');
  if (addSub) addSub.textContent = 'Record a missing intro, recap, or outro';

  document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));

  const submitBtn = document.getElementById('flowSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  asSetStep(1);
  if (closeFolder) asOpenFolder(false);
}

function svgPlay() {
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','10'); s.setAttribute('height','10');
  s.setAttribute('viewBox','0 0 12 12'); s.setAttribute('fill','currentColor');
  const p = document.createElementNS('http://www.w3.org/2000/svg','polygon');
  p.setAttribute('points','2,1 11,6 2,11');
  s.appendChild(p);
  return s;
}

const addHeader = document.getElementById('addHeader');
if (addHeader) {
  addHeader.addEventListener('click', () => {
    const open = document.getElementById('addBody')?.classList.contains('open');
    asOpenFolder(!open);
  });
}

const flowCancelBtn = document.getElementById('flowCancelBtn');
if (flowCancelBtn) flowCancelBtn.addEventListener('click', () => asReset(true));

const flowBackBtn = document.getElementById('flowBackBtn');
if (flowBackBtn) {
  flowBackBtn.addEventListener('click', () => {
    asState = 'idle'; asEndSec = null; asType = null;
    document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
    const sb = document.getElementById('flowSubmitBtn');
    if (sb) sb.disabled = true;
    asSetStep(1);
  });
}

const flowStartBtn = document.getElementById('flowStartBtn');
if (flowStartBtn) {
  flowStartBtn.addEventListener('click', async () => {
    const btn = document.getElementById('flowStartBtn');
    if (asState === 'idle') {
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
      if (label) {
        label.replaceChildren(
          document.createTextNode(
            asStartSec != null
              ? `Recording… started at ${fmtTime(asStartSec)}. Press `
              : 'Recording… Press '
          ),
          Object.assign(document.createElement('strong'), { textContent: 'Stop' }),
          document.createTextNode(' when it ends.'),
        );
      }

      // Swap to Stop button
      btn.replaceChildren();
      const stopSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      stopSvg.setAttribute('width','10'); stopSvg.setAttribute('height','10');
      stopSvg.setAttribute('viewBox','0 0 12 12'); stopSvg.setAttribute('fill','currentColor');
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x','2'); rect.setAttribute('y','2');
      rect.setAttribute('width','8'); rect.setAttribute('height','8'); rect.setAttribute('rx','1.5');
      stopSvg.appendChild(rect);
      btn.appendChild(stopSvg);
      btn.appendChild(document.createTextNode(' Stop'));
      btn.className = 'flow-btn stop';
      btn.disabled = false;

      const addSub = document.getElementById('addSub');
      if (addSub) addSub.textContent = '⏺ Recording…';

    } else if (asState === 'recording') {
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

      const timeText = document.getElementById('flowTimeText');
      if (timeText) {
        timeText.textContent = (asStartSec != null && asEndSec != null)
          ? `${fmtTime(asStartSec)}  -  ${fmtTime(asEndSec)}`
          : 'Timestamps recorded';
      }

      const addSub = document.getElementById('addSub');
      if (addSub) addSub.textContent = 'Select type to submit';
      asSetStep(2);
    }
  });
}

document.querySelectorAll('.type-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    asType = chip.dataset.type;
    const sb = document.getElementById('flowSubmitBtn');
    if (sb) sb.disabled = false;
  });
});

const flowSubmitBtn = document.getElementById('flowSubmitBtn');
if (flowSubmitBtn) {
  flowSubmitBtn.addEventListener('click', async () => {
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
        type: 'REPORT_SEGMENT',
        imdbId, season, episode, site,
        startSec: asStartSec,
        endSec:   asEndSec,
        segType:  asType,
      });

      const resultLabel = document.getElementById('flowResultLabel');
      if (resultLabel) {
        if (res?.ok) {
          resultLabel.className = 'flow-label ok';
          resultLabel.textContent = '✓ Submitted - thank you for contributing!';
        } else {
          resultLabel.className = 'flow-label warn';
          resultLabel.textContent = '⚠ Submit failed - check your API key in Settings.';
        }
      }
      const addSub = document.getElementById('addSub');
      if (addSub) addSub.textContent = res?.ok ? 'Submitted ✓' : 'Submit failed';
      asSetStep(3);
      setTimeout(() => asReset(false), 3500);

    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Submit';
      const flowLabel = document.getElementById('flowLabel');
      if (flowLabel) flowLabel.textContent = `Error: ${e.message}`;
    }
  });
}

// ── History ───────────────────────────────────────────────────────────────────

let _localEntries  = {};   // mediaId → entry
let _cloudEntries  = {};   // mediaId → entry
let _historySource = 'merged';

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
    // Attach mediaId onto each entry for history click handler
    _localEntries = {};
    for (const [mediaId, entry] of Object.entries(cache)) {
      _localEntries[mediaId] = { ...entry, mediaId };
    }
  } catch { _localEntries = {}; }
}

async function loadCloudHistory(userId, supabaseUrl, supabaseAnonKey) {
  if (!userId || !supabaseUrl || !supabaseAnonKey) return;
  try {
    const url =
      `${supabaseUrl}/rest/v1/playback_states` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=media_id,playback_time,duration,site,site_name,video_title,updated_at` +
      `&order=updated_at.desc&limit=200`;
    const res = await fetch(url, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    if (!res.ok) return;
    const rows = await res.json();
    _cloudEntries = {};
    for (const row of rows) {
      _cloudEntries[row.media_id] = {
        mediaId:   row.media_id,
        p:         row.playback_time,
        d:         row.duration,
        t:         row.updated_at ? new Date(row.updated_at).getTime() : null,
        site:      row.site || '',
        site_name: row.site_name || '',
        title:     row.video_title || '',
        fromCloud: true,
      };
    }
  } catch { /* network or parse error */ }
}

function mergeHistoryEntries() {
  const merged = {};
  for (const [id, entry] of Object.entries(_localEntries)) {
    merged[id] = { ...entry };
  }
  for (const [id, cloud] of Object.entries(_cloudEntries)) {
    if (merged[id]) {
      const localTime = merged[id].t || 0;
      const cloudTime = cloud.t || 0;
      if (cloudTime > localTime || merged[id].p < cloud.p) {
        merged[id].p = cloud.p;
        merged[id].d = cloud.d || merged[id].d;
        merged[id].t = Math.max(localTime, cloudTime) || merged[id].t;
      }
      // Prefer richer metadata from cloud if local lacks it
      if (!merged[id].site_name && cloud.site_name) merged[id].site_name = cloud.site_name;
      if (!merged[id].title && cloud.title)          merged[id].title     = cloud.title;
      merged[id].fromCloud = true;
    } else {
      merged[id] = { ...cloud };
    }
  }
  return merged;
}

function getDisplayEntries() {
  if (_historySource === 'cloud') return Object.entries(_cloudEntries);
  if (_historySource === 'local') return Object.entries(_localEntries);
  return Object.entries(mergeHistoryEntries());
}

function applyHistoryFilters() {
  const q       = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
  const siteVal = document.getElementById('historyFilter')?.value || '';

  let entries = getDisplayEntries()
    .filter(([, v]) => v.p > 10)
    .sort(([, a], [, b]) => (b.t || 0) - (a.t || 0));

  if (siteVal) entries = entries.filter(([, v]) => v.site === siteVal);
  if (q)       entries = entries.filter(([, v]) => {
    const label = v.title || v.site_name || v.site || '';
    return label.toLowerCase().includes(q);
  });

  renderHistoryList(entries);
}

function renderHistoryList(entries) {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'h-empty';

    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','32'); svg.setAttribute('height','32');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.5');
    svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r1.setAttribute('x','2'); r1.setAttribute('y','4'); r1.setAttribute('width','20');
    r1.setAttribute('height','16'); r1.setAttribute('rx','2');
    svg.appendChild(r1);
    const p1 = document.createElementNS('http://www.w3.org/2000/svg','path');
    p1.setAttribute('d','M16 2v4M8 2v4M2 10h20M7 14h.01M12 14h.01M17 14h.01');
    svg.appendChild(p1);
    empty.appendChild(svg);

    const msg = document.createElement('div');
    msg.textContent = _historySource === 'cloud' && !Object.keys(_cloudEntries).length
      ? 'No cloud history - configure Supabase in Settings.'
      : 'Nothing here yet. Watch something first.';
    empty.appendChild(msg);
    list.appendChild(empty);
    return;
  }

  for (const [mediaId, entry] of entries) {
    const pct  = entry.d ? Math.min(100, Math.round((entry.p / entry.d) * 100)) : 0;
    // Display label: prefer video_title/title, then site_name, then site hostname
    const displayTitle = entry.title || entry.video_title || entry.site_name || entry.site || 'Unknown';
    const displaySite  = entry.site_name || entry.site || '';

    const item = document.createElement('div');
    item.className = 'h-item';
    item.style.cursor = 'pointer';

    // Click handler: open in new tab with resume injection
    item.addEventListener('click', () => {
      openHistoryEntry({ ...entry, mediaId });
    });

    // Top row
    const top = document.createElement('div');
    top.className = 'h-item-top';

    const thumb = document.createElement('div');
    thumb.className = 'h-thumb';
    const tSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    tSvg.setAttribute('width','16'); tSvg.setAttribute('height','16');
    tSvg.setAttribute('viewBox','0 0 16 16'); tSvg.setAttribute('fill','none');
    tSvg.setAttribute('stroke','currentColor'); tSvg.setAttribute('stroke-width','1.5');
    const tPoly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    tPoly.setAttribute('points','3,2 13,8 3,14');
    tSvg.appendChild(tPoly);
    thumb.appendChild(tSvg);

    const info = document.createElement('div');
    info.className = 'h-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'h-title';
    titleEl.textContent = displayTitle;

    const meta = document.createElement('div');
    meta.className = 'h-meta';

    if (displaySite) {
      const sitePill = document.createElement('span');
      sitePill.className = 'h-site';
      sitePill.textContent = displaySite;
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

    const bar  = document.createElement('div'); bar.className = 'h-bar';
    const fill = document.createElement('div'); fill.className = 'h-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const timeEl = document.createElement('div');
    timeEl.className = 'h-time';
    timeEl.textContent = `${fmtTime(entry.p)}${entry.d ? ` / ${fmtTime(entry.d)} · ${pct}%` : ''}`;

    item.appendChild(top);
    item.appendChild(bar);
    item.appendChild(timeEl);
    list.appendChild(item);
  }
}

function populateSiteFilter() {
  const allEntries = Object.values(mergeHistoryEntries());
  const sites = [...new Set(allEntries.map(v => v.site).filter(Boolean))].sort();

  const sel = document.getElementById('historyFilter');
  if (!sel) return;
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

const historySearch = document.getElementById('historySearch');
if (historySearch) historySearch.addEventListener('input', applyHistoryFilters);

const historyFilter = document.getElementById('historyFilter');
if (historyFilter) historyFilter.addEventListener('change', applyHistoryFilters);

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(dotClass, text) {
  const dot  = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  if (dot)  dot.className   = `status-dot ${dotClass}`;
  if (span) span.textContent = text;
}

function setSyncStatus(dotClass, text) {
  const dot  = document.getElementById('syncDot');
  const span = document.getElementById('syncText');
  if (dot)  dot.className   = `sync-dot ${dotClass}`;
  if (span) span.textContent = text;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {

  // ── Load prefs FIRST - must complete before any badge/toggle rendering ────
  // This eliminates the "0/3" race condition: storage is fully resolved
  // before we write any values into the DOM.
  const prefs = await loadPrefs();

  // Master skip toggle
  const masterEl = document.getElementById('skipMaster');
  if (masterEl) {
    masterEl.checked = prefs.skipMaster;
    setSkipBodyOpen(prefs.skipMaster);

    masterEl.addEventListener('change', () => {
      const live = {
        ...prefs,
        skipMaster: masterEl.checked,
        skipIntro:  document.getElementById('skipIntro')?.checked ?? prefs.skipIntro,
        skipRecap:  document.getElementById('skipRecap')?.checked ?? prefs.skipRecap,
        skipOutro:  document.getElementById('skipOutro')?.checked ?? prefs.skipOutro,
      };
      br.storage.local.set({ skipMaster: masterEl.checked });
      setSkipBodyOpen(masterEl.checked);
      updateSkipBadge(live);
    });
  }

  // Child toggles - set from prefs before attaching listeners
  for (const key of CHILD_KEYS) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.checked = prefs[key];
    el.addEventListener('change', () => {
      const live = {
        ...prefs,
        skipMaster: masterEl?.checked ?? prefs.skipMaster,
        [key]: el.checked,
      };
      br.storage.local.set({ [key]: el.checked });
      updateSkipBadge(live);
    });
  }

  // Render badge from the fully-resolved prefs (not DOM state) - fixes race condition
  updateSkipBadge(prefs);

  // Resume toggle
  const resumeEl = document.getElementById('resumePlayback');
  if (resumeEl) {
    resumeEl.checked = prefs.resumePlayback;
    resumeEl.addEventListener('change', () =>
      br.storage.local.set({ resumePlayback: resumeEl.checked })
    );
  }

  // Settings gear
  const optionsBtn = document.getElementById('optionsBtn');
  if (optionsBtn) optionsBtn.addEventListener('click', () => br.runtime.openOptionsPage());

  // ── Load local history immediately ────────────────────────────────────────
  await loadLocalHistory();
  populateSiteFilter();
  applyHistoryFilters();

  // ── Service health check ─────────────────────────────────────────────────
  let result;
  try {
    result = await br.runtime.sendMessage({ type: 'CHECK_CONFIG' });
  } catch {
    setStatus('err', 'Extension error - try reloading');
    return;
  }

  const sbOk    = result?.supabase?.ok;
  const idbOk   = result?.introdb?.ok;
  const tmOk    = result?.tmdb?.ok;
  const sbMsg   = result?.supabase?.message || '';
  const idbMsg  = result?.introdb?.message  || '';
  const needsSQL = result?.supabase?.needsManualSetup;

  const activeSvcs = [idbOk && 'IntroDB', sbOk && 'Supabase', tmOk && 'TMDB'].filter(Boolean);
  if (activeSvcs.length) {
    setStatus('ok', activeSvcs.join(' · ') + ' · Connected');
  } else {
    setStatus('warn', 'No services configured - open Settings');
  }

  const banner = document.getElementById('alertBanner');
  if (banner) {
    const warnings = [];
    if (!idbOk && idbMsg !== 'Not configured') warnings.push(`IntroDB: ${idbMsg}`);
    if (!sbOk && needsSQL) warnings.push('Supabase: run supabase_setup.sql once to create the table.');
    else if (!sbOk && sbMsg && !sbMsg.includes('configured')) warnings.push(`Supabase: ${sbMsg}`);

    if (warnings.length) {
      banner.className = 'alert warn';
      banner.replaceChildren();
      for (const [i, w] of warnings.entries()) {
        banner.appendChild(document.createTextNode(`⚠ ${w}`));
        if (i < warnings.length - 1) banner.appendChild(document.createElement('br'));
      }
    }
  }

  // ── Load cloud history in background ─────────────────────────────────────
  if (sbOk) {
    setSyncStatus('', 'Syncing cloud history…');
    try {
      const uidRes = await br.runtime.sendMessage({ type: 'GET_USER_ID' });
      const userId = uidRes?.userId;
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