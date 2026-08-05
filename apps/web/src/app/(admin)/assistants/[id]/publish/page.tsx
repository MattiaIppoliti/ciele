import { notFound } from "next/navigation";
import { PublishClient } from "@/components/assistant/publish-client";
import { requirePageMember } from "@/lib/authz";
import { canPublish } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const publications = await db.listPublications(id);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Publish</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Publish creates an immutable snapshot, the live widget always serves
        the latest one. Edits stay in Preview until you publish again.
      </p>
      <PublishClient
        assistant={assistant}
        publications={publications.map((publication) => ({
          id: publication.id,
          version: publication.version,
          createdAt: publication.createdAt,
        }))}
        canPublish={canPublish(role)}
      />
    </div>
  );
}
