<!-- archived from assistant skill 'My Wrong Calls 4-5 Sep', last updated 2026-09-05 16:42 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Eleven wrong calls in two days on openskip, and the one rule they produce. Read before proposing a fix or writing a gate on this repo. -->

# MY-WRONG-CALLS-4-5-SEP (sub-skill of SKIPSTREAM-CURRENT-STATE)

Eleven in two days. Every one was a check that could report the wrong answer confidently, which is worse than no check because it gets believed.

1. **Handed a 20-line mechanical edit to Gemini**, against the standing rule that a deterministic script wins for mechanical work. It built a different feature (`OPEN_OPTIONS` opening the options page instead of an in-page picker), touched 3 files where the spec said 1, and cost two rounds. One Python patcher then did the job in one pass.
2. **Said the extension had no toast system.** I grepped only `showToast` and `function toast`, got silence, and reported that as a fact about his code. Five on-screen functions exist. **Never report a narrow grep's silence as absence.**
3. Built a verification block on **`git diff`**, which is blind to committed work, so a finished job would have printed an empty file list and I would have called that evidence. Use `git diff main`.
4. Recommended **`agent.sh gate`** without reading it. It was 6,716 bytes in the repo the whole time, and one read showed both the OPEN-issue assertion and the destructive failure path.
5. **Compared characters to bytes.** A gate on a text-mode `len()` refused a correct 81,319-byte file because it is 78,605 characters: his source has multibyte box-drawing characters in comments, visible in his own paste.
6. **A patch block with no clean-tree gate.** Leftover uncommitted files rode `checkout -b` onto the new branch and my patch landed *inside* the previous wrapper as dead code. `node --check` passed, because it was valid JavaScript.
7. **Discarded after switching branches instead of before**, which carries dirt onto main. Proved the correct order in a throwaway repo afterwards.
8. **A build download that took the latest run on main.** Right after a merge that run is still building, so he would have installed the previous build, seen no picker, and blamed the code. Gate on `headSha == local sha`.
9. **A card stamped for the wrong machine**: a Cloud Shell command labelled "your laptop", in a document whose entire purpose was to stop that confusion.
10. A **`RUNID`** placeholder for him to fill in, the same class as the literal `PASTE_B64_HERE` from 30 Aug. A command he has to edit is a command I have not finished writing.
11. **Eleven planning blocks for one bug**, plus `gh api user/settings/billing/shared-storage` for a Codespaces quota read that does not exist. 404.

## The rule

A gate that can pass on a bad input, or fail on a good one, is worse than no gate. So: compare bytes to bytes, diff against `main`, discard before switching, gate the artifact on its sha, and run the whole block against a byte-accurate replica before he ever sees it.

## What worked, and is worth repeating

- **A gated Python patcher, delivered as base64.** Asserts its anchors, refuses on a byte-count mismatch, writes to `.cand` so nothing is overwritten in place, refuses a second run with ALREADY APPLIED, and derives indentation from the matched line rather than guessing it. Predicted `81319 -> 81978 (+659)` and hit it exactly.
- **Replica testing.** Building a fake file at the real byte count, with the real multibyte padding, caught the character-vs-byte bug before it reached him a second time.
- **Two numbers instead of a diff.** When Gemini's summary and the spec disagreed, two grep counts (does a file input exist / does `OPEN_OPTIONS` exist) settled it without him reading any code.
