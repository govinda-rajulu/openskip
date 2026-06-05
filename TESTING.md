# Testing Notes for Mozilla Reviewers

## Source code

Plain JavaScript - no build step. The files in this repository are the exact files in the submitted ZIP. No transpilation or minification.

Repository: https://github.com/govinda-rajulu/openskip

## Loading the extension

1. Open `about:debugging` - **This Firefox** - **Load Temporary Add-on**
2. Select `manifest.json` from the extracted ZIP

## API keys needed for full testing

The extension is fully functional without any keys - it works as a resume-only tool. For complete feature testing:

| Feature | Key | Where to get |
|---------|-----|--------------|
| Skip segments | IntroDB API key | [introdb.app](https://introdb.app) |
| Cloud sync | Supabase URL + anon key | [supabase.com](https://supabase.com) |
| Show detection (Plex etc.) | TMDB API key | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| Anime support | AnimeSkip Client ID | [anime-skip.com](https://anime-skip.com/account/api-clients) |

Enter keys in the extension's Settings page (gear icon in popup).

## What to test

- Open any video site - extension auto-detects `<video>` elements
- Playback position saves to `browser.storage.local` on pause, seek, and page close
- Skip segments appear as a countdown toast when a segment is active
- Resume prompt appears on revisit if a position was saved

## Permissions used

- `storage` - save credentials and playback positions locally
- `tabs` - get current tab URL for show detection
- `<all_urls>` - inject content script into any video page
