# SkipStream (openskip) - rules for any agent working here

## What this is
Firefox MV2 + Chrome MV3 browser extension. Skips intros/recaps/outros,
clicks platforms' own Skip buttons, blocks YouTube sponsors, syncs playback
to Supabase, overlays OpenSubtitles subtitles.
Vanilla JS. No build step, no bundler, no package.json. Do not add one.
Do not add dependencies. Do not "modernise" to ES modules or TypeScript.

## Hard rules (CI fails otherwise)
- NEVER use innerHTML. Use document.createElement only.
- NEVER leave console.log in committed code.
- Every element id that options.js dereferences MUST exist in options.html,
  or scripts/dom-contract.py fails the build.
- Firefox stays MV2 with strict_min_version 140.0. This is decided, not a bug.
- Reuse existing CSS classes and tokens (.stat-card .stat-val .stat-lbl
  .stats-grid). Do not invent new design tokens.

## Verify before you claim
Run these and paste real output. Do not say "done" without them:
  node --check <file.js>
  python3 scripts/dom-contract.py     # must print: DOM contract OK
  grep -rn "innerHTML\|console\.log" <files you touched>
If a gate fails, say so and stop. UNVERIFIED is an acceptable answer.
A summary of what you intended is not evidence.

## Scope discipline
- Touch only the files the task names. No drive-by refactors.
- No new storage keys. Reuse the existing skipstream_stats object.
- Small diffs. If a change needs more than the named files, stop and say why.

## Settled, do not reopen
Issues 50 and 51 are already-disproved audit findings (retry-on-4xx returns
immediately with no retry; the Supabase URL check was fixed and closed).
Do not "fix" them.

## Who judges this
There is one non-technical primary user. A change she would not notice is
not a priority. Numbers and correctness beat styling.
