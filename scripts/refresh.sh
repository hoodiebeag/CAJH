#!/usr/bin/env bash
# refresh.sh — one command: pull, collect, pull the panel, commit, push.
#
# WHY THIS EXISTS. The collection has now been run twice on the owner's machine and reached this
# repository zero times: once the wrong file was sent, once it ran and was never pushed. The work
# was done both times; the last step is the one that gets dropped, and it is the only step that
# makes the data usable from anywhere else. So the push is part of the command rather than a
# sentence in a README.
#
# It is safe to re-run. The panel pull uses --skip-fresh, so an interrupted run continues instead
# of starting over, and a same-day re-run is nearly free.
#
# Usage:
#   bash scripts/refresh.sh                 # everything (the panel takes hours the first time)
#   bash scripts/refresh.sh collect         # entitlements, sectors, news only (~3 min)
#   bash scripts/refresh.sh panel           # the price panel only
set -euo pipefail

STAGE="${1:-all}"
UNIVERSE="${UNIVERSE:-universe/candidates.txt}"

say() { printf '\n=== %s ===\n' "$1"; }

say "pulling latest"
git pull --ff-only

if [ ! -f node_modules/@stoqey/ib/package.json ]; then
  say "installing @stoqey/ib (the only dependency these scripts need)"
  npm install @stoqey/ib
fi

if [ "$STAGE" = "all" ] || [ "$STAGE" = "collect" ]; then
  say "collecting entitlements, sectors and news"
  node scripts/ibkr-collect.mjs
fi

if [ "$STAGE" = "all" ] || [ "$STAGE" = "panel" ]; then
  say "pulling the price panel from $UNIVERSE"
  echo "This is the slow part — IBKR paces historical data hard. If it stalls or you stop it,"
  echo "re-run this script and it picks up where it left off."
  node scripts/ibkr-panel.mjs --symbols "$UNIVERSE" --skip-fresh
fi

say "committing and pushing"
git add -f data/ ibkr-bundle/ 2>/dev/null || true
if git diff --cached --quiet; then
  echo "nothing changed — already up to date, nothing to push."
  exit 0
fi
git commit -m "data refresh $(date -u +%Y-%m-%dT%H:%MZ)"
for attempt in 1 2 3 4; do
  if git push -u origin "$(git rev-parse --abbrev-ref HEAD)"; then
    say "pushed. The agent can see it now."
    exit 0
  fi
  wait=$((2 ** attempt))
  echo "push failed, retrying in ${wait}s ..."
  sleep "$wait"
done
echo "PUSH FAILED after 4 attempts. The data is committed locally and is not lost;" >&2
echo "run 'git push' again when the network is back." >&2
exit 1
