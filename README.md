# SkipStream

**Skips intros, recaps and credits. Continues each video where you stopped.**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Active-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)
[![Chrome](https://img.shields.io/badge/Chrome-Manual%20Install-yellow?logo=googlechrome)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.13.0-green.svg)](https://github.com/govinda-rajulu/openskip/releases/tag/v1.13.0)

---

## Install

**Firefox:** [addons.mozilla.org/en-US/firefox/addon/skipstream](https://addons.mozilla.org/en-US/firefox/addon/skipstream/)

**Chrome or Edge (manual install):**

1. [Download the latest Chrome ZIP](../../releases/latest).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Switch on Developer mode.
4. Click Load unpacked and select the unzipped folder.

**Android:** use Firefox for Android (Add-ons menu).

**TV:** TV browsers do not run extensions well. Connect a laptop or a mini PC with HDMI.

---

## What SkipStream does

- **Skips** intros, recaps, credits and previews. It skips at once, or after a 3-second countdown with Undo.
- **Gets skip times** from [IntroDB](https://introdb.app), [TheIntroDB](https://theintrodb.org), [SkipDB](https://skipdb.tv), [AniSkip](https://aniskip.com) and [Anime Skip](https://anime-skip.com). It also reads chapters that the page gives its player.
- **Pushes the site's own Skip button** on Netflix, Prime Video, Disney+, Hulu, Max, Crunchyroll and more.
- **YouTube:** skips [SponsorBlock](https://sponsor.ajay.app) segments. You set each type to Auto, Ask or Off. The segments show on the progress bar, also on m.youtube.com.
- **Resumes** each video from your last position, also in embedded players. A time in the address (for example `?t=90`) has priority.
- **Subtitles** from OpenSubtitles or from your own .srt or .vtt file. You can set the colour, font (9 styles, with Netflix and Prime Video styles), weight, background, letter edge and size, with a live preview in Settings. Right-click CC to fix the timing. SkipStream keeps the timing for each show.
- **History** keeps your last 300 videos, with posters, site names and site icons. You can filter it by site and by the device that played the video last. It also has stats, per-site rules, speed control and an optional "auto next episode".
- **Backup:** one file with your settings and history. Keys are in the file only if you select this. Then your passphrase encrypts them.
- **Popup tools:** "Check this page" and "Site report" show what SkipStream finds. Use them in bug reports.
- **Theme:** light or dark, with any accent colour.

After an automatic skip or a resume, SkipStream shows no message. To get "Skipped intro, Undo" or "Continued from", switch them on in Settings > Skipping. Alt+Z always undoes the last automatic skip.

## Setup

You do not need an account or a key for skips, SponsorBlock and resume. Settings (the gear in the popup) adds these. Each one is optional.

| Service | What it adds | Get it |
|---|---|---|
| TMDB key | Posters, and ids for sites that show only a title | [themoviedb.org](https://www.themoviedb.org/settings/api) |
| Supabase project | History and settings in your own cloud | [supabase.com](https://supabase.com) |
| OpenSubtitles account | 20 subtitle downloads each day, not 5 (VIP: more) | [opensubtitles.com](https://www.opensubtitles.com) |
| Anime Skip client id | More anime skip times | [anime-skip.com](https://anime-skip.com/account/api-clients) |

**Supabase:** use the project URL and the publishable key (`sb_publishable_...`). The legacy anon key also works. Never use a secret key. Settings then shows how to run `supabase_setup.sql` one time. SkipStream cannot run SQL in your project.

Every user brings their own keys. SkipStream ships no keys for these services.

## Sources

SkipStream uses these services. Logos belong to their owners and show only where data comes from. None of them endorses SkipStream.

| | Source | What it gives | Login |
|---|---|---|---|
| <img src="https://icons.duckduckgo.com/ip3/introdb.app.ico" width="16" height="16" alt=""> | [IntroDB](https://introdb.app) | Intro, recap and credits times, by IMDb id | None (key only to send times) |
| <img src="https://icons.duckduckgo.com/ip3/theintrodb.org.ico" width="16" height="16" alt=""> | [TheIntroDB](https://theintrodb.org) | Intro, recap, credits and preview times, by TMDB or IMDb id | None (key only to send times) |
| <img src="https://icons.duckduckgo.com/ip3/skipdb.tv.ico" width="16" height="16" alt=""> | [SkipDB](https://skipdb.tv) | Intro, recap, credits and preview times ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)) | None |
| <img src="https://icons.duckduckgo.com/ip3/sponsor.ajay.app.ico" width="16" height="16" alt=""> | [SponsorBlock](https://sponsor.ajay.app) | YouTube sponsors, reminders, highlights ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)) | None |
| <img src="https://icons.duckduckgo.com/ip3/aniskip.com.ico" width="16" height="16" alt=""> | [AniSkip](https://aniskip.com) | Anime openings, endings and recaps | None |
| <img src="https://icons.duckduckgo.com/ip3/jikan.moe.ico" width="16" height="16" alt=""> | [Jikan](https://jikan.moe) | MyAnimeList ids for anime titles | None |
| <img src="https://icons.duckduckgo.com/ip3/anime-skip.com.ico" width="16" height="16" alt=""> | [Anime Skip](https://anime-skip.com) | More anime times | Optional client id |
| <img src="https://icons.duckduckgo.com/ip3/themoviedb.org.ico" width="16" height="16" alt=""> | [TMDB](https://www.themoviedb.org) | Posters, titles and ids | Optional key |
| <img src="https://icons.duckduckgo.com/ip3/opensubtitles.com.ico" width="16" height="16" alt=""> | [OpenSubtitles](https://www.opensubtitles.com) | Subtitles | Optional account |
| <img src="https://icons.duckduckgo.com/ip3/supabase.com.ico" width="16" height="16" alt=""> | [Supabase](https://supabase.com) | Cloud sync in your own project | Optional project |

This product uses TMDB and the TMDB APIs but is not endorsed, certified or otherwise approved by TMDB.

**When two sources have times for the same video:** kinds combine (the intro from one source, the credits from another). Inside one kind, one source gives all its parts, in the order of the table. Two sources are never mixed in one kind, because their times can come from different releases.

## Privacy

[PRIVACY.md](PRIVACY.md) lists each service and the data that goes to it. Your keys stay in your browser. Your history goes to your own Supabase project only if you set one up. You can switch off technical data (device name, settings backup and stats) in the Firefox add-on settings. SkipStream has no ads and no tracking.

## Files

```
manifest.json / manifest-chrome.json   Firefox MV2 / Chrome MV3 (same version)
background.js                          all network calls, skip sources, sync, page tools
content-scripts/content.js             finds the video, skips, resumes, subtitles, messages
content-scripts/probe.js               "Site report" (runs only when you press it)
popup.* / options.* / theme-engine.js  popup, Settings, shared theme
tests/                                 node --test tests/*.test.mjs (no dependencies)
knowledge/                             state, lessons, roadmap, audits, handbook
supabase_setup.sql                     one-time database setup for your own project
```

## For contributors

The code is plain JavaScript, with no build step and no dependencies. Rules for people and agents: [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Release steps: [HOW_TO_RELEASE.md](HOW_TO_RELEASE.md). Current state: [knowledge/STATE.md](knowledge/STATE.md). Writing rules for all docs: [knowledge/handbook/WRITING.md](knowledge/handbook/WRITING.md).
