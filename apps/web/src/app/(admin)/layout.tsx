import { Suspense, cache } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { ShellProvider } from "@/components/shell/shell-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { PendingActivationBanner } from "@/components/shell/pending-activation-banner";
import { TopBar } from "@/components/shell/top-bar";
import { DeveloperPanelLauncher } from "@/components/developer-panel/developer-panel-launcher";
import { StaticIcons } from "@/components/ui/animated-icon";
import { TooltipProvider } from "@agent-hub/ui";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { listChannelMentionsOp } from "@ciele/ops";
import type { AssistantSummary } from "@/components/shell/nav";

/**
 * Groups where somebody named this Member (#778), read once per request.
 *
 * Two loaders below want it, the sidebar for its count and the notification
 * stack for the cards, and they are separate Suspense boundaries on purpose, so
 * neither can await the other's data. `cache()` is what keeps that from being
 * two reads, the same trick `requirePageMember` uses for the bootstrap.
 *
 * Inside a boundary rather than in the layout body, because the layout is
 * deliberately not async (see below): an await here would hold the whole
 * response, skeletons included, for a badge.
 */
const channelMentions = cache(() => runOperation(listChannelMentionsOp, {}));

/**
 * The admin shell. Deliberately not async: awaiting session + shell reads
 * here would hold the entire response (page included) hostage to the slowest
 * bootstrap query, since a layout's own awaits sit above every Suspense
 * boundary — the per-route loading.tsx skeletons can only appear once the
 * layout has resolved. Instead the static frame renders immediately and each
 * region below awaits what it needs inside its own boundary; requirePageMember
 * is React-cache()-memoized, so the loaders and the page share one bootstrap.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The Find palette and scope switcher need the org's assistants. Kicked off
  // here (not awaited) and resolved lazily by the client via use() — a
  // redirecting render (no session/org) rejects it, and the redirect itself
  // surfaces through the loaders below, so the palette just gets an empty
  // list. A genuine read failure degrades the same way, but logged: the
  // shell should not take the whole route down over its assistant list.
  const assistants: Promise<AssistantSummary[]> = requirePageMember()
    .then((ctx) => ctx.reads.assistantShellSummaries())
    .catch((error: unknown) => {
      const digest = (error as { digest?: string } | null)?.digest;
      if (typeof digest !== "string" || !digest.startsWith("NEXT_")) {
        console.error("Admin shell: assistants read failed", error);
      }
      return [];
    });

  return (
    <>
      <ThemeProvider>
        <TooltipProvider delay={300}>
          <ShellProvider assistants={assistants}>
            <div className="bg-background text-foreground flex h-full">
              <Suspense
                fallback={
                  <div className="hidden w-60 shrink-0 border-r lg:block" />
                }
              >
                <SidebarLoader />
              </Suspense>
              <div className="flex min-w-0 flex-1 flex-col">
                <Suspense fallback={<div className="h-14 shrink-0 border-b" />}>
                  <TopBarLoader />
                </Suspense>
                {/* Managed edition only: inert on a self-host (#444). */}
                <Suspense fallback={null}>
                  <ActivationBannerLoader />
                </Suspense>
                {/* The workspace and its right rail. The rail has one occupant
                    at a time (#754): the Developer Panel here, or the Assistant
                    editor's live Preview, which docks inside `main` from the
                    assistant layout. */}
                <div className="flex min-h-0 flex-1">
                  <main className="bg-content min-h-0 flex-1 overflow-hidden">
                    <StaticIcons>{children}</StaticIcons>
                  </main>
                  <DeveloperPanelLauncher />
                </div>
              </div>
              <Suspense fallback={null}>
                <NotificationCenterLoader />
              </Suspense>
            </div>
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}

async function SidebarLoader() {
  const { session, organizationId, reads } = await requirePageMember();
  const [alertCount, mentions] = await Promise.all([
    reads.activeAlertCount(),
    channelMentions(),
  ]);
  return (
    <AppSidebar
      orgId={organizationId}
      orgName={session.organization.name}
      orgLogoUrl={session.organization.logoUrl}
      organizations={session.organizations}
      email={session.email}
      role={session.role}
      demo={session.demo}
      profile={session.profile}
      alertCount={alertCount}
      mentionCount={mentions.length}
    />
  );
}

async function TopBarLoader() {
  const { session } = await requirePageMember();
  return <TopBar demo={session.demo} />;
}

async function ActivationBannerLoader() {
  const { organizationId } = await requirePageMember();
  return <PendingActivationBanner organizationId={organizationId} />;
}

async function NotificationCenterLoader() {
  const { reads } = await requirePageMember();
  const [alerts, totalAlertCount, mentions] = await Promise.all([
    reads.activeAlerts(),
    reads.activeAlertCount(),
    channelMentions(),
  ]);
  return (
    <NotificationCenter
      alerts={alerts}
      totalAlertCount={totalAlertCount}
      mentions={mentions}
    />
  );
}
