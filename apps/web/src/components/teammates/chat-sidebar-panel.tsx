"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useMemo, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Teammate } from "@agent-hub/core";
import type { SidebarConversation } from "@/lib/chat-session";
import { Copy, Eye, EyeOff, MessageSquareText, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Hint } from "@agent-hub/ui";
import { useRouter } from "next/navigation";
import {
  deleteTeammateAction,
  hideTeammateAction,
  unhideTeammateAction,
} from "@/app/(admin)/teammates/actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { DAY_GROUP_PREFIX, groupByDay } from "@/lib/history-groups";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { GroupAvatarCluster } from "@/components/teammates/group-avatar-cluster";
import { useGuardedLinkClick, useGuardedNavigate } from "@/components/teammates/leave-guard";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { threadEntryLabel } from "@/lib/teammates/thread-label";
import { toast } from "@/lib/toast";

/** "en" so the faces sort the same on the server and in any browser. */
const byName = new Intl.Collator("en", { sensitivity: "base" });

export type { SidebarConversation };

/** The group rows the panel draws; the rail's `ChannelRow` satisfies it. */
interface PanelChannel {
  id: string;
  name: string;
  memberCount: number;
  teammateCount: number;
  faces: { id: string; seed: string }[];
  unread: { count: number; mentionsYou: boolean };
}

/** Hide or restore a Teammate on this Member's own roster (#767, story 10). */
function useRosterHiding() {
  const [isPending, startTransition] = useTransition();
  function setHidden(teammate: Teammate, hide: boolean) {
    startTransition(async () => {
      try {
        await (hide ? hideTeammateAction(teammate.id) : unhideTeammateAction(teammate.id));
        // Said plainly, because "hidden" next to a delete button invites the
        // reading that something was destroyed.
        toast.success(
          hide
            ? `${teammate.name} is off your roster. It still answers everybody else.`
            : `${teammate.name} is back on your roster.`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update your roster");
      }
    });
  }
  return { setHidden, isPending };
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-7 items-center gap-1 px-1 text-xs font-medium">
      <span className="flex-1 truncate">{children}</span>
      {action}
    </div>
  );
}

/**
 * One Teammate's face in the sidebar, and its right-click menu: the same
 * `ContextMenu` the Assistant cards open, carrying what the old rail's hover
 * buttons did plus Copy ID and Delete.
 *
 * No ring marks the open one, only its name: a ring around a generated face
 * read as a second, heavier avatar.
 */
