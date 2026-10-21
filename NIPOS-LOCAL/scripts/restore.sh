#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh. WIPES the current local database first.
#   scripts/restore.sh backups/nipos-YYYYMMDD-HHMMSS.sql
set -euo pipefail
source "$(dirname "$0")/common.sh"

FILE="${1:-}"
[ -f "$FILE" ] || die "Usage: scripts/restore.sh <backup .sql file>"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "Supabase isn't running - run scripts/start.sh first."

read -r -p "This deletes ALL current NIPOS data and replaces it with $FILE. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || die "Cancelled."

# Fresh, empty schema from the migrations, then load the backup in one transaction with foreign-key
# triggers off (so table order doesn't matter). The migration's default settings row is dropped first
# because the backup carries its own.
supabase db reset --local --no-seed
{
  echo "begin; set session_replication_role = replica; delete from public.app_settings;"
  cat "$FILE"
  echo "commit;"
} | docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q
"$ROOT/scripts/start.sh" >/dev/null
echo "Restored from $FILE"
