<!-- archived from assistant skill 'SkipStream Release Work', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load for any work on govinda-rajulu/openskip (SkipStream browser extension) releases, AMO, theming, on-video UI, the agent fleet, open bugs. -->

Load **SOLO-REPO-ENGINEERING** alongside this. It holds the verification discipline, executor prompting rules, surface selection, Codespaces gotchas, hand-run-infrastructure safety and delivery format that apply here and to `patch-factory`. This skill is only what is specific to `openskip`.

Different repo, different stack from patch-factory. Nothing from the APK-patching rules applies here.

## What this is

`github.com/govinda-rajulu/openskip` (**SkipStream**): a Firefox MV2 + Chrome MV3 extension that skips intros/recaps/outros, clicks platforms' own Skip Intro buttons, blocks YouTube sponsors, syncs playback to Supabase, and overlays OpenSubtitles subtitles. Vanilla JS, no build step, no bundler, no package.json.

**There is exactly one non-technical first user, and their judgement outranks technical arguments about priority.** A change the first user would not notice is not a priority. (patch-factory is the repo built for Govind himself.)

## Live state, verified 5 Sep 2026 13:30 IST

| thing | value |
| --- | --- |
| main | ce4a639 , 5 Sep 07:05 UTC, parent b101e63 |
| content.js | 81,978 bytes (was 81,319 at b101e63) |
| options.js / background.js / popup.js / popup.html | 58,777 / 37,830 / 12,878 / 10,830 |
| branches on GitHub | main only |
| open PRs | none |
| open issues | 60 and 61 , same CC-button spec filed twice. Close 60 citing PR 62. |
| AMO shipped | 1.10.0 , XPI 78,743 bytes, reviewed 4 Aug |
| AMO listing | icon_url = default grey placeholder. previews: [] . avg daily users 2 . weekly downloads 0 . ratings 0 . |

Anchors in content.js, from a real grep 4 Sep, valid at 81,978 bytes:  
`getSitePrefs` 164, `_siteHost` 218, `getSiteHostname` 225, `parseSubs` 1362, `ensureCCBtn` 1513, btn id 1517, `initSubtitles` 1582, subtitle `onChanged` 1612, `initSubtitles` caller 1728. getSitePrefs call sites: **549, 1189, 1217, 1776**.

On-screen UI that exists: `mountOverlay` 85, `showResumeToast` 462, `showSkipCountdown` 882, `showSkipBtn` 1310, `renderSubFrame` 1488.

## What landed in the 30 Aug to 5 Sep session

**PR 52** per-site skip counts in Stats. **PR 53** CRLF+VTT parse + imdbId gate removal. **PR 57** dependabot. **PR 58** audit fix (FILE_CAP 200k, SETTLED list, `FANOUT_ENABLED=false`; 19 findings to 8). **PR 62** CC button picker: in `ensureCCBtn` click handler, if `_subState.subs` empty, creates `input[type=file]` in page, `.click()` synchronously, writes text to `subtitle_override_srt`. Listener at 1612 re-parses + re-renders. +659 bytes, 1 file, 7 checks green, `Lint & Validate` 9s. Verified present inside built ZIP, run 33951611098, 72,161 bytes.

Tracker was at zero open issues on 3 Sep (cleanest ever), then 60 and 61 opened for the CC spec.

## What is NOT done

- **No permanent install exists.** Temporary add-on = fresh storage each load, half the test sheet unanswerable.
- **PR 62 has never run in a browser.** Zero device evidence.
- **`getSitePrefs`** fix: patcher written, replica-tested, **never applied**. Three real defects: first call ignores per-site rule because `rules` starts null, `ts` stamped before read resolves plus silent `.catch`, and 5s poll runs in every frame (`all_frames:true`).
- Jobs 2.2 / 2.3 / 2.4 (visible failures, online fetch trigger, remove popup file input). Audit hardening #2. AMO listing. Video title on aggregators.

## Queue, ordered

1. **The permanent install test.** Blocks everything stateful.
2. **`getSitePrefs`** fix (patcher exists, not applied). +200 bytes, testable without permanent install.
3. **Job 2.2** every subtitle failure gets a visible reason. Model on `showResumeToast` 462.
4. **Job 2.3** popup trigger for online fetch. It is gated, not missing.
5. **Job 2.4** delete popup file input. Must come AFTER 2.3.
6. **Audit hardening #2**: require every finding to quote its actual source line.
7. **AMO listing.** 10 min, zero code, best value per minute on the board.
8. **Video title on aggregator sites.** Biggest user-facing bug. Needs a postMessage or TMDB decision first. Do NOT give to an agent.

## Where the rest lives

Load the sub-skill that matches the job:

- **SUPABASE-AND-SECURITY** - Supabase project, sync, auth, CodeQL triage.
- **ARCHITECTURE-AND-UI** - frames, theming, on-video UI, performance rules, skip engine.
- **REPO-LANDMINES-AND-AGENTS** - repo config traps, the free agent fleet, what is worth building.
- **RELEASE-AND-AMO** - release mechanics, the AMO listing, the weekly audit.
- **FIXED-WORK-AND-WRONG-CALLS** - what is already fixed, and agent errors. Read before recommending anything.
- **OPEN-ITEMS-AND-QUEUE** - device checks, unverified bugs, known open bugs, requested features.
- **SESSION-LOG-NEEDS-VERIFICATION** - NEEDS VERIFICATION. The 30 Aug-3 Sep session. Load before planning subtitles, audit, getSitePrefs, or CI.
- **SESSION-TOOLING-AND-CI-FACTS** - what CI really enforces, patching practices, ideas that died.

**The rule that overrides everything:** the first user is the real judge, so a change the first user would not notice is not a priority.

## Dead ideas. Do not resurrect.

