<!-- archived from assistant skill 'Architecture and UI', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before touching SkipStream's content scripts, frames, theming, on-video UI or the skip engine. Explains the frame model that causes most bug reports, plus the performance and UI system rules. -->

# ARCHITECTURE-AND-UI (sub-skill of SKIPSTREAM-RELEASE-WORK)

## Frame architecture, the thing that explains half the bug reports

`manifest.json` sets **`all_frames: true`** with ``. On aggregator sites content.js therefore runs in the top page **and** inside every embedded player iframe, each with its own module scope and its own copy of every module-level counter.

- **`_siteHost()`** and **`getSiteHostname()`** already resolve identity from **`document.referrer`** when inside an iframe. Do not "discover" this again and do not propose a redesign; that was a wrong call on 15 Aug. The bugs were always individual call sites bypassing those helpers.
- **`_pageUrl()`** (added `0527017`) does the same for URLs: returns `document.referrer` in an iframe, else `location.href`. It has no protocol check; `renderHistory` guards hrefs to http/https so the worst case is a row falling back to `#`.
- **A cross-origin iframe cannot read the parent's title.** That is why the video title comes out as the provider brand ("vidrock") instead of "Interstellar", and why the poster then fails. Fix options: the top frame posts its title down over the existing `postMessage` channel, or TMDB resolves it from the media id. Design job, not a line edit.
- **Suspected, UNVERIFIED:** per-frame duplication is the remaining theory for the stats +2. Each frame has its own `_lastNativeSkipTs` and its own `recordSkipStat` path. The two native recorders (poller 1189, observer 1217) share that variable, so they **cannot** double count within one frame; ruling that out cost a wrong diagnosis. The device number decides it.

## Theming architecture

One seed colour, `skipstream_seed_color`, drives three token systems: popup.css, options.css, and content.js `pal()` returning `{bg, edge, edgeStrong, text, muted, accent, onAccent}`.

`theme-engine.js` sets `--accent` and `--on-accent` **unconditionally** on `document.documentElement` before its `if (isOptions)` branch. content.js carries its own OKLCH copy because content scripts can't share module scope.

Never redefine a colour token under **`body.theme-light`**, **`body.theme-dark`****, or any body-level selector.** A custom property on body beats an inline one on html and silently kills the live accent picker. Shipped twice. `:root` blocks are fine.

**Theme mode follows the device.** `ssSystemMode()` is duplicated in theme-engine.js, popup.js and options.js. **Both this and the live accent picker are now device-confirmed working** (15 Aug, first confirmation either has ever had).

## Performance rules for on-video UI

- Animate **`transform`** and **`opacity`** only.
- No **`backdrop-filter`** anywhere. Open Firefox Android bug, and it re-rasterises every frame over video.
- Single-layer shadows, no gradients, shadow colour derived from the seed.
- Cut motion and grow touch targets to 44px under `@media (pointer: coarse)`.
- Overlays bottom-anchor above the player control bar (`bottom: 68px`), never `top: 12%`.
- Symmetric entrances and exits, `cubic-bezier(.22,1,.36,1)`. **No bounce.**
- **Never use viewport units in popup.css.** `max-width: 100vw` collapsed the popup to 10px. Guard is `@media (pointer: fine){ body{ min-width: 380px } }`.
- **Any DOM-wide scan reachable from a MutationObserver needs its own time floor.** `clickSkipByLabel` and `clickNextByLabel` each floor at 700ms via their own `_last*ScanTs`. The observer's outer guard tests `now - _lastNativeSkipTs > 10000` and that timestamp only moves after a *successful* click.

## UI system rules

- **Five type sizes only: 12 / 14 / 16 / 20 / 28px, body 16px.** `clamp()` for display headings only.
- **Three radii**: 8px small, 16px card, full for pills.
- **Icons 20px, one stroke weight, full opacity.** Colour carries state, not opacity.
- **System font stack.** Extensions can't fetch Google Fonts under default CSP.
- A drawer above a scrim must be **opaque**.
- **One control per setting.** Govind pushed back hard on the subtitle position slider ("slider? what the hell bro") since dragging the overlay already sets it. Both now write the same `subtitle_drag_pos` key, but the redundancy is a real complaint, not a misunderstanding.
- options.html structure: `` per page, `` then cards. **Body indentation is 6 spaces.** Anchor HTML edits on line numbers verified by grep, not on assumed whitespace.

## Skip engine, as it actually works

