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
- **Your Supabase project** - for cross-device sync
- **IntroDB** - to fetch skip segment timestamps
- **AnimeSkip** - for anime intro/outro data
- **TMDB** - for show identification

Each service has its own privacy policy. SkipStream only sends the minimum data needed (episode IDs for segments, playback positions for sync).

## Your sync identity

Your cloud sync ID is a SHA-256 hash of your own Supabase anon key. No account is required. No email. No personal information.

## Contact

Open an issue at [github.com/govinda-rajulu/openskip/issues](https://github.com/govinda-rajulu/openskip/issues)
