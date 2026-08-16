import { notFound } from "next/navigation";
import { PreviewPageClient } from "@/components/assistant/preview-page-client";
import { getSession } from "@/lib/auth";
import { requirePageMember } from "@/lib/authz";
import { connectorInstallationScope } from "@/lib/local-connector-installer";
import { getAssistantCached } from "../get-assistant";

/**
 * "Preview" — the live preview on a route of its own.
 *
 * The editor's docked preview panel is a pointer surface (drag to resize,
 * hover to reveal) and is hidden below `md`, so without this route the preview
 * is unreachable on a phone or a portrait tablet. It stays available on a
 * desktop too: one place the preview always is, whatever the viewport.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageMember();
  const [assistant, session] = await Promise.all([
    getAssistantCached(id),
    getSession(),
  ]);
  if (!assistant) notFound();

  return (
    <PreviewPageClient
      assistant={assistant}
      connectorScope={
        session?.organization
          ? connectorInstallationScope(session.organization.id, session.userId)
          : null
      }
    />
  );
}
