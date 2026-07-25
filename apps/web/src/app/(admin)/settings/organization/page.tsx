import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/settings/organization-client";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const { session, role } = await requirePageMember();
  if (!canManageMembers(role)) redirect("/");

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
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Organization</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Name and logo shown across {session.organization.name}&apos;s workspace.
        </p>
        <OrganizationClient organization={session.organization} demo={session.demo} />
      </div>
    </div>
  );
}
