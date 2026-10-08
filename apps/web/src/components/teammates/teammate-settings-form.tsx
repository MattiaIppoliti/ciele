"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ModelRef,
  ModelSource,
  PlatformEvalModel,
  Provider,
  Teammate,
  TeammateRoutine,
  TeammateRuntimeConfig,
} from "@agent-hub/core";
import { isCieleAi, modelSelector, teammateRuntimeConfig } from "@agent-hub/core";
import { PROVIDER_NAMES, currentModelId } from "@agent-hub/agent/client";
import { teammateModelPatch } from "@/lib/teammates/model-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelSourceSelect } from "@/components/chat/model-source-select";
import { modelCatalogWith } from "@/lib/platform-model-catalog";
import { MEMORY_DOCUMENT_MAX_CHARS } from "@agent-hub/core";
import { ChevronRight, Settings2, Shuffle } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useSetTopBarSlot } from "@/components/shell/top-bar-slots";
import { Button, Input, Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  deleteTeammateAction,
  readTeammateMemoryAction,
  setTeammateGrantsAction,
  updateTeammateAction,
  configureTeammateRuntimeAction,
  writeTeammateMemoryAction,
} from "@/app/(admin)/teammates/actions";
import { KnowledgeScopePicker } from "@/components/teammates/knowledge-scope-picker";
import {
  ModelAllowList,
  modelAllowListSummary,
} from "@/components/chat/model-allow-list";
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
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useGuardedLinkClick, useLeaveGuard } from "@/components/teammates/leave-guard";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { useTopBarFormActions } from "@/components/settings/form-actions";
import { TeammateExecutionSettings } from "./teammate-execution-settings";

