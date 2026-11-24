#!/usr/bin/env bash
# Stop the exported-snapshot keeper without allowing cleanup to hang forever.
stop_snapshot_keeper() {
  local pid="${1:-}"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0

  kill -TERM "$pid" 2>/dev/null || true
  for ((attempt=0; attempt<20; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      return 0
    fi
    sleep 0.1
  done

  # psql can remain blocked while the server-side exported snapshot sleeps.
  # Force-close the client connection after the bounded grace period.
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
