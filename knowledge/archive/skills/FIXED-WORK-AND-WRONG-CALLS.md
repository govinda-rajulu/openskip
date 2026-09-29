<!-- archived from assistant skill 'Fixed Work and Wrong Calls', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Read before proposing a SkipStream fix. What was already fixed and why, plus the wrong calls already made on this repo. -->

# FIXED-WORK-AND-WRONG-CALLS (sub-skill of SKIPSTREAM-RELEASE-WORK)

## Fixed in the 14-15 Aug sessions

- **`9891af8`**: the two invented `60`s in the native-skip poller and observer now pass a real 0.
- **`0bf59d3`**: options.js sync-state handling and the re-verify hook. This also fixed the manual-sync freeze, **`subFontSize`** persistence, and OpenSubtitles re-login via **`osubEnsureLogin`****.** I re-listed all three as open on 15 Aug and wasted tokens confirming they were done.
- **`d7df60b`**: subtitle vertical position persists via `subtitle_drag_pos`.
- **`667a2f7`**: settings sync moved to `rpc/ss_put_settings` and `rpc/ss_get_settings`. **This made cloud settings sync work for the first time ever.**
- **`d536843`**: `IMPORT_ALLOWED` derived from the `S` key map minus an explicit `DENY` set. Also fixed cloud history rows never winning the merge (local `updated` is a number, cloud is an ISO string; there is now an `_ssTs` helper). Device-confirmed: "Restored 13 settings" with 7 credential keys correctly rejected.
- **`421b2da`**: poster cache keyed by media id; `REPORT_SEGMENT` handler deleted.
- **`fbbae38`**: per-site skip counts in Stats. Note: until **`0527017`** these counted the embed provider, not the site.
- **`00c86f3`**: three false statements removed from Settings.
- **`238e220`**: subtitle position saving, see the regression below.
- **`8b3b83c`**: history site filter + `www.` normalisation. The filter listing sites with zero rows was never a cache problem: the dropdown was built from local **and** cloud while the list rendered only the selected source pill. **Known remaining limit:** switching the source pill does not rebuild the dropdown until a page reload. Booked for the History rework.
- **`0527017`**: media id plural paths, top-frame url and stat site, `isAutoMode` truthy check, cooldown honoured.

### The countdown-under-Auto bug, closed after eight sessions

The question "under Auto All, does an intro produce a countdown with Undo or a toast with Start over" was open eight times. Govind's device report answered it (countdown + Undo), and the cause was one operator: `showSkipCountdown` tested `(_ssEffPrefs || prefs)[prefKey] === true` while its only caller branched on plain truthiness `if (effectivePrefs[prefKey])`. Any truthy non-boolean, a `1` or `"true"` from an older write or an import, took the auto path and then failed the strict test inside, producing the prompt. `0527017` changed it to `!!`. Prompt mode writes `false`, still falsy, so prompt behaviour is untouched. **FIX 1 inside that function was always correct, just guarded too tightly.**

### The 19-skip loop

Not a stats bug. `video._ssCooldownUntil = Date.now() + 1500` was set in three places and **read nowhere**. When his player looped back into the outro, `activeSegmentKey` cleared and the skip re-fired repeatedly; every count was honest. `0527017` makes `checkSkipSegments` read it. **Honest limit:** 1500ms stops rapid re-fire, not a player looping every 30 seconds. A true once-per-segment guard needs a media-id keyed set.

### The subPosition regression, mine

`f69dbe4` "removed the dead `subtitle_position` key" also removed the `subPosition` entry from the `S` map, while three live call sites still used `S.subPosition`. Result: both save paths wrote a key literally named `undefined` and deleted **`subtitle_drag_pos`**, the key content.js actually reads, so dragging saved and then the slider wiped it. Not restorable on import either. `238e220` points all three at `S.subDragPos`. **`loadCredentials()`** uses **`storage.local.get(Object.values(S))**, so the slider loads its saved value and the key exports and imports for free. Lesson: a key with no readers is not necessarily dead; check the map entry its callers depend on.

## Fixed 8 Aug, worth knowing why

- **The prompt bug** (`14b4dcb`). `checkSkipSegments` computed `effectivePrefs` but `showSkipCountdown` re-decided from the **global** `prefs`. Fixed with a module-scope `_ssEffPrefs`. An earlier attempt threading a fifth argument aborted because the call site's closing `});` is not unique. Module-scope variable beats parameter threading whenever the closing line cannot be anchored.
- **Import merge order** (`16c78b9`): the merge was `{...safeData, ...existing}`, so live storage overwrote everything restored.
- **Alt+Right recorded zero** (`2a9ab9e`): it seeked first, then subtracted from the already-seeked time.

## Wrong calls already made here, so you don't repeat them

**29 Aug, the worst one here: I overwrote correct information with stale information and called it verification.** A bare `/issues?state=open` read returned 44, 45, 46 and PR 47 as open. All had been closed on 15 Aug. The skill's existing 15 Aug note was right and I replaced it with the stale version, added a lecture about not trusting stale write-ups, and did not notice that the same response omitted PR 48, open since 17 Aug. A single list read is not evidence. Settle one item with **`/issues/N/timeline`****.**

Every one came from trusting a grep, a summary, a cached response or a stale note instead of opening the artifact.

- Claimed the Undo feature didn't exist (real, Alt+Z), twice.
- Recommended GitHub Models five days after it retired.
- Said three open issues when there were ten; said one when there were four.
- Gave three wrong popup theories before finding the real `100vw` cause.
- Claimed `www.` stripping caused the per-site rule mismatch. Zero `www.` matches exist in options.js.
- Claimed OpenSubtitles had no login path.
- **10 Aug:** said Report Segment had UI and no backend (exactly backwards); called subtitle sync and drag dead when both work; told him a delete revoke was safe without grepping for DELETE, breaking two features; sequenced a `revoke select` before the client change that needed it; hardcoded `/workspaces/openskip` into executor prompts; sent him hunting for a Revert button that does not exist on commit pages.
- **14-15 Aug daytime:** handed Copilot a security migration before designing the SQL contract; told him to strip `creds` from `ss_get_settings` without asking why the column existed; read head as `2c9bb5c` off a cached `/branches/main`; asserted `for r in select ...` auto-declares its loop variable; re-listed six already-fixed bugs; and wrote an inline Python one-liner where `open(o,'w')` truncated options.js before the read inside it ran, deleting 1,522 lines.
- **15 Aug evening, five corrections in one session:** deleted the `subPosition` map entry in `f69dbe4` and broke subtitle position saving; chained `grep -c` with `&&` so a zero count killed a verification block; put a raw &lt;a  inside a grep pattern in a copy block and hung his shell on an unterminated quote; claimed the whole content script read the wrong frame when `_siteHost()` already handled it; blamed the stats double-count on two recorders that share a guard; wrote an exact-line-equality predicate against my own rule; and set a gate at `cooldown 4` when the unedited file already had 4, so the gate would have passed on a file with no edits.

**The rules those mistakes produced:**

1. **Verify a bug still exists in the current file before writing any prompt for it.** No prompt built from notes.
2. **Never write an inline script that both reads and writes the same file in one expression.**
3. **Derive every gate number from the pre-edit output he just pasted, never from memory.** A gate that passes on an unedited file is not a gate.
4. **A key with no readers may still have writers depending on its map entry.** Grep both directions before calling anything dead.
