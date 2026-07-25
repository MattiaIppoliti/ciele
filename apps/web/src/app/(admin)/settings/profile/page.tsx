import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
import { ProfileClient } from "@/components/settings/profile-client";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { session } = await requirePageMember();

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
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your name, username, and photo — shown to the rest of {session.organization.name}.
        </p>
        <ProfileClient email={session.email} profile={session.profile} demo={session.demo} />
      </div>
    </div>
  );
}
