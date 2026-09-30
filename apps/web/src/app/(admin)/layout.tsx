import { Suspense, cache } from "react";
import { devKey } from "@/lib/dev-key";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationDock } from "@/components/notifications/notification-dock";
import { ShellProvider } from "@/components/shell/shell-provider";
import { findScopeKey } from "@/lib/find-index";
import { ThemeProvider } from "@/components/theme-provider";
import { PendingActivationBanner } from "@/components/shell/pending-activation-banner";
import { TopBar } from "@/components/shell/top-bar";
import { DeveloperPanelLauncher } from "@/components/developer-panel/developer-panel-launcher";
import { StaticIcons } from "@/components/ui/animated-icon";
import { TooltipProvider } from "@agent-hub/ui";
import { FeedbackProvider } from "@agent-hub/ui/feedback";
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
 * A shell read kicked off by the layout (not awaited) and resolved lazily by
 * the client via use(). A redirecting render (no session/org) rejects it, and
 * the redirect itself surfaces through the loaders below, so the client just
 * gets `fallback`. A genuine read failure degrades the same way, but logged:
 * the shell should not take the whole route down over one of these.
 */
function shellRead<T>(
  what: string,
  read: (ctx: Awaited<ReturnType<typeof requirePageMember>>) => T | PromiseLike<T>,
  fallback: T
): Promise<T> {
  return requirePageMember()
    .then(read)
    .catch((error: unknown) => {
      const digest = (error as { digest?: string } | null)?.digest;
      if (typeof digest !== "string" || !digest.startsWith("NEXT_")) {
        console.error(`Admin shell: ${what} read failed`, error);
      }
      return fallback;
    });
}

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
  modal,
}: {
  children: React.ReactNode;
  /** Settings opened from a page, over that page (`@modal/(.)settings`). */
  modal: React.ReactNode;
}) {
  // The Find palette and scope switcher need the org's assistants.
  const assistants: Promise<AssistantSummary[]> = shellRead(
    "assistants",
    (ctx) => ctx.reads.assistantShellSummaries(),
    []
  );

  // Who the Find palette is answering for. Its browser store is kept for the
  // life of the tab, so when this changes (another Organization, another
  // Member, a new Role) what it holds belongs to someone else and is dropped.
  const findScope: Promise<string> = shellRead(
    "Find scope",
    ({ organizationId, session }) =>
      findScopeKey({ organizationId, userId: session.userId, role: session.role ?? null }),
    ""
  );

  return (
    <ThemeProvider scope="admin">
      {/* Interface sounds + haptics (#817). Here and in the marketing
          layout, never in the root layout: the widget inherits only the
          root, and that placement is what keeps it silent. */}
      <FeedbackProvider>
      <TooltipProvider delay={300}>
        <ShellProvider assistants={assistants} findScope={findScope}>
          {/* The siblings below are keyed in development only, for the root
              layout's reason (lib/dev-key.ts). */}
          <div className="bg-shell text-foreground flex h-full">
            <a
              key={devKey("skip-link")}
              href="#main-content"
              className="bg-foreground text-background focus-visible:ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow-strong focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Skip to main content
            </a>
            <Suspense
              key={devKey("sidebar")}
              fallback={
                <div className="hidden w-60 shrink-0 md:block" />
              }
            >
              <SidebarLoader />
            </Suspense>
            {/* The workspace is one rounded panel lifted off the frame the
                sidebar sits on: the top bar, the page and the right rail all
                live inside it. On every screen: from `md` (a tablet and up)
                the sidebar docks beside it, below that it is a drawer over it
                and the panel keeps a slimmer inset of its own. */}
            <div
              key={devKey("workspace")}
              className="admin-workspace"
            >
              <div className="admin-panel">
                <Suspense key={devKey("top-bar")} fallback={<div className="h-14 shrink-0 border-b" />}>
                  <TopBarLoader />
                </Suspense>
                {/* Managed edition only: inert on a self-host (#444). */}
                <Suspense key={devKey("activation-banner")} fallback={null}>
                  <ActivationBannerLoader />
                </Suspense>
                {/* The workspace. The right rail has one occupant at a time
                    (#754): the Developer Panel, docked outside this panel on
                    the frame, or the Assistant editor's live Preview, which
                    docks inside `main` from the assistant layout. */}
                <div key={devKey("content")} className="flex min-h-0 flex-1">
                  <main
                    key={devKey("main")}
                    id="main-content"
                    tabIndex={-1}
                    className="bg-content @container min-h-0 flex-1 overflow-hidden focus:outline-none"
                  >
                    <StaticIcons>{children}</StaticIcons>
                    {modal}
                  </main>
                </div>
              </div>
            </div>
            {/* The left sidebar's mirror, on the frame beside the workspace
                panel rather than inside it (#754). */}
            <DeveloperPanelLauncher key={devKey("developer-panel")} />
            <Suspense key={devKey("notification-dock")} fallback={null}>
              <NotificationDockLoader />
            </Suspense>
          </div>
        </ShellProvider>
      </TooltipProvider>
      </FeedbackProvider>
    </ThemeProvider>
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

async function NotificationDockLoader() {
  const { reads } = await requirePageMember();
  const [alerts, totalAlertCount, mentions, ingestionActive] = await Promise.all([
    reads.activeAlerts(),
    reads.activeAlertCount(),
    channelMentions(),
    reads.ingestionInFlight(),
  ]);
  return (
    <NotificationDock
      alerts={alerts}
      totalAlertCount={totalAlertCount}
      mentions={mentions}
      ingestionActive={ingestionActive}
    />
  );
}
