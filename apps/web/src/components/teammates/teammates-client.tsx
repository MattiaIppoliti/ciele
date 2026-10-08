"use client";

import {
  Suspense,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useSetTopBarSlot } from "@/components/shell/top-bar-slots";
import { MessagesSquare, Settings2 } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useTopBarFormActions } from "@/components/settings/form-actions";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ChannelUnread, Teammate, TeammateVisibility } from "@agent-hub/core";
import { DialogBody, DialogFooter, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Skeleton } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { createTeammateAction, updateTeammateAction } from "@/app/(admin)/teammates/actions";
import { createChannelAction } from "@/app/(admin)/teammates/channels/actions";
import { KnowledgeScopePicker } from "@/components/teammates/knowledge-scope-picker";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";
import { ProjectSection } from "@/components/teammates/project-section";
import { VisibilityPicker } from "@/components/teammates/visibility-picker";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { RollInText } from "@/components/motion/roll-in-text";
import { LeaveGuardProvider } from "@/components/teammates/leave-guard";
import {
  ChatSidebarPanel,
  type SidebarConversation,
} from "@/components/teammates/chat-sidebar-panel";
import { chatSession } from "@/lib/chat-session";
import { useShell } from "@/components/shell/shell-provider";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";

/** Past this many people, the channel dialog's picker gets a filter. */
const PEOPLE_FILTER_AT = 12;

export interface CollectionOption {
  id: string;
  name: string;
}

