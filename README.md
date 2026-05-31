# SkipStream

**Automatically skip intros, recaps, and outros — and resume playback across all your devices.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Active-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.6-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.5.6)

A cross-browser extension (Firefox MV2 & Chrome MV3 architecture) that detects skip segments on any streaming site and syncs your playback position to the cloud via your own Supabase project.

---

## Install

**From Firefox Add-ons (recommended once approved):**
👉 [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Manual install (available now):**
1. [Download the latest release ZIP](../../releases/latest)
2. Open your browser extension management terminal:
   - **Firefox:** Navigate to `about:debugging` → **This Firefox** → **Load Temporary Add-on** and select `manifest.json`.
   - **Chrome/Edge:** Navigate to `chrome://extensions` → enable **Developer mode** → click **Load unpacked** and select the extension folder.

---

## Features

- **Skip intros, recaps & outros** — powered by [IntroDB](https://introdb.app) and [AnimeSkip](https://anime-skip.com)
- **Master skip toggle** — one switch with per-type child toggles (Intro / Recap / Outro); toggle ON = auto-skip silently, toggle OFF = show an interactive skip button prompt overlay
- **Add Segment** — record a missing segment start/stop while watching and submit it to IntroDB and AnimeSkip in one click
- **Resume playback** — picks up where you left off, securely synced across all your devices with robust tab-close persistence
- **Cloud history** — History panel shows both local cache and Supabase cloud entries merged seamlessly, with a built-in source filter switcher (Local / Cloud / Both)
- **Rich Metadata tracking** — captures human-readable Site Names and Video Titles in your logs for intuitive history reference
- **Works everywhere** — any site running a standard HTML5 `<video>` element
- **SPA-aware** — handles Netflix/Hulu-style single-page navigation dynamically without performance-draining polling loops
- **Private by design** — credentials never leave your device; your sync identity is a deterministic, secure SHA-256 hash of your own Supabase credentials
- **Reliable** — exponential backoff retry on all external API requests
- **Lightweight** — no bloated frameworks, zero external build steps, running pure, high-performance vanilla JavaScript

---

## Setup

Open the popup and click the **gear icon (⚙)** in the top-right corner to open Settings.

### Required — IntroDB (skip segments)

Get a free API key at **[introdb.app](https://introdb.app)**. Without this configuration, the extension operates purely as a cross-device resume-playback tool.

### Optional — Supabase (cloud sync & history)

1. Create a free database project at **[supabase.com](https://supabase.com)**
2. Copy your **Project URL** and **anon/public key** from:
   `Project Settings → API → Project URL & Project API Keys`
3. Paste both tokens into SkipStream Settings → **Save & Verify**
4. Run the database migration script **`supabase_setup.sql`** once inside your dashboard:
   - Supabase project → **SQL Editor** → paste the setup script → **Run**
   - Click **Save & Verify** inside the extension again — the configuration warning will clear instantly

Once configured, your watch log history syncs instantly to the cloud and is fully accessible via the **History** tab using the view filters.

### Optional — TMDB (improves show detection)

Get a free developer key at **[themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)**. Used to convert localized TMDB IDs (frequently found in Plex metadata parameters) into universal IMDb IDs for precise segment lookup.

### Optional — AnimeSkip (anime intros & outros)

1. Create an API client profile at **[anime-skip.com/account/api-clients](https://anime-skip.com/account/api-clients)**
2. Enable the **AnimeSkip** engine inside Settings and paste your personal **Client ID**
3. Optionally add an **Auth Token** if you want the native Add Segment tool to submit your discovered timestamps directly to the AnimeSkip public ecosystem

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
| Amazon Prime | ⚠ | ⚠ | ⚠ | ⚠ | Obfuscated player structure |
| Hulu | ⚠ | ⚠ | ⚠ | ⚠ | SPA navigation works; segment data limited |
| HBO Max / Max | ⚠ | ⚠ | ⚠ | ⚠ | Player detection works; IDs vary |
| Disney+ | ⚠ | ❌ | ❌ | ⚠ | Heavy DRM layer; no IMDb IDs exposed |
| Apple TV+ | ❌ | ❌ | ❌ | ❌ | Proprietary player; no accessible metadata |
| Peacock | ⚠ | ⚠ | ⚠ | ⚠ | Player detection works; segment data limited |
| Paramount+ | ⚠ | ⚠ | ⚠ | ⚠ | Player detection works; segment data limited |
| Tubi | ✅ | ⚠ | ⚠ | ✅ | Resume works well; skip segments limited |
| Vimeo | ✅ | ✅ | ⚠ | ✅ | Video ID from URL; IntroDB coverage limited |

**Legend:** ✅ Works · ⚠ Partial / inconsistent · ❌ Not supported

> Best results on self-hosted platforms (Plex, Jellyfin, Emby) and Crunchyroll. DRM-heavy commercial platforms have limited support due to obfuscated players. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## How it works

1. **Video detection** — Content script scans every page context for standard HTML5 `<video>` elements; only attaches hooks to primary active media players (validated via viewport dimensions and standard aspect ratios).
2. **Show identification** — Parses true IMDb/TMDB identification parameters directly from page navigation patterns, JSON-LD structure metadata configurations, or local document state. For embedded video layers, the frame logic interrogates `document.referrer` combined with parent frame window location parameters to capture true parent identification details.
3. **Segment fetch** — Background service worker queries IntroDB and AnimeSkip endpoints in parallel channels, resolving structural conflicts cleanly in favor of the primary IntroDB layer.
4. **Skip logic** — Tracks state hooks on targeted video intervals. If a specific segment toggle state evaluates to **ON**, the media player skips past the bounds instantly and silently. If evaluated to **OFF**, the extension injects a clean interactive button overlay prompt allowing manual skips.
5. **Playback synchronization** — Current player timestamps are throttled and synced locally. Upon active tab close, `beforeunload` events or background worker `chrome.tabs.onRemoved` listeners force an immediate unthrottled state update directly into both browser storage and the Supabase cloud ledger.
6. **Cloud history assembly** — Popup components retrieve active log tables straight from your Supabase endpoint and merge rows with local configuration sets, applying an isolated cloud badge (☁) to elements originating from remote sync channels.
7. **User identity derivation** — Generates a deterministic, anonymized hash of your database keys using a custom SHA-256 protocol. Your identities remain strictly private and device-independent without cross-site tracker fingerprints.
8. **SPA navigation management** — Overrides and monitors `pushState`/`replaceState` routines along with standard browser navigation cycles to instantly swap configuration caches upon seamless single-page application tab transitions.

---

## File Structure

├── manifest.json              # Main manifest configuration layer (v1.5.3)
├── background.js              # Service Worker / Background framework engine (API routing, retry management, lifecycle sync)
├── content-scripts/
│   └── content.js             # Content execution script (throttled monitoring, sync flushes, injection overlay prompts)
├── popup.html / popup.js      # Main toolbar popup component interface (History management, UI state filters, configuration badges)
├── options.html / options.js  # Dedicated options dashboard providing detailed credential verification tools
├── scripts/
│   └── amo-update.js          # Hardened CI automated store engine featuring Try-Catch data safety nets
├── icons/                     # Standard asset collection (16px, 32px, 48px, 128px)
├── supabase_setup.sql         # Idempotent database schema migration script updating title tracking parameters
├── CHANGELOG.md               # Version control milestone history tracking logs
├── CONTRIBUTING.md            # Structural architectural parameters and development boundary constraints
├── PRIVACY.md                 # Project end-user privacy guidelines
└── .github/workflows/         # Continuous Integration configurations (Automated store publishing pipeline)


---

## Browser Support

| Browser | Status |
|---------|--------|
| Firefox Desktop 140+ | ✅ Fully supported |
| Firefox Android 142+ | ✅ Supported |
| Chrome / Edge | ⚠ Manifest provided; compatible with Chromium MV3 environments |

---

## Privacy

All active configuration profiles and security credentials are stored locally inside `browser.storage.local` directly on your physical hardware. Absolute zero data payloads are passed back to the extension developer. Your structural database synchronization coordinates run directly into your private Supabase architecture. Review [PRIVACY.md](PRIVACY.md) for thorough technical reviews.
