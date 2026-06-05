# SkipStream

**Skip intros, recaps, and outros. Resume where you left off on any device.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Active-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.6.6-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.6.6)

---

## Install

**Firefox:** [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Chrome/Edge (manual):**
1. [Download the latest ZIP](../../releases/latest)
2. Go to `chrome://extensions` - enable Developer mode - Load unpacked

---

## What it does

- **Skips** intros, recaps, and outros automatically (powered by [IntroDB](https://introdb.app))
- **Resumes** playback where you left off, on any device
- **Syncs** watch history to your own Supabase project - you own the data
- **Native button clicking** - also clicks the platform's own Skip Intro button on Netflix, Prime, Disney+, and others
- **Auto next episode** - advances to the next episode when near the end (optional)
- **Speed control** - 1x / 1.25x / 1.5x / 2x, persists across pages
- **Per-site rules** - override skip mode for specific domains
- **Works on any site** with a standard HTML5 video element

---

## Setup

Click the **gear icon** in the popup to open Settings.

### Skip segments (IntroDB)
Get a free key at [introdb.app](https://introdb.app). Without it, the extension works as a resume-only tool.

### Cloud sync (Supabase)
Create a free project at [supabase.com](https://supabase.com), run the SQL from `supabase_setup.sql` in your project's SQL editor, then paste your Project URL and anon key into Settings.

---

## Privacy

- All credentials are stored locally in your browser
- Your sync identity is a SHA-256 hash of your own Supabase key - no account required
- No telemetry, no ads, no third-party tracking

---

## File Structure

```
manifest.json              - Firefox MV2 manifest (authoritative version source)
manifest-chrome.json       - Chrome MV3 manifest (must match manifest.json version)
background.js              - Service worker: API calls, retry logic, user ID derivation
content-scripts/
  content.js               - Injected into all frames: video detection, skip polling, resume, sync
popup.html / popup.js      - Extension popup: history, skip settings, segment reporting
options.html / options.js  - Settings page: credentials, per-site rules, import/export
scripts/
  amo-update.js            - CI: uploads signed ZIP to AMO
icons/                     - icon-16/32/48/128.png
supabase_setup.sql         - One-time DB schema (run once in Supabase SQL editor)
CHANGELOG.md               - Version history
AGENTS.md                  - AI agent reference
docs/                      - Additional documentation
.github/workflows/         - CI/CD pipelines
```

---

## How it works

1. Content script detects any `<video>` element on the page
2. Identifies the show/episode from the URL, page metadata, or JSON-LD
3. Fetches skip segment timestamps from IntroDB
4. Polls every 500ms during playback - shows a countdown toast before auto-skipping
5. Also clicks the platform's native Skip Intro button when present
6. Saves playback position locally and syncs to your Supabase project every few seconds
7. On next load, restores your position from local cache or cloud

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [HOW_TO_RELEASE.md](HOW_TO_RELEASE.md).
