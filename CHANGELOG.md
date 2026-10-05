# Changelog

## [1.13.0] - 2026-10-05
### Fixed
- Player frames (embedded players such as 1Shows / viduki.net) stopped their start-up early since 1.11. They started only when a video began to play, and "Check this page" said "did not finish starting". A video that already played when the page loaded got no skips and no resume. Now every frame with a video starts at once
- TheIntroDB gave no skip times: SkipStream asked API v1, which no longer answers. Now it asks v3, also by IMDb id when no TMDB id is known. An intro with no start (it starts at 0:00) is kept, and every part of a kind is kept (two recaps, credits with a scene between)
- Resume from History worked 2 or 3 times, then started from 0. SkipStream gave up when the player started by itself. Then the start-up position replaced the saved position. Now SkipStream waits for the player, checks the position twice and seeks again (up to 4 times). Saving waits until the position holds (at most 15 seconds)
- A time in the address (?t=90, start=, time_continue=) now has priority over resume
- A History click is now kept for 120 seconds (was 30), for slow phones
- Cloud sync: a video that kept playing never reached the cloud until you paused it. Now SkipStream sends the position at most every 20 seconds, at once when you pause or leave the tab, and every 5 minutes from the background
- YouTube: during an ad, SkipStream does not save, skip, resume or draw marks
- YouTube: marks now show on the m.youtube.com progress bar, never on hover previews, and come back when YouTube rebuilds its controls
- SponsorBlock: only YouTube rows, and rows made for a different video length (more than 3 seconds off) are not used
- Supabase: new publishable keys (sb_publishable_...) are sent only as apikey, as Supabase requires. Legacy anon keys still work
- Settings could not read its own setup script (security policy). It now can
- A player address with "&tmdb=1" read the flag as TMDB id 1
- The AMO listing kept its old text: the update sent categories in the old format. The listing text is new and matches the code
- OpenSubtitles: Settings said "up to 200 a day". OpenSubtitles gives 5 a day without an account and 20 with a free account. After login, Settings now shows the allowance, and after each download the number left
- "Check this page" listed only the top page on sites with player frames. Its listener was the last line of the script, so a frame whose start-up stopped early never answered. It now answers first and says when start-up did not finish
- History showed m.youtube.com and youtube.com (and www. or m. copies of any site) as different sites. Hosts are now saved without www., m. or mobile., History merges the copies, and resume still finds positions saved under the old address
### Added
- New skip sources: TheIntroDB (by TMDB id) and AniSkip (anime, by MyAnimeList id). Jikan finds the MyAnimeList id from the title on anime sites. Chapters that the page gives its player are used when no source answers
- Player addresses such as ?video_id=1399&tmdb=1&s=1&e=2, /movie/tmdb/603 and /tv/1399-1-2 give the TMDB id, season and episode
- Titles: release words (1080p, WEB-DL, Eng Sub, Dubbed), brackets and emoji are removed. Up to 3 names from the page are tried. A poster is used only when the name is close and the year is within 1
- "Skipped intro, Undo" after automatic skips is now off by default (Settings > Skipping). Alt+Z undoes the last automatic skip for 30 seconds, else goes back 15 seconds
- Subtitles: letter edge (Outline, Drop shadow, Raised, None)
- Supabase setup helper: when the tables are missing, Settings opens your project's SQL editor with the script filled in, copies it, and checks again
- Site report: source and server buttons, media that the page loaded or has in its scripts, lazy frames, subtitle files and (Firefox) the player code that the page loaded. At most 30 of each, host and path only
- Local history now keeps 300 videos (was 100)
- History: popular sites by name (YouTube, Netflix, JioHotstar, SonyLIV, ZEE5 and more) with each site's own icon. A device filter shows what each device played last
- Subtitles: 4 more fonts (Rounded, Casual, Condensed, Small capitals), Bold or Regular weight, Depressed and Soft glow edges, Orange and Pink, and a live preview in Settings
- "Continued from" after a resume is now off by default (Settings > Skipping), like the skip notice
- Subtitles: "Netflix style" and "Prime Video style". They use Netflix Sans or Amazon Ember only if your device has them (SkipStream cannot include those fonts)
- CC button: a Settings switch to hide it. It shows only while its video is on the page. In full screen it hides after 5 seconds without mouse, touch or keys. On a normal page you can drag it, and SkipStream keeps the spot
- OpenSubtitles: SkipStream downloads without your account first. Your account's downloads are used only when that is refused
- Site report: each frame also shows what SkipStream sees there, and the video position
- Site report: long random parts of addresses (often tokens) show as <id>. YouTube trailer embeds are no longer listed
### Changed
- Settings in 5S order. Features: every switch, skip mode, YouTube kinds and per-site rules. Customise: subtitle look and accent colour (the accent moved here from the popup). Accounts: every login and key, each marked optional, and what needs a login (nothing does). Data: export, import and clear. Sources & help: each source with its logo, link, what it gives and its licence, keyboard shortcuts. Old links (#connections, #siterules, #dataadvanced) still open the right page
- Skip sources: kinds combine across sources (the intro from one, the credits from another). Inside one kind, one source gives all its parts, in this order: IntroDB, TheIntroDB, SkipDB, AniSkip, Anime Skip. Two sources are never mixed in one kind, because their times can come from different releases
- Check this page and Site report show each skip with its times and its source, for example "intro 0:00-0:40 (TheIntroDB)"
- Skip mode: a fresh install showed "Auto all" while outros only asked first (the default), so picking "Auto all" changed nothing. The popup and Settings now show the mode the player really uses. New mode "Intros + recaps" (outros ask first) is the default
- Popup footer: a Sources link
- A site on a new address (1shows.cx to 1shows.to) stays the same site: per-site rules still apply, History shows one site in the filter, and resume finds the position saved on the old address. Pages with ids in the address (/movie/603, /tv/1396) already kept their position
- Skip marks on other sites now go inside the player's own progress bar (video.js, Vidstack, Plyr, JW Player, Shaka, DPlayer, ArtPlayer, MediaElement, Fluid, Clappr), like on YouTube. Without a known bar, the thin strip along the bottom of the video stays
- Accounts: each service card shows its logo, from the service's own website first
- supabase_setup.sql no longer makes ss_put_creds (unused since 1.11) and removes it from old projects. The old creds column stays. PRIVACY.md says how to clear it
- README, PRIVACY, TESTING and the store text are rewritten in plain, short sentences (knowledge/handbook/WRITING.md)

## [1.12.0] - 2026-10-03
### Added
- Popup "Site report": what every frame of the page holds (players such as JW Player or Video.js, stream type, video size and length, subtitle tracks, frames, ids), including frames SkipStream does not run in. Shown in the popup, copied only when you press Copy; addresses are cut to host and path
- YouTube: every SponsorBlock kind (sponsor, self-promotion, reminders, previews, non-music, filler, highlight), each set to Auto, Ask or Off in Settings > Per-Site Rules. Sponsors and self-promotion keep following the Intros switch until you set them
- "Mute" segments are muted instead of skipped; a video's highlight is offered as "Jump to highlight" in the first minute
- Skips shown on the timeline: inside YouTube's progress bar, and as a thin strip along the video on other sites while the mouse moves (Settings switch)
- SkipDB as a second source of intro, recap, credits and preview times when IntroDB has none (no key; ODbL, credited in Settings)
- Subtitle colour, font, background and outline in Settings; the sync offset (right-click CC) is remembered per film or show
- Fresh look: the popup has Status, Playback and Tools tabs, big stat tiles and cards; Settings uses the system font, rounder cards and fits phones without sideways scrolling; 44 px touch targets and visible focus rings everywhere
- On-video messages (skip button, countdown, Skipped/Undo, resume) share one position above the player controls, respect the phone's safe area, never run off small screens, and stop animating when the system asks for less motion
- Easter eggs: click the version badge five times; try the Konami code; a short note at 100, 500, 1000 and more skips

### Fixed
- Anime Skip never returned times: the query asked for a field the API does not have, and sections had no end. Sections now end where the next starts, and "Credits" counts as the outro
- A highlight offer could hold back a sponsor skip that started during it
- README and testing notes said skipping needs an IntroDB key (it has not since 1.11) and that nothing is sent anywhere; both now match PRIVACY.md
- Popup footer: links to GitHub, the privacy policy and bug reports

## [1.11.0] - 2026-10-03
### Privacy
- Firefox now shows exactly what SkipStream sends: browsing activity, website content and login details (OpenSubtitles) are required; technical data (device name, settings backup, stats) is optional and can be switched off in about:addons, after which none of it is sent
- PRIVACY.md lists every service and every field sent; the Stats page no longer claims stats are never uploaded
- Settings has a Credits card with the TMDB notice, the SponsorBlock licence and a privacy policy link
- Cross-device resume never worked since 1.9.x: every browser had its own sync id. Link browsers with a backup (below); README says so

### Added
- Backup restores the whole extension: settings, per-site rules, stats and history (merged, newer wins), and if you choose, your keys and logins (encrypted with a passphrase) and your sync identity ("Link devices")
- After an automatic skip, a "Skipped intro" notice with Undo
- Popup "Check this page" lists every frame and the videos SkipStream can see, and for the player: what it identified, which skips were found, the skip mode, the last skip (and whether its notice showed or was undone) and the subtitle state
- Sites with no ids at all (title only): with your TMDB key, an exact title match finds the film or show, so skips and subtitles work there too. Same-name works with nothing to tell them apart are left alone
- "Find subtitles" searches OpenSubtitles by title when a video has no id (on YouTube it says why it cannot)

### Fixed
- Online subtitles never downloaded ("NetworkError"): the file comes from www.opensubtitles.com, which the extension's own security policy blocked. All OpenSubtitles hosts are now allowed
- Embedded players (movie sites with several sources) were only found if the video appeared within 5 seconds; now any time, also when the player hides the video inside its own component
- Embedded players saved history with the site's home page as the address and the player's own title ("Player"), so Resume from history opened the home page. They now use the tab's real address and title, and read ids and season/episode from it
- Titles: only the site name and streaming filler ("Watch", "Online Free", "HD") are removed; a title with its own dash ("Spider-Man - Into the Spider-Verse") is kept whole
- Addresses such as /movies/603-the-matrix, /embed/tv/1399/1/2 and ?tmdb=603 are understood; a site's own number that is a different work on TMDB is refused
- A movie page could become an episode because of "Season 1 Episode 1" text in a sidebar; a show page without an episode was looked up as a movie
- History artwork: a known TMDB id is used directly, an exact title match beats the first search hit, film titles search films first, and portrait posters fit the slot (old cached artwork is fetched again)
- Automatic skips started up to 2 seconds before the segment; they now wait for its start
- After YouTube moved to the next video, sponsor segments were looked up 1.5 seconds late
- Any site's ?v= address was treated as a YouTube video
- Alt+Z did nothing on macOS
- Pages with no plain video (YouTube home, store grids) were searched for hidden players on every change; now at most every 2 seconds
- The Intros skip mode now says it also skips YouTube sponsors (it always did)
- Undo during a skip countdown started a new countdown half a second later
- Import replaced this browser's history and site rules with the backup's; it now merges them
- Export no longer copies caches (subtitle text, TMDB lookups) into the backup file
- Chrome build: the 30-second keepalive alarm is gone; Edge on Android is labelled Edge
- YouTube detection matched any host containing "youtube.com"; it now needs the real host or a subdomain
- Code scanning clean-up: dead skip-selector list and relay guard removed, changelog version escaped fully, CI can no longer apply SQL to the live Supabase project
- Skipping stopped working after the first video when a site reused its player (YouTube next, autoplay next episode)
- YouTube sponsor skipping never ran: SponsorBlock was only asked when an IMDb episode was found, which YouTube never has
- IntroDB skips needed an API key even though IntroDB reads are public; they now work with no setup
- Alt+Right (skip this segment) threw an error and did nothing
- A per-site rule was ignored on the first video of every page, and never matched inside embedded players or when saved with www.
- The skip button from embedded players never reached the main page, so it could be drawn inside the tiny player frame
- Pausing after a countdown finished could fire the countdown a second time
- History entries pulled from the cloud linked to an id instead of the page
- A TMDB v3 key broke IMDb lookups, a v4 token broke posters; both key types now work everywhere
- A missing or rejected TMDB key was cached as "no result" forever, so adding a key later changed nothing
- Movie pages were looked up as TV shows on TMDB
- Settings page buttons could do nothing on Firefox: every call to the background now uses the promise form
- Popup "Load .srt" could never work on Firefox (the popup closes when a file picker opens); replaced by "Find subtitles for this video", which says why when nothing is found. Your own file: click CC on the video
- The saved OpenSubtitles account stopped being used after 23 hours; it now logs in again by itself
- Subtitle cache could grow without limit; now about 2 MB, oldest out first, and eviction really is oldest first
- Two errors logged at the same moment lost one; two skips or saves at the same moment lost one
- Resume could jump to an older position from the cloud; stale seeks after changing video are dropped
- A skip click could hit the wrong button when the master switch was off
- Import accepted values of the wrong type, and replaced your stats instead of keeping the larger numbers
- Spotify/SoundCloud artwork lookups sent full page URLs with query strings

### Added
- Movie end-credits skipping from IntroDB (post-credit scenes are never skipped)
- Automated tests (node --test tests/*.test.mjs) and a Tests workflow
- Subtitle text-size slider in Settings (replaces the position slider: drag the subtitles on the video instead)

## [1.10.0] - 2026-08-04
### Fixed
- Settings page ignored your accent colour and stayed locked to green
- Settings page did not repaint when you changed the theme from the popup
- Slide-out menu on narrow windows and phones was see-through
- Error, warning and success text was hard to read on the settings page in dark mode
- Code snippets and the delete-button hover state lost their dark styling
- YouTube entries in the settings History list showed no thumbnail
- Background cleanup ran on a schedule Chrome silently ignored

### Changed
- Settings page rebuilt on the same five text sizes, corner radii and font stack as the popup
- Navigation icons are a single size at full strength instead of small and faded
- Cards use a tighter corner radius so the page reads as one system
- Removed the overshoot animation curve, so both surfaces now move identically
- Setup instructions say "settings icon" instead of "gear icon", which it has not been for two versions

### Removed
- The unused scripting permission is gone from the Firefox build

## [1.9.9] - 2026-08-02
### Fixed
- Popup opened as a thin sliver on desktop Firefox
- Off mode did not actually stop SkipStream from offering to skip
- Tab underline stayed under Status when you switched to Settings
- Choosing an accent colour forced the popup into dark mode
- Changing the theme could reset your accent colour back to green
- Settings page did not follow theme changes until you reloaded it
- Settings button was drawn as a second sun icon, same as the theme button
- Clicking a history entry opened the video from the start instead of resuming
- Closing a tab that never played video threw in the background script and skipped the final sync
- Cloud-to-local history sync never capped the local cache
- Stored site names kept a www. prefix that did not match your per-site rules
### Added
- YouTube history entries now show real video thumbnails
### Changed
- History thumbnails are wide 16:9 images instead of small portrait posters
- Resume toast, skip countdown and skip button shadows follow your accent colour
- Theme button shows the mode you are currently in

## [1.9.8] - 2026-07-29

### Changed
- Every on-video overlay now follows your accent colour: resume toast, skip countdown, skip button and subtitle toggle all regenerate from the same OKLCH seed as the popup, live, without a reload
- Rebuilt the resume toast and skip countdown with slide-up entrances, bottom-anchored above player controls so they clear phone notches in fullscreen
- Skip button is now accent-filled instead of hardcoded blue; CC button fills with the accent when subtitles are active

### Fixed
- Skip button disappeared behind the video after the second time you entered fullscreen
- Skip button leaked a mousemove listener every time it was clicked rather than timing out
- Subtitle toggle stacked a new fullscreen listener on every video

### Performance
- Removed all backdrop-filter blur from on-video overlays; these re-rasterised every frame over playing video and caused hitches on Firefox Android
- Overlays now animate transform and opacity only, no paint properties

## [1.9.7] - 2026-07-28

### Fixed
- Popup was half-dead: a listener bound to a removed Save Settings button threw at load and killed every handler after it, including the History, Stats and gear buttons, state loading, tab detection, subtitle controls and the accent picker
- Playback speed and the resume / auto-next toggles now persist immediately instead of relying on the removed Save button
- Hardened the remaining unguarded DOM lookups in popup.js and options.js

### Changed
- Rebuilt the popup UI: ledger-style status readout, sliding tab indicator, redesigned mode tiles, toggles, speed and subtitle controls
- Responsive across desktop popup, Firefox Android full-screen and tablet widths, with 44px touch targets on coarse pointers
- Motion limited to transform and opacity, reduced on touch, disabled under prefers-reduced-motion

### Added
- CI DOM contract check: the build now fails if a script hard-dereferences an element id that does not exist in its HTML

## [1.9.6] - 2026-07-28

### Fixed
- Options page only half-themed: theme-engine now sets the options.css token namespace too
- Accent tint rendered as a solid block on options nav items and card icons

### Performance
- options.css three-layer shadows reduced to single layer
- Reduced motion on touch devices in options.css

## [1.9.5] - 2026-07-28

### Fixed
- theme-engine.js was missing from every packaged build, dynamic theming was inert in v1.9.4
- Chosen theme color reset to default green on every popup open (seed key absent from storage read)
- CI now fails the build if theme-engine.js is missing from the ZIP

## [1.9.4] - 2026-07-28

### Performance
- Removed paint-triggering CSS transitions (background, border-color, color, box-shadow)
- Flat background replaces linear-gradient on popup body
- Single lightweight shadow replaces 3-layer box-shadow
- GPU-promoted toggle thumbs (will-change: transform)
- Reduced motion on touch devices (@media pointer: coarse)
- Removed backdrop-filter from options.css

### Added
- Dynamic Material You theming from user-chosen seed color (OKLCH palette generation)
- Theme color picker with 6 presets in popup Settings tab
- Theme engine applies consistently across popup and options page

## [1.9.3] - 2026-07-24

### Fixed
- History links: normalized page_url field across local cache and cloud sources (snake_case vs camelCase mismatch)
- History items no longer open extension pages when URL is missing or invalid
- Native skip buttons now detected via MutationObserver (fires even when video is paused)
- SKIP_SELECTORS wired to MutationObserver + SPA navigation cleanup

## [1.9.2] - 2026-07-19

### Added
- Multiple SponsorBlock segments per video (all sponsors skipped, not just first)
- Self-promotion category skipping on YouTube
- Keyboard shortcuts: Alt+Right (skip segment), Alt+Z (undo/go back 15s)
- Per-site skip counts in stats
- Daily "time saved today" counter (resets each day)

## [1.9.1] - 2026-07-19

### Added
- SponsorBlock integration: auto-skip sponsors, intros, outros on YouTube (privacy-preserving hash prefix lookup)
- MutationObserver for native skip button detection (catches buttons appearing while video is paused)
- Instant auto-skip mode (no countdown toast when auto enabled)
- Silent auto-resume with brief toast (no prompt dialog)
- Full subtitle overlay: draggable, responsive font, sync offset, fullscreen support

### Fixed
- All documentation updated to reflect UUID identity (not SHA-256)
- Removed dead test files (test-ai.mjs, package.json)
- Cleaned updates.json of deleted release versions

## [1.9.0] - 2026-07-19

### Security
- Fix GraphQL injection in AnimeSkip provider (input validation)
- Fix URL parameter injection in IntroDB provider (URLSearchParams encoding)
- Fix TMDB API key exposure (moved from URL param to Authorization header)
- Fix XSS vector in history rendering (href validation)
- Import/restore uses key whitelist (blocks credential overwrite attacks)
- Exclude passwords and sessions from backup export
- Native skip button clicks gated to known streaming sites only
- Supabase URL validated before use
- Season/episode bounds checking (rejects absurd values)

### Fixed
- User ID now per-install random UUID (no more shared identity collision)
- SPA navigation resets skip segments and re-detects episodes
- Resume threshold fixed for long content (movies at 95% with >60s remaining still resume)
- Playback speed re-applied on SPA episode transitions
- Stale save closure prevented on SPA navigation
- Tab ID recycling phantom saves prevented
- Offline queue flush race condition fixed (mutex lock)
- Data cleanup paginated to prevent Supabase timeout
- Store-check workflow deduplicates issues (no more spam)

### Performance
- Skip detection via timeupdate events (replaces 500ms setInterval polling)
- Config cached in memory with storage.onChanged invalidation
- Content script early-exit on iframes without video elements
- innerText replaced with textContent in episode detection (no layout thrash)

### Added
- Error logging ring buffer (last 20 errors accessible via GET_ERROR_LOG)
- Orange badge indicator when segment providers are unreachable
- 90-day automatic playback data cleanup
- Easter egg in popup (5x click version badge)
- INSTALL_GUIDE.md with friendly setup instructions

### UI
- Popup CSS polished (hover transitions, depth, tactile chips)

## [1.7.11] - 2026-07-06

### Fixed
- UI accessibility: :focus-visible outline rings on all interactive elements (tabs, chips, buttons, selects).
- Cross-browser: Firefox scrollbar-width + scrollbar-color fallback added to options.css.
- Token enforcement: replaced 4x hardcoded border-radius values with design tokens.
- Theme consistency: added OS dark mode @media fallback to popup.css, unified warn color light theme.
- Sync button: removed inline all:unset, replaced with btn-ghost class.
- Motion tokens: toggle thumb spring easing now uses var(--md-sys-motion-easing-expressive-spring).
- Scrollbar width: standardized to 5px across both files.

## [1.7.10] - 2026-07-06

### Fixed
- Accessibility: aria-label on toggles/icon buttons that had none (masterToggle, AnimeSkip toggle, subClearBtn, themeBtn, settingsBtn).
- Skip Mode / Playback Speed chips: role=radiogroup/radio + aria-checked, kept synced in JS.
- Tab bar: role=tablist/tab + aria-selected. options.html nav-items: aria-current.
- source-pill filter chips were `<span>`, keyboard-inert. Now `<button>`.
- options.css: consolidated 3 scattered dark-mode media blocks into 1.
- options.css `.btn-primary` had hardcoded `color:#fff`, now uses `--on-accent`.

### Added
- `--sp-*` spacing scale, `--md-sys-typescale-*` type scale tokens (both files).
- options.html now reads `skipstream_theme` and applies it, previously ignored the popup's manual theme choice and always followed OS setting. No new toggle added to options page.

## [1.7.9] - 2026-07-05

### Fixed
- Real Material 3 tokens: `--md-sys-shape-corner-*`, `--md-sys-motion-*` added. Prior v1.7.8 pass only reskinned hex values on the old var architecture.
- Unified popup.css + options.css onto same green accent (was indigo vs green).
- Fixed `body.theme-light`/`theme-dark` manual toggle classes, never updated in v1.7.8, still had v1.0 hex values.

## [1.7.8] - 2026-07-05

### Fixed
- OpenSubtitles registration link corrected to `https://www.opensubtitles.com/#modal-register` (was pointing at a non-existent `/en/newaccount` path).

### Changed
- **Settings consolidated to one page.** IntroDB, Supabase, TMDB, AnimeSkip, and OpenSubtitles credentials previously each lived on a separate sidebar page. All five are now on a single "Services" page, directly below the unified Service Status card - no more clicking through sidebar tabs to configure each service. Sidebar nav reduced from 9 items to 6.
- **Visual redesign (MD3-inspired).** Retokenized colors, elevation, and shape scale in `options.css` and `popup.css` toward Material Design 3 principles: layered tonal shadows instead of flat drop-shadows, MD3 shape scale (20px cards, pill-shaped buttons and nav items), refined primary color.
- **Dynamic sizing.** Sidebar width, body font size, page titles, card padding, icons, and buttons now scale fluidly with viewport width via `clamp()` instead of fixed pixel values.

## [1.7.7] - 2026-07-05

### Fixed
- **AMO submission 406 on version create.** `scripts/amo-update.js` never sent an `Accept` header on any request. `curl` (used in Mozilla's own API examples) sends `Accept: */*` by default; Node's `https.request` sends none at all. AMO's version-create endpoint returned `406 Not Acceptable` with an empty body for the bare request. Added `Accept: application/json` to every request. Also now logs response headers alongside the body on version/add-on-create failures, since AMO can return an empty body on error.

## [1.7.6] - 2026-07-05

### Fixed
- **Critical: broken UI in every packaged build.** `popup.css` and `options.css` were never included in the built extension ZIP — every workflow that packages the extension (`release.yml`, `amo-submit.yml`, `cws-submit.yml`, `validate.yml`) listed `popup.html`/`popup.js` and `options.html`/`options.js` but omitted the stylesheets both pages `<link>` to. Anyone installing from AMO, the Chrome Web Store, or a GitHub Release ZIP got completely unstyled popup and options pages — this affected every published version. Fixed all 4 workflows to include `popup.css` and `options.css`. Added a CI step (`validate.yml`) that fails the build if a packaged ZIP is missing either stylesheet, to prevent regression.

## [1.7.5] - 2026-07-05

### Fixed
- **Docs drift**: README.md and the AMO listing description (`scripts/amo-update.js`) were both under- and over-claiming features versus the actual codebase. Fixed:
  - Subtitle system (OpenSubtitles, CC overlay, sync offset, offline upload) was missing from both — added.
  - Speed control claimed only 1x/1.25x/1.5x/2x; actual UI also has 0.75x — added.
  - AMO listing claimed the theme toggle "follows system preference" — it doesn't; it's a manual dark/light toggle with no system-default state. Fixed wording.
  - AMO listing called the manual Supabase push a "Force sync" feature; renamed to match the actual "Sync" button behavior.
  - README's File Structure section labeled `manifest.json` as an MV3 manifest; it's MV2 (Chrome uses the separate `manifest-chrome.json` for MV3). Fixed.
  - README Setup section only documented IntroDB and Supabase; TMDB, AnimeSkip, and OpenSubtitles credential panels exist in Settings but were undocumented. Added.
  - Added "Are you still watching?" auto-dismiss and dark/light theme toggle to README's feature list (both existed in code, undocumented).

## [1.7.4] - 2026-07-05

### Fixed
- Removed stray `.github/workflows/ai-fix-pr.yml.save` editor backup file (superseded, unused)

## [1.7.3] - 2026-07-05

### Fixed
- **AMO submission error**: `browser_specific_settings.gecko.data_collection_permissions.required` as empty array `[]` is now rejected by the updated AMO validator, which requires 1+ items. Removed `data_collection_permissions` entirely from `manifest.json`, since the extension collects no data.

## [1.7.2] - 2026-07-04

### Fixed
- Duplicate OpenSubtitles card IDs in animeskip panel, dead form inputs
- Removed dead `dot-osub-inner` ref in options.js
- `OSUB_UA` bumped to v1.7.0
- PRIVACY.md: OpenSubtitles disclosure + sync ID collision warning

## [1.7.1] - 2026-07-04

### Fixed
- `popup.js` missing version header comment, broke CI version-consistency check
- `README.md` version badge stuck at 1.6.9
- All `innerHTML` usage removed from `options.js` (15 sites) and `content-scripts/content.js` (1 site), replaced with DOM API (`createElement`, `textContent`, `createElementNS` for SVG) - fixes CI security check
- `updates.json` missing 1.7.0 entry, added

## [1.7.0] - 2026-07-04

### Added
- **Subtitle system**: auto-fetches subtitles from OpenSubtitles by IMDB ID on any identified video; CC button on player with drag-to-reposition, right-click sync offset; offline .srt/.vtt override via popup upload; language selection (30+ languages, English default, auto-fallback); subtitle overlay scales with video size; 20-entry local cache avoids repeat downloads
- **OpenSubtitles integration**: `background.js` handles login/logout/search/download; anonymous 5/day, logged-in up to 200/day; session cached with 23h expiry; login status and quota shown in Connections panel
- **Popup Settings tab**: skip mode chips, segment toggles, playback speed, subtitle upload/language all in one place - no options page needed for daily use
- **Bidirectional skip mode/segment sync**: changing skip mode chip updates segment toggles and vice versa; infers mode from toggle state (`inferMode`); persists immediately on change without explicit save
- **Theme toggle in popup**: single tap dark-to-light or light-to-dark; no intermediate system-default dead state; persists across sessions
- **Device name setting**: user-configurable device identity shown in cross-device history; falls back to browser UA if blank
- **Welcome-back toast**: options page shows contextual greeting on load based on Supabase connection state
- **Cloud history clear**: Advanced panel deletes all Supabase `playback_states` for current user; switches to Cloud tab after confirm
- **Local history clear**: removes `skipstream_cache` only, cloud unaffected
- **`page_url` in Supabase**: real page URL now stored and fetched; cloud history items are clickable links
- **YouTube/music thumbnails**: history uses `ytimg.com` thumbnail by video ID instead of TMDB; playlist and cloud entries matched via `yt/ID` media-id format; Spotify/SoundCloud via oEmbed
- **Date/time on history items**: shows Today HH:MM, Yesterday HH:MM, or short date
- **Supabase explicit grants**: `GRANT SELECT,INSERT,UPDATE,DELETE` on both tables to `anon,authenticated`; `GRANT USAGE ON ALL SEQUENCES` - fixes DELETE 403 without hardcoding sequence names
- **`INVALIDATE_USER_ID` called on Clear All**: background in-memory userId cache reset immediately on data clear

### Fixed
- **Skip loop at segment end**: 1.5s cooldown (`video._ssCooldownUntil`) after any skip prevents immediate re-trigger from +1s grace window
- **Master toggle re-fires resume prompt**: `_promptedVideos` WeakSet prevents `restorePlayback` re-running on same video element after toggle ON
- **Per-site rules not applied**: `effectivePrefs = getSitePrefs(prefs)` moved before segment detection in poll; `restorePlayback` now checks site rules before prompting
- **Playback speed not reactive**: `storage.onChanged` listener applies new rate to all connected video elements immediately; `playbackRate`/`playbackSpeed` key mismatch fixed across options.js and popup.js
- **Stats always 0**: `content.js` writes `skipstream_stats` blob; options/popup now read same blob key; `loadStats` and `applyStats` unified; live `storage.onChanged` listener updates stats panel without page reload
- **Native platform skip buttons never counted**: `clickFirst(SKIP_SELECTORS)` now calls `recordSkipStat(60)` with 10s cooldown between counts
- **Manual skip button never counted**: `recordSkipStat` added to manual skip path alongside auto-countdown path
- **Stats today counter**: `skipsToday` + `statsDate` fields added to blob; daily reset logic in `recordSkipStat`
- **YouTube og:title stale on SPA nav**: reads from live DOM (`yt-formatted-string`, `ytmusic-player-bar .title`) instead of og:title meta tag which never updates after initial page load
- **`chrome.*` storage API in Firefox**: all `chrome.storage.*` calls in `options.js` and `popup.js` switched to `br` shim; fixes `get(null)` returning undefined in Firefox causing import crash and export failure
- **options.js syntax error**: missing closing `}` on `saveSupabase` handler blocked entire script parse; nav, toggles, history all dead until fixed
- **History source-pill stale after Sync**: `_histLocal`/`_histCloud` lifted to module scope; `getHistoryItems()` always reads current arrays; source pill clicks post-sync show fresh data
- **`loadHistory` listener stacking**: `historyListenersAttached` flag prevents duplicate sync/search/filter/pill listeners on each reload
- **Supabase sync 400 `PGRST204`**: `device_name` and `page_url` columns added to `supabase_setup.sql` via idempotent `ALTER TABLE` blocks
- **`fetchWithRetry` swallowing 400 errors**: 400/409/422 added to pass-through list; response body extracted and surfaced in sync error message
- **Export download silent fail**: anchor appended to `document.body` before `.click()`; `URL.revokeObjectURL` after 1s; try/catch surfaces real errors; honest toast wording
- **Import crash `existing.statsTotalSkips undefined`**: `storage.local.get(null)` via `br` shim now returns real object; stats merge uses blob keys
- **Import malformed file accepted silently**: type/array guard added; Supabase URL swap now requires explicit confirm dialog
- **`skipMaster` not migrated on 1.6.5 import**: migration shim maps `skipMaster`→`skipEnabled`
- **`navDotConnections` spinning forever**: `verifyAll` sets final state after all service checks resolve; OpenSubtitles status included
- **Cloud history no video links**: `url: row.media_id` replaced with `url: row.page_url`
- **Export credential warning missing**: confirm dialog before download warns plaintext credentials included
- **Supabase save no success toast**: `verifySupabase` return value checked; green alert shown on success
- **`CHECK_CONFIG` dead code removed**: handler and `checkTmdb`/`checkIntroDB` background functions deleted; zero callers confirmed
- **Clear All not resetting background cache**: `INVALIDATE_USER_ID` message sent to background on clear

### Changed
- **Options consolidated to 4 panels**: Connections (all services + OpenSubtitles), History, Stats, Data & Advanced - was 9 panels
- **Skip Behavior panel removed from options**: all skip config lives in popup Settings tab
- **Subtitles panel removed from options**: subtitle config lives in popup Settings tab
- **Export/Import + Advanced merged**: single "Data & Advanced" panel covers backup, device identity, clear local, clear cloud, clear all
- **History defaults to Merged tab**: was Local
- **Sync push errors surfaced**: shows count of pushed/failed with real error text instead of silent swallow
- **CSP `connect-src` added**: both manifests now explicitly allowlist all API domains; closes unrestricted exfiltration path
- **TMDB poster concurrency**: max 4 simultaneous TMDB calls via `scheduleFetchPoster` queue; prevents rate-limit on large history
- **Responsive sidebar**: hamburger menu below 640px; sidebar slides in/out; main content padding adjusts; fluid layout up to 1600px
- **Font stack**: Inter + system fallbacks; `clamp()`-based font sizes; 200ms ease-out transitions throughout
- **Popup light mode**: full light theme CSS vars; single-tap toggle between dark and light

---

## [1.6.9-ui-polish] - 2026-06-15

### Fixed (ui-polish branch)
- **Firefox install error**: `browser_specific_settings.gecko.data_collection_permissions.required` changed from `false` to `[]` (array) - extension now loads without errors
- **Settings button opens about:addons**: `popup.js` and `background.js` both changed from `openOptionsPage()` to `chrome.tabs.create({ url: getURL('options.html') })` - opens full options tab consistently in Firefox
- **History/Stats buttons**: already used `tabs.create` with `#hash` - verified working; `options.js` reads `location.hash` on DOMContentLoaded and routes to correct panel
- **Toggle switches not saving**: root cause identified as Firefox treating temp addon storage as non-persistent; storage.local.set() calls on every `change` event are correct - persists after proper signed install
- **JSON import from 1.6.5 failing**: added `migrateImportData()` shim in `options.js` handling renamed keys: `apiKey`→`introdbApiKey`, `supabaseKey`→`supabaseAnonKey`, `autoSkip`→`skipIntro`, `totalSkips`→`statsTotalSkips`, `timeSaved`→`statsTotalTimeSaved`
- **domain detection**: `popup.js` now skips `moz-extension:` protocol in addition to `chrome:` and `about:`

### Added (ui-polish branch)
- **`popup.css`**: Premium AdGuard-style dark UI, exact selector mapping to popup.html classes, spring-eased toggle animations, tabular-nums stat display
- **`options.css`**: Full-tab options page styling, glassmorphism cards, light/dark via CSS vars, status dot pulse animations, responsive sidebar collapse at 640px
- **Export version tagging**: exports now include `_exportVersion` field for future migration detection
- **`options_ui.open_in_tab: true`**: added to Firefox `manifest.json` so options always opens as full tab

## [1.6.9] - 2026-06-12

### Fixed
- **AMO submission**: replaced all `console.log` calls with `process.stdout/stderr.write` in `amo-update.js`; fixed unclear error path for non-201/409 upload responses; extended JWT expiry to 300s; cleaner upload error reporting
- **AMO workflow trigger**: added explicit secrets check step that fails early with a clear message when `AMO_API_KEY`/`AMO_API_SECRET` not set
- **Chrome ZIP missing from releases**: confirmed `release.yml` builds and uploads both Firefox and Chrome ZIPs as release assets and workflow artifacts
- **CWS workflow failures**: workflow now detects missing secrets early and skips all submission steps gracefully instead of failing
- **Supabase setup**: added DELETE RLS policies for `playback_states` and `user_settings`; added `updated_at` index; added `ss_verify_setup()` verification function; auto-runs verification at end of script

### Added
- **Supabase validation workflow** (`supabase-validate.yml`): lints `supabase_setup.sql` on every change; `workflow_dispatch` option to apply setup to live Supabase project via `SUPABASE_DB_URL` secret
- **validate.yml**: `strict_min_version` sanity check - rejects values below 109 or above 145


## [1.6.8] - 2026-06-07

### Fixed
- **AMO submission**: removed `supabase_setup.sql` from extension ZIP - it is a developer tool only and may cause AMO validation errors

## [1.6.7] - 2026-06-07

### Changed
- **AMO listing**: updated description to reflect all 1.6.x features (countdown, still-watching, stats, sync button, backup/restore, Android update)
- **Dependencies**: bumped `actions/checkout` v4→v6, `actions/setup-node` v4→v6, `actions/download-artifact` v4→v8, `softprops/action-gh-release` v2→v3, `github/codeql-action` v3→v4 (Dependabot PRs #17-21)

### Fixed
- **Issue #11**: CloudStream integration documented as out-of-scope for browser extension; Supabase schema is documented for potential companion app

## [1.6.6] - 2026-06-05

### Added
- **Cloud settings sync**: stats, preferences, site rules, and theme are now saved to a `user_settings` table in Supabase on every credential save. On the Settings page, if local settings are empty or cloud is more than 1 minute newer, a restore prompt appears.
- **Android force-update**: `update_url` in `manifest.json` points to `updates.json` hosted at `raw.githubusercontent.com`. Firefox for Android checks this URL and can prompt users to update without reinstalling.
- **Supabase `user_settings` table**: new table in `supabase_setup.sql` with RLS, auto-updated trigger, and `device_name` column migration for `playback_states`.
- **CI auto-updates `updates.json`**: `release.yml` writes the new version and download URL to `updates.json` and commits it on every release.

## [1.6.5] - 2026-06-04

### Added
- **Full backup/restore**: Export now includes watch history (`skipstream_cache`), stats, site rules, theme, `animeSkipEnabled`, and all credentials + prefs. Import merges history (keeps newer timestamp per title), combines session counts, takes higher skip/time-saved values.

### Changed
- Export filename is date-stamped: `skipstream-backup-YYYY-MM-DD.json`
- Button labels changed to "Export All" and "Import & Merge" with explanatory hint text

### Docs
- CONTRIBUTING.md, HOW_TO_RELEASE.md, TESTING.md, PRIVACY.md: all rewritten, concise
- AMO listing description: rewritten to match current features accurately

## [1.6.4] - 2026-06-04

### Added
- **Force sync button**: Sync button in history panel pushes all local positions to cloud then refreshes; shows item count and timestamp
- **Last sync time**: status bar shows when data was last synced to cloud

### Fixed
- **Skip button missing on mid-segment seek**: `findActiveSegment` now has +1s end grace; `seeked` event resets `activeSegmentKey` so seeking into an active segment always shows the button
- **Cloud save confirmation**: successful saves now write `skipstream_last_sync` timestamp to local storage

### Changed
- **README**: rewritten to be concise - what it does, setup, file structure only
- **Options page description**: shortened to one clear sentence

## [1.6.3] - 2026-06-04

### Fixed
- **updateSkipBadge crash**: was calling `getElementById('skipMaster')` which no longer exists in popup.html (removed when redesigned to `skipModeSelect` dropdown); badge now reads from passed `prefs` object directly
- **Per-site rules ignored in skip poll**: poll was checking `prefs[prefKey]` for auto-skip decision instead of `effectivePrefs[prefKey]`; per-site overrides now fully applied to both the master gate and the per-segment auto-skip decision
- **Native platform poller ignored per-site rules**: `startNativeBtnPoller` read `prefs.skipMaster` directly; now calls `getSitePrefs(prefs)` so domain overrides disable native button clicking correctly
- **autoNextEpisode missing from import/export**: `EXPORT_KEYS` in `options.js` was missing `autoNextEpisode`; the pref was lost on settings export/import
- **device_name missing from history fetch**: `SUPABASE_GET_ALL` select did not include `device_name`; popup history now shows which device saved each position

## [1.6.2] - 2026-06-04

### Added
- **Per-site skip rules**: override global skip mode per domain in Settings (e.g. always prompt on Crunchyroll, auto-all on Netflix); stored locally, applied in real-time without page reload
- **Dark/light theme toggle**: sun/moon icon in popup header; respects system preference on first load, persists manual override
- **Segment confidence badge**: skip button and countdown show a star/diamond badge when segment has 5+ or 10+ reports from IntroDB
- **device_name in sync payload**: upsert now includes browser name (Firefox/Edge/Chrome) so history shows which device saved each position

## [1.6.1] - 2026-06-04

### Added
- **Native platform skip buttons**: clicks the platform's own "Skip Intro/Recap/Credits" button when present (Netflix, Prime, Disney+, Hulu, Max, Crunchyroll, Peacock, Paramount+, Apple TV+, Tubi) - works without IntroDB API key
- **Auto Next Episode**: optional toggle to automatically advance to the next episode when within 10s of end; off by default

### Fixed
- `autoNextEpisode` pref added to `PREF_DEFAULTS`, `ALL_TOGGLES`, and popup init wiring
- `startNativeBtnPoller` now correctly called inside `attachVideo`
- `onNavigation` now resets `_nextEpTriggered` and clears native button poller on SPA navigation

## [1.6.0] - 2026-06-03

### Added
- **Skip countdown toast**: auto-skip now shows a 3-second countdown with Undo button instead of jumping instantly; cancels if video pauses
- **Playback speed control**: 1x / 1.25x / 1.5x / 2x selector in Settings panel; persists across pages and syncs to active video immediately
- **Watch stats panel**: new Stats tab showing in-progress titles, total watch time tracked, total segments skipped, time saved, and session count
- **"Still watching" auto-dismiss**: generic text-match observer clicks platform continue/resume overlays automatically on any site
- **Import / Export settings**: backup and restore all credentials and preferences as a JSON file from the Settings page
- **Offline upsert queue**: failed cloud saves are queued in local storage and replayed automatically when network reconnects
- **Skip mode dropdown wired**: `skipModeSelect` in popup now correctly writes to storage and content script respects it immediately

### Fixed
- **Skip mode selector was non-functional**: popup.html had been redesigned to a single dropdown but popup.js was still wiring non-existent individual toggle elements

## [1.5.9] - 2026-06-03

### Fixed
- **Version bump**: advance past tags v1.5.7 and v1.5.8; all version files aligned to 1.5.9
- **Movie embed mediaId**: `getMediaId()` now handles `/movie/{id}` and `/tv/{id}` paths correctly
- **Movie embed warn**: suppressed false-positive "Could not identify episode" on movie embed URLs
- **Manifest**: removed `data_collection_permissions` from `manifest.json` and all related assertions
- **CI**: removed SHA-pinned action refs across all workflows; pinning to named versions

## [1.5.6] - 2026-05-31

### Fixed
- **AMO pipeline resilience**: `scripts/amo-update.js` now handles HTTP 409 on both upload and version-create steps gracefully - logs a warning and exits 0 instead of crashing the GitHub Action
- **Badge race condition**: popup badge now reads directly from `browser.storage.local` before any DOM writes, eliminating the "0/3" display on fresh open
- **History item click**: entries now open in a new tab via `br.tabs.create()` and inject a pending-resume record so the content script seeks immediately on load
- **Em dash cleanup**: all em dashes and en dashes replaced with hyphens or colons across all source files and manifests

### Added
- **Throttled timeupdate sync**: content script now syncs playback position every 2.5 seconds via a throttled `timeupdate` listener (was only on pause/seek)
- **Tab-close flush**: `background.js` tracks last-known playback state per tab via `br.tabs.onRemoved` and fires a final Supabase upsert before the tab dies
- **beforeunload flush**: `flushPlaybackSync()` writes local cache and sends a best-effort background message on page unload
- **Pending-resume injection**: history click writes `skipstream_pending_resume` to `browser.storage.local`; content script on the new tab consumes it and auto-seeks + plays
- **Human-readable metadata**: `getSiteName()` and `getVideoTitle()` produce clean display strings; all cache writes and Supabase upserts include `site_name` and `video_title`
- **Supabase schema columns**: `site_name` and `video_title` columns added to `playback_states` table via idempotent `ALTER TABLE` guards in `supabase_setup.sql`
- **`SUPABASE_GET_ALL` message handler**: background exposes a bulk history fetch endpoint for the popup

### Changed
- `manifest.json` and `manifest-chrome.json` description field: em dash replaced with hyphen
- Default history source view changed to "merged" (was "local")
- History items rendered as `div` elements with click handlers (was `<a>` tags pointing to deep-link URLs directly)

---

## [1.5.5] - 2026-05-31

### Changed
- Cross-browser manifest updates and README restructure
- Chrome MV3 compatibility improvements

---

## [1.5.4] - 2026-05-31

### Fixed
- Removed `console.log`/`console.error` calls (CI enforcement)
- Dropped ES module import syntax incompatible with MV2/MV3 service workers
- `popup.js` console error cleanup


## [1.5.3] - 2026-05-30

### Fixed
- AMO submission pipeline verification and stability improvements
- Documentation layout and structure link fixes

## [1.5.2] - 2026-05-30

### Fixed
- Version bump to clear AMO 409 conflict from duplicate 1.5.1 submission

---

## [1.5.1] - 2026-05-30

### Changed (UI overhaul)
- Full popup redesign: unified design system with CSS token variables, Inter/system font, glass-morphism card, proper dark mode
- Skip Segments and Add Segment use identical "folder" chrome - collapsed header with icon, chevron, expand/collapse animation
- Skip master toggle expands child rows (Intro/Recap/Outro) inline; badge shows "N/3" active; sub-label summarises active types
- Add Segment (renamed from "Report Segment"): Start/Stop/type-select/submit flow as 3 stepped screens within the folder; matches Skip Segments styling exactly
- History panel: Source pills (Local / Cloud / Merged) let user switch data source; cloud rows show cloud badge; richer item cards with progress bar and time label
- Status row replaced with compact dot + text pill; sync status row in History panel shows cloud sync state

### Fixed
- Supabase history bug: History now fetches all rows for the user from Supabase (`playback_states`) in the popup and merges with local cache
- Merged history: cloud's `playback_time` wins if more recent than local; local provides `title` and `url` for cloud-only rows
- All SVG icons built with DOM API, no innerHTML (CI-compliant)

## [1.5.0] - 2026-05-29

### Added
- Master Skip toggle with 3 child toggles (Intro/Recap/Outro); badge shows active count
- Corrected auto-skip logic: child toggle ON = auto-skip silently; child toggle OFF = show skip-button prompt (was inverted)
- Report Segment tool with Start/Stop/type/submit flow
- History pre-load on popup init
- iframe parent URL fix via `document.referrer`
- `GET_VIDEO_TIME` and `GET_SHOW_INFO` runtime message handlers

### Removed
- OMDB fully purged from all files

## [1.4.0] - 2026-05-28

### Removed
- OMDB demo key removed
- SubDL provider removed

### Fixed
- AnimeSkip provider rewritten to correct GraphQL endpoint
- Resume prompt loop de-duplicated

### Added
- Site filter dropdown in history tab
- AnimeSkip `animeSkipClientId` and `animeSkipAuthToken` fields in Settings

## [1.3.1] - 2026-05-28

### Added
- Resume prompt overlay with auto-confirm after 12s
- OTT compatibility table in README

## [1.3.0] - 2026-05-28

### Added
- History tab in popup with searchable list and deep-links
- Multi-provider segment engine (IntroDB + AnimeSkip + SubDL in parallel)
- AnimeSkip provider
- SubDL provider
- IntroDB segment reporting
- Chrome MV3 manifest

## [1.2.0] - 2026-05-27

### Fixed
- Skip button visible in fullscreen mode
- Auto-hide timer resets on mouse movement near button
- Button positioning changed to viewport-relative %

### Added
- Add Missing Segments toggle in popup
- Real icon shown in popup header

## [1.1.0] - 2026-05-26

### Added
- Exponential backoff retry on all API calls
- Aspect ratio filtering for video detection (1.2:1 to 3:1)
- Event-driven SPA navigation (replaces 800ms polling)
- GitHub Actions CI/CD pipeline

### Removed
- 800ms location.href polling loop

## [1.0.0] - 2026-05-25

### Added
- Deterministic cross-device user ID from SHA-256 hash of Supabase anon key
- `OMDB_LOOKUP` message handler in background
- `browser_specific_settings` gecko ID in manifest
- `supabase_setup.sql` - idempotent setup script
- Live simultaneous status checks for all services on save
- Glassmorphism UI adaptive to mobile and system dark mode
- SPA navigation tracking
- `loadedmetadata` fallback for early route hydration

### Removed
- All WXT framework scaffolding
- All `console.log` (replaced with `console.warn`)
- All OpenSkip branding
