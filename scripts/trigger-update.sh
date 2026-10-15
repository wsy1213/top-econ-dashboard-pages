#!/bin/bash
set -euo pipefail

LOG="/tmp/top-econ-dashboard-update.log"
REPO="wsy1213/top-econ-dashboard-pages"
WORKFLOW="deploy-pages.yml"
MAX_ATTEMPTS=3
RETRY_DELAY_SECONDS=300

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

wait_for_github() {
  for attempt in 1 2 3 4 5 6; do
    if /usr/bin/curl --fail --silent --show-error --connect-timeout 15 --max-time 30 https://github.com/ >/dev/null; then
      return 0
    fi
    log "GitHub network check ${attempt}/6 failed; retrying in 60 seconds."
    sleep 60
  done
  return 1
}

trigger_and_wait() {
  /opt/homebrew/bin/gh workflow run "$WORKFLOW" \
    --repo "$REPO" \
    --ref main \
    -f scan_scholars=true \
    >> "$LOG" 2>&1
  sleep 5
  local run_id
  run_id=$(/opt/homebrew/bin/gh run list \
    --repo "$REPO" \
    --workflow "$WORKFLOW" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId')
  if [[ -z "$run_id" || "$run_id" == "null" ]]; then
    log "Could not identify the workflow run after triggering it."
    return 1
  fi
  log "Waiting for workflow run ${run_id}."
  /opt/homebrew/bin/gh run watch "$run_id" --repo "$REPO" --exit-status >> "$LOG" 2>&1
}

cd /Users/wushiyue/Desktop/agent/顶刊阅读/_ghpages_copy

# The full retry window can outlast a transient network outage or runner checkout failure.
/usr/bin/caffeinate -i -t 3600 &

for attempt in 1 2 3; do
  log "Starting Monday update attempt ${attempt}/${MAX_ATTEMPTS}."
  if wait_for_github && trigger_and_wait; then
    log "Monday update completed successfully."
    exit 0
  fi
  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    log "Monday update attempt ${attempt} failed; retrying in ${RETRY_DELAY_SECONDS} seconds."
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

log "All ${MAX_ATTEMPTS} Monday update attempts failed."
exit 1
