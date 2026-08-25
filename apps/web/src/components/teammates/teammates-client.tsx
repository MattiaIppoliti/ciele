"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChannelUnread, Teammate, TeammateVisibility } from "@agent-hub/core";
import { ArrowRight, Eye, EyeOff, Hash, Lock, Pencil, Sparkles } from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label } from "@agent-hub/ui";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  createTeammateAction,
  hideTeammateAction,
  unhideTeammateAction,
} from "@/app/(admin)/teammates/actions";
import { createChannelAction } from "@/app/(admin)/teammates/channels/actions";
import { CollectionScopePicker } from "@/components/teammates/collection-scope-picker";
import { VisibilityPicker } from "@/components/teammates/visibility-picker";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";

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
  onClose,
}: {
  open: boolean;
  collections: CollectionOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<TeammateVisibility>("org");
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
        });
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

        <CollectionScopePicker
          collections={collections}
          selected={collectionIds}
          onChange={setCollectionIds}
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

export function TeammatesClient({
  teammates,
  hidden,
  channels,
  members,
  collections,
  canEdit,
}: {
  teammates: Teammate[];
  /** The ones this Member keeps off their roster (#767, story 10). */
  hidden: Teammate[];
  /** The channels this Member is in (#778); invite-based, so only theirs. */
  channels: ChannelRow[];
  /** Colleagues who can be invited into a new channel. */
  members: MemberChoice[];
  collections: CollectionOption[];
  canEdit: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update your roster"
        );
      }
    });
  }
  const nameOf = (id: string) =>
    collections.find((c) => c.id === id)?.name ?? "a deleted collection";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
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

      {/* Groups first: a thread with unread messages in it is what a Member
          came back for, and the teammate cards are always where they were. */}
      {channels.length > 0 && (
        <div className="space-y-2 border-t px-6 py-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Groups
          </p>
          <ul className="space-y-1">
            {channels.map((channel) => (
              <li key={channel.id}>
                <Link
                  href={`/teammates/channels/${channel.id}`}
                  className="hover:bg-muted flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <Hash className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm ${channel.unread.count > 0 ? "font-semibold" : "font-medium"}`}
                    >
                      {channel.name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {channel.lastMessagePreview ||
                        `${channel.teammateCount} teammate${channel.teammateCount === 1 ? "" : "s"}, ${channel.memberCount} ${channel.memberCount === 1 ? "person" : "people"}`}
                    </p>
                  </div>
                  {/* Mentioned is the loud signal; agent-to-agent chatter only
                      ever moves the count (#777's default). */}
                  {channel.unread.mentionsYou ? (
                    <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
                      Mentioned you
                    </span>
                  ) : channel.unread.count > 0 ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                      {channel.unread.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teammates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 border-t px-6 py-16 text-center">
          <Sparkles className="text-muted-foreground size-8" />
          <p className="text-lg font-semibold">No teammates yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            A teammate is an AI colleague your team chats with inside Ciele. It
            answers from the knowledge you already curated in the Library, and
            it never talks to your website visitors.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 border-t px-6 py-6 lg:grid-cols-2">
          {teammates.map((teammate) => (
            <Card key={teammate.id} size="sm" className="flex-row items-start gap-4 p-4">
              <TeammateAvatar teammate={teammate} className="size-11" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/teammates/${teammate.id}`}
                    className="text-primary text-lg font-bold underline underline-offset-4 hover:opacity-70"
                  >
                    {teammate.name}
                  </Link>
                  {teammate.visibility === "private" && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Lock className="size-3" /> Private
                    </span>
                  )}
                </div>
                {teammate.title && (
                  <p className="text-muted-foreground text-sm">{teammate.title}</p>
                )}
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed">
                  {teammate.roleDescription || "No standing role yet."}
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {teammate.collectionIds.length === 0
                    ? "Answers from its persona only, no knowledge in scope"
                    : `Knows: ${teammate.collectionIds.map(nameOf).join(", ")}`}
                </p>
              </div>
              {/* Reading order is what a Member reaches for, in order: go in
                  and talk to it, change how it works, and only then take it
                  off the roster. Hiding used to be the card's only button,
                  which put the one destructive-looking action under the
                  thumb and left opening it to the name alone. */}
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Open"
                  aria-label={`Open ${teammate.name}`}
                  render={<Link href={`/teammates/${teammate.id}`} />}
                >
                  <ArrowRight className="size-4" />
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                      title="Edit"
                    aria-label={`Edit ${teammate.name}`}
                    /* The configuration lives in a dialog beside the chat and
                       needs the whole page's reads (knowledge, members,
                       grants, memory), so editing from here opens that page
                       with the dialog already up rather than rebuilding it. */
                    render={<Link href={`/teammates/${teammate.id}?configure=1`} />}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  title="Hide from my roster"
                  aria-label={`Hide ${teammate.name} from my roster`}
                  onClick={() => setHidden(teammate, true)}
                >
                  <EyeOff className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Hidden is reversible and has to look it, so the list is here rather
          than in a settings page somebody would have to remember. */}
      {hidden.length > 0 && (
        <details className="border-t px-6 py-4">
          <summary className="text-muted-foreground cursor-pointer text-sm hover:underline">
            Hidden from your roster ({hidden.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {hidden.map((teammate) => (
              <li
                key={teammate.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <TeammateAvatar teammate={teammate} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{teammate.name}</p>
                  {teammate.title && (
                    <p className="text-muted-foreground truncate text-xs">
                      {teammate.title}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setHidden(teammate, false)}
                >
                  <Eye className="size-4" />
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <CreateTeammateDialog
        open={createOpen}
        collections={collections}
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
