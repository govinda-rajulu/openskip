# Changelog

## [1.6.6] - 2026-06-05

### Added
- **Cloud settings sync**: stats, preferences, site rules, and theme are now saved to a `user_settings` table in Supabase on every credential save. On the Settings page, if local settings are empty or cloud is more than 1 minute newer, a restore prompt appears.
- **Android force-update**: `update_url` in `manifest.json` points to `updates.json` hosted at `raw.githubusercontent.com`. Firefox for Android checks this URL and can prompt users to update without reinstalling.
- **Supabase `user_settings` table**: new table in `supabase_setup.sql` with RLS, auto-updated trigger, and `device_name` column migration for `playback_states`.
- **CI auto-updates `updates.json`**: `release.yml` writes the new version and download URL to `updates.json` and commits it on every release.

## [1.6.5] - 2026-06-04

### Added
- **Full backup/restore**: Export now includes watch history (`skipstream_cache`), stats, site rules, theme, `animeSkipEnabled`, and all credentials + prefs. Import merges history (keeps newer timestamp per title), combines session counts, takes higher skip/time-saved values.

### Changed
- Export filename is date-stamped: `skipstream-backup-YYYY-MM-DD.json`
- Button labels changed to "Export All" and "Import & Merge" with explanatory hint text

### Docs
- CONTRIBUTING.md, HOW_TO_RELEASE.md, TESTING.md, PRIVACY.md: all rewritten, concise
- AMO listing description: rewritten to match current features accurately

## [1.6.4] - 2026-06-04

### Added
- **Force sync button**: Sync button in history panel pushes all local positions to cloud then refreshes; shows item count and timestamp
- **Last sync time**: status bar shows when data was last synced to cloud

### Fixed
- **Skip button missing on mid-segment seek**: `findActiveSegment` now has +1s end grace; `seeked` event resets `activeSegmentKey` so seeking into an active segment always shows the button
- **Cloud save confirmation**: successful saves now write `skipstream_last_sync` timestamp to local storage

### Changed
- **README**: rewritten to be concise - what it does, setup, file structure only
- **Options page description**: shortened to one clear sentence

## [1.6.3] - 2026-06-04

### Fixed
- **updateSkipBadge crash**: was calling `getElementById('skipMaster')` which no longer exists in popup.html (removed when redesigned to `skipModeSelect` dropdown); badge now reads from passed `prefs` object directly
- **Per-site rules ignored in skip poll**: poll was checking `prefs[prefKey]` for auto-skip decision instead of `effectivePrefs[prefKey]`; per-site overrides now fully applied to both the master gate and the per-segment auto-skip decision
- **Native platform poller ignored per-site rules**: `startNativeBtnPoller` read `prefs.skipMaster` directly; now calls `getSitePrefs(prefs)` so domain overrides disable native button clicking correctly
- **autoNextEpisode missing from import/export**: `EXPORT_KEYS` in `options.js` was missing `autoNextEpisode`; the pref was lost on settings export/import
- **device_name missing from history fetch**: `SUPABASE_GET_ALL` select did not include `device_name`; popup history now shows which device saved each position

## [1.6.2] - 2026-06-04

### Added
- **Per-site skip rules**: override global skip mode per domain in Settings (e.g. always prompt on Crunchyroll, auto-all on Netflix); stored locally, applied in real-time without page reload
- **Dark/light theme toggle**: sun/moon icon in popup header; respects system preference on first load, persists manual override
- **Segment confidence badge**: skip button and countdown show a star/diamond badge when segment has 5+ or 10+ reports from IntroDB
- **device_name in sync payload**: upsert now includes browser name (Firefox/Edge/Chrome) so history shows which device saved each position

## [1.6.1] - 2026-06-04

### Added
- **Native platform skip buttons**: clicks the platform's own "Skip Intro/Recap/Credits" button when present (Netflix, Prime, Disney+, Hulu, Max, Crunchyroll, Peacock, Paramount+, Apple TV+, Tubi) - works without IntroDB API key
- **Auto Next Episode**: optional toggle to automatically advance to the next episode when within 10s of end; off by default

