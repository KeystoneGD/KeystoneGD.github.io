#!/usr/bin/env bash
# Creates the hidden $YSTEM account (Master settings), or changes its password. Asks for the password
# so it never ends up in your shell history.
#   scripts/create-system.sh                 the main $YSTEM sign-in
#   scripts/create-system.sh 07466707188     an extra $YSTEM sign-in with its own login and password
set -euo pipefail
source "$(dirname "$0")/common.sh"

LOGIN="${1:-}"
[ -z "$LOGIN" ] || [[ "$LOGIN" =~ ^[0-9]{6,}$ ]] || die "An extra \$YSTEM login must be 6 or more numbers."
read -rsp "New \$YSTEM password (10+ characters): " PW; echo
read -rsp "Same again: " PW2; echo
[ "$PW" = "$PW2" ] || die "The two passwords don't match."
[ "${#PW}" -ge 10 ] || die "The password must be at least 10 characters."

# Passed as psql variables, so quotes in the password can't break the SQL.
if [ -z "$LOGIN" ]; then
  SQL="select public.nipos_setup_system_account(:'pw');"
else
  SQL="select public.nipos_setup_system_login(:'login', :'pw');"
fi
printf '%s\n' "$SQL" | docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA \
  -v pw="$PW" -v login="$LOGIN" || die "Couldn't set it up - is NIPOS running (scripts/start.sh)?"
echo "Done. In Backend, type ${LOGIN:-\$YSTEM} in the PIN box, then that password."
