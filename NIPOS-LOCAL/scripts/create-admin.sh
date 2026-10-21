#!/usr/bin/env bash
# Creates a Global Admin login (every permission, every venue). Use it once for the first account;
# after that, add staff from Backend > Staff.
#   scripts/create-admin.sh <PIN, 6+ digits> ["Name"]
set -euo pipefail
source "$(dirname "$0")/common.sh"

PIN="${1:-}"; NAME="${2:-Administrator}"
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

echo "Created Global Admin \"$NAME\" - sign in at http://localhost:$WEB_PORT/backend.html with PIN $PIN"
