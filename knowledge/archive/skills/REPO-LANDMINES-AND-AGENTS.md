<!-- archived from assistant skill 'Repo Landmines and Agents', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before editing SkipStream repo config, CI, or dispatching the free agent fleet, and when deciding what is worth building next. -->

# REPO-LANDMINES-AND-AGENTS (sub-skill of SKIPSTREAM-RELEASE-WORK)

## Repo landmines

**Any newly shipped file must be added to all four workflows' zip/cp lists.** Shipped broken twice: popup.css in 1.7.6, theme-engine.js in 1.9.4. `validate.yml` now guards popup.css, options.css, popup.html, options.html, background.js, manifest.json and theme-engine.js in both ZIPs. `scripts/` is not packaged.

`validate.yml` also enforces: no `innerHTML`, no `console.log`, no `fetch(` in content.js, no `localStorage` in content.js, `node --check` on all four JS files, version consistency, updates.json shape, and `scripts/dom-contract.py`. Grep **`innerHTML`** and **`console.log`** after every options.js or content.js edit and expect 0.

**`dom-contract.py`** checks JS-references-HTML, one direction only. It cannot catch deleted JS, which is how `752e711` went green on a truncated popup.js. Runs locally: `python3 scripts/dom-contract.py`.

15 workflows: ai-fix-pr, ai-pr-review, ai-weekly-audit, amo-submit, cleanup, codeql, cws-submit, pr-check, release, store-version-check, supabase-parse, supabase-validate, sweep, validate, version-bump.

Codespaces has no **`rg`****.** Use `grep -nE`. `skipstream-test.zip` and `supabase/` are gitignored.

## The free agent fleet

Runs on GitHub's runners, zero Claude tokens, produces a real diff. All five verified working 4 Aug 2026.

- One shared provider: `scripts/ai_call.py`, exposing `ask(prompt, max_tokens)` and `strip_fences(text)`.
- **Chain**: OpenRouter then Gemini. **GitHub Models retired 2026-07-30, HTTP 410.** Anthropic removed everywhere (paid).
- **Model IDs live in repo variables**: `AI_MODEL_OPENROUTER`, `AI_MODEL_GEMINI`. **OpenRouter free model IDs expire**; a 404 means the ID died. First thing to check when agents go quiet.
- **Triggers**: `sweep: ...` in an issue title, the `ai-fix` label, and `/ai-review` `/ai-explain` `/ai-fix` `/ai-task` as comments. Owner-only.
- **The agents cannot edit the big files**: the workflows demand "COMPLETE file content" against an 8192-token ceiling. The real fix is redesigning the output contract to find/replace pairs with an exact-match guard.
- **Copilot Free cannot be called from Actions.** In Codespaces it is a capable executor and it refuses honestly: on 15 Aug it printed `NO MATCH - STOPPED` and left the tree clean when a needle did not match, twice. **But for mechanical line edits it is pure overhead.** Govind explicitly asked to stop using it for those; a deterministic Python heredoc does the same work for free and prints its own evidence. Reserve Copilot for judgement, not for `sed` work.
- `agent_team/crew_master.py` is a separate dead CrewAI experiment. Not part of this fleet.

## Judging what to build

**Weight changes by what the end user actually stares at.** The popup is open about four seconds; the on-video overlays are visible for hours. When 1.9.7 shipped a beautifully rebuilt popup and the first user said "liked it, not impressed", the cause was that every dynamic feature stopped at the popup boundary while the toast over their episode stayed hardcoded navy with a Google-blue button.

**Queue as of 15 Aug 20:30:**

1. **The six device checks above.** Two of them gate everything else.
2. **`playback_states`** revoke, then strip the policy block from the repo SQL.
3. **Video title on aggregator sites**, plus the poster that depends on it.
4. Commit `SECURITY_AUDIT.md`; decide on `agent_team/`; delete `SKIP_SELECTORS` in daylight.
5. AMO icon + 4 screenshots. Then the zero-key first-run flow.
6. Credential restore (or the export checkbox), subtitle online fetch, guides.
7. Then 1.11.0. Then the History rework.

**History rework, still a design job needing a spec:** 16:9 rows, sticky day headers, progress bar flush to the still, whole row clickable, favicon per site-rule row, a filter that rebuilds on source change, website category. The options sidebar-to-bottom-bar rework is deferred until History settles what the nav must hold.
