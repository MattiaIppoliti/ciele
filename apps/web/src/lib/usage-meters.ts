import { USAGE_RESOURCES, type UsageResource } from "@agent-hub/core";
import {
  USAGE_WARN_FRACTION,
  type UsageLimitsSnapshot,
  type UsageMeterSnapshot,
  type UsageWindowName,
} from "@agent-hub/agent";

/**
 * Turns a plan's meters into what the Usage page draws (#509).
 *
 * Everything here is a pure function of (snapshot, now): the app's vitest only
 * collects `.test.ts`, so logic that lives in the page component cannot be
 * tested at all. The thresholds come from the shared `USAGE_WARN_FRACTION`, so a
 * ring turns amber at exactly the point the enterprise ladder raises its Alert —
 * an admin who got the email and then opens this page sees the same story.
 */

/** How a meter reads: calm, near its cap, or at/over it. */
export type MeterTone = "ok" | "warn" | "over";

export interface MeterRingView {
  /**
   * The plan window this ring measures, or null for a ring that is not a plan
   * window at all (the admin-set daily budget borrows the shape).
   */
  window: UsageWindowName | null;
  /** "This week" / "This billing period". */
  label: string;
  /** 0..1 for the gauge; always 0 when uncapped, which draws an empty ring. */
  fraction: number;
  percentLabel: string;
  tone: MeterTone;
  usedLabel: string;
  capLabel: string;
  /** "Resets in 4 days · 15 Jul 00:00 UTC". */
  resetLabel: string;
  uncapped: boolean;
}

export interface MeterCardView {
  resource: UsageResource;
  title: string;
  description: string;
  rings: MeterRingView[];
  /** The worst tone across the card's windows — what the card colours by. */
  tone: MeterTone;
  /** The percentage of the tightest window, shown inside the gauge. */
  leadPercent: string;
}

export interface MeterTotalView {
  usedLabel: string;
  capLabel: string;
  fraction: number;
  percentLabel: string;
  uncapped: boolean;
  /** True when some resource is uncapped and so absent from the total. */
  partial: boolean;
}

export interface UsageLimitsView {
  plan: string;
  cards: MeterCardView[];
  /** The plan as one number: this period's credits across all three meters. */
  total: MeterTotalView;
  /**
   * Every meter is uncapped — a staff exemption, or billing data too stale to
   * enforce against. Zeroed rings under "each meter is capped" copy would be a
   * lie, so the page says so in words instead.
   */
  allUncapped: boolean;
}

const RESOURCE_COPY: Record<
  UsageResource,
  { title: string; description: string }
> = {
  ai: {
    title: "AI",
    description: "Intent routing, answers, and scheduled AI work",
  },
  embedding: {
    title: "Embeddings",
    description: "Knowledge indexing and vector search queries",
  },
  scraping: {
    title: "Scraping",
    description: "Pages fetched when a Website Source is crawled",
  },
};

const WINDOW_COPY: Record<UsageWindowName, string> = {
  week: "This week",
  month: "This billing period",
};

const WINDOW_ORDER: UsageWindowName[] = ["week", "month"];

const NO_LIMIT = "no limit";

const formatNumber = (value: number): string =>
  Math.round(value).toLocaleString("en-US");

/**
 * How full a meter is. A zero cap is full by construction — the same rule the
 * enforcement ladder uses, so the page and the gate agree about a cap that has
 * been set to nothing.
 */
function fractionOf(cap: number | null, used: number): number {
  if (cap === null) return 0;
  if (cap === 0) return 1;
  return used / cap;
}

function toneOf(fraction: number, uncapped: boolean): MeterTone {
  if (uncapped) return "ok";
  if (fraction >= 1) return "over";
  if (fraction >= USAGE_WARN_FRACTION) return "warn";
  return "ok";
}

const WORST: Record<MeterTone, number> = { ok: 0, warn: 1, over: 2 };

function worstTone(tones: readonly MeterTone[]): MeterTone {
  return tones.reduce<MeterTone>(
    (worst, tone) => (WORST[tone] > WORST[worst] ? tone : worst),
    "ok"
  );
}

