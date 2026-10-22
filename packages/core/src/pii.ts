/**
 * PII masking (#1078): the pure half of the `pii_masking` Guardrail. Personal
 * data in text bound for a model provider is replaced with a typed placeholder
 * (`[EMAIL_1]`, `[PHONE_1]`, …), and the placeholders the model writes back are
 * replaced with the original values before anyone reads the answer.
 *
 * Detection is narrow on purpose. Every detector is either a checksum (card:
 * Luhn; IBAN: mod 97; codice fiscale: its check letter) or a shape that only
 * personal data has (an address with an `@`, a phone number written with its
 * `+`, its trunk `0` or its groups).
 * A detector that guessed at bare digit runs would mask a 10-digit order number
 * and break the answer about that order; pattern masking that misfires on
 * look-alikes is the failure the reference platform's own setup page warns
 * about. Person names are out of scope for the same reason.
 *
 * Masking is a deterministic function of the text a masker has seen, in the
 * order it saw it: the same transcript always yields the same placeholders.
 * Over-masking is cheap (the value comes back on the way out); missing a value
 * is the leak, so where a span's extent is uncertain it errs long.
 *
 * The runtime half, which puts a masker in front of every model call of a
 * Conversation Turn, is `pii-masking.ts` in `@agent-hub/agent`.
 */

import type { StoredMessage } from "./types";

export const PII_DETECTORS = ["email", "phone", "payment_card", "iban", "codice_fiscale"] as const;
export type PiiDetector = (typeof PII_DETECTORS)[number];

/**
 * Where a masked value was first seen. `other` is everything with no more
 * specific source: an earlier answer, the Assistant's own instructions.
 */
export const PII_ORIGINS = ["visitor", "knowledge", "tool", "other"] as const;
export type PiiOrigin = (typeof PII_ORIGINS)[number];

/** Who or what an origin is, as the Inbox names it. */
const PII_ORIGIN_LABELS: Record<PiiOrigin, string> = {
  visitor: "the Visitor",
  knowledge: "knowledge",
  tool: "tool results",
  other: "instructions and earlier answers",
};

export const PII_DETECTOR_LABELS: Record<
  PiiDetector,
  {
    title: string;
    hint: string;
    tag: string;
    noun: { one: string; many: string };
    /** Neutral wording for a value that must not come back (`descriptions`). */
    yours: string;
  }
> = {
  email: {
    title: "Email address",
    hint: "Any address with an @ and a domain.",
    tag: "EMAIL",
    noun: { one: "email address", many: "email addresses" },
    yours: "your email address",
  },
  phone: {
    title: "Phone number",
    hint: "Written with its country code (+39, 0039), its leading 0, or in groups like 555 123 4567. Ciele leaves a bare run of digits alone.",
    tag: "PHONE",
    noun: { one: "phone number", many: "phone numbers" },
    yours: "your phone number",
  },
  payment_card: {
    title: "Payment card number",
    hint: "13 to 19 digits, written whole or in groups of four, that pass the Luhn check.",
    tag: "CARD",
    noun: { one: "payment card number", many: "payment card numbers" },
    yours: "your payment card number",
  },
  iban: {
    title: "IBAN",
    hint: "Only when its check digits are valid.",
    tag: "IBAN",
    noun: { one: "IBAN", many: "IBANs" },
    yours: "your IBAN",
  },
  codice_fiscale: {
    title: "Italian tax code (codice fiscale)",
    hint: "16 characters with a valid check character, letters in place of digits included.",
    tag: "CODICE_FISCALE",
    noun: { one: "codice fiscale", many: "codici fiscali" },
    yours: "your codice fiscale",
  },
};

const TAGS = PII_DETECTORS.map((d) => PII_DETECTOR_LABELS[d].tag);
const PLACEHOLDER = new RegExp(`\\[(?:${TAGS.join("|")})_\\d+\\]`, "g");
/** `[` + the longest tag + `_` + six digits + `]`. */
const PLACEHOLDER_MAX = 1 + Math.max(...TAGS.map((t) => t.length)) + 1 + 6 + 1;

/** One value found in a text, at `[start, end)`. */
export interface PiiMatch {
  detector: PiiDetector;
  start: number;
  end: number;
  value: string;
  /** The value normalised, so one value written two ways is one value. */
  key: string;
}

type Span = { start: number; end: number; key: string };
type Finder = (text: string) => Span[];

