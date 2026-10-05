# Hand-over addendum, 5 Oct 2026 (attach with HANDOVER.md)

Found while reading the code, not fixed yet. Priority order.

## Fix in 1.13 (os-130)
1. Supabase new keys: projects now get sb_publishable_... keys (not JWTs; legacy anon keys end late 2026).
   SkipStream sends `Authorization: Bearer <key>` in 10 places in background.js and 1 in options.js.
   Supabase docs: send a publishable key in `apikey` only, never as Bearer. Fix: one header helper; Bearer only for eyJ... keys.
   Options placeholder "eyJhbGci..." and help text must mention both key types.
2. History resume from a new tab: pending resume expires after 30 s (content.js). Slow phones can miss it. Make it 120 s.
3. supabase_setup.sql still has user_settings.creds + ss_put_creds; the extension no longer calls them. Drop from the script
   (keep a "drop function if exists" for old installs) or document why it stays. PRIVACY must match.
4. Local history cache keeps 100 entries (two places). Say so in README, or raise to 300 (storage cost small).

## Plan (agent-tuning packet after 1.13)
5. ai_call.py default OpenRouter model "google/gemini-2.0-flash-exp:free" is likely retired: pin current ids + fallback.
6. version-bump.yml reads ANTHROPIC_API_KEY (probably never set): remove the workflow or the step.
7. store-version-check.yml and cws-submit.yml need CWS secrets that do not exist: they "succeed" doing nothing. Disable until a CWS account exists.
8. release.yml pushes updates.json to protected main with `|| echo` (silent failure; audit W2). updates.json is unused: stop writing it.
9. One accurate agent rules file (CLAUDE.md/GEMINI.md/AGENTS.md overlap); fix scripts/agent.sh gate; spec issue template; path guard; AGENTS_PAUSED.

## Note only (owner decides)
10. OpenSubtitles app key is hard-coded in background.js (normal for OpenSubtitles apps, but every user shares its quota).
    If downloads fail with quota errors, add an optional "your own OpenSubtitles API key" field.
11. getSiteName() names free-streaming sites (1shows, fmovies, soap2day, goojara). AMO reviewers may question it. Keep the
    generic fallback; consider dropping those names from the shipped list.
12. No end-to-end browser test: 138 unit tests only. Headless Chromium can load the popup and a local test page
    (done by hand in the assistant sandbox). A CI job would catch UI breaks before device tests.
13. Konami egg needs a keyboard: phones only get the version-badge egg. Fine.
14. Still unverified live: Anime Skip, SkipDB, TheIntroDB, AniSkip answers. 1Shows triple subtitles. AMO 1.12.0 listing status.
15. Edge Add-ons listing (free, Chrome ZIP) and the AMO listing text are owner steps.
