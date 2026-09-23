/**
 * The source sample behind the synthetic pre-flight set (#953, stopgap).
 *
 *   curl -sL -o /tmp/bitext.csv https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv
 *   pnpm --filter @agent-hub/agent exec tsx scripts/sample-preflight-source.mts /tmp/bitext.csv
 *
 * Draws 150 rows from the Bitext customer-support dataset (27 intents, English,
 * CDLA-Sharing-1.0), stratified by intent with the quotas below and with the
 * offensive-language (`W`) and typo (`Z`) rows oversampled, because those are
 * the rows the `frustration` question and the robustness of the others turn on.
 * Seeded, so the same rows come out every run: every case in
 * `packages/core/src/testing/preflight-synthetic-cases.ts` names its source
 * row, and this is how that reference is checked.
 *
 * The output is the English source only. The Italian in the fixture is a hand
 * translation of these rows, done once and reviewed, never machine output.
 */
import { readFileSync } from "node:fs";

import { parseCsv, seededRandom } from "./preflight-shared";

const QUOTAS: Record<string, number> = {
  contact_human_agent: 14,
  contact_customer_service: 8,
  complaint: 10,
  recover_password: 10,
  registration_problems: 8,
  get_refund: 10,
  track_refund: 6,
  check_refund_policy: 8,
  check_cancellation_fee: 4,
  cancel_order: 8,
  change_order: 6,
  change_shipping_address: 6,
  set_up_shipping_address: 3,
  track_order: 8,
  delivery_period: 6,
  delivery_options: 4,
  check_payment_methods: 5,
  payment_issue: 5,
  check_invoice: 3,
  get_invoice: 5,
  create_account: 2,
  delete_account: 2,
  edit_account: 2,
  switch_account: 2,
  newsletter_subscription: 1,
  place_order: 2,
  review: 2,
};

const path = process.argv[2];
if (!path) {
  console.error("usage: sample-preflight-source.mts <bitext.csv>");
  process.exit(2);
}

const [header, ...body] = parseCsv(readFileSync(path, "utf8"));
const col = (name: string): number => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`column ${name} missing; header is ${header.join(",")}`);
  return i;
};
const FLAGS = col("flags");
const INSTRUCTION = col("instruction");
const INTENT = col("intent");

interface Row {
  row: number;
  flags: string;
  intent: string;
  instruction: string;
}
const rows: Row[] = body
  .filter((r) => r.length === header.length)
  .map((r, i) => ({ row: i + 2, flags: r[FLAGS], intent: r[INTENT], instruction: r[INSTRUCTION] }));

const random = seededRandom(953);
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sample: Row[] = [];
for (const [intent, quota] of Object.entries(QUOTAS)) {
  const pool = shuffled(rows.filter((r) => r.intent === intent));
  // Half the quota from the harder rows when the intent has them, then the rest.
  const hard = pool.filter((r) => /[WZ]/.test(r.flags));
  const easy = pool.filter((r) => !/[WZ]/.test(r.flags));
  const picked = [...hard.slice(0, Math.ceil(quota / 2)), ...easy].slice(0, quota);
  if (picked.length < quota) throw new Error(`${intent}: only ${picked.length} rows for a quota of ${quota}`);
  sample.push(...picked);
}

const total = Object.values(QUOTAS).reduce((a, b) => a + b, 0);
console.error(`${sample.length} rows (quota ${total}); W ${sample.filter((r) => r.flags.includes("W")).length}, Z ${sample.filter((r) => r.flags.includes("Z")).length}`);
for (const r of sample) console.log(JSON.stringify(r));
