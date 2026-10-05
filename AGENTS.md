# AGENTS

The one rules file for every person and agent working here (os-147, 5 Oct 2026).
`CLAUDE.md` and `GEMINI.md` only point here. Agent workflows read this file. The code and
live GitHub state win where they disagree; `knowledge/README.md` is the history.

## What this is

SkipStream: a browser extension (Firefox MV2 + Chrome MV3) that skips intros, recaps and
credits, presses the platforms' own Skip buttons, skips SponsorBlock segments on YouTube,
resumes videos, shows OpenSubtitles subtitles, and can sync history to the user's own
Supabase project. Vanilla JS. No build step, no npm, no bundler, no TypeScript. Do not add one.

## Repository layout

```
manifest.json              Firefox MV2 (authoritative version source)
manifest-chrome.json       Chrome MV3 (same version, same CSP hosts)
background.js              all network calls, retry logic, install id, Supabase RPCs
content-scripts/content.js every frame: video detection, skips, resume, subtitles, sync
content-scripts/probe.js   the popup's "Site report" scan
popup.html / popup.js / popup.css         toolbar popup
options.html / options.js / options.css   Settings page
theme-engine.js            OKLCH palette; writes colour tokens on <html> for both pages
supabase_setup.sql         one-time, idempotent setup the user runs in their project
updates.json               version list (not wired to auto-update; Lint & Validate checks it)
scripts/                   amo-update.js, ai_call.py, ai_edits.py, agent_desk.py, dom-contract.py
tests/                     node:test suites (harness.mjs), fixtures/agent-exam (not shipped)
knowledge/                 state, lessons, audits, handbook, agent desk (knowledge/agents/)
```

## Hard rules (CI fails otherwise)

- No `fetch()` and no `localStorage` in `content-scripts/`: the content script asks the
  background with `runtime.sendMessage`.
- No `innerHTML` anywhere: `createElement`, `textContent`, `appendChild`.
- No `console.log` in shipped code; `console.warn` only for diagnostics.
- Every element id that options.js reads exists in options.html (`scripts/dom-contract.py`).
- Install id: `crypto.randomUUID()` per install in `skipstream_install_id`. Never derive it
  from the anon key (settled; see knowledge/agents/SETTLED.md).
- Never pass a host name to `.includes()` or `.indexOf()`; compare `new URL(x).hostname`
  exactly (CodeQL, 5 Oct 2026).
- Firefox stays MV2 with `strict_min_version` 140.0. Decided, not a bug.
- No unlicensed streaming site is named anywhere in the repository (owner decision 5 Oct
  2026; tests/v1131.test.mjs and tests/knowledge.test.mjs check it by hash).

## Messages (content, popup and options to background)

The full list is the `onMessage` switch in background.js. The common ones:
`GET_USER_ID`, `SUPABASE_UPSERT`, `SUPABASE_GET`, `SUPABASE_GET_ALL`, `FETCH_SEGMENTS`,
`TMDB_TO_IMDB`, `TMDB_SEARCH_POSTER`, `OSUB_SEARCH_AND_FETCH`, `GET_TAB_INFO`,
`SS_DIAG_REPORT`, `SUPABASE_SETTINGS_UPSERT`, `SUPABASE_SETTINGS_GET`. The content script
answers `GET_VIDEO_TIME` and `GET_SHOW_INFO`. Supabase traffic uses only the `ss_*`
security-definer RPCs in supabase_setup.sql; the tables have no policies and no grants.

## Versions and releases

- One version in 7 places: `manifest.json`, `manifest-chrome.json`, the `popup.js` header
  `/* SkipStream - popup vX.Y.Z */`, the `popup.css` header, the README badge and release
  link, a `## [X.Y.Z] - YYYY-MM-DD` entry at the top of CHANGELOG.md, and the last entry of
  `updates.json`. The release packet bumps all of them in its PR; there is no bump workflow
  (retired in os-147). tests/v1131.test.mjs reads the version from manifest.json.
- Pushing tag `vX.Y.Z` runs `release.yml` (checks, ZIPs, GitHub release), then
  `amo-submit.yml` uploads the Firefox ZIP to AMO. `cws-submit.yml` is manual only: there is
  no Chrome Web Store account. Edge Add-ons takes the Chrome ZIP by hand (Partner Center).
- Any file that ships must be in the file lists of `release.yml` (Firefox zip and Chrome cp),
  `amo-submit.yml`, `cws-submit.yml` and `validate.yml`. validate.yml fails if a required file
  is missing from either ZIP; extend that guard with every new shipped file.

## Verify before you claim

Run these and paste the real output. "Done" without them is not evidence; UNVERIFIED is
an acceptable answer.

```
node --check <each changed .js file>
node --test --test-reporter=tap tests/*.test.mjs     # gate on the exact pass count
python3 scripts/dom-contract.py                      # must print: DOM contract OK
```

- A new test must fail on the old code. Say which tests failed on main.
- Touch only the files the task names. Small diffs, no drive-by refactors, no new storage
  keys without a reason in the PR.
- There is one non-technical primary user. A change she would not notice is not a priority.
  Correct numbers beat styling.

## UI rules (popup, Settings, on-video UI)

- Native, light, fast, accessible. No frameworks, no build tools, no redesign without a request.
- Theme: light, dark or system. The popup's choice is the source of truth; Settings follows it.
  theme-engine.js writes every colour token inline on `<html>`. Never redefine a colour token
  under `body.theme-*`: a property on body beats the inline one and kills the accent picker
  (shipped twice). `:root` blocks are pre-paint fallbacks only.
- Five type sizes: 12, 14, 16, 20, 28 px (body 16). Radii 8, 16, pill. Spacing from the token
  scale. popup.css and options.css use different token names: never assume one exists in both.
- 44 px touch targets, visible focus, WCAG AA contrast, reduced motion respected. Animate only
  transform and opacity. No `backdrop-filter` (Firefox Android bug), no viewport units in popup.css.
- On video: find player parts by what they do (role, size, place), never by one player's class
  names, and never insert into another app's DOM that re-renders: draw an overlay.
- Every action must be reachable by touch: Firefox for Android has no keyboard commands.

## Agents

- The **agent desk** (`.github/workflows/agent-desk.yml`, contract in
  `knowledge/agents/README.md`) only finds and cross-examines; a script keeps verified quotes.
  Skills live in `knowledge/agents/skills/`, settled items in `knowledge/agents/SETTLED.md`,
  tasks in `knowledge/agents/BACKLOG.md`.
- Fix agents (`ai-fix-pr.yml`, `sweep.yml`) run only for the owner and use the find/replace
  edit contract in `scripts/ai_edits.py` (allowed files only, never `.github/`). Their PRs are
  made with GITHUB_TOKEN, so PR checks do not start until the owner closes and reopens the PR.
- Repository variable `AGENTS_PAUSED=true` stops every agent workflow.
- Agents never merge, publish, delete, change settings or fill in an owner decision.

## Knowledge base

Read `knowledge/README.md` first: the working agreement, the dated state, lessons from past
wrong calls and audit status. Add session notes there, dated and append-only.
