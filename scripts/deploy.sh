#!/bin/bash
# Better Playa Guide deploy gate. THE documented way to ship this site.
#
#   ./scripts/deploy.sh
#
# 1. Runs the full website test suite (client + api contract + retrieval).
# 2. REFUSES to deploy on any failure.
# 3. On green, bumps the service worker cache version (bpg-vNN -> bpg-vNN+1)
#    so every phone that already installed the guide picks up the new build.
# 4. Deploys with: vercel --prod --yes
#
# Bypassing this script is for emergencies only. If you must, you own the
# cache-version bump and the untested deploy yourself.
set -euo pipefail
ENV_FILE="$HOME/.myos/workspace/.env"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "== Better Playa Guide deploy gate =="

# 0. Dependencies for the test rig (jsdom).
if [ ! -d node_modules/jsdom ]; then
  echo "-- installing test dependencies"
  npm install --no-audit --no-fund
fi

# 1. Full test suite. Any failure stops the deploy right here.
echo "-- running full test suite"
if ! npm test; then
  echo ""
  echo "DEPLOY REFUSED: tests failed. Fix the failures above, then rerun ./scripts/deploy.sh"
  echo "(Emergency bypass: run vercel --prod yourself, but you ship untested.)"
  exit 1
fi

# 1b. Live rate-limit RPC smoke check: never ship fail-closed code against a
#     database function that is missing or broken. Creds come from the shell
#     or fall back to the workspace .env, same as VERCEL_TOKEN below.
if [ -z "${SUPABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  SUPABASE_URL=$(grep -E '^SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  export SUPABASE_URL
fi
if [ -z "${SUPABASE_SECRET_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  SUPABASE_SECRET_KEY=$(grep -E '^SUPABASE_SECRET_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  export SUPABASE_SECRET_KEY
fi
echo "-- rate-limit RPC smoke check"
if ! node scripts/smoke-rate-limit.js; then
  echo "DEPLOY REFUSED: rate-limit RPC smoke failed (apply db/rate-limit.sql, check Supabase keys)"
  exit 1
fi

# 1c. Stamp the data-freshness marker the client shows as "synced X ago".
echo "{\"built\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$REPO_ROOT/guide/version.json"

# 2. Bump the service worker cache version so installed clients refresh.
SW="$REPO_ROOT/guide/sw.js"
CUR=$(grep -oE "bpg-v[0-9]+" "$SW" | head -1 | grep -oE "[0-9]+")
if [ -z "$CUR" ]; then
  echo "DEPLOY REFUSED: could not read the bpg-vNN cache version from guide/sw.js"
  exit 1
fi
NEXT=$((CUR + 1))
sed -i '' "s/bpg-v${CUR}/bpg-v${NEXT}/" "$SW"
echo "-- service worker cache bumped: bpg-v${CUR} -> bpg-v${NEXT}"

# 3. Vercel token from the workspace .env (never hardcoded here).
if [ -z "${VERCEL_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  VERCEL_TOKEN=$(grep -E '^VERCEL_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)
fi
if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "DEPLOY REFUSED: VERCEL_TOKEN not set and not found in $ENV_FILE"
  echo "(guide/sw.js was already bumped to bpg-v${NEXT}; revert it or deploy manually.)"
  exit 1
fi

# 4. Ship it.
echo "-- deploying to production"
vercel --prod --yes --token "$VERCEL_TOKEN" 2>&1 | sed "s/${VERCEL_TOKEN}/[token]/g"

echo ""
echo "Deployed. sw cache is bpg-v${NEXT}. Commit the sw.js bump:"
echo "  git add guide/sw.js && git commit -m 'chore: bump sw cache to bpg-v${NEXT} (deploy)'"

# 5. Mark this tree as the last known-green deploy (self-heal rollback target).
git tag -f "guide-green-$(date -u +%Y%m%d-%H%M%S)" >/dev/null 2>&1 || true
# keep only the 10 newest green tags
git tag -l 'guide-green-*' --sort=-creatordate | tail -n +11 | xargs -I{} git tag -d {} >/dev/null 2>&1 || true
