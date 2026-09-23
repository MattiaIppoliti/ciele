import { NONE, type PreflightCatalogue } from "../preflight";
import { PREFLIGHT_FIXTURE_CATALOGUE, PREFLIGHT_LABELLED_CASES } from "./preflight-fixtures";
import {
  PREFLIGHT_SYNTHETIC_CASES,
  PREFLIGHT_SYNTHETIC_CATALOGUE,
  type PreflightGoldLabels,
} from "./preflight-synthetic-cases";

/**
 * The two labelled sets as one shape (#953): a catalogue and, per message, the
 * seven gold answers and nothing else. The keyed replay, the drift replay and
 * the labelling tool all read this rather than each adapting the #951 set on
 * its own, which is how the three stayed one definition of "the label".
 */
export type PreflightGoldSetName = "labelled" | "synthetic";

export interface PreflightGoldMessage {
  id: string;
  message: string;
  labels: PreflightGoldLabels;
}

export interface PreflightGoldSet {
  name: PreflightGoldSetName;
  catalogue: PreflightCatalogue;
  cases: readonly PreflightGoldMessage[];
}

/** The #951 set carries expected model answers; the gold is what they name. */
const labelled: PreflightGoldSet = {
  name: "labelled",
  catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
  cases: PREFLIGHT_LABELLED_CASES.map((c) => ({
    id: c.id,
    message: c.message,
    labels: {
      flow: c.answers.flow.choice,
      faq: c.answers.faq.choice,
      wantsHuman: c.expected.wantsHuman,
      desk: c.expected.wantsHuman ? c.answers.desk.choice : NONE,
      reasoning: c.expected.reasoning,
      frustration: c.expected.frustration as PreflightGoldLabels["frustration"],
      language: c.answers.language.choice as PreflightGoldLabels["language"],
    },
  })),
};

const synthetic: PreflightGoldSet = {
  name: "synthetic",
  catalogue: PREFLIGHT_SYNTHETIC_CATALOGUE,
  cases: PREFLIGHT_SYNTHETIC_CASES.map((c) => ({ id: c.id, message: c.message, labels: c.labels })),
};

export const PREFLIGHT_GOLD_SETS: readonly PreflightGoldSet[] = [labelled, synthetic];

/** One baseline entry: a labelled message the model routed right when the thresholds were set. */
export interface PreflightDriftCase {
  set: PreflightGoldSetName;
  id: string;
}
