import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ShellProvider } from "@/components/shell/shell-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeScript } from "@/components/theme-script";
import { PendingActivationBanner } from "@/components/shell/pending-activation-banner";
import { TopBar } from "@/components/shell/top-bar";
import { StaticIcons } from "@/components/ui/animated-icon";
import { TooltipProvider } from "@agent-hub/ui";
import { requirePageMember } from "@/lib/authz";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, organizationId, reads } = await requirePageMember();

  // The shell (scope switcher + Find menu) needs the org's assistants; the
  // sidebar's Alerts row needs the active-alert count for its badge.
  const { assistants, activeAlertCount } = await reads.shell();
  const summaries = assistants.map((assistant) => ({
    id: assistant.id,
    title: assistant.title,
    nickname: assistant.nickname,
    brandColor: assistant.style.brandColor ?? null,
    avatarUrl: assistant.avatarUrl ?? null,
  }));

  return (
    <>
      {/* Server-rendered: sets the theme class before paint. Kept a sibling of
          the client provider so React doesn't reconcile a <script> on the
          client (which would warn). */}
      <ThemeScript />
      <ThemeProvider>
        <TooltipProvider delay={300}>
        <ShellProvider assistants={summaries}>
        <div className="bg-background text-foreground flex h-full">
          <Suspense fallback={<div className="w-60 shrink-0 border-r" />}>
            <AppSidebar
              orgId={organizationId}
              orgName={session.organization.name}
              orgLogoUrl={session.organization.logoUrl}
              organizations={session.organizations}
              email={session.email}
              role={session.role}
              demo={session.demo}
              profile={session.profile}
              alertCount={activeAlertCount}
            />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<div className="h-14 shrink-0 border-b" />}>
              <TopBar demo={session.demo} />
            </Suspense>
            {/* Managed edition only: inert on a self-host (#444). */}
            <Suspense fallback={null}>
              <PendingActivationBanner organizationId={organizationId} />
            </Suspense>
            <main className="min-h-0 flex-1 overflow-hidden">
              <StaticIcons>{children}</StaticIcons>
            </main>
          </div>
        </div>
        </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}
