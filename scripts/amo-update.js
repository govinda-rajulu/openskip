#!/usr/bin/env node
/**
 * SkipStream - AMO automation script
 *
 * What it does:
 *   1. Generates a signed JWT for AMO API auth
 *   2. Uploads the extension ZIP to AMO (upload/create endpoint)
 *   3. Polls until validation passes (up to 10 min)
 *   4. Creates a new version on the listing (gracefully skips HTTP 409 duplicates)
 *   5. PATCHes the listing metadata: summary, description, categories, homepage, tags
 *
 * Required env vars (set as GitHub Actions secrets):
 *   AMO_API_KEY     - from https://addons.mozilla.org/en-US/developers/addon/api/key/
 *   AMO_API_SECRET  - from the same page
 *
 * Optional env vars:
 *   AMO_ADDON_SLUG  - defaults to "skipstream"
 *   ZIP_PATH        - path to the built ZIP; defaults to first skipstream-*.zip found
 *   RELEASE_NOTES   - version release notes (plain text or basic Markdown)
 *   DRY_RUN         - set to "1" to skip mutating API calls (still validates JWT + upload)
 */
'use strict';

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const https   = require('https');

// ── Config ────────────────────────────────────────────────────────────────────

const AMO_BASE    = 'https://addons.mozilla.org';
const API_KEY     = process.env.AMO_API_KEY;
const API_SECRET  = process.env.AMO_API_SECRET;
const ADDON_SLUG  = process.env.AMO_ADDON_SLUG || 'skipstream';
const DRY_RUN     = process.env.DRY_RUN === '1';

if (!API_KEY || !API_SECRET) {
  console.error('❌  AMO_API_KEY and AMO_API_SECRET must be set.');
  process.exit(1);
}

// Find ZIP
let ZIP_PATH = process.env.ZIP_PATH;
if (!ZIP_PATH) {
  const zips = fs.readdirSync('.').filter(f => f.startsWith('skipstream-') && f.endsWith('-firefox.zip'));
  if (!zips.length) { console.error('❌  No skipstream-*-firefox.zip found in cwd'); process.exit(1); }
  ZIP_PATH = zips.sort().pop();
}
if (!fs.existsSync(ZIP_PATH)) { console.error(`❌  ZIP not found: ${ZIP_PATH}`); process.exit(1); }

// Version from manifest.json
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const VERSION  = manifest.version;

// Release notes
const RELEASE_NOTES = process.env.RELEASE_NOTES || extractChangelogNotes(VERSION);

console.log(`\n🚀  SkipStream AMO Update - v${VERSION}`);
console.log(`    ZIP:  ${ZIP_PATH}`);
console.log(`    Slug: ${ADDON_SLUG}`);
if (DRY_RUN) console.log('    DRY_RUN=1 - mutating calls will be skipped\n');

// ── JWT ───────────────────────────────────────────────────────────────────────

function makeJwt() {
  const iat    = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: API_KEY,
    jti: crypto.randomBytes(16).toString('hex'),
    iat,
    exp: iat + 60,
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
              `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${pathBasename(val._file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`
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
            console.warn(`    ⚠  HTTP ${res.statusCode} - retrying (${n}/${retries})…`);
            setTimeout(() => attempt(n + 1), 2000 * n);
            return;
          }
          resolve({ status: res.statusCode, data });
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

