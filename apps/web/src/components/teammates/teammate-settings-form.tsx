"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import { MEMORY_DOCUMENT_MAX_CHARS } from "@agent-hub/core";
import { ChevronRight, Shuffle } from "lucide-react";
import { Button, Input, Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  deleteTeammateAction,
  readTeammateMemoryAction,
  setTeammateGrantsAction,
  updateTeammateAction,
  writeTeammateMemoryAction,
} from "@/app/(admin)/teammates/actions";
import { KnowledgeScopePicker } from "@/components/teammates/knowledge-scope-picker";
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
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";

/**
 * The Teammate's configuration. Everything here takes effect on the next
 * message: a Teammate has no Publication, so there is no publish button and
 * nothing to re-publish.
 *
 * One component for both the drawer over the chat and the full-screen route,
 * the way `ImprovementDetail` serves its own two: the fields, the saves and
 * the capability rules are the same decisions wherever they are made, and a
 * form that drifted between the two would be two products.
 *
 * Every field is seeded once, at mount, and the drawer mounts this only while
 * it is open, so "seeded at mount" means "seeded when you opened it".
 *
 * The Agent memory layer needs more than that, because it is the one field the
 * Teammate writes itself, from the job ledger at the end of a conversation,
 * without anything re-rendering the page. Fresh props would still be stale
 * props, so it is read on open instead.
 */
export function TeammateSettingsForm({
  teammate,
  collections,
  sources,
  sourcesTruncated,
  members,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
  variant = "page",
  onDone,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  /** The Library items its scope can name one at a time (PRD #726). */
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  members: MemberOption[];
  /** Live Projects it can attach to; archived ones are not offered (#771). */
  projects: { id: string; name: string }[];
  /**
   * Its Agent memory layer as the page rendered it. Shown while the read on
   * open is in flight; the read is what the editor then works from.
   */
  learnings: string;
  /** Its standing instructions (#772). This only renders for an editor. */
  routines: TeammateRoutine[];
  /** What it may do today; the picker is read-only unless `canGrant`. */
  governance: TeammateGovernanceState;
  /** Granting is admin work, one rung above editing the persona. */
  canGrant: boolean;
  /**
   * "drawer" drops the breadcrumb (the drawer has its own header) and pins the
   * actions to the bottom of the panel, which scrolls; the page lets them sit
   * at the end of the form.
   */
  variant?: "page" | "drawer";
  /** Saved, cancelled or done: close the drawer, or leave the page. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(teammate.name);
  const [title, setTitle] = useState(teammate.title);
  const [roleDescription, setRoleDescription] = useState(
    teammate.roleDescription
  );
  const [collectionIds, setCollectionIds] = useState(teammate.collectionIds);
  const [sourceIds, setSourceIds] = useState(teammate.sourceIds);
  const [editorIds, setEditorIds] = useState(teammate.editorIds);
  const [visibility, setVisibility] = useState(teammate.visibility);
  const [avatarSeed, setAvatarSeed] = useState(teammate.avatarSeed);
  const [grants, setGrants] = useState<TeammateGovernanceState>(governance);
  const [projectId, setProjectId] = useState(teammate.projectId);
  const [agentMemory, setAgentMemory] = useState(learnings);
  /**
   * The Agent layer as it actually stands, read when this mounts. `null` until
   * that read lands, and it is the baseline the save compares against: with no
   * baseline there is nothing to say the editor's text is a change rather than
   * a page-old copy, so the save writes nothing.
   */
  const [loadedMemory, setLoadedMemory] = useState<string | null>(null);
  /**
   * The read failed. The field stays read-only rather than let a save put a
   * body of unknown age over whatever the Teammate has since written; closing
   * and reopening retries.
   */
  const [memoryUnreadable, setMemoryUnreadable] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Guards the slow case: a response that arrives after this was closed, or
    // after the Member reopened it and got a fresh mount, must not land in a
    // form that has moved on.
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
          sourceIds,
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
        onDone();
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
    <div className="space-y-6 px-6 py-5">
      {variant === "page" ? (
        <nav className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Link href="/teammates" className="hover:text-foreground">
            Teammates
          </Link>
          <ChevronRight className="size-3.5" />
          <Link
            href={`/teammates/${teammate.id}`}
            className="hover:text-foreground"
          >
            {teammate.name}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Configure</span>
        </nav>
      ) : (
        <h2 className="text-xl font-semibold">Configure {teammate.name}</h2>
      )}

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
          onChange={(e) => setRoleDescription(e.target.value.slice(0, 10000))}
          rows={8}
        />
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
            setAgentMemory(e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS))
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

      <div
        className={`flex items-center gap-2 border-t pt-4 ${
          // Pinned in the drawer, whose whole body scrolls: Save has to stay
          // reachable from anywhere in a form this long.
          variant === "drawer" ? "bg-background sticky bottom-0 -mx-6 px-6 pb-4" : ""
        }`}
      >
        <Button
          variant="ghost"
          className="text-destructive h-10"
          onClick={remove}
          disabled={isPending}
        >
          Delete teammate
        </Button>
        <Button variant="outline" className="ml-auto h-10 px-5" onClick={onDone}>
          Cancel
        </Button>
        <Button className="h-10 px-5" onClick={save} disabled={isPending}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
