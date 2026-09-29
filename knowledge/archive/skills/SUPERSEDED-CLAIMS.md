<!-- archived from assistant skill 'Superseded Claims', last updated 2026-09-05 16:42 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Which specific claims in SKIPSTREAM-RELEASE-WORK and its sub-skills are dead as of 5 Sep 2026. Read before trusting the two draft session files. -->

# SUPERSEDED-CLAIMS (sub-skill of SKIPSTREAM-CURRENT-STATE)

Every entry below was disproved by a real read or a real run during the 4-5 Sep session. Nothing here is a guess about what changed; each one names what replaced it.

## SESSION-LOG-NEEDS-VERIFICATION (draft)

Most of this file has now been settled, so it no longer earns its NEEDS-VERIFICATION framing.

- **"****`main`** at **`b101e63`****"** -> superseded. `main` is `ce4a639`, and `content.js` is 81,978 bytes. Its four merges and the byte sizes 81,319 / 58,777 / 37,830 / 12,878 were all confirmed exactly by his own terminal on 4 Sep, so that part was right while it lasted.
- **"Still not built: the dual-purpose CC button"** -> **built and merged** as PR 62.
- **"The extension already has a toast system (content.js:961), use it"** -> false at both `b101e63` and `ce4a639`. That claim came through from an older document and no grep ever supported it. Five real on-screen functions exist and none is at 961; the list is in the parent file of this skill. `showResumeToast` at 462 is the one to model job 2.2 on.
- The **`getSitePrefs`** section, and the wrong-call #3 that contradicts it -> both half wrong, now settled against real source. See the parent file: synchronous function, async read inside it, all three defects real.
- **"Audit hardening #2 is item 1 in the order I would do it"** -> reordered. The device test now outranks everything, because the CC button and the CRLF parse are both unproven and the tracker is quiet.

Still live and still worth keeping from that file: the Firefox popup file-picker constraint and its Mozilla bug numbers, the "do not copy the userscript's parser" finding, the two-machines lesson, and the six wrong calls it records. Those are the parts that do not go stale.

## SESSION-TOOLING-AND-CI-FACTS (draft)

The CI facts in this file were read straight from `validate.yml` and have all held up: `console.warn` is mandated not banned, the dedicated greps and the `grep -v '//.*fetch'` hole, the five-file version consistency, and both store ZIPs uploaded on every run with 7-day retention. Keep all of it.

What it gets wrong is `scripts/agent.sh`:

- **"****`gate`** runs scope, syntax, dom-contract, innerHTML, console.log, a CSS-class-exists check and an inline-style warning, then reverts everything and deletes the branch if any gate fails" -> true as a list, dangerously incomplete as advice. Three of those checks are vacuous on committed work, and the revert destroys a commit rather than restoring a tree. The full finding is in the parent file of this skill.
- The file also does not mention that **`prep`** requires an OPEN issue, which means an empty tracker silently disarms the whole harness. That cost a round on 4 Sep.

## SKIPSTREAM-RELEASE-WORK (parent)

- **"Live backlog, verified 29 Aug"**, five open items including PR 48 and issues 49/50/51 -> all closed. As of 5 Sep the tracker holds only 60 and 61.
- **"****`main`** has not moved since 15 Aug, HEAD **`0527017`****"** -> long dead. `ce4a639`.
- **"His rulings, 29 Aug: build issue 42, then audit suppression"** -> 42 shipped in PR 52, and the audit fix shipped in PR 58 with a SETTLED list and `FANOUT_ENABLED = false`. The remaining audit work is the source-line requirement, not suppression.
- **"1.10.0 is still what ships on AMO"** -> still true, and still the point: nothing has been released since, so the CC button is not in anyone's browser.

## REPO-LANDMINES-AND-AGENTS

- **"Queue as of 15 Aug 20:30"**, seven items -> stale ordering. Use the parent file of this skill.
- The Copilot and agent-fleet facts still hold, including the 8192-token ceiling that stops the fleet editing the big four files, and the rule that a deterministic script beats an executor for mechanical edits. That rule was ignored on 5 Sep and cost two rounds.

## OPEN-ITEMS-AND-QUEUE

- **"Local subtitle upload gives no feedback and does not attach"** -> the attach half is fixed by PR 62. The feedback half is job 2.2 and is still open.
- **"****`getSitePrefs`** async-inside-sync means the first video on a site can miss its rule" -> the symptom is right, the mechanism description was muddled. Settled now.
- The six device checks and the `2x` speed on 1shows item are all still outstanding and still blocked on the permanent install.
