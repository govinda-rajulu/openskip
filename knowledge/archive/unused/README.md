# Unused files (moved here 3 Oct 2026, 5S)

Kept for history; nothing in CI, scripts or the extension uses them.

- `update_release.py`: wrote updates.json; the release now edits it by hand (HOW_TO_RELEASE.md).
- `crew_master.py`: an early CrewAI agent experiment (was `agent_team/`), replaced by scripts/agent.sh.

Retired on 5 Oct 2026 (os-147, owner decision):
- `agent.sh`: its gate checked only uncommitted changes and force-deleted the branch on failure.
- `version-bump.yml`: read ANTHROPIC_API_KEY, hard-coded gemini-2.0-flash, force-pushed, and
  bumped 6 of the 7 version places. Release packets bump all 7.
- `store-version-check.yml`: its "CWS not configured" guard ended one step only, so the job
  could still dispatch an AMO submit.
- `ai-weekly-audit.yml`: replaced by the agent desk (knowledge/agents/README.md).
GitHub runs workflows only from .github/workflows, so files here never run.
