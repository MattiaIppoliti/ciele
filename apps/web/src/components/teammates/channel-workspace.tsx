"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import type {
  ChannelMessage,
  ChannelRosterEntry,
  Teammate,
  TeammateChannel,
} from "@agent-hub/core";
import { CHANNEL_CHAIN_TURN_CAP } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, consumeChannelStream } from "@agent-hub/agent/client";
import { playFeedback } from "@agent-hub/ui/feedback";
import { chatFeedbackForEvent } from "@/lib/chat-feedback";
import { Trash2 } from "lucide-react";
import { Settings2 } from "lucide-react";
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
import { ChatHeader } from "@/components/chat/chat-header";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { FULLSCREEN_GUTTER, WIDEN_TRANSITION } from "@/components/chat/fullscreen-motion";
import { ChatSurface } from "@/components/chat/rail-panel";
import { MessageScroller } from "@/components/agents/message";
import { GroupComposer } from "@/components/teammates/group-composer";
import { MentionText } from "@/components/teammates/mention-text";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Assignees,
  type AssigneeGroup,
} from "@/components/ui/assignees";
import { rosterAvatarSeed, teammateAvatarSeed } from "@/lib/avatar";
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
import { liveTurnStatus } from "@/components/chat/stored-trace";
import { patchLastBot } from "@/components/chat/turn-session";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