/**
 * The Teammate's configuration. Everything here takes effect on the next
 * message: a Teammate has no Publication, so there is no publish button and
 * nothing to re-publish.
 *
 * One surface, `/teammates/{id}/settings`. It used to be two, this route and a
 * drawer over the chat holding the same form, which is why the component takes
 * no variant: two ways into one configuration are two things to keep looking
 * alike, and the chat's Configure button now simply comes here.
 *
 * Every field is seeded once, at mount, which is when the route rendered.
 *
 * The Agent memory layer needs more than that, because it is the one field the
 * Teammate writes itself, from the job ledger at the end of a conversation,
 * without anything re-rendering the page. Fresh props would still be stale
 * props, so it is read on mount instead.
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
  unavailableProviders,
  platformModels,
  modelSources,
  headerActions,
  onDone,
  executionOptions = { computerConfigured: false, harnesses: [] },
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
  /** Providers with no credential; their models stay out of the picker. */
  unavailableProviders: Provider[];
  platformModels: PlatformEvalModel[];
  /** Sources per catalogue model (`modelSourcesByModel`), for the Source select. */
  modelSources: Record<string, ModelSource[]>;
  /** What it may do today; the picker is read-only unless `canGrant`. */
  governance: TeammateGovernanceState;
  /** Granting is admin work, one rung above editing the persona. */
  canGrant: boolean;
  /**
   * Rendered at the right of the breadcrumb row. The page's full-screen
   * toggle, which belongs to the surface rather than to the form.
   */
  headerActions?: ReactNode;
  /** Saved, cancelled or done: close the drawer, or leave the page. */
  onDone: () => void;
  executionOptions?: { computerConfigured: boolean; harnesses: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const [runtime, setRuntime] = useState<TeammateRuntimeConfig>(() => teammateRuntimeConfig(teammate));
  const runtimeDirty = JSON.stringify(runtime) !== JSON.stringify(teammateRuntimeConfig(teammate));
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
  const [allowedModels, setAllowedModels] = useState<ModelRef[]>(
    teammate.allowedModels ?? []
  );
  const modelCatalog = modelCatalogWith(platformModels);
  const [modelProvider, setModelProvider] = useState(teammate.modelProvider);
  const [modelId, setModelId] = useState(teammate.modelId);
  const modelPatch = teammateModelPatch(teammate, { modelProvider, modelId });
  const modelDirty = Object.keys(modelPatch).length > 0;
  const allowedModelsDirty = JSON.stringify(allowedModels) !== JSON.stringify(teammate.allowedModels ?? []);
  const [modelSource, setModelSource] = useState<ModelSource | null>(
    teammate.modelSource ?? null
  );
  const modelSourceDirty = modelSource !== (teammate.modelSource ?? null);
  const [agentMemory, setAgentMemory] = useState(learnings);
  /**
   * The Agent layer as it actually stands, read when this mounts. `null` until
   * that read lands, and it is the baseline the save compares against: with no
   * baseline there is nothing to say the editor's text is a change rather than
   * a page-old copy, so the save writes nothing.
   */
  const [loadedMemory, setLoadedMemory] = useState<string | null>(null);
  /** The Agent layer's version as read, so a save over a newer write is refused. */
  const [loadedMemoryVersion, setLoadedMemoryVersion] = useState<string | null>(null);
  /**
   * The read failed. The field stays read-only rather than let a save put a
   * body of unknown age over whatever the Teammate has since written; closing
   * and reopening retries.
   */
  const [memoryUnreadable, setMemoryUnreadable] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  // The Organization's AI layer: same form, minus what has no effect on it.
  const platformLayer = isCieleAi(teammate);

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
        setLoadedMemoryVersion(document?.updatedAt ?? null);
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
          ...modelPatch,
          ...(allowedModelsDirty ? { allowedModels } : {}),
          // Only when it moved: see the Assistant's General form.
          ...(modelSourceDirty ? { modelSource } : {}),
        });
        // A separate write because it is a separate document, and only when
        // it changed against what the read on open returned: an untouched
        // layer must not gain a history entry saying somebody edited it, and a
        // layer we never managed to read is not one to write.
        if (loadedMemory !== null && agentMemory !== loadedMemory) {
          await writeTeammateMemoryAction(teammate.id, agentMemory, "", loadedMemoryVersion);
        }
        // Two writes because they are two capabilities: an Editor saving the
        // persona must not be refused for a grants change they cannot make and
        // did not attempt, so the second only runs for an admin who touched it.
        if (canGrant && changedGrants) {
          await setTeammateGrantsAction(teammate.id, grants);
        }
        if (canGrant && runtimeDirty) await configureTeammateRuntimeAction(teammate.id, runtime);
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

  const sameIds = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  // Every field against what the page loaded, and memory against the read on
  // open. Cancel, the breadcrumb and a reload used to drop an edited persona,
  // scope or set of grants without a word; while this is true they ask first.
  const dirty =
    name !== teammate.name ||
    title !== teammate.title ||
    roleDescription !== teammate.roleDescription ||
    !sameIds(collectionIds, teammate.collectionIds) ||
    !sameIds(sourceIds, teammate.sourceIds) ||
    !sameIds(editorIds, teammate.editorIds) ||
    visibility !== teammate.visibility ||
    avatarSeed !== teammate.avatarSeed ||
    projectId !== teammate.projectId ||
    allowedModelsDirty ||
    modelDirty ||
    modelSourceDirty ||
    (loadedMemory !== null && agentMemory !== loadedMemory) ||
    changedGrants || runtimeDirty;

  /** Leave now, or after a Discard confirm when there are unsaved edits. */
  const { leave } = useUnsavedChanges({
    dirty,
    saving: isPending,
    confirmDelete,
    description: `The edits to ${teammate.name} are not saved yet.`,
  });

  // The Teammates rail sits in the layout, outside this form; it asks here too.
  useLeaveGuard(dirty, leave);

  // The breadcrumb, in the top bar rather than above the form: Teammates ›
  // this Teammate › Configure. Its links ask through the same guard as the
  // rail, which reads the current `dirty` at click time.
  const setSlot = useSetTopBarSlot();
  const guardedClick = useGuardedLinkClick();
  const chatHref = platformLayer ? "/teammates" : `/teammates/${teammate.id}`;
  useEffect(() => {
    setSlot(
      "title",
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        <Link href="/teammates" onClick={(event) => guardedClick(event, "/teammates")} className="text-muted-foreground hover:text-foreground">
          Teammates
        </Link>
        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
        <Link href={chatHref} onClick={(event) => guardedClick(event, chatHref)} className="text-muted-foreground hover:text-foreground truncate">
          <RollInText text={teammate.name} />
        </Link>
        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
        <span aria-current="page">Configure</span>
      </nav>
    );
    return () => setSlot("title", null);
  }, [chatHref, guardedClick, setSlot, teammate.name]);

  // The same Cancel and Save in the top bar, for a form this long.
  const formActions = useTopBarFormActions({
    className: "ml-auto",
    dirty,
    saving: isPending,
    saveLabel: "Save",
    cancelAlwaysEnabled: true,
    onSave: save,
    onCancel: () => leave(onDone),
  });

  function remove() {
    confirmDelete({
      title: `Delete ${teammate.name}?`,
      description:
        "Your conversations with it stay readable, but nobody can chat with it again.",
      confirmLabel: "Delete teammate",
      onConfirm: removeNow,
    });
  }

  function removeNow() {
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
    <div className="px-5 py-6 sm:px-8 sm:py-10">
      {confirmDeleteModal}
      {/* The way back lives in the top bar, as a breadcrumb the page hands it
          (see the effect above); the page itself opens on its heading. */}
      <div className="flex items-start gap-4">
        <SectionHeading
          icon={Settings2}
          title={platformLayer ? `${teammate.name} settings` : "Teammate settings"}

          className="min-w-0 flex-1"
        />
        {headerActions && (
          <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
        )}
      </div>

      <div className="pt-10 pb-24">
      <SectionTimeline>
      <TimelineSection title="Identity" boxed>
      <div className="space-y-5">
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
      </div>
      </TimelineSection>

      <TimelineSection title="Standing role" boxed>
      <div className="space-y-2">
        <Label htmlFor="edit-role" className="sr-only">Standing role</Label>
        <Textarea
          id="edit-role"
          value={roleDescription}
          onChange={(e) => setRoleDescription(e.target.value.slice(0, 10000))}
          rows={8}
        />
      </div>
      </TimelineSection>

      <TimelineSection title={platformLayer ? "Knowledge and actions" : "Knowledge"} boxed>
      {platformLayer ? (
        <div>
          <p className="text-muted-foreground text-sm">
            Uses the Library and your permissions. Deleting or publishing requires confirmation.
          </p>
        </div>
      ) : (
      <KnowledgeScopePicker
        collections={collections}
        sources={sources}
        sourcesTruncated={sourcesTruncated}
        collectionIds={collectionIds}
        sourceIds={sourceIds}
        onCollectionsChange={setCollectionIds}
        onSourcesChange={setSourceIds}
      />
      )}
      </TimelineSection>

      {runtime.harness.kind === "ciele" && <TimelineSection title="Models" boxed>
      <div className="space-y-2">
        <Label>Default model</Label>
        <div className="flex flex-col gap-2 @lg:flex-row">
          <Select value={modelProvider} onValueChange={(value) => {
            const provider = value as Provider;
            setModelProvider(provider);
            setModelId(modelCatalog[provider][0]!.id);
            setModelSource(null);
          }} className="w-full @lg:w-40">
            <SelectTrigger aria-label="Default model provider"><SelectValue>{PROVIDER_NAMES[modelProvider]}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_NAMES) as Provider[]).filter((provider) => modelCatalog[provider].length > 0).map((provider) => (
                <SelectItem key={provider} value={provider}>{PROVIDER_NAMES[provider]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={modelId} onValueChange={(value) => {
            setModelId(value);
            setModelSource(null);
          }} className="min-w-0 flex-1">
            <SelectTrigger aria-label="Default model"><SelectValue>{modelCatalog[modelProvider].find((model) => model.id === modelId)?.label ?? modelId}</SelectValue></SelectTrigger>
            <SelectContent>
              {modelCatalog[modelProvider].map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <ModelSourceSelect
          sources={
            modelSources[
              modelSelector({
                provider: modelProvider,
                modelId: currentModelId(modelProvider, modelId),
              })
            ] ?? []
          }
          value={modelSource}
          onChange={setModelSource}
        />
        <Label>Models it can answer with</Label>
        <ModelAllowList
          catalog={modelCatalog}
          configured={{
            provider: modelProvider,
            modelId,
            ...(modelSource ? { source: modelSource } : {}),
          }}
          value={allowedModels}
          onChange={setAllowedModels}
          unavailable={unavailableProviders}
          audience="colleagues"
          sources={modelSources}
        />
        <p className="text-muted-foreground text-sm">
          {modelAllowListSummary(allowedModels, unavailableProviders)} Your personal subscription overrides this list.
        </p>
      </div>

      </TimelineSection>

      }
      <TimelineSection title="Project" boxed>
      <ProjectSection
        projects={projects}
        value={projectId}
        onChange={setProjectId}
        canEdit
        teammateNames={{ [teammate.id]: teammate.name }}
      />
      </TimelineSection>

      <TimelineSection title="Memory" boxed>
      <div className="space-y-2">
        <Label htmlFor="edit-learnings">What it has learned</Label>
        <Textarea
          id="edit-learnings"
          value={agentMemory}
          rows={6}
          // Read-only until the read on open lands, so nobody types into a
          // value that is about to be replaced by a newer one.
          disabled={loadedMemory === null}
          placeholder="No notes yet."
          onChange={(e) =>
            setAgentMemory(e.target.value.slice(0, MEMORY_DOCUMENT_MAX_CHARS))
          }
        />
        <p className="text-muted-foreground text-sm">
          {memoryUnreadable
            ? "Could not read the latest notes, so they are shown as the page loaded them and cannot be edited here. Close and reopen to try again."
            : "Read with every message."}
        </p>
      </div>

      </TimelineSection>

      {/* Ciele AI has no grants of its own, is visible to everyone, and an
          unattended Routine would run it as nobody, with no permissions. */}
      {!platformLayer && (
        <>
          <TimelineSection title="Actions" boxed>
            <TeammateGrantsPicker
              value={grants}
              onChange={setGrants}
              canGrant={canGrant}
            />
          </TimelineSection>

          <TimelineSection title="Routines" boxed>
            <RoutinesPanel routines={routines} teammateId={teammate.id} canEdit />
          </TimelineSection>
          <TimelineSection title="Execution" boxed>
            <TeammateExecutionSettings teammateId={teammate.id} value={runtime} onChange={setRuntime} canGrant={canGrant} options={executionOptions} />
          </TimelineSection>
        </>
      )}

      <TimelineSection title="Access" boxed>
      <div className="space-y-6">
        {!platformLayer && <VisibilityPicker value={visibility} onChange={setVisibility} />}
        <TeammateEditorsPicker
          members={members}
          selected={editorIds}
          onChange={setEditorIds}
        />
      </div>
      </TimelineSection>
      </SectionTimeline>
      </div>

      <div className="flex items-center gap-2 border-t pt-4">
        {!platformLayer && (
          <Button
            variant="ghost"
            className="text-destructive h-10"
            onClick={remove}
            disabled={isPending}
          >
            Delete teammate
          </Button>
        )}
        {formActions}
      </div>
    </div>
  );
}