### Fixed
- `autoNextEpisode` pref added to `PREF_DEFAULTS`, `ALL_TOGGLES`, and popup init wiring
- `startNativeBtnPoller` now correctly called inside `attachVideo`
- `onNavigation` now resets `_nextEpTriggered` and clears native button poller on SPA navigation

## [1.6.0] - 2026-06-03

### Added
- **Skip countdown toast**: auto-skip now shows a 3-second countdown with Undo button instead of jumping instantly; cancels if video pauses
- **Playback speed control**: 1x / 1.25x / 1.5x / 2x selector in Settings panel; persists across pages and syncs to active video immediately
- **Watch stats panel**: new Stats tab showing in-progress titles, total watch time tracked, total segments skipped, time saved, and session count
- **"Still watching" auto-dismiss**: generic text-match observer clicks platform continue/resume overlays automatically on any site
- **Import / Export settings**: backup and restore all credentials and preferences as a JSON file from the Settings page
- **Offline upsert queue**: failed cloud saves are queued in local storage and replayed automatically when network reconnects
- **Skip mode dropdown wired**: `skipModeSelect` in popup now correctly writes to storage and content script respects it immediately

### Fixed
- **Skip mode selector was non-functional**: popup.html had been redesigned to a single dropdown but popup.js was still wiring non-existent individual toggle elements

## [1.5.9] - 2026-06-03

### Fixed
- **Version bump**: advance past tags v1.5.7 and v1.5.8; all version files aligned to 1.5.9
- **Movie embed mediaId**: `getMediaId()` now handles `/movie/{id}` and `/tv/{id}` paths correctly
- **Movie embed warn**: suppressed false-positive "Could not identify episode" on movie embed URLs
- **Manifest**: removed `data_collection_permissions` from `manifest.json` and all related assertions
- **CI**: removed SHA-pinned action refs across all workflows; pinning to named versions

## [1.5.6] - 2026-05-31

### Fixed
- **AMO pipeline resilience**: `scripts/amo-update.js` now handles HTTP 409 on both upload and version-create steps gracefully - logs a warning and exits 0 instead of crashing the GitHub Action
- **Badge race condition**: popup badge now reads directly from `browser.storage.local` before any DOM writes, eliminating the "0/3" display on fresh open
- **History item click**: entries now open in a new tab via `br.tabs.create()` and inject a pending-resume record so the content script seeks immediately on load
- **Em dash cleanup**: all em dashes and en dashes replaced with hyphens or colons across all source files and manifests

### Added
- **Throttled timeupdate sync**: content script now syncs playback position every 2.5 seconds via a throttled `timeupdate` listener (was only on pause/seek)
- **Tab-close flush**: `background.js` tracks last-known playback state per tab via `br.tabs.onRemoved` and fires a final Supabase upsert before the tab dies
- **beforeunload flush**: `flushPlaybackSync()` writes local cache and sends a best-effort background message on page unload
- **Pending-resume injection**: history click writes `skipstream_pending_resume` to `browser.storage.local`; content script on the new tab consumes it and auto-seeks + plays
- **Human-readable metadata**: `getSiteName()` and `getVideoTitle()` produce clean display strings; all cache writes and Supabase upserts include `site_name` and `video_title`
- **Supabase schema columns**: `site_name` and `video_title` columns added to `playback_states` table via idempotent `ALTER TABLE` guards in `supabase_setup.sql`
- **`SUPABASE_GET_ALL` message handler**: background exposes a bulk history fetch endpoint for the popup

### Changed
- `manifest.json` and `manifest-chrome.json` description field: em dash replaced with hyphen
- Default history source view changed to "merged" (was "local")
- History items rendered as `div` elements with click handlers (was `<a>` tags pointing to deep-link URLs directly)

---

## [1.5.5] - 2026-05-31

### Changed
- Cross-browser manifest updates and README restructure
- Chrome MV3 compatibility improvements

---

## [1.5.4] - 2026-05-31

