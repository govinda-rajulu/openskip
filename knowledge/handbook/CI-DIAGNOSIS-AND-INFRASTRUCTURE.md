<!-- archived from assistant skill 'CI Diagnosis and Infrastructure', last updated 2026-09-24 10:23 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load for CI or transport failures; checks exact runs, reporting defects, permission boundaries and reversible infrastructure changes. -->

# CI-DIAGNOSIS-AND-INFRASTRUCTURE

Updated 14 September 2026. Read Transport and parser diagnosis lessons below alongside this preserved September 10 contract. Use **Solo Repo Engineering** and the project skill. Distinguish workflow validation, job execution, artifact validation and actual deployment.

## Start with the exact run

Read head SHA, event/ref, job list and failing step before asking for logs or proposing a fix. Public job records can provide timestamps without authenticated log access, but may be stale/truncated. Verify completeness and freshness. An empty job list/startup failure may indicate rejected YAML or permission escalation, not a code regression. Inspect actual annotations.



A short failure suggests early setup/resolution; a long one may involve download/patching. These are clues, never proof of the failure mechanism. Container acquisition and runner acquisition can fail before application code runs; do not revert unexecuted code just to get green.



The pushed tree, not local dirt, is tested. Confirm the new remote SHA and correlate the dispatch with the correct target/ref/run; an unchanged last run after rejection is not evidence. gh run rerun retains its original commit. Prefer one coherent batch and bounded polling/status reads over repeated per-target requests.

## Logs and shell evidence

Use gh run view --log-failed for an identified failed run or the supported log download path. gh run watch shows step status, not log lines. Do not assume gh api .../logs follows a 302 or returns a ZIP; inspect returned type. Archive log paths can contain spaces. gh run list has no jobs field; query a specific run or job endpoint.



Read the full failing stage when a filter omits earlier evidence. Copy error strings from source. A Facebook diagnostic filter hid a prior anonymous GitHub 403 and sent debugging to a later symptom. Preserve full reports as evidence rather than blindly tailing a few lines.



Personal and repository tokens have different quotas; a generic rate_limit result may describe the wrong bucket. Inspect actual status/body; error objects are not empty arrays of releases. Default to public reads when appropriate, but do not strip required authentication from validated download paths. No token or signing argv in logs.



Shell traps retained: consecutive tabs collapse with IFS whitespace; use an explicit sentinel or structured format. A subprocess can consume a loop's stdin; isolate its input. Ambiguous globs, quoted optional-header expansions and matrix keys containing hyphens need explicit handling. Fail setup errors rather than interpreting missing files as zero findings.

## Validate before dispatch

Use actionlint for workflow semantics when available, shellcheck for shell, and syntax parsing for its narrower purpose. YAML parsing alone is not actionlint; none of these proves caller/callee permissions or runtime success. Do not invent availability or silently suppress existing failures. Keep test tools out of staged source.



A job that skips all useful steps can be green. Require explicit failure on missing prerequisites and verify relevant stages actually ran. A cache hit or file existence is not verified bytes; stale JARs and error-page downloads require identity/shape/hash checks. Publication needs actual asset evidence, not a workflow tick.



Dispatch only within approval and use nonpublishing diagnostics where possible. Do not alter a global diagnostic flag without preserving previous value and explicitly restoring it. Scheduled workflows are unverified until relevant runs are checked; this is not permission for an unapproved release.

## Scanner and permission judgment

Evaluate findings against the actual untrusted-input path, credential exposure and privilege boundary, not severity counts alone. Dismissal is a consequential write: explain evidence and obtain required approval. Overbroad permissions can break called workflows as well as expose secrets; narrow scope instead of widening callers blindly. Existing bugs are not automatically acceptable to ship.

## Non-repository infrastructure

For SQL, dashboards and stores, identify dependencies and a real revert path before changing access. Prefer additive migration, validation, then approved subtractive steps. RLS with no policy denies access; REVOKE semantics depend on the grantor. Do not assume git revert restores external state. Stage device-sensitive changes with relevant validation and respect owner deferrals by keeping independent work separate. Explicitly report limits and partial outcomes.



## Transport and parser diagnosis lessons, 14 September 2026

These practices extend the earlier workflow contract; they do not authorize a workflow dispatch or infrastructure change.



**Nonpublishing is not secret-free.** Inspect the steps before the failing stage. A normal Android build can decode signing material before downloading its input even with publication disabled. For transport-only questions, use a bounded read-only probe with no signing credentials, no unrelated application secrets and no secret-bearing command logging. Stop at validated input bytes; a subsequent patch/sign smoke needs its own justified scope. Do not weaken artifact gates, move sources or widen permissions to force a download green.



Declare each experiment's exact environment/client/version, hypothesis, observation that would support/refute it and retry bound. Keep experiments separate from the merge candidate unless their behavior is justified and verified. Session-start failures, cleanup and fallback changes are shared behavioral changes, not harmless diagnostics. A later common-helper head cannot inherit an earlier all-target smoke's coverage.



**Correlate recovery with code, not chronology.** Read exact head, target and useful steps on both failing and successful runs. Unchanged-code recovery demonstrates that an unmerged fix was unnecessary for that observed run; it does not prove a permanent repair or the root cause. Do not convert different browser/runner results into claims about IP reputation, TLS, cookies, expiry or remote outage without direct evidence. Public runs may be stale/truncated: inspect complete jobs, pagination and commit relationships. A run absent at one check is not a disabled schedule.



**Preserve parser evidence before interpreting it.** Save bounded, redacted raw stdout/stderr and exit status before parsing so failure retains the real format. Build parser fixtures from observed versioned output and actual archive metadata, not convenient imagined labels or filenames. Positive output, malformed/missing output and a negative control must exercise the downstream wrapper. Do not print secret-bearing arguments or persist temporary signed URLs/cookies.



Report stage-level partial success: a cryptographic verification pass remains a pass if a later metadata wrapper fails; the wrapper and unreached controls remain incomplete. Re-run only what an approved next operation requires, not every preceding successful stage. A retrieved file or successful release step is not independently inspected publication, original provenance or phone behavior.



These lessons arose from Friday's patch-factory session and its (internal link removed). The observed weekend recovery was on unchanged main, not the experimental PR. Consult the project handover for dated run identities; preserve these general practices across personal repositories without copying project-specific patch choices.



## September 24 reporting lesson

A RESULT's boolean/reporting fields can be wrong even when surrounding execution evidence is true. PR55/PR59-era false `merge_attempted=false` and deletion fields were reporting defects, not proof no writes happened. Reconcile actual remote effects, exact run identity and saved RESULT; repair future reports without editing historical output.
