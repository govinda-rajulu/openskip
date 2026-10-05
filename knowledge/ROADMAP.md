# openskip roadmap

Written 1 Oct 2026. One lane in flight at a time. New ideas go to the parking lot at the
bottom with a date; they do not start work by themselves. Tool verdicts and agent rules:
[handbook/AGENT-TOOLING.md](handbook/AGENT-TOOLING.md). STATE.md and the code win over this file.

## Now: 1.12.0 (packet 3 Oct 2026), then the AMO listing

- Done 3 Oct: #71, #72, #73, #77 merged; 1.11.0 released (#79, tag v1.11.0, AMO upload OK).
- 1.12.0 PR: site report, all SponsorBlock categories with modes, mute and highlight, timeline
  marks, AnimeSkip section ends, SkipDB, subtitle look and per-show sync offset.
- Owner: device test the 1.12.0 ZIP (checklist in the PR), merge, tag. AMO listing: screenshots,
  privacy policy link (PRIVACY.md on GitHub). Edge Add-ons: free, takes the Chrome ZIP.
- Use "Site report" on 1Shows and other sites; paste it into the chat. Player or site fixes come
  from those reports, one site at a time.

## Lane 1: settings, no code (owner, in the browser, after the merges)

- Install CodeRabbit on this repository (free for public repositories). Advisory only, never a
  required check.
- Branch protection: confirm `Lint & Validate` is required. The public API read on 1 Oct returned
  a stale August snapshot showing enforcement for non-admins only, so check the setting itself.
- Add repository variable `AGENTS_PAUSED` with value `false`. Workflows learn to honour it in lane 3.

## Lane 2: security audit 3 (read-only)

