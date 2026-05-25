# SkipStream

**Automatically skip intros, recaps, and outros — and resume playback across all your devices.**

A Firefox extension (Desktop & Android) that detects skip segments on any streaming site and syncs your playback position to the cloud via Supabase.

---

## Features

- **Skip intros, recaps & outros** — via [IntroDB](https://introdb.app) segment data
- **Resume playback** — picks up where you left off, across devices and browsers
- **Cloud sync** — powered by your own Supabase project (free tier works)
- **Works everywhere** — any site with an HTML5 `<video>` element
- **SPA-aware** — handles Netflix/Hulu-style single-page navigation
- **Private** — your credentials never leave your device; sync uses a deterministic anonymous ID derived from your Supabase key

---

## Quick Start (Try it now)

No build step needed. Load directly in Firefox:

1. [Download the latest release](../../releases/latest) (`.xpi` for permanent, or unzip for temporary)
2. **Temporary load** (disappears on restart):
   - Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**
   - Select `manifest.json` from the unzipped folder
3. **Permanent load** — sign it free via [Mozilla Add-on Hub](https://addons.mozilla.org/developers/) and install the `.xpi`

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
Used to convert TMDB IDs (found in streaming site URLs) to IMDb IDs for skip-segment lookup.

---

## File Structure

```
├── manifest.json              # Extension manifest (MV2, Firefox)
├── background.js              # Service worker — API calls, userId derivation
├── content-scripts/
│   └── content.js             # Video detection, skip button, playback sync
├── popup.html / popup.js      # Toolbar popup with toggles
├── options.html / options.js  # Settings page with live service checks
├── icons/                     # Extension icons (16, 48, 128px)
└── supabase_setup.sql         # One-time DB setup (idempotent, safe to re-run)
```

---

## How it works

1. **Content script** scans every page for `<video>` elements and attaches to any that look like a main player (size threshold, visibility check)
2. **Show detection** reads IMDb/TMDB IDs from the URL, JSON-LD metadata, data attributes, and page text — with a path-slug + OMDB fallback for sites that don't expose IDs
3. **Segment fetch** asks the background script to hit IntroDB's API (key stays off the page)
4. **Skip polling** runs every 500ms; shows a dismissable button or auto-skips silently based on your toggle settings
5. **Playback position** is saved to `browser.storage.local` every 10s and debounced to Supabase every 3s after a seek/pause
6. **User identity** is a SHA-256 hash of `"skipstream:uid:" + anonKey` — same key on any device = same sync identity, no account needed

---

## Browser Support

| Browser | Status |
|---------|--------|
| Firefox Desktop 91+ | ✅ Fully supported |
| Firefox Android (Nightly) | ✅ Works via custom add-on collection |
| Chrome / Edge | ⚠ Not officially supported (MV2 deprecation path differs) |

---

## Privacy

- All credentials are stored in `browser.storage.local` — local to your device
- API calls to IntroDB, TMDB, and OMDB are made from the background script, never from page context
- Supabase sync uses an anonymous ID — no email, account, or personal data required
- No telemetry, no analytics, no ads
