#!/usr/bin/env bash
# Loads the starter menu (web/products.json: cocktails, draught, spirits, wine, food...) into a venue
# that has no menu yet, so there's something to sell straight away. Prices and items can then be
# changed in Backend > Products and stops. Does nothing to a venue that already has a menu.
#   scripts/load-starter-menu.sh            (the first venue)
#   scripts/load-starter-menu.sh "Venue name"
set -euo pipefail
source "$(dirname "$0")/common.sh"
load_stack_env

VENUES="$(api GET "/rest/v1/venues?select=id,data&order=ts.asc")"
VENUE_ID="$(python3 - "${1:-}" "$VENUES" <<'EOF'
import json, sys
want, venues = sys.argv[1], json.loads(sys.argv[2])
match = [v for v in venues if not want or v["data"].get("name", "").lower() == want.lower()]
print(match[0]["id"] if match else "")
EOF
)"
[ -n "$VENUE_ID" ] || die "No venue found${1:+ called \"$1\"}. Create one first (scripts/create-admin.sh makes the first)."
[ "$(api GET "/rest/v1/categories?select=id&venue_id=eq.$VENUE_ID&limit=1")" = "[]" ] \
  || die "That venue already has a menu, so nothing was changed."

ROWS="$(python3 - "$VENUE_ID" "$ROOT/web/products.json" <<'EOF'
import json, sys, time
venue, path = sys.argv[1], sys.argv[2]
now = int(time.time() * 1000)
cats, items = [], []
for ci, c in enumerate(json.load(open(path))["categories"]):
    cid = f"cat{now}_{ci}"
    cats.append({"id": cid, "ts": now - ci, "venue_id": venue, "data": {
        "id": cid, "ts": now - ci, "name": c["name"], "note": c.get("note"), "mode": c.get("mode", "drink"), "order": ci,
        "isSpirit": bool(c.get("isSpirit")), "isBeer": bool(c.get("isBeer")),
        "mixerType": "both" if c.get("isSpirit") else None, "isCocktailHappyHour": c["name"].startswith("Cocktails")}})
    for ii, it in enumerate(c["items"]):
        iid = f"p{now}_{ci}_{ii}"
        data = {"id": iid, "ts": now, "categoryId": cid, "name": it["name"], "order": ii, "pence": it.get("pence", 0)}
        if it.get("sizes"):
            data["sizes"] = it["sizes"]
            data["pence"] = it["sizes"][0].get("pence", 0)
        items.append({"id": iid, "ts": now, "venue_id": venue, "data": data})
print(json.dumps({"cats": cats, "items": items}))
EOF
)"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); open(sys.argv[2],"w").write(json.dumps(d["cats"])); open(sys.argv[3],"w").write(json.dumps(d["items"]))' \
  "$ROWS" "$STATE_DIR/menu-cats.json" "$STATE_DIR/menu-items.json"
api POST /rest/v1/categories -H "Prefer: return=minimal" --data-binary "@$STATE_DIR/menu-cats.json" || die "Couldn't add the categories."
api POST /rest/v1/catalogue_items -H "Prefer: return=minimal" --data-binary "@$STATE_DIR/menu-items.json" || die "Couldn't add the products."
rm -f "$STATE_DIR/menu-cats.json" "$STATE_DIR/menu-items.json"
echo "Loaded the starter menu ($(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(len(d["cats"]), "categories,", len(d["items"]), "products")' "$ROWS")) into the venue."
