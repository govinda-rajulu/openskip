# openskip lessons

Newest first. Append; never delete. Older lessons live verbatim in
[archive/skills/](archive/skills/) (MY-WRONG-CALLS-4-5-SEP, FIXED-WORK-AND-WRONG-CALLS,
SUPERSEDED-CLAIMS, REPO-LANDMINES-AND-AGENTS).

## 29 Sep 2026, afternoon (knowledge migration)

1. **"Merged" in chat is not merged.** After a merge was reported, `/pulls/74` still said
   `merged: false`. Nothing was cut until `/pulls/N` and the folder on main were read.
2. **Pinned controllers go first.** A patch-factory packet required an exact main, so it ran
   before the unrelated knowledge PR merged. Order packets that pin main ahead of others.
3. **Condensing memory can drop a rule (assistant's wrong call).** Trimming notes removed the
   "never use openskip_fixed.zip" line; it was restored. Compare before and after a trim.

## 29 Sep 2026 (audits, packets A to H, agent fleet)

1. **Agent-fleet failures were not rate limits.** Checked against provider docs:
   - Gemini 404 = the model id was retired. Gemini 503 = Google overload; their docs say
     back off and retry.
   - OpenRouter EMPTY = a reasoning model spent all of `max_tokens` thinking.
     `reasoning.exclude` hides the thinking but still spends it; `effort: low` is about 20%.
   - Gemini `maxOutputTokens` includes thinking tokens. Hitting it gives finishReason
     MAX_TOKENS with empty text.
   - Fix shipped in #72: walk live models on 404/5xx, wait 5 s then 15 s on 429/5xx, one
     retry with 4x budget (cap 16384) on an empty "length" answer, OpenRouter effort low.
     Pin the working model in a repository variable.
2. **Stale main (assistant's wrong call).** A script was built on a main that had moved
   because the assistant had merged dependabot #64 earlier the same day. The tree gate
   stopped it. Fix: re-read live main before building, and accept only named known trees.
3. **Negative controls must really corrupt.** Two controls were no-ops: a substitution of a
   letter that was absent, and a last-line edit on a line with no lowercase letters.
   Corrupt a byte inside the payload and confirm the checksum changes.
4. **Tests caught an eviction bug.** JavaScript enumerates integer-like object keys first,
   in numeric order, so an insertion-order "oldest first" cache evicted the wrong entries.
   Prefix keys (`'f' + id`) so insertion order holds.
5. **New tests must fail on old code.** 13 of the 14 UI tests fail on main; that is what
   makes them evidence.
6. **Firefox popup file picker.** Opening a file picker from a browser_action popup
   destroys the popup (Mozilla bug 1378527). Pickers live in the page, and the page must
   call `.click()` synchronously, not after an `await`.
7. **Firefox callback-style `runtime.sendMessage(msg, cb)`.** Audit 2 said it hangs; whether
   it really fails on current Firefox is uncertain. The promise form works in both
   browsers, so #73 converts every call. Treat it as a probable cause, not a proven one.
8. **Node 24 changed the default test reporter**, which broke a pass-count gate. Run
   `node --test --test-reporter=tap tests/*.test.mjs` and gate on the exact pass count.
9. **Cross-realm `deepEqual` fails** for objects made inside `vm` contexts. Compare JSON.
10. **Audit findings need quoted source lines.** Earlier audits fabricated functions and
    lines (see archive). Audits 1 and 2 quote code; still re-read the line before fixing.
11. **Cloud Shell fills up.** Every upload stays in the home folder. Scripts now self-clean
    on success (see WORKING-AGREEMENT.md).

## Standing rules carried forward from earlier sessions

- The first user is non-technical; a change she would not notice is not a priority.
- The frame model is deliberate: top-frame guards exist on purpose. The "frame guard" idea
  is dead (device test: counter moves by 1, not 2).
- `_siteHost` strips `www.` and `getSiteHostname` keeps it. Merging them changes stored data.
- MV2 is not deprecated on Firefox. A past MV2-to-MV3 conversion broke the extension; never
  use that converted build.
- `scripts/agent.sh gate` is vacuous on committed work and force-deletes the branch on
  failure. Never run it on committed work.
- CWS secrets are absent; `cws-submit` fails silently on release. Chrome is unpublished by
  choice.
- Any shipped file must be in all four workflow file lists (see AGENTS.md).
