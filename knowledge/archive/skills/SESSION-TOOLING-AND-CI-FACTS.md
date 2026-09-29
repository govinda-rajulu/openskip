<!-- archived from assistant skill 'Session Tooling and CI Facts', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: What SkipStream CI actually enforces (read from validate.yml), plus the patching and Gemini CLI practices that survived the 30 Aug-3 Sep session. Load with the session log. -->

# SESSION-TOOLING-AND-CI-FACTS (sub-skill of SKIPSTREAM-RELEASE-WORK)

Companion to `SESSION-LOG-NEEDS-VERIFICATION.md`. Split out only for length; the same NEEDS-VERIFICATION caveat applies, though the CI facts below were read directly from `validate.yml` on 2 Sep and are the most reliable thing in either file.

## What CI actually enforces (read from validate.yml, 2 Sep)

Worth knowing because I contradicted it twice before reading it.

- Runs on `push: [main]` and `pull_request: [main]` with **no path filter**. Any PR to main gets checked, including workflow-only ones.
- `console.warn` is **mandated, not banned**. The step is named "Check for console.log (should use console.warn only)" and its failure message says "use console.warn for diagnostics". So two of audit 59's findings contradict the repo's own enforced rule, and a `console.warn` diagnostic patch would **not** have failed CI. I told him it would.
- Dedicated greps for `innerHTML`, `console.log`, `localStorage` in the content script, `fetch(` in the content script, and hardcoded secrets. **The fetch grep has a hole**: `grep -v '//.*fetch'` excludes any line whose comment mentions fetch.
- Version consistency covers **five** files: `manifest.json`, `manifest-chrome.json`, the `popup.js` header comment, the README badge, and `updates.json` (last element must match). The skill says the bump touches seven; `popup.css` and `CHANGELOG.md` are not CI-checked. Unresolved.
- It **builds and uploads both store ZIPs** on every run, `skipstream-firefox-zip` with 7-day retention, and verifies each contains every required asset. This is the source for a permanent local install.

## Working practices that earned their place

- **Base64 the patcher.** Build the Python locally, base64 it, have him `cat > /tmp/x.b64  ...` branches, saves the issue body as `.agent-spec.md` and prints a prompt; `gate` runs scope, syntax, dom-contract, `innerHTML`, `console.log`, a CSS-class-exists check and an inline-style warning, then reverts everything and deletes the branch if any gate fails.

## Ideas that died, so nobody resurrects them

- **The frame guard.** I ranked it first for a while: four separate findings (per-frame cloud sync, `sessionsTotal` incrementing per ``, the still-watching poller, and the audit's architecture violation) all traced to `all_frames: true`. **His own test killed it: the counter moves by 1, not 2.** And `content.js` already has deliberate top-frame guards at 219, 226, 233, 772, 1974 plus a postMessage relay at 1313-1341. The frame model is designed, not accidental. Any blanket top-frame guard would break intro skipping on every embedded player, which is the whole product.
- **Two dead alarm functions.** Both defined. Audit artifact.
- **Empty Segments and Playback panels.** `options.html` has exactly five panels: connections, siterules, history, stats, dataadvanced. There are no empty panels to cut. That item came from a stale note.
- **A version mismatch.** I read 1.7.11 off `raw.githubusercontent` and believed it. Both manifests read **1.10.0**, matching AMO. The convenience endpoint served me a cached copy, which his own notes already warn about.
