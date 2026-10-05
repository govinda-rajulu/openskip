# openskip state

Newest checkpoint first. Each section is a dated snapshot; verify live before acting.

## Start here (5 Oct 2026, packet os-130, release 1.13.0)

- **Released:** 1.12.0 (PR #80 merge `eac9924d`, tree `165aa58b`, tag `v1.12.0`, AMO upload OK
  3 Oct 13:11 UTC). AMO public page still showed 1.11.0 on 5 Oct: check the developer page.
- **In flight:** 1.13.0 PR from packet `os-130` (branch `packet/release-1.13.0-20261005`), built
  on tree `165aa58b`. Owner: device test the ZIP (checklist in the PR), merge, then run the
  guarded tag command. The tag publishes to AMO.
- **Owner, outside code:** AMO listing (screenshots, privacy link = PRIVACY.md on GitHub);
  Edge Add-ons listing (free, takes the Chrome ZIP).
  **Firefox for Android updates:** users have no manual add-on update button. Owner path:
  About Firefox, tap the logo 5 times, Secret Settings, enable the debug drawer, then
  Add-ons tools > Check for updates (Firefox 142+). Extensions cannot force their own update
  (`runtime.requestUpdateCheck` is not in Firefox, bug 1740508).
- **Next code:** the "Agent clean-up (after 1.13)" lane in ROADMAP (hand-over addendum items
  5 to 9). Then Supabase login (1.14.0, ROADMAP).
- **Owner decides:** own OpenSubtitles API key field (only if quota errors); drop free-streaming
  site names from getSiteName(); a headless browser CI job; Edge Add-ons listing.
- **Unverified live:** Anime Skip, SkipDB, TheIntroDB, AniSkip answers. 1Shows triple subtitles.
- **Writing:** all docs follow knowledge/handbook/WRITING.md. Mirror it to patch-factory by
  that repo's own PR.

## What 1.13.0 contains

- Sticky resume (`_resumeSeek`, save hold 15 s, `?t=` wins, pending resume 120 s), YouTube ads
  guard (`_ytAdShowing`), mobile YouTube bar (`YT_BAR_SELECTORS`, `_tlKeep`), cloud push at most
  every 20 s plus pause, hidden tab and `pushUnsyncedHistory` every 5 min.
- Sources: TheIntroDB, AniSkip, Jikan (MAL id), page chapters. Priority IntroDB > TheIntroDB >
  SkipDB > AniSkip > Anime Skip > page chapters. SponsorBlock `service=YouTube`, `_sbFitDuration`.
- `sbAuth()`: publishable keys only in `apikey`. CSP `connect-src 'self'`. Setup helper in Settings.
  `ss_put_creds` dropped from supabase_setup.sql (column kept).
- Skip notice opt-in (`skipNotice`), Alt+Z undo, subtitle edge (`subtitle_edge`), deep site report,
  history 300, AMO listing fix (flat categories, STE text, `--print-listing`).
- One site, one name: `_canonHost` drops www., m. and mobile. from saved hosts and ids. Resume
  still finds positions saved under the old id (`_legacyMediaId`). History merges both copies.
- Tests: 186 (48 in tests/v113.test.mjs, checked to fail on the 1.12.0 tree).

## Start here (3 Oct 2026, end of the long session)

- **Released:** 1.11.0 (tag `v1.11.0`, main tree `b1c6801a`, AMO upload OK 3 Oct 12:08 UTC).
- **In flight:** 1.12.0 PR from packet `os-120` (branch `packet/release-1.12.0-20261003`).
  Owner: device test the ZIP, merge, push tag `v1.12.0` (that publishes to AMO).
  **Superseded 5 Oct:** #80 merged and v1.12.0 released 3 Oct, before the device test.
- **Owner, outside code:** AMO listing (screenshots, privacy link = PRIVACY.md on GitHub);
  Edge Add-ons listing (free, takes the Chrome ZIP).
