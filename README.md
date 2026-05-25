# SkipStream

**Automatically skip intros, recaps, and outros — and resume playback across all your devices.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-pending%20review-orange?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.0.0)

A Firefox extension (Desktop & Android) that detects skip segments on any streaming site and syncs your playback position to the cloud via Supabase.

---

## Install

**From Firefox Add-ons (recommended once approved):**
👉 [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Manual install (available now):**
1. [Download the latest release ZIP](../../releases/latest)
2. Unzip it anywhere on your computer
3. Open Firefox → go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**
4. Select `manifest.json` from the unzipped folder

---

## Features

- **Skip intros, recaps & outros** — via [IntroDB](https://introdb.app) segment data
- **Resume playback** — picks up where you left off, across devices and browsers
- **Cloud sync** — powered by your own Supabase project (free tier works)
- **Works everywhere** — any site with an HTML5 `<video>` element
- **SPA-aware** — handles Netflix/Hulu-style single-page navigation
- **Private** — credentials never leave your device; sync uses a deterministic anonymous ID

---

## Setup

Click the ⚙ **Settings** button in the popup and fill in your credentials.

### Required — IntroDB (for skipping)

Get a free API key at **[introdb.app](https://introdb.app)**. Without this, the extension only does resume-playback.

### Optional — Supabase (for cloud sync across devices)

1. Create a free project at **[supabase.com](https://supabase.com)**
2. Copy your **Project URL** and **anon/public key** from:
   `Project Settings → API → Project URL & Project API Keys`
3. Paste them into SkipStream Settings → click **Save & Verify**
4. If you see a warning about a missing table, run **`supabase_setup.sql`** once:
   - Open your Supabase project → **SQL Editor** → paste the file contents → **Run**
   - Click **Save & Verify** again — the warning will clear

### Optional — TMDB (improves show detection)

Free key at **[themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)**.

---

## File Structure

```
├── manifest.json              # Extension manifest (MV2, Firefox 140+)
├── background.js              # Service worker — API calls, userId derivation
├── content-scripts/
│   └── content.js             # Video detection, skip button, playback sync
├── popup.html / popup.js      # Toolbar popup with toggles
├── options.html / options.js  # Settings page with live service checks
├── icons/                     # Extension icons (16, 48, 128px)
├── supabase_setup.sql         # One-time DB setup (idempotent, safe to re-run)
├── PRIVACY.md                 # Full privacy policy
└── TESTING.md                 # Reviewer testing instructions
```

---

## How it works

1. **Content script** scans every page for `<video>` elements and attaches to any that look like a main player
2. **Show detection** reads IMDb/TMDB IDs from the URL, JSON-LD metadata, data attributes, and page text
3. **Segment fetch** asks the background script to hit IntroDB's API (key stays off the page)
4. **Skip polling** runs every 500ms; shows a skip button or auto-skips based on your toggle settings
5. **Playback position** is saved to `browser.storage.local` every 10s and synced to Supabase every 3s after a seek/pause
6. **User identity** is a SHA-256 hash of your Supabase anon key — same key on any device = same sync identity

---

## Browser Support

| Browser | Status |
|---------|--------|
| Firefox Desktop 140+ | ✅ Fully supported |
| Firefox Android 142+ | ✅ Supported |
| Chrome / Edge | ⚠ Not officially supported |

---

## Privacy

All credentials stored locally. Nothing sent to the extension developer. No analytics, no ads.
See [PRIVACY.md](PRIVACY.md) for full details.
