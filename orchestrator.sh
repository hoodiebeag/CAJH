#!/usr/bin/env bash
# orchestrator.sh — the ONLY thing that wakes the agent unprompted. Meant to
# be installed in cron by the operator; this script does not install itself
# (see the crontab line in the comment at the bottom - nothing here runs
# `crontab -e` for you).
#
# Deliberately does NOT give the invoked agent access to trigger_deploy.
# It can read live state, propose deployments, run backtests, and leave
# research notes - a human must be present in a real session to ever approve
# and execute a deploy. This is the boundary the whole design leans on; see
# the threat-model note in mcp-server/src/index.ts's header comment.
#
# [NEEDS CONFIRMATION FROM OPERATOR]: replace `claude -p` below with whatever
# CLI actually invokes an agent turn non-interactively in this environment -
# this repo already has a proven pattern for this (the mcp__scheduled-tasks
# checks used elsewhere in this project), so prefer wiring THIS into that
# same scheduled-tasks mechanism instead of a raw cron+claude-CLI call if at
# all possible; a bare cron job has none of that mechanism's state-corruption
# recovery or notification-dedup behavior already built for this repo.

set -euo pipefail
cd "$(dirname "$0")"

LOCK_FILE="mcp-server/.orchestrator.lock"
LOG_FILE="mcp-server/orchestrator.log"

log() { echo "[orchestrator $(date -u +%FT%TZ)] $*" | tee -a "$LOG_FILE"; }

# ── Signal-based re-invocation guard ────────────────────────────────────────
# A lock file, not a PID check alone: if the orchestrator process itself dies
# uncleanly the lock can go stale, so it's treated as expired after
# MAX_RUN_SECONDS rather than trusted forever. This is the concrete answer to
# "how does the orchestrator not re-invoke mid-run" - a stale lock is a bug to
# notice (logged loudly), not a reason to silently skip forever.
MAX_RUN_SECONDS=900

if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || stat -f %m "$LOCK_FILE") ))
  if [ "$lock_age" -lt "$MAX_RUN_SECONDS" ]; then
    log "skip: prior run still active (lock age ${lock_age}s < ${MAX_RUN_SECONDS}s)"
    exit 0
  fi
  log "WARNING: stale lock (age ${lock_age}s) - prior run may have crashed without cleaning up. Proceeding anyway."
fi

echo "$$" > "$LOCK_FILE"
cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT

# ── Build the wake prompt ────────────────────────────────────────────────────
# TODO(dev): scripts/print-live-state.mjs and scripts/print-decision-journal.mjs
# are the same shims mcp-server/src/index.ts's get_live_state and
# get_decision_journal tools depend on (see TODOs there) - write them once,
# use them in both places, so the orchestrator's prompt and the agent's own
# get_live_state tool call never disagree about the current snapshot.
LIVE_STATE=$(node scripts/print-live-state.mjs 2>&1 || echo "ERROR reading live state")
RECENT_JOURNAL=$(node scripts/print-decision-journal.mjs --limit 20 2>&1 || echo "ERROR reading decision journal")
ROADMAP_TAIL=$(tail -n 60 ROADMAP.md 2>/dev/null || echo "ROADMAP.md not found")

PROMPT=$(cat <<EOF
You are being woken by orchestrator.sh, not a human. This run has no memory of
prior runs. Read mcp-server tools available to you (read_file, list_directory,
run_backtest, get_decision_journal, propose_deployment, get_live_state,
append_research_note) - trigger_deploy and write_file to a protected path are
NOT available to you in this invocation; do not attempt them.

=== Live state snapshot ===
${LIVE_STATE}

=== Last 20 decision journal entries ===
${RECENT_JOURNAL}

=== ROADMAP.md tail (most recent verdicts) ===
${ROADMAP_TAIL}

Decide what, if anything, needs doing this cycle within your available tools.
If nothing does, say so plainly and stop - do not manufacture work. If you
believe a deployment is warranted, use propose_deployment and explain why a
human should review it; you cannot deploy it yourself this run.
EOF
)

log "invoking agent (prompt ${#PROMPT} chars)"

# [NEEDS CONFIRMATION FROM OPERATOR]: exact non-interactive invocation syntax
# for this environment's CLI, and how it should be told to load THIS repo's
# .vscode/mcp.json / mcp-server rather than any other MCP config on the box.
if claude -p "$PROMPT" --mcp-config .vscode/mcp.json >> "$LOG_FILE" 2>&1; then
  log "agent run completed"
else
  log "agent run FAILED (exit $?) - see log above"
fi

# ── Install this in cron yourself, e.g. every 15 minutes: ──────────────────
#   */15 * * * * /path/to/cajh/orchestrator.sh
# This script does not modify your crontab.
