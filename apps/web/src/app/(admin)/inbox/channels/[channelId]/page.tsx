import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Hash } from "lucide-react";
import { OperationError, readOrgChannelOp } from "@ciele/ops";
import { ChannelTranscript } from "@/components/inbox/channel-transcript";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canViewReasoning } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * One channel, read-only, for an Owner or Admin (#778, story 15).
 *
 * `readOrgChannelOp` declares `manageMembers` and ignores membership, which is
 * the whole difference from the page a participant opens: same transcript, no
 * composer, and `canManage` is false, because overseeing a thread is not the
 * same as being in it.
 */
export default async function InboxChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const { role } = await requirePageMember();
  let view;
  try {
    view = await runOperation(readOrgChannelOp, { id: channelId });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const members = view.roster.filter((entry) => entry.kind === "member");
  const teammates = view.roster.filter((entry) => entry.kind === "teammate");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Link
          href="/inbox/channels"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Groups
        </Link>
        <div className="ml-2 flex min-w-0 items-center gap-2">
          <Hash className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {view.channel.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {members.map((entry) => entry.name).join(", ") || "Nobody"}
              {teammates.length > 0
                ? ` · ${teammates.map((entry) => entry.name).join(", ")}`
                : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-5">
        <ChannelTranscript
          messages={view.messages}
          roster={view.roster}
          teammates={view.teammates}
          canViewReasoning={canViewReasoning(role)}
        />
      </div>
    </div>
  );
}
