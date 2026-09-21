"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChannelUnread, Teammate, TeammateVisibility } from "@agent-hub/core";
import { Eye, EyeOff, Lock, Pencil, Search } from "lucide-react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label } from "@agent-hub/ui";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/lib/toast";
import {
  createTeammateAction,
  hideTeammateAction,
  unhideTeammateAction,
  updateTeammateAction,
} from "@/app/(admin)/teammates/actions";
import { createChannelAction } from "@/app/(admin)/teammates/channels/actions";
import { KnowledgeScopePicker } from "@/components/teammates/knowledge-scope-picker";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";
import { ProjectSection } from "@/components/teammates/project-section";
import { VisibilityPicker } from "@/components/teammates/visibility-picker";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { GroupAvatarCluster } from "@/components/teammates/group-avatar-cluster";
export interface CollectionOption {
  id: string;
  name: string;
}

/** One group ("channel" in the code) row on the roster (#778). */
export interface ChannelRow {
  id: string;
  name: string;
  memberCount: number;
  teammateCount: number;
  /**
   * The room, for the card's avatar cluster: Teammates first, then people. The
   * seeds are resolved server-side, so a seat this Member has hidden from their
   * own roster still shows its face here.
   */
  faces: { id: string; seed: string }[];
  unread: ChannelUnread;
  lastMessagePreview: string;
}

export interface MemberChoice {
  userId: string;
  label: string;
}

const ROLE_LIMIT = 10000;

/**
 * Starting points for the create dialog. A Teammate with no standing role is
 * a chatbot with a name, so every preset ships one; the blank option exists
 * because a Member who knows what they want should not have to delete ours.
 */
const TEMPLATES: Array<{
  emoji: string;
  name: string;
  title: string;
  roleDescription: string;
}> = [
  {
    emoji: "✍️",
    name: "Copy",
    title: "Copywriter",
    roleDescription:
      "You write and edit customer-facing copy in the team's voice: release notes, help-centre articles, in-product strings. Ask what the reader already knows before you draft, keep sentences short, and never invent a product claim.",
  },
  {
    emoji: "🎧",
    name: "Sam",
    title: "Support Lead",
    roleDescription:
      "You answer colleagues' questions about how the product behaves, using the help knowledge in scope. Quote the source, say when the documentation is silent, and suggest what the team should write down next.",
  },
  {
    emoji: "📊",
    name: "Ada",
    title: "Analyst",
    roleDescription:
      "You help the team reason about their own numbers: what a metric means, what it excludes, what a change could plausibly be. State your assumptions and flag when a question needs data you do not have.",
  },
  {
    emoji: "🧭",
    name: "Chief of Staff",
    title: "Chief of Staff",
    roleDescription:
      "You keep track of what the team decided and why. Summarise, chase the loose ends, and when someone asks a question that was already settled, say when it was settled and what the reasoning was.",
  },
];

