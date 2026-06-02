# SkipStream - Privacy Policy

**Last updated: May 2026**

## Summary

SkipStream does not collect, sell, or share your personal data. All credentials you enter are stored locally on your device. Any cloud sync goes to infrastructure you personally own and control.

---

## What data SkipStream handles

### Data stored locally on your device
- Your API keys (Supabase URL, Supabase anon key, IntroDB key, TMDB key) - stored in `browser.storage.local`, never transmitted to the extension developer
- Your playback positions - cached in `browser.storage.local` for offline resume

### Data transmitted outside the browser (optional features only)

All transmission is optional. If you do not configure the relevant service, no data is sent.

| Data sent | Destination | When | Purpose |
|-----------|------------|------|---------|
| IMDb ID + season + episode number | IntroDB (introdb.app) | When a video plays | Fetch skip segment timestamps |
| TMDB show ID | TMDB (themoviedb.org) | When a TMDB ID is in the URL | Convert TMDB→IMDb ID |
| Show title (slug) | OMDB (omdbapi.com) | As a last resort for show detection | Convert title→IMDb ID |
| Derived user ID + media ID + playback position + site hostname | Your own Supabase project | Every ~10 seconds during playback | Cross-device resume sync |

**The derived user ID** is a one-way SHA-256 hash of the string `"skipstream:uid:" + your_supabase_anon_key`. It is not reversible to your identity and is never seen by the extension developer.

### What SkipStream never does
- Does not collect browsing history
- Does not track which sites you visit beyond what is needed to detect the current video
- Does not send any data to the extension developer or any analytics service
- Does not contain any advertising or tracking code
- Does not use cookies

---

## Third-party services

SkipStream integrates with third-party services that you configure. Each has its own privacy policy:

- **IntroDB** - [introdb.app](https://introdb.app) - receives show identifiers (IMDb ID, season, episode) to return skip timestamps
- **Supabase** - [supabase.com/privacy](https://supabase.com/privacy) - your own project; SkipStream only accesses the table you create
- **TMDB** - [themoviedb.org/privacy-policy](https://www.themoviedb.org/privacy-policy) - receives TMDB IDs to return IMDb IDs
- **OMDB** - [omdbapi.com](https://www.omdbapi.com) - receives show titles to return IMDb IDs (fallback only)

---

## Data retention

SkipStream does not retain any data server-side. Local cache is limited to the 100 most recently played items and can be cleared by removing the extension or clearing extension storage.

---

## Contact

This extension is open source. Source code is available at [github.com/govinda-rajulu/openskip](https://github.com/govinda-rajulu/openskip). Issues and questions can be raised there.
