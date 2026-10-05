# openskip lessons

Newest first. Append; never delete. Older lessons live verbatim in
[archive/skills/](archive/skills/) (MY-WRONG-CALLS-4-5-SEP, FIXED-WORK-AND-WRONG-CALLS,
SUPERSEDED-CLAIMS, REPO-LANDMINES-AND-AGENTS).

## 5 Oct 2026 (1.13.0, packet os-130)

1. **Resume from History.** The old code gave up if YouTube had already started playing.
   YouTube starts sooner on warm loads, so the 2nd and 3rd resume were skipped. Then saves
   from 0 overwrote the real position. **Wrong call:** ads were blamed, but the owner uses
   ad blockers. Ask what the user runs before you name a cause.
2. **Sync push starvation.** Every save restarted a 3-second timer, so a playing video never
   reached the cloud until pause. Throttle cloud pushes, and send at once on pause and on
   app switch.
3. **The store listing PATCH probably failed.** amo-update.js sent the category in a format
   that the store API no longer accepts. So the AMO description stayed old and false. A
   step that only warns can hide a failure for months.
4. **New Supabase publishable keys are not JWTs.** Never send them as Bearer. Keep auth
   headers in one helper.
5. **The anon key cannot run SQL.** Guide the user to run the setup script one time. Never
   ask for a personal access token.
6. **Taking on more than one session can ship is a wrong call.** Ship a smaller packet.
7. **One site can have many hosts.** History showed m.youtube.com and youtube.com as two
   sites. Use one canonical host (no www., m. or mobile.), and keep a fallback for ids
   saved under the old host.
8. **A flag can look like an id.** `?video_id=x&tmdb=1` gave TMDB id 1. Test odd inputs.
9. **Extension pages need `'self'` in connect-src** to read their own files once
   connect-src lists hosts.
10. **Pin the test reporter in gates (assistant's wrong call).** The packet read the TAP
    summary ("# pass N"). Node 22 prints TAP when output goes to a file. Node 24 prints its
    "spec" format, so the gate found no numbers and stopped, with 186 tests passing. Always
    pass `--test-reporter=tap`. Rehearse with the owner's Node version.
11. **Take numbers from the provider, not from old text.** Settings said OpenSubtitles gives
    "up to 200 a day". OpenSubtitles' help says 5 without an account and 20 with a free
    account. Its login answer `allowed_downloads` is the allowance, not what is left.
13. **Register diagnostics first.** The "Check this page" listener was the last line of
    content.js. If start-up stopped early in a frame, that frame never answered, so 1Shows
    showed only the top page. A diagnostic must not depend on the code it diagnoses.
    (Likely cause, verify on the device: the frame now says if start-up did not finish.)
14. **Use the free tier first.** OpenSubtitles downloads try without the account first, so
    the account's 20 a day are kept for when the 5 run out.
15. **Know which HTTP codes are final.** OpenSubtitles says "quota used up" with 406. The
    retry helper treated 406 as temporary, retried, then threw, so a fallback never ran. A
    test with a fake 406 found it.
12. **The device test finds what tests cannot.** Round 1 (5 Oct) found a needless "Continued
    from" message, wrong download numbers and no way to see another device's history.

## 3 Oct 2026, evening (1.11.0 device test, 1.12.0, UI refresh)

1. **Check which build is running before reading a test.** The first device test ran the old
   add-on: the popup showed 1.10 wording. Look at the version badge and reopen video tabs
   (old content scripts stay in open tabs) before trusting any result.
2. **The extension's own CSP can block a feature.** Online subtitles never downloaded: the file
   link is on www.opensubtitles.com, which connect-src did not list. Firefox reports this only as
   "NetworkError". List every host a feature touches, wildcard per service.
3. **A cross-site frame only gets the parent's origin as referrer.** History from embedded
   players saved "https://site/" and the title "Player". Ask the background for the tab's
   address and title instead.
4. **Read the API docs before trusting a query.** The Anime Skip query asked for a `duration`
   field; timestamps only mark where a section starts. It had never returned anything.
5. **Headless Chrome has a minimum window width (about 500 px).** A "390 px" screenshot is a
   crop of a 500 px page. For phone widths, render the page inside an iframe of that width.
6. **A diagnostic in the popup beats guessing.** "Check this page" with what was identified,
   the mode and the last skip turned "Undo doesn't work" into a screenshot that showed it did.
7. **The public API is cached for branch lists too.** `/branches` showed an August main and no
   PR branches. Branch and tag cleanup runs in Cloud Shell with `git ls-remote`, never from it.

## 3 Oct 2026 (release 1.11.0)

1. **Public reads went stale again, both of them.** `/branches/main` returned an August commit
   and a raw main file was an old copy, while `/pulls/78` had the real merge sha. Pin every read
   to a commit sha (raw URL with the sha, `/git/commits/<sha>`), never to `main`.
2. **The assistant's web reader cuts long files and drops indentation.** Exact bytes come from a
   `git bundle` the owner makes in Cloud Shell and attaches to the chat: full history, PR refs,
   one file, checked by sha256. Use it for any packet that edits code.
3. **A cross-PR sweep is cheap and catches what CI cannot.** CI tests each PR alone; the sweep
   merges them in the planned order and runs every gate plus Mozilla's linter after each step.
4. **Read the promise, then the code.** README said "resume on any device"; the code gave every
   install its own id. A feature can be documented, tested and still not work across devices.
6. **"Works sometimes" was a timer.** Frames gave up after 5 seconds without a video; embedded
   players often build the video after the user picks a source. Look for timeouts first when a
   bug depends on how fast the user is.
7. **Cross-realm compare, again.** New vm-based tests failed on `deepEqual` with identical values
   (29 Sep lesson 9). Compare JSON for objects made inside a vm context.
5. **Mozilla counts the user's own server as collection.** Data "handled outside the add-on or the
   local browser" must be declared, self-hosted or not. Usage stats, settings and device names are
   `technicalAndInteraction`, which may only be optional, so the code must check it at send time.

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
- 5 Oct round 2: `const T = { setTimeout, setInterval }` then `T.setInterval(f)` throws in every
  browser ("does not implement interface Window"); node:vm does not. Tests passed for 4 releases
  while every player frame aborted start-up. Fake browser timers in tests must check `this`.
- 5 Oct round 2: a source's API version can disappear. TheIntroDB v1 stopped answering and the
  tests (fake fetch) stayed green. Check each source live once per release with a known title.
- 5 Oct os-133: Settings died on load (`manifest` read before its `const`, TDZ). No test ran
  options.js end to end. Now a test runs options.js and popup.js as whole files.
- 5 Oct round 3: a shown choice must come from what the code reads. The mode select showed
  "Auto all" from a missing key while skipOutro was off; re-picking it fired no change.
- 5 Oct round 4: find page parts by what they do (role, size, place, value), not by one
  player's class names; never insert into another app's DOM that re-renders. Overlay instead.
- 5 Oct round 4: check every outside link live before a release: aniskip.com was parked.