const EMAIL = /(?<![\w.%+-])[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;

/**
 * A phone with its international prefix: `+` or `00`, a country code (which
 * never starts with 0), then 8–15 digits in all.
 */
const PHONE_INTERNATIONAL = /(?<![\w+])(?:\+|00)[1-9]\d*(?:[ .-]?\(\d+\)|[ .-]\d+|\(\d+\))*/g;
/** A national number with its trunk `0` (never `00`, the international prefix), in groups: 06 1234 5678. */
const PHONE_TRUNK = /(?<![\w+.-])0[1-9]\d{0,3}(?:[ .-]\d{2,4}){1,4}/g;
/** Three, three, four: (555) 123-4567, 555-123-4567, 333 123 4567. */
const PHONE_GROUPED = /(?<![\w+.-])(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\d)/g;

/** A maximal run of digits joined by single spaces or dashes. */
const DIGIT_RUN = /(?<![\w.-])\d(?:[ -]?\d)*/g;
/** Two letters, two check digits, then up to 40 more characters. */
const IBAN_RUN = /(?<!\w)[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,40}/g;
/**
 * A codice fiscale: six letters, then the birth date and place, where omocodia
 * may have swapped any digit for one of LMNPQRSTUV, then the check letter.
 */
const DIGIT_OR_OMOCODIA = "0-9LMNPQRSTUV";
const CODICE_FISCALE = new RegExp(
  `(?<![A-Za-z0-9])[A-Z]{6}[${DIGIT_OR_OMOCODIA}]{2}[ABCDEHLMPRST][${DIGIT_OR_OMOCODIA}]{2}[A-Z][${DIGIT_OR_OMOCODIA}]{3}[A-Z](?![A-Za-z0-9])`,
  "gi"
);

const digitsOf = (text: string) => text.replace(/\D/g, "");

/**
 * The prefixes of `run` that end where a group ends, longest first: the run
 * itself, then each cut before a separator. A span that swallowed the next
 * word or number is trimmed back one group at a time until it validates.
 */
function prefixCuts(run: string): number[] {
  const cuts = [run.length];
  for (let p = run.length - 1; p > 0; p--) {
    if (/[ .(-]/.test(run[p]!) && /[\w)]/.test(run[p - 1]!)) cuts.push(p);
  }
  return cuts;
}

function anchoredFinder(pattern: RegExp, validate: (candidate: string) => string | null): Finder {
  return (text) => {
    const spans: Span[] = [];
    for (const match of text.matchAll(pattern)) {
      const run = match[0];
      for (const cut of prefixCuts(run)) {
        const key = validate(run.slice(0, cut));
        if (key) {
          spans.push({ start: match.index, end: match.index + cut, key });
          break;
        }
      }
    }
    return spans;
  };
}

/** Every match of `pattern` whose `keyOf` is not null, as a span under that key. */
function regexFinder(pattern: RegExp, keyOf: (match: string) => string | null): Finder {
  return (text) =>
    [...text.matchAll(pattern)].flatMap((m) => {
      const key = keyOf(m[0]);
      return key ? [{ start: m.index, end: m.index + m[0].length, key }] : [];
    });
}

const findEmails = regexFinder(EMAIL, (match) => match.toLowerCase());

/**
 * `+` makes any digit run a phone number. `00` does not: "order 0012345678"
 * is an order number, so the `00` form must be written in groups.
 */
function internationalPhone(candidate: string): string | null {
  const plus = candidate.startsWith("+");
  if (!plus && !/[ .()-]/.test(candidate)) return null;
  const digits = digitsOf(candidate);
  const significant = plus ? digits : digits.slice(2);
  return significant.length >= 8 && significant.length <= 15 ? `+${significant}` : null;
}

/**
 * One separator throughout, and not a date: "01-02-2024 10:30" is a day and
 * an hour, and "05.10.2026 14 people" a day and a head count.
 */
function trunkPhone(candidate: string): string | null {
  if (new Set(candidate.match(/[ .-]/g)).size > 1) return null;
  if (/^\d{2}[.-]\d{2}[.-](?:19|20)\d{2}\b/.test(candidate)) return null;
  const digits = digitsOf(candidate);
  return digits.length >= 9 && digits.length <= 12 ? digits : null;
}

function groupedPhone(candidate: string): string | null {
  const digits = digitsOf(candidate);
  return /^[2-9]/.test(digits) ? digits : null;
}

/** The three phone shapes, each run on what the previous left unclaimed. */
const findPhones: Finder = (text) => {
  const spans: Span[] = [];
  let rest = text;
  for (const finder of [
    anchoredFinder(PHONE_INTERNATIONAL, internationalPhone),
    anchoredFinder(PHONE_TRUNK, trunkPhone),
    anchoredFinder(PHONE_GROUPED, groupedPhone),
  ]) {
    const found = finder(rest);
    spans.push(...found);
    rest = blank(rest, found);
  }
  return spans;
};

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * How cards are written: whole, in fours (the last group may be short), or
 * Amex and Diners' 4-6-5 and 4-6-4. A list of amounts, "100 200 300 …", is
 * none of them, whatever Luhn says about a window of it.
 */
function cardGrouping(lengths: readonly number[]): boolean {
  if (lengths.length === 1) return true;
  const last = lengths[lengths.length - 1]!;
  if (lengths.slice(0, -1).every((n) => n === 4) && last >= 1 && last <= 4) return true;
  return lengths.length === 3 && lengths[0] === 4 && lengths[1] === 6 && (last === 5 || last === 4);
}

/**
 * Card numbers sit inside longer digit runs often enough ("ref 12 4111 …
 * 2027") that a run is searched for windows of whole groups: each window of
 * 13–19 digits, grouped the way cards are written, that starts like a card
 * (2–6: Mastercard, Amex, Visa, Discover and their kin) and passes Luhn,
 * longest first.
 */
const findCards: Finder = (text) => {
  const spans: Span[] = [];
  for (const match of text.matchAll(DIGIT_RUN)) {
    const groups = [...match[0].matchAll(/\d+/g)].map((g) => ({
      start: match.index + g.index,
      end: match.index + g.index + g[0].length,
      digits: g[0],
    }));
    const windows: Span[] = [];
    for (let i = 0; i < groups.length; i++) {
      let digits = "";
      const lengths: number[] = [];
      for (let j = i; j < groups.length && digits.length < 19; j++) {
        digits += groups[j]!.digits;
        lengths.push(groups[j]!.digits.length);
        if (
          digits.length >= 13 &&
          digits.length <= 19 &&
          /^[2-6]/.test(digits) &&
          cardGrouping(lengths) &&
          luhnValid(digits)
        ) {
          windows.push({ start: groups[i]!.start, end: groups[j]!.end, key: digits });
        }
      }
    }
    windows.sort((a, b) => b.key.length - a.key.length || a.start - b.start);
    for (const window of windows) {
      if (!spans.some((s) => s.start < window.end && window.start < s.end)) spans.push(window);
    }
  }
  return spans;
};

function ibanValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * The check letter's values for a character in an odd position (1-based), A-Z
 * and 0-9. A character in an even position is worth its own index: 0-9 for a
 * digit, A=0 to Z=25 for a letter.
 */
const CF_ODD_LETTERS = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
const CF_ODD_DIGITS = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];

