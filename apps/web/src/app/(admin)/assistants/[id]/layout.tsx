import { notFound } from "next/navigation";
import { AssistantTopBarActions } from "@/components/assistant/assistant-topbar-actions";
import { PreviewPanelLauncher } from "@/components/assistant/preview-panel-launcher";
import { getSession } from "@/lib/auth";
import { canEdit, canPublish } from "@/lib/rbac";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { getAssistantCached } from "./get-assistant";

/**
 * Assistant-scoped area. Navigation lives in the global shell (sidebar SETUP
 * group + top-bar scope switcher); the identity strip (id + copy +
 * Duplicate/Delete) is registered into the top bar via
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
  const role = session?.role ?? null;
  const connectorScope = session?.organization
    ? connectorInstallationScope(session.organization.id, session.userId)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AssistantTopBarActions
        assistantId={assistant.id}
        assistantTitle={assistant.title}
        canEdit={canEdit(role)}
        canDelete={canPublish(role)}
      />
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
        <PreviewPanelLauncher
          assistant={assistant}
          connectorScope={connectorScope}
        />
      </div>
    </div>
  );
}
