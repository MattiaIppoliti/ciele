import { notFound } from "next/navigation";
import { AssistantTopBarActions } from "@/components/assistant/assistant-topbar-actions";
import { PreviewPanelLauncher } from "@/components/assistant/preview-panel-launcher";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { requireAssistantPageAccess } from "@/lib/authz";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { getAssistantCached } from "./get-assistant";

/**
 * Assistant-scoped area. Navigation lives in the global shell (sidebar SETUP
 * group + top-bar scope switcher); the identity strip (id + copy +
 * Duplicate/Delete) is portalled into the top bar by
 * `AssistantTopBarActions`. The interactive live preview is code-split and
 * only loaded after the user opens it from the workspace edge.
 */
export default async function AssistantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [assistant, session] = await Promise.all([
    getAssistantCached(id),
    getSession(),
  ]);
  if (!assistant) notFound();
  // The Member's Role on this Assistant decides what its top bar offers.
  const { access } = await requireAssistantPageAccess(id);
  const connectorScope = session?.organization
    ? connectorInstallationScope(session.organization.id, session.userId)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AssistantTopBarActions
        assistantId={assistant.id}
        assistantTitle={assistant.title}
        canEdit={can(access, "assistants:edit")}
        canDelete={can(access, "assistants:delete")}
        canManageAccess={can(access, "assistants:access")}
      />
      <div className="flex min-h-0 flex-1">
        <section className="touch-scroll-clearance no-scrollbar @container min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</section>
        <PreviewPanelLauncher
          assistant={assistant}
          connectorScope={connectorScope}
        />
      </div>
    </div>
  );
}