/**
 * The window CLOSEST TO ITS CAP: the one that decides whether this meter stops
 * next, whichever window it happens to be. One definition, used by the Usage
 * page's gauge and by Billing's glance row, so the two always lead with the same
 * window.
 */
function leadRing(rings: readonly MeterRingView[]): MeterRingView | null {
  return rings.reduce<MeterRingView | null>(
    (worst, ring) => (worst && worst.fraction >= ring.fraction ? worst : ring),
    null
  );
}

const percentLabel = (fraction: number): string =>
  `${Math.min(Math.round(fraction * 100), 999)}%`;

/**
 * When a window reopens, as both a distance and an instant: the distance is what
 * an admin reads, the instant is what they can plan around. UTC because every
 * window in the product is measured in UTC — a local time here would be a
 * different number from the one in the Alert.
 */
export function resetLabel(to: string, now: string): string {
  const ms = Date.parse(to) - Date.parse(now);
  const stamp = new Date(Date.parse(to)).toLocaleString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // A window whose end has passed rolls over on the next request; a negative
  // countdown would read as a bug rather than as "any moment now".
  if (ms <= 0) return "Resets now";
  // Floor, not round: a countdown must never overstate the wait. Four and a
  // half days is "in 4 days" — saying 5 would send an admin away for longer
  // than the window actually needs.
  const plural = (n: number, unit: string) =>
    `Resets in ${n} ${unit}${n === 1 ? "" : "s"} · ${stamp} UTC`;
  if (ms < 3_600_000) return plural(Math.floor(ms / 60_000), "minute");
  if (ms < 86_400_000) return plural(Math.floor(ms / 3_600_000), "hour");
  return plural(Math.floor(ms / 86_400_000), "day");
}

function ringView(meter: UsageMeterSnapshot, now: string): MeterRingView {
  const uncapped = meter.cap === null;
  const fraction = fractionOf(meter.cap, meter.usedCredits);
  return {
    window: meter.window.name,
    label: WINDOW_COPY[meter.window.name],
    fraction: uncapped ? 0 : fraction,
    percentLabel: uncapped ? "—" : percentLabel(fraction),
    tone: toneOf(fraction, uncapped),
    usedLabel: formatNumber(meter.usedCredits),
    capLabel: uncapped ? NO_LIMIT : formatNumber(meter.cap ?? 0),
    resetLabel: resetLabel(meter.window.to, now),
    uncapped,
  };
}

/** The view model for the whole limits block. */
export function usageLimitsView(
  snapshot: UsageLimitsSnapshot,
  now: string
): UsageLimitsView {
  const cards = USAGE_RESOURCES.map((resource) => {
    const rings = WINDOW_ORDER.flatMap((window) => {
      const meter = snapshot.meters.find(
        (m) => m.resource === resource && m.window.name === window
      );
      return meter ? [ringView(meter, now)] : [];
    });
    const lead = leadRing(rings);
    return {
      resource,
      ...RESOURCE_COPY[resource],
      rings,
      tone: worstTone(rings.map((r) => r.tone)),
      leadPercent: lead ? lead.percentLabel : "—",
    };
  });

  // The plan as one number is the PERIOD's credits — mixing the weekly ceilings
  // in would count the same work twice. Only CAPPED resources go in: adding an
  // uncapped resource's usage to a denominator it is not part of would overstate
  // the percentage, sometimes wildly.
  const monthly = snapshot.meters.filter((m) => m.window.name === "month");
  const capped = monthly.filter((m) => m.cap !== null);
  const uncapped = monthly.length > 0 && capped.length === 0;
  const used = capped.reduce((sum, m) => sum + m.usedCredits, 0);
  const cap = capped.reduce((sum, m) => sum + (m.cap ?? 0), 0);
  const totalFraction = cap === 0 ? 0 : used / cap;
  return {
    plan: snapshot.plan,
    cards,
    allUncapped:
      snapshot.meters.length > 0 && snapshot.meters.every((m) => m.cap === null),
    total: {
      usedLabel: formatNumber(used),
      capLabel: uncapped ? NO_LIMIT : formatNumber(cap),
      fraction: totalFraction,
      percentLabel: uncapped ? "—" : percentLabel(totalFraction),
      // Deliberately no tone: no cap exists on the sum of the three meters, so
      // colouring this amber would warn about a limit that cannot be reached.
      uncapped,
      partial: capped.length > 0 && capped.length < monthly.length,
    },
  };
}

