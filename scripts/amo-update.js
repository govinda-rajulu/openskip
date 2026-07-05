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
 */
'use strict';

const fs      = require('fs');
const crypto  = require('crypto');
const https   = require('https');

// ── Config ────────────────────────────────────────────────────────────────────

const AMO_BASE   = 'https://addons.mozilla.org';
const API_KEY    = process.env.AMO_API_KEY;
const API_SECRET = process.env.AMO_API_SECRET;
const ADDON_SLUG = process.env.AMO_ADDON_SLUG || 'skipstream';
const DRY_RUN    = process.env.DRY_RUN === '1';

if (!API_KEY || !API_SECRET) {
  process.stderr.write('❌  AMO_API_KEY and AMO_API_SECRET must be set.\n');
  process.exit(1);
}

// Find ZIP
let ZIP_PATH = process.env.ZIP_PATH;
if (!ZIP_PATH) {
  const zips = fs.readdirSync('.').filter(f => f.startsWith('skipstream-') && f.endsWith('-firefox.zip'));
  if (!zips.length) { process.stderr.write('❌  No skipstream-*-firefox.zip found in cwd\n'); process.exit(1); }
  ZIP_PATH = zips.sort().pop();
}
if (!fs.existsSync(ZIP_PATH)) { process.stderr.write(`❌  ZIP not found: ${ZIP_PATH}\n`); process.exit(1); }

// Version from manifest.json
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const VERSION  = manifest.version;

// Release notes
const RELEASE_NOTES = process.env.RELEASE_NOTES || extractChangelogNotes(VERSION);

process.stdout.write(`\n🚀  SkipStream AMO Update - v${VERSION}\n`);
process.stdout.write(`    ZIP:  ${ZIP_PATH}\n`);
process.stdout.write(`    Slug: ${ADDON_SLUG}\n`);
if (DRY_RUN) process.stdout.write('    DRY_RUN=1 - mutating calls will be skipped\n\n');

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
              `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${pathBasename(val._file)}"\r\nContent-Type: application/zip\r\n\r\n`
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
  let uploadUuid;

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

  // ── Step 4: PATCH listing metadata ───────────────────────────────────────
  process.stdout.write('\n📝  Step 4/4 - Updating listing metadata…\n');

  const listingBody = {
    name:             { 'en-US': 'SkipStream' },
    summary:          { 'en-US': 'Automatically skip intros, recaps, and outros - and resume playback across all your devices.' },
    description:      { 'en-US': buildDescription() },
    homepage:         { 'en-US': 'https://github.com/govinda-rajulu/openskip' },
    support_url:      { 'en-US': 'https://github.com/govinda-rajulu/openskip/issues' },
    categories:       { firefox: ['photos-music-videos'] },
    tags:             ['privacy'],
    is_experimental:  false,
    requires_payment: false,
    default_locale:   'en-US',
  };

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
      // Metadata update is non-critical - version already uploaded. Warn but don't fail.
      process.stderr.write(`    ⚠  PATCH returned HTTP ${patchRes.status} - metadata update skipped:\n${JSON.stringify(patchRes.data, null, 2)}\n`);
    }
  }

  process.stdout.write(`\n✅  Done - SkipStream v${VERSION} processed on AMO.\n`);
  process.stdout.write(`    View: https://addons.mozilla.org/en-US/firefox/addon/${ADDON_SLUG}/\n\n`);
}

// ── Listing description ───────────────────────────────────────────────────────

function buildDescription() {
  return `Skip intros, recaps, and outros on any streaming site. Resume exactly where you left off on any device.

What it does

• Skips intros, recaps, and outros - 3s countdown toast with Undo (powered by IntroDB and AnimeSkip)
• Clicks the platform's own Skip Intro button - Netflix, Prime Video, Disney+, Hulu, Max, Crunchyroll, Peacock, Paramount+, Apple TV+, Tubi
• Subtitles - auto-fetched from OpenSubtitles by IMDb ID, draggable CC overlay with sync offset, offline .srt/.vtt upload, multiple languages
• Resumes playback from where you stopped - locally cached and synced to your own Supabase project
• Auto next episode - advances near end of video (optional, off by default)
• Speed control - 0.75x / 1x / 1.25x / 1.5x / 2x, persists across pages
• Per-site rules - different skip mode for specific domains
• Watch stats - segments skipped, time saved, session count
• Dismisses "Are you still watching?" overlays automatically
• Manual sync button - push local playback positions to your Supabase project on demand
• Full backup and restore - export all history, stats, credentials, preferences as JSON
• Dark and light theme toggle in the popup - persists across sessions
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

main().catch(err => { process.stderr.write(`❌  Fatal: ${err}\n`); process.exit(1); });