/** One group ("channel" in the code) row on the roster (#778). */
export interface ChannelRow {
  canDelete: boolean;
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

export function CreateTeammatePage({
  collections,
  sources,
  sourcesTruncated,
  projects,
}: {
  collections: CollectionOption[];
  /** The Library items the new Teammate's scope can name one at a time. */
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  /** Live Projects the new Teammate can attach to right away (#771). */
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const onClose = () => router.push("/teammates");
  const setSlot = useSetTopBarSlot();
  useEffect(() => {
    setSlot("title", <span>Teammates › New AI Teammate</span>);
    return () => setSlot("title", null);
  }, [setSlot]);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<TeammateVisibility>("org");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setTitle("");
    setRoleDescription("");
    setCollectionIds([]);
    setSourceIds([]);
    setVisibility("org");
    setProjectId(null);
  }

  /**
   * A role fills only what is still blank or still holds another role's text:
   * switching roles swaps the preset, and a name somebody typed survives it.
   */
  function pick(template: (typeof TEMPLATES)[number]) {
    const untouched = (value: string, field: "name" | "title" | "roleDescription") =>
      value.trim() === "" || TEMPLATES.some((other) => other[field] === value);
    if (untouched(name, "name")) setName(template.name);
    if (untouched(title, "title")) setTitle(template.title);
    if (untouched(roleDescription, "roleDescription")) {
      setRoleDescription(template.roleDescription);
    }
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
        reset();
        router.push(`/teammates/${teammate.id}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create the teammate"
        );
      }
    });
  }

  const formActions = useTopBarFormActions({ dirty: Boolean(name.trim()), saving: isPending, saveLabel: "Create teammate", cancelAlwaysEnabled: true, onSave: handleCreate, onCancel: onClose });
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
        <SectionHeading icon={Settings2} title="New AI Teammate"  />
        <div className="pt-10 pb-24"><SectionTimeline>
        <TimelineSection title="Start from a role" boxed>

        <div className="space-y-2">

          <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
            {TEMPLATES.map((template) => (
              <button
                key={template.title}
                type="button"
                onClick={() => pick(template)}
                aria-pressed={title === template.title}
className={`press-control flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-medium transition-colors ${
                  title === template.title
                    ? "border-primary ring-primary/30 shadow-light ring-1"
                    : "hover:bg-muted/50"
                }`}
              >
                <span aria-hidden="true" className="text-2xl">
                  {template.emoji}
                </span>
                {template.title}
              </button>
            ))}
          </div>
        </div>

        </TimelineSection>
        <TimelineSection title="Identity" boxed>
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

        </TimelineSection>
        <TimelineSection title="Standing role" boxed>
        <div className="space-y-2">
          <Label htmlFor="teammate-role" className="sr-only">Standing role</Label>
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
            Changes apply from the next message. No publishing needed.
          </p>
        </div>

        </TimelineSection>
        <TimelineSection title="Knowledge" boxed>
        <KnowledgeScopePicker
          collections={collections}
          sources={sources}
          sourcesTruncated={sourcesTruncated}
          collectionIds={collectionIds}
          sourceIds={sourceIds}
          onCollectionsChange={setCollectionIds}
          onSourcesChange={setSourceIds}
        />

        </TimelineSection>
        <TimelineSection title="Project" boxed>
        <ProjectSection
          projects={projects}
          value={projectId}
          onChange={setProjectId}
          canEdit
        />

        </TimelineSection>
        <TimelineSection title="Access" boxed>
        <VisibilityPicker value={visibility} onChange={setVisibility} />

        </TimelineSection>
        </SectionTimeline>
        <div className="flex justify-end border-t pt-6">{formActions}</div>
        </div>
      </div>
    </div>
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
  const [peopleQuery, setPeopleQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // Chosen people stay listed whatever the filter says, so a pick never
  // disappears from view while it still counts.
  const peopleNeedle = peopleQuery.trim().toLowerCase();
  const shownMembers = peopleNeedle
    ? members.filter(
        (member) =>
          memberIds.includes(member.userId) ||
          member.label.toLowerCase().includes(peopleNeedle)
      )
    : members;

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
        // Mounted in the layout, like the Teammate dialog: start blank next time.
        setName("");
        setTeammateIds([]);
        setMemberIds([]);
        setPeopleQuery("");
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
        <DialogBody className="space-y-5">
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
                No teammates yet. Create one first, or open the group and add it
                later.
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
                    aria-pressed={teammateIds.includes(teammate.id)}
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
              <>
                {members.length > PEOPLE_FILTER_AT && (
                  <Input
                    type="search"
                    value={peopleQuery}
                    onChange={(e) => setPeopleQuery(e.target.value)}
                    placeholder="Filter people…"
                    aria-label="Filter people"
                    autoComplete="off"
                    className="h-9"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {shownMembers.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      Nobody by that name.
                    </p>
                  )}
                  {shownMembers.map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      onClick={() =>
                        toggle(member.userId, memberIds, setMemberIds)
                      }
                      aria-pressed={memberIds.includes(member.userId)}
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
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            loading={isPending}
            className="w-full"
            disabled={isPending || !name.trim()}
            onClick={handleCreate}
          >
            <RollInText text={isPending ? "Opening…" : "Open group"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Teammates shell (#768, #778): the Chat surface.
 *
 * The page is the open thread and nothing else. The roster (as faces), the
 * groups and this Member's history draw in the shell's sidebar, portalled into
 * the slot it offers in Chat mode, the Notion AI layout: pick a face, the chat
 * opens in the middle. It used to be a two-pane page with its own rail, which
 * put a second navigation column beside the sidebar's.
 *
 * It is a layout rather than a page, so the data and the create dialogs
 * survive navigation between threads; `/teammates` itself renders only the
 * "pick one" placeholder.
 */
/** Everything the rail and the create dialogs read, loaded by the layout. */
export interface TeammatesShellData {
  /** The Organization's Ciele AI: pinned first, never hidden, never deleted. */
  cieleAi: Teammate;
  teammates: Teammate[];
  /** The ones this Member keeps off their rail (#767, story 10). */
  hidden: Teammate[];
  /** This Member's threads with the roster, newest first: the sidebar history. */
  conversations: SidebarConversation[];
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
}

export function TeammatesShell({
  data,
  children,
}: {
  /**
   * A promise, so the layout never awaits it: a layout's own awaits sit above
   * every Teammates loading.tsx, and seven reads held the open thread's
   * skeleton back. The rail, the New buttons and the dialogs wait for it; the
   * frame and the thread do not.
   */
  data: Promise<TeammatesShellData>;
  /** The open thread, or the placeholder at `/teammates`. */
  children: ReactNode;
}) {
  const router = useRouter();
  const [channelOpen, setChannelOpen] = useState(false);
  const touch = useTouchNavigation();
  const pathname = usePathname();
  const conversation = useSearchParams().get("c");
  const location = `${pathname}?c=${conversation ?? ""}`;
  const [roster, setRoster] = useState({ location, open: false });
  // A completed navigation closes the roster. A cancelled leave keeps it open.
  if (roster.location !== location) setRoster({ location, open: false });
  const rosterOpen = roster.location === location && roster.open;
  const setRosterOpen = (open: boolean) => setRoster({ location, open });
  const { chatSidebarSlot } = useShell();
  // The rows the chat reported belong to this visit to the chat area.
  useEffect(() => () => chatSession.leave(), []);

  return (
    <LeaveGuardProvider>
    {touch && <>
      <SlotPortal id={TOP_BAR_SLOT}>
        <Button variant="ghost" size="icon" aria-label="Teammates, groups and chat history" onClick={() => setRosterOpen(true)}>
          <MessagesSquare className="size-5" />
        </Button>
      </SlotPortal>
      <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
        <DialogContent data-touch-rail showCloseButton={false} className="inset-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none">
          <DialogHeader className="mb-3 flex-row items-center justify-between">
            <DialogTitle>Chats</DialogTitle>
            <Button variant="ghost" onClick={() => setRosterOpen(false)}>Done</Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Suspense fallback={<PanelSkeleton collapsed={false} />}>
              <SidebarPanel data={data} collapsed={false}
                onNewTeammate={() => { setRosterOpen(false); router.push("/teammates/new"); }}
                onNewGroup={() => { setRosterOpen(false); setChannelOpen(true); }}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </>}
    {/* A portal rather than a prop: the panel keeps this tree's context, the
        leave guard above all, while it draws inside the shell's sidebar. */}
    {chatSidebarSlot &&
      createPortal(
        <Suspense fallback={<PanelSkeleton collapsed={chatSidebarSlot.collapsed} />}>
          <SidebarPanel
            data={data}
            collapsed={chatSidebarSlot.collapsed}
            onNewTeammate={() => router.push("/teammates/new")}
            onNewGroup={() => setChannelOpen(true)}
          />
        </Suspense>,
        chatSidebarSlot.element
      )}
    {/* The whole page is the open thread: the roster, the history and both
        New buttons live in the sidebar's Chat panel, on every screen size
        (the phone drawer mounts the same panel). */}
    <div className="touch-scroll-clearance flex h-full min-h-0 flex-col overflow-hidden">
      {/* The top bar's breadcrumb is the visible title. */}
      <h1 className="sr-only">Teammates</h1>
      <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </section>

      <Suspense fallback={null}>
        <ShellDialogs
          data={data}
          channelOpen={channelOpen}
          onCloseChannel={() => setChannelOpen(false)}
        />
      </Suspense>
    </div>
    </LeaveGuardProvider>
  );
}

function SidebarPanel({
  data,
  collapsed,
  onNewTeammate,
  onNewGroup,
}: {
  data: Promise<TeammatesShellData>;
  collapsed: boolean;
  onNewTeammate: () => void;
  onNewGroup: () => void;
}) {
  const { cieleAi, teammates, hidden, channels, conversations, canEdit } = use(data);
  // Subscribed so a reported row shows the moment the chat reports it.
  useSyncExternalStore(chatSession.subscribe, chatSession.getSnapshot, chatSession.getSnapshot);
  return (
    <ChatSidebarPanel
      cieleAi={cieleAi}
      teammates={teammates}
      hidden={hidden}
      channels={channels}
      conversations={chatSession.conversations(conversations)}
      canEdit={canEdit}
      collapsed={collapsed}
      onNewTeammate={onNewTeammate}
      onNewGroup={onNewGroup}
    />
  );
}

/** Faces, then history rows, at the panel's own sizes. */
function PanelSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div role="status" aria-busy="true" className="pt-1">
      <span className="sr-only">Loading teammates…</span>
      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="size-8 rounded-full" />
          ))}
        </div>
      ) : (
        <>
          <Skeleton className="mx-1 my-2 h-3 w-20" />
          <div className="grid grid-cols-4 gap-y-2 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 py-1">
                <Skeleton className="size-11 rounded-full" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
          <Skeleton className="mx-1 mt-5 mb-2 h-3 w-24" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mx-1 my-1.5 h-5" />
          ))}
        </>
      )}
    </div>
  );
}

function ShellDialogs({
  data,
  channelOpen,
  onCloseChannel,
}: {
  data: Promise<TeammatesShellData>;
  channelOpen: boolean;
  onCloseChannel: () => void;
}) {
  const { teammates, members } = use(data);
  return (
    <>
      <CreateChannelDialog
        open={channelOpen}
        teammates={teammates}
        members={members}
        onClose={onCloseChannel}
      />
    </>
  );
}
