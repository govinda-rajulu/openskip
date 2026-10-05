# Agent desk

Written 5 Oct 2026 (os-147). Free model seats find problems and argue about them.
**They never write code, merge, label for fixing or publish.** A script decides what is
kept. The owner and the assistant analyse what is kept and do the fixes. This page is
the whole contract; `scripts/agent_desk.py` is the code and `tests/desk.test.mjs` proves it.

## How a run works

1. **Hunt.** Every seat (OpenRouter, Gemini, NVIDIA; see `scripts/ai_call.py`) reads one
   whole file with numbered lines, with one skill from [skills/](skills/). A file larger
   than the budget is not read at all. It is never cut.
2. **Verify (script).** A finding survives only if its quote is really on one line of that
   file. A made-up quote is dropped and counted against that seat in the report.
3. **Settled (script).** A quote that matches [SETTLED.md](SETTLED.md) is dropped.
4. **Cross-examine.** Every other seat sees the claim and 25 lines on each side. It answers
   CONFIRM, REFUTE or UNSURE, with its own quote from that excerpt. A vote without a real
   quote is not counted.
5. **Verdict (script).** confirmed = at least one cited confirm and no cited refute.
   refuted = more refutes than confirms. disputed = both. unchecked = no valid vote.
6. **Publish.** Each confirmed finding becomes one issue (labels `agent-finding`,
   `needs-owner`), never twice (a fingerprint of file and quote). Everything else is in
   the `[agent-desk] report` issue, which keeps the last 6 runs.

## When it runs

- Every Monday 06:00 UTC: one hunt. The topic rotates by week: SECURITY-HUNT, BUG-HUNT,
  PERF-HUNT, DOCS-DRIFT, DEAD-CODE.
- The 1st of every month: the exam and the live source check.
- By hand (Actions > Agent desk): `hunt` with a topic, `exam`, `seed`, `sources`.
- Repository variable `AGENTS_PAUSED=true` stops it and every other agent workflow.

## The exam

[../../tests/fixtures/agent-exam/](../../tests/fixtures/agent-exam/) holds two small files
with 7 planted problems and 5 decoys (correct code that looks suspect). The answers are in
`ANSWERS.json`, which no seat sees. A pass needs recall 0.6 or more, zero made-up quotes and
at most one false alarm. **Fix rights** (an agent that opens a PR from a `agent-task`
issue) need 3 passed exams in a row, recorded in the report issue, and the owner's yes.
Until then fixes stay with the owner and the assistant.

## Rules that do not change without an owner-approved PR

- Seats have no tools and no tokens. The desk job reads the repository and writes issues;
  it cannot push, label for fixing, or call any GitHub endpoint except the four in
  `GitHub.ALLOWED`.
- Model text on GitHub is cleaned: no mentions, HTML, images or code fences.
- Every prompt carries a random canary. A seat that repeats it is discarded for the call.
- A finding is fixed only when a test that fails on the old code passes on the new code.
- New lessons from a run are proposed in the report and land only through a reviewed PR
  into `knowledge/LESSONS.md`.

## Files

| File | Purpose |
|---|---|
| [skills/](skills/) | One file per topic: `Load when:`, `Files:`, then the checklist |
| [SETTLED.md](SETTLED.md) | Already investigated, not findings (quote patterns) |
| [BACKLOG.md](BACKLOG.md) | Tasks for agents and the owner; `seed` turns them into issues |
| `scripts/agent_desk.py` | The desk; standard library only |
| `.github/workflows/agent-desk.yml` | Schedule, manual runs, off-switch |
