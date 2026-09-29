<!-- archived from assistant skill 'Repo Writes and Executors', last updated 2026-09-24 10:22 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before personal-repo writes or handoffs; enforces isolated delivery, scoped approvals, direct downloads, binary integrity and retired-controller boundaries. -->

# REPO-WRITES-AND-EXECUTORS

Reconciled 10 September 2026. Use **Solo Repo Engineering**. Default to personal Google Cloud Shell and deterministic scripts for mechanical work, not a speculative LLM executor or assumed Codespace.

## One safe work packet

Resolve the intended repo and exact baseline first. Use a fresh isolated checkout so existing directories/dirt remain untouched. Enter the known absolute root and fail if it is wrong; cd with an empty git-derived path once created a shadow source tree in HOME.



Read all original files, verify hashes/modes and every anchor before writing. Prepare candidates and run positive/negative gates. Compare the full diff against the reviewed base/main, including committed changes. Explicitly stage only expected paths, commit and push normally, verify remote head/tree and open a PR. Stop before merge unless explicitly approved. No force-push of code or automatic destructive reset.



Do not use GitHub Contents API writes: this owner's earlier edits lost escapes. Do not stage all files; scratch binaries, pycache and unrelated work were accidentally swept in. If an ignore rule matches a verified intended path, force-add only that exact authorized path, never widen staging. Preserve executable modes; replacing a file can change mode, Python itself does not inherently remove execution bits.



Use failure-aware command chaining or checked subprocess calls. Everything up-to-date after a failed commit means nothing was pushed. Read configuration origins: local settings can override global signing values. Do not disable global security settings or discard user changes to fix one failed commit. Restore/revert only the reviewed scope with required approval.

## Delivery

One evolving action book with executed/next/history labels. Readable downloadable script plus short checksum/byte-count launcher; avoid giant inline/base64 pastes, indentation-sensitive copy blocks and extra ZIPs. Validate delivered bytes and missing/corrupt/duplicate-file refusal. Every block names the surface; otherwise say nothing to run.



Coherent verified batches are preferred to one file per prompt. Finish the next work packet without asking permission to begin research, but pause for missing evidence, failed gates and approvals. If no safe write is possible, output proposed content/evidence with an explicit unapplied label, not a fabricated success report.

## LLM executor boundaries

Use an LLM for constrained judgment, deterministic scripts for mechanical edits. Require per-item evidence and exact changed paths, not a narrated DONE. The owner's Gemini CLI environment has no shell tool; reading/.cand edits only, with owner-run shell gates. Other executors have claimed pushes/tests that never occurred and sometimes honestly refused; independently verify both success and refusal explanations.



A repo agent gets PR-only scope and no signing secrets or authority to approve owner choices. Never grant wider permissions just to avoid understanding a failure. Do not confuse a public code read with authenticated write capability.

## CLI lessons

Read the exact subcommand/version before automating flags. Short options can mean different things on list and patch commands; repeated selections can bind to the nearest preceding bundle, not the whole invocation. Inspect values after helper calls because a helper may overwrite a lock/version you set. Prefer existing verified levers over new wrappers, but trace the active execution route rather than a similarly named unused function.



Do not key edits on generated row indexes or an ambiguous first glob result. Count inputs, validate identity and preserve state across interrupted runs. Reusing an already-applied packet must refuse safely rather than dispatch another build or duplicate a PR.



## Delivery and result-state refinement, 19 September 2026

These shared refinements apply without crossing patch-factory and openskip release rules. Preserve all existing isolation, staging, owner-decision and no-force-push boundaries above.



Lead with the direct script attachment in chat. This owner's action-book download buttons failed twice; a successful fixture does not prove delivery in his client. The existing book can provide a copy-command and status, but do not make it the only download route or create another book. Use one readable file and a tested one-line personal Cloud Shell launcher: exact-one-file extension-free glob where required, regular nonsymlink file, exact encoded byte count and SHA256. Test missing, corrupt, duplicate, renamed-extension, symlink and directory refusal. No giant paste or checksum bypass.



Default remains PR-only. A specifically approved coherent packet may also include exact-head CI-gated merge, main CI and deployment verification; authorization must name those effects and the reviewed base/tree/path scope. Do not ask again for the same approved scope, and do not convert one approval into a standing automatic-merge policy. Unrelated APK dispatches, branch/release/local cleanup, settings, device changes and historical issue messages remain excluded unless separately authorized.



Every phase needs honest result state: prepared, authorized, pushed, PR opened, checks passed, merge attempted, merged, main validated, deployed and public bytes verified are different. A successful merge cannot reset merge_attempted to false. Failure after push/merge retains the actual remote effects and work/log/RESULT paths. Stop and inspect partial results rather than offering a blind rerun. Never edit or re-present an executed historical installer as current.



For deployment-sensitive changes, verify the exact deployment commit/environment and actual expected public bytes, including versioned asset URLs and companion configuration files. Test stale bytes, wrong site/commit, redirects and oversized responses. Mocked transports and local Git validate controller behavior, not real authentication, production availability or Android behavior. An expired or advanced main gate is a stop, not permission to silently rebase.



Personal Cloud Shell is owner-authenticated. Public reads by the assistant are not repository write access, and the sandbox has no internet access. Hand off only what has been locally verified, then independently check the returned result against actual remote evidence. No hidden background execution is implied after a reply. Workspace-hosted personal artifacts are not guaranteed private from the hosting workspace.



## September 24 executed-controller boundary

Historical exports may preserve executable text as evidence only. `pf-operations-refresh-a7167225c258` and `pf-resource-release-cd0b13e5b785` are executed/retired; preserve their files, work folders and RESULTs, never rerun or redispatch them. The PR70 writer acknowledged one publishing batch and stopped at an identity-reader guard; absent a saved rejected response, its cause remains UNKNOWN. Do not treat dispatch acknowledgement as publication or qualified-baseline evidence.
