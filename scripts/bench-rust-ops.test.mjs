import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, summarize } from "./bench-rust-ops.mjs";

test("percentiles use the nearest rank", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(sorted, 0.5), 50);
  assert.equal(percentile(sorted, 0.95), 95);
  assert.equal(percentile(sorted, 0.99), 99);
  assert.equal(percentile([], 0.5), null);
});

test("a summary does not depend on sample order", () => {
  assert.deepEqual(summarize([30, 10, 20]), { n: 3, p50: 20, p95: 30, p99: 30, mean: 20 });
});
