import { notFound } from "next/navigation";
import { PublishClient } from "@/components/assistant/publish-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember, requireAssistantPageAccess } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db } = await requirePageMember();
  const { access } = await requireAssistantPageAccess(id);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const publications = await db.listPublications(id);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        title="Publish"
        description="Live chats use the last published version."
      />
      <PublishClient
        assistant={assistant}
        publications={publications.map((publication) => ({
          id: publication.id,
          version: publication.version,
          createdAt: publication.createdAt,
        }))}
        canPublish={can(access, "assistants:publish")}
      />
    </div>
  );
}
