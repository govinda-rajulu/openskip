<!-- archived from assistant skill 'Gates', last updated 2026-09-24 10:23 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before gates or launchers; covers byte checks, negative controls, unchanged round trips, pre-write refusal and export coverage limits. -->

# GATES

Reconciled 10 September 2026. Load **Solo Repo Engineering**. A gate sits before the irreversible operation, tests the intended end state and must refuse bad or unknown inputs.

## Design gates before edits

Read exact anchors and count matches; never invent a needle, version or expected count. Calculate byte counts/deltas from encoded bytes. len(decoded_text) is characters. Preserve modes and compare Git trees as well as content; plain git diff misses committed changes, so compare against reviewed base/main.



Validate every planned input before writing any target. Stage candidates, test them, then replace only within an authorized scope. Refuse partial/ambiguous inputs, unknown coverage and stale bases. An idempotent already-applied refusal is useful; say what it means instead of inviting a blind rerun. A multistep writer needs rollback/partial-state reporting if replacement fails, not an unsupported claim of absolute atomicity.



Prefer one coherent batch with all preconditions checked, not rigid one-file-per-prompt limits. Never anchor on a generic brace. Region removal needs unique boundaries, measured scope and must-survive checks. Destructive operations require fresh target preview/approval, nonempty keep sets, no overlap, exact tips/leases where applicable and restore points.

## Controls that make tests meaningful

- Bad input must fail before a write/push/merge/release. Good input must reach the changed stage and succeed.
- Prove compared inputs are nonempty and setup commands succeeded. Zero hits can mean broken setup, not clean data.
- Test missing, corrupt, duplicate and stale files as well as the happy path. An assert that repeats the producer's wrong assumption is weak corroboration.
- Counts must come from actual output. grep -c counts lines, not occurrences. A count that would pass before the edit is not proof the edit worked.
- Do not call syntax parsing a semantic test or a local mock an actual external-system run. Record cumulative suites honestly.

## Review round trips

Generate an editable sheet, apply it unchanged, require zero modifications. State and advice must be separate columns. A historical writer interpreted only plus rows and erased untouched undecided choices; another changed includes but left exclusions. Preserve question marks, validate current policy/identity, reconcile both lists and test conflicts.



Before a small JSON edit, verify the serializer round trip preserves formatting; otherwise a one-value change can become an unreadable rewrite. Compare exact before/after bytes and review the full diff.

## Handoff gates for this owner

Client mangles long pastes, indentation and backslashes. Prefer downloadable scripts with a short one-line checksum launcher, exact expected byte size and exact-one-file extension-free glob where uploads alter suffixes. Missing/wrong/duplicate files abort. Do not bypass checksums, send giant base64 or conceal a bad file behind a renamed one.



Test the launcher itself. Every executable block specifies its surface and dependencies; nonactions say nothing to run. Walk the action book in order: each consumed file must exist and each prior gate must have passed. Historical installers must not look current.

## Shell lessons

A zero-result grep can exit nonzero and break a chained command; grep -q can close a pipeline early. Use deliberate exit handling, not blanket suppression. Fail closed after setup/commit errors instead of semicolon-chaining through them. Avoid shell-parsing user/provider data; use argv arrays. Never print secret-bearing argv during debugging.



Read exact CLI subcommand semantics, quoting and argument-group scope. A readable launcher is not a verified one until the delivered bytes and behavior are checked. If a gate fails, preserve the failure evidence and stop; fix the assumption rather than relaxing the gate to force green.



## September 24 gate lesson

Hash-complete exports and green package checks are gates on included files only. They do not prove raw-history completeness, external publication, installed behavior or deletion safety. Treat omitted/truncated/unknown-source coverage as a failing gate for completion claims, not as zero findings.
