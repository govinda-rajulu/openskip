# Testing Notes for Mozilla Reviewers

## Source code

Plain JavaScript - no build step. The files in this repository are the exact files in the submitted ZIP. No transpilation or minification.

Repository: https://github.com/govinda-rajulu/openskip

## Loading the extension

1. Open `about:debugging` - **This Firefox** - **Load Temporary Add-on**
2. Select `manifest.json` from the extracted ZIP

## API keys needed for full testing

You do not need a key to test skipping or resume. IntroDB, TheIntroDB, SkipDB, AniSkip and SponsorBlock work without keys. Optional keys:

| Feature | Key | Where to get |
|---------|-----|--------------|
| Cloud sync | Supabase URL + publishable key (or legacy anon key) | [supabase.com](https://supabase.com) |
| Show detection (Plex etc.) | TMDB API key | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| Anime support | AnimeSkip Client ID | [anime-skip.com](https://anime-skip.com/account/api-clients) |

Enter keys in the extension's Settings page (gear icon in popup).

## What to test

- Open any video site - extension auto-detects `<video>` elements
- Playback position saves to `browser.storage.local` on pause, seek, and page close
- In auto mode, segments are skipped instantly. In prompt mode, a 3-second countdown toast appears with an Undo button
- Playback silently resumes from saved position with a brief toast notification
- Speed control (0.75x to 2x) applies to the active video and persists on reload
- Skip mode dropdown (Off / Prompt / Auto Intro / Auto Recap / Auto Outro / Auto All)
- Per-site rules in Settings override the global skip mode for specific domains
- Popup: Status (switch, today's skips and time saved), Playback (skip mode, speed, subtitles, accent), Tools (Check this page, Site report)
- YouTube with SponsorBlock data: marks on the progress bar (desktop and m.youtube.com). Sponsors are skipped with no message.
- Settings > Skipping: switch on "Skipped, Undo" to see a message after each automatic skip. Alt+Z undoes the last automatic skip.
- Resume from History: click a video in History. It continues from the saved position, also when the player starts by itself.
- Settings > Subtitles: letter edge (Outline, Drop shadow, Raised, None).
- Settings > Cloud: with an empty Supabase project, a setup helper opens the SQL editor with the setup script.
- Popup > Tools > Site report: lists frames, players, source buttons, loaded media and subtitle files.
- Sync button in history panel pushes local positions to Supabase and refreshes list
- Export All downloads one JSON file: settings, rules, stats, history; keys only if you turn that on (encrypted with a passphrase)
- Import & Merge restores from export - merges history (newer wins), combines session counts
- Settings page shows a restore prompt when local settings are empty or cloud is newer
- Theme toggle (sun/moon icon) switches dark/light and persists across opens

## Permissions used

- `storage` - save credentials and playback positions locally
- `tabs` - read the current tab's address and title (show detection, embedded players, page tools)
- `<all_urls>` - inject content script into any video page

## Automated tests

`node --test tests/*.test.mjs` (Node 22+, no install). The release ZIP is checked with Mozilla's addons-linter in CI.
