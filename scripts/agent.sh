#!/usr/bin/env bash
# agent.sh - drive Gemini CLI against one issue, with gates you can trust.
#
# Your admin disabled YOLO mode, so the agent cannot run unattended. This splits
# the job in two:
#
#   scripts/agent.sh prep <issue> <file>...   branch, fetch spec, print the prompt
#   scripts/agent.sh gate                     run every gate on what it did
#
# Between the two you run `gemini`, paste the prompt, and approve its edits.
set -uo pipefail

MODE="${1:-}"
shift 2>/dev/null || true

die()  { printf '\n\033[1;31mSTOP: %s\033[0m\n' "$1"; exit 1; }
ok()   { printf '\033[1;32m  ok\033[0m  %s\n' "$1"; }
step() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  !!\033[0m  %s\n' "$1"; }

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repo"
STATEFILE=".git/agent-run-state"

# --------------------------------------------------------------------- prep
if [ "$MODE" = "prep" ]; then
  ISSUE="${1:-}"; shift 2>/dev/null || true
  ALLOWED=("$@")
  [ -n "$ISSUE" ] || die "usage: scripts/agent.sh prep <issue> <file>..."
  [ "${#ALLOWED[@]}" -gt 0 ] || die "name at least one allowed file"

  step "Preflight"
  if [ -n "$(git status --porcelain)" ]; then
    printf '\n  uncommitted:\n'; git status --short | sed 's/^/    /'
    die "dirty tree. commit those, or: git checkout . && git clean -fd"
  fi
  ok "clean tree"

  [ -f scripts/dom-contract.py ] || die "scripts/dom-contract.py missing: the main gate would be fake"
  [ -f GEMINI.md ] || die "GEMINI.md missing: the agent has no rules"
  for f in "${ALLOWED[@]}"; do [ -f "$f" ] || die "no such file: $f"; done
  ok "gate script, rules and target files all present"

  STATE=$(gh issue view "$ISSUE" --json state --jq .state 2>/dev/null) \
    || die "cannot read issue $ISSUE (gh auth status?)"
  [ "$STATE" = "OPEN" ] || die "issue $ISSUE is $STATE, not OPEN"
  ok "issue $ISSUE is OPEN"

  BASE=$(git rev-parse --abbrev-ref HEAD)
  [ "$BASE" = "main" ] || warn "base is $BASE, not main. intended?"
  BRANCH="agent/issue-$ISSUE"
  git rev-parse --verify --quiet "$BRANCH" >/dev/null \
    && die "branch $BRANCH exists already. finish it, or: git branch -D $BRANCH"

  step "Branch and spec"
  git checkout -q -b "$BRANCH" || die "could not create $BRANCH"
  ok "on $BRANCH (base $BASE)"

  # Gemini's sandbox refuses paths outside the repo, so the spec lives here.
  SPEC=".agent-spec.md"
  grep -qx "$SPEC" .git/info/exclude 2>/dev/null || echo "$SPEC" >> .git/info/exclude
  gh issue view "$ISSUE" > "$SPEC" || die "could not save the issue body"
  [ -s "$SPEC" ] || die "issue body came back empty"
  ok "spec at ./$SPEC ($(wc -l < "$SPEC") lines), git-ignored"

  printf '%s\n%s\n%s\n' "$ISSUE" "$BASE" "${ALLOWED[*]}" > "$STATEFILE"

  step "Now: run  gemini  and paste this"
  cat <<PROMPT

Read ./GEMINI.md and ./$SPEC (both in this repo root).

Implement what $SPEC specifies. First check whether any of it already exists in
the codebase and say so before you change anything.

Edit ONLY: ${ALLOWED[*]}
Create no files. Touch nothing else. Add no package.json. No drive-by refactors.
Do not edit GEMINI.md.
Use only CSS classes that already exist in options.css. No inline styles.

You cannot run shell commands here, so do not try. Gates run afterwards.
When done, list the files you changed and stop.

PROMPT
  printf '\033[1;33m== Then: scripts/agent.sh gate\033[0m\n\n'
  exit 0
fi

# --------------------------------------------------------------------- gate
if [ "$MODE" = "gate" ]; then
  [ -f "$STATEFILE" ] || die "no run in progress. start with: scripts/agent.sh prep <issue> <file>..."
  ISSUE=$(sed -n 1p "$STATEFILE")
  BASE=$(sed -n 2p "$STATEFILE")
  read -r -a ALLOWED <<< "$(sed -n 3p "$STATEFILE")"
  SPEC=".agent-spec.md"
  BRANCH="agent/issue-$ISSUE"
  FAIL=""

  step "Gates (mine, not its)"
  CHANGED=$( { git diff --name-only; git ls-files --others --exclude-standard; } \
             | sed '/^$/d' | grep -vx "$SPEC" | sort -u )
  [ -n "$CHANGED" ] || die "nothing changed. was the agent cancelled or rate-limited?"
  printf '  touched:\n'; printf '    %s\n' $CHANGED

  STRAY=""
  for f in $CHANGED; do
    keep=""
    for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && keep=1; done
    [ -n "$keep" ] || STRAY="$STRAY $f"
  done
  [ -n "$STRAY" ] && FAIL="$FAIL
  - out of scope:$STRAY" || ok "scope respected"

  for f in $CHANGED; do
    case "$f" in
      *.js) node --check "$f" >/dev/null 2>&1 && ok "node --check $f" \
              || FAIL="$FAIL
  - syntax error in $f";;
    esac
  done

  DOM=$(python3 scripts/dom-contract.py 2>&1)
  printf '  dom-contract: %s\n' "$DOM"
  printf '%s' "$DOM" | grep -q "DOM contract OK" || FAIL="$FAIL
  - dom-contract.py did not print OK"

  grep -rn "innerHTML" "${ALLOWED[@]}" >/dev/null 2>&1 \
    && FAIL="$FAIL
  - innerHTML present" || ok "no innerHTML"

  grep -rn "console\.log" "${ALLOWED[@]}" >/dev/null 2>&1 \
    && FAIL="$FAIL
  - console.log present" || ok "no console.log"

  # every CSS class it added must already exist in options.css
  if [ -f options.css ]; then
    MISSING=""
    for c in $(git diff -U0 -- '*.js' '*.html' \
               | grep -oE "^\+.*(className|class)\s*=\s*['\"][^'\"]+" \
               | grep -oE "['\"][^'\"]+$" | tr -d "'\"" | tr ' ' '\n' | sort -u); do
      [ -z "$c" ] && continue
      grep -q "\.$c" options.css || MISSING="$MISSING $c"
    done
    [ -n "$MISSING" ] && FAIL="$FAIL
  - CSS classes not in options.css:$MISSING" || ok "all CSS classes exist"
  fi

  git diff -U0 | grep -qE '^\+.*style\.(cssText|[a-z]+ *=)' \
    && warn "inline styles added: check they match the design tokens" \
    || ok "no inline styles"

  if git diff | grep -qE '^\+.*storage\.(local|sync)\.set' \
     && ! git diff | grep -qE '^\+.*skipstream_'; then
    FAIL="$FAIL
  - writes storage without a skipstream_ key (new key?)"
  fi

  if [ -n "$FAIL" ]; then
    printf '\n\033[1;31mFAILED. reverting.\033[0m%s\n' "$FAIL"
    git checkout -- . 2>/dev/null; git clean -qfd 2>/dev/null
    git checkout -q "$BASE" 2>/dev/null && git branch -qD "$BRANCH" 2>/dev/null
    rm -f "$SPEC" "$STATEFILE"
    printf '\nRepo is back as you left it.\n'
    exit 1
  fi

  rm -f "$SPEC" "$STATEFILE"
  step "All gates green"
  git --no-pager diff --stat
  git diff > "$HOME/diff-$ISSUE.patch"
  cat <<EOF

Read it:  cloudshell edit ~/diff-$ISSUE.patch
Nothing is committed. Then:

  ship:  git -c commit.gpgsign=false commit -am "fix: close #$ISSUE" && git push -u origin $BRANCH && gh pr create --fill --base $BASE
  bin:   git checkout -- . && git checkout $BASE && git branch -D $BRANCH

EOF
  exit 0
fi

die "usage: scripts/agent.sh prep <issue> <file>...   |   scripts/agent.sh gate"
