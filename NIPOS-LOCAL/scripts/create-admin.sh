#!/usr/bin/env bash
# Creates a Global Admin login (every permission, every venue). Use it once for the first account;
# after that, add staff from Backend > Staff. On a brand-new server it also creates the first venue
# (Backend needs at least one venue before it shows its menus), named "Main Bar" unless you give a name.
#   scripts/create-admin.sh <PIN, 6+ digits> ["Name"] ["First venue name"]
set -euo pipefail
source "$(dirname "$0")/common.sh"

PIN="${1:-}"; NAME="${2:-Administrator}"; VENUE="${3:-Main Bar}"
[[ "$PIN" =~ ^[0-9]{6,}$ ]] || die "Usage: scripts/create-admin.sh <PIN, 6+ digits> [\"Name\"]"
load_stack_env

# Same login scheme the manage-staff function uses: the PIN is both the password and part of the email.
USER_JSON="$(api POST /auth/v1/admin/users -d "{\"email\":\"pin$PIN@nipos.local\",\"password\":\"$PIN\",\"email_confirm\":true}")" \
  || die "Couldn't create the login - is that PIN already in use?"
USER_ID="$(printf '%s' "$USER_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

ROW="$(python3 - "$USER_ID" "$NAME" "$PIN" <<'EOF'
import json, sys, time
uid, name, pin = sys.argv[1:4]
perms = {k: True for k in ["globalAdmin", "active", "placeOrders", "productsOnStop", "recoveryTool",
         "callToService", "clearHistory", "xzRead", "endOfDay", "backendAccess", "orderScreen",
         "viewOpenOrders", "processRefunds"]}
print(json.dumps({"id": uid, "ts": int(time.time() * 1000), "data": {
    "name": name, "pin": pin, "perms": perms, "venueIds": [], "groupIds": [], "notifyVenueIds": []}}))
EOF
)"
if ! api POST /rest/v1/staff_users -H "Prefer: return=minimal" -d "$ROW"; then
  api DELETE "/auth/v1/admin/users/$USER_ID" >/dev/null || true
  die "Couldn't create the staff record (login rolled back)."
fi

echo "Created Global Admin \"$NAME\""

# The first venue, only if there are none yet. Rename it, or add more, in Backend > Venues.
if [ "$(api GET "/rest/v1/venues?select=id&limit=1")" = "[]" ]; then
  VENUE_ROW="$(python3 - "$VENUE" <<'EOF'
import json, sys, time
now = int(time.time() * 1000)
print(json.dumps({"id": f"venue_{now}", "ts": now, "data": {"name": sys.argv[1], "active": True, "accent": None,
    "foodEnabled": True, "discordWebhooks": {"order": None, "zread": None, "stop": None}}}))
EOF
)"
  api POST /rest/v1/venues -H "Prefer: return=minimal" -d "$VENUE_ROW" || die "Couldn't create the first venue."
  echo "Created the first venue \"$VENUE\" (rename it or add more in Backend > Venues)"
fi
echo "Sign in at http://localhost:$WEB_PORT/app.html (or /backend.html) with PIN $PIN"
