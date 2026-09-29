<!-- archived from assistant skill 'Judgement and Scope', last updated 2026-09-24 10:23 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load when choosing engineering scope; favors coherent verified batches and preserves owner choices, cleanup, privacy and historical boundaries. -->

# JUDGEMENT-AND-SCOPE

Reconciled 10 September 2026. Use **Solo Repo Engineering**. Scope is a safeguard, not an excuse to split coherent work into endless prompts.

## Choose useful work

Inspect the actual request and current source. Fix the shared class when evidence supports it, not only the first failing instance. Prefer deterministic shared mechanisms over a pile of per-app exceptions. Keep the smallest coherent PR that can be independently tested; a multi-target shared-code fix can be more reviewable than duplicated one-target fixes.



When the owner asks for fewer steps, remove work from his loop. Continue preparing the next verified packet rather than repeatedly asking permission to start research. Pause when a gate fails, evidence is missing, scope changes materially or confirmation is required. A detailed request is not permission for unchecked bulk writes.



A pre-existing defect is not automatically harmless or a reason to ship. Judge actual impact and the requested operation. Do not demand publication or device tests for unrelated documentation work. Respect explicit owner-only deferrals without relabeling them complete.

## Decisions are not automation inputs

Owner choices affecting accounts, patch approvals, signing, installed imports, data or rollback remain theirs. Configured, applied, approved, published and device-tested are distinct states. A blank/CONFIRM choice cannot be filled by an agent merely because it seems sensible. Preserve state/advice separation and no-op unchanged review round trips.



Enabling a new target is separate from safely proposing its disabled configuration. Validate required inputs and generated derivatives first. Extra-provider availability is not automatically a useful or approved patch set. Generate factual configuration from source, then check that generated semantics match behavior.

## Cleanup and recovery

Automation should reduce work, not delete by default. Tidiness alone is not a reason to destroy recoverable state. A deliberately frozen fallback or attic must be protected explicitly; unreferenced files may be retained intentionally. Know the restore path before packaging/versioning/release changes. Fresh exact target preview and approval precede destructive operations. Never recycle an old delete approval into a larger set.



Name the cost of uninstall, key changes or data migration; do not hide it in a routine step. Same key/package is not a blanket update guarantee. Preserve data and verify actual constraints. Keep scope and privacy boundaries separate: a personal execution account does not make workspace artifacts invisible.

## Documentation is part of the deliverable

After changing behavior, search for OLD BEHAVIOR in docs and skills, not just the identifier. A current instruction that contradicts code can reproduce a repaired bug. Preserve useful mistakes as dated lessons, implemented fixes as completed and open work with acceptance criteria/evidence limits.



Do not rewrite history into a falsely tidy story. The Hotstar restriction after patch changes is not proof of a specific causal patch. Two summaries copying each other are not independent evidence. A portable handover, saved skill and merged repo document are different outcomes.



Keep useful ideas from other reviewers while rejecting unverified implementations. A health view should consume trustworthy evidence on the existing surface, not duplicate a dashboard. Alternative sources need a bounded compatibility/provenance pilot, not a wholesale swap. Refactors, bots and webhooks must earn their maintenance cost.



Before public delivery, inspect for unrequested branding or injected UI. A generated page once shipped a Brain badge unintentionally. Verify the actual artifact rather than trusting arbitrary word-count/grep zeroes that could hide legitimate content.



When wrong, state the correction briefly and re-derive it. If errors accumulate, reduce fragile payloads and increase measured controls, not confidence.



## September 24 scope lesson

A broad instruction to finish pending work is not permission to collapse distinct scopes. The September reconciliation separated PR68 operational-doc shipment from the older refused 14-file proposal, PR70 exclusion decisions from patch/device proof, and PR70 dispatch acknowledgement from publication. Keep those boundaries in the next packet.
