#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash(git commit*)). Denies a commit unless every package with staged
# changes has a green unit-test run right now — "don't commit without green tests" as a
# deterministic gate, not a probabilistic eval. Wire it in .claude/settings.json.
#
# Decision model (exit 2 = deny, stderr shown to the agent; exit 0 = allow):
#   - command isn't a git commit ................. allow
#   - SKIP_TEST_GATE set .......................... allow (logged)
#   - no staged files touch server/client/reviewer-core ... allow (nothing to test)
#   - a package's unit suite fails ................ deny
#   - infra error (missing pnpm, can't diff) ...... allow (fail-open: never brick the workflow
#                                                    on our own tooling breaking, only on a real
#                                                    red-test signal)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

if [ -n "${SKIP_TEST_GATE:-}" ]; then
  echo "test-gate: overridden — reason: ${SKIP_TEST_GATE}" >&2
  exit 0
fi

cd "$ROOT" || exit 0
changed="$(git diff --cached --name-only 2>/dev/null || echo "ERR")"
[ "$changed" = "ERR" ] && exit 0   # can't compute → fail-open (infra error, not a red test)

want_server=false
want_client=false
want_reviewer_core=false
while IFS= read -r f; do
  case "$f" in
    server/*) want_server=true ;;
    client/*) want_client=true ;;
    reviewer-core/*) want_reviewer_core=true ;;
  esac
done <<< "$changed"

if ! $want_server && ! $want_client && ! $want_reviewer_core; then
  exit 0   # no staged change touches a testable package
fi

command -v pnpm >/dev/null 2>&1 || exit 0   # pnpm missing → infra error, fail-open

failed=""

if $want_server; then
  if ! (cd "$ROOT/server" && pnpm exec vitest run --exclude '**/*.it.test.ts') >/tmp/test-gate-server.log 2>&1; then
    failed="${failed}server "
  fi
fi

if $want_client; then
  if ! (cd "$ROOT/client" && pnpm test) >/tmp/test-gate-client.log 2>&1; then
    failed="${failed}client "
  fi
fi

if $want_reviewer_core; then
  if ! (cd "$ROOT/reviewer-core" && pnpm test) >/tmp/test-gate-reviewer-core.log 2>&1; then
    failed="${failed}reviewer-core "
  fi
fi

if [ -n "$failed" ]; then
  echo "⛔ test-gate: unit tests are red in: ${failed}— commit blocked." >&2
  echo "   Fix the failing test(s) (see /tmp/test-gate-<package>.log) and try again," >&2
  echo "   or set SKIP_TEST_GATE=\"reason\" for a genuine exception." >&2
  exit 2
fi

exit 0
