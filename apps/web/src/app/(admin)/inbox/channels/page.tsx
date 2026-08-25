import Link from "next/link";
import { Hash } from "lucide-react";
import { listOrgChannelsOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

/**
 * Channel oversight (#778, story 15).
 *
 * The Inbox is the org-wide view, so group threads belong here: an Owner or
 * Admin can see every channel in the organization, including the ones they were
 * never invited to. The operation declares `manageMembers`, so `runOperation`
 * refuses an Editor before this page renders anything, and it is a separate
 * operation from the roster read on purpose, a flag on a read is how an
 * oversight surface quietly becomes the default one.
 *
 * Deliberately not folded into the conversation list beside it: a Conversation
 * has one subject and one Assistant, and a channel has neither, so sharing the
 * table would mean a column that is empty for half the rows.
 */
export default async function InboxChannelsPage() {
  const channels = await runOperation(listOrgChannelsOp, {});

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Groups</h1>
        <Link
          href="/inbox"
          className="text-muted-foreground hover:text-foreground ml-auto text-sm"
        >
          Conversations
        </Link>
      </header>
      <p className="text-muted-foreground px-6 pb-4 text-sm">
        Every teammate group in this organization, newest activity first.
        Groups are internal: nothing here reaches a website visitor, and none
        of it counts in Insights.
      </p>

      {channels.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t px-6 py-16 text-center">
          <Hash className="text-muted-foreground size-8" />
          <p className="text-lg font-semibold">No groups yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            A group is a thread where several colleagues and several teammates
            work on one thing. Anybody in the organization can open one from the
            Teammates page.
          </p>
        </div>
      ) : (
        <ul className="divide-y border-t">
          {channels.map((summary) => (
            <li key={summary.channel.id}>
              <Link
                href={`/inbox/channels/${summary.channel.id}`}
                className="hover:bg-muted flex items-center gap-3 px-6 py-3"
              >
                <Hash className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {summary.channel.name}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {summary.lastMessagePreview ||
                      "Nothing said in here yet"}
                  </p>
                </div>
                <p className="text-muted-foreground shrink-0 text-xs">
                  {summary.memberIds.length}{" "}
                  {summary.memberIds.length === 1 ? "person" : "people"} ·{" "}
                  {summary.teammateIds.length}{" "}
                  {summary.teammateIds.length === 1 ? "teammate" : "teammates"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
