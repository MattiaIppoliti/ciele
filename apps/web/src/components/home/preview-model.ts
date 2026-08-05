/* Pure model behind the marketing hero's live dashboard mock (see
   app-preview.tsx). No React, no DOM — just the mock data, the idle
   view-cycling reducer, and the chart math — so all of it is unit-testable
   through the node vitest harness (preview-model.test.ts). The pane
   components (preview-panes.tsx) and the shell (app-preview.tsx) are thin
   renderers over these values. */

/* ---------------------------------------------------------------- */
/* Views + idle cycling                                              */
/* ---------------------------------------------------------------- */

export type GlobalView =
  | "Assistants"
  | "Help Desks"
  | "Inbox"
  | "Improvements"
  | "Insights";

export type View =
  | { kind: "global"; label: GlobalView }
  | { kind: "setup"; slug: string };

export const GLOBAL_VIEWS: GlobalView[] = [
  "Assistants",
  "Help Desks",
  "Inbox",
  "Improvements",
  "Insights",
];

/* Idle showcase step: advance to the next global view, wrapping around.
   From a setup view (or anywhere non-global) it resumes at the first global
   view. Pure so the cadence logic can be tested without a timer. */
export function nextView(current: View): View {
  const index =
    current.kind === "global" ? GLOBAL_VIEWS.indexOf(current.label) : -1;
  return {
    kind: "global",
    label: GLOBAL_VIEWS[(index + 1) % GLOBAL_VIEWS.length],
  };
}

/* ---------------------------------------------------------------- */
/* Assistants                                                        */
/* ---------------------------------------------------------------- */

export type PreviewAssistant = {
  title: string;
  nickname: string;
  description: string;
  id: string;
  wide?: boolean;
};

export const ASSISTANTS: PreviewAssistant[] = [
  {
    title: "Acme Helpdesk",
    nickname: "Ace",
    description:
      "Front-line IT assistant for Acme employees, resolves access issues, password resets and software questions straight from the internal knowledge base.",
    id: "aK3mPqR7xT2w",
    wide: true,
  },
  {
    title: "HR Buddy",
    nickname: "Hera",
    description:
      "Answers people-ops questions about benefits, leave policies and payroll dates, escalating sensitive cases to the People team.",
    id: "bN8sWvY4jL9c",
  },
  {
    title: "Sales Copilot",
    nickname: "Ping",
    description:
      "Helps prospects compare Acme plans, pricing and integrations, and books demos with the right account executive.",
    id: "cQ5tZxU1mH6d",
  },
  {
    title: "Onboarding Guide",
    nickname: "Scout",
    description:
      "Walks new hires through their first 30 days, accounts, tools, required training and who to ask for what.",
    id: "dR2vAyE9nJ4f",
  },
  {
    title: "Docs Navigator",
    nickname: "Codex",
    description:
      "Surfaces answers from Acme's product documentation and changelogs, with citations back to the source pages.",
    id: "eS7wBzI3kM8g",
  },
  {
    title: "Acme Intranet",
    nickname: "Atlas",
    description:
      "Answers questions from Acme's intranet, company news, internal policies, org charts and workplace services.",
    id: "fT4xCzO6pN1h",
  },
];

/* ---------------------------------------------------------------- */
/* Help Desks                                                        */
/* ---------------------------------------------------------------- */

export const HELP_DESKS = [
  {
    emoji: "🖥️",
    name: "IT Support",
    description:
      "Access issues, software troubleshooting, network support and guidance on Acme's internal digital tools.",
    meta: "3 channels · 6 members",
  },
  {
    emoji: "🧠",
    name: "People Support",
    description:
      "Workplace questions, wellbeing resources and confidential routes to the right internal team.",
    meta: "2 channels · 4 members",
  },
  {
    emoji: "💰",
    name: "Billing",
    description:
      "Invoices, payment methods, plan changes, refunds and account-specific billing questions.",
    meta: "1 channel · 3 members",
  },
  {
    emoji: "📋",
    name: "Onboarding",
    description:
      "Setup, requirements, timelines and launch steps for new customers and partners.",
    meta: "2 channels · 5 members",
  },
];

/* ---------------------------------------------------------------- */
/* Inbox                                                             */
/* ---------------------------------------------------------------- */

export const CONVERSATIONS = [
  {
    who: "j.miller@acme.com",
    snippet: "How do I reset my VPN passphrase from home?",
    time: "12:41",
    assistant: "Acme Helpdesk",
    up: true,
    active: true,
  },
  {
    who: "Anonymous",
    snippet: "What's the difference between the Team and Scale plans?",
    time: "11:58",
    assistant: "Sales Copilot",
    up: true,
  },
  {
    who: "l.chen@acme.com",
    snippet: "When is the payroll cutoff this month?",
    time: "11:12",
    assistant: "HR Buddy",
    up: false,
  },
  {
    who: "Anonymous",
    snippet: "Does the API support webhooks for order events?",
    time: "10:37",
    assistant: "Docs Navigator",
    up: true,
  },
  {
    who: "s.novak@acme.com",
    snippet: "Which trainings are mandatory in my first week?",
    time: "09:20",
    assistant: "Onboarding Guide",
    up: true,
  },
];

