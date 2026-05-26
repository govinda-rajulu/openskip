# Changelog

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
