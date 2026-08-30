#!/usr/bin/env bash
# agent-run.sh - hand one issue to Gemini CLI; let nothing through that fails a gate.
# Usage: scripts/agent-run.sh <issue-number> <allowed-file> [more-allowed-files...]
# Example: scripts/agent-run.sh 42 options.js options.html
set -uo pipefail

ISSUE="${1:-}"
shift 2>/dev/null || true
ALLOWED=("$@")

die() { printf '\n\033[1;31mSTOP: %s\033[0m\n' "$1"; exit 1; }
ok()  { printf '\033[1;32m  ok\033[0m  %s\n' "$1"; }
step(){ printf '\n\033[1;33m== %s\033[0m\n' "$1"; }

[ -n "$ISSUE" ] || die "usage: scripts/agent-run.sh <issue-number> <allowed-file>..."
[ "${#ALLOWED[@]}" -gt 0 ] || die "name at least one allowed file"

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repo"

# ------------------------------------------------------------------ preflight
step "Preflight"
[ -z "$(git status --porcelain)" ] || die "working tree is dirty. commit it, or run: git checkout ."
ok "clean tree"

[ -f scripts/dom-contract.py ] || die "scripts/dom-contract.py missing: the main gate would be fake"
ok "dom-contract.py present"

for f in "${ALLOWED[@]}"; do
  [ -f "$f" ] || die "allowed file does not exist: $f"
done
ok "allowed files exist: ${ALLOWED[*]}"

[ -f GEMINI.md ] || die "GEMINI.md missing: the agent has no rules to follow"
ok "GEMINI.md present"

command -v gh     >/dev/null || die "gh not on PATH"
command -v gemini >/dev/null || die "gemini not on PATH"

STATE=$(gh issue view "$ISSUE" --json state --jq .state 2>/dev/null) \
  || die "cannot read issue $ISSUE. check: gh auth status"
[ "$STATE" = "OPEN" ] || die "issue $ISSUE is $STATE, not OPEN. it may already be done"
ok "issue $ISSUE is OPEN"

BASE=$(git rev-parse --abbrev-ref HEAD)
BRANCH="agent/issue-$ISSUE"
if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  die "branch $BRANCH already exists. finish it, or: git branch -D $BRANCH"
fi

# --------------------------------------------------------------------- branch
step "Branch"
git checkout -q -b "$BRANCH" || die "could not create $BRANCH"
ok "on $BRANCH (base: $BASE)"

SPEC="/tmp/issue-$ISSUE.md"
gh issue view "$ISSUE" > "$SPEC" 2>/dev/null || die "could not save the issue body"
[ -s "$SPEC" ] || die "issue body came back empty"
ok "spec saved: $SPEC ($(wc -l < "$SPEC") lines)"

# ---------------------------------------------------------------------- agent
step "Gemini"
LOG="/tmp/agent-$ISSUE.log"
PROMPT="Read GEMINI.md in the repo root and $SPEC.

Implement issue $ISSUE exactly as the acceptance criteria in $SPEC specify.

You may edit ONLY these files: ${ALLOWED[*]}
Do not create files. Do not touch any other file. Do not add a package.json.
Do not refactor anything you were not asked to change.

When done, run and paste the real output of:
  node --check ${ALLOWED[0]}
  python3 scripts/dom-contract.py
If a gate fails, revert your edits and say so."

gemini -y -p "$PROMPT" 2>&1 | tee "$LOG"
ok "agent finished. transcript: $LOG"

# ---------------------------------------------------------------------- gates
step "Gates (mine, not its)"
FAIL=""

CHANGED=$( { git diff --name-only; git ls-files --others --exclude-standard; } | sed '/^$/d' | sort -u )
[ -n "$CHANGED" ] && { printf '  touched:\n'; printf '    %s\n' $CHANGED; } \
                  || die "the agent changed nothing at all"

STRAY=""
for f in $CHANGED; do
  keep=""
  for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && keep=1; done
  [ -n "$keep" ] || STRAY="$STRAY $f"
done
[ -n "$STRAY" ] && FAIL="$FAIL
  - touched out of scope:$STRAY" || ok "scope respected"

for f in $CHANGED; do
  case "$f" in
    *.js) if node --check "$f" >/dev/null 2>&1; then ok "node --check $f"
          else FAIL="$FAIL
  - syntax error in $f"; fi;;
  esac
done

DOM=$(python3 scripts/dom-contract.py 2>&1)
printf '  dom-contract: %s\n' "$DOM"
printf '%s' "$DOM" | grep -q "DOM contract OK" || FAIL="$FAIL
  - dom-contract.py did not print OK"

if grep -rn "innerHTML" "${ALLOWED[@]}" >/dev/null 2>&1; then
  FAIL="$FAIL
  - innerHTML present (CI would fail)"
else ok "no innerHTML"; fi

if grep -rn "console\.log" "${ALLOWED[@]}" >/dev/null 2>&1; then
  FAIL="$FAIL
  - console.log present (CI would fail)"
else ok "no console.log"; fi

if git diff | grep -qE '^\+.*storage\.(local|sync)\.set' \
   && ! git diff | grep -qE '^\+.*skipstream_stats'; then
  FAIL="$FAIL
  - writes storage without skipstream_stats (new storage key?)"
fi

# -------------------------------------------------------------------- verdict
if [ -n "$FAIL" ]; then
  printf '\n\033[1;31mFAILED. reverting everything.\033[0m%s\n' "$FAIL"
  git checkout -- . 2>/dev/null
  git clean -qfd 2>/dev/null
  git checkout -q "$BASE" 2>/dev/null && git branch -qD "$BRANCH" 2>/dev/null
  printf '\nRepo is exactly as you left it. Transcript kept: %s\n' "$LOG"
  printf 'Send me that transcript plus the failure list above.\n'
  exit 1
fi

step "All gates green"
git --no-pager diff --stat
git diff > "/tmp/diff-$ISSUE.patch"
cat <<EOF

Full diff: /tmp/diff-$ISSUE.patch   (cloudshell edit /tmp/diff-$ISSUE.patch)
Nothing is committed. Read it, then pick one:

  ship:  git -c commit.gpgsign=false commit -am "feat: close #$ISSUE" && git push -u origin $BRANCH && gh pr create --fill --base $BASE
  bin:   git checkout -- . && git checkout $BASE && git branch -D $BRANCH

EOF
