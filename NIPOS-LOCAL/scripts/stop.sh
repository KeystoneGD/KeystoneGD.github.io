#!/usr/bin/env bash
# Stops the web server and the Supabase stack. All data is kept (it lives in Docker volumes) and is
# back the next time you run scripts/start.sh.
set -euo pipefail
source "$(dirname "$0")/common.sh"

PIDFILE="$STATE_DIR/web.pid"
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
supabase stop
