"use client";

// Client component: AnimatedIcon takes lucide component references as props,
// which a Server Component cannot serialize across the RSC boundary.
import { Link } from "@/components/ui/link";
import type { Assistant, Flow, KnowledgeCollection, Publication } from "@agent-hub/core";
import {
  BookOpen,
  CircleCheck,
  Circle,
  MessageCircle,
  Rocket,
  Workflow,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-sm">{label}</p>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-sm font-medium">
        {children}
      </div>
    </div>
  );
}

function ChecklistRow({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`hover:bg-muted flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        done ? "text-muted-foreground line-through decoration-1" : ""
      }`}
    >
      {done ? (
        <AnimatedIcon
          icon={CircleCheck}
          size={16}
          iconClassName="text-emerald-600"
          className="shrink-0"
        />
      ) : (
        <Circle className="text-muted-foreground size-4 shrink-0" />
      )}
      {label}
    </Link>
  );
}

/**
 * Vercel-style project Overview for one assistant: status card with the key
 * facts, a setup checklist, and shortcuts into the SETUP sections.
 */
export function AssistantOverview({
  assistant,
  flows,
  collections,
  publications,
}: {
  assistant: Assistant;
  flows: Flow[];
  collections: KnowledgeCollection[];
  publications: Publication[];
}) {
  const latest = publications.reduce<Publication | null>(
    (top, p) => (top && top.version >= p.version ? top : p),
    null
  );
  const base = `/assistants/${assistant.id}`;
  const brandColor = assistant.style.brandColor ?? "#0a0a0a";
  const checklist = [
    {
      label: "Add knowledge sources",
      href: `${base}/knowledge`,
      done: collections.length > 0,
    },
    {
      label: "Create a flow",
      href: `${base}/flows`,
      done: flows.some((flow) => !flow.isDefault),
    },
    {
      label: "Publish the widget",
      href: `${base}/publish`,
      done: latest !== null,
    },
  ];
  const doneCount = checklist.filter((step) => step.done).length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
      <div className="bg-card rounded-xl border shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
          <h1 className="text-sm font-medium">Assistant</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`${base}/general`} />}
            >
              Edit
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`${base}/publish`} />}
            >
              Publish
            </Button>
          </div>
        </div>
        <div className="grid gap-8 px-6 py-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Widget vignette in place of Vercel's deployment screenshot. */}
          <div className="bg-muted/50 relative flex min-h-44 items-end justify-end rounded-lg border p-4">
            <div className="bg-card absolute top-4 left-4 max-w-[70%] rounded-lg border px-3 py-2 shadow-xs">
              <p className="truncate text-xs font-medium">
                {assistant.nickname || assistant.title}
              </p>
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                {assistant.welcomeMessage || "Hi! How can I help?"}
              </p>
            </div>
            <span
              className="flex size-11 items-center justify-center rounded-full text-white shadow-md"
              style={{ backgroundColor: brandColor }}
            >
              <AnimatedIcon icon={MessageCircle} size={20} />
            </span>
          </div>

          <div className="grid content-start gap-5 sm:grid-cols-2">
            <DetailRow label="Status">
              <span
                className={`size-2 rounded-full ${latest ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              <span className="ml-1">
                {latest ? `Published v${latest.version}` : "Draft"}
              </span>
            </DetailRow>
            <DetailRow label={latest ? "Last published" : "Created"}>
              {formatDate(latest ? latest.createdAt : assistant.createdAt)}
            </DetailRow>
            <DetailRow label="Assistant ID">
              <Hint label={assistant.id}>
                <code className="truncate font-mono text-xs">{assistant.id}</code>
              </Hint>
              <CopyIdButton id={assistant.id} />
            </DetailRow>
            <DetailRow label="Model">
              <Badge
                variant="secondary"
                className="max-w-full font-mono text-xs"
              >
                <span className="truncate">
                  {assistant.modelProvider} · {assistant.modelId}
                </span>
              </Badge>
            </DetailRow>
            {assistant.description && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-sm">Description</p>
                <p className="mt-0.5 line-clamp-3 text-sm">
                  {assistant.description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="bg-card rounded-xl border p-3 shadow-xs">
          <p className="flex items-center justify-between px-3 pt-1 pb-2 text-sm font-medium">
            Setup checklist
            <span className="text-muted-foreground text-xs">
              {doneCount}/{checklist.length}
            </span>
          </p>
          {checklist.map((step) => (
            <ChecklistRow key={step.label} {...step} />
          ))}
        </div>

        <Link
          href={`${base}/knowledge`}
          className="bg-card hover:bg-muted/40 rounded-xl border p-5 shadow-xs transition-colors"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="text-muted-foreground size-4" /> Knowledge
          </p>
          <p className="mt-3 text-3xl font-semibold">{collections.length}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {collections.length === 1 ? "collection" : "collections"} powering
            answers
          </p>
        </Link>

        <Link
          href={`${base}/flows`}
          className="bg-card hover:bg-muted/40 rounded-xl border p-5 shadow-xs transition-colors"
        >
          {/* div, not p: the animated icon renders a <div>, invalid inside <p>. */}
          <div className="flex items-center gap-2 text-sm font-medium">
            <AnimatedIcon
              icon={Workflow}
              size={16}
              iconClassName="text-muted-foreground"
            />{" "}
            Flows
          </div>
          <p className="mt-3 text-3xl font-semibold">{flows.length}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {flows.filter((flow) => flow.enabled).length} enabled ·{" "}
            {flows.filter((flow) => flow.builtIn).length} built-in
          </p>
        </Link>
      </div>

      <div className="text-muted-foreground mt-6 flex items-center gap-2 text-xs">
        <AnimatedIcon icon={Rocket} size={14} />
        To update the live widget, publish again from the Publish section.
      </div>
    </div>
  );
}
