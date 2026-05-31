# Changelog

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