/** One meter compressed to a single line, for a surface that is not Usage. */
export interface MeterGlanceRow {
  resource: UsageResource;
  title: string;
  /** The window that decides whether this meter stops next. */
  windowLabel: string;
  fraction: number;
  percentLabel: string;
  tone: MeterTone;
  /** "1,120 / 1,400 credits", or "no limit". */
  detail: string;
  uncapped: boolean;
}

/**
 * The plan's meters at a glance (#511) — what Billing shows so an admin can see
 * whether the plan still fits before deciding to move up, without leaving for
 * the Usage page.
 *
 * A projection of `usageLimitsView`, not a second computation: same thresholds,
 * same tightest-window rule, same numbers. A resource with no recorded window is
 * dropped rather than drawn as an empty ring — Billing is a summary, and a row
 * that says nothing costs a reader more than its absence.
 */
export function planGlanceRows(view: UsageLimitsView): MeterGlanceRow[] {
  return view.cards.flatMap((card) => {
    const lead = leadRing(card.rings);
    if (!lead) return [];
    return [
      {
        resource: card.resource,
        title: card.title,
        windowLabel: lead.label,
        fraction: lead.fraction,
        percentLabel: lead.percentLabel,
        tone: lead.tone,
        detail: lead.uncapped
          ? NO_LIMIT
          : `${lead.usedLabel} / ${lead.capLabel} credits`,
        uncapped: lead.uncapped,
      },
    ];
  });
}

/**
 * The admin-set daily budget, in the same shape as a plan meter so the page can
 * draw it with the same gauge. Null when no budget is configured — every limit
 * that can pause an assistant belongs in one block, but an absent one is not a
 * limit.
 */
export function budgetMeterView(input: {
  tokenLimit: number | null;
  euroLimit: number | null;
  usedTokens: number;
  usedEur: number;
}): { rings: MeterRingView[]; tone: MeterTone } | null {
  const rings: MeterRingView[] = [];
  const add = (input_: {
    label: string;
    cap: number;
    used: number;
    /** Explicit, rather than sniffed from the label: renaming copy must not
        change how a number is formatted. */
    unit: "tokens" | "euro";
  }) => {
    const money = input_.unit === "euro";
    rings.push({
      // A daily budget is neither plan window; it borrows the ring shape only.
      window: null,
      label: input_.label,
      fraction: fractionOf(input_.cap, input_.used),
      percentLabel: percentLabel(fractionOf(input_.cap, input_.used)),
      tone: toneOf(fractionOf(input_.cap, input_.used), false),
      usedLabel: money ? `€${input_.used.toFixed(2)}` : formatNumber(input_.used),
      capLabel: money ? `€${input_.cap}` : formatNumber(input_.cap),
      resetLabel: "Resets at 00:00 UTC",
      uncapped: false,
    });
  };
  if (input.tokenLimit != null) {
    add({
      label: "Daily tokens",
      cap: input.tokenLimit,
      used: input.usedTokens,
      unit: "tokens",
    });
  }
  if (input.euroLimit != null) {
    add({
      label: "Daily euro estimate",
      cap: input.euroLimit,
      used: input.usedEur,
      unit: "euro",
    });
  }
  if (rings.length === 0) return null;
  return { rings, tone: worstTone(rings.map((r) => r.tone)) };
}

/** Tailwind stroke classes per tone, so the gauge and the text agree. */
export const TONE_STROKE: Record<MeterTone, string> = {
  ok: "stroke-emerald-500",
  warn: "stroke-amber-500",
  over: "stroke-red-500",
};

/** Tailwind text classes per tone. */
export const TONE_TEXT: Record<MeterTone, string> = {
  ok: "text-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  over: "text-red-600 dark:text-red-500",
};
