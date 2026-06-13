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
  printf '{"status":"missing","message":"Install Node.js %s or newer. The Node.js installer includes npm.","actions":["manual"]}\n' \
    "$(json_escape "${STARTKIT_MIN_VERSION:-22.0.0}")"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '{"status":"missing","path":"%s","message":"npm was not found. Reinstall Node.js %s or newer with npm enabled.","actions":["manual"]}\n' \
    "$(json_escape "$candidate")" "$(json_escape "${STARTKIT_MIN_VERSION:-22.0.0}")"
  exit 0
fi

version="$("$candidate" --version 2>/dev/null || true)"
major="$(version_major "$version")"
if [ -z "$major" ] || [ "$major" -lt "$min_major" ] 2>/dev/null; then
  printf '{"status":"outdated","version":"%s","path":"%s","message":"Node.js %s is below the required version. Install Node.js %s or newer; it includes npm.","actions":["manual"]}\n' \
    "$(json_escape "$version")" "$(json_escape "$candidate")" "$(json_escape "$version")" "$(json_escape "${STARTKIT_MIN_VERSION:-22.0.0}")"
  exit 0
fi

printf '{"status":"ok","version":"%s","path":"%s","message":"Node.js and npm are ready","actions":[]}\n' \
  "$(json_escape "$version")" "$(json_escape "$candidate")"
