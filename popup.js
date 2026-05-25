/* SkipStream — popup */
'use strict';

const br = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const TOGGLES  = ['skipIntro', 'skipRecap', 'skipOutro', 'resumePlayback'];
const DEFAULTS = { skipIntro: true, skipRecap: true, skipOutro: false, resumePlayback: true };

async function loadPrefs() {
  const stored = await br.storage.local.get(TOGGLES);
  const prefs  = { ...DEFAULTS };
  for (const key of TOGGLES) if (key in stored) prefs[key] = stored[key];
  return prefs;
}

async function init() {
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

  const sbOk    = result?.supabase?.ok;
  const idbOk   = result?.introdb?.ok;
  const tmdbOk  = result?.tmdb?.ok;
  const needsSQL = result?.supabase?.needsManualSetup;
  const sbMsg   = result?.supabase?.message || '';
  const idbMsg  = result?.introdb?.message || '';

  const warnings = [];
  if (!idbOk) warnings.push(idbMsg === 'Not configured'
    ? '⚠ IntroDB key missing — skipping disabled. Add it in Settings.'
    : `⚠ IntroDB: ${idbMsg}`);
  if (!sbOk && !sbMsg.includes('configured')) warnings.push(needsSQL
    ? '⚠ Supabase table missing — run supabase_setup.sql once.'
    : '⚠ Supabase not configured — cloud sync disabled.');

  if (warnings.length) {
    noConfig.style.display = 'block';
    noConfig.replaceChildren();
    warnings.forEach((w, i) => {
      noConfig.appendChild(document.createTextNode(w));
      if (i < warnings.length - 1) noConfig.appendChild(document.createElement('br'));
    });
  }

  const parts = [];
  if (idbOk)   parts.push('IntroDB ✓');
  if (sbOk)    parts.push('Supabase ✓');
  if (tmdbOk)  parts.push('TMDB ✓');
  if (!parts.length) parts.push('No services configured');

  const allOk = idbOk && sbOk;
  statusEl.textContent = allOk ? `✓ ${parts.join(' · ')}` : parts.join(' · ');
  statusEl.className   = allOk ? 'ok' : 'warn';

  document.getElementById('optionsBtn').addEventListener('click', () => br.runtime.openOptionsPage());
}

init();
