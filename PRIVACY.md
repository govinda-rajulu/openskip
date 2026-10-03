# Privacy Policy

**Last updated: 3 October 2026 (SkipStream 1.11.0)**

SkipStream has no server of its own and sends nothing to its developer. To work, it sends some
data to the services listed below. Firefox shows the same categories when you install it.

## Sent without any setup, while skipping is on

- **IntroDB** (api.introdb.app): the IMDb id of what you watch, plus season and episode for TV.
  Used to look up intro, recap and credits times. No key and no account.
- **SponsorBlock** (sponsor.ajay.app), YouTube only: the first 4 characters of a SHA-256 hash of
  the video id, never the id itself, so the service cannot tell which video you watch.

## Sent only if you set the service up

- **Your own Supabase project** (cloud sync). For each video you watch: a video id built from the
  page address (host, path and id parameters), the full page address, the site host and name, the
  video title, your position, the video length, the time, a random install id, and a device name
  (the one you typed, or your browser's name). If you use settings backup: your skip preferences,
  per-site rules, theme and usage stats. You own this project; nobody else can see it unless you
  share its keys.
- **TMDB** (api.themoviedb.org, image.tmdb.org): show or movie ids and titles, to find IMDb ids
  and posters. Your own TMDB key.
- **Anime Skip** (api.anime-skip.com): the IMDb id and season, with your own client id.
- **OpenSubtitles** (api.opensubtitles.com): the IMDb id, season, episode and subtitle language.
  When a video has no id and you press "Find subtitles", the cleaned title (and year) instead.
  If you log in, your OpenSubtitles username and password go to OpenSubtitles only.
- **Spotify and SoundCloud** (oEmbed): the address of a saved Spotify or SoundCloud page, without
  its query string, to show artwork in History.
- **YouTube thumbnails** (i.ytimg.com): the YouTube video id, to show artwork in History.

## Technical data you can switch off

The device name, the settings backup and usage stats are what Firefox calls *technical and
interaction data*. It is on by default and you can switch it off at install, or later in
about:addons, SkipStream, Permissions and data. With it off, playback still syncs, without the
device name, and settings and stats stay on this device.

## Kept only on this device

API keys and logins, your playback cache and local history, preferences, stats (unless backed
up as above), the subtitle cache and an error log. The error log is never sent anywhere. The
popup's "Check this page" result (frame addresses and video counts) stays in the popup.

## Backup files

A backup file contains your settings, per-site rules, stats and local history. Keys and logins
are in it only if you switch on "Include keys and logins", and then only encrypted with your
passphrase (AES-GCM; the passphrase is never stored). The install id is in it only if you switch
on "Link devices". Caches, sessions and the error log are never in it. The file stays on your
computer; SkipStream does not upload it.

## Your sync identity

The install id is a random UUID made when SkipStream is installed. It is not tied to your name,
email or account. Each browser has its own id and keeps its own history until you link them:
export a backup with "Link devices" on and import it on the other browser. Both then use the
same id and see the same history in your Supabase project.

## Deleting your data

- Settings, Data and Advanced: **Clear Cloud History** deletes your rows in your Supabase project;
  **Clear All SkipStream Data** wipes everything on this device.
- Uninstalling SkipStream removes its data from this browser.

## Third parties

Each service above has its own privacy policy. This product uses TMDB and the TMDB APIs but is not
endorsed, certified or otherwise approved by TMDB. SponsorBlock data is licensed CC BY-NC-SA 4.0.

## Contact

Open an issue at [github.com/govinda-rajulu/openskip/issues](https://github.com/govinda-rajulu/openskip/issues)
