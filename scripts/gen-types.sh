#!/usr/bin/env bash
# Regenerate TypeScript bindings from Rust types annotated with
# `#[derive(ts_rs::TS)]` + `#[ts(export)]`.
#
# Output: src/shared/client-ts/generated/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/src/shared/client-ts/generated"

# ts-rs resolves per-type `export_to` attributes relative to CARGO_MANIFEST_DIR
# without normalizing `..`, so we pin the output dir via env var instead.
export TS_RS_EXPORT_DIR="$OUT_DIR"

cd "$ROOT/src"
# ts-rs emits bindings during `cargo test`. Filter to only the synthesized
# export tests so we don't pay for the full suite. Hand-written constant
# exporters (not covered by ts-rs) also use the `export_bindings_` prefix.
cargo test -p common --no-fail-fast export_bindings_ 2>&1 | tail -5

echo ""
echo "Generated files in $OUT_DIR:"
ls -1 "$OUT_DIR" | grep -v '^\.' || echo "  (none)"
