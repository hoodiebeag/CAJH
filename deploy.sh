#!/usr/bin/env bash
# deploy.sh — called only by mcp-server's trigger_deploy tool, never directly
# by a human in normal operation (though it's safe to run by hand for a manual
# deploy - it takes the same argument either way).
#
# Target: Railway, not a generic Linux VPS. Confirmed from README.md - cajh's
# filesystem is wiped on every deploy except the DATA_DIR volume mount, and
# there is no Dockerfile/ecosystem.config.js in this repo, so deploys go
# through Railway's own build (Nixpacks, auto-detected from package.json).
#
# [NEEDS CONFIRMATION FROM OPERATOR]: this assumes the Railway CLI is
# installed and `railway login` / project linking has already been done in
# this environment (railway whoami / railway status should succeed before
# this script is ever wired to trigger_deploy). It also assumes a service
# name/environment already exists - fill in RAILWAY_SERVICE below.
#
# Health check is a LOG POLL, not an HTTP endpoint: confirmed by reading
# bot.js that it runs no http/express listener at all (it's a Discord bot
# only) — there is no URL to curl. bot.js:140 logs `[BOT] Logged in as
# ${client.user.tag}` on the discord.js "clientReady" event; that line
# appearing in fresh Railway logs after this deploy is the success signal.
# If an HTTP health endpoint gets added to bot.js later, prefer it over this
# log-scrape (less brittle to log-format changes) and update this script.
#
# Usage: ./deploy.sh <rollback-snapshot-path>
# Exit code 0 = deploy succeeded and the post-deploy ready log line appeared.
# Exit code 1 = deploy or health check failed; rollback was attempted.

set -euo pipefail

SNAPSHOT_PATH="${1:?usage: deploy.sh <rollback-snapshot-path>}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:?set RAILWAY_SERVICE to the Railway service name}" # [NEEDS CONFIRMATION FROM OPERATOR]
READY_MARKER="Logged in as"
DEPLOY_LOG="mcp-server/deploy.log"
MAX_HEALTH_WAIT_SECONDS=120
DEPLOY_START_EPOCH=$(date +%s)

log() { echo "[deploy $(date -u +%FT%TZ)] $*" | tee -a "$DEPLOY_LOG"; }

rollback() {
  log "ROLLBACK: restoring files from $SNAPSHOT_PATH"
  node --input-type=module -e "
    import fs from 'node:fs';
    const snap = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    for (const [rel, content] of Object.entries(snap.files)) {
      if (content === '') { try { fs.unlinkSync(rel); } catch {} }
      else fs.writeFileSync(rel, content, 'utf8');
    }
    console.log('restored', Object.keys(snap.files).length, 'file(s) from', snap.snapshotId);
  " "$SNAPSHOT_PATH"

  log "ROLLBACK: committing restored state"
  git add -A -- $(node -e "
    const s=require('fs').readFileSync(process.argv[1],'utf8');
    console.log(Object.keys(JSON.parse(s).files).join(' '));
  " "$SNAPSHOT_PATH")
  git commit -m "rollback: automatic revert after failed deploy ($SNAPSHOT_PATH)" || log "nothing to commit for rollback (files matched already)"
  git push

  log "ROLLBACK: re-deploying known-good state via Railway"
  railway up --service "$RAILWAY_SERVICE" --detach

  log "ROLLBACK: complete. Manually verify $HEALTH_URL before trusting the system again."
}

log "starting deploy, snapshot=$SNAPSHOT_PATH service=$RAILWAY_SERVICE"

# Push first — Railway's git integration (if connected) will also pick this
# up, but `railway up` deploys the CURRENT LOCAL working tree directly, which
# is what we want here since trigger_deploy already wrote the approved files
# to disk before calling this script.
if ! railway up --service "$RAILWAY_SERVICE" --detach 2>&1 | tee -a "$DEPLOY_LOG"; then
  log "railway up failed — no health check to run, nothing was deployed successfully"
  rollback
  exit 1
fi

log "deploy submitted, polling Railway logs for '$READY_MARKER' for up to ${MAX_HEALTH_WAIT_SECONDS}s"
elapsed=0
healthy=false
while [ "$elapsed" -lt "$MAX_HEALTH_WAIT_SECONDS" ]; do
  # --since filters to lines after deploy start so a ready-line from the
  # PREVIOUS process (before this deploy) can't be mistaken for success.
  # [NEEDS CONFIRMATION FROM OPERATOR]: confirm `railway logs` flag names
  # against the installed CLI version (`railway logs --help`) - this exact
  # flag set is not verified against a running Railway CLI in this session.
  if railway logs --service "$RAILWAY_SERVICE" --since "${DEPLOY_START_EPOCH}s" 2>/dev/null | grep -qF "$READY_MARKER"; then
    healthy=true
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

if [ "$healthy" != "true" ]; then
  log "ready marker not seen after ${elapsed}s — rolling back"
  rollback
  exit 1
fi

log "deploy succeeded, ready marker seen after ${elapsed}s"
exit 0
