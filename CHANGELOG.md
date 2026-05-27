# Changelog

## [1.3.1] — 2026-05-28

### Added
- **Resume prompt** — instead of silently seeking, shows a small overlay: "Continue from 14:32?" with Resume and Start Over buttons; auto-confirms resume after 12s
- **OTT compatibility table** in README — documents tested platforms with support status


## [1.3.0] — 2026-05-28

### Added
- **History tab** in popup — searchable list of recently watched items with progress bars and deep-links back to exact timestamp (YouTube/Vimeo) or resume position (all other sites)
- **Multi-provider segment engine** — IntroDB, AnimeSkip, SubDL queried in parallel; results merged (IntroDB wins on conflict)
- **AnimeSkip provider** — automatic fallback for anime intro/outro detection via animeskip.online (no key required, toggle in Settings)
- **SubDL provider** — chapter-marker based segment detection for sites with SubDL data (optional API key)
- **IntroDB segment reporting** — when Add Missing Segments is on and no data is found, automatically reports the episode to IntroDB
- **Chrome MV3 manifest** (`manifest-chrome.json`) — Chrome-compatible manifest with service worker, host_permissions, action API
- `animeSkipEnabled` and `subDLApiKey` fields in Settings

### Changed
- `cacheWrite` now stores `url`, `title`, `site` alongside position — enables history deep-links
- `FETCH_SEGMENTS` message now uses multi-provider engine instead of IntroDB-only
- Background script header updated with MV3 service worker compatibility detection


## [1.2.0] — 2026-05-27

### Fixed
- Skip button now visible in fullscreen mode — attaches to fullscreen element, repositions on fullscreen toggle
- Auto-hide timer resets on mouse movement near button — no more disappearing while hovering
- Button positioning changed from hardcoded px to viewport-relative % (10% bottom, 3% right) for consistency across screen sizes

### Added
- **Add Missing Segments** toggle in popup — lets users report undetected intros to IntroDB
- Popup sections grouped: **Skip Segments** and **Playback** with labels
- Real icon shown in popup header instead of emoji placeholder
- Version badge updated to v1.2

### Changed
- Popup width tightened to 280px, cleaner layout
- Row labels support subtitle text (used for Add Segment description)


## [1.1.0] — 2026-05-26

### Summary
Performance and reliability improvements. Better video detection with aspect ratio filtering. Event-driven SPA navigation replaces polling. Exponential backoff retry logic for all API calls. Professional CI/CD validation pipeline.

### Added
- **Exponential backoff retry logic** — All external API calls now retry with smart delays (1s → 2s → 4s), but skip retrying on auth/not-found errors
  - Applied to IntroDB segment fetches
  - Applied to TMDB/IMDB conversions
  - Applied to OMDB title lookups
  - Applied to Supabase playback sync
- **Aspect ratio filtering for video detection** — Eliminates false positives on thumbnail carousels/recommendations
  - Main players must be 1.2:1 to 3:1 aspect ratio
  - Raised size threshold from 15%→25% width, 12%→20% height
- **Event-driven SPA navigation** — Replaces 800ms polling with instant event listeners
  - `popstate` listener for browser back/forward
  - `history.pushState/replaceState` interception for React/Vue/Next.js
- **OMDB API key configuration** — Users can supply their own OMDB key in Settings
  - Falls back to demo key if user hasn't configured one
  - Better title-to-IMDb detection
- **GitHub Actions CI/CD pipeline** — Comprehensive validation on every push/PR
  - JavaScript syntax checking (node --check)
  - manifest.json schema validation with gecko requirements
  - innerHTML security audit (DOM API enforcement)
  - console.log audit (console.warn only)
  - localStorage detection in content script
  - Automated release ZIP building and artifact upload
- **Contributing guide** — Professional contribution guidelines with architecture rules and code style expectations

### Changed
- `isMainPlayer()` logic now includes aspect ratio guard — prevents attachment to recommendation sections
- SPA navigation detection now event-driven instead of polling — more responsive and CPU-efficient
- Error handling improved across all background message handlers
- manifest.json now includes gecko `data_collection_permissions` (required for AMO submission)

### Fixed
- Fixed video detection false positives on carousel/thumbnail elements
- Fixed potential race conditions in playback save timers (already addressed in 1.0.0, verified in tests)
- Fixed CI/CD grep patterns to exclude comment lines from security checks

### Removed
- Removed 800ms location.href polling loop (replaced with proper event listeners)

---

## [1.0.0] — 2026-05-25

### Summary
First production release. Three parallel development branches merged and reconciled into a single clean codebase with full rebrand from OpenSkip → SkipStream.

### Added
- Deterministic cross-device user ID derived from SHA-256 hash of Supabase anon key — no random UUIDs, no `localStorage` dependency, works in Private Browsing
- `OMDB_LOOKUP` message handler in background — title→IMDb fallback routed through background script so API key never touches page context
- `browser_specific_settings` gecko ID in manifest — required for AMO submission and Private Window support
- `supabase_setup.sql` — fully idempotent setup script with `IF NOT EXISTS` guards on table, indexes, trigger, and all three RLS policies
- Live simultaneous status checks for all three services (Supabase, TMDB, IntroDB) on save in options page
- `needsManualSetup` Supabase warning with SQL Editor instructions when table is missing (404/400 response)
- Explicit `introdbApiKey` input field; all IntroDB calls use `x-api-key` header
- Glassmorphism UI (`backdrop-filter: blur(20px)`) adaptive to mobile screen ratios and system light/dark mode
- SPA navigation tracking — URL change resets segment cache, userId cache, and reloads prefs
- `loadedmetadata` fallback for videos with empty bounding box during early route hydration

### Changed
- `saveTimer` moved into per-video closure — prevents multi-video timer cancellation (e.g. thumbnail players cancelling main player saves)
- `segmentCache.clear()` on SPA navigation — eliminates stale episode data after back-navigation
- `persistent: false` added to background script declaration
- All verbose `console.log` removed from content script and background; `console.warn` diagnostic paths retained

### Removed
- All WXT framework scaffolding (`openskip/` folder, `dev/`, `src/` TypeScript files)
- Committed `extension.zip` binary from repository
- Stray `{icons,content-scripts}/` literal folder (bash brace-expansion artifact)
- All `OpenSkip` branding references
- Personal developer credentials and random `localStorage` UUID generation
