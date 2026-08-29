"use client";

import { useState } from "react";
import type { ApplicationProvider } from "@agent-hub/core";
import { APP_BRANDS, AppBrandMark } from "@/components/ui/app-brand";
import {
  Bell,
  BookText,
  Check,
  ChevronDown,
  CircleAlert,
  CloudUpload,
  Code2,
  Globe,
  GripVertical,
  Lock,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/section-heading";

/* Mocks of the assistant-editor sections the dashboard mock does not draw
   (it sends every SETUP section to the same "choose an assistant" picker).
   These are pictures, not products: no data, no links, no real actions,
   the same components and tokens as the real screens, so what a visitor sees
   here is what they get inside the app. The Knowledge mock is the one
   exception to "nothing clickable": its tabs switch between the three source
   views, because switching views is the screen's whole idea. */

function PaneHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <SectionHeading
        variant="mock"
        headingLevel={3}
        icon={icon}
        title={title}
        description={description}
      />
      {action && (
        <span className="bg-primary text-primary-foreground mt-1 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium">
          <Plus className="size-3.5" />
          {action}
        </span>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm">
      {children}
    </div>
  );
}

function Pill({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn"; children: React.ReactNode }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

const KNOWLEDGE_TABS = [
  { id: "websites", label: "Websites" },
  { id: "applications", label: "Applications" },
  { id: "documents", label: "Documents" },
  { id: "faqs", label: "FAQs" },
] as const;

type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number]["id"];

const WEBSITES = [
  { name: "acme.com", url: "https://acme.com", pages: "412 pages", cadence: "Weekly", state: "Ready", tone: "ok" as const },
  { name: "help.acme.com", url: "https://help.acme.com", pages: "96 pages", cadence: "Weekly", state: "Re-crawling", tone: "warn" as const },
];

/* The five providers that actually connect today, read from the same registry
   the console reads, so this shot cannot claim an integration that does not
   exist or miss one that does. Status lines are fixtures. */
const APPLICATIONS: {
  provider: ApplicationProvider;
  scope: string;
  items: string;
  state: string;
  tone: "ok" | "warn";
}[] = [
  { provider: "salesforce", scope: "Knowledge articles", items: "1,240 articles", state: "Ready", tone: "ok" },
  { provider: "servicenow", scope: "Knowledge Management", items: "318 articles", state: "Ready", tone: "ok" },
  { provider: "slack", scope: "#support, #product", items: "2 channels", state: "Syncing", tone: "warn" },
  { provider: "onedrive", scope: "Handbook folder", items: "64 files", state: "Ready", tone: "ok" },
  { provider: "google_drive", scope: "My Drive", items: "129 files", state: "Ready", tone: "ok" },
];

const FAQS = [
  { question: "What is Acme?", answer: "Acme is a software company building tools for support teams." },
  { question: "How do I reset my password?", answer: "Use the “Forgot password” link on the sign-in page." },
];

function MockSearch({ placeholder }: { placeholder: string }) {
  return (
    <div className="text-muted-foreground bg-card flex h-8 items-center gap-2 rounded-lg border px-3 text-xs">
      <Search className="size-3.5 shrink-0" />
      {placeholder}
    </div>
  );
}

function RowActions() {
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-2.5">
      <RefreshCw className="size-3.5" />
      <Pencil className="size-3.5" />
      <Trash2 className="size-3.5" />
    </span>
  );
}

function KnowledgeWebsites() {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            Websites <Pill>{WEBSITES.length}</Pill>
          </span>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            Sites the assistant crawls, indexes and answers from.
          </p>
        </div>
        <span className="bg-primary text-primary-foreground flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium">
          <Plus className="size-3.5" /> Add
        </span>
      </div>
      <MockSearch placeholder="Search websites" />
      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-3.5 py-2 text-[11px] font-semibold">
          <span>Name</span>
          <span>Status</span>
          <span>Content</span>
          <span>Re-crawl</span>
          <span className="w-14" />
        </div>
        {WEBSITES.map((site) => (
          <div
            key={site.name}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-t px-3.5 py-2.5 text-sm"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-medium">
                <Globe className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{site.name}</span>
              </span>
              <span className="text-muted-foreground ml-6 block truncate text-xs">{site.url}</span>
            </span>
            <Pill tone={site.tone}>{site.state}</Pill>
            <span className="text-muted-foreground text-xs">{site.pages}</span>
            <span className="text-muted-foreground flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              {site.cadence} <ChevronDown className="size-3" />
            </span>
            <RowActions />
          </div>
        ))}
      </div>
    </>
  );
}

