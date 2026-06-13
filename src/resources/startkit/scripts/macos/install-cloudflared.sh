#!/usr/bin/env sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

error_json() {
  printf '{"status":"error","message":"%s","actions":["install"]}\n' "$(json_escape "$1")"
}

mkdir -p "$STARTKIT_PLUGIN_BIN_DIR" "$STARTKIT_CACHE_DIR"
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="amd64" ;;
  *) printf '{"status":"blocked","message":"Unsupported macOS architecture","actions":[]}\n'; exit 0 ;;
esac

url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz"
archive="$STARTKIT_CACHE_DIR/cloudflared-darwin-${arch}.tgz"
tmp_dir="$STARTKIT_CACHE_DIR/cloudflared"
rm -rf "$tmp_dir"
mkdir -p "$tmp_dir"
curl -fsSL "$url" -o "$archive" || {
  error_json "Failed to download cloudflared."
  exit 0
}
tar -xzf "$archive" -C "$tmp_dir" || {
  error_json "Failed to extract cloudflared."
  exit 0
}
if [ ! -x "$tmp_dir/cloudflared" ]; then
  error_json "cloudflared archive did not contain an executable."
  exit 0
fi
install -m 0755 "$tmp_dir/cloudflared" "$STARTKIT_PLUGIN_BIN_DIR/cloudflared" || {
  error_json "Failed to install cloudflared."
  exit 0
}

version="$("$STARTKIT_PLUGIN_BIN_DIR/cloudflared" --version 2>&1 | head -n 1 || true)"
printf '{"status":"ok","version":"%s","path":"%s","message":"cloudflared installed","actions":[]}\n' \
  "$(json_escape "$version")" "$(json_escape "$STARTKIT_PLUGIN_BIN_DIR/cloudflared")"