function TeammateFace({
  teammate,
  active,
  collapsed,
  canEdit,
  onHide,
  href = `/teammates/${teammate.id}`,
}: {
  teammate: Teammate;
  active: boolean;
  collapsed: boolean;
  canEdit: boolean;
  /** Absent for Ciele AI, which cannot be hidden or deleted. */
  onHide?: () => void;
  /** Where the face opens; Ciele AI lives at `/teammates` itself. */
  href?: string;
}) {
  const router = useRouter();
  const guardedClick = useGuardedLinkClick();
  const navigate = useGuardedNavigate();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  async function copyId() {
    try {
      await navigator.clipboard.writeText(teammate.id);
      toast.success("Teammate ID copied");
    } catch {
      toast.error("Could not copy the teammate ID");
    }
  }

  function askDelete() {
    confirmDelete({
      title: `Delete ${teammate.name}?`,
      description:
        "Your conversations with it stay readable, but nobody can chat with it again.",
      confirmLabel: "Delete teammate",
      onConfirm: async () => {
        try {
          await deleteTeammateAction(teammate.id);
          toast.success(`${teammate.name} was deleted`);
          if (active) router.push("/teammates");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete");
        }
      },
    });
  }

  return (
    <div className="flex justify-center">
      {confirmDeleteModal}
      <ContextMenu>
        <ContextMenuTrigger>
          <div>
            <Hint
              label={teammate.title ? `${teammate.name}, ${teammate.title}` : teammate.name}
              side={collapsed ? "right" : "bottom"}
            >
              <Link
                href={href}
                aria-label={teammate.name}
                aria-current={active ? "page" : undefined}
                onClick={(event) => guardedClick(event, href)}
                className="press-control flex w-14 flex-col items-center gap-1.5 rounded-lg py-1"
              >
                <TeammateAvatar
                  teammate={teammate}
                  className={collapsed ? "size-8" : "size-11"}
                />
                {!collapsed && (
                  <span
                    className={`w-full truncate text-center text-2xs transition-colors ${
                      active ? "text-foreground font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    <RollInText text={teammate.name} />
                  </span>
                )}
              </Link>
            </Hint>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent ariaLabel={`Actions for ${teammate.name}`} className="w-56">
          {canEdit && (
            <ContextMenuItem
              textValue="Configure"
              onSelect={() => navigate(`/teammates/${teammate.id}/settings`)}
            >
              <AnimatedIcon icon={SlidersHorizontal} size={16} /> Configure
            </ContextMenuItem>
          )}
          <ContextMenuItem textValue="Copy ID" onSelect={() => void copyId()}>
            <AnimatedIcon icon={Copy} size={16} /> Copy ID
          </ContextMenuItem>
          {onHide && (
            <ContextMenuItem textValue="Hide from my roster" onSelect={onHide}>
              <AnimatedIcon icon={EyeOff} size={16} /> Hide from my roster
            </ContextMenuItem>
          )}
          {canEdit && onHide && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem textValue="Delete" tone="destructive" onSelect={askDelete}>
                <AnimatedIcon icon={Trash2} size={16} /> Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/**
 * The Chat surface's half of the sidebar (Notion's AI sidebar): the Teammates
 * as faces, the groups, then this Member's conversations newest first.
 *
 * The faces are the way in, a click opens that Teammate's chat in the page;
 * the history below is every thread with every Teammate on the roster, drawn
 * with the same list the chat's own history panel uses. On the icon rail only
 * the faces fit, so the history waits for the sidebar to be widened.
 */
export function ChatSidebarPanel({
  cieleAi,
  teammates,
  hidden,
  channels,
  conversations,
  canEdit,
  collapsed,
  onNewTeammate,
  onNewGroup,
}: {
  /** Pinned first: the Organization's default AI layer. */
  cieleAi: Teammate;
  teammates: Teammate[];
  hidden: Teammate[];
  channels: PanelChannel[];
  conversations: SidebarConversation[];
  canEdit: boolean;
  collapsed: boolean;
  onNewTeammate: () => void;
  onNewGroup: () => void;
}) {
  const pathname = usePathname();
  const openConversationId = useSearchParams().get("c");
  const guardedClick = useGuardedLinkClick();
  const navigate = useGuardedNavigate();
  const { setHidden, isPending } = useRosterHiding();

  const teammateById = useMemo(
    () => new Map([cieleAi, ...teammates].map((teammate) => [teammate.id, teammate])),
    [cieleAi, teammates]
  );
  const conversationById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation])),
    [conversations]
  );

  const dayGroups = useMemo(() => groupByDay(conversations), [conversations]);

  const activeTeammateId = pathname.match(/^\/teammates\/([^/]+)/)?.[1];

  // By name, not recency: there is no per-Teammate last-message time to sort
  // on without a query per face, and the history below already is recency.
  const cieleAiFace = (
    <TeammateFace
      key={cieleAi.id}
      teammate={cieleAi}
      href="/teammates"
      active={pathname === "/teammates" || activeTeammateId === cieleAi.id}
      collapsed={collapsed}
      canEdit={canEdit}
    />
  );
  const teammateFaces = [...teammates].sort((a, b) => byName.compare(a.name, b.name)).map((teammate) => (
    <TeammateFace
      key={teammate.id}
      teammate={teammate}
      active={activeTeammateId === teammate.id}
      collapsed={collapsed}
      canEdit={canEdit}
      onHide={() => setHidden(teammate, true)}
    />
  ));
  const faces = [cieleAiFace, ...teammateFaces];

  const newTeammate = canEdit ? (
    <div className="flex justify-center">
      <Hint label="New teammate" side={collapsed ? "right" : "bottom"}>
        <button
          type="button"
          aria-label="New teammate"
          onClick={onNewTeammate}
          className="press-control group/new flex w-14 flex-col items-center gap-1.5 rounded-lg py-1"
        >
          <span
            className={`text-muted-foreground group-hover/new:text-foreground group-hover/new:border-foreground/40 flex items-center justify-center rounded-full border border-dashed transition-colors ${
              collapsed ? "size-8" : "size-11"
            }`}
          >
            <Plus className="size-4" />
          </span>
          {!collapsed && (
            <span className="text-muted-foreground w-full truncate text-center text-2xs">
              New
            </span>
          )}
        </button>
      </Hint>
    </div>
  ) : null;

  const groupRows = channels.map((channel) => {
    const href = `/teammates/channels/${channel.id}`;
    const active = pathname === href;
    const unread = channel.unread.mentionsYou ? (
      <span className="bg-primary text-primary-foreground ml-auto shrink-0 rounded-full px-1.5 text-2xs font-semibold">
        @
      </span>
    ) : channel.unread.count > 0 ? (
      <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-1.5 text-2xs font-medium">
        <RollingNumber value={channel.unread.count} />
        <span className="sr-only"> unread</span>
      </span>
    ) : null;
    const row = (
      <Link
        key={channel.id}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? channel.name : undefined}
        onClick={(event) => guardedClick(event, href)}
        className={`press relative flex h-10 items-center rounded-lg text-sm transition-colors ${
          collapsed ? "w-9 justify-center self-center" : "w-full gap-2 px-1.5"
        } ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
      >
        <GroupAvatarCluster
          faces={channel.faces}
          participantCount={channel.teammateCount + channel.memberCount}
          size="sm"
        />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">
              <RollInText text={channel.name} />
            </span>
            {unread}
          </>
        )}
      </Link>
    );
    return collapsed ? (
      <Hint key={channel.id} label={channel.name} side="right">
        {row}
      </Hint>
    ) : (
      row
    );
  });

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 pt-1">
        {faces}
        {newTeammate}
        {channels.length > 0 && <div className="bg-border my-2 h-px w-6" />}
        {groupRows}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <section aria-label="AI Teammates">
        <SectionLabel>AI Teammates</SectionLabel>
        <div className="grid grid-cols-4 gap-y-2 pt-1">
          {faces}
          {newTeammate}
        </div>
      </section>

      <section aria-label="Groups">
        <SectionLabel
          action={
            <Hint label="New group">
              <button
                type="button"
                aria-label="New group"
                onClick={onNewGroup}
                className="press-control hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md transition-colors"
              >
                <Plus className="size-3.5" />
              </button>
            </Hint>
          }
        >
          Groups
        </SectionLabel>
        {channels.length === 0 ? (
          <EmptyState size="sm" title="No groups yet" description="Start a shared conversation with your team." action={<button type="button" className="press-text text-sm underline underline-offset-4" onClick={onNewGroup}>New group</button>} />
        ) : (
          <div className="flex flex-col gap-0.5">{groupRows}</div>
        )}
      </section>

      <section aria-label="Conversations">
        <SectionLabel>Conversations</SectionLabel>
        {conversations.length === 0 ? (
          <EmptyState size="sm" title="No conversations yet" description="Pick a teammate to start a conversation." />
        ) : (
          <AISidebar
            // Remounted when a new day appears, so its folder opens like the
            // others instead of arriving collapsed.
            key={dayGroups.map((group) => group.id).join("|")}
            items={dayGroups.map(
              (group): SidebarResource => ({
                id: group.id,
                label: group.label,
                kind: "folder",
                children: group.entries.map((conversation) => ({
                  id: conversation.id,
                  label: threadEntryLabel(conversation),
                  kind: "file",
                })),
              })
            )}
            defaultExpandedIds={dayGroups.map((group) => group.id)}
            // "" rather than null: the list reads null as "keep your own
            // selection", which left the last thread lit after New chat.
            activeId={openConversationId ?? ""}
            onActiveChange={(id) => {
              // Day folders toggle; only conversation rows navigate.
              if (id.startsWith(DAY_GROUP_PREFIX)) return;
              const conversation = conversationById.get(id);
              if (conversation) {
                navigate(
                  conversation.teammateId === cieleAi.id
                    ? `/teammates?c=${conversation.id}`
                    : `/teammates/${conversation.teammateId}?c=${conversation.id}`
                );
              }
            }}
            renderIcon={(item) => {
              if (item.kind !== "file") return undefined;
              // A thread with a Teammate shows its face; one with nobody in
              // particular gets the plain chat glyph the widget uses.
              const owner = teammateById.get(conversationById.get(item.id)?.teammateId ?? "");
              return owner ? (
                <TeammateAvatar teammate={owner} className="size-4" />
              ) : (
                <MessageSquareText className="size-4" />
              );
            }}
            // No rename or reorder behind this list: an edit would show and
            // then revert on the next refresh.
            editable={false}
            ariaLabel="Your conversations with teammates"
          />
        )}
      </section>

      {/* Hidden is reversible and has to look it, so the list stays in reach. */}
      {hidden.length > 0 && (
        <details className="px-1">
          <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">
            Hidden from your roster (<RollingNumber value={hidden.length} />)
          </summary>
          <ul className="mt-2 space-y-1.5">
            {hidden.map((teammate) => (
              <li key={teammate.id} className="flex items-center gap-2">
                <TeammateAvatar teammate={teammate} className="size-6" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  <RollInText text={teammate.name} />
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  title="Show again"
                  aria-label={`Show ${teammate.name} again`}
                  onClick={() => setHidden(teammate, false)}
                  className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md"
                >
                  <Eye className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