function CreateTeammateDialog({
  open,
  collections,
  sources,
  sourcesTruncated,
  projects,
  onClose,
}: {
  open: boolean;
  collections: CollectionOption[];
  /** The Library items the new Teammate's scope can name one at a time. */
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  /** Live Projects the new Teammate can attach to right away (#771). */
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<TeammateVisibility>("org");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(template: (typeof TEMPLATES)[number] | null) {
    setName(template?.name ?? "");
    setTitle(template?.title ?? "");
    setRoleDescription(template?.roleDescription ?? "");
  }

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Your teammate needs a name");
      return;
    }
    startTransition(async () => {
      try {
        const teammate = await createTeammateAction({
          name: name.trim(),
          title: title.trim(),
          roleDescription,
          visibility,
          collectionIds,
          sourceIds,
        });
        // A second write rather than a field on the create operation: the
        // attach is the same patch the configuration panel makes, so creating
        // with a Project and attaching one later stay one code path.
        if (projectId) {
          await updateTeammateAction(teammate.id, { projectId });
        }
        toast.success(`${teammate.name} is ready`);
        onClose();
        router.push(`/teammates/${teammate.id}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create the teammate"
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">New AI Teammate</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <p className="font-semibold">Start from a role</p>
          <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
            {TEMPLATES.map((template) => (
              <button
                key={template.title}
                type="button"
                onClick={() => pick(template)}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                  title === template.title
                    ? "border-primary ring-primary/30 shadow-sm ring-1"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="text-2xl">{template.emoji}</span>
                {template.title}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="teammate-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="teammate-name"
              value={name}
              placeholder="Nora"
              onChange={(e) => setName(e.target.value.slice(0, 120))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teammate-title">Title</Label>
            <Input
              id="teammate-title"
              value={title}
              placeholder="Support Copywriter"
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="teammate-role">Standing role</Label>
          <Textarea
            id="teammate-role"
            value={roleDescription}
            onChange={(e) =>
              setRoleDescription(e.target.value.slice(0, ROLE_LIMIT))
            }
            placeholder="What is this teammate for? Write it the way you would brief a new colleague."
            rows={6}
          />
          <p className="text-muted-foreground text-sm">
            Editable at any time, and it applies to the next message. Teammates
            are never published, so there is nothing to re-publish.
          </p>
        </div>

        <KnowledgeScopePicker
          collections={collections}
          sources={sources}
          sourcesTruncated={sourcesTruncated}
          collectionIds={collectionIds}
          sourceIds={sourceIds}
          onCollectionsChange={setCollectionIds}
          onSourcesChange={setSourceIds}
        />

        <ProjectSection
          projects={projects}
          value={projectId}
          onChange={setProjectId}
          canEdit
        />

        <VisibilityPicker value={visibility} onChange={setVisibility} />

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" className="h-10 px-5" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-10 px-5" onClick={handleCreate} disabled={isPending}>
            {isPending ? "Creating..." : "Create teammate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Opening a channel (#778).
 *
 * No capability gate, unlike the Teammate dialog beside it: opening a thread and
 * inviting colleagues is not configuring an agent, so any Member may (#776).
 * Teammates can be added here or later, and either way the creator is seated
 * first, because membership is what makes the channel visible at all.
 */
function CreateChannelDialog({
  open,
  teammates,
  members,
  onClose,
}: {
  open: boolean;
  teammates: Teammate[];
  members: MemberChoice[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [teammateIds, setTeammateIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const toggle = (
    id: string,
    list: string[],
    set: (next: string[]) => void
  ) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Your group needs a name");
      return;
    }
    startTransition(async () => {
      try {
        const channel = await createChannelAction({
          name: name.trim(),
          teammateIds,
          memberIds,
        });
        onClose();
        router.push(`/teammates/channels/${channel.id}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not open the group"
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">New group</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="new-channel-name">Name</Label>
            <Input
              id="new-channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Launch week"
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label>Teammates</Label>
            {teammates.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No teammates yet. Create one first, or open the group and add
                it later.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {teammates.map((teammate) => (
                  <button
                    key={teammate.id}
                    type="button"
                    onClick={() =>
                      toggle(teammate.id, teammateIds, setTeammateIds)
                    }
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      teammateIds.includes(teammate.id)
                        ? "border-primary bg-primary/5 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <TeammateAvatar teammate={teammate} className="size-5" />
                    {teammate.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>People</Label>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You are the only member of this organization so far.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => toggle(member.userId, memberIds, setMemberIds)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      memberIds.includes(member.userId)
                        ? "border-primary bg-primary/5 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    {member.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            className="w-full"
            disabled={isPending || !name.trim()}
            onClick={handleCreate}
          >
            {isPending ? "Opening..." : "Open group"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


/**
 * One row in the rail: a Teammate or a group, drawn the same way.
 *
 * The two used to be separate sections of a card grid, which said that talking
 * to Nora and talking to #launch-week were different activities. They are not:
 * both are a thread you come back to, so both are a row in one list, and the
 * only thing that differs is the face (one figure, or a cluster).
 */
function RailRow({
  href,
  active,
  avatar,
  name,
  subtitle,
  badge,
  trailing,
}: {
  href: string;
  active: boolean;
  avatar: ReactNode;
  name: ReactNode;
  subtitle: string;
  badge?: ReactNode;
  /** Row actions, revealed on hover or keyboard focus. Never inside the link. */
  trailing?: ReactNode;
}) {
  return (
    <div className="group/row relative">
      <Link
        href={href}
        className={`flex items-start gap-3 border-b px-4 py-3 transition-colors ${
          active ? "bg-primary/5 dark:bg-primary/25" : "hover:bg-muted/50"
        }`}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{name}</span>
            {badge}
          </span>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            {subtitle}
          </span>
        </span>
      </Link>
      {trailing && (
        <div className="bg-background/80 absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg opacity-0 backdrop-blur-sm transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          {trailing}
        </div>
      )}
    </div>
  );
}

/**
 * The Teammates shell (#768, #778): a conversation rail on the left, whichever
 * thread is open on the right.
 *
 * Shaped after the Inbox, deliberately. A Member on this page is doing the same
 * thing a reviewer does there, walking a list of conversations and reading one,
 * so it gets the same two panes instead of the card grid it had: the rail is one
 * list of every thread, Teammates and groups interleaved, and the route decides
 * what fills the pane beside it.
 *
 * It is a layout rather than a page, so the rail survives navigation between
 * threads; `/teammates` itself renders only the "pick one" placeholder. Below
 * `lg` the two take turns owning the screen the way the Inbox does: the rail is
 * the whole page at `/teammates`, and opening a thread swaps to it.
 *
 * The rail is sorted by name, not by recency. There is no per-Teammate
 * last-message timestamp to sort on without one query per row, and ordering a
 * chat list by the config's `updatedAt` would put whichever Teammate somebody
 * renamed at the top, which is a worse lie than alphabetical.
 */
export function TeammatesShell({
  teammates,
  hidden,
  channels,
  members,
  collections,
  sources,
  sourcesTruncated,
  projects,
  canEdit,
  children,
}: {
  teammates: Teammate[];
  /** The ones this Member keeps off their rail (#767, story 10). */
  hidden: Teammate[];
  /** The channels this Member is in (#778); invite-based, so only theirs. */
  channels: ChannelRow[];
  /** Colleagues who can be invited into a new channel. */
  members: MemberChoice[];
  collections: CollectionOption[];
  /** The Library items a Knowledge Scope can name one at a time (PRD #726). */
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  /** Live Projects, offered by the create dialog's project section (#771). */
  projects: { id: string; name: string }[];
  canEdit: boolean;
  /** The open thread, or the placeholder at `/teammates`. */
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // `/teammates` exactly: nothing is open, so on a phone the rail is the page.
  const onIndex = pathname === "/teammates";

  const query = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const matches = (name: string) =>
      query === "" || name.toLowerCase().includes(query);
    return [
      ...channels
        .filter((channel) => matches(channel.name))
        .map((channel) => ({ kind: "channel" as const, channel })),
      ...teammates
        .filter((teammate) => matches(teammate.name))
        .map((teammate) => ({ kind: "teammate" as const, teammate })),
    ].sort((a, b) =>
      (a.kind === "channel" ? a.channel.name : a.teammate.name).localeCompare(
        b.kind === "channel" ? b.channel.name : b.teammate.name
      )
    );
  }, [channels, teammates, query]);

  function setHidden(teammate: Teammate, hide: boolean) {
    startTransition(async () => {
      try {
        await (hide
          ? hideTeammateAction(teammate.id)
          : unhideTeammateAction(teammate.id));
        // Said plainly, because "hidden" next to a delete button invites the
        // reading that something was destroyed.
        toast.success(
          hide
            ? `${teammate.name} is off your roster. It still answers everybody else.`
            : `${teammate.name} is back on your roster.`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update your roster"
        );
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Teammates</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* No capability gate: any Member may open a group (#776). */}
          <Button
            variant="outline"
            className="h-10 rounded-lg px-4 font-semibold"
            onClick={() => setChannelOpen(true)}
          >
            New group
          </Button>
          {canEdit && (
            <Button
              className="h-10 rounded-lg px-4 font-semibold"
              onClick={() => setCreateOpen(true)}
            >
              New teammate
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 border-t">
        <aside
          className={`w-full shrink-0 flex-col overflow-y-auto border-r lg:flex lg:w-72 ${
            onIndex ? "flex" : "hidden"
          }`}
        >
          <div className="relative shrink-0 px-3 py-3">
            <Search className="text-muted-foreground absolute top-1/2 left-6 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teammates and groups..."
              aria-label="Search teammates and groups"
              className="h-9 w-full rounded-lg pl-9"
            />
          </div>

          {rows.length === 0 && (
            <EmptyState
              size="sm"
              title={query ? "Nothing matches" : "No teammates yet"}
              description={
                query
                  ? "No teammate or group has that name."
                  : "A teammate is an AI colleague your team chats with inside Ciele. It answers from the knowledge you already curated in the Library, and it never talks to your website visitors."
              }
            />
          )}

          {rows.map((row) =>
            row.kind === "channel" ? (
              <RailRow
                key={`channel-${row.channel.id}`}
                href={`/teammates/channels/${row.channel.id}`}
                active={pathname === `/teammates/channels/${row.channel.id}`}
                avatar={
                  <GroupAvatarCluster
                    faces={row.channel.faces}
                    participantCount={
                      row.channel.teammateCount + row.channel.memberCount
                    }
                    size="sm"
                  />
                }
                name={row.channel.name}
                subtitle={
                  row.channel.lastMessagePreview ||
                  `${row.channel.teammateCount} teammate${row.channel.teammateCount === 1 ? "" : "s"}, ${row.channel.memberCount} ${row.channel.memberCount === 1 ? "person" : "people"}`
                }
                badge={
                  /* Mentioned is the loud signal; agent-to-agent chatter only
                     ever moves the count (#777's default). */
                  row.channel.unread.mentionsYou ? (
                    <span className="bg-primary text-primary-foreground ml-auto shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold">
                      Mentioned you
                    </span>
                  ) : row.channel.unread.count > 0 ? (
                    <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium">
                      {row.channel.unread.count}
                    </span>
                  ) : null
                }
              />
            ) : (
              <RailRow
                key={`teammate-${row.teammate.id}`}
                href={`/teammates/${row.teammate.id}`}
                active={pathname.startsWith(`/teammates/${row.teammate.id}`)}
                avatar={
                  <TeammateAvatar teammate={row.teammate} className="size-9" />
                }
                name={row.teammate.name}
                subtitle={row.teammate.title || "AI teammate"}
                badge={
                  row.teammate.visibility === "private" ? (
                    <Lock
                      className="text-muted-foreground size-3 shrink-0"
                      aria-label="Private"
                    />
                  ) : null
                }
                trailing={
                  <>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Configure"
                        aria-label={`Configure ${row.teammate.name}`}
                        /* The configuration has its own route (the same facts
                           the chat's drawer renders), so Edit goes there. */
                        render={
                          <Link
                            href={`/teammates/${row.teammate.id}/settings`}
                          />
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      title="Hide from my roster"
                      aria-label={`Hide ${row.teammate.name} from my roster`}
                      onClick={() => setHidden(row.teammate, true)}
                    >
                      <EyeOff className="size-4" />
                    </Button>
                  </>
                }
              />
            )
          )}

          {/* Hidden is reversible and has to look it, so the list is here rather
              than in a settings page somebody would have to remember. */}
          {hidden.length > 0 && (
            <details className="mt-auto shrink-0 border-t px-4 py-3">
              <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">
                Hidden from your roster ({hidden.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {hidden.map((teammate) => (
                  <li key={teammate.id} className="flex items-center gap-2">
                    <TeammateAvatar teammate={teammate} className="size-7" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {teammate.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      title="Show again"
                      aria-label={`Show ${teammate.name} again`}
                      onClick={() => setHidden(teammate, false)}
                    >
                      <Eye className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section
          className={`min-w-0 flex-1 overflow-hidden lg:block ${
            onIndex ? "hidden" : "block"
          }`}
        >
          {children}
        </section>
      </div>

      <CreateTeammateDialog
        open={createOpen}
        collections={collections}
        sources={sources}
        sourcesTruncated={sourcesTruncated}
        projects={projects}
        onClose={() => setCreateOpen(false)}
      />
      <CreateChannelDialog
        open={channelOpen}
        teammates={teammates}
        members={members}
        onClose={() => setChannelOpen(false)}
      />
    </div>
  );
}
