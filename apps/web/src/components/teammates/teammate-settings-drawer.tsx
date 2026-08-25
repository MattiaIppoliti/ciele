"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import { MEMORY_DOCUMENT_MAX_CHARS } from "@agent-hub/core";
import { Shuffle, X } from "lucide-react";
import { Button, Hint, Input, Label } from "@agent-hub/ui";
import {
  ResizeHandle,
  useResizableWidth,
} from "@/components/ui/resizable-panel";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  deleteTeammateAction,
  readTeammateMemoryAction,
  setTeammateGrantsAction,
  updateTeammateAction,
  writeTeammateMemoryAction,
} from "@/app/(admin)/teammates/actions";
import { CollectionScopePicker } from "@/components/teammates/collection-scope-picker";
import {
  TeammateEditorsPicker,
  type MemberOption,
} from "@/components/teammates/teammate-editors-picker";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { VisibilityPicker } from "@/components/teammates/visibility-picker";
import { ProjectSection } from "@/components/teammates/project-section";
import { RoutinesPanel } from "@/components/teammates/routines-panel";
import {
  TeammateGrantsPicker,
  type TeammateGovernanceState,
} from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";

const PANEL_MIN_WIDTH = 420;
const PANEL_DEFAULT_WIDTH = 620;
const PANEL_MAX_WIDTH = 1000;

/**
 * The Teammate's configuration, as a right-side drawer over the chat: the
 * Improvements board's panel, with this form inside it. Everything here takes
 * effect on the next message: a Teammate has no Publication, so there is no
 * publish button and nothing to re-publish.
 *
 * Every field is seeded once, at mount, and the workspace mounts this
 * component only while it is open, so "seeded at mount" means "seeded when you
 * opened it" without the remount key the old dialog needed.
 *
 * The Agent memory layer needs more than that, because it is the one field the
 * Teammate writes itself, from the job ledger at the end of a conversation,
 * without anything re-rendering the page. Fresh props would still be stale
 * props, so it is read on open instead.
 */
