# Backlog for agents and the owner

Written 5 Oct 2026 from audits/STATUS.md, ROADMAP.md and STATE.md. `agent_desk.py seed`
turns each task into one issue (label `agent-task`) once. Agents may hunt and propose on
these; until the exam rule in README.md is met, the owner and the assistant do the fixes.
Each task names its evidence and when it is done.

## T01: One subtitle file per show, not one for every video (audit C11)
Kind: bug. Where: content-scripts/content.js (`subtitle_override_srt`).
An uploaded .srt applies to every video and site until it is cleared. ROADMAP confirms it is still global.
Done when: a file loaded on one show does not appear on another; a test fails on the old code.

## T02: Leaks: retry timers, subtitle overlay listeners, one keydown listener per video (audit C13)
Kind: bug, performance. Where: content-scripts/content.js.
Done when: each listener or timer has one owner that removes it; a test counts listeners after 3 videos.

## T03: Whole-document observers run in every frame (audit H8)
Kind: performance. Where: content-scripts/content.js (`_domObserver`, `_skipBtnObserver`).
Done when: frames with no video do no per-mutation work; a test with 20 empty frames shows zero scans.

## T04: Cloud preferences apply only when local has no skipMode (audit O4)
Kind: bug. Where: options.js. Re-read the code first: packets B and H changed the pull.
Done when: the rule is written down (newer wins or local wins) and a test proves it.

## T05: The pushState wrap runs in the content-script world and never sees page calls (audit C3)
Kind: dead code. Where: content-scripts/content.js. Navigation is found by popstate and polling.
Done when: the wrap is removed or replaced by a method that works, with a test.

## T06: Remaining console.warn calls (audit C12, 2 of 5 left on 29 Sep)
Kind: quality. Where: content-scripts/content.js. Count them first; some may be gone.
Done when: each one is removed or justified in a comment.

## T07: The last save on tab close can be lost (audit H25)
Kind: bug. Where: content-scripts/content.js (pagehide/beforeunload). 1.13.0 pushes every 20 s and on pause and hide; measure what is still lost.
Done when: a test shows the position at most 20 s old after a simulated close, or the task is closed with evidence.

## T08: Check that the 5 s iframe cut-off is gone (audit C7, fixed by X2 in 1.11.0?)
Kind: verify. Where: content-scripts/content.js. STATUS says deferred; 1.11.0 says fixed.
Done when: a test proves a frame that builds its video after 10 s still attaches, and STATUS.md is corrected.

## T09: Store screenshots and a headless UI test
Kind: feature (CI). AMO shows 0 screenshots; Edge needs 1280x800 or 640x480. One Playwright job loads the Chrome build with demo data (no personal data), opens the popup, Settings and a test video page, and saves screenshots at 1280x800, 640x480 and README size, plus a pass/fail UI smoke check.
Done when: a manual workflow run uploads the images as an artifact and fails if the popup does not render.

## T10: Edge Add-ons listing
Kind: owner. Partner Center registration was blocked by Microsoft's trust check (ref 715-123225) on 5 Oct; email ext_dev_support@microsoft.com with the correlation id. The Chrome ZIP from each release is the package.
Done when: the listing is live, or Microsoft answers no.

## T11: Supabase login (1.14.0)
Kind: feature. ROADMAP "Next". Replaces the per-install id with auth.uid(), claims old rows on first login, one connection code for a new device. On 5 Oct the owner's project held 8 install ids; phone and laptop were never linked.
Done when: a spec with acceptance tests is written (skills/FEATURE-SPEC.md), then built in its own packet.

## T12: A confirm step before OpenSubtitles searches by title
Kind: feature. ROADMAP parking lot (3 Oct). Show the match (name, year, kind) and let the user accept it.
Done when: the popup shows the match before loading; a test covers accept and cancel.

## T13: Required checks on main
Kind: owner. On 5 Oct only "Lint & Validate" was required; strict off; admins not enforced. CodeQL failed unseen on PR #81 for 9 packets.
Done when: Tests and CodeQL are required checks (owner setting).

## T14: Agent pull requests get no CI
Kind: owner decision. PRs made with GITHUB_TOKEN start no pull_request workflows. Options: close and reopen the PR by hand, or a GitHub App token.
Done when: the owner picks one and AGENTS.md says which.

## T15: Old install ids in the owner's Supabase project
Kind: owner, destructive. 8 install ids hold rows (some from temporary add-on loads). Clean-up SQL deletes rows of ids no browser uses any more.
Done when: the owner runs a reviewed SQL with a count before and after, or decides to keep them.

## T16: Re-enabling the master switch must restore the previous mode (audit H27)
Kind: bug. Where: popup.js. Re-read first: packet H may have fixed it.
Done when: a test turns the switch off and on and gets the old mode back, or the task is closed with the line that fixed it.
