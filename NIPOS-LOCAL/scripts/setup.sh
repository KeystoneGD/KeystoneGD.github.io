#!/usr/bin/env bash
# One-time setup on the Chromebook's Linux terminal (needs internet). Installs Docker and the Supabase
# CLI, downloads every container image so the stack can later start with no internet, and generates
# this server's own Web Push keys. Safe to re-run.
set -euo pipefail
source "$(dirname "$0")/common.sh"

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in
  amd64|x86_64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) die "Unsupported CPU architecture: $ARCH (need x86_64 or ARM64)" ;;
esac

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3500 ]; then
  echo "WARNING: the Linux environment only has ${MEM_MB} MB of memory. The Supabase stack needs about 3 GB."
  echo "         On ChromeOS: Settings > About ChromeOS > Linux development environment - there's no memory"
  echo "         slider, but closing Chrome tabs/apps while setting up helps."
fi

echo "==> Installing base packages"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates python3 openssl

if ! command -v docker >/dev/null; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker >/dev/null 2>&1 || sudo service docker start || true

if ! command -v supabase >/dev/null; then
  echo "==> Installing Supabase CLI ($ARCH)"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/supabase.tgz" "https://github.com/supabase/cli/releases/latest/download/supabase_linux_${ARCH}.tar.gz"
  tar -xzf "$tmp/supabase.tgz" -C "$tmp" supabase
  sudo install -m 755 "$tmp/supabase" /usr/local/bin/supabase
  rm -rf "$tmp"
fi
supabase --version

if [ ! -f "$STATE_DIR/vapid.json" ]; then
  echo "==> Generating Web Push (VAPID) keys"
  python3 "$ROOT/scripts/gen-vapid.py" > "$STATE_DIR/vapid.json"
  chmod 600 "$STATE_DIR/vapid.json"
fi

# Docker group membership only applies to new shells - use sg so this first run works without a re-login.
echo "==> Downloading and starting the Supabase stack (first time takes a while)"
sg docker -c "'$ROOT/scripts/start.sh'"

cat <<EOF

Setup complete. Next:
  1. Create your first Global Admin:   scripts/create-admin.sh 123456 "Your Name"
  2. Open http://localhost:$WEB_PORT/backend.html on the Chromebook and sign in with that PIN.
  3. Let other devices connect - see "Connecting the tills" in README.md.

If 'docker' commands later say "permission denied", close and reopen the Terminal once.
EOF