function KnowledgeApplications() {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            Applications <Pill>{APPLICATIONS.length}</Pill>
          </span>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            Tools the assistant imports from, on your account&apos;s own permissions.
          </p>
        </div>
        <span className="bg-primary text-primary-foreground flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium">
          <Plus className="size-3.5" /> Connect
        </span>
      </div>
      {/* A grid rather than the table the other tabs use. Five providers is one
          row too many for the window's height, and the point of this panel is
          *which* tools connect, which a wall of tiles says at a glance and a
          clipped table does not. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {APPLICATIONS.map((app) => {
          const brand = APP_BRANDS[app.provider];
          return (
            <div
              key={app.provider}
              className="bg-card flex flex-col gap-2 rounded-xl border p-3"
            >
              <div className="flex items-center gap-2">
                <AppBrandMark provider={app.provider} size="size-7" />
                <span className="min-w-0 truncate text-xs font-semibold">
                  {brand.label}
                </span>
              </div>
              <span className="text-muted-foreground truncate text-[11px]">
                {app.scope}
              </span>
              <div className="flex items-center justify-between gap-2">
                <Pill tone={app.tone}>{app.state}</Pill>
                <span className="text-muted-foreground truncate text-[11px]">
                  {app.items}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function KnowledgeDocuments() {
  return (
    <>
      <p className="text-muted-foreground text-xs">
        Upload files to add to your assistant&apos;s knowledge base. The
        assistant will use these to answer questions.
      </p>
      <MockSearch placeholder="Search documents" />
      <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center">
        <span className="bg-muted flex size-10 items-center justify-center rounded-full border">
          <CloudUpload className="text-muted-foreground size-4" />
        </span>
        <span className="text-sm font-medium">Drop files here or browse</span>
        <span className="text-muted-foreground text-xs">
          PDF, Word (.docx), Markdown, text · up to 25 MB
        </span>
        <span className="bg-card mt-1 rounded-lg border px-3.5 py-1.5 text-xs font-medium">
          Browse
        </span>
      </div>
    </>
  );
}

function KnowledgeFaqs() {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            Questions and Answers <Pill>{FAQS.length}</Pill>
          </span>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            Add sets of questions and answers to fine tune AI responses.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span className="bg-card rounded-lg border px-3 py-1.5 text-xs font-medium">Export</span>
          <span className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium">
            <Plus className="size-3.5" /> New FAQ <ChevronDown className="size-3.5" />
          </span>
        </span>
      </div>
      <MockSearch placeholder="Search FAQs" />
      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_1.2fr_auto_auto] items-center gap-4 px-3.5 py-2 text-[11px] font-semibold">
          <span>Question</span>
          <span>Answer</span>
          <span>Status</span>
          <span className="w-8" />
        </div>
        {FAQS.map((faq) => (
          <div
            key={faq.question}
            className="grid grid-cols-[1fr_1.2fr_auto_auto] items-center gap-4 border-t px-3.5 py-2.5 text-sm"
          >
            <span className="truncate font-medium">{faq.question}</span>
            <span className="text-muted-foreground truncate text-xs">{faq.answer}</span>
            <Pill tone="ok">Ready</Pill>
            <span className="text-muted-foreground flex shrink-0 items-center gap-2.5">
              <Pencil className="size-3.5" />
              <Trash2 className="size-3.5" />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export function KnowledgeMock() {
  const [tab, setTab] = useState<KnowledgeTab>("websites");

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PaneHeader
        icon={BookText}
        title="Knowledge"
        description="Websites, applications, documents and FAQs indexed for retrieval."
      />

      <div className="bg-muted/60 inline-flex w-fit rounded-xl border p-1">
        {KNOWLEDGE_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "rounded-lg px-3.5 py-1 text-xs font-medium transition-colors",
              tab === entry.id
                ? "text-primary bg-primary/10 shadow-xs dark:bg-primary/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "websites" && <KnowledgeWebsites />}
      {tab === "applications" && <KnowledgeApplications />}
      {tab === "documents" && <KnowledgeDocuments />}
      {tab === "faqs" && <KnowledgeFaqs />}

      <div className="text-muted-foreground border-border mt-auto flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs">
        <BookText className="size-4" />
        Answers cite the source they came from.
      </div>
    </div>
  );
}

const FLOWS = [
  {
    name: "Basic Interaction",
    badge: "Built-in",
    description:
      "User is greeting the assistant, thanking it, saying goodbye, or acknowledging an answer.",
    actions: ["Basic reply"],
    enabled: true,
  },
  {
    name: "Human Help Needed",
    badge: "Built-in",
    description:
      "User explicitly asks for human help, support, or escalation to a person.",
    actions: ["Search knowledge", "Message", "Suggest help desk"],
    enabled: true,
  },
  {
    name: "Assistant Information",
    badge: "Built-in",
    description:
      "User is asking about the assistant's capabilities, identity, purpose, or services.",
    actions: ["Message"],
    enabled: false,
  },
];

export function FlowsMock() {
  return (
    <div className="flex h-full flex-col p-5 sm:p-6">
      <SectionHeading
        variant="mock"
        headingLevel={3}
        icon={Workflow}
        title="Flows"
        description="Drag flows to set priority. The first matching flow wins."
      />

      <div className="mt-4 flex justify-end">
        <span className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium">
          <Plus className="size-3.5" /> New flow
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {FLOWS.map((flow) => (
          <div
            key={flow.name}
            className="bg-card flex items-start gap-2 rounded-xl border px-2.5 py-3 text-sm shadow-xs"
          >
            <GripVertical className="text-muted-foreground/60 mt-1 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold">{flow.name}</span>
                <Pill>{flow.badge}</Pill>
                <Pill>User sends a message</Pill>
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {flow.description}
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {flow.actions.map((action) => (
                  <span
                    key={action}
                    className="text-foreground/75 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {action}
                  </span>
                ))}
              </span>
            </span>
            <Pencil className="text-muted-foreground mt-1 size-3.5 shrink-0" />
            <span
              className={cn(
                "relative mt-0.5 h-5 w-9 shrink-0 rounded-full",
                flow.enabled ? "bg-foreground" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "bg-background absolute top-0.5 size-4 rounded-full shadow-sm",
                  flow.enabled ? "right-0.5" : "left-0.5"
                )}
              />
            </span>
          </div>
        ))}

        <div className="text-muted-foreground flex items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-xs font-medium">
          <Plus className="size-3.5" /> Create new flow
        </div>

        <div className="bg-card flex items-start gap-2 rounded-xl border px-3 py-3 text-sm shadow-xs">
          <Lock className="text-muted-foreground mt-1 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold">Default behavior</span>
              <Pill>Always last</Pill>
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              No other flow matches the user query
            </span>
            <span className="mt-2 inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
              Search knowledge
            </span>
          </span>
          <Pencil className="text-muted-foreground mt-1 size-3.5 shrink-0" />
        </div>
      </div>
    </div>
  );
}

const CHANNELS = [
  { icon: Code2, name: "Website launcher", meta: "Floating button, bottom right", state: "Live" },
  { icon: SquareArrowOutUpRight, name: "Pop-up window", meta: "Opens the chat in its own window", state: "Live" },
  { icon: Globe, name: "iFrame embed", meta: "Inline, sized by the host page", state: "Ready" },
];

export function PublishingMock() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PaneHeader
        icon={Plane}
        title="Publish"
        description="Publish a snapshot to every live channel."
        action="Publish"
      />
      <div className="flex flex-col gap-2">
        {CHANNELS.map(({ icon: Icon, name, meta, state }) => (
          <Row key={name}>
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border">
              <Icon className="text-muted-foreground size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{name}</span>
              <span className="text-muted-foreground block truncate text-xs">{meta}</span>
            </span>
            <Pill tone={state === "Live" ? "ok" : "muted"}>{state}</Pill>
          </Row>
        ))}
      </div>
      <pre className="bg-muted/60 text-muted-foreground mt-auto overflow-hidden rounded-xl border p-3 font-mono text-[11px] leading-relaxed">
        {`<script src="https://cdn.ciele.app/launcher.js"
  data-assistant="aK3mPqR7xT2w" defer></script>`}
      </pre>
    </div>
  );
}

const FIELDS = [
  { name: "user.name", example: "Giulia Ferrari" },
  { name: "user.role", example: "Student" },
  { name: "user.programme", example: "MSc Management" },
  { name: "user.year", example: "2" },
];

export function AuthenticationMock() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PaneHeader
        icon={Lock}
        title="Authentication"
        description="Require visitors to sign in before they can chat."
      />
      <div className="bg-card flex items-center gap-3 rounded-xl border p-4">
        <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg border">
          <Lock className="text-muted-foreground size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Identity provider</span>
          <span className="text-muted-foreground block text-xs">
            Visitors sign in before the assistant answers anything account-specific.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Check className="size-3.5 text-emerald-500" />
          <Pill tone="ok">Connected</Pill>
        </span>
      </div>

      <div className="bg-card rounded-xl border">
        <div className="text-muted-foreground border-b px-3.5 py-2 text-xs font-medium">
          User data fields
        </div>
        {FIELDS.map((field) => (
          <div
            key={field.name}
            className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 text-sm last:border-b-0"
          >
            <span className="text-muted-foreground font-mono text-xs">
              {`{{${field.name}}}`}
            </span>
            <span className="truncate">{field.example}</span>
          </div>
        ))}
      </div>

      <div className="text-muted-foreground border-border mt-auto flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs">
        <Sparkles className="size-4" />
        Flows can gate on the role your provider returns.
      </div>
    </div>
  );
}

const BOARD = [
  {
    lane: "In review",
    title: "Clarify VPN reset for contractors",
    id: "IMP-31",
    status: "In review",
    dot: "bg-emerald-500",
    priority: "Low",
    owner: "Adrien",
    tag: "Acme Helpdesk",
  },
  {
    lane: "In progress",
    title: "Add annual billing to the pricing FAQ",
    id: "IMP-28",
    status: "In progress",
    dot: "bg-amber-500",
    priority: "Medium",
    owner: "Alex",
    tag: "Sales Copilot",
  },
  {
    lane: "Done",
    title: "Rewrite the day-one checklist answer",
    id: "IMP-24",
    status: "Done",
    dot: "bg-indigo-500",
    priority: "High",
    owner: "Yann",
    tag: "Onboarding Guide",
  },
];

/** Three board cards, overlapped around the centre and stepping down as they
 *  go, dissolving at both edges: a board that carries on past the frame. */
export function KanbanMock() {
  return (
    <div
      className="relative h-[330px] overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to right, transparent 0%, black 20%, black 80%, transparent 100%), linear-gradient(to bottom, black 58%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, black 20%, black 80%, transparent 100%), linear-gradient(to bottom, black 58%, transparent 100%)",
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      {BOARD.map((card, index) => (
        <div
          key={card.id}
          className="bg-card absolute left-1/2 w-64 rounded-2xl border p-4 shadow-xl shadow-black/10 dark:shadow-black/40"
          style={{
            // Centred on the middle card, the other two stepping out and down.
            transform: `translateX(calc(-50% + ${(index - 1) * 15}rem))`,
            top: `${20 + index * 16}px`,
            zIndex: 3 - index,
          }}
        >
          <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {card.lane}
          </span>
          <p className="mt-1.5 text-sm font-medium leading-snug">{card.title}</p>

          <span className="text-muted-foreground mt-4 block text-[11px] font-medium uppercase tracking-wide">
            Properties
          </span>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${card.dot}`} />
              {card.status}
            </span>
            <span className="text-muted-foreground flex items-center gap-2">
              <span className="flex items-end gap-0.5" aria-hidden>
                <span className="bg-muted-foreground/50 block h-1.5 w-0.5 rounded-sm" />
                <span className="bg-muted-foreground/50 block h-2.5 w-0.5 rounded-sm" />
                <span className="bg-muted-foreground/25 block h-3.5 w-0.5 rounded-sm" />
              </span>
              {card.priority}
            </span>
            <span className="text-muted-foreground flex items-center gap-2">
              <span className="bg-muted size-4 rounded-full border" />
              {card.owner}
            </span>
            <span className="text-muted-foreground/70 flex items-center gap-2 pl-5 text-xs">
              {card.tag}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const ALERTS = [
  {
    title: "Crawl failed for help.acme.edu",
    detail: "The last three runs returned 403. Knowledge is serving the previous index.",
    detected: "2h ago",
    state: "Needs attention" as const,
  },
  {
    title: "ServiceNow credentials rejected",
    detail: "Ticket creation from the IT Support desk is failing.",
    detected: "Yesterday",
    state: "Needs attention" as const,
  },
  {
    title: "Crawl failed for acme.edu/admissions",
    detail: "Recovered on the next scheduled run.",
    detected: "Jul 14",
    state: "Resolved" as const,
  },
];

export function AlertsMock() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <SectionHeading
          variant="mock"
          headingLevel={3}
          icon={Bell}
          title="Alerts"
          description="Failures and recoveries that need your attention."
        />
        <span className="bg-destructive flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white">
          2
        </span>
        <span className="text-muted-foreground ml-auto mt-1 flex gap-3 text-xs">
          <span className="text-foreground font-medium">Needs attention</span>
          <span>Resolved</span>
          <span>All</span>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {ALERTS.map((alert) => (
          <Row key={alert.title}>
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border">
              {alert.state === "Resolved" ? (
                <Check className="size-4 text-emerald-500" />
              ) : (
                <CircleAlert className="size-4 text-amber-500" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{alert.title}</span>
              <span className="text-muted-foreground block truncate text-xs">{alert.detail}</span>
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">{alert.detected}</span>
            <Pill tone={alert.state === "Resolved" ? "ok" : "warn"}>{alert.state}</Pill>
          </Row>
        ))}
      </div>
      <div className="text-muted-foreground border-border mt-auto flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs">
        <Bell className="size-4" />
        An alert clears itself when the next run succeeds.
      </div>
    </div>
  );
}