- **The frame guard.** His device test killed it: counter moves by 1, not 2. content.js has deliberate top-frame guards.
- **The duplicate hostname pair.** `_siteHost` strips `www.`, `getSiteHostname` keeps it. Consolidating silently changes stored data.
- **Empty Segments / Playback panels.** options.html has exactly five panels. Nothing to cut.
- **Copying the userscript's parser.** Same CRLF bug, same VTT gap, plus drops cues starting at 00:00:00.
- **Audit findings already disproved**: MV2 deprecation, retry-on-4xx, applyThemeFromSeed, Math.cbrt polyfill, the userId rule.
- **`fetchOembedThumb`** from audit 59: fabricated function, fabricated line, fabricated violation.
- **`SKIP_SELECTORS`** is dead code: one reference, its own declaration around 1024.

## Architecture quick-ref (verified anchors at 81,978 bytes, ce4a639)

Stats keys: `skipsTotal`, `skipsToday`, `statsDate`, `timeSavedSec`, `timeSavedToday`, `sessionsTotal`, `skipsBySite`.  
On-screen UI functions: `mountOverlay` 85, `showResumeToast` 462, `showSkipCountdown` 882, `showSkipBtn` 1310, `renderSubFrame` 1488.  
Top-frame guards: 219, 226, 233, 772, 1974. PostMessage relay: 1313-1341.  
CC button: `ensureCCBtn` 1513, btn id 1517. Picker creates `input[type=file]` in page, `.click()` synchronously. `storage.onChanged` listener at 1612 re-parses + re-renders.  
Subtitle parse: `parseSubs` 1362 handles CRLF + VTT + BOM. `initSubtitles` 1582, caller at 1728.  
Skip engine: `NATIVE_SKIP_SITES` maps 10 hosts. `clickSkipByLabel`/`clickNextByLabel` floor at 700ms.  
`SKIP_SELECTORS` at ~1024 is dead code (one reference, its own declaration).  
Tooling: Node 24.19.0, Python 3.12.3, gh 2.98.0, gemini 0.57.0, jq present on Cloud Shell.  
CI built ZIP for ce4a639: run 33951611098, 72,161 bytes. 7-day retention.

## Fable code review triage (5 Sep 2026)

An external review (Claude Code / Fable 5.1) produced 13 findings. Triaged against existing skill knowledge:

**Valid, worth carrying forward:**

- Content-type header validation before `.json()` calls. API 500s return HTML, crashing the parse. Add `r.headers.get('content-type').includes('application/json')` checks to SUPABASE_GET, SETTINGS_GET, GET_ALL routes.
- Input validation helpers (`validateString`, `validateInt`) on message handlers. Defense in depth: trim + typeof before passing userId/mediaId/imdbId to APIs.
- `parsePageInfo` at 656: stringify only `obj` (the first array element), not the raw `data`. Saves one re-stringify per page.
- posterCacheKey: both mediaId and title can be null, producing the same cache key. Minor but real collision.

**False, already disproved or handled:**

- MV2 deprecated: FALSE. Mozilla supports MV2 indefinitely. Chrome unpublished by choice. This finding BROKE the extension (manifest_version 3 + service_worker rejected by Firefox).
- fetchWithRetry retry-on-4xx: FALSE. Triage on issue 44 already disproved.
- OSUB session expiry: FALSE. `osubGetSession()` already checks `sess.expiry > Date.now()`.
- Rate limiting on segment fetch: FALSE. Debounced by URL-change observer at 13s.
- Supabase creds exposed: NOISE. Anon key is by design, RLS via security-definer functions.
- Error log unbounded: FALSE. Already capped at 20.

## Phased execution plan (from master plan artifact, 5 Sep)

**Phase 0: Permanent install.** Firefox Developer Edition, `xpinstall.signatures.required` false, install built ZIP as .xpi. Gate: appears as normal add-on, NOT under Temporary. Blocks all stateful testing.  
**Phase 1: Merge green PRs.** Gets imdbId fix + CRLF fix into the permanent install.  
**Phase 2: Subtitle UX.** Job 2.1 = dual-purpose CC button (picker in page). Job 2.2 = visible failure reasons (model on showResumeToast). Job 2.3 = online fetch trigger from popup. Job 2.4 = delete popup file input (AFTER 2.3).  
**Phase 3: getSitePrefs fix.** Patcher exists, not applied. Testable without permanent install.  
**Phase 4: Audit hardening.** Require source line quotes. Fix console rule (CI mandates warn, audit bans it).  
**Phase 5: Release prep.** Version bump (5 CI-checked files), AMO listing (10 min, zero code), tag, ship.  
**Phase 6 (deferred): Video title on aggregators.** Needs postMessage or TMDB decision. Do not give to an agent.

## Live state update (web search 5 Sep 17:50 IST)

**Open issues: 17** (not 2 as the handover said). The handover counted only the CC-button issues (60, 61). The repo has accumulated bot-filed issues (store-check secrets #39, #40) and others. First action in next session: `curl -sS "https://api.github.com/repos/govinda-rajulu/openskip/issues?state=open&sort=created&direction=desc&per_page=30"` to get the full list.

**Fable's changes were NOT pushed.** Confirmed by user. main is still at ce4a639 with the original MV2 manifest.

A **`beta-testing`** branch exists (7 commits ahead, 164 behind main). Contains popup redesign and history features. Stale.

**Store-check issues #39, #40** show AMO at 1.7.11 and CWS as "unknown" (no secrets). These are from July when the repo version was 1.7.11. AMO was confirmed at 1.10.0 by the handover (the store-check reads repo version, not AMO).

**CWS secrets not configured.** Chrome Web Store is unpublished by choice, but the cws-submit workflow fires on release and fails silently.
