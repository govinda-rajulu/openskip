<!-- archived from assistant skill 'SkipStream Current State', last updated 2026-09-05 16:42 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Verified state of govinda-rajulu/openskip as of 5 Sep 2026. Load with SKIPSTREAM-RELEASE-WORK; where they disagree, this file wins. -->

# SKIPSTREAM-CURRENT-STATE (written 5 Sep 2026 13:05 IST)

Written 5 Sep 2026 13:05 IST from a live API read plus his own terminal output.

**Where this disagrees with SKIPSTREAM-RELEASE-WORK or its sub-skills, this wins.** Those were written before the 4-5 Sep session and several of their claims were disproved in it. The two draft session files in particular are now largely spent: load SUPERSEDED-CLAIMS.md for the file-by-file list before trusting anything in them.

Still good in the parent skill and not repeated here: the frame model is designed not accidental, the audit's proven-false findings, the Supabase and CodeQL triage, the UI and theming rules.

## State, verified 5 Sep 12:52 IST

- `main` = **`ce4a639`**, 5 Sep 07:05 UTC, parent `b101e63`.
- `content-scripts/content.js` = **81,978 bytes** (81,319 at `b101e63`).
- Anchors, from his 4 Sep grep, still valid: `parseSubs` 1362, `ensureCCBtn` 1513, button id 1517, `initSubtitles` 1582, subtitle `storage.onChanged` 1612, `initSubtitles` caller 1728, `getSitePrefs` 164 with call sites 549, 1189, 1217, 1776.
- On-screen UI that exists, and matters because job 2.2 needs one: `mountOverlay` 85, `showResumeToast` 462, `showSkipCountdown` 882, `showSkipBtn` 1310, `renderSubFrame` 1488.
- Open issues **60 and 61**: the same CC-button spec filed twice. 61 is the one that was worked; close 60 citing PR 62.
- Open PRs: none. Branches on GitHub: `main` only.
- AMO still ships 1.10.0 with the grey placeholder icon, `previews: []`, `average_daily_users: 2`. Ten minutes in a browser, still not done, still the best value per minute on the board.

## What landed: PR 62, the dual-purpose CC button

In `ensureCCBtn`'s existing click handler, when `_subState.subs` is empty it creates an `input[type=file]` in the page, calls `.click()` synchronously, and writes the file text to `subtitle_override_srt`. The listener at 1612 already re-parses and re-renders, so there was no new plumbing. +659 bytes, one file, seven checks green, `Lint & Validate` pass in 9s. **Verified present inside the built ZIP**: run 33951611098, 72,161 bytes.

Firefox destroys a `browser_action` popup the instant a file picker opens (Mozilla bug 1378527), which is why the picker must live in the page. The `.click()` must not sit after an `await` in the handler or Firefox blocks it silently, which looks identical to the bug being fixed.

**It has never run in a browser.** The permanent install still does not exist.

## The one test that matters, and how to read it

Install the XPI from run 33951611098 in Firefox Developer Edition (`xpinstall.signatures.required` false; `about:addons` -> gear -> Install Add-on From File; it must appear as a normal add-on, **not** under Temporary). Then: YouTube video, click CC with no subs loaded, pick a CRLF `.srt`.

- Picker opens and subtitles render -> done, and the CRLF fix is proven against a real file for the first time.
- Picker opens, nothing renders -> the file landed and `parseSubs` is at fault. Different bug; ask for the file.
- Picker never opens -> the user-gesture rule. One line.

## `getSitePrefs`: settled, patch written, NOT applied

Both earlier notes were half wrong. Read from real source on 5 Sep: the function is plainly synchronous, **but it starts an async storage read inside itself**. So all three defects are real:

1. `rules` starts `null` and the function returns `basePrefs` while null, so the first call on any page ignores the per-site rule. Line 549 gates all skipping on that value.
2. `.ts` is stamped before the read resolves and the `.catch` is silent, so a failed read leaves `rules` null for 5s with no retry.
3. The 5s refresh runs in every frame (`all_frames: true` on ``), so every ad iframe does its own storage round-trip forever.

Fix, replica-tested at +200 bytes with `node --check` and `DOM contract OK` but **never applied to the repo**: cache becomes `{ rules: {} }`, read once at init, stay current via a `storage.onChanged` listener on `skipstream_site_rules`, delete the polling branch. Function stays synchronous so the four call sites do not move.

**Testable without the permanent install**: set a per-site rule in options, hard-reload the video page. The extension is not reloaded, so storage survives even a temporary add-on.

## `scripts/agent.sh` is unsafe on committed work

Read end to end 5 Sep, having only skimmed it before.

- Three of `gate`'s checks (CSS-class-exists, inline styles, the storage-key rule) use bare `git diff`, blind once a change is committed, and it saves that as `~/diff-N.patch`. Proved in a throwaway repo: with the work committed the storage grep returns 0 regardless of the code and the patch is **0 bytes**. It prints "All gates green" having inspected nothing.
- Its failure path is `git checkout -- .`, `git clean -fd`, `git checkout main`, `git branch -qD agent/issue-N`. On **committed** work that leaves the commit unreachable from any branch, reflog only. On uncommitted work the revert is correct and is what it was built for.
- So never run `gate` before establishing whether the agent committed. If it did, `git reset main` first; `--soft` is not enough, it leaves the change staged and still invisible.
- `prep` requires an OPEN issue, so **clearing the tracker to zero disarms the harness**. File the spec as an issue first; that body is also what the agent reads.

## Still genuinely UNVERIFIED

- The CRLF parse against a real file. Eight synthetic cases passed; no upload has ever landed.
- Whether Firefox Developer Edition honours `xpinstall.signatures.required` on his build.
- Whether the Codespaces monthly quota has reset. No CLI read exists for it; check the billing page or just try to open one. Nothing planned needs it.

## Next, in order

1. Install and run the one test above. Everything else is guessing until it happens.
2. Apply the `getSitePrefs` patch. Self-contained, and testable without the permanent install.
3. Job 2.2, a visible reason for every subtitle failure. Model it on `showResumeToast` at 462.
4. Job 2.3 online-fetch trigger, then 2.4 deleting the popup file input. That order matters: 2.4 removes what 2.3 replaces. `background.js` already implements the whole OpenSubtitles path.
5. Audit hardening: require every finding to quote its source line, which makes fabrication self-evident the way whole files stopped truncation.
6. AMO listing. Browser, ten minutes, no dependencies.
7. Video title on aggregator sites. Genuinely cross-origin, needs a postMessage or TMDB decision first, and an agent will produce something that looks right and fails silently on exactly the sites that matter. Its own session.

## Sub-skills

- SUPERSEDED-CLAIMS.md - which specific claims in the older openskip skills are now dead, file by file. Read before trusting the two draft session files, or before writing anything back into them.
- MY-WRONG-CALLS-4-5-SEP.md - eleven wrong calls in two days and the one rule they produce. Read before proposing a fix or writing a gate on this repo.
