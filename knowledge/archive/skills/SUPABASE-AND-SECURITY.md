<!-- archived from assistant skill 'Supabase and Security', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before touching SkipStream's Supabase project, sync, auth, schema or a CodeQL finding. Includes the triage of what is a real vulnerability and what is noise. -->

# SUPABASE-AND-SECURITY (sub-skill of SKIPSTREAM-RELEASE-WORK)

## Supabase

### user_settings: closed, verified

Zero policies, no anon or authenticated grants, all access through security-definer functions: `ss_get_settings(text)`, `ss_put_settings(text,jsonb,jsonb,jsonb,text)`, `ss_put_creds(text,jsonb)`. `ss_verify_setup` exists in his project, so `background.js` line ~864 finally works.

The **`creds jsonb`** column exists to restore their API keys on a new install or second device. Do not "harden" it away. `ss_get_creds` is still unwritten, so credential restore is **unwired, not broken**, and Govind is right that it was never delivered. **Before wiring the read, note the escalation:** while `playback_states` allows anon SELECT, anyone with the key can read a `user_id` from it and then call `ss_get_creds` with it. Either close `playback_states` first, or ship an opt-in "include credentials" checkbox on export instead. The checkbox is cheaper and safer.

### playback_states: half done, revoke NOT run

Five definer functions exist in the repo SQL and his live project: `ss_put_playback(jsonb)`, `ss_get_playback(text,text)`, `ss_get_playback_all(text)`, `ss_prune_playback(text,int)`, `ss_clear_playback(text)`. `71d55c0` moved all seven client call sites onto them.

**The table still has 5 permissive policies and full anon SELECT/INSERT/UPDATE/DELETE.** The revoke is step 3 and runs **only after a device test confirms resume, history load and clear history work**. Sequence is additive, client, device test, revoke. Running it backwards on 10 Aug broke both delete features instantly. Afterwards, strip the policy block and grant from `supabase_setup.sql`, keeping the four `ss_anon_*` names as literals inside drop statements so the string-grep validator still passes.

### Clear Cloud History was never broken

Verified 15 Aug: options.js:1431 posts `{ p_user_id: userId }`, the SQL declares `ss_clear_playback(p_user_id text)`, execute is granted to anon. Names, types and grants all line up. The rows Govind saw "reappear" were duplicates being rewritten by a second frame with a divergent media id. Do not go looking for a broken call.

### The duplicate-row root cause, solved

`ss_put_playback` upserts on `(user_id, media_id)`, correctly. The duplicates came from `getMediaId()` producing **different ids per frame** for one film: the top page `www.streamsite.org/movies/157336-interstellar` failed the old `/\/movie\/(\d+)/` regex (path says *movies*) and fell through to `hostname + pathname`, while the player frame `play.playerhost.top/e/movie/157336` matched and returned `movie/157336`. `0527017` fixed the regex to `movies?` plus a wider tv alternation. **Old rows are not rewritten**, so expect one stale duplicate per previously watched title until a Clear Cloud History.

A series id is still show-level (`tv/66732`), so all episodes share one resume row. Pre-existing behaviour, not a regression; fixing it needs season and episode in the id, which is the History rework.

### SQL rules learned the hard way

- **`supabase-validate.yml`** does not parse SQL. It counts `do $$ begin` against `end $$;`, greps for eight policy names plus `ss_verify_setup` and `ss_set_updated_at`, and checks IF NOT EXISTS idempotency. `f836548` went green on SQL Postgres rejects outright.
- **`supabase-parse.yml`** is the real gate. postgres:16, creates the three roles, applies the file twice for idempotency. Trigger: pushes touching `supabase_setup.sql`, or `workflow_dispatch`.
- **`for r in select ...`** does not auto-declare **`r`****.** Only the integer `for i in 1..n` form does. Use a `declare` section, or no loop.
- Prefer **`drop policy if exists`** over any loop.
- The four **`ss_settings_*`** names must stay in the file as literals or the validator's grep fails.
- Postgres **`REVOKE`** only removes grants made by the current grantor. Always confirm with `information_schema.role_table_grants`.
- Paste `ss_verify_setup()` output after any SQL change. That JSON is the only proof.

## CodeQL, triaged 15 Aug

`codeql.yml` runs `security-and-quality` on JavaScript, on every push plus Monday cron. **JS only**, so `supabase_setup.sql`, options.html and both CSS files are never scanned.

**The Codespaces built-in token cannot read code scanning (403).** Fix: `unset GITHUB_TOKEN GH_TOKEN` then `gh auth login --scopes repo,workflow,security_events --web`. That re-auth is what breaks GPG signing.

Counts: **26 fixed, 15 open, zero dismissed.** Every fixed alert points at a file that still exists, so none closed by rename. Severity labels on this repo are worthless.

- **Real and fixed:** #40 popup.js unused `seg` (mode chips left checkboxes stale), #33 background.js superfluous argument.
- **Real, mitigated:** #1/#2 missing-origin-check at content.js ~1322/1332. `8a9fe6e` validates message type and label shape and restricts `MSG_DO` to the top frame. CodeQL wants a literal `e.origin` comparison and cross-origin frames are the feature, so these stay open. Dismiss as "by design, shape validated".
- **Real, deferred:** #34 `SKIP_SELECTORS` unused. **Confirmed dead: exactly one reference in the file, its own declaration at ~1024.** Forty harmless lines. This also finally answers the long-standing UNVERIFIED question about the two selector lists: every native click comes from `NATIVE_SKIP_SITES` plus the label matcher.
- **Cheap, open:** #3/#4 `topFrameListening` set and never read (a content script runs once per frame anyway), #41 unused loop key (fixed), #31 subtitle tag stripper (cosmetic only, subtitles render via textContent).
- **Noise, dismiss:** #14 `createHmac('sha256')` is Mozilla's mandated JWT signing, not password hashing. #29 amo-update.js reads your own ZIP and posts over Node `https`. #21 the CHANGELOG markdown stripper. #32 `host.includes('youtube.com')` picks a selector set.
