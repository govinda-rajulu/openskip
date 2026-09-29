# Working agreement (shared by openskip and patch-factory)

Identical copy in both repos. Written 29 Sep 2026. Change it in both places or neither.

## Who does what

- The owner architects and decides. He has no coding background and cannot catch a wrong
  edit by reading it, so **gates are the only quality control**. Whoever writes code (an
  assistant, an agent, the council) also proves it.
- Chat sessions are deleted daily and nothing is kept on a laptop, in Cloud Shell or in an
  assistant's memory. **This repo is the only durable memory.** If a lesson is not written
  here it will be relearned the hard way.
- Owner decisions (accounts, signing, data, deletion, publishing, merging) are never filled
  in by someone else. A broad "go ahead" covers building and opening PRs, not merging,
  deleting or publishing.

## How work is handed to the owner

- Every block is either a command he pastes whole, or an explicit "nothing to run".
  No placeholders: capture values into variables inside the command.
- His terminal client mangles indentation and eats backslashes. Use single-line shell, or a
  readable script uploaded as a file plus a one-line launcher.
- Launcher pattern: exactly one file matching an extension-free glob, a regular file and not
  a symlink, exact byte count, exact SHA256, no backslashes, `if/then` (not `&&` chains).
- Scripts work in a fresh stamped clone (`~/work/<repo>-<packet>-<UTC stamp>`), never in
  `~/work/openskip` or `~/work/patch-factory`, and never reset existing work.
- Fast-forward pushes only. PRs only. No force-push, no automatic merge, explicit staging.
- **Self-clean on RESULT OK**: delete the script's own upload and its clone, append one line
  to `~/work/run-ledger.txt`, keep small logs in `~/work/run-logs/<stamp>/`. On STOPPED keep
  everything. Never touch files the script did not create.
- After a PUSH phase, paste the RESULT back; do not rerun the script.

## Gates that actually gate

- Gate on git **trees** (content), not commit ids or messages.
- Compare bytes to bytes. Python `len()` on text counts characters; files here contain
  multibyte characters.
- `git diff` is blind to committed work. Use `git diff main` (or the exact base).
- Patchers assert every anchor, write to a candidate file, and write nothing when a count
  is wrong.
- Every gate needs a negative control that is proven able to fail. A "corrupt the file"
  control must really change bytes (two broken controls happened: substituting a letter
  that was not present, and editing a line with no lowercase letters).
- New tests must fail on the old code, or they test nothing.
- Label evidence honestly and separately: source read, synthetic test, CI run,
  publication, device test. Configured, approved, applied, published and phone-tested are
  five different states.

## Executors

- A deterministic script beats an LLM for any mechanical edit.
- Gemini CLI on the owner's machines has no shell tool: reading and candidate-file edits
  only; the owner runs gates. Verify its claims and line numbers.
- LLM output (including the council) is advice. It never merges, deletes or publishes.

## Reading live state

- The assistant's sandbox has no internet. Live state comes from public GitHub reads or
  from the owner's terminal output.
- Public API endpoints can be stale. On 29 Sep 2026 `/repos/<r>/commits` returned a page a
  month old while `/repos/<r>/branches/main` was current. Read `branches/<name>` and the
  commit's tree, and check parent links before trusting a "latest" list.
- Always re-read live `main` before building a packet. On 29 Sep a script was built against
  a main that had moved (the assistant had merged a dependabot PR earlier the same day);
  its tree gate stopped it before any write.

## Privacy (both repos are public)

- Never commit secrets, tokens, keys, cookies, HAR files, raw chat exports or personal data.
- Never request passwords, keys or tokens in chat; never print secret-bearing argv.
- Large binaries (APKs, Actions artifact zips) never go into git.
