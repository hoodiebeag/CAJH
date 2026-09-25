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
#   bash scripts/refresh.sh commit          # commit and push whatever is already on disk
set -euo pipefail

STAGE="${1:-all}"
UNIVERSE="${UNIVERSE:-universe/candidates.txt}"

say() { printf '\n=== %s ===\n' "$1"; }

# A MISTYPED STAGE MUST NOT LOOK LIKE A SUCCESSFUL RUN. Every stage below is opt-in, so
# `refresh.sh collectt` would skip the collection, skip the panel, find nothing to commit and
# exit 0 -- the same output as a run with nothing to do. This script exists because work gets
# done and silently not pushed; a silent no-op is the failure it is guarding against.
case "$STAGE" in
  all|collect|panel|commit) ;;
  *) echo "refresh.sh: unknown stage '$STAGE' (expected: all, collect, panel, commit)" >&2; exit 2 ;;
esac

if [ "$STAGE" != "commit" ]; then
  say "pulling latest"
  git pull --ff-only

  if [ ! -f node_modules/@stoqey/ib/package.json ]; then
    say "installing @stoqey/ib (the only dependency these scripts need)"
    npm install @stoqey/ib
  fi
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

# STAGE THE PATHS ONE AT A TIME, AND ONLY THE ONES THAT EXIST.
#
# This was `git add -f data/ ibkr-bundle/ 2>/dev/null || true`, and it staged NOTHING whenever
# ibkr-bundle/ was absent: git aborts the whole `add` on an unmatched pathspec rather than adding
# the paths that did match, the error went to /dev/null, and `|| true` swallowed the exit code.
# The run then reported "nothing changed -- already up to date" and exited 0.
#
# So `refresh.sh collect` -- the three-minute stage, the one most likely to be run first, and the
# one that runs BEFORE ibkr-bundle/ can possibly exist -- did the collection and pushed none of it,
# while printing success. That is the exact failure this script was written to prevent.
# The paper journal rides along, because this is the only push path that is tested and the record
# is worthless on a machine nobody else can reach. `-e` rather than `-d`: it is a file, not a tree.
for path in data ibkr-bundle analyst-journal.jsonl; do
  if [ -e "$path" ]; then git add -f "$path"; fi
done

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
