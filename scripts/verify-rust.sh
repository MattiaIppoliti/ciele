#!/bin/sh
# The Rust half of `pnpm verify`: what .github/workflows/rust.yml runs, minus
# fmt and clippy. services/ciele-api is outside the pnpm workspace, so turbo
# never reaches it, and the parity test skips without a binary; this builds
# one and makes the parity test fail rather than skip.
#
# No cargo is a failure, like every other step of `verify`. Opt out explicitly
# with CIELE_SKIP_RUST=1, which says so in the output.
set -e

if [ "${CIELE_SKIP_RUST:-}" = "1" ]; then
  echo "verify:rust: CIELE_SKIP_RUST=1, skipping the Rust service and its parity test" >&2
  exit 0
fi
if ! command -v cargo >/dev/null 2>&1 || ! cargo --version >/dev/null 2>&1; then
  echo "verify:rust: cargo is not usable here. Install Rust (rustup), or set CIELE_SKIP_RUST=1 to skip on purpose." >&2
  exit 1
fi

manifest=services/ciele-api/Cargo.toml
cargo test --locked --manifest-path "$manifest"
cargo build --locked --manifest-path "$manifest"

CIELE_RUST_PARITY_REQUIRED=1 \
CIELE_RUST_API_BIN="$PWD/services/ciele-api/target/debug/ciele-api" \
  pnpm --filter @ciele/ops exec vitest run rust-parity
