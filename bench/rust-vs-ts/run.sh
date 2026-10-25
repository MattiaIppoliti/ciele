#!/usr/bin/env bash
# ./run.sh <component>...: both sides over corpus.json, then parity and timing.
set -euo pipefail
cd "$(dirname "$0")"
R=${CARGO_TARGET_DIR:-target}/release/rust-vs-ts
# tsx ships in the pnpm store, not as a root bin.
TSX_CLI=$(ls -d ../../node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)
ITER=${ITER:-30}
CORPUS=${CORPUS:-corpus.json}
mkdir -p results
for c in "$@"; do
  for side in rust ts; do
    if [ "$side" = rust ]; then cmd=("$R" "$c" "$CORPUS" "results/$c-rust.json" "$ITER")
    else cmd=(node "$TSX_CLI" ts/run.ts "$c" "$CORPUS" "results/$c-ts.json" "$ITER"); fi
    /usr/bin/time -l "${cmd[@]}" > "results/timing-$c-$side.json" 2> "results/time-$c-$side.txt"
    rss=$(awk '/maximum resident set size/ {printf "%.1f", $1/1048576}' "results/time-$c-$side.txt")
    echo "$(cat "results/timing-$c-$side.json") rssMB=$rss"
  done
  python3 - "$c" <<'PY'
import json, sys
c = sys.argv[1]
a = json.load(open(f"results/{c}-rust.json")); b = json.load(open(f"results/{c}-ts.json"))
diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
print(f"parity {c}: {len(a) - len(diff)}/{len(a)} identical" + ("" if not diff else f"; first diff #{diff[0]}: rust={a[diff[0]]} ts={b[diff[0]]}"))
PY
done
