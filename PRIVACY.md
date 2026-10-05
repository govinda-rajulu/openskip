# Privacy Policy

**Last updated: 5 October 2026 (SkipStream 1.13.0)**

SkipStream has no server. It sends nothing to its developer. To work, it sends some data to the services below. Firefox shows the same categories when you install SkipStream.

## Sent with no setup, while skipping is on

- **IntroDB** (api.introdb.app): the IMDb id of the video, and the season and episode for TV. SkipStream uses this to get intro, recap and credits times. No key and no account.
- **SkipDB** (api.skipdb.tv): the same IMDb id, season and episode, for times that IntroDB does not have. No key and no account.
- **TheIntroDB** (api.theintrodb.org): the TMDB id (or, when SkipStream does not know it, the IMDb id), the season and episode for TV, and the video length. No key and no account.
- **Logos** (each service's own website, else icons.duckduckgo.com): only when you open Settings > Accounts or Sources & help, your browser loads the site icons of the services listed there. The request names only those fixed websites, never what you watch.
- **AniSkip** (api.aniskip.com), anime only: the MyAnimeList id, the episode number and the episode length. SkipStream sends this only when it knows the MyAnimeList id. No key and no account.
- **Jikan** (api.jikan.moe), anime sites only: the anime title, with release words removed. SkipStream sends this only when the page does not show a MyAnimeList id. Jikan gives back the MyAnimeList id.
- **SponsorBlock** (sponsor.ajay.app), YouTube only: the first 4 characters of a SHA-256 hash of the video id. SponsorBlock does not get the video id, so it cannot know which video you watch.

## Sent only if you set the service up

- **Your own Supabase project** (supabase.co, cloud sync). For each video: a video id made from the page address (host, path and id parameters), the full page address, the site host and name, the video title, your position, the video length, the time, a random install id and a device name. The device name is the name you typed, or your browser's name. SkipStream sends a position at most every 20 seconds while a video plays, when you pause, and when you leave the tab. Every 5 minutes it also sends positions that did not reach the cloud. If you use settings backup, it also sends your skip preferences, per-site rules, theme and usage stats. You own this project. Nobody else can see it unless you give them its keys.
- **Supabase setup helper:** if your project does not have the SkipStream tables, Settings shows a button. The button opens the SQL editor on supabase.com with your project id and the setup script in the address. You must log in to Supabase and click Run. SkipStream does not run the script.
- **TMDB** (api.themoviedb.org, image.tmdb.org): show or movie ids and titles, to get IMDb ids and posters. With your TMDB key, SkipStream also sends an IMDb id to get the TMDB id for TheIntroDB. Your own TMDB key.
- **Anime Skip** (api.anime-skip.com): the IMDb id and season, with your own client id.
- **OpenSubtitles** (api.opensubtitles.com, opensubtitles.org): the IMDb id, season, episode and subtitle language. If a video has no id and you click "Find subtitles", SkipStream sends the cleaned title (and year). If you log in, your OpenSubtitles username and password go to OpenSubtitles only.
- **Spotify and SoundCloud** (open.spotify.com, soundcloud.com, oEmbed): the address of a saved Spotify or SoundCloud page, without its query string, to show artwork in History.
- **YouTube thumbnails** (i.ytimg.com): the YouTube video id, to show artwork in History.

## Sent when you open History in Settings

- **Site icons:** for each site in your History, Settings loads the icon (`/favicon.ico`) from that site itself. The site gets your IP address and a request for its icon, with no referrer. If a site has no icon, SkipStream shows the first letter of its name.

## Technical data you can switch off

Firefox calls the device name, the settings backup and usage stats *technical and interaction data*. It is on by default. You can switch it off when you install SkipStream. You can also switch it off later in about:addons > SkipStream > Permissions and data. When it is off, playback still syncs without the device name. Settings and stats then stay on this device.

## Kept only on this device

- API keys and logins.
- The playback cache and local history (your last 300 videos).
- Preferences, stats (unless you back them up as above), the subtitle cache and an error log. SkipStream never sends the error log.
- The "Check this page" result (frame addresses and video counts). It stays in the popup.
- The "Site report". SkipStream reads the open tab only when you click "Site report". The report lists players, stream types, frames, subtitle tracks and files, source buttons, media addresses that the page loaded or has in its scripts, and the player code that the page loaded. All addresses are cut to host and path. The report stays in the popup. SkipStream copies it only when you click Copy.

## Backup files

A backup file contains your settings, per-site rules, stats and local history. Keys and logins are in it only if you switch on "Include keys and logins". Then your passphrase encrypts them (AES-GCM). SkipStream never stores the passphrase. The install id is in the file only if you switch on "Link devices". Caches, sessions and the error log are never in the file. The file stays on your computer. SkipStream does not upload it.

## Your sync identity

The install id is a random UUID. SkipStream makes it when you install SkipStream. It is not tied to your name, email or account. Each browser has its own id and its own history until you link them. To link two browsers, export a backup with "Link devices" on. Then import it on the other browser. Both browsers then use the same id and see the same history in your Supabase project.

## Old cloud credentials

SkipStream 1.10 and older could store keys in the `creds` column of your `user_settings` table. Since 1.11 SkipStream does not read or write that column. The 1.13 setup script removes the old `ss_put_creds` function. It keeps the column, so that the script deletes no data. To clear the column, run `update public.user_settings set creds = '{}'::jsonb;` in your Supabase SQL editor.

## Deleting your data

- Settings > Data and Advanced > **Clear Cloud History** deletes your rows in your Supabase project.
- **Clear All SkipStream Data** deletes everything on this device.
- When you uninstall SkipStream, the browser removes its data.

## Third parties

Each service above has its own privacy policy. This product uses TMDB and the TMDB APIs but is not endorsed, certified or otherwise approved by TMDB. SponsorBlock data is licensed CC BY-NC-SA 4.0. SkipDB data is licensed ODbL 1.0.

## Contact

Open an issue at [github.com/govinda-rajulu/openskip/issues](https://github.com/govinda-rajulu/openskip/issues).