export function TeammateSettingsDrawer({
  teammate,
  collections,
  members,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
  onClose,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  members: MemberOption[];
  /** Live Projects it can attach to; archived ones are not offered (#771). */
  projects: { id: string; name: string }[];
  /**
   * Its Agent memory layer as the page rendered it. Shown while the read on
   * open is in flight; the read is what the editor then works from.
   */
  learnings: string;
  /** Its standing instructions (#772). The drawer only opens for an editor. */
  routines: TeammateRoutine[];
  /** What it may do today; the picker is read-only unless `canGrant`. */
  governance: TeammateGovernanceState;
  /** Granting is admin work, one rung above editing the persona. */
  canGrant: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(teammate.name);
  const [title, setTitle] = useState(teammate.title);
  const [roleDescription, setRoleDescription] = useState(
    teammate.roleDescription
  );
  const [collectionIds, setCollectionIds] = useState(teammate.collectionIds);
  const [editorIds, setEditorIds] = useState(teammate.editorIds);
  const [visibility, setVisibility] = useState(teammate.visibility);
  const [avatarSeed, setAvatarSeed] = useState(teammate.avatarSeed);
  const [grants, setGrants] = useState<TeammateGovernanceState>(governance);
  const [projectId, setProjectId] = useState(teammate.projectId);
  const [agentMemory, setAgentMemory] = useState(learnings);
  /**
   * The Agent layer as it actually stands, read when the drawer opens. `null`
   * until that read lands, and it is the baseline the save compares against:
   * with no baseline there is nothing to say the editor's text is a change
   * rather than a page-old copy, so the save writes nothing.
   */
  const [loadedMemory, setLoadedMemory] = useState<string | null>(null);
  /**
   * The read failed. The field stays read-only rather than let a save put a
   * body of unknown age over whatever the Teammate has since written; closing
   * and reopening retries.
   */
  const [memoryUnreadable, setMemoryUnreadable] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { width, resizing, setResizing, containerRef } = useResizableWidth({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
  });

  useEffect(() => {
    // Guards the slow case: a response that arrives after the drawer was
    // closed, or after the Member reopened it and got a fresh mount, must not
    // land in a form that has moved on.
    let live = true;
    readTeammateMemoryAction(teammate.id)
      .then(({ document }) => {
        if (!live) return;
        const body = document?.body ?? "";
        setLoadedMemory(body);
        setAgentMemory(body);
      })
      .catch(() => {
        if (live) setMemoryUnreadable(true);
      });
    return () => {
      live = false;
    };
  }, [teammate.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (!name.trim()) {
      toast.error("Your teammate needs a name");
      return;
    }
    startTransition(async () => {
      try {
        await updateTeammateAction(teammate.id, {
          name: name.trim(),
          title: title.trim(),
          roleDescription,
          collectionIds,
          editorIds,
          visibility,
          avatarSeed,
          projectId,
        });
        // A separate write because it is a separate document, and only when
        // it changed against what the read on open returned: an untouched
        // layer must not gain a history entry saying somebody edited it, and a
        // layer we never managed to read is not one to write.
        if (loadedMemory !== null && agentMemory !== loadedMemory) {
          await writeTeammateMemoryAction(teammate.id, agentMemory);
        }
        // Two writes because they are two capabilities: an Editor saving the
        // persona must not be refused for a grants change they cannot make and
        // did not attempt, so the second only runs for an admin who touched it.
        if (canGrant && changedGrants) {
          await setTeammateGrantsAction(teammate.id, grants);
        }
        toast.success("Saved, it applies to the next message");
        onClose();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save");
      }
    });
  }

  const changedGrants =
    grants.ceiling !== governance.ceiling ||
    grants.approvalBypass !== governance.approvalBypass ||
    grants.domains.length !== governance.domains.length ||
    grants.domains.some((domain) => !governance.domains.includes(domain));

  function remove() {
    if (
      !confirm(
        `Delete ${teammate.name}? Your conversations with it stay readable, but nobody can chat with it again.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteTeammateAction(teammate.id);
        router.push("/teammates");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete");
      }
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={containerRef}
        role="dialog"
        aria-label={`Configure ${teammate.name}`}
        style={{ width }}
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l shadow-xl"
      >
        <ResizeHandle
          resizing={resizing}
          onPointerDown={() => setResizing(true)}
          label="Resize teammate panel"
        />
        <header className="flex shrink-0 items-center justify-between gap-1 border-b px-6 py-3">
          <h2 className="truncate text-lg font-semibold">
            Configure {teammate.name}
          </h2>
          <Hint label="Close">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close teammate panel"
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>
          </Hint>
        </header>

        {/* Inner scroll container, overflow lives here, not on the aside, so
            the handle poking out at -left-1.5 isn't clipped. */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <TeammateAvatar
              teammate={{ ...teammate, name, avatarSeed }}
              className="size-12"
            />
            <Button
              variant="outline"
              size="sm"
              // The avatar is generated from a seed rather than uploaded, so
              // "change the picture" is "take another seed".
              onClick={() => setAvatarSeed(`${teammate.id}-${Date.now()}`)}
            >
              <Shuffle className="size-4" /> Change colour
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 120))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-role">Standing role</Label>
            <Textarea
              id="edit-role"
              value={roleDescription}
              onChange={(e) =>
                setRoleDescription(e.target.value.slice(0, 10000))
              }
              rows={8}
            />
          </div>

          <CollectionScopePicker
            collections={collections}
            selected={collectionIds}
            onChange={setCollectionIds}
          />

          <ProjectSection
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            canEdit
            teammateNames={{ [teammate.id]: teammate.name }}
          />

          <div className="space-y-2">
            <Label htmlFor="edit-learnings">What it has learned</Label>
            <Textarea
              id="edit-learnings"
              value={agentMemory}
              rows={6}
              // Read-only until the read on open lands, so nobody types into a
              // value that is about to be replaced by a newer one.
              disabled={loadedMemory === null}
              placeholder="Nothing yet. It adds a line here when a conversation teaches it something durable about this role."
              onChange={(e) =>
                setAgentMemory(
                  e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS)
                )
              }
            />
            <p className="text-muted-foreground text-sm">
              {memoryUnreadable
                ? "Could not read the latest notes, so they are shown as the page loaded them and cannot be edited here. Close and reopen to try again."
                : "Its own notes, added at the end of a conversation. Edit or delete a line that is wrong; it reads this every message."}
            </p>
          </div>

          <TeammateGrantsPicker
            value={grants}
            onChange={setGrants}
            canGrant={canGrant}
          />

          <RoutinesPanel routines={routines} teammateId={teammate.id} canEdit />

          <VisibilityPicker value={visibility} onChange={setVisibility} />

          <TeammateEditorsPicker
            members={members}
            selected={editorIds}
            onChange={setEditorIds}
          />
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t px-6 py-4">
          <Button
            variant="ghost"
            className="text-destructive h-10"
            onClick={remove}
            disabled={isPending}
          >
            Delete teammate
          </Button>
          <Button
            variant="outline"
            className="ml-auto h-10 px-5"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button className="h-10 px-5" onClick={save} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </footer>
      </aside>
    </>
  );
}
