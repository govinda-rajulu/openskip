# Packet Lessons (W5 to W13)

Generic lessons from patch-factory packets W5 to W13 (9 to 10 Oct 2026). Mirrored in both
repositories; each copy arrives by that repository's own pull request.

## Controllers

- One controller per packet. It gates on the exact main commit and stops with MAIN_MOVED.
- Every phase reads state first, so a rerun after OK changes nothing. Mark finished phases.
- The packet commit is made on the owner box with a fixed author and date; compare trees,
  not commit ids.
- Rehearse the exact shipped file against a fake GitHub: the happy path, a rerun, and every
  stop you can provoke. A precondition in an API's docs is a test case for the fake.
- Read live facts a record relies on (a licence, a version code) in the gate, before any push.
- Launchers use if/then with one side effect each and their own result line; never a && b || c.

## Automation

- A preview token goes stale when anything it lists changes. Wait for the deploy the merge
  starts, then preview, then apply at once.
- A bot that pushes to main must pause while a packet branch exists.
- A cancelled run replaced by a newer run is not a failure.
- Heavy jobs run one at a time on a schedule, never as a burst.

## Choices that change by themselves

- A provider can drop a name without dropping the feature. Drop lost names by name, cap the
  count, say so in the output, and never fail the whole product for one name.
- A fallback must never compete with the primary on its own score; it runs only after the
  primary fails, with its own pins.
- Choose by coverage of what you actually use, break ties by newest, and keep the old rule
  when the evidence is in doubt.
- Safety rails (exclude lists, bans) are never edited by automation.

## Records

- Describe the risk, not the rule: a record that names a rule invites a block on the name.
- Promise only what the packet ships. Cutting promised scope needs the owner's yes.
- A handover names what it could not cover, and why.
- Before a session ends, the tools it built go into the repository too.
- Wrapping a shell step changes its environment, signals included: under pipefail, `cmd | grep -q`
  fails with 141 once SIGPIPE is default. Test checks with the wrapper, not only alone.
- A pre-check must be no stricter than the step it predicts. Read a past success log first.
