import { MemoryClient } from "@/components/settings/memory-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * What your AI teammates remember about you (#771, story 19).
 *
 * A personal settings tab rather than an organization one, because the
 * document is the Member's: this read is keyed on their own id, RLS refuses
 * anyone else's, and no admin surface renders it at all.
 */
export default async function MemorySettingsPage() {
  const { session, db, organizationId } = await requirePageMember();

  const document = await db.getMemoryDocument(organizationId, {
    scope: "user",
    memberId: session.userId,
  });
  const [entries, teammates] = await Promise.all([
    document ? db.listMemoryDocumentEntries(document.id) : Promise.resolve([]),
    // Names for the history lines. Tombstoned Teammates included: an entry
    // outlives the Teammate that wrote it, and "who wrote this about me" still
    // needs an answer.
    db.table("teammates").list({ organizationId }),
  ]);

  return (
    <SettingsPanel
      title="What your teammates remember"
      description={`Shared with every AI teammate in ${session.organization.name}. They add to it as they learn how you work, and you can change or undo anything here.`}
    >
      <MemoryClient
        body={document?.body ?? ""}
        entries={entries}
        teammateNames={Object.fromEntries(
          teammates.map((teammate) => [teammate.id, teammate.name])
        )}
      />
    </SettingsPanel>
  );
}
