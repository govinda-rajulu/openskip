<!-- archived from assistant skill 'Verification', last updated 2026-09-24 10:22 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before completion claims; separates source, fixture, CI, publication, recovery, raw-history and device evidence with read-back checks. -->

# VERIFICATION

Reconciled 10 September 2026. Use **Solo Repo Engineering** and the matching project skill. Evidence comes from actual source/output and the consumer, not a confident summary.

## Evidence ladder

Distinguish source review, local synthetic/mock tests, actual CI integration, published bytes, independently trusted provenance and device behavior. None implies the next. Cumulative test totals are not additive across iterations, coverage percentages or security certificates; tests written by one assistant can share assumptions. Report what ran and what it exercises, not just a large count.



Completion depends on the requested operation. A nonpublishing repair can be merged/tested without publishing; never dispatch a release just to satisfy a slogan. A publication claim requires actual release assets/metadata. A device claim requires device evidence. Owner-deferred tests remain unverified without blocking unrelated work.

## Before trusting a result

- Read full relevant source/diff at the exact commit. Check the execution route and downstream consumer, not a similarly named dormant file. CLI and desktop implementations once used different argument semantics.
- Validate source HEAD/tree relationships and response completeness. Public APIs can cache stale refs/counts; compare exact Git trees and known jobs, paginate enumerations. A repeated hash or inconsistent metadata requires investigation, not an automatic fabrication accusation.
- Hash exact bytes, not decoded character counts; verify file modes and staged/pushed tree. Byte count equality alone is not semantic correctness. A generator can faithfully reproduce wrong prose.
- Test the detector itself with positive and negative controls. Prove inputs exist, are nonempty and that the test reaches the changed stage. A broken setup plus zero findings is not a pass.
- A green job can mean all useful work was skipped. Verify required stages executed, coverage is nonzero, expected artifacts exist and identity/report provenance matches the run.
- Read the consumer before the producer gate. A correct APK can be rejected/discarded downstream if metadata/path/output contract differs.
- A no-op edit is not proof the intended value is already present. Inspect actual fields instead of commit messages or a copied ledger.

## Diagnosis rules

Use actual job/step evidence first, then full logs where necessary. Time-to-failure narrows hypotheses but does not prove a download occurred. Copy grep strings from real source. When another theory lacks evidence, inspect raw input/output rather than inventing a mechanism.



Do not head/tail away decisive output or test already-patched artifacts as clean inputs. Verify archive shape and identity, not existence or a success banner. Filename .so does not prove ELF; host SHA metadata does not prove independent authenticity; cryptographic signer match does not prove installed-app continuity or runtime safety.



A transient 403 is one observation, not proof a provider/source is permanently dead. The corrupt patcher JAR's exact cause remained unknown because failed bytes were unavailable. Keep that uncertainty even after a robust downloader fixes the class.

## Tools and handovers

YAML parsing is not actionlint; actionlint is not runtime permission validation. If unavailable, disclose it. A scheduled workflow's behavior needs relevant execution evidence, but obtain required dispatch/publication approval and use nonpublishing paths where supported.



Treat old handovers as hypotheses: trace completed/open/partial claims to current source and evidence. Two ledgers copying each other are not independent corroboration. Preserve owner decisions and lessons as dated facts, never obsolete executable instructions. A two-pass audit by one assistant is not two independent auditors.



Read back successful edits and reload the intended consumer. Prepared, saved, merged, published and device-tested are distinct labels. Exporting a handover does not update repo docs; editing a task-backed skill counts only after skill reload reflects it. Never claim inaccessible history or failed writes were covered.



## September 24 handover evidence limits

A complete supplied export is only complete for that measured input. Payload hashes prove included bytes, not raw-message completeness, semantic truth, live repository state, publication, installed behavior or deletion safety. Source-linked excerpts marked not verbatim are evidence summaries, not full bodies. A narrow fresh chat retrieval can verify a decision message after a broad load omitted replies, but it still does not recover truncated tails or an unknown unindexed gap. Report recovered, truncated, unverified and later-context evidence separately.
