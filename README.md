# SkipStream

**Automatically skip intros, recaps, and outros — and resume playback across all your devices.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-pending%20review-orange?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.1-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.5.1)

A Firefox extension (Desktop & Android) that detects skip segments on any streaming site and syncs your playback position to the cloud via your own Supabase project.

---

## Install

**From Firefox Add-ons (recommended once approved):**
👉 [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Manual install (available now):**
1. [Download the latest release ZIP](../../releases/latest)
2. Open Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on**
3. Select `manifest.json` from the unzipped folder

---

## Features

- **Skip intros, recaps & outros** — powered by [IntroDB](https://introdb.app) and [AnimeSkip](https://anime-skip.com)
- **Master skip toggle** — one switch with per-type child toggles (Intro / Recap / Outro); toggle ON = auto-skip silently, toggle OFF = show a skip button prompt
- **Add Segment** — record a missing segment start/stop while watching and submit it to IntroDB and AnimeSkip in one click
- **Resume playback** — picks up where you left off, synced across all your devices
- **Cloud history** — History panel shows both local cache and Supabase cloud entries merged, with a source switcher (Local / Cloud / Merged)
- **Works everywhere** — any site with an HTML5 `<video>` element
- **SPA-aware** — handles Netflix/Hulu-style single-page navigation without polling
- **Private by design** — credentials never leave your device; your sync identity is a deterministic SHA-256 hash of your own Supabase key, not a tracked ID
- **Reliable** — exponential backoff retry on all API calls
- **Lightweight** — no frameworks, no build step, plain JavaScript

---

## Setup

Open the popup and click the **gear icon (⚙)** in the top-right corner to open Settings.

### Required — IntroDB (skip segments)

Get a free API key at **[introdb.app](https://introdb.app)**. Without this the extension only does resume-playback.

### Optional — Supabase (cloud sync & history)

1. Create a free project at **[supabase.com](https://supabase.com)**
2. Copy your **Project URL** and **anon/public key** from:
   `Project Settings → API → Project URL & Project API Keys`
3. Paste both into SkipStream Settings → **Save & Verify**
4. If you see a warning about a missing table, run **`supabase_setup.sql`** once:
   - Supabase project → **SQL Editor** → paste the file → **Run**
   - Click **Save & Verify** again — the warning will clear

Once configured, your watch history syncs to the cloud and is visible in the **History → Cloud** view.

### Optional — TMDB (improves show detection)

Free key at **[themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)**. Used to convert TMDB IDs (found in Plex URLs) to IMDb IDs for segment lookup.

### Optional — AnimeSkip (anime intros & outros)

1. Create an API client at **[anime-skip.com/account/api-clients](https://anime-skip.com/account/api-clients)**
2. Enable the **AnimeSkip** toggle in Settings and paste your **Client ID**
3. Optionally add an **Auth Token** if you want the Add Segment tool to submit timestamps to AnimeSkip

---

## Site Compatibility

| Site | Video | Show ID | Skip Segments | Resume | Notes |
|------|:-----:|:-------:|:-------------:|:------:|-------|
| Plex (app.plex.tv) | ✅ | ✅ | ✅ | ✅ | TMDB IDs in URL |
| Jellyfin | ✅ | ✅ | ✅ | ✅ | IMDb IDs in metadata |
| Emby | ✅ | ✅ | ✅ | ✅ | Same as Jellyfin |
| Crunchyroll | ✅ | ✅ | ✅ | ✅ | Anime via AnimeSkip |
| YouTube | ✅ | ✅ | ⚠ | ✅ | IntroDB coverage limited; `?t=` deep-link |
| Netflix | ⚠ | ⚠ | ⚠ | ⚠ | DRM player; detection inconsistent |
| Amazon Prime | ⚠ | ⚠ | ⚠ | ⚠ | Obfuscated player |
| Hulu | ⚠ | ⚠ | ⚠ | ⚠ | SPA nav works; segment data limited |
| HBO Max / Max | ⚠ | ⚠ | ⚠ | ⚠ | Player detection works; IDs vary |
| Disney+ | ⚠ | ❌ | ❌ | ⚠ | Heavy DRM; no IMDb IDs exposed |
| Apple TV+ | ❌ | ❌ | ❌ | ❌ | Proprietary player; no accessible metadata |

**Legend:** ✅ Works · ⚠ Partial / inconsistent · ❌ Not supported

> Best results on self-hosted platforms (Plex, Jellyfin, Emby) and Crunchyroll. DRM-heavy commercial platforms have limited support due to obfuscated players. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## How it works

1. **Video detection** — content script scans every page for `<video>` elements; only attaches to main players (≥25% viewport width, ≥20% height, aspect ratio 1.2–3.0)
2. **Show identification** — reads IMDb/TMDB IDs from the URL, JSON-LD metadata, data attributes, and page text; for embedded players also checks `document.referrer` (the parent page URL)
3. **Segment fetch** — background script queries IntroDB and AnimeSkip in parallel; IntroDB wins on conflict
4. **Skip logic** — polls every 500ms; if a segment's child toggle is **ON** → seeks past it silently; if **OFF** → shows a dismiss-able skip button
5. **Playback save** — position written to `browser.storage.local` on pause/seek/unload; synced to your Supabase project 3s later
6. **Cloud history** — History panel fetches all your `playback_states` rows from Supabase and merges with local cache; cloud entries show a ☁ badge
7. **User identity** — SHA-256 of `"skipstream:uid:" + supabaseAnonKey`; deterministic and device-independent
8. **SPA navigation** — detected via `pushState`/`replaceState` interception + `popstate`; segment cache cleared on every navigation

---

## File Structure

```
├── manifest.json              # Firefox MV2 manifest (v1.5.1)
├── manifest-chrome.json       # Chrome MV3 manifest (unofficial)
├── background.js              # Background script — all API calls, retry logic, userId derivation
├── content-scripts/
│   └── content.js             # Video detection, skip logic, resume prompt, SPA navigation
├── popup.html / popup.js      # Toolbar popup — Settings & History panels
├── options.html / options.js  # Full settings page with live service verification
├── icons/                     # Extension icons (16, 32, 48, 128px)
├── supabase_setup.sql         # One-time DB setup — idempotent, safe to re-run
├── CHANGELOG.md               # Full version history
├── CONTRIBUTING.md            # Contributing guidelines and architecture rules
├── HOW_TO_RELEASE.md          # Release process (no laptop needed)
├── PRIVACY.md                 # Full privacy policy
├── TESTING.md                 # AMO reviewer testing instructions
└── .github/workflows/         # CI/CD (validate, pr-check, release, codeql, ai-triage, ai-fix)
```

---

## Browser Support

| Browser | Status |
|---------|--------|
| Firefox Desktop 140+ | ✅ Fully supported |
| Firefox Android 142+ | ✅ Supported |
| Chrome / Edge | ⚠ Manifest provided but not officially tested |

---

## Privacy

All credentials are stored in `browser.storage.local` on your device. Nothing is sent to the extension developer. No analytics, no telemetry, no ads. Supabase sync goes directly to your own project. See [PRIVACY.md](PRIVACY.md) for full details.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, architecture rules, and what to work on.
