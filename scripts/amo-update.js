#!/usr/bin/env node
/**
 * SkipStream - AMO automation script
 *
 * Steps:
 *   1. Generates signed JWT for AMO API auth
 *   2. Uploads extension ZIP to AMO (upload/create endpoint)
 *   3. Polls until validation passes (up to 10 min)
 *   4. Creates new version on the listing (gracefully skips HTTP 409 duplicates)
 *   5. PATCHes listing metadata: summary, description, categories, homepage, tags
 *   6. Uploads the add-on icon (icons/icon-128.png) while AMO still shows its default icon
 *
 * LISTING_ONLY=1 skips steps 2-4: it sets the release notes of the current AMO version
 * (must be this manifest version), then steps 5 and 6. Use it to fix a published listing.
 *
 * API v5 takes categories as a flat list of slugs. The old v4 object form
 * ({ firefox: [...] }) makes the PATCH fail, and then the listing keeps its old
 * text. `node scripts/amo-update.js --print-listing` prints the body offline.
 *
 * Required env vars (set as GitHub Actions secrets):
 *   AMO_API_KEY     - from https://addons.mozilla.org/en-US/developers/addon/api/key/
 *   AMO_API_SECRET  - from the same page
 *
 * Optional env vars:
 *   AMO_ADDON_SLUG  - defaults to "skipstream"
 *   ZIP_PATH        - path to built ZIP; defaults to first skipstream-*-firefox.zip found
 *   RELEASE_NOTES   - version release notes (plain text or basic Markdown)
 *   DRY_RUN         - set to "1" to skip mutating API calls
 *   LISTING_ONLY    - set to "1" to update notes, listing and icon only (no upload)
 */
'use strict';

const fs      = require('fs');
const crypto  = require('crypto');
const https   = require('https');

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY    = process.env.AMO_API_KEY;
const API_SECRET = process.env.AMO_API_SECRET;
const ADDON_SLUG = process.env.AMO_ADDON_SLUG || 'skipstream';
const DRY_RUN    = process.env.DRY_RUN === '1';
const LISTING_ONLY = process.env.LISTING_ONLY === '1';
const ICON_PATH  = 'icons/icon-128.png';
const NOTES_MAX  = 3000;

let ZIP_PATH, VERSION, RELEASE_NOTES;

// Runs only when the script is started (not when a test loads it).
function setup() {
  if (!API_KEY || !API_SECRET) {
    process.stderr.write('❌  AMO_API_KEY and AMO_API_SECRET must be set.\n');
    process.exit(1);
  }

  // Find ZIP (not needed when only the listing is updated)
  ZIP_PATH = process.env.ZIP_PATH;
  if (!ZIP_PATH && !LISTING_ONLY) {
    const zips = fs.readdirSync('.').filter(f => f.startsWith('skipstream-') && f.endsWith('-firefox.zip'));
    if (!zips.length) { process.stderr.write('❌  No skipstream-*-firefox.zip found in cwd\n'); process.exit(1); }
    ZIP_PATH = zips.sort().pop();
  }
  if (!LISTING_ONLY && !fs.existsSync(ZIP_PATH)) { process.stderr.write(`❌  ZIP not found: ${ZIP_PATH}\n`); process.exit(1); }

  // Version from manifest.json
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  VERSION  = manifest.version;

  // Release notes
  RELEASE_NOTES = fitNotes(process.env.RELEASE_NOTES || extractChangelogNotes(VERSION), VERSION);

  process.stdout.write(`\n🚀  SkipStream AMO Update - v${VERSION}\n`);
  process.stdout.write(LISTING_ONLY ? '    LISTING_ONLY=1 - no upload: notes, listing and icon\n' : `    ZIP:  ${ZIP_PATH}\n`);
  process.stdout.write(`    Slug: ${ADDON_SLUG}\n`);
  if (DRY_RUN) process.stdout.write('    DRY_RUN=1 - mutating calls will be skipped\n\n');
}

// ── JWT ───────────────────────────────────────────────────────────────────────

