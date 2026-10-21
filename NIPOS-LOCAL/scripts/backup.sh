#!/usr/bin/env bash
# Saves all NIPOS data (venues, staff + their PIN logins, catalogue, sales, Z reports, settings) to
# backups/nipos-<date>.sql. This Chromebook holds the only copy of the data - copy backups somewhere
# else regularly (Google Drive via the ChromeOS Files app, or a USB stick).
# Uploaded notification sound files aren't included; re-upload them in Backend if ever needed.
set -euo pipefail
source "$(dirname "$0")/common.sh"

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "Supabase isn't running - run scripts/start.sh first."
mkdir -p "$ROOT/backups"
OUT="$ROOT/backups/nipos-$(date +%Y%m%d-%H%M%S).sql"
# Only the app's own tables plus the login tables - not Supabase's internal auth/storage bookkeeping,
# which a fresh stack recreates itself and would clash on restore.
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres --data-only --no-owner \
  -t 'public.*' -t auth.users -t auth.identities > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "Backup written to $OUT"