### Fixed
- Removed `console.log`/`console.error` calls (CI enforcement)
- Dropped ES module import syntax incompatible with MV2/MV3 service workers
- `popup.js` console error cleanup


## [1.5.3] - 2026-05-30

### Fixed
- AMO submission pipeline verification and stability improvements
- Documentation layout and structure link fixes

## [1.5.2] - 2026-05-30

### Fixed
- Version bump to clear AMO 409 conflict from duplicate 1.5.1 submission

---

## [1.5.1] - 2026-05-30

### Changed (UI overhaul)
- Full popup redesign: unified design system with CSS token variables, Inter/system font, glass-morphism card, proper dark mode
- Skip Segments and Add Segment use identical "folder" chrome - collapsed header with icon, chevron, expand/collapse animation
- Skip master toggle expands child rows (Intro/Recap/Outro) inline; badge shows "N/3" active; sub-label summarises active types
- Add Segment (renamed from "Report Segment"): Start/Stop/type-select/submit flow as 3 stepped screens within the folder; matches Skip Segments styling exactly
- History panel: Source pills (Local / Cloud / Merged) let user switch data source; cloud rows show cloud badge; richer item cards with progress bar and time label
- Status row replaced with compact dot + text pill; sync status row in History panel shows cloud sync state

### Fixed
- Supabase history bug: History now fetches all rows for the user from Supabase (`playback_states`) in the popup and merges with local cache
- Merged history: cloud's `playback_time` wins if more recent than local; local provides `title` and `url` for cloud-only rows
- All SVG icons built with DOM API, no innerHTML (CI-compliant)

## [1.5.0] - 2026-05-29

### Added
- Master Skip toggle with 3 child toggles (Intro/Recap/Outro); badge shows active count
- Corrected auto-skip logic: child toggle ON = auto-skip silently; child toggle OFF = show skip-button prompt (was inverted)
- Report Segment tool with Start/Stop/type/submit flow
- History pre-load on popup init
- iframe parent URL fix via `document.referrer`
- `GET_VIDEO_TIME` and `GET_SHOW_INFO` runtime message handlers

### Removed
- OMDB fully purged from all files

## [1.4.0] - 2026-05-28

### Removed
- OMDB demo key removed
- SubDL provider removed

### Fixed
- AnimeSkip provider rewritten to correct GraphQL endpoint
- Resume prompt loop de-duplicated

### Added
- Site filter dropdown in history tab
- AnimeSkip `animeSkipClientId` and `animeSkipAuthToken` fields in Settings

## [1.3.1] - 2026-05-28

### Added
- Resume prompt overlay with auto-confirm after 12s
- OTT compatibility table in README

## [1.3.0] - 2026-05-28

### Added
- History tab in popup with searchable list and deep-links
- Multi-provider segment engine (IntroDB + AnimeSkip + SubDL in parallel)
- AnimeSkip provider
- SubDL provider
- IntroDB segment reporting
- Chrome MV3 manifest

## [1.2.0] - 2026-05-27

### Fixed
- Skip button visible in fullscreen mode
- Auto-hide timer resets on mouse movement near button
- Button positioning changed to viewport-relative %

### Added
- Add Missing Segments toggle in popup
- Real icon shown in popup header

## [1.1.0] - 2026-05-26

### Added
- Exponential backoff retry on all API calls
- Aspect ratio filtering for video detection (1.2:1 to 3:1)
- Event-driven SPA navigation (replaces 800ms polling)
- GitHub Actions CI/CD pipeline

### Removed
- 800ms location.href polling loop

## [1.0.0] - 2026-05-25

### Added
- Deterministic cross-device user ID from SHA-256 hash of Supabase anon key
- `OMDB_LOOKUP` message handler in background
- `browser_specific_settings` gecko ID in manifest
- `supabase_setup.sql` - idempotent setup script
- Live simultaneous status checks for all services on save
- Glassmorphism UI adaptive to mobile and system dark mode
- SPA navigation tracking
- `loadedmetadata` fallback for early route hydration

### Removed
- All WXT framework scaffolding
- All `console.log` (replaced with `console.warn`)
- All OpenSkip branding
