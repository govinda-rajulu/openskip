# SkipStream

**Skip intros, recaps, and outros. Resume where you left off on any device.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Active-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![Chrome](https://img.shields.io/badge/Chrome-Manual%20Install-yellow?logo=googlechrome)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.7.3-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.7.3)

---

## Install

**Firefox:** [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Chrome/Edge (manual):**
1. [Download the latest ZIP](../../releases/latest)
2. Go to `chrome://extensions` → enable Developer mode → Load unpacked

---

## What it does

- **Skips** intros, recaps, and outros - 3-second countdown toast with Undo (powered by [IntroDB](https://introdb.app))
- **Native button clicking** - also clicks the platform's own Skip Intro button on Netflix, Prime, Disney+, Hulu, Max, Crunchyroll, and others
- **Resumes** playback where you left off, on any device
- **Syncs** watch history and settings to your own Supabase project - you own the data
- **Auto next episode** - advances when near end of video (optional, off by default)
- **Speed control** - 1x / 1.25x / 1.5x / 2x, persists across pages
- **Per-site rules** - override skip mode for specific domains in Settings
- **Watch stats** - segments skipped, time saved, session count tracked locally
- **Full backup/restore** - export all history, stats, credentials, and settings as JSON; import merges history
- **Android auto-update** - Firefox for Android checks for updates via `updates.json`
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
manifest.json              - Firefox MV3 manifest (authoritative version source)
manifest-chrome.json       - Chrome MV3 manifest (must match manifest.json version)
updates.json               - Firefox Android update feed
background.js              - Service worker: all API calls, retry logic, offline queue
content-scripts/
  content.js               - Injected into all frames: skip polling, resume, speed, site rules
popup.html / popup.js      - Popup: history, skip settings, stats, speed, sync, theme toggle
options.html / options.js  - Settings: credentials, per-site rules, import/export, cloud restore
scripts/
  amo-update.js            - CI: uploads signed ZIP to AMO and updates listing metadata
update_release.py          - CI helper: writes updates.json with new version
icons/                     - icon-16/32/48/128.png
supabase_setup.sql         - One-time DB schema - run in Supabase SQL editor
CHANGELOG.md               - Version history
AGENTS.md                  - AI agent reference for coding agents
docs/                      - Additional documentation
.github/workflows/         - CI/CD pipelines
```

---

## How it works

1. Content script detects any `<video>` element on the page
2. Identifies the show/episode from the URL, page metadata, or JSON-LD
3. Fetches skip segment timestamps from IntroDB; also clicks the platform's native Skip Intro button
4. Polls every 500ms - shows a 3-second countdown toast with Undo before auto-skipping
5. Saves playback position locally every 2.5s and syncs to Supabase; queues saves when offline
6. On next load, restores your position from local cache or cloud, whichever is newer
7. Stats (skips, time saved, sessions) accumulated locally and backed up to Supabase `user_settings`

---

## AI Agents

This repo has 5 AI-powered agents (OpenRouter Llama 3.3 / Gemini fallback) that work directly from GitHub issues and PRs:

| Trigger | Agent | What it does |
|---------|-------|-------------|
| Issue title starts with `sweep: ` | Sweep | Full feature implementation, opens PR |
| Add `ai-fix` label to issue | AI Fix | Bug fix, opens PR automatically |
| Comment `/ai-review` on PR | AI Review | Code review + architecture check |
| Comment `/ai-task <task>` on issue | AI Task | Arbitrary code or analysis task |
| Comment `/ai-explain` on issue | AI Explain | Explains code inline |

See [AGENTS.md](AGENTS.md) for full details and [docs/](docs/) for CI/CD documentation.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [HOW_TO_RELEASE.md](HOW_TO_RELEASE.md).
