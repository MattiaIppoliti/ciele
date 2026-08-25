"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ChannelMessage,
  ChannelRosterEntry,
  Teammate,
  TeammateChannel,
} from "@agent-hub/core";
import { CHANNEL_CHAIN_TURN_CAP } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, consumeChannelStream } from "@agent-hub/agent/client";
import { ArrowLeft, Hash, Plus, Settings2, Trash2, UserRoundPlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
  Label,
} from "@agent-hub/ui";
import {
  ChatThread,
  type ChatBotMsg,
  type ChatMsg,
} from "@/components/chat/chat-thread";
import { MessageScroller } from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import {
  channelChatMessages,
  channelMessageText,
  teammateAuthor,
} from "@/lib/teammates/channel-messages";
import { toast } from "@/lib/toast";
import {
  addChannelMembersAction,
  addChannelTeammatesAction,
  deleteChannelAction,
  markChannelReadAction,
  removeChannelMemberAction,
  removeChannelTeammateAction,
  updateChannelAction,
} from "@/app/(admin)/teammates/channels/actions";

/**
 * A Teammate channel (#778): the 1:1 chat's transcript with more than two
 * people in it.
 *
 * The transcript component is the shared one (`ChatThread`), so a channel gets
 * the same bubbles, Thinking panel, tool cards and Concept → Source citations a
 * private chat has. What a group adds is exactly two things: a name and a face
 * above each bubble, and a roster to manage. Everything else that looks
 * channel-specific here (the mention hint, the cap notice) is copy.
 */

export interface AddableTeammate {
  id: string;
  name: string;
  title: string;
  avatarSeed: string;
}

export interface InvitableMember {
  userId: string;
  label: string;
}

