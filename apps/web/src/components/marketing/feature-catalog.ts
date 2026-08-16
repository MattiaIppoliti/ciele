import type { GlobalView } from "@/components/home/preview-model";

/* One entry per feature the nav's Features group lists. Each becomes
   /features/<slug>: an eyebrow, a headline, and a picture of the surface it
   describes — either a live pane from the marketing dashboard mock (the five
   org-wide screens it already draws) or a purpose-built mock of the assistant
   editor section. Copy stays inside what ships today. */

export type FeatureShot =
  /** One of the five panes the home-page dashboard mock already renders. */
  | { kind: "pane"; view: GlobalView }
  /** A mock of an assistant-editor section, drawn in feature-mocks.tsx. */
  | { kind: "mock"; mock: "knowledge" | "flows" | "publishing" | "authentication" | "alerts" }
  /** The editor's live Preview playing a scripted conversation on loop. */
  | { kind: "preview" };

export interface FeatureEntry {
  slug: string;
  /** Label in the nav, and the breadcrumb inside the screenshot. */
  label: string;
  /** Small line above the headline — the job this surface does. */
  eyebrow: string;
  headline: string;
  /** One or two sentences under the headline. Sits over the screenshot. */
  standfirst: string;
  shot: FeatureShot;
  /** Three supporting points, shown under the screenshot. */
  points: { title: string; body: string }[];
  /** Page <title>/description. */
  meta: string;
  /** An optional second act: another claim over another picture — a static
   *  mock, or the widget preview playing its scripted conversation on loop. */
  coda?: { eyebrow: string; headline: string; body: string; mock: "kanban" | "preview" };
}