function codiceFiscaleValid(code: string): boolean {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = code[i]!;
    const digit = char >= "0" && char <= "9";
    const index = digit ? char.charCodeAt(0) - 48 : char.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? (digit ? CF_ODD_DIGITS[index]! : CF_ODD_LETTERS[index]!) : index;
  }
  return String.fromCharCode(65 + (sum % 26)) === code[15];
}

const findCodiciFiscali = regexFinder(CODICE_FISCALE, (match) => {
  const code = match.toUpperCase();
  return codiceFiscaleValid(code) ? code : null;
});

const findIbans = anchoredFinder(IBAN_RUN, (candidate) => {
  const iban = candidate.replace(/ /g, "").toUpperCase();
  return ibanValid(iban) ? iban : null;
});

/**
 * Detectors that validate a checksum run first and claim their spans, so a
 * phone shape cannot eat into a card or an IBAN written next to it.
 */
const FINDERS: [PiiDetector, Finder][] = [
  ["email", findEmails],
  ["iban", findIbans],
  ["codice_fiscale", findCodiciFiscali],
  ["payment_card", findCards],
  ["phone", findPhones],
];

/** `text` with each span overwritten by a character no detector matches. */
function blank(text: string, spans: readonly Span[]): string {
  let out = text;
  for (const { start, end } of spans) out = out.slice(0, start) + "\u0000".repeat(end - start) + out.slice(end);
  return out;
}

