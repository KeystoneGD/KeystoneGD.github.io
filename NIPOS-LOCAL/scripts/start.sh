#!/usr/bin/env bash
# Starts everything: the local Supabase stack (database, auth, API, storage, Edge Functions) and the
# web server for the NIPOS pages. Run this each time the Chromebook / Linux environment restarts.
# Safe to run when things are already up.
set -euo pipefail
source "$(dirname "$0")/common.sh"

command -v supabase >/dev/null || die "Supabase CLI not installed - run scripts/setup.sh first."
docker info >/dev/null 2>&1 || sudo service docker start >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || die "Docker isn't running (or you need to reopen the Terminal after setup)."

echo "==> Starting Supabase"
supabase start >/dev/null || supabase start
load_stack_env

# This server's push keys: the private half goes in app_secrets for the send-push function, the
# public half into config.js for the pages.
VAPID_PUBLIC=""
if [ -f "$STATE_DIR/vapid.json" ]; then
  read -r VAPID_PUBLIC VAPID_PRIVATE < <(python3 -c 'import json,sys; k=json.load(open(sys.argv[1])); print(k["publicKey"], k["privateKey"])' "$STATE_DIR/vapid.json")
  api POST "/rest/v1/app_secrets?on_conflict=key" -H "Prefer: resolution=merge-duplicates,return=minimal" \
    -d "[{\"key\":\"vapid_public_key\",\"value\":\"$VAPID_PUBLIC\"},{\"key\":\"vapid_private_key\",\"value\":\"$VAPID_PRIVATE\"},{\"key\":\"vapid_subject\",\"value\":\"mailto:admin@nipos.local\"}]" \
    || echo "WARNING: couldn't store push keys (push notifications won't work)"
fi

cat > "$ROOT/web/config.js" <<EOF
// Written by scripts/start.sh - do not edit or commit. Keys for this server's local Supabase stack.
window.NIPOS_CONFIG = {
  apiPort: $API_PORT,
  anonKey: "$ANON_KEY",
  vapidPublicKey: "$VAPID_PUBLIC"
};
EOF

PIDFILE="$STATE_DIR/web.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "==> Web server already running"
else
  echo "==> Starting web server on port $WEB_PORT"
  nohup python3 -m http.server "$WEB_PORT" --bind 0.0.0.0 --directory "$ROOT/web" > "$STATE_DIR/web.log" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 1
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || die "Web server failed to start - see $STATE_DIR/web.log"
fi

cat <<EOF

NIPOS is running.
  On this Chromebook:  http://localhost:$WEB_PORT/          (till)
                       http://localhost:$WEB_PORT/orders.html
                       http://localhost:$WEB_PORT/backend.html
  Database admin:      http://localhost:54323               (Supabase Studio)
  Other devices:       http://<Chromebook Wi-Fi IP>:$WEB_PORT/  - needs ports $WEB_PORT and $API_PORT
                       forwarded, see "Connecting the tills" in README.md
EOF