export const FEATURES: FeatureEntry[] = [
  {
    slug: "assistants",
    label: "Assistants",
    eyebrow: "One place",
    headline: "Every assistant in one dashboard",
    standfirst:
      "Create an assistant, give it a name and a job, and edit it beside a live preview of the widget your visitors will see.",
    shot: { kind: "pane", view: "Assistants" },
    meta: "Create, edit and duplicate the assistants your organization runs, each with its own knowledge, flows and channels.",
    points: [
      {
        title: "As many as you need",
        body: "Run one assistant per audience, students, staff, applicants, each with its own knowledge, tone and escalation routes. Duplicate one to start the next.",
      },
      {
        title: "Edited beside its preview",
        body: "Every setting is applied to a live widget next to the form, so you see the welcome message, quick replies and colors exactly as a visitor will.",
      },
      {
        title: "Answers in your voice",
        body: "An answering style guide, a disclaimer and starter buttons shape how the assistant opens a conversation and how it phrases what it knows.",
      },
    ],
    coda: {
      eyebrow: "The live preview",
      headline: "Watch it answer while you edit",
      body: "The editor's preview runs the whole turn in front of you: the flow it matched, the sources it read, the API it queried and the answer it streamed, before any visitor sees it.",
      mock: "preview",
    },
  },
  {
    slug: "knowledge",
    label: "Knowledge",
    eyebrow: "Grounding",
    headline: "Answers from your own content",
    standfirst:
      "Point an assistant at your websites, files and FAQs. It answers from those, and cites the source behind every claim.",
    shot: { kind: "mock", mock: "knowledge" },
    meta: "Connect websites, upload files and curate FAQs. Assistants answer from your organization's content and cite the source.",
    points: [
      {
        title: "Crawled and kept current",
        body: "Add a site and it is crawled, chunked and re-crawled on a schedule. Filters decide which sections are in scope; login-protected pages and linked files can come along.",
      },
      {
        title: "Files and curated FAQs",
        body: "Upload documents, or write question-and-answer pairs when you want an exact reply. Import FAQs in bulk from a CSV and export them the same way.",
      },
      {
        title: "Every answer traceable",
        body: "Retrieval resolves to a concept and the source it came from, so a reviewer can open the page behind any sentence the assistant wrote.",
      },
    ],
  },
  {
    slug: "flows",
    label: "Flows",
    eyebrow: "Routing",
    headline: "Decide what happens, turn by turn",
    standfirst:
      "Flows are the router. Intent classification picks the one that matches, then its actions run in order, no guessing what the model will do.",
    shot: { kind: "mock", mock: "flows" },
    meta: "Route each conversation through an ordered list of flows, with verbatim messages, retrieval, API calls, escalation and handover as actions.",
    points: [
      {
        title: "Triggered by more than a message",
        body: "A flow can fire on a message, on page load, after a dwell time, or when the chat opens. Proactive triggers deliver a notification without calling the model at all.",
      },
      {
        title: "Conditions before classification",
        body: "URL and schedule conditions are hard gates: a flow that should only run on the admissions pages, or only during office hours, never even enters the classifier.",
      },
      {
        title: "Actions you compose",
        body: "Send a verbatim message, search knowledge with citations, call an API, email someone, open an iframe, flag an improvement or hand over to a help desk, in the order you set.",
      },
    ],
  },
  {
    slug: "help-desks",
    label: "Help desks",
    eyebrow: "Escalation",
    headline: "A way through to a human",
    standfirst:
      "When the assistant cannot answer, it offers the right desk, with the channel, the form and the opening hours you configured.",
    shot: { kind: "pane", view: "Help Desks" },
    meta: "Organization-level help desks with email, phone, live chat, ticketing and API channels, each with its own form and availability.",
    points: [
      {
        title: "Channels per desk",
        body: "Email, phone, live chat, an external link, a ticket in your service desk, or an API endpoint. Each channel carries its own name, the label a visitor actually taps.",
      },
      {
        title: "Forms that arrive filled in",
        body: "Build the form field by field, and attach the chat summary, full transcript or session details, so whoever picks it up already has the context.",
      },
      {
        title: "Open when you are",
        body: "Set weekly hours and special dates per channel. Outside them the desk steps back rather than promising a reply nobody will send.",
      },
    ],
  },
  {
    slug: "publishing",
    label: "Publishing",
    eyebrow: "Distribution",
    headline: "One assistant, every channel",
    standfirst:
      "Publish to your website as a floating launcher, embed it in a page, or open it in its own window. Same assistant, one snippet each.",
    shot: { kind: "mock", mock: "publishing" },
    meta: "Publish an assistant to your website as a launcher, an iframe embed or a pop-up window, from one snippet per channel.",
    points: [
      {
        title: "Copy one snippet",
        body: "Each channel gives you the exact markup to paste, a script for the launcher, an iframe for an in-page embed, already carrying the assistant's id.",
      },
      {
        title: "Publishing is a snapshot",
        body: "What visitors get is the published version, not your draft. Keep editing; the widget changes when you publish again.",
      },
      {
        title: "Native wherever it lands",
        body: "Colors, launcher icon, corner, size and typography are yours to set, so the widget reads as part of the page rather than a bolted-on box.",
      },
    ],
  },
  {
    slug: "inbox",
    label: "Inbox",
    eyebrow: "Review",
    headline: "Read what your assistants said",
    standfirst:
      "Every conversation, end to end: which flow handled each turn, which sources the answer cited, and how the visitor rated it.",
    shot: { kind: "pane", view: "Inbox" },
    meta: "Review every conversation with workflow markers, citations, ratings, session context and escalation status.",
    points: [
      {
        title: "The whole turn, not the summary",
        body: "Workflow markers show which flow answered; sources sit under the answer; tool calls and their results are inspectable where the runtime used them.",
      },
      {
        title: "Session context beside it",
        body: "Launch URL, browser, language and location sit in the side rail, enough to understand why an answer landed the way it did.",
      },
      {
        title: "Take it with you",
        body: "Export a single transcript as a PDF, or the full message-level record as JSON when someone needs the data rather than the reading.",
      },
    ],
  },
  {
    slug: "improvements",
    label: "Improvements",
    eyebrow: "Quality",
    headline: "Bad answers become tracked work",
    standfirst:
      "Flag an answer from the Inbox, or let an escalation raise one for you. Each item lands on a board with an owner and a priority.",
    shot: { kind: "pane", view: "Improvements" },
    meta: "A board for answer quality: items raised from the Inbox or automatically on escalation, triaged with owners and priorities.",
    points: [
      {
        title: "Raised where you noticed it",
        body: "Flag the answer while you are reading it and the item keeps the message, its sources and the link back to the conversation.",
      },
      {
        title: "Raised for you on escalation",
        body: "When a desk has auto-generate switched on, the last AI answer before a visitor asked for a human becomes an item, the moments most worth fixing.",
      },
      {
        title: "Triaged like any other work",
        body: "Lanes, priorities, tags, assignees and occurrence counts, so the answer ten people hit gets fixed before the one that happened once.",
      },
    ],
    coda: {
      eyebrow: "On the card",
      headline: "Every item keeps its context",
      body: "Status, priority and owner sit on the card, and the answer that raised it travels with it — from flagged to done without losing the conversation behind it.",
      mock: "kanban",
    },
  },
  {
    slug: "insights",
    label: "Insights",
    eyebrow: "Measurement",
    headline: "Know how the answers are landing",
    standfirst:
      "Resolution rate, ratings, escalations, languages and volume, over any window, filtered to the assistants you care about.",
    shot: { kind: "pane", view: "Insights" },
    meta: "Track resolution rate, answer ratings, escalations, languages and conversation volume across your assistants.",
    points: [
      {
        title: "The numbers that decide something",
        body: "Resolution rate and ratings tell you whether to change an answer; escalations and volume tell you where the pressure is.",
      },
      {
        title: "Counted honestly",
        body: "A conversation that only received a proactive notification is not counted as an answered question. Notifications are their own number.",
      },
      {
        title: "Out of the dashboard",
        body: "Export the underlying rows when the reporting has to happen somewhere else.",
      },
    ],
    coda: {
      eyebrow: "From number to fix",
      headline: "A rating is the start of the work",
      body: "Every metric here points at conversations, and a bad one becomes a card on the Improvements board, status, priority, owner, and the answer that caused it.",
      mock: "kanban",
    },
  },
  {
    slug: "authentication",
    label: "Authentication",
    eyebrow: "Identity",
    headline: "Answers for a known visitor",
    standfirst:
      "Put the chat behind your identity provider, and let the assistant use what it then knows about the person asking.",
    shot: { kind: "mock", mock: "authentication" },
    meta: "Connect an identity provider so the assistant knows who is asking, and personalize answers from imported user data.",
    points: [
      {
        title: "Sign in first",
        body: "Connect an OIDC provider and the widget asks the visitor to connect their account before it answers anything account-specific.",
      },
      {
        title: "Roles that change the answer",
        body: "Groups and roles from your provider are conditions a flow can gate on, so staff and students do not get the same reply to the same question.",
      },
      {
        title: "Fields you can address",
        body: "Imported user data becomes fields the assistant can use by name, so a message can greet someone properly instead of guessing.",
      },
    ],
  },
  {
    slug: "alerts",
    label: "Alerts",
    eyebrow: "Operations",
    headline: "You hear when something breaks",
    standfirst:
      "An integration whose credentials stop working raises an alert, and clears it once the connection recovers. No silent decay.",
    shot: { kind: "mock", mock: "alerts" },
    meta: "Operational alerts for integrations that stop working, resolved automatically when the connection recovers.",
    points: [
      {
        title: "Raised by the system",
        body: "A crawl that fails, a credential that expires, the platform notices and files it, rather than leaving the assistant to answer from stale knowledge.",
      },
      {
        title: "Cleared by the fix",
        body: "When the next run succeeds the alert resolves itself. The ones left standing are the ones that still need a person.",
      },
      {
        title: "Visible from anywhere",
        body: "The count sits in the sidebar, so an unhealthy integration is not something you have to go looking for.",
      },
    ],
  },
];

export function findFeature(slug: string): FeatureEntry | undefined {
  return FEATURES.find((feature) => feature.slug === slug);
}
