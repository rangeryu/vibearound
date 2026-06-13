#!/usr/bin/env sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

version_major() {
  printf '%s' "$1" | sed 's/^v//' | cut -d. -f1
}

min_major="$(version_major "${STARTKIT_MIN_VERSION:-22.0.0}")"
candidate=""

if command -v node >/dev/null 2>&1; then
  candidate="$(command -v node)"
fi

if [ -z "$candidate" ]; then
  printf '{"status":"blocked","message":"Install Node.js %s or newer, then scan again.","actions":[]}\n' \
    "$(json_escape "${STARTKIT_MIN_VERSION:-22.0.0}")"
  exit 0
fi

version="$("$candidate" --version 2>/dev/null || true)"
major="$(version_major "$version")"
if [ -z "$major" ] || [ "$major" -lt "$min_major" ] 2>/dev/null; then
  printf '{"status":"blocked","version":"%s","path":"%s","message":"Node.js %s is below the required version. Install Node.js %s or newer, then scan again.","actions":[]}\n' \
    "$(json_escape "$version")" "$(json_escape "$candidate")" "$(json_escape "$version")" "$(json_escape "${STARTKIT_MIN_VERSION:-22.0.0}")"
  exit 0
fi

printf '{"status":"ok","version":"%s","path":"%s","message":"Node.js is ready","actions":[]}\n' \
  "$(json_escape "$version")" "$(json_escape "$candidate")"
