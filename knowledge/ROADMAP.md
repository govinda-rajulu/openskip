# openskip roadmap

Written 1 Oct 2026. One lane in flight at a time. New ideas go to the parking lot at the
bottom with a date; they do not start work by themselves. Tool verdicts and agent rules:
[handbook/AGENT-TOOLING.md](handbook/AGENT-TOOLING.md). STATE.md and the code win over this file.

## Now: finish what is open (weekend of 3 and 4 Oct 2026)

Nothing below lands first: every agent lane touches workflows that #72 rewrites.

- Owner: device test of #73, then merge #71 (G), #72 (F), #73 (H). AMO listing the same weekend.
- After the merges the UI polish packet stays next (see STATE.md). It needs the owner's eyes,
  so it is not an agent job.

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
fallback for small issues. Retire `agent_team/crew_master.py` (local Ollama, cannot run in CI).

## Lane 4: morning report and brakes

One pinned issue refreshed daily: what ran, what stopped and why, what waits on the owner.
Caps on rounds, minutes and daily model calls.

## Lane 5: skills and memory

- `knowledge/skills/<name>.md`, each starting with a "Load when" line; the worker loads them by
  tag, like the council lessons in patch-factory.
- Each agent PR ends with "Proposed lessons"; they land only through a reviewed packet.
- The biggest lever is tests: agents are only as good as the suite that judges them. Every
  lane 3 task adds a test that fails on the old code.

## Next after 1.11.0: device linking and Supabase login (1.12.0)

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

## Parking lot

Add ideas here with a date. Move one into a lane only when the lane before it is done.

- 3 Oct 2026: "Skip in 3 s, Cancel" countdown; per-segment defaults (credits ask, intro auto).
- 3 Oct 2026: resume card with a 5 s rewind; next-episode countdown with Cancel.
- 3 Oct 2026: remember the chosen subtitle and its offset per show.
- 3 Oct 2026: TMDB logo next to the Credits notice (TMDB attribution rules).
- 3 Oct 2026: OpenSubtitles search by title when no IMDb id: done in 1.11.0 (popup button only; YouTube excluded). A confirm step showing the match is still open.
- 3 Oct 2026: if "Check this page" shows blank frames holding players, add match_about_blank.
- 3 Oct 2026: tidy agent docs (AGENTS.md, CLAUDE.md, GEMINI.md overlap); move SECURITY_AUDIT.md
  into knowledge/audits; check update_release.py is still used.

- 1 Oct 2026: competing drafts (attack, defend, judge) for risky PRs, after lane 3 has run 10 tasks.
- 1 Oct 2026: typed verdict step (accept, reject, escalate) in the verdict script.
- 1 Oct 2026: extra seats from legitimate free tiers (Groq, Cerebras, Mistral, Cloudflare).
