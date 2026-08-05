"use client";

import { ChevronsUpDown, Search } from "lucide-react";
import { PreviewPane } from "@/components/home/preview-panes";
import { GLOBAL_NAV, SETUP_SECTIONS } from "@/components/shell/nav";
import { cn } from "@/lib/utils";
import type { FeatureShot } from "@/components/marketing/feature-catalog";
import {
  AlertsMock,
  AuthenticationMock,
  FlowsMock,
  KnowledgeMock,
  PublishingMock,
} from "@/components/marketing/feature-mocks";

/* The screenshot on a feature page: the admin shell drawn in real DOM rather
   than captured as an image, so it stays crisp, follows the visitor's theme,
   and cannot drift out of date the way a PNG does. Static by design — the
   home page owns the interactive version of this mock. */

const MOCKS = {
  knowledge: KnowledgeMock,
  flows: FlowsMock,
  publishing: PublishingMock,
  authentication: AuthenticationMock,
  alerts: AlertsMock,
} as const;

function SidebarRow({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
        active ? "bg-muted text-foreground font-medium" : "text-muted-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function FeatureWindow({ shot, label }: { shot: FeatureShot; label: string }) {
  // Which sidebar row reads as current: an org-wide screen, or the editor
  // section this feature lives in.
  const activeGlobal = shot.kind === "pane" ? shot.view : null;
  const activeSetup =
    shot.kind === "mock"
      ? { knowledge: "knowledge", flows: "flows", publishing: "publish", authentication: "authentication", alerts: null }[
          shot.mock
        ]
      : null;

  const Mock = shot.kind === "mock" ? MOCKS[shot.mock] : null;

  return (
    <div
      aria-hidden
      /* Masked at the foot rather than cut: the screen is a window onto a
         product that keeps going, so it dissolves into the page instead of
         ending on a border. The mask takes the border and shadow with it,
         which is the whole point — any hard edge would read as the bottom. */
      style={{
        maskImage: "linear-gradient(to bottom, black 62%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 62%, transparent 100%)",
      }}
      className="bg-background text-foreground flex h-[420px] overflow-hidden rounded-2xl border sm:h-[520px]"
    >
      {/* Sidebar — hidden on phones, where it would leave no room for the pane. */}
      <aside className="hidden w-52 shrink-0 flex-col gap-1 border-r px-3 py-3 md:flex">
        <div className="flex items-center gap-2 px-1.5 pb-2">
          <span className="bg-muted size-6 shrink-0 rounded-full border" />
          <span className="text-sm font-semibold">Acme …</span>
          <ChevronsUpDown className="text-muted-foreground ml-auto size-3.5" />
        </div>
        <div className="text-muted-foreground mb-2 flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
          <Search className="size-3.5" />
          Find…
        </div>

        {GLOBAL_NAV.filter((item) => !item.bottom).map((item) => (
          <SidebarRow
            key={item.label}
            icon={item.icon}
            label={item.label}
            active={item.label === activeGlobal}
          />
        ))}

        <div className="my-2 border-t" />

        {SETUP_SECTIONS.slice(0, 6).map((section) => (
          <SidebarRow
            key={section.slug}
            icon={section.icon}
            label={section.label}
            active={section.slug === activeSetup}
          />
        ))}

        <div className="mt-auto border-t pt-2">
          {GLOBAL_NAV.filter((item) => item.bottom).map((item) => (
            <SidebarRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={item.label === "Alerts" && shot.kind === "mock" && shot.mock === "alerts"}
            />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b px-5 text-sm">
          <span className="text-muted-foreground">All Assistants</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-medium">{label}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {Mock ? <Mock /> : <PreviewPane view={{ kind: "global", label: activeGlobal! }} />}
        </div>
      </div>
    </div>
  );
}
