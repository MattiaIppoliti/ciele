import Link from "next/link";
import { Hash } from "lucide-react";
import { listOrgChannelsOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";

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
        <h1 className="text-2xl font-semibold"><RollInText text="Groups" /></h1>
        <Link
          href="/inbox"
          className="text-muted-foreground hover:text-foreground ml-auto text-sm"
        >
          Conversations
        </Link>
      </header>

      {channels.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t px-6 py-16 text-center">
          <Hash className="text-muted-foreground size-8" />
          <p className="text-lg font-semibold">No groups yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            A group is a shared thread for colleagues and teammates. Start one from the Teammates page.
          </p>
        </div>
      ) : (
        <ul className="divide-y border-t">
          {channels.map((summary, index) => (
            <RollRow key={summary.channel.id} index={index}>
            <li>
              <Link
                href={`/inbox/channels/${summary.channel.id}`}
                className="hover:bg-muted flex items-center gap-3 px-6 py-3"
              >
                <Hash className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <RollInText text={summary.channel.name} />
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    <RollInText text={summary.lastMessagePreview || "Nothing said in here yet"} />
                  </p>
                </div>
                <p className="text-muted-foreground shrink-0 text-xs">
                  <RollInText
                    text={`${summary.memberIds.length} ${summary.memberIds.length === 1 ? "person" : "people"} · ${summary.teammateIds.length} ${summary.teammateIds.length === 1 ? "teammate" : "teammates"}`}
                  />
                </p>
              </Link>
            </li>
            </RollRow>
          ))}
        </ul>
      )}
    </div>
  );
}