/* ---------------------------------------------------------------- */
/* Improvements                                                      */
/* ---------------------------------------------------------------- */

export const IMPROVEMENT_COLUMNS: Array<{
  label: string;
  items: Array<{ title: string; assistant: string; date: string }>;
}> = [
  {
    label: "Pending review",
    items: [
      {
        title: "Clarify VPN reset steps for external contractors",
        assistant: "Acme Helpdesk",
        date: "Jul 17",
      },
      {
        title: "Add pricing FAQ for annual billing",
        assistant: "Sales Copilot",
        date: "Jul 16",
      },
    ],
  },
  {
    label: "Approved",
    items: [
      {
        title: "New answer for parental-leave policy update",
        assistant: "HR Buddy",
        date: "Jul 15",
      },
    ],
  },
  {
    label: "Published",
    items: [
      {
        title: "Webhook payload examples for order events",
        assistant: "Docs Navigator",
        date: "Jul 14",
      },
      {
        title: "Day-one checklist rewrite",
        assistant: "Onboarding Guide",
        date: "Jul 12",
      },
    ],
  },
];

/* ---------------------------------------------------------------- */
/* Insights — stats, bars, line chart, donut                         */
/* ---------------------------------------------------------------- */

export const STATS = [
  { label: "Conversations", value: "1,284", delta: "+12%" },
  { label: "Messages", value: "5,930", delta: "+8%" },
  { label: "Positive feedback", value: "94%", delta: "+2%" },
  { label: "Escalations", value: "37", delta: "−5%" },
];

export const BARS = [42, 55, 48, 70, 64, 82, 76, 90, 71, 88, 95, 84];

/* Line chart — weekly resolved vs escalated, pre-plotted into a 320×120
   viewBox. Twelve points spanning the full width so W1 and W12 sit on the
   chart edges. Grayscale strokes via color-mix keep both themes covered. */
export const LINE_VIEWBOX_H = 120;

export const RESOLVED_PATH =
  "M0,80 L29,72 L58,75 L87,60 L116,64 L145,50 L174,54 L204,40 L233,44 L262,32 L291,30 L320,24";
export const ESCALATED_PATH =
  "M0,102 L29,96 L58,98 L87,92 L116,95 L145,88 L174,90 L204,85 L233,88 L262,82 L291,81 L320,78";

export const INK_STRONG =
  "color-mix(in oklab, var(--foreground) 80%, transparent)";
export const INK_SOFT =
  "color-mix(in oklab, var(--foreground) 35%, transparent)";
// Two area fills at clearly different intensities so the bands read apart.
export const INK_AREA_STRONG =
  "color-mix(in oklab, var(--foreground) 12%, transparent)";
export const INK_AREA_SOFT =
  "color-mix(in oklab, var(--foreground) 5%, transparent)";

/* Map a viewBox y-coordinate to a percentage top for an absolutely-positioned
   end-point dot (the SVG stretches with preserveAspectRatio="none", which
   would squash <circle> elements into ovals). */
export function dotTop(y: number, viewH: number = LINE_VIEWBOX_H): string {
  return `${(y / viewH) * 100}%`;
}

/* End-point dots (percent coords of the 320×120 viewBox). */
export const LINE_DOTS = [
  { left: "0%", top: dotTop(80), ink: INK_STRONG },
  { left: "100%", top: dotTop(24), ink: INK_STRONG },
  { left: "0%", top: dotTop(102), ink: INK_SOFT },
  { left: "100%", top: dotTop(78), ink: INK_SOFT },
];

/* Donut — share of conversations per assistant; stops must sum to 100.
   Grayscale ramp mixed against --background so it adapts to the theme. */
export const donutShade = (pct: number) =>
  `color-mix(in oklab, var(--foreground) ${pct}%, var(--background))`;

export type DonutSegment = { label: string; value: number; color: string };

export const DONUT_SEGMENTS: DonutSegment[] = [
  { label: "Acme Helpdesk", value: 34, color: donutShade(88) },
  { label: "Sales Copilot", value: 22, color: donutShade(70) },
  { label: "HR Buddy", value: 16, color: donutShade(54) },
  { label: "Docs Navigator", value: 12, color: donutShade(40) },
  { label: "Onboarding Guide", value: 9, color: donutShade(27) },
  { label: "Acme Intranet", value: 7, color: donutShade(15) },
];

/* Accumulate segment values into contiguous [from, to] percentage ranges —
   the raw material for a conic-gradient. Pure so the stop math is testable. */
export function donutStops(
  segments: DonutSegment[],
): Array<{ color: string; from: number; to: number }> {
  let acc = 0;
  return segments.map((segment) => {
    const from = acc;
    acc += segment.value;
    return { color: segment.color, from, to: acc };
  });
}

export function buildDonutGradient(segments: DonutSegment[]): string {
  const stops = donutStops(segments).map(
    (stop) => `${stop.color} ${stop.from}% ${stop.to}%`,
  );
  return `conic-gradient(${stops.join(", ")})`;
}

export const DONUT_GRADIENT = buildDonutGradient(DONUT_SEGMENTS);
