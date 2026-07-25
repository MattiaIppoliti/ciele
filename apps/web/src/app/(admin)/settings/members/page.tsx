import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { MembersClient } from "@/components/settings/members-client";
import { requirePageMember } from "@/lib/authz";
import { canChangeRoles, canManageMembers, canViewMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  if (!canViewMembers(role)) redirect("/");

  // Invites are admin-only (RLS enforces it too) — skip the fetch for editors.
  const canManage = canManageMembers(role);
  const [members, invites] = await Promise.all([
    db.listMembers(organizationId),
    canManage ? db.listInvites(organizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:opacity-70"
          >
            <ChevronLeft className="size-4" strokeWidth={3} />
            All assistants
          </Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          People in {session.organization.name} and their roles.
        </p>
        <MembersClient
          members={members}
          invites={invites}
          currentUserId={session.userId}
          canChangeRoles={canChangeRoles(role)}
          canInvite={canManage}
          demo={session.demo}
        />
      </div>
    </div>
  );
}
