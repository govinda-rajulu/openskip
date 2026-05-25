# Changelog

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
