# SkipStream

**Skip intros, recaps, and outros. Resume where you left off.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Active-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![Chrome](https://img.shields.io/badge/Chrome-Manual%20Install-yellow?logo=googlechrome)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.12.0-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.12.0)

---

## Install

**Firefox:** [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Chrome/Edge (manual):**
1. [Download the latest Chrome ZIP](../../releases/latest)
2. `chrome://extensions` (or `edge://extensions`), turn on Developer mode, Load unpacked

**Android:** Firefox for Android (add-ons menu). **TV:** no TV browser runs extensions well; use a laptop or mini PC over HDMI.

---

## What it does

- **Skips** intros, recaps, credits and previews: instantly, or with a 3-second countdown and Undo. Times from [IntroDB](https://introdb.app), [SkipDB](https://skipdb.tv) and [Anime Skip](https://anime-skip.com); also clicks the site's own Skip button (Netflix, Prime Video, Disney+, Hulu, Max, Crunchyroll and more)
- **YouTube:** every [SponsorBlock](https://sponsor.ajay.app) kind (sponsors, self-promo, reminders, filler, non-music, highlight), each set to Auto, Ask or Off; marks on the progress bar
- **Resumes** where you left off, also inside embedded players on movie sites
- **Subtitles** from OpenSubtitles (by id, or by title from the popup) or your own .srt/.vtt: drag to move, right-click CC to fix timing (kept per show), colour, font and background in Settings
- **History** with posters, **stats**, **per-site rules**, **speed** control, **auto next episode**, "Are you still watching?" dismissed for you
- **Backup** of everything in one file (keys optional, encrypted with your passphrase) and **Link devices**
- **Popup tools:** "Check this page" and "Site report" show what SkipStream sees, for bug reports
- **Theme:** light or dark, any accent colour (OKLCH palette)

## Setup

Nothing is required: skipping, SponsorBlock and resume work out of the box. Settings (gear in the popup) adds, each optional:

| Service | What it adds | Get it |
|---|---|---|
| TMDB key | posters, ids for sites that only show titles | [themoviedb.org](https://www.themoviedb.org/settings/api) |
| Supabase project | history and settings in your own cloud; run `supabase_setup.sql` once | [supabase.com](https://supabase.com) |
| OpenSubtitles account | 200 subtitle downloads a day instead of 5 | [opensubtitles.com](https://www.opensubtitles.com) |
| Anime Skip client id | anime times | [anime-skip.com](https://anime-skip.com/account/api-clients) |

Every user brings their own keys; SkipStream ships none of yours.

## Privacy

Full list of what is sent where: [PRIVACY.md](PRIVACY.md). In short: keys stay in your browser, history goes only to your own Supabase if you set one up, and technical data (device name, settings backup, stats) can be switched off in Firefox's add-on settings. No ads, no tracking.

## Files

```
manifest.json / manifest-chrome.json   Firefox MV2 / Chrome MV3 (same version)
background.js                          all network calls, providers, sync, page tools
content-scripts/content.js             finds the video, skips, resumes, subtitles, toasts
content-scripts/probe.js               "Site report" (runs only when you press it)
popup.* / options.* / theme-engine.js  popup, Settings, shared theme
tests/                                 node --test tests/*.test.mjs (no dependencies)
knowledge/                             state, lessons, roadmap, audits, handbook
supabase_setup.sql                     one-time database setup for your own project
```

## For contributors

Plain JavaScript, no build step, no dependencies. Rules for people and agents: [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), release steps: [HOW_TO_RELEASE.md](HOW_TO_RELEASE.md), current state: [knowledge/STATE.md](knowledge/STATE.md). The GitHub agents (`sweep:`, `ai-fix`, `/ai-review`, `/ai-task`, `/ai-explain`) are described in AGENTS.md.