- Method: [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
  pinned to a commit. Focus classes: `CLIENT-SIDE.md` (messaging trust between page, content
  script and background, the postMessage relay, DOM injection) and `AI-AND-LLM.md` (the `ai-*.yml`
  and `sweep.yml` workflows, where issue text reaches a model whose output becomes a commit).
- Input: AUDIT-1 and AUDIT-2 as known findings, so the run hunts new ground.
- Output: `knowledge/audits/AUDIT-3-<date>/` with `findings.json`, `REPORT.md` and the pinned
  commit, plus new rows in `audits/STATUS.md` with an `X` prefix.
- H23 (blocks the next AMO upload) is fixed before any X item.

## Lane 3: night shift worker (after lane 1)

Limits of the current agent workflows, read on 1 Oct 2026 from main and #72:

- #72 replaces whole-file rewrites with find/replace edits, `node --check` and the full test
  suite. Keep that.
- The model sees at most 80,000 characters of a concatenation that starts with CLAUDE.md,
  manifest.json and background.js (43,802 bytes). `content-scripts/content.js` alone is 87,116
  bytes, so most of it, and all of options.js and popup.js, is never shown.
- Branches, commits and PRs are made with the default `GITHUB_TOKEN`, so CI does not run on
  them, while the PR body says it does.
- The branch is force-updated if it exists; no changed-path guard; no retry loop.

Plan: a gh-aw workflow with the Gemini engine; owner-only `agent-go` label; per-task context
(only the files the spec names, whole); a loop of at most 5 rounds with the test suite as
backpressure; #72's edit contract kept; a path guard that fails on `.github/**`; CI dispatched
explicitly on the PR head; one PR per issue; `AGENTS_PAUSED` honoured. Jules is the zero-setup
fallback for small issues. `agent_team/crew_master.py` retired to knowledge/archive/unused in 1.12.0.

## Lane 4: morning report and brakes

One pinned issue refreshed daily: what ran, what stopped and why, what waits on the owner.
Caps on rounds, minutes and daily model calls.

## Lane 5: skills and memory

- `knowledge/skills/<name>.md`, each starting with a "Load when" line; the worker loads them by
  tag, like the council lessons in patch-factory.
- Each agent PR ends with "Proposed lessons"; they land only through a reviewed packet.
- The biggest lever is tests: agents are only as good as the suite that judges them. Every
  lane 3 task adds a test that fails on the old code.

## Lane: Agent clean-up (after 1.13)

- 6 AI workflows share 3 secrets: OPENROUTER_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY.
  Version Bump also reads ANTHROPIC_API_KEY, which is probably never set.
- The default OpenRouter model "google/gemini-2.0-flash-exp:free" in scripts/ai_call.py is
  likely retired. Pin current ids with a fallback.
- One accurate rules file instead of CLAUDE.md, GEMINI.md and AGENTS.md. CI reads CLAUDE.md
  and agent.sh reads GEMINI.md.
- Fix the scripts/agent.sh gate. It passes on committed work and force-deletes the branch.
- Spec issue template. Path guard on .github/**. A 5-round loop with the test suite as the
  check. An AGENTS_PAUSED off-switch.
- Agents get chores only: tests, single-doc rewrites, selector updates. Releases, device
  bugs and packets stay with the assistant.
- Disable cws-submit and store-version-check until a Chrome store account exists. Stop
  release.yml writing the unused updates.json.

## Next: Supabase login (1.14.0, moved from 1.13.0 on 5 Oct 2026; needs SQL in the user's own project and its own test cycle)

Owner decision 3 Oct: each user keeps their own keys; one login restores everything.
- Supabase Auth (email and password or magic link) in the user's own project; rows keyed by
  `auth.uid()` with row rules, replacing the per-install id. Existing install-id rows are claimed
  on first login.
- 1.11.0 already links browsers through a backup (sync identity) and restores keys from an
  encrypted backup; the login replaces the shared id with `auth.uid()`.
- One connection code (text or QR) carries the project URL and anon key to a new device.
- Keys and logins saved in the user's own project behind the login; the export file stays
  credential-free. Declare `personallyIdentifyingInfo` (email) as optional, asked when login is
  turned on. Replace the unused `ss_put_creds` RPC.
- Chrome build: keepalive and EdgA label done in 1.11.0; next, list on Edge Add-ons (free,
  takes the MV3 zip).

## Later: send skip times (after 1.14 login)

- Accounts page: IntroDB key, TheIntroDB key and SkipDB, each optional, for sending your own times.
- On the video: mark start and end of an intro, recap or credits, then send to one source.
- Needs: each source's submit rules, a review screen before sending, and its own device test.

## Parking lot

Add ideas here with a date. Move one into a lane only when the lane before it is done.

- 3 Oct 2026: "Skip in 3 s, Cancel" countdown: exists as Prompt mode. Per-segment modes: done in
  1.12.0 for YouTube; IntroDB kinds still follow the Intros/Recaps/Outros switches.
- 3 Oct 2026: resume card with a 5 s rewind; next-episode countdown with Cancel.
- 3 Oct 2026: remember the subtitle offset per show: done in 1.12.0. The chosen file is still global.
- 3 Oct 2026: TMDB logo next to the Credits notice (TMDB attribution rules).
- 3 Oct 2026: AniSkip (api.aniskip.com, MAL ids) as a second anime source; needs IMDb or TMDB to MAL.
- 3 Oct 2026: submit segments (IntroDB key, SponsorBlock), with a review step.
- 3 Oct 2026: "Check this page" on 1Shows listed only the main page while the player played
  (1.11.0 device test). Site report (1.12.0) reads every frame directly; use it to find out why.
- 3 Oct 2026: 1Shows showed three subtitle lines; one is ours (dark box), two are the site's own.
- 3 Oct 2026: OpenSubtitles search by title when no IMDb id: done in 1.11.0 (popup button only; YouTube excluded). A confirm step showing the match is still open.
- 3 Oct 2026: if "Check this page" shows blank frames holding players, add match_about_blank.
- 3 Oct 2026: agent docs overlap (AGENTS.md, CLAUDE.md, GEMINI.md): CI and scripts/agent.sh read
  CLAUDE.md and GEMINI.md, so merge them only together with those workflows. SECURITY_AUDIT.md
  and update_release.py: done (moved in 1.12.0).
- 3 Oct 2026: Alt+S style keyboard commands do not exist on Firefox for Android; keep every
  action reachable by touch.
- 3 Oct 2026: declare `personallyIdentifyingInfo` (email) as optional when the Supabase login lands.
- 3 Oct 2026: a bundled font (e.g. Inter, OFL) only if system fonts look wrong somewhere; the
  1.12 refresh uses the system stack to stay small and offline.

- 1 Oct 2026: competing drafts (attack, defend, judge) for risky PRs, after lane 3 has run 10 tasks.
- 1 Oct 2026: typed verdict step (accept, reject, escalate) in the verdict script.
- 1 Oct 2026: extra seats from legitimate free tiers (Groq, Cerebras, Mistral, Cloudflare).