- **Next code:** Supabase login (1.13.0, ROADMAP). Site fixes come from "Site report" pastes.
- **How we work:** one packet per change set, rehearsed in the assistant's sandbox, run by the
  owner in Cloud Shell, PR, device test, merge, tag. Reads pinned to commit shas (LESSONS).

## What 1.12.0 contains

- Site report (`content-scripts/probe.js`, `tabs.executeScript` allFrames + matchAboutBlank;
  Chrome `scripting`). All SponsorBlock categories and action types, per-category `sbModes`,
  mute, highlight, timeline marks (`showTimeline`). Anime Skip ends fixed (query had a made-up
  `duration`; still unverified live). SkipDB fallback (ODbL). Subtitle look and per-show offset.
- UI refresh: popup tabs Status / Playback / Tools, stat tiles, segmented tabs, cards, footer
  links (GitHub, Privacy, Report a problem); Settings: system font stack, rounder cards, wrap on
  phones, 44 px touch targets, focus rings, reduced motion. Checked by headless screenshots at
  320 to 1280 px, light and dark.
- On-video toasts share one placement (`TOAST_BOTTOM` with safe area, `TOAST_RADIUS`,
  `_toastFit`: never wider than the screen, no motion when reduced motion is on).
- Easter eggs: 5 clicks on the version badge (tips and stats), Konami code on popup and
  Settings (colour party, accent restored), milestone note at 100/500/1000/5000/10000 skips.
- 5S: README and TESTING.md rewritten to match the code (no IntroDB key needed, privacy is not
  "no telemetry"); SECURITY_AUDIT.md moved to knowledge/audits; unused `update_release.py` and
  `agent_team/crew_master.py` moved to knowledge/archive/unused. Branch cleanup: merged remote
  branches deleted by the packet (list in its report); release tags kept.

## Open (not code yet)

- Check this page on 1Shows listed only the main page while the player played; use Site report.
- 1Shows showed three subtitle lines, one ours; confirm with CC on/off.
- Anime Skip needs a live test with a client id. SkipDB answers are not yet seen live.

## 3 Oct 2026 (release 1.11.0 packet)

- **Sweep** (`os-sweep-20261003`, owner Cloud Shell, RESULT OK): main `fe91918b` (tree `38b74d02`);
  #71, #72, #73, #77 merge cleanly in that order; tests 41, 45, 59, 73, 73; Mozilla addons-linter
  10.6.0: 0 errors, 0 warnings on main and on the merged tree. Trees: after #73 `e7154a14`,
  after #77 `cd547d32`.
- **Release PR** (`packet/release-1.11.0-20261003`, one big update by owner request) builds on
  tree `cd547d32` only: H23b (`technicalAndInteraction` optional, checked before every send of
  stats, settings and device name); PRIVACY.md rewrite (D1); Credits card (TMDB, SponsorBlock);
  backup v2 (settings, rules, stats, history merged; optional encrypted keys and logins;
  optional sync identity = "Link devices"); iframe detection without the 5 s cutoff, plus
  shadow-root players; "Skipped X, Undo" notice; popup "Check this page"; Chrome keepalive
  removed; D2; CodeQL `cpSync`; version 1.11.0 in all 7 files plus updates.json. Tests 97
  (24 new; 20 fail on the old tree, 4 are guards).
