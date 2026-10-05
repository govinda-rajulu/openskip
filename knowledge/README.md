# openskip knowledge base

Everything a person or agent needs so that nobody repeats a mistake already made here.
Moved into the repo on 29 Sep 2026 because chat sessions are deleted daily.

## Read in this order

1. [WORKING-AGREEMENT.md](WORKING-AGREEMENT.md): how work is handed to the owner, gates, privacy.
2. [STATE.md](STATE.md): the latest dated checkpoint: open PRs, what is deferred, where to start.
3. [LESSONS.md](LESSONS.md): wrong calls and findings, newest first. Read before proposing a fix.
4. [audits/STATUS.md](audits/STATUS.md): every audit finding and whether it is fixed, in a PR or deferred.
5. `../AGENTS.md`: repo layout and hard rules (no `fetch()` or `localStorage` in the content
   script, the four workflow file lists, CSS token namespaces).

## Reference

- [audits/](audits/): the two 29 Sep 2026 audits, verbatim apart from removed sandbox paths.
- [handbook/](handbook/): the owner's general engineering handbook (verification, gates,
  repo writes, CI diagnosis, scope, handovers). Same files in patch-factory.
- [agents/](agents/): the agent desk: contract, skills, settled list, backlog (os-147).
- [sessions/](sessions/): one summary per working session (what happened, decisions, wrong
  calls). Not chat logs.
- [archive/handovers/](archive/handovers/): hand-over notes between chats, verbatim, historical.
- [archive/skills/](archive/skills/): the assistant skill notes this knowledge came from,
  verbatim, last written 5 Sep 2026 or earlier. **Historical**: where they disagree with
  STATE.md or the code, STATE.md and the code win. See [archive/README.md](archive/README.md).

## Trust order

Live code and GitHub state > CI output > STATE.md > LESSONS.md > audits > archive.
Every number in prose is a dated snapshot. Re-read the source before acting on one.

## Keeping it current

- At the end of every session add a dated section to the top of STATE.md and append new
  lessons to LESSONS.md. Do not rewrite history; mark a superseded claim as superseded.
- Docs-only PRs, one concern each. Nothing here is executable guidance on its own.
