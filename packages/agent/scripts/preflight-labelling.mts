/**
 * The labelling campaign's two mechanical halves (#953).
 *
 *   pnpm --filter @agent-hub/agent exec tsx scripts/preflight-labelling.mts sheet <out.csv>
 *   pnpm --filter @agent-hub/agent exec tsx scripts/preflight-labelling.mts agreement <a.csv> <b.csv> [--gold]
 *
 * `sheet` writes the **blind** sheet: the 150 synthetic messages in a seeded
 * shuffle with one empty column per question and nothing else. No gold label,
 * no source intent, no id that sorts by topic: a labeller who can see any of
 * those is not labelling blind. The allowed values for each column, and the
 * tie-break rules, are in `docs/preflight-labelling.md`; the sheet's second
 * row repeats the values so the labeller has them in the file.
 *
 * `agreement` reads two filled sheets and prints, per question, observed
 * agreement and Cohen's kappa (the figures the ticket asks to record), then
 * every disagreement with both answers, so the two labellers can adjudicate
 * from a list. `--gold` also compares each labeller against the provisional
 * synthetic labels, which says whether the set's own labeller was an outlier.
 * An empty cell is a skipped item and leaves the kappa count, never a
 * disagreement.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { parseCsv, seededRandom } from "./preflight-shared";

import {
  FLOW_DEFAULT,
  FLOW_OTHER,
  LANGUAGE_MIXED,
  LANGUAGE_OTHER,
  NONE,
  PREFLIGHT_LANGUAGES,
  PREFLIGHT_QUESTION_IDS,
  REASONING_LEVELS,
  cohenKappa,
  type PreflightQuestionId,
} from "@agent-hub/core";
import {
  PREFLIGHT_SYNTHETIC_CASES,
  PREFLIGHT_SYNTHETIC_CATALOGUE,
  type PreflightGoldLabels,
} from "@agent-hub/core/testing";

const COLUMNS = ["item", "message", ...PREFLIGHT_QUESTION_IDS] as const;

const allowed: Record<PreflightQuestionId, string[]> = {
  flow: [...PREFLIGHT_SYNTHETIC_CATALOGUE.flows.map((f) => f.id), FLOW_DEFAULT, FLOW_OTHER],
  faq: [...PREFLIGHT_SYNTHETIC_CATALOGUE.faqs.map((f) => f.id), NONE],
  wants_human: ["true", "false"],
  desk: [...PREFLIGHT_SYNTHETIC_CATALOGUE.desks.map((d) => d.id), NONE],
  reasoning: [...REASONING_LEVELS],
  frustration: ["0", "1", "2", "3"],
  language: [...PREFLIGHT_LANGUAGES, LANGUAGE_MIXED, LANGUAGE_OTHER],
};

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** The same seeded order every time, so two sheets line up row for row. */
function blindOrder(): typeof PREFLIGHT_SYNTHETIC_CASES {
  const random = seededRandom(20260953);
  const out = [...PREFLIGHT_SYNTHETIC_CASES];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function writeSheet(out: string): void {
  const lines = [COLUMNS.join(",")];
  lines.push(
    [
      "allowed values →",
      "",
      ...PREFLIGHT_QUESTION_IDS.map((q) => allowed[q].join(" | ")),
    ]
      .map(quote)
      .join(",")
  );
  blindOrder().forEach((c, i) => {
    lines.push([String(i + 1), c.message, ...PREFLIGHT_QUESTION_IDS.map(() => "")].map(quote).join(","));
  });
  writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(`wrote ${PREFLIGHT_SYNTHETIC_CASES.length} blind items to ${out}`);
}

type Sheet = Map<number, Partial<Record<PreflightQuestionId, string>>>;

function readSheet(path: string): Sheet {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8")).filter((r) =>
    r.some((cell) => cell.trim() !== "")
  );
  const index = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${path}: column "${name}" missing`);
    return i;
  };
  const itemCol = index("item");
  const cols = Object.fromEntries(PREFLIGHT_QUESTION_IDS.map((q) => [q, index(q)])) as Record<PreflightQuestionId, number>;
  const sheet: Sheet = new Map();
  for (const row of rows) {
    const item = Number(row[itemCol]);
    if (!Number.isInteger(item) || item < 1) continue; // the "allowed values" row
    const labels: Partial<Record<PreflightQuestionId, string>> = {};
    for (const q of PREFLIGHT_QUESTION_IDS) {
      const raw = (row[cols[q]] ?? "").trim().toLowerCase();
      if (raw === "") continue;
      if (!allowed[q].includes(raw)) throw new Error(`${path} item ${item}: "${raw}" is not an allowed ${q}`);
      labels[q] = raw;
    }
    sheet.set(item, labels);
  }
  return sheet;
}

function goldAsSheet(): Sheet {
  const sheet: Sheet = new Map();
  blindOrder().forEach((c, i) => sheet.set(i + 1, goldCells(c.labels)));
  return sheet;
}

function goldCells(labels: PreflightGoldLabels): Record<PreflightQuestionId, string> {
  return {
    flow: labels.flow,
    faq: labels.faq,
    wants_human: String(labels.wantsHuman),
    desk: labels.desk,
    reasoning: labels.reasoning,
    frustration: String(labels.frustration),
    language: labels.language,
  };
}

function compare(nameA: string, a: Sheet, nameB: string, b: Sheet, listDisagreements: boolean): void {
  const items = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  const order = blindOrder();
  console.log(`\n${nameA} vs ${nameB}`);
  console.log("question       items  agreed  observed  kappa");
  const disagreements: string[] = [];
  for (const q of PREFLIGHT_QUESTION_IDS) {
    const xs = items.map((i) => a.get(i)?.[q] ?? null);
    const ys = items.map((i) => b.get(i)?.[q] ?? null);
    const f = cohenKappa(xs, ys);
    const fmt = (n: number | null): string => (n === null ? "n/a" : n.toFixed(2));
    console.log(`${q.padEnd(14)} ${String(f.items).padEnd(6)} ${String(f.agreed).padEnd(7)} ${fmt(f.observed).padEnd(9)} ${fmt(f.kappa)}`);
    if (listDisagreements) {
      items.forEach((item, k) => {
        if (xs[k] !== null && ys[k] !== null && xs[k] !== ys[k]) {
          disagreements.push(`  item ${item} ${q}: ${nameA}=${xs[k]} ${nameB}=${ys[k]}  “${order[item - 1]?.message ?? ""}”`);
        }
      });
    }
  }
  if (listDisagreements && disagreements.length) {
    console.log(`\n${disagreements.length} disagreements to adjudicate:`);
    for (const line of disagreements) console.log(line);
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === "sheet" && rest[0]) {
  writeSheet(rest[0]);
} else if (command === "agreement" && rest[0] && rest[1]) {
  const a = readSheet(rest[0]);
  const b = readSheet(rest[1]);
  compare("A", a, "B", b, true);
  if (rest.includes("--gold")) {
    const gold = goldAsSheet();
    compare("A", a, "synthetic", gold, false);
    compare("B", b, "synthetic", gold, false);
  }
} else {
  console.error("usage: preflight-labelling.mts sheet <out.csv> | agreement <a.csv> <b.csv> [--gold]");
  process.exit(2);
}
