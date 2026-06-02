# SkipStream - Testing Notes for Mozilla Reviewers

## Overview

SkipStream is a plain JavaScript Firefox extension with no build step. The source files in this repository are the exact files packaged in the submitted ZIP - no transpilation, minification, or code generation is involved.

## Source code

The submitted ZIP contains the complete, human-readable source. No separate source package is needed. Repository: https://github.com/govinda-rajulu/openskip

## Required API keys for full testing

SkipStream integrates with three optional third-party services. The extension is functional without any keys (the popup loads, toggles work, local resume-playback works), but testing skip segments and cloud sync requires credentials.

### IntroDB (for skip segment testing)
- Required to test intro/recap/outro skipping
- Free key available at: https://introdb.app
- Enter in: extension popup → Settings → IntroDB API Key

### Supabase (for cloud sync testing)
- Required to test cross-device resume sync
- Free project at: https://supabase.com
- After creating a project, run `supabase_setup.sql` in the project's SQL Editor once
- Enter Project URL and anon key in: extension popup → Settings → Supabase

### TMDB (optional, improves show detection)
- Free key at: https://www.themoviedb.org/settings/api
- Enter in: extension popup → Settings → TMDB API Key

## Testing skip segments (with IntroDB key)

1. Load the extension in Firefox via `about:debugging`
2. Enter your IntroDB key in Settings → Save & Verify (green dot should appear)
3. Visit any episode page on a supported streaming site (e.g. a site with IMDb IDs in the URL or JSON-LD metadata)
4. When a video plays and reaches an intro/recap segment, a "⏭ Skip Intro" button appears in the bottom-right corner
5. Clicking it seeks the video past the segment

## Testing without API keys

1. Load the extension - popup opens, toggles are visible and functional
2. All toggles (Skip Intros, Skip Recaps, Skip Outros, Resume Playback) save correctly
3. Without IntroDB key: extension loads, no skip buttons appear, console shows: `[SkipStream] IntroDB API key not set`
4. Without Supabase: local playback positions still cache and restore across page reloads

## Why `<all_urls>` permission is needed

SkipStream is a universal skip tool - it needs to work on any streaming site (Netflix, Hulu, Crunchyroll, Plex, Jellyfin, self-hosted players, etc.). A restricted host list would make it non-functional on the vast majority of sites. The content script only activates meaningful logic when it finds a `<video>` element that passes a size threshold (≥25% viewport width, ≥20% viewport height) - it ignores thumbnails, ads, and tiny preview tiles.

## Data transmission - `technicalAndInteraction` declared as optional

The extension declares `technicalAndInteraction` as an optional data collection permission. This covers:

- **IntroDB calls**: IMDb ID + season + episode number sent to `api.introdb.app` to retrieve skip timestamps
- **Supabase calls** (if configured): a derived anonymous user ID + URL-based media ID + playback position + site hostname sent to the user's own Supabase project

Nothing is sent if the user has not configured the relevant service. No data is sent to the extension developer. No analytics, no telemetry.

## Permissions justification

| Permission | Reason |
|-----------|--------|
| `storage` | `browser.storage.local` for credentials, prefs, playback cache |
| `tabs` | Report Segment tool queries the active tab's video time and show info |
| `<all_urls>` | Content script must run on all streaming sites |

No `activeTab`, `webRequest`, `history`, `cookies`, or other sensitive permissions are requested.