- **Second review round, same PR** (owner asked for every logic before running anything):
  embedded players now use the tab's real address and title (`GET_TAB_INFO`; browsers send only
  the parent origin as referrer, so history saved the home page and the title "Player");
  `_cleanTitle` (site name and filler only); URL ids for `/movies/603-x`, `/embed/tv/1399/1/2`,
  `?tmdb=`; `[\/-_]` range bug in the S/E pattern; movie pages ignore sidebar S/E; show pages
  without S/E are not looked up as movies; TMDB id checked against the page title; exact-title
  TMDB match when no id (`TMDB_FIND_TITLE`, ambiguous names refused); posters by TMDB id first,
  exact-name search, films first for film titles, portrait w185, cache key `poster2:`;
  "Find subtitles" by title (popup only, never YouTube); auto-skip waits for the real start;
  next YouTube video resolves at once; `?v=` on other sites is not YouTube; Alt+Z on macOS.
  Tests 118 (21 new in identify.test.mjs, all 21 fail on the first packet's tree).
- **Device test of #79 (owner, 3 Oct 16:00)**: first run was the old build (1.10 popup text);
  check the version in about:debugging first. On 1.11.0: CC button, history title and poster
  on 1Shows OK; YouTube subtitles reason OK; backup export/import with keys OK. Found:
  "Find subtitles" gave NetworkError (download link on www.opensubtitles.com, blocked by
  connect-src since before 1.10: fixed with *.opensubtitles.com); backup card had no short
  steps (added). Open: Undo notice not seen on YouTube; Check this page listed only the top page.
  Added for the retest: Check this page now shows per player what was identified, skips found,
  mode, last skip (notice shown / undone) and subtitles; shadow walk throttled to 2 s.
- **Found 3 Oct: cross-device sync did not work since 19 Jul** (c89ec20, in 1.10.0): each install
  has its own random `skipstream_install_id`, every RPC filters by it. 1.11.0 lets the owner
  link browsers with a backup; the Supabase login in 1.12.0 is the full fix.
- **Found 3 Oct: embedded players were dropped after 5 s** (`_waitObs` timeout): a frame whose
  video appeared later never started. Owner symptom: 1Shows/viduki "works sometimes".
- **Owner steps, in order**: device test #73; merge #71, #72, #73, #77; run the release packet;
  merge its PR; push tag `v1.11.0` (this publishes to AMO via amo-submit.yml); AMO listing.
- **Owner decisions 3 Oct**: every user brings their own API keys (no shared SkipStream keys);
  login to the user's own Supabase should restore keys, settings and history on every device.
  TV: no TV browser with extensions is worth supporting; HDMI or a mini PC with desktop Firefox.

## 1 Oct 2026, afternoon (end of the combined session)

- **main** `91f8b752` (PR76: roadmap and agent tooling). #71, #72, #73 still open.
- **Release decision: wait.** Nothing has gone to AMO since v1.10.0 (4 Aug 2026). Everything
  since sits in #71 to #73, and #73 is not device-tested yet.
- **H23 is in a PR, not merged**: branch `packet/h23-data-collection-20261001`. It changes the
  Firefox `data_collection_permissions` from `none` to `browsingActivity`, `websiteContent` and
  `authenticationInfo`. The PR body explains each category; the owner reviews it on the weekend.
- **Weekend 3 and 4 Oct, in order**: device test #73; merge G #71, F #72, H #73; review and merge
  the H23 PR; make PRIVACY.md (D1) match the declaration; bump to v1.11.0 and release; upload to
  AMO and update the listing (icon, screenshots from the device test).
- **Then**: the UI polish packet (29 Sep, 12:30 section below).
- **Chats**: from 1 Oct the owner keeps one assistant chat per repo. A SkipStream chat starts here
  and never carries patch-factory rules.

## 1 Oct 2026, 01:30 IST (planning only, no code)

- **main** `b085e982` (PR75). #71, #72, #73 still open; nothing merged since 29 Sep.
- **New**: [ROADMAP.md](ROADMAP.md) puts the agent and security work into lanes after the
  weekend merges; [handbook/AGENT-TOOLING.md](handbook/AGENT-TOOLING.md) records the 1 Oct
  tool review. No workflow or code change.
- **Read on 1 Oct**: the agent workflows show the model at most 80,000 characters, which cuts
  off most of `content.js`, and their PRs use `GITHUB_TOKEN`, so CI does not run on them.
  Details in ROADMAP lane 3.

## 29 Sep 2026, 13:45 IST (end of the migration session)

- **main** now includes #74 (this `knowledge/` folder). Nothing else merged since `e4af184`.
- **Closed**: #60 as not planned, a duplicate of #61; the feature shipped in PR #62.
- **Open PRs unchanged**: #71 (G), #72 (F), #73 (H). Owner plan: device test of #73 on the
  weekend of 3 and 4 Oct 2026, then merge G, then F, then H.
- **AMO listing** (icon, screenshots) the same weekend, using screenshots from the device
  test. Browser only, no code. H23 blocks the next version upload, not the listing edit.
- **Assistant notes**: the skills are now short pointers to this folder and their sub-skills
  are archived. This folder is the record; do not rebuild state in skills or memory.
- **Next session**: after the merges, the UI polish packet (see the 12:30 section below).
  Read live `/pulls/71`, `/pulls/72`, `/pulls/73` first.

## 29 Sep 2026, 12:30 IST

**main** `e4af184` (tree `0bfe56a6`): packets A to D merged today (including #68 cloud sync
and #70 Supabase lock-down), then dependabot #64 (codeql-action 3.37.9 to 3.38.0).

**Open PRs, none merged. Merge order G, then F, then H, after the owner's device test.**

| PR | Packet | Head / tree | Notes |
|---|---|---|---|
| #71 | G: CodeQL fixes | tree `f376ae52` | 45 tests at build time |
| #72 | F, F2, F3, F4: agent fleet | `baeefa3` / `9c76707e` | 55 tests. Probe run 36531885296: 3 of 3 seats answered (gemini-3.6-flash, NVIDIA gpt-oss-20b, OpenRouter nemotron-3-ultra free) |
| #73 | H: popup, options, engine | `d2bd829` / `eec8de1c` | 55 tests (tests/ui.test.mjs: 14 new, 13 fail on main) |

G + F + H merged together locally: 73 of 73 tests pass, DOM contract OK. Local only.

**Settings the owner made**: repository variable `AI_MODEL_GEMINI=gemini-3.6-flash`.
Secrets GEMINI, NVIDIA and OpenRouter keys are set; never ask for their values.

**Done today**: #63, #65, #66 closed. CodeQL alerts 14, 29, 31, 42 dismissed with reasons.
Supabase: open `using(true)` anon policies dropped, `setup_complete` true.

### UI decisions made in H (owner may veto)

- Popup file input removed: Firefox destroys the popup when a file picker opens (Mozilla
  bug 1378527). Replaced by **Find subtitles for this video**, which asks the page to fetch
  online subtitles and shows a reason for every failure (no player, no id, no results,
  navigated, unreadable). The on-video CC button still opens the picker inside the page.
- The empty Segments section was removed from the popup.
- The options subtitle position slider became a **text-size** slider (12 to 40 px).
  Position is set by dragging the subtitles on the video.

### Deferred or owner-side

- Owner: permanent Firefox install and the device test of #73, then merges.
- UI polish pass on popup and options (owner is not satisfied; next session). Check
  popup.css/options.css against ARCHITECTURE-AND-UI rules: type sizes 12/14/16/20/28,
  radii 8/16/pill, no backdrop-filter, 44 px touch targets, no viewport units in popup.css.
- Packet E: IntroDB segment submit.
- Audit items not started: see [audits/STATUS.md](audits/STATUS.md) (H6, H8, H23, H25, C3,
  C7, C11, C12, C13, O4). **H23 blocks the next AMO upload** (manifest data-collection declaration).
- Close #60 (duplicate of #61): needs the owner's OK.
- AMO listing (icon, screenshots), video title on aggregator sites (needs a postMessage or
  TMDB decision first; not an agent job), Fable review items (content-type check before
  `.json()`, posterCacheKey collision).

### Start here next session

Read live `branches/main` and the three PRs. If the owner has tested #73, the next packet is
the UI polish pass. Build on the exact live tree; stop if it moved.

## 5 Sep 2026 and earlier

See [archive/skills/SKIPSTREAM-CURRENT-STATE.md](archive/skills/SKIPSTREAM-CURRENT-STATE.md).
Most of its queue was completed by packets A to D and H.
