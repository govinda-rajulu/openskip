# AGENTS

## Purpose
This file helps AI coding agents understand the SkipStream repository structure, constraints, and conventions.

## Repository layout
Flat-structure vanilla-JS browser extension. No build step. No npm. No TypeScript.

```
manifest.json              - Firefox MV2 manifest (authoritative version source)
manifest-chrome.json       - Chrome MV3 manifest (must always match manifest.json version)
updates.json               - Version manifest (informational, not wired to auto-update)
background.js              - Service worker: all external API calls, retry logic, user ID derivation
content-scripts/
  content.js               - Injected into all frames: video detection, skip polling, resume prompt, playback sync
popup.html / popup.js      - Extension toolbar popup: history, skip toggles, segment reporting
popup.css / options.css    - Separate stylesheets with DIFFERENT token namespaces. Not interchangeable.
theme-engine.js            - OKLCH palette generator, injects color vars into both pages
options.html / options.js  - Settings page: credential input, connection verification
scripts/
  amo-update.js            - CI script: uploads signed ZIP to AMO via REST API
icons/                     - icon-16.png, icon-32.png, icon-48.png, icon-128.png
supabase_setup.sql         - One-time DB schema setup (run once in Supabase SQL editor)
CHANGELOG.md               - Version history
CONTRIBUTING.md            - Development guide
TESTING.md                 - Manual and automated testing notes
PRIVACY.md                 - Privacy policy
HOW_TO_RELEASE.md          - Release checklist
docs/                      - Additional documentation
.github/workflows/         - CI/CD pipelines
```

There is no `src/`, no `wxt`, no `openskip/` subdirectory, no TypeScript, no build step.

## Version management - CRITICAL
- `manifest.json` is the **authoritative** version source
- `manifest-chrome.json` must always match `manifest.json` version exactly
- Git tag must match manifest version exactly (tag `v1.5.9` requires version `1.5.9` in manifest)
- `CHANGELOG.md` must have a matching `## [X.Y.Z]` entry before tagging
- `popup.js` header comment must be updated: `/* SkipStream - popup vX.Y.Z */`
- README version badge must be updated
- CI (`release.yml`) enforces tag == manifest version and will fail the build if mismatched

Files to update on every version bump: `manifest.json`, `manifest-chrome.json`, `popup.js`, `popup.css`, `README.md`, `CHANGELOG.md`, `updates.json`

`.github/workflows/version-bump.yml` automates this. Run it rather than
hand-editing seven files.

Chrome Web Store is not published (developer fee unpaid). The Chrome ZIP
is still built on every release so it stays current for manual install.

## Tech constraints
- Vanilla JS only at root level
- MV2 (Firefox) and MV3 (Chrome) both served from same `background.js` via runtime detection
- All Supabase/external API calls: `fetch()` in `background.js` only - content script uses `browser.runtime.sendMessage`
- No `fetch()` in `content-scripts/content.js` - banned by architecture and CI
- No `localStorage` in content script - use `browser.storage.local` only
- No `innerHTML` anywhere - use DOM API: `createElement`, `textContent`, `appendChild`
- No `console.log` - use `console.warn` only for diagnostics
- User ID: random UUID v4 generated per browser installation, stored in `skipstream_install_id` key

## Supabase schema
Tables:
- `public.playback_states` - per-title watch positions
- `public.user_settings` - stats, prefs, site rules, theme per user

`playback_states` unique constraint: `playback_states_user_id_media_id_key` on `(user_id, media_id)`

Correct upsert (both required - header alone causes HTTP 409):
```
POST /rest/v1/playback_states?on_conflict=user_id,media_id
Prefer: resolution=merge-duplicates
```

`user_settings` upsert:
```
POST /rest/v1/user_settings?on_conflict=user_id
Prefer: resolution=merge-duplicates
```

## Message passing API (content script <-> background)
| type | direction | purpose |
|------|-----------|---------|
| `GET_USER_ID` | content→bg | get per-install UUID |
| `SUPABASE_UPSERT` | content→bg | upsert playback state row |
| `SUPABASE_GET` | content→bg | fetch single playback row by userId + mediaId |
| `SUPABASE_GET_ALL` | popup→bg | fetch all rows for history display |
| `FETCH_SEGMENTS` | content→bg | fetch skip segments from IntroDB/AnimeSkip |
| `TMDB_TO_IMDB` | content→bg | convert TMDB numeric ID to IMDb tt-ID |
| `GET_VIDEO_TIME` | popup→content | get current video currentTime |
| `GET_SHOW_INFO` | popup→content | get resolved show/episode/mediaId metadata |
| `REPORT_SEGMENT` | popup→bg | submit a new segment to IntroDB/AnimeSkip |
| `DELETE_ALL_HISTORY` | popup→bg | delete all Supabase rows for this user |
| `SUPABASE_SETTINGS_UPSERT` | options→bg | save stats/prefs/site_rules/theme to `user_settings` |
| `SUPABASE_SETTINGS_GET` | options→bg | fetch `user_settings` row for restore prompt |
| `TMDB_SEARCH_POSTER` | options→bg | resolve a history thumbnail. Short-circuits to i.ytimg.com when `mediaId` matches `^yt/[A-Za-z0-9_-]{11}$`, otherwise TMDB backdrop then poster |
| `OSUB_SEARCH_AND_FETCH` | content→bg | auto-fetch subtitles by IMDb ID |

## Packaging - CRITICAL
Any file that ships inside the extension must be listed in the zip/cp file list of ALL FOUR workflows:
`.github/workflows/release.yml` (two places: Firefox zip and Chrome cp), `amo-submit.yml`, `cws-submit.yml`, `validate.yml`.
Adding a file to the repo alone does NOT ship it. This bug has shipped twice: popup.css missing in v1.7.6, theme-engine.js missing in v1.9.4.
`validate.yml` now fails the build if popup.css, options.css, or theme-engine.js is absent from either ZIP. Extend that guard whenever a new shipped file is added.

## CI/CD pipeline
1. Commit all version files, push tag `vX.Y.Z`
2. `release.yml` triggers: validates JS syntax, security checks, tag==manifest version, CHANGELOG entry, builds ZIP, uploads to GitHub Release
3. `amo-submit.yml` triggers on release: downloads ZIP artifact, submits to AMO, updates listing metadata
4. `cws-submit.yml` triggers on release: submits the Chrome ZIP to the Chrome Web Store
5. `validate.yml` runs on every push to `main` and every PR

## Common mistakes to avoid
- Never push a tag before bumping all version files - CI will fail with "tag does not match manifest version"
- Never use `fetch()` or `XMLHttpRequest` in `content-scripts/content.js`
- Never use `localStorage` in content script
- Never add a shipped file without updating all four workflow file lists
- popup.css and options.css use different CSS variable namespaces - do not assume a token exists in both
- Only animate transform and opacity. No backdrop-filter (open Firefox Android bug), no multi-layer shadows
- The constraint name in `supabase_setup.sql` is `playback_states_user_id_media_id_key` - do not rename it