`content.js` is ~2050 lines, 81,265 bytes at `0527017`. Verified anchors: `getMediaId` ~196, `_siteHost` 219, `getSiteHostname` 226, `_pageUrl` ~232, `getSiteName` ~237, `recordSkipStat` ~856 (six callers), `startNativeBtnPoller` ~1178, `startNativeSkipObserver` ~1213, `showSkipCountdown` ~886, cross-frame listeners ~1322/1332, `checkSkipSegments` auto path ~1780, Alt+Right ~1819, Alt+Z ~1834, subtitle prefs ~1350.

- `PREF_DEFAULTS` = `{skipIntro:true, skipRecap:true, skipOutro:false, resumePlayback:true, skipEnabled:true, autoNextEpisode:false, deviceName:''}`.
- **Live pref sync works.** A `storage.onChanged` listener rewrites `prefs` and applies `playbackSpeed` to every video with no reload. The "no cross-tab speed sync" review finding is false.
- **Per-site rules override globals outright.** `getSitePrefs` maps a mode string to all three segment flags; `prompt` sets every one false. It reads storage **asynchronously inside a sync function** with a 5s cache, so the first video on a site can miss its rule.
- `NATIVE_SKIP_SITES` maps ten hosts: netflix, primevideo, amazon, disneyplus, hulu, max, crunchyroll, peacocktv, paramountplus, tubi. Anything else, including [**hotstar.com**](http://hotstar.com), matched nothing and returned false before touching the DOM.
- **The fix was a label matcher, not more selectors.** `clickSkipByLabel` / `clickNextByLabel` fire only when the domain map has no entry, whole-string match a visible control's `aria-label` or `textContent`, and require a 24x16 minimum box. Bare "Next" is deliberately excluded.
- Hotstar's Skip Intro is a real **`BUTTON`** with visible text "Skip Intro", no `aria-label`, class `_1CSTLo7uotP5mTlp3jKun7`. **Never key a selector on those classes.**
- **`SKIP_SELECTORS`** is dead code, confirmed 15 Aug. One reference, its own declaration.
- `tryDismissStillWatching` runs on its own 3s interval.
- **Two independent URL-change watchers** exist. Do not add a third.
- Stats keys written by content.js: `skipsTotal`, `skipsToday`, `statsDate`, `timeSavedSec`, `timeSavedToday`, `sessionsTotal`, `skipsBySite`. options.js and popup.js read the same names. `recordSkipStat` does an async read-modify-write, so concurrent calls **lose** increments rather than adding them.

## Verified anchors (5 Sep, 81,978 bytes at ce4a639)

On-screen UI functions: `mountOverlay` 85, `showResumeToast` 462, `showSkipCountdown` 882, `showSkipBtn` 1310, `renderSubFrame` 1488.

Top-frame guards at lines 219, 226, 233, 772, 1974. PostMessage relay at 1313-1341. These are deliberate, not accidental. Any blanket top-frame guard breaks intro skipping on every embedded player.

`PREF_DEFAULTS` = `{skipIntro:true, skipRecap:true, skipOutro:false, resumePlayback:true, skipEnabled:true, autoNextEpisode:false, deviceName:''}`.

`NATIVE_SKIP_SITES` maps 10 hosts: netflix, primevideo, amazon, disneyplus, hulu, max, crunchyroll, peacocktv, paramountplus, tubi. Anything else uses the label matcher.

`clickSkipByLabel`/`clickNextByLabel` floor at 700ms via `_last*ScanTs`. Observer's outer guard tests `now - _lastNativeSkipTs > 10000`.

Stats keys: `skipsTotal`, `skipsToday`, `statsDate`, `timeSavedSec`, `timeSavedToday`, `sessionsTotal`, `skipsBySite`.

## CC button (PR 62, landed 5 Sep)

`ensureCCBtn` at 1513, button id at 1517. Click handler: if `_subState.subs` empty, creates `input[type=file]` in page, `.click()` synchronously, writes text to `subtitle_override_srt`. `storage.onChanged` listener at 1612 re-parses + re-renders. +659 bytes, 7 CI checks green, Lint & Validate 9s.

**Never tested in a browser.** The picker must be created and clicked inside the same user gesture or Firefox blocks it. This is the one thing to check in the diff.

## Subtitle parse (PR 53, landed)

`parseSubs` at 1362 handles CRLF (splits on `\r?\n\r?\n`), VTT (strips `WEBVTT` header), BOM, and short timestamps (MM:SS.mmm). 8 synthetic cases passed. **Never met a real file** because no upload has ever landed.

`initSubtitles` at 1582, caller at 1728. The imdbId gate that blocked the whole subtitle UI was removed in PR 53.
