#!/bin/bash
# Bounded self-heal for the Better Playa Guide. Called by guide-health-watch
# after 2 consecutive failing ticks (cooldown 2h, enforced by the watcher).
#
# Ladder:
#   1. Run the full test suite on the current tree.
#      - green  -> redeploy current tree (covers a wedged/stale deployment)
#      - red    -> hard-reset a THROWAWAY worktree to the last-green tag and
#                  deploy THAT (never touches the working tree), covering a
#                  bad change that slipped in while nobody was looking.
#   2. Anything beyond that (DNS, certs, Vercel outage, Supabase outage,
#      provider keys) is NOT self-fixable: the watcher alerts instead.
set -euo pipefail
SITE="$HOME/.myos/workspace/projects/muse-cafe/website"
cd "$SITE"

echo "== self-heal $(date -u +%FT%TZ) =="

if node test/run-all.js > /tmp/guide-heal-tests.log 2>&1; then
  echo "tests green on current tree: redeploying current tree"
  bash scripts/deploy.sh
else
  echo "tests RED on current tree: deploying last-green tag from a throwaway worktree"
  tail -20 /tmp/guide-heal-tests.log
  TAG=$(git tag -l 'guide-green-*' --sort=-creatordate | head -1)
  if [ -z "$TAG" ]; then echo "no last-green tag found; aborting"; exit 1; fi
  WT=$(mktemp -d /tmp/guide-green-XXXX)
  git worktree add --detach "$WT" "$TAG"
  trap 'git worktree remove --force "$WT" 2>/dev/null || true' EXIT
  cd "$WT"
  if node test/run-all.js > /tmp/guide-heal-green-tests.log 2>&1; then
    bash scripts/deploy.sh
    echo "deployed $TAG"
  else
    echo "even $TAG is red locally; refusing to deploy blind"; exit 1
  fi
fi
echo "== self-heal done =="