/**
 * A Teammate group (#778, "channel" in the code): the 1:1 chat's transcript
 * with more than two people in it.
 *
 * The transcript and composer are the shared preview/widget chat pieces
 * (`ChatThread`, `PromptInput` via `GroupComposer`), so a group gets the same
 * bubbles, Thinking panel, tool cards, Concept → Source citations and composer
 * pulse a private chat has. What a group adds is exactly three things: a name
 * and a face above each bubble, a roster to manage, and the `@` picker.
 * Everything else that looks group-specific here (the mention hint, the cap
 * notice) is copy. The code keeps the channel vocabulary (routes, actions,
 * types); only what a Member reads says "group".
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
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } = useFullscreenGrow();
  const [entryVersion, setEntryVersion] = useState(0);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen]);
  const [pending, setPending] = useState(false);
  const [freshEntry, setFreshEntry] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setMessages((prev) => patchLastBot(prev, fn));

  /**
   * Resolves whether the message reached the group. False only when the server
   * refused it outright: the bubble is taken back and the composer gets the
   * words back, because a bubble that looks delivered over an empty box is a
   * message silently lost. A chain that fails later was still delivered.
   */
  async function send(text: string): Promise<boolean> {
    const message = text.trim();
    if (!message || pending) return false;
    setFreshEntry(false);
    setPending(true);
    playFeedback("send");
    const optimistic: ChatMsg = {
      role: "user",
      text: message,
      sentAt: new Date().toISOString(),
      author: {
        name:
          roster.find((entry) => entry.id === currentUserId)?.name ?? "You",
        avatarSeed: currentUserId,
      },
    };
    setMessages((prev) => [...prev, optimistic]);

    let delivered = false;
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
      delivered = true;
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
              sentAt: new Date().toISOString(),
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
              { role: "notice", sentAt: message.createdAt, text: channelMessageText(message.content) },
            ]);
            return;
          }
          if (message.authorType === "teammate") {
            updateLastBot((bot) => ({ ...bot, id: message.id, sentAt: message.createdAt }));
          }
        },
        // One `reply` per finished Teammate turn in the chain, never per
        // token; a cap marker is a notice and sounds like nothing.
        onEvent: (event) => {
          const cue = chatFeedbackForEvent(event);
          if (cue) playFeedback(cue);
        },
        errorText: (text) => `⚠️ ${text}`,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Channel message failed"
      );
      if (!delivered) {
        setMessages((prev) => prev.filter((entry) => entry !== optimistic));
      }
    } finally {
      setPending(false);
      // The roster's last-activity order and unread badges are server state.
      startTransition(() => router.refresh());
    }
    return delivered;
  }

  const seatedTeammates = roster.filter((entry) => entry.kind === "teammate");

  // Who the @ picker offers: everybody here but the writer, wearing the same
  // face the header strip resolves for them.
  const withFaces = roster.map((entry) => ({
    ...entry,
    avatarSeed: rosterAvatarSeed(entry, teammates),
    title: teammates.find((teammate) => teammate.id === entry.id)?.title,
  }));
  const mentionTargets = withFaces.filter(
    (entry) => entry.id !== currentUserId
  );

  /**
   * Adding is the operation plus its report. It rethrows on purpose: the picker
   * closes when the promise resolves, so swallowing the failure here would shut
   * the panel on a group that did not change.
   */
  async function addToGroup(run: () => Promise<void>, done: string) {
    try {
      await run();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add them");
      throw error;
    }
  }

  /**
   * The two things you can put in a group, each with its own operation. A
   * Teammate is added and a person is invited: the same gesture, and two
   * different words on the row, because one of them notifies a colleague.
   */
  const addSections: AssigneeGroup[] = [
    {
      label: "Teammates",
      empty: "Every teammate you can add is already here.",
      items: addableTeammates.map((teammate) => ({
        id: teammate.id,
        name: teammate.name,
        seed: teammateAvatarSeed(teammate),
        note: teammate.title,
      })),
      onPick: (item) =>
        addToGroup(
          () => addChannelTeammatesAction(channel.id, [item.id]),
          `${item.name} is in the group`
        ),
    },
    {
      label: "People",
      empty: "Everybody in the organization is already here.",
      actionLabel: "Invite",
      items: invitableMembers.map((member) => ({
        id: member.userId,
        name: member.label,
        seed: member.userId,
      })),
      onPick: (item) =>
        addToGroup(
          () => addChannelMembersAction(channel.id, [item.id]),
          `${item.name} was invited`
        ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SlotPortal id={TOP_BAR_SLOT}>
        <div className="ml-auto flex items-center gap-2">
          {/* Who is in the room, and the only way to change it: the faces and
              the Add button are one block (`components/ui/assignees.tsx`), and
              both open the same picker. */}
          <Assignees
            assigned={withFaces.map((entry) => ({
              id: entry.id,
              name: entry.name,
              seed: entry.avatarSeed,
            }))}
            groups={addSections}
            label={`Who is in ${channel.name}`}
          />
          {canManage && (
            <Hint label="Name, project and roster">
              <Button
                variant="outline"
                size="sm"
                aria-label="Group settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-4" />
              </Button>
            </Hint>
          )}
        </div>
      </SlotPortal>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-5">
        <ChatSurface fullscreen={fullscreen} animating={animating} surfaceRef={surfaceRef} spacerRef={spacerRef}>
        <ChatHeader
          nickname={channel.name}
          historyOpen={!freshEntry}
          onToggleHistory={() => {
            setFreshEntry(!freshEntry);
            setEntryVersion((version) => version + 1);
          }}
          onNewChat={() => {
            // A group is one shared history: start at a blank live edge without deleting it.
            setFreshEntry(true);
            setEntryVersion((version) => version + 1);
          }}
          busy={pending}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
        />
        <MessageScroller
          key={entryVersion}
          className="min-h-0 flex-1"
          busy={pending}
          status={liveTurnStatus(messages, pending)}
          navigation="rail"
          viewportClassName={`py-5 [container-type:size] ${WIDEN_TRANSITION} ${fullscreen ? FULLSCREEN_GUTTER : "px-4"}`}
          contentClassName="space-y-4"
        >
          <ChatThread
            messages={messages}
            showTimestamps
            pending={pending}
            onSend={send}
            // The whole roster, not `mentionTargets`: a colleague naming *you*
            // is the mention that matters most, and the picker's list is the one
            // place your own name is deliberately absent.
            renderUserText={(text) => (
              <MentionText text={text} targets={withFaces} />
            )}
          />
          {/* Keep history above the initial viewport. Sending rejoins the live edge. */}
          {freshEntry && (
            <div aria-hidden="true" data-slot="group-entry-space" className="h-[calc(100cqh+3rem)]" />
          )}
        </MessageScroller>

        <div className={`shrink-0 space-y-1.5 ${WIDEN_TRANSITION} ${fullscreen ? "px-[max(1.5rem,calc((100%-56rem)/2))] pb-6" : "px-4 pb-4"}`}>
          <GroupComposer
            targets={mentionTargets}
            onSubmit={send}
            pending={pending}
            // No `#` here. The channel name with a hash in front of it reads as
            // something you can type or click, and nothing in this composer
            // resolves a `#`: the only token it understands is `@`. So the
            // placeholder offers the one thing that works, and says nothing
            // about a syntax that does not exist.
            placeholder={
              seatedTeammates.length > 0
                ? `Write @${seatedTeammates[0].name} to ask a teammate…`
                : "Message the group…"
            }
            aria-label={`Message ${channel.name}`}
          />
          <p className="text-muted-foreground text-center text-xs">
            Teammates answer when you name them with @. One message runs at most{" "}
            {CHANNEL_CHAIN_TURN_CAP} teammate replies.
          </p>
        </div>
        </ChatSurface>
      </div>

      {canManage && (
        <ChannelSettingsDialog
          open={settingsOpen}
          channel={channel}
          roster={roster}
          teammates={teammates}
          projects={projects}
          currentUserId={currentUserId}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function ChannelSettingsDialog({
  open,
  channel,
  roster,
  teammates,
  projects,
  currentUserId,
  onClose,
}: {
  open: boolean;
  channel: TeammateChannel;
  roster: ChannelRosterEntry[];
  /** Only to resolve a seated Teammate's avatar seed. */
  teammates: Teammate[];
  projects: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [projectId, setProjectId] = useState(channel.projectId ?? "");
  const [isPending, startTransition] = useTransition();
  // Which button started the transition, so only Save says "Saving…".
  const [saving, setSaving] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  // Seeded from the channel each time the dialog opens, during render (the
  // derived-state pattern): seeded once, a rename made elsewhere, or edits
  // abandoned last time, came back on the next open.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(channel.name);
      setProjectId(channel.projectId ?? "");
    }
  }

  const dirty =
    name !== channel.name || projectId !== (channel.projectId ?? "");

  const { leave } = useUnsavedChanges({
    dirty: open && dirty,
    confirmDelete,
    description: "The name and project edits are not saved yet.",
  });

  function requestClose() {
    // Closing mid-save would hide whether the save landed.
    if (isPending) return;
    leave(onClose);
  }

  function run(work: () => Promise<void>, done: string, back?: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
        if (back) router.push(back);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save the group"
        );
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <>
    {confirmDeleteModal}
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
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
            <Select
              value={projectId || "__no_project__"}
              onValueChange={(value) =>
                setProjectId(
                  value === null || value === "__no_project__" ? "" : value,
                )
              }
            >
              <SelectTrigger
                id="channel-project"
                className="h-10 w-full"
                aria-label="Project"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__no_project__">No project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Every teammate here reads the project&apos;s decisions, and writes
              what this channel settles back to them.
            </p>
          </div>
          <Button
            disabled={isPending || !name.trim() || !dirty}
            onClick={() => {
              setSaving(true);
              run(
                async () => {
                  await updateChannelAction(channel.id, {
                    name: name.trim(),
                    projectId: projectId || null,
                  });
                },
                "Group saved"
              );
            }}
          >
            <RollInText text={saving ? "Saving…" : "Save"} />
          </Button>

          <section className="space-y-2 border-t pt-4">
            <Label>Who is here</Label>
            <ul className="space-y-1">
              {roster.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3">
                  <GeneratedAvatar
                    seed={rosterAvatarSeed(entry, teammates)}
                    size="size-7"
                  />
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
                    onClick={() => {
                      const leaving = entry.id === currentUserId;
                      confirmDelete({
                        title: leaving
                          ? "Leave this group?"
                          : `Remove ${entry.name}?`,
                        description: leaving
                          ? "You stop seeing the thread. Someone who manages the group has to add you back."
                          : `${entry.name} stops seeing the thread and is no longer mentioned in it.`,
                        confirmLabel: leaving ? "Leave group" : "Remove",
                        onConfirm: () =>
                          run(
                            () =>
                              entry.kind === "member"
                                ? removeChannelMemberAction(channel.id, entry.id)
                                : removeChannelTeammateAction(channel.id, entry.id),
                            `${entry.name} left the group`,
                            leaving ? "/teammates" : undefined
                          ),
                      });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              Closing the group deletes the thread for everybody in it,
              including its transcript.
            </p>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                confirmDelete({
                  title: "Close this group?",
                  description:
                    "The thread and its transcript are deleted for everybody in it. This cannot be undone.",
                  confirmLabel: "Close group",
                  onConfirm: () =>
                    run(
                      () => deleteChannelAction(channel.id),
                      "Group closed",
                      "/teammates"
                    ),
                })
              }
            >
              <Trash2 className="size-4" /> Close group
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
