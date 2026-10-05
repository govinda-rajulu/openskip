<!-- archived from assistant skill 'Open Items and Queue', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: SkipStream device checks still outstanding, unverified bugs with their cheapest diagnosis, known open bugs, and the features Govind has asked for. Load when planning what to do next on openskip. -->

# OPEN-ITEMS-AND-QUEUE (sub-skill of SKIPSTREAM-RELEASE-WORK)

Updated 5 Sep 2026 from the handover and master plan. Supersedes the 15 Aug list where they conflict.

## THE ONE TEST. Everything is guessing until it runs.

Cloud Shell, sha-gated download (refuses if CI has not built your sha):

```plain
cd ~/src/openskip; git checkout -q main; git pull --rebase; export SHA=$(git rev-parse HEAD); echo "local: $SHA"; gh run list --workflow "Validate Extension" --branch main --limit 5 --json databaseId,headSha,conclusion > /tmp/runs.json; RUN=$(jq -r '.[] | select(.headSha==env.SHA and .conclusion=="success") | .databaseId' /tmp/runs.json | head -1); echo "run: ${RUN:-NONE}"; if [ -z "$RUN" ]; then echo "STOP: CI not done for this sha. wait, rerun."; else rm -rf ~/xpi; gh run download "$RUN" --name skipstream-firefox-zip --dir ~/xpi; ls -l ~/xpi; echo -n "picker in zip (expect 1): "; unzip -p ~/xpi/skipstream-firefox.zip content-scripts/content.js | grep -c "inp.accept = '.srt,.vtt'"; fi
```

Then HIS LAPTOP: Cloud Shell 3-dot menu, Download, rename .zip to .xpi. Firefox Developer Edition, `about:config`, `xpinstall.signatures.required` false, `about:addons`, gear, Install Add-on From File.

GATE: appears as normal add-on, NOT under Temporary. Pref snapping back to true = Release Firefox, not Dev Edition.

Test: YouTube video, click CC with no subs, pick a CRLF .srt.

- picker opens + subs render = DONE, CRLF fix proven.
- picker opens + nothing renders = parseSubs at fault. Different bug.
- picker never opens = user-gesture rule. `.click()` must not sit after an `await`.

## Queue, ordered (5 Sep)

1. **Permanent install test.** Blocks everything stateful. One hour, once, never again.
2. **getSitePrefs fix.** Patcher exists (`patch_getSitePrefs.py`), not applied. 3 defects: null rules on first call, ts before read, 5s poll in every frame. +200 bytes. Testable: set a per-site rule, hard reload, play immediately.
3. **Job 2.2** every subtitle failure gets a visible reason. Three silent failures: parseSubs returns [], online path swallows errors, initSubtitles called with empty catch. Model on `showResumeToast` 462.
4. **Job 2.3** popup trigger for online fetch. Background.js already has osubLogin, osubSearch, osubDownload, 23h session cache, 20-entry sub cache, downloads_remaining, public API key at line 451. Options page has login UI. content.js consumes result at 1606. It is gated, not missing.
5. **Job 2.4** delete popup file input (popup.html:132, popup.js:270-273). Cannot work on Firefox. Must come AFTER 2.3.
6. **Audit hardening #2**: require every finding to quote its actual source line.
7. **AMO listing.** 10 min, zero code. Icons already inside signed XPI. Best value per minute.
8. **Video title on aggregators.** Biggest user-facing bug. Needs postMessage or TMDB decision. Do NOT give to an agent.

## Device checks still outstanding

1. **One intro skip: counter moves by 1 or 2?** Decides per-frame stats theory.
2. **Auto All: countdown gone?** If it appears, storage dump needed.
3. **New history row opens the site, not the player.**
4. **Site filter returns rows.**
5. **Subtitle slider holds after reload**, `subtitle_drag_pos` in Export All JSON.
6. **Clear Cloud History empties and stays empty.** Gate on the revoke.

## Still UNVERIFIED

- CRLF parse vs a real file (8 synthetic cases passed, no upload has ever landed).
- Whether Firefox Dev Edition honours `xpinstall.signatures.required` on his build.
- PR 62 (CC button picker) has never run in a browser.
- 2x speed not applying on streamsite (works on YouTube/JioHotstar).

## Known open bugs

- **Video title returns provider brand on aggregators**, poster fetch fails. Cross-origin, needs design decision.
- **getSitePrefs async-inside-sync**: first video on a site can miss its per-site rule.
- **Per-site rules store one value only.** Per-site subtitle or speed needs schema change.
- **Merged history dedupe key** falls back through mediaId || url || title.

## Features requested, none started

- Subtitle online search from popup with Supabase reuse.
- Credential restore (needs ss_get_creds + revoke).
- Export/import covering credentials with opt-in checkbox.
- In-extension guides for every key/function/feature.

## Fable's valid code findings to apply (5 Sep review)

- Content-type header validation before .json() calls (background.js: SUPABASE_GET, SETTINGS_GET, GET_ALL routes).
- Input validation helpers (validateString/validateInt) on message handlers for userId/mediaId/imdbId.
- parsePageInfo stringify optimization (content.js:656).
- posterCacheKey null/null collision fix (background.js:812).
