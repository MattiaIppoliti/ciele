import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/join/${token}`);

  let error: string | null = null;
  try {
    const db = await getDb();
    await db.acceptInvite(token);
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid invite";
  }

  if (!error) redirect("/");

  return (
    <AuthShell title="Invite not valid" subtitle={error ?? ""}>
      <p className="text-muted-foreground text-sm">
        Ask an admin of the organization to send you a new invite link.
      </p>
    </AuthShell>
  );
}
