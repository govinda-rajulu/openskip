# Privacy Policy

**Last updated: June 2026**

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

Nothing is sent to the extension developer or any third party except the services you explicitly configure.

## Third-party services

When configured, the extension communicates directly with:
- **Your Supabase project** - for cross-device sync and settings backup
- **IntroDB** - to fetch skip segment timestamps
- **AnimeSkip** - for anime intro/outro data
- **TMDB** - for show identification and poster images
- **OpenSubtitles** - to fetch subtitle files when a video is identified (only if subtitle feature is used; sends IMDB ID and language preference)
- **raw.githubusercontent.com** - to check for extension updates (Android only, no personal data sent)

Each service has its own privacy policy. SkipStream only sends the minimum data needed.

## Your sync identity

Your cloud sync ID is a SHA-256 hash of your own Supabase anon key. No account is required. No email. No personal information. If multiple people configure the same Supabase anon key, they will share the same sync identity and see each other's history - use a private Supabase project with a key you do not share.

## Contact

Open an issue at [github.com/govinda-rajulu/openskip/issues](https://github.com/govinda-rajulu/openskip/issues)