/** Every value the selected detectors find in `text`, in order, never overlapping. */
export function detectPii(text: string, detectors: readonly PiiDetector[]): PiiMatch[] {
  const matches: PiiMatch[] = [];
  let rest = text;
  for (const [detector, find] of FINDERS) {
    if (!detectors.includes(detector)) continue;
    const spans = find(rest);
    for (const span of spans) {
      matches.push({ detector, ...span, value: text.slice(span.start, span.end), key: `${detector}:${span.key}` });
    }
    rest = blank(rest, spans);
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** How many distinct values one detector masked from one origin. */
export interface PiiMaskCount {
  detector: PiiDetector;
  origin: PiiOrigin;
  count: number;
}

/**
 * What a turn's masking left in its trace: which guardrail, and counts. Never
 * a value and never the placeholder map, so the trace says nothing the
 * transcript beside it does not.
 */
export interface PiiMaskingTrace {
  id: string;
  name: string;
  masked: PiiMaskCount[];
}

/** Placeholders a model writes, restored as the text streams. */
export interface PlaceholderRestorer {
  /** Feed the next delta; returns what may be shown now. */
  push(delta: string): string;
  /** The stream ended; returns what was held back. */
  end(): string;
}

export interface PiiMasker {
  /**
   * Marks every placeholder-shaped literal in `text` (a Visitor who typed
   * "[EMAIL_1]") as never to be issued, so restoring an answer can never turn
   * their literal into somebody's address. Seeding and masking reserve the
   * text they are given; this is for text whose values come later.
   */
  reserve(text: string): void;
  /** Numbers the values in `text` without counting them as sent anywhere. */
  seed(text: string, origin: PiiOrigin): void;
  /** `text` as a model provider may see it. Values masked here count as sent. */
  mask(text: string, origin?: PiiOrigin): string;
  /** Issued placeholders back to their values; any other text unchanged. */
  restore(text: string): string;
  /** The streaming form of {@link restore}, one per streamed segment. */
  restorer(): PlaceholderRestorer;
  /** Distinct values sent masked, by detector then origin. */
  report(): PiiMaskCount[];
}

interface Entry {
  detector: PiiDetector;
  /** The value as first written: what a placeholder restores to. */
  value: string;
  placeholder: string;
  origin: PiiOrigin;
  sent: boolean;
  /** Seen in knowledge, whoever wrote it first: safe to restore into a draft. */
  inKnowledge: boolean;
}

export interface PiiMaskerOptions {
  /**
   * What a placeholder turns back into. `values` (the default) restores the
   * value. `descriptions` is for text that becomes knowledge any Visitor can
   * retrieve (a Suggested Fix draft): a placeholder turns into neutral wording,
   * "your email address", unless knowledge already holds its value.
   */
  restore?: "values" | "descriptions";
}

export function createPiiMasker(detectors: readonly PiiDetector[], options: PiiMaskerOptions = {}): PiiMasker {
  const byKey = new Map<string, Entry>();
  const byPlaceholder = new Map<string, Entry>();
  const issued: Partial<Record<PiiDetector, number>> = {};
  const reserved = new Set<string>();

  const reserve = (text: string) => {
    if (!text.includes("[")) return;
    for (const [literal] of text.matchAll(PLACEHOLDER)) {
      if (!byPlaceholder.has(literal)) reserved.add(literal);
    }
  };

  const entryFor = (match: PiiMatch, origin: PiiOrigin): Entry => {
    const known = byKey.get(match.key);
    if (known) {
      if (known.origin === "other") known.origin = origin;
      if (origin === "knowledge") known.inKnowledge = true;
      return known;
    }
    const tag = PII_DETECTOR_LABELS[match.detector].tag;
    let n = (issued[match.detector] ?? 0) + 1;
    while (reserved.has(`[${tag}_${n}]`)) n += 1;
    issued[match.detector] = n;
    const entry: Entry = {
      detector: match.detector,
      value: match.value,
      placeholder: `[${tag}_${n}]`,
      origin,
      sent: false,
      inKnowledge: origin === "knowledge",
    };
    byKey.set(match.key, entry);
    byPlaceholder.set(entry.placeholder, entry);
    return entry;
  };

  const restoreOne = (placeholder: string): string => {
    const entry = byPlaceholder.get(placeholder);
    if (!entry) return placeholder;
    return options.restore === "descriptions" && !entry.inKnowledge
      ? PII_DETECTOR_LABELS[entry.detector].yours
      : entry.value;
  };
  const restore = (text: string) => (text.includes("[") ? text.replace(PLACEHOLDER, restoreOne) : text);

  return {
    reserve,
    seed(text, origin) {
      reserve(text);
      for (const match of detectPii(text, detectors)) entryFor(match, origin);
    },
    mask(text, origin = "other") {
      reserve(text);
      let out = "";
      let at = 0;
      for (const match of detectPii(text, detectors)) {
        const entry = entryFor(match, origin);
        entry.sent = true;
        out += text.slice(at, match.start) + entry.placeholder;
        at = match.end;
      }
      return at === 0 ? text : out + text.slice(at);
    },
    restore,
    restorer() {
      let pending = "";
      return {
        push(delta) {
          pending += delta;
          const hold = heldTail(pending);
          const shown = restore(pending.slice(0, pending.length - hold));
          pending = pending.slice(pending.length - hold);
          return shown;
        },
        end() {
          const rest = restore(pending);
          pending = "";
          return rest;
        },
      };
    },
    report() {
      const counts = new Map<string, PiiMaskCount>();
      for (const entry of byKey.values()) {
        if (!entry.sent) continue;
        const id = `${entry.detector}:${entry.origin}`;
        const row = counts.get(id) ?? { detector: entry.detector, origin: entry.origin, count: 0 };
        row.count += 1;
        counts.set(id, row);
      }
      const rank = (row: PiiMaskCount) =>
        PII_DETECTORS.indexOf(row.detector) * PII_ORIGINS.length + PII_ORIGINS.indexOf(row.origin);
      return [...counts.values()].sort((a, b) => rank(a) - rank(b));
    },
  };
}

/**
 * The masker for a Conversation's transcript, the same one however many times
 * it is rebuilt (#1080): every placeholder-shaped literal in it is reserved
 * first, then each message is seeded in order, a Visitor's as `visitor` and
 * anyone else's as `other`. Same messages, same order, same placeholders.
 * That is what lets work after a turn rebuild what the turn never stored.
 */
export function transcriptPiiMasker(
  detectors: readonly PiiDetector[],
  transcript: readonly { role: StoredMessage["role"]; text: string }[],
  options: PiiMaskerOptions = {}
): PiiMasker {
  const masker = createPiiMasker(detectors, options);
  for (const { text } of transcript) masker.reserve(text);
  for (const { role, text } of transcript) masker.seed(text, role === "user" ? "visitor" : "other");
  return masker;
}

/**
 * Length of the tail of `text` that could still grow into a placeholder:
 * from its last `[`, while that reads as `[`, `[EM`, `[EMAIL_` or `[EMAIL_12`.
 * Compared against each whole `[TAG_` head, because a tag may hold an
 * underscore of its own (`CODICE_FISCALE`).
 */
function heldTail(text: string): number {
  const at = text.lastIndexOf("[");
  if (at === -1 || text.length - at >= PLACEHOLDER_MAX) return 0;
  const tail = text.slice(at);
  const couldGrow = TAGS.some((tag) => {
    const head = `[${tag}_`;
    return head.startsWith(tail) || (tail.startsWith(head) && /^\d*$/.test(tail.slice(head.length)));
  });
  return couldGrow ? tail.length : 0;
}

/**
 * "From the Visitor: 1 email address. From knowledge: 1 phone number.": a
 * trace's counts, per origin.
 */
export function piiMaskingOrigins(masked: readonly PiiMaskCount[]): string {
  return PII_ORIGINS.flatMap((origin) => {
    const rows = masked.filter((row) => row.origin === origin);
    return rows.length > 0 ? [`From ${PII_ORIGIN_LABELS[origin]}: ${piiMaskingSummary(rows)}.`] : [];
  }).join(" ");
}

/** "2 email addresses, 1 phone number": a trace's counts, per detector. */
export function piiMaskingSummary(masked: readonly PiiMaskCount[]): string {
  return PII_DETECTORS.flatMap((detector) => {
    const count = masked.filter((row) => row.detector === detector).reduce((sum, row) => sum + row.count, 0);
    if (count === 0) return [];
    const { one, many } = PII_DETECTOR_LABELS[detector].noun;
    return [`${count} ${count === 1 ? one : many}`];
  }).join(", ");
}
