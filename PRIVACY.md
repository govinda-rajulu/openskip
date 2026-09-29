# Privacy Policy

**Last updated: September 2026**

SkipStream does not collect, sell, or share your personal data.

## What is stored and where

**Locally on your device** (`browser.storage.local`):
- API keys you enter (Supabase, IntroDB, TMDB, AnimeSkip)
- Playback positions and watch history
- Preferences and settings

**To your own Supabase project** (only if you configure it):
- Playback positions and timestamps
- Site name and video title (for history display)
- Browser name (Firefox / Edge / Chrome) - to identify which device saved a position

Nothing is ever sent to the extension developer. Two public skip databases are used without any setup (below); everything else is only contacted if you configure it.

## Third-party services

Used without setup, while skipping is on:
- **IntroDB** (api.introdb.app) - skip timestamps for TV episodes and movies. Sends only the IMDb id, plus season and episode for TV. No key, no account, nothing about you or the page. Your IntroDB key, if saved, is never sent on these reads.
- **SponsorBlock** (sponsor.ajay.app) - on YouTube only. Sends the first 4 characters of a SHA-256 hash of the video id, never the id itself, so the service cannot tell which video you watch.

Only when you configure them:
- **Your Supabase project** - for cross-device sync and settings backup
- **AnimeSkip** - for anime intro/outro data
- **TMDB** - for show identification and poster images
- **OpenSubtitles** - to fetch subtitle files when a video is identified (only if subtitle feature is used; sends IMDB ID and language preference)

Updates come from Mozilla Add-ons; the extension itself makes no update check.

Each service has its own privacy policy. SkipStream only sends the minimum data needed.

## Your sync identity

Your cloud sync ID is a random UUID generated when you first install the extension. No account is required. No email. No personal information. Each browser installation gets its own unique identity automatically.

## Contact

Open an issue at [github.com/govinda-rajulu/openskip/issues](https://github.com/govinda-rajulu/openskip/issues)
