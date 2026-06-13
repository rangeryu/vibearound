#!/usr/bin/env sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

program="${STARTKIT_PROGRAM:?missing STARTKIT_PROGRAM}"
version_arg="${STARTKIT_VERSION_ARG:---version}"
candidate=""

if [ "${STARTKIT_ITEM_MANAGED:-false}" = "true" ]; then
  if [ -x "${STARTKIT_BIN_DIR:-}/$program" ]; then
    candidate="$STARTKIT_BIN_DIR/$program"
  fi
fi

if [ -z "$candidate" ] && command -v "$program" >/dev/null 2>&1; then
  candidate="$(command -v "$program")"
fi

if [ -z "$candidate" ]; then
  if [ "${STARTKIT_ITEM_MANAGED:-false}" = "true" ]; then
    printf '{"status":"missing","message":"%s was not found","actions":["install"]}\n' "$(json_escape "$program")"
  else
    printf '{"status":"blocked","message":"Install %s on this computer, then scan again.","actions":[]}\n' "$(json_escape "$program")"
  fi
  exit 0
fi

path="$candidate"
set +e
version_output="$("$candidate" "$version_arg" 2>&1)"
version_status=$?
set -e
version="$(printf '%s' "$version_output" | head -n 1)"

if [ "$version_status" -ne 0 ] || printf '%s' "$version_output" | grep -Eqi 'xcode-select|developer tools (were )?not found|no developer tools'; then
  printf '{"status":"blocked","version":"%s","path":"%s","message":"%s is present but not usable. Reinstall it, then scan again.","actions":[]}\n' \
    "$(json_escape "$version")" "$(json_escape "$path")" "$(json_escape "$program")"
  exit 0
fi

printf '{"status":"ok","version":"%s","path":"%s","message":"%s is ready","actions":[]}\n' \
  "$(json_escape "$version")" "$(json_escape "$path")" "$(json_escape "$program")"