export function ChannelWorkspace({
  channel,
  roster,
  teammates,
  messages: stored,
  canManage,
  canViewReasoning,
  currentUserId,
  invitableMembers,
  addableTeammates,
  projects,
}: {
  channel: TeammateChannel;
  roster: ChannelRosterEntry[];
  teammates: Teammate[];
  messages: ChannelMessage[];
  canManage: boolean;
  /** Admins and above see the model's own reasoning in a stored trace (#557). */
  canViewReasoning: boolean;
  currentUserId: string;
  invitableMembers: InvitableMember[];
  addableTeammates: AddableTeammate[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [, startTransition] = useTransition();

  // The oversight view maps a stored transcript the same way
  // (`lib/teammates/channel-messages.ts`); only what streams in below is ours.
  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    channelChatMessages(stored, { roster, teammates, canViewReasoning })
  );

  /**
   * Opening the channel is reading it.
   *
   * In an effect with an empty dependency list, and guarded by a ref: the read
   * marker revalidates the roster, which re-renders this page, so anything that
   * fires on render marks the channel read forever. It did, once.
   */
  const markedRead = useRef(false);
  useEffect(() => {
    if (markedRead.current) return;
    markedRead.current = true;
    void markChannelReadAction(channel.id).catch(() => {
      // A stale unread badge is not worth a toast.
    });
  }, [channel.id]);

  const updateLastBot = (fn: (bot: ChatBotMsg) => ChatBotMsg) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const candidate = next[i];
        if (candidate.role === "bot") {
          next[i] = fn(candidate);
          break;
        }
      }
      return next;
    });

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: message,
        sentAt: new Date().toISOString(),
        author: {
          name:
            roster.find((entry) => entry.id === currentUserId)?.name ?? "You",
          avatarSeed: currentUserId,
        },
      },
    ]);

    try {
      const response = await fetch(
        `/api/teammates/channels/${channel.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        }
      );
      if (!response.ok || !response.body) {
        throw new Error(`Channel message failed (${response.status})`);
      }
      await consumeChannelStream<ChatBotMsg>(response.body, {
        // A Teammate is about to speak: open its bubble, and every update that
        // follows belongs to it until the next speaker.
        onSpeaker: ({ teammateId, teammateName }) => {
          const teammate = teammates.find((t) => t.id === teammateId);
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              id: null,
              ...EMPTY_TURN_TRACE,
              parts: [],
              streamingText: null,
              feedback: 0,
              // Mid-chain a Teammate that is not in `teammates` is not deleted,
              // so the stream's own name is the fallback here.
              author: teammateAuthor(teammate, teammateId, teammateName),
            },
          ]);
        },
        update: updateLastBot,
        onMessage: (message) => {
          if (message.authorType === "system") {
            // A cap marker, or a turn that failed: nobody was speaking, so it
            // is a notice rather than somebody's bubble.
            setMessages((prev) => [
              ...prev,
              { role: "notice", text: channelMessageText(message.content) },
            ]);
            return;
          }
          if (message.authorType === "teammate") {
            updateLastBot((bot) => ({ ...bot, id: message.id }));
          }
        },
        errorText: (text) => `⚠️ ${text}`,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Channel message failed"
      );
    } finally {
      setPending(false);
      // The roster's last-activity order and unread badges are server state.
      startTransition(() => router.refresh());
    }
  }

  const members = roster.filter((entry) => entry.kind === "member");
  const seatedTeammates = roster.filter((entry) => entry.kind === "teammate");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Link
          href="/teammates"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Teammates
        </Link>
        <div className="ml-2 flex min-w-0 items-center gap-2">
          <Hash className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{channel.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {members.length} {members.length === 1 ? "person" : "people"} ·{" "}
              {seatedTeammates.length}{" "}
              {seatedTeammates.length === 1 ? "teammate" : "teammates"}
              {channel.projectId
                ? ` · ${projects.find((p) => p.id === channel.projectId)?.name ?? "a project"}`
                : ""}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* The faces of everybody here, so who is in the room is visible
              without opening a panel. */}
          <div className="hidden items-center sm:flex">
            {roster.slice(0, 6).map((entry) => (
              <Hint key={entry.id} label={entry.name}>
                {/* The margin rides the avatar itself rather than a wrapper,
                    so the overlap stays on the sized element. */}
                <GeneratedAvatar
                  seed={
                    entry.kind === "teammate"
                      ? (teammates.find((t) => t.id === entry.id)?.avatarSeed?.trim() ||
                        entry.id)
                      : entry.id
                  }
                  size="size-7"
                  className="ring-background -ml-2 block ring-2 first:ml-0"
                />
              </Hint>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <UserRoundPlus className="size-4" /> Add
          </Button>
          {canManage && (
            <Hint label="Name, project and roster">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-4" />
              </Button>
            </Hint>
          )}
        </div>
      </div>

      <div className="bg-card mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <MessageScroller
          className="min-h-0 flex-1"
          busy={pending}
          navigation="rail"
          viewportClassName="px-4 py-5"
          contentClassName="space-y-4"
        >
          {messages.length === 0 && (
            <div className="pt-10 text-center">
              <p className="text-lg font-semibold">#{channel.name}</p>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
                {seatedTeammates.length === 0
                  ? "Add a teammate, then write @ and its name to bring it in."
                  : `Write @${seatedTeammates[0].name} to ask a teammate. Whoever you name answers here, and they can bring each other in.`}
              </p>
            </div>
          )}
          <ChatThread messages={messages} pending={pending} onSend={send} />
        </MessageScroller>

        <div className="space-y-1.5 px-4 pb-4">
          <PromptInput
            onSubmit={(value) => void send(value)}
            minRows={1}
            maxRows={6}
            placeholder={
              seatedTeammates.length > 0
                ? `Message #${channel.name}, or @${seatedTeammates[0].name}...`
                : `Message #${channel.name}...`
            }
            aria-label={`Message ${channel.name}`}
          />
          <p className="text-muted-foreground text-center text-xs">
            Teammates answer when you name them with @. One message runs at most{" "}
            {CHANNEL_CHAIN_TURN_CAP} teammate replies.
          </p>
        </div>
      </div>

      <AddDialog
        open={addOpen}
        channelId={channel.id}
        members={invitableMembers}
        teammates={addableTeammates}
        onClose={() => setAddOpen(false)}
      />
      {canManage && (
        <ChannelSettingsDialog
          open={settingsOpen}
          channel={channel}
          roster={roster}
          projects={projects}
          currentUserId={currentUserId}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function AddDialog({
  open,
  channelId,
  members,
  teammates,
  onClose,
}: {
  open: boolean;
  channelId: string;
  members: InvitableMember[];
  teammates: AddableTeammate[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function add(run: () => Promise<void>, done: string) {
    startTransition(async () => {
      try {
        await run();
        toast.success(done);
        router.refresh();
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not add them"
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to the channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <Label>Teammates</Label>
            {teammates.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Every teammate you can add is already here.
              </p>
            ) : (
              <ul className="space-y-1">
                {teammates.map((teammate) => (
                  <li key={teammate.id} className="flex items-center gap-3">
                    <GeneratedAvatar
                      seed={teammate.avatarSeed || teammate.id}
                      size="size-8"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {teammate.name}
                      </p>
                      {teammate.title && (
                        <p className="text-muted-foreground truncate text-xs">
                          {teammate.title}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        add(
                          () =>
                            addChannelTeammatesAction(channelId, [teammate.id]),
                          `${teammate.name} is in the channel`
                        )
                      }
                    >
                      <Plus className="size-4" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2">
            <Label>People</Label>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Everybody in the organization is already here.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {members.map((member) => (
                  <li key={member.userId} className="flex items-center gap-3">
                    <GeneratedAvatar seed={member.userId} size="size-8" />
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {member.label}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        add(
                          () =>
                            addChannelMembersAction(channelId, [member.userId]),
                          `${member.label} was invited`
                        )
                      }
                    >
                      <Plus className="size-4" /> Invite
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelSettingsDialog({
  open,
  channel,
  roster,
  projects,
  currentUserId,
  onClose,
}: {
  open: boolean;
  channel: TeammateChannel;
  roster: ChannelRosterEntry[];
  projects: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [projectId, setProjectId] = useState(channel.projectId ?? "");
  const [isPending, startTransition] = useTransition();

  function run(work: () => Promise<void>, done: string, back?: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
        if (back) router.push(back);
        else router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save the channel"
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Channel settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-project">Project</Label>
            <select
              id="channel-project"
              className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Every teammate here reads the project&apos;s decisions, and writes
              what this channel settles back to them.
            </p>
          </div>
          <Button
            disabled={isPending || !name.trim()}
            onClick={() =>
              run(
                async () => {
                  await updateChannelAction(channel.id, {
                    name: name.trim(),
                    projectId: projectId || null,
                  });
                },
                "Channel saved"
              )
            }
          >
            Save
          </Button>

          <section className="space-y-2 border-t pt-4">
            <Label>Who is here</Label>
            <ul className="space-y-1">
              {roster.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3">
                  <GeneratedAvatar seed={entry.id} size="size-7" />
                  <p className="min-w-0 flex-1 truncate text-sm">
                    {entry.name}
                    {entry.id === currentUserId && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    aria-label={`Remove ${entry.name}`}
                    onClick={() =>
                      run(
                        () =>
                          entry.kind === "member"
                            ? removeChannelMemberAction(channel.id, entry.id)
                            : removeChannelTeammateAction(channel.id, entry.id),
                        `${entry.name} left the channel`,
                        entry.id === currentUserId ? "/teammates" : undefined
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              Closing the channel deletes the thread for everybody in it,
              including its transcript.
            </p>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                run(
                  () => deleteChannelAction(channel.id),
                  "Channel closed",
                  "/teammates"
                )
              }
            >
              <Trash2 className="size-4" /> Close channel
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