function makeJwt() {
  const iat    = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: API_KEY,
    jti: crypto.randomBytes(16).toString('hex'),
    iat,
    exp: iat + 300,
  }));
  const sig = b64url(
    crypto.createHmac('sha256', API_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

function b64url(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function pathBasename(p) { return p.split(/[/\\]/).pop(); }

function apiRequest(method, urlPath, { json, formData, retries = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const jwt = makeJwt();
      let body, contentType;

      if (formData) {
        const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
        contentType = `multipart/form-data; boundary=${boundary}`;
        const parts = [];
        for (const [key, val] of Object.entries(formData)) {
          if (val && val._file) {
            const fileData = fs.readFileSync(val._file);
            parts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${pathBasename(val._file)}"\r\nContent-Type: ${val._type || 'application/zip'}\r\n\r\n`
            );
            parts.push(fileData);
            parts.push('\r\n');
          } else {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`);
          }
        }
        parts.push(`--${boundary}--\r\n`);
        body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
      } else if (json !== undefined) {
        body = Buffer.from(JSON.stringify(json));
        contentType = 'application/json';
      }

      const options = {
        hostname: 'addons.mozilla.org',
        path: urlPath,
        method,
        headers: {
          Authorization: `JWT ${jwt}`,
          'User-Agent': `SkipStream-CI/1.0 (${ADDON_SLUG})`,
          Accept: 'application/json',
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...(body ? { 'Content-Length': body.length } : {}),
        },
      };

      const req = https.request(options, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let data;
          try { data = JSON.parse(raw); } catch { data = raw; }
          if (res.statusCode >= 500 && n < retries) {
            process.stderr.write(`    ⚠  HTTP ${res.statusCode} - retrying (${n}/${retries})…\n`);
            setTimeout(() => attempt(n + 1), 2000 * n);
            return;
          }
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      });
      req.on('error', err => {
        if (n < retries) { setTimeout(() => attempt(n + 1), 2000 * n); }
        else reject(err);
      });
      if (body) req.write(body);
      req.end();
    };
    attempt(1);
  });
}

// ── Poll helper ───────────────────────────────────────────────────────────────

async function poll(fn, label, { interval = 8000, timeout = 600_000 } = {}) {
  const start = Date.now();
  process.stdout.write(`    ⏳  ${label}`);
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result !== null) { process.stdout.write(' ✓\n'); return result; }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ── Changelog parser ──────────────────────────────────────────────────────────

function extractChangelogNotes(version) {
  try {
    const cl = fs.readFileSync('CHANGELOG.md', 'utf8');
    const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
    const m  = cl.match(re);
    if (!m) return '';
    return m[1]
      .replace(/###[^\n]*/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .trim();
  } catch { return ''; }
}

// AMO shows each "- " line as a list item. Long notes are cut after a whole line
// (never inside one), and the last line links to the full notes on GitHub.
function fitNotes(text, version, max = NOTES_MAX) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const tail = `- More in the full release notes: https://github.com/govinda-rajulu/openskip/releases/tag/v${version}`;
  const out = [];
  let len = tail.length;
  for (const line of t.split('\n')) {
    if (len + line.length + 1 > max) break;
    out.push(line);
    len += line.length + 1;
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.concat(tail).join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let uploadUuid;
  if (LISTING_ONLY) { await updateCurrentNotes(); await updateListing(); await updateIcon(); return done(); }

  // ── Step 1: Upload ZIP ────────────────────────────────────────────────────
  process.stdout.write('\n📤  Step 1/4 - Uploading ZIP…\n');

  if (DRY_RUN) {
    process.stdout.write('    [dry-run] skipping upload\n');
    uploadUuid = 'dry-run-uuid';
  } else {
    const uploadRes = await apiRequest('POST', '/api/v5/addons/upload/', {
      formData: {
        upload:  { _file: ZIP_PATH },
        channel: 'listed',
      },
    });

    if (uploadRes.status === 201) {
      uploadUuid = uploadRes.data.uuid;
      process.stdout.write(`    ✅  Uploaded - UUID: ${uploadUuid}\n`);
    } else if (uploadRes.status === 409) {
      process.stderr.write('    ⚠  HTTP 409 - ZIP already uploaded for this version.\n');
      uploadUuid = uploadRes.data?.uuid || null;
      if (!uploadUuid) {
        // Re-fetch upload list to find existing UUID by filename
        process.stdout.write('    Fetching existing upload UUID...\n');
        const listRes = await apiRequest('GET', `/api/v5/addons/upload/?page_size=5`);
        const match = (listRes.data?.results || []).find(u => u.version === VERSION);
        uploadUuid = match?.uuid || null;
        if (!uploadUuid) {
          process.stderr.write('    ⚠  Could not find existing upload UUID. Version may already be fully processed on AMO.\n');
          process.exit(0);
        }
      }
      process.stdout.write(`    UUID from existing upload: ${uploadUuid}\n`);
    } else {
      const body = typeof uploadRes.data === 'string'
        ? uploadRes.data.slice(0, 800)
        : JSON.stringify(uploadRes.data, null, 2);
      process.stderr.write(`❌  Upload failed (HTTP ${uploadRes.status}):\n${body}\n`);
      process.exit(1);
    }

    // ── Step 2: Poll validation ─────────────────────────────────────────────
    process.stdout.write('\n🔍  Step 2/4 - Waiting for validation…\n');
    const validationResult = await poll(async () => {
      const r = await apiRequest('GET', `/api/v5/addons/upload/${uploadUuid}/`);
      if (r.status !== 200) return null;
      if (r.data.processed && r.data.valid) return r.data;
      if (r.data.processed && !r.data.valid) {
        process.stderr.write('\n❌  Validation failed:\n');
        process.stderr.write(`    Full response: ${JSON.stringify(r.data.validation, null, 2)}\n`);
        (r.data.validation?.messages || [])
          .filter(m => m.type === 'error')
          .forEach(m => process.stderr.write(`    [${m.type}] ${m.message} (${m.file || ''}:${m.line || ''})\n`));
        process.exit(1);
      }
      return null;
    }, 'Validating', { interval: 8000, timeout: 600_000 });
    process.stdout.write(`    Warnings: ${validationResult.validation?.warnings?.length || 0}\n`);
  }

  // ── Step 3: Create new version ────────────────────────────────────────────
  process.stdout.write('\n🔖  Step 3/4 - Creating version on AMO listing…\n');
  const versionBody = {
    upload: uploadUuid,
    ...(RELEASE_NOTES ? { release_notes: { 'en-US': RELEASE_NOTES } } : {}),
  };

  if (DRY_RUN) {
    process.stdout.write('    [dry-run] skipping version create\n');
    process.stdout.write(`    Body: ${JSON.stringify(versionBody, null, 2)}\n`);
  } else {
    const versionRes = await apiRequest(
      'POST',
      `/api/v5/addons/addon/${ADDON_SLUG}/versions/`,
      { json: versionBody }
    );

    if (versionRes.status === 201) {
      process.stdout.write(`    ✅  Version ${VERSION} created (id: ${versionRes.data.id})\n`);
    } else if (versionRes.status === 409) {
      process.stderr.write(`    ⚠  HTTP 409 - Version ${VERSION} already exists on AMO. Skipping.\n`);
    } else if (versionRes.status === 404) {
      // Add-on not yet listed on AMO - create it
      process.stdout.write('    Add-on not found. Creating new add-on listing…\n');
      const createRes = await apiRequest('POST', '/api/v5/addons/addon/', {
        json: {
          version: { upload: uploadUuid },
          name:    { 'en-US': 'SkipStream' },
          slug:    ADDON_SLUG,
        },
      });
      if (createRes.status !== 201) {
        process.stderr.write(`❌  Create add-on failed (HTTP ${createRes.status}):\n${JSON.stringify(createRes.data, null, 2)}\n`);
        process.stderr.write(`    Response headers: ${JSON.stringify(createRes.headers, null, 2)}\n`);
        process.exit(1);
      }
      process.stdout.write(`    ✅  New add-on created (id: ${createRes.data.id})\n`);
    } else {
      process.stderr.write(`❌  Version create failed (HTTP ${versionRes.status}):\n${JSON.stringify(versionRes.data, null, 2)}\n`);
      process.stderr.write(`    Response headers: ${JSON.stringify(versionRes.headers, null, 2)}\n`);
      process.exit(1);
    }
  }

  await updateListing();
  await updateIcon();
  done();
}

function done() {
  process.stdout.write(`\n✅  Done - SkipStream v${VERSION} processed on AMO.\n`);
  process.stdout.write(`    View: https://addons.mozilla.org/en-US/firefox/addon/${ADDON_SLUG}/\n\n`);
}

// Notes of a version that is already on AMO (LISTING_ONLY).
async function updateCurrentNotes() {
  process.stdout.write('\n🗒   Release notes of the current AMO version…\n');
  const a = await apiRequest('GET', `/api/v5/addons/addon/${ADDON_SLUG}/`);
  const cur = a.status === 200 && a.data && a.data.current_version;
  if (!cur || cur.version !== VERSION) {
    process.stderr.write(`❌  AMO current version is ${cur ? cur.version : '(unreadable, HTTP ' + a.status + ')'}, expected ${VERSION}. Notes not changed.\n`);
    process.exit(1);
  }
  if (DRY_RUN) { process.stdout.write(`    [dry-run] PATCH version ${cur.id} notes (${RELEASE_NOTES.length} chars)\n`); return; }
  const r = await apiRequest('PATCH', `/api/v5/addons/addon/${ADDON_SLUG}/versions/${cur.id}/`, { json: { release_notes: { 'en-US': RELEASE_NOTES } } });
  if (r.status !== 200) {
    process.stderr.write(`❌  Notes PATCH failed (HTTP ${r.status}):\n${JSON.stringify(r.data, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`    ✅  Notes of ${VERSION} updated (${RELEASE_NOTES.length} chars)\n`);
}

// AMO does not take the icon from the manifest: it shows a default icon until one is
// uploaded. Upload icons/icon-128.png only while the default is shown.
async function updateIcon() {
  process.stdout.write('\n🖼   Add-on icon…\n');
  const a = await apiRequest('GET', `/api/v5/addons/addon/${ADDON_SLUG}/`);
  const url = a.status === 200 && a.data ? String(a.data.icon_url || '') : '';
  if (url && !/\/default-\d+\.png/.test(url)) { process.stdout.write('    icon already set\n'); return; }
  if (DRY_RUN) { process.stdout.write(`    [dry-run] PATCH icon ${ICON_PATH}\n`); return; }
  const r = await apiRequest('PATCH', `/api/v5/addons/addon/${ADDON_SLUG}/`, { formData: { icon: { _file: ICON_PATH, _type: 'image/png' } } });
  if (r.status === 200) { process.stdout.write('    ✅  Icon uploaded (AMO resizes it in the background)\n'); return; }
  process.stderr.write(`    ⚠  Icon PATCH returned HTTP ${r.status}:\n${JSON.stringify(r.data, null, 2)}\n`);
  process.stdout.write(`::warning title=AMO icon not set::PATCH returned HTTP ${r.status}.\n`);
  if (LISTING_ONLY) process.exit(1);
}

async function updateListing() {
  process.stdout.write('\n📝  Listing metadata…\n');

  const listingBody = buildListing();

  if (DRY_RUN) {
    process.stdout.write(`    [dry-run] PATCH body:\n${JSON.stringify(listingBody, null, 2)}\n`);
  } else {
    const patchRes = await apiRequest(
      'PATCH',
      `/api/v5/addons/addon/${ADDON_SLUG}/`,
      { json: listingBody }
    );
    if (patchRes.status === 200) {
      process.stdout.write('    ✅  Listing metadata updated\n');
    } else {
      // Metadata update is non-critical - version already uploaded. Warn but don't fail,
      // and make the warning visible on the run page (it was missed before 1.13).
      process.stderr.write(`    ⚠  PATCH returned HTTP ${patchRes.status} - metadata update skipped:\n${JSON.stringify(patchRes.data, null, 2)}\n`);
      process.stdout.write(`::warning title=AMO listing not updated::PATCH returned HTTP ${patchRes.status}. The listing keeps its old text.\n`);
      if (LISTING_ONLY) process.exit(1);
    }
  }
}

// ── Listing text ──────────────────────────────────────────────────────────────
// Written in ASD-STE100 style (knowledge/handbook/WRITING.md): short sentences,
// active voice, one term for one thing. Every claim must match the code and
// PRIVACY.md. AMO limits the summary to 250 characters.

const SUMMARY = 'Skips intros, recaps and credits on streaming sites. Continues each video where you stopped. You can sync your history to your own Supabase project.';

function buildListing() {
  return {
    name:             { 'en-US': 'SkipStream' },
    summary:          { 'en-US': SUMMARY },
    description:      { 'en-US': buildDescription() },
    homepage:         { 'en-US': 'https://github.com/govinda-rajulu/openskip' },
    support_url:      { 'en-US': 'https://github.com/govinda-rajulu/openskip/issues' },
    categories:       ['photos-music-videos'],
    tags:             ['privacy'],
    is_experimental:  false,
    requires_payment: false,
    default_locale:   'en-US',
  };
}

function buildDescription() {
  return `SkipStream skips intros, recaps and end credits on streaming sites. It also continues each video from the point where you stopped.

What SkipStream does

• It skips intros, recaps, credits and previews. You can skip at once, or after a 3-second countdown with an Undo button.
• It gets skip times from IntroDB, TheIntroDB, SkipDB, AniSkip and Anime Skip. Some sites have their own Skip button. SkipStream can push that button for you (Netflix, Prime Video, Disney+, Hulu, Max, Crunchyroll, Peacock, Paramount+, Apple TV+ and Tubi).
• On YouTube, it skips sponsor segments from SponsorBlock. You set each segment type to Auto, Ask or Off. It shows the segments on the progress bar.
• It continues each video from your last position. A time in the address (for example ?t=90) has priority.
• It shows subtitles from OpenSubtitles or from your own .srt or .vtt file. You can set the colour, font, background, edge and size.
• It keeps a history with posters, stats and per-site rules. It has speed control and an optional "auto next episode".
• It makes one backup file of your settings and history. Keys are in the file only if you select this. Then your passphrase encrypts them.
• Two tools in the popup help with bug reports: "Check this page" and "Site report".

Setup

You do not need an account or a key for skips, SponsorBlock and resume. Each of these is optional:
• TMDB key (themoviedb.org): posters, and ids for sites that show only a title.
• Supabase project (supabase.com): history and settings in your own cloud. Settings shows you how to run the setup script one time.
• OpenSubtitles account: more subtitle downloads each day.
• Anime Skip client id (anime-skip.com): more anime skip times.

Privacy

SkipStream has no server. It sends nothing to its developer. It sends data only to the services in the privacy policy, and only for the reasons given there. Your keys stay in your browser. Your history goes to your own Supabase project only if you set one up. You can switch off technical data (device name, settings backup and stats) in the Firefox add-on settings.

Privacy policy: github.com/govinda-rajulu/openskip/blob/main/PRIVACY.md
Source code: github.com/govinda-rajulu/openskip`;
}

if (require.main === module) {
  if (process.argv.includes('--print-listing')) {
    process.stdout.write(JSON.stringify(buildListing(), null, 2) + '\n');
  } else {
    setup();
    main().catch(err => { process.stderr.write(`❌  Fatal: ${err}\n`); process.exit(1); });
  }
}

module.exports = { buildListing, buildDescription, SUMMARY, extractChangelogNotes, fitNotes };
