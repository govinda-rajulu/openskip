# openskip state

Newest checkpoint first. Each section is a dated snapshot; verify live before acting.

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
