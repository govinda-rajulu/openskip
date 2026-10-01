# Agent tooling review and autonomy design (1 Oct 2026)

Identical copy in openskip and patch-factory. Change it in both places or neither.
Tool facts go stale fast: re-check a tool's own page before adopting it. Verdicts: ADOPT,
IDEA (copy the idea, not the tool), REFERENCE, LATER, SKIP.

## Verdicts

| Tool | Verdict | Why, in one line |
|---|---|---|
| cloudflare/security-audit-skill | ADOPT (method) | Recon, hunt, adversarial validation, report, `findings.json` schema, independent verification. MIT. Pin a commit; do not vendor. |
| GitHub Agentic Workflows (gh-aw), Gemini engine | ADOPT (next worker) | Agent job is read-only; a separate job opens at most one PR; label trigger; cost, time and concurrency caps; uses our Gemini key. |
| Google Jules | ADOPT (easy lane) | Label an issue `jules`; a cloud VM runs setup and tests; free plan listed at 15 tasks a day. No hard path guard, so CI must enforce. |
| CodeRabbit | ADOPT (advisory) | Free for public repos, configured by `.coderabbit.yaml`. Cannot run tests. When rate-limited it posts a passing check, so never make it required. |
| Ralph loop | IDEA | Fresh process per round, one task per round, tests push back. Needs hard caps on rounds, time, tokens and repeated failures. |
| GSD Core | IDEA | Fresh context per task, durable plan and state files, verify before ship. `knowledge/` already does this. |
| arena-skill | IDEA | Attack, defend, judge. Use 2 to 4 candidates only on risky PRs, with tests as the judge. The tool itself runs up to 595 model calls. |
| TypeSafe Jev | IDEA | Typed decisions (accept, reject, escalate). Its preview terms forbid production use, so implement the idea in plain code. |
| freellmapi | IDEA | Provider fallback, cooldowns, a quota ledger. Its README says personal experimentation, not production. |
| awesome-free-llm-apis | REFERENCE | Discovery only; verify each provider directly. Candidates: Groq, Cerebras, Mistral free mode, Cloudflare Workers AI. |
| LiteLLM | LATER | Conventional router, if the small standard-library fallback stops being enough. |
| OmniRoute | SKIP | Fingerprint spoofing, session pooling, TLS interception, and a reported unauthenticated RCE in older versions. ToS and ban risk. |
| Roo Code | SKIP | Shut down on 15 May 2026; repository archived. |
| Copilot coding agent, claude-code-action, Codex | SKIP for now | Not available on free tiers with our keys. |
| CrewAI with tiny local models | SKIP | 1.5B models on a localhost Ollama cannot run in Actions and add noise. |

## Autonomy design (night shift)

The goal is fewer owner touches, not zero. The owner writes the wish and presses merge;
everything between is agents plus gates.

1. **Wish**: a plain-English issue. A clerk turns it into a spec with acceptance checks.
   Nothing starts until the owner adds the start label.
2. **Worker**: one bounded loop per issue: at most 5 rounds, fresh context each round, the
   repository's own tests as backpressure, at most one PR, never `main`.
3. **Gates**: tests, lint, a deterministic changed-path guard, and CI that really runs on the
   agent's PR. Gates decide; model votes explain.
4. **Review**: CodeRabbit and the council comment. Competing drafts only on PRs labelled risky.
5. **Verdict**: a script, not a model, labels the PR ready, needs-owner or rejected.
6. **Memory**: each run proposes lessons in its PR body; they land only through a reviewed packet.
7. **Report and brakes**: one pinned morning-report issue; repository variable
   `AGENTS_PAUSED=true` stops every agent workflow; caps on rounds, minutes and daily calls.

## Rules every agent workflow follows

- Owner-only trigger: check the exact owner login, and use a one-shot label removed on start.
- Least privilege: the agent job reads, a separate job writes. No `workflows: write`, no
  `actions: write`, no signing secrets in any agent job.
- Issue and PR text are untrusted: pass them through environment variables or files, never
  into shell source.
- PRs and pushes made with the default `GITHUB_TOKEN` do not start `pull_request` or `push`
  workflows. Use a GitHub App token or dispatch CI explicitly, or the PR sits unchecked.
- Path guard after the agent finishes: fail on any change to `.github/**`, safety lists,
  lockfiles or anything the repository's AGENTS.md forbids. AGENTS.md is advice; the guard is law.
- Pin third-party actions to full commit SHAs. One run per issue at a time. Always set
  `timeout-minutes`.
- Count a context cap against the files that matter. A cap smaller than the file being edited
  means the model edits code it never saw.
- Free tiers change without notice. Quota numbers are dated observations, not facts.

## Security audits with the Cloudflare method

- Pin `cloudflare/security-audit-skill` to a commit and record it in the audit folder.
- Run read-only. Write `findings.json` against the skill's `report-schema.json` and gate on its
  `validate-findings.cjs` (Node, no dependencies).
- Every finding needs a concrete exploit path and a quote from the code. The validating agent
  is never the agent that found it. Defence-in-depth gaps are hardening notes, not vulnerabilities.
- Runs are additive: feed earlier confirmed and rejected findings into the next run.
- Map confirmed findings to the repository's own ids before anyone fixes them. A finding is
  fixed only when a test that fails on the old code passes on the new one.
- Free executors, in order: the assistant reading public files, Jules, gh-aw. Never an executor
  that holds signing material or release rights.
