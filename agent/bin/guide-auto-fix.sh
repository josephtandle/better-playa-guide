#!/bin/bash
# Autonomous code-fix lane for the Better Playa Guide (Joe authorized
# 2026-08-27: "I DO want you to do code fixes autonomously. just have many
# tests and review loops before deploy").
#
# Called by guide-health-watch with an error-context file. Runs a headless
# fixer in an ISOLATED worktree, then a hard gate ladder. Nothing deploys
# unless every gate passes. Bounds live in the watcher (3 fixes/day,
# 2 attempts per error signature, cooldowns).
#
# GATES (script-enforced, not trust-based):
#   G1  diff touches only guide/ api/ test/; deploy.sh and existing tests untouched
#   G2  diff <= 250 changed lines
#   G3  at least one NEW test added (regression proof)
#   G4  full test suite green in the worktree
#   G5  independent clean-context reviewer prints VERDICT: APPROVE
#   G6  deploy.sh itself re-runs the suite before shipping (existing gate)
set -euo pipefail
CTX_FILE="${1:?usage: guide-auto-fix.sh <error-context.json>}"
SITE="$HOME/.myos/workspace/projects/muse-cafe/website"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
cd "$SITE"

WT=$(mktemp -d /tmp/guide-autofix-XXXX)
git worktree add --detach "$WT" HEAD >/dev/null
trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT
cp "$CTX_FILE" "$WT/.error-context.json"

echo "== fixer =="
(cd "$WT" && "$CLAUDE_BIN" -p --dangerously-skip-permissions --max-turns 40 "You are fixing a live production bug in the Better Playa Guide (this repo). The file .error-context.json holds real client-side JS errors from users' phones at Burning Man, plus any failing health checks.

Rules, non-negotiable:
- Make the SMALLEST fix that addresses the error. No refactors, no drive-by changes.
- You MUST add at least one new regression test that fails before your fix and passes after (a new test file under test/, or appended cases in a NEW file: do NOT edit existing test files, do NOT touch scripts/deploy.sh, do NOT touch anything outside guide/, api/, test/).
- Run 'node test/run-all.js' and make it fully green before you finish.
- If the error is not actually fixable from this repo (a platform issue, a browser quirk with no code answer), change nothing and write your reasoning to .autofix-verdict.txt as SKIP: <reason>." ) || true

cd "$WT"
if [ -f .autofix-verdict.txt ] && grep -q '^SKIP' .autofix-verdict.txt; then
  echo "fixer skipped: $(cat .autofix-verdict.txt)"; exit 3
fi

CHANGED=$(git diff --name-only)
if [ -z "$CHANGED" ]; then echo "no changes made"; exit 3; fi

echo "== G1: allowed paths only, protected files untouched =="
echo "$CHANGED" | grep -vE '^(guide/|api/|test/)' && { echo "G1 FAIL: out-of-scope file"; exit 1; } || true
git diff --name-only scripts/ | grep . && { echo "G1 FAIL: deploy scripts touched"; exit 1; } || true
# existing test files must be untouched (new test files are fine)
for f in $(git diff --name-only test/); do
  git ls-tree -r HEAD --name-only | grep -qx "$f" && { echo "G1 FAIL: existing test modified: $f"; exit 1; }
done

echo "== G2: diff size =="
LINES=$(git diff --numstat | awk '{a+=$1+$2} END{print a+0}')
[ "$LINES" -le 250 ] || { echo "G2 FAIL: $LINES changed lines"; exit 1; }

echo "== G3: a new test exists =="
git status --porcelain test/ | grep -q '^??\|^A ' || { echo "G3 FAIL: no new test added"; exit 1; }

echo "== G4: full suite green =="
node test/run-all.js || { echo "G4 FAIL"; exit 1; }

echo "== G5: independent review =="
git add -A
DIFF=$(git diff --cached | head -c 60000)
REVIEW=$("$CLAUDE_BIN" -p --max-turns 3 "You are a strict, independent code reviewer. A different agent wrote this fix for a production bug in an offline-first Burning Man guide used by people with no signal. Error context: $(head -c 3000 .error-context.json). Diff:

$DIFF

Reject unless ALL hold: the fix plausibly addresses the error; it is minimal; it cannot break offline behavior, stars/merge, or the service worker; the new test actually pins the bug. Answer with exactly one line: 'VERDICT: APPROVE' or 'VERDICT: REJECT - <reason>'.") || true
echo "$REVIEW" | tail -3
echo "$REVIEW" | grep -q 'VERDICT: APPROVE' || { echo "G5 FAIL: reviewer rejected"; exit 1; }

echo "== commit + deploy (deploy.sh re-runs the suite = G6) =="
git commit -m "autofix: $(head -c 100 .error-context.json | tr '\n' ' ')

Autonomous fix: gates G1-G5 passed (scope, size, new regression test,
full suite green, independent reviewer approved)." >/dev/null
bash scripts/deploy.sh
# push the fix back to main so the working tree and remotes converge
BRANCH=autofix-$(date +%s)
git push "$SITE" HEAD:refs/heads/$BRANCH 2>/dev/null || true
cd "$SITE" && git merge --ff-only $BRANCH 2>/dev/null && git branch -d $BRANCH && git push 2>/dev/null || echo "NOTE: fix deployed; branch $BRANCH left for manual merge"
echo "AUTOFIX DEPLOYED"
