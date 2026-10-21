# shellcheck shell=bash disable=SC2034
# Shared by the other scripts: paths, and the running stack's URL/keys from `supabase status`.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.nipos"
WEB_PORT="${NIPOS_WEB_PORT:-8080}"
API_PORT=54321
DB_CONTAINER="supabase_db_nipos-local"   # supabase_db_<project_id from supabase/config.toml>
mkdir -p "$STATE_DIR"
cd "$ROOT" || exit 1

die() { echo "ERROR: $*" >&2; exit 1; }

load_stack_env() {
  command -v supabase >/dev/null || die "Supabase CLI not installed - run scripts/setup.sh first."
  local env
  env="$(supabase status -o env 2>/dev/null)" || die "Supabase isn't running - run scripts/start.sh first."
  eval "$(printf '%s\n' "$env" | grep -E '^[A-Z_]+=')"
  ANON_KEY="${ANON_KEY:-$PUBLISHABLE_KEY}"
  SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$SECRET_KEY}"
  API_URL="${API_URL:-http://127.0.0.1:$API_PORT}"
  [ -n "$ANON_KEY" ] && [ -n "$SERVICE_ROLE_KEY" ] || die "Couldn't read API keys from 'supabase status'."
}

# curl against the local API as the service role (bypasses RLS - server-side scripts only).
api() {
  local method="$1" path="$2"; shift 2
  curl -fsS -X "$method" "$API_URL$path" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" "$@"
}