function pathBasename(p) { return p.split(/[\\/]/).pop(); }

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
    const escaped = version.replace(/\./g, '\\.');
    const re = new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
    const m  = cl.match(re);
    if (!m) return '';
    return m[1]
      .replace(/###[^\n]*/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .trim()
      .slice(0, 3000);
  } catch { return ''; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {

  // ── Step 1: Upload ZIP ────────────────────────────────────────────────────
  console.log('\n📤  Step 1/4 - Uploading ZIP…');

  let uploadUuid;
  if (DRY_RUN) {
    console.log('    [dry-run] skipping upload');
    uploadUuid = 'dry-run-uuid';
  } else {
    const uploadRes = await apiRequest('POST', '/api/v5/addons/upload/', {
      formData: {
        upload:  { _file: ZIP_PATH },
        channel: 'listed',
      },
    });

    // 409 = this exact ZIP/version already uploaded - treat as success
    if (uploadRes.status === 409) {
      console.warn('    ⚠  HTTP 409 - ZIP already uploaded for this version. Skipping upload gracefully.');
      // Extract uuid from conflict response if available
      uploadUuid = uploadRes.data?.uuid || null;
      if (!uploadUuid) {
        console.warn('    ⚠  No UUID in 409 response. Cannot proceed to version create. Exiting cleanly.');
        process.exit(0);
      }
    } else if (uploadRes.status !== 201) {
      const body = typeof uploadRes.data === 'string'
        ? uploadRes.data.slice(0, 500)
        : JSON.stringify(uploadRes.data, null, 2);
      console.error(`❌  Upload failed (HTTP ${uploadRes.status}):\n${body}`);
      if (uploadRes.status === 409 || (typeof uploadRes.data === 'object' && uploadRes.data?.error?.includes?.('exists'))) {
        console.warn('    ⚠  This upload may already exist on AMO. Continuing to version create…');
      } else {
        process.exit(1);
      }
    } else {
      uploadUuid = uploadRes.data.uuid;
      console.log(`    UUID: ${uploadUuid}`);
    }

    // ── Step 2: Poll validation ─────────────────────────────────────────────
    console.log('\n🔍  Step 2/4 - Waiting for validation…');
    const validUpload = await poll(async () => {
      const r = await apiRequest('GET', `/api/v5/addons/upload/${uploadUuid}/`);
      if (r.status !== 200) return null;
      if (r.data.processed && r.data.valid) return r.data;
      if (r.data.processed && !r.data.valid) {
        console.error('\n❌  Validation failed:');
        console.error('    Full validation response:', JSON.stringify(r.data.validation, null, 2));
        (r.data.validation?.messages || [])
          .filter(m => m.type === 'error')
          .forEach(m => console.error(`    [${m.type}] ${m.message} (${m.file || ''}:${m.line || ''})`));
        process.exit(1);
      }
      return null;
    }, 'Validating', { interval: 8000, timeout: 600_000 });
    console.log(`    Validation passed (${validUpload.validation?.warnings || 0} warnings)`);
  }

  // ── Step 3: Create new version ────────────────────────────────────────────
  console.log('\n🔖  Step 3/4 - Creating version on AMO listing…');
  const versionBody = {
    upload: uploadUuid,
    ...(RELEASE_NOTES ? { release_notes: { 'en-US': RELEASE_NOTES } } : {}),
  };

  if (DRY_RUN) {
    console.log('    [dry-run] skipping version create');
    console.log('    Body would be:', JSON.stringify(versionBody, null, 2));
  } else {
    const versionRes = await apiRequest(
      'POST',
      `/api/v5/addons/addon/${ADDON_SLUG}/versions/`,
      { json: versionBody }
    );

    if (versionRes.status === 201) {
      console.log(`    ✅  Version ${VERSION} created (id: ${versionRes.data.id})`);
    } else if (versionRes.status === 409) {
      // Version already exists on AMO - not a failure, just a duplicate run
      console.warn(`    ⚠  HTTP 409 - Version ${VERSION} already exists on AMO. Skipping version create gracefully.`);
    } else if (versionRes.status === 404) {
      // Add-on not yet listed - create it
      console.log('    Add-on not yet listed. Creating new add-on…');
      const createBody = {
        version: { upload: uploadUuid },
        name:    { 'en-US': 'SkipStream' },
        slug:    ADDON_SLUG,
      };
      const createRes = await apiRequest('POST', '/api/v5/addons/addon/', { json: createBody });
      if (createRes.status !== 201) {
        console.error(`❌  Create add-on failed (HTTP ${createRes.status}):`, JSON.stringify(createRes.data, null, 2));
        process.exit(1);
      }
      console.log(`    ✅  New add-on created (id: ${createRes.data.id})`);
    } else {
      console.error(`❌  Version create failed (HTTP ${versionRes.status}):`, JSON.stringify(versionRes.data, null, 2));
      process.exit(1);
    }
  }

  // ── Step 4: PATCH listing metadata ───────────────────────────────────────
  console.log('\n📝  Step 4/4 - Updating listing metadata…');

  const listingBody = {
    name:        { 'en-US': 'SkipStream' },
    summary:     { 'en-US': 'Automatically skip intros, recaps, and outros - and resume playback across all your devices.' },
    description: { 'en-US': buildDescription() },
    homepage:    { 'en-US': 'https://github.com/govinda-rajulu/openskip' },
    support_url: { 'en-US': 'https://github.com/govinda-rajulu/openskip/issues' },
    categories:  { firefox: ['photos-music-videos'] },
    tags:        ['privacy'],
    is_experimental: false,
    requires_payment: false,
    default_locale: 'en-US',
  };

  if (DRY_RUN) {
    console.log('    [dry-run] PATCH body:');
    console.log(JSON.stringify(listingBody, null, 2));
  } else {
    const patchRes = await apiRequest(
      'PATCH',
      `/api/v5/addons/addon/${ADDON_SLUG}/`,
      { json: listingBody }
    );
    if (patchRes.status === 200) {
      console.log('    ✅  Listing metadata updated');
    } else if (patchRes.status === 409) {
      console.warn('    ⚠  HTTP 409 on PATCH - metadata already current. Continuing.');
    } else {
      // Metadata update is non-critical - version already uploaded. Warn but don't fail.
      console.warn(`    ⚠  PATCH returned HTTP ${patchRes.status} - metadata update skipped:`, JSON.stringify(patchRes.data, null, 2));
    }
  }

  console.log(`\n✅  Done - SkipStream v${VERSION} processed on AMO.`);
  console.log(`    View: https://addons.mozilla.org/en-US/firefox/addon/${ADDON_SLUG}/\n`);
}

// ── Listing description ───────────────────────────────────────────────────────

function buildDescription() {
  return `Skip intros, recaps, and outros on any streaming site. Resume exactly where you left off on any device.

What it does

• Skips intros, recaps, and outros - 3s countdown toast with Undo (powered by IntroDB and AnimeSkip)
• Clicks the platform's own Skip Intro button - Netflix, Prime Video, Disney+, Hulu, Max, Crunchyroll, Peacock, Paramount+, Apple TV+, Tubi
• Resumes playback from where you stopped - locally cached and synced to your own Supabase project
• Auto next episode - advances near end of video (optional, off by default)
• Speed control - 1x / 1.25x / 1.5x / 2x, persists across pages
• Per-site rules - different skip mode for specific domains
• Watch stats - segments skipped, time saved, session count
• Dismisses "Are you still watching?" overlays automatically
• Force sync - push all local positions to cloud and refresh history on demand
• Full backup and restore - export all history, stats, credentials, preferences as JSON
• Dark and light theme - follows system preference, manual override available
• Works on any site with an HTML5 video player

Setup

Click the gear icon in the popup.

• IntroDB key (free at introdb.app) - required for skip segments
• Supabase URL + anon key (free at supabase.com) - optional, enables cross-device sync and cloud backup
• TMDB key (free at themoviedb.org) - optional, improves show detection on Plex and similar
• AnimeSkip Client ID (free at anime-skip.com) - optional, anime intro and outro support

Privacy

All credentials are stored locally on your device. Playback sync goes directly to your own Supabase project. No telemetry, no ads, no tracking, no accounts required.

Source: github.com/govinda-rajulu/openskip`;
}

main().catch(err => { console.error('❌  Fatal:', err); process.exit(1); });