"use client";

import { useRef, useState, useTransition } from "react";
import type { AssistantTools, BuiltInToolName, Skill } from "@agent-hub/core";
import { Plus, Trash2 } from "lucide-react";
import { Globe, Pencil } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  createSkillAction,
  deleteSkillAction,
  setAssistantSkillsAction,
  updateAssistantAction,
  updateSkillAction,
  type ApiIntegrationView,
} from "@/app/actions";
import { DEFAULT_STUDY_SETTINGS, StudySettings } from "./study-settings";
import { ApiIntegrationEditor } from "./api-integration-editor";
import {
  SectionTimeline,
  TimelineSection,
} from "@/components/settings/section-timeline";
import { Button } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

/**
 * Tools & Skills SETUP section: which built-in agent tools the assistant runs
 * with, its API catalogue integration, and the org Skills (reusable prompt templates)
 * attached to it. Everything here feeds the runtime's tool registry
 * (lib/runtime/tools.ts) and system-prompt skill layer.
 */

const BUILT_INS: Array<{
  name: BuiltInToolName;
  title: string;
  description: string;
  /** Runtime default when the assistant has no override. */
  defaultOn: boolean;
  /** searchKnowledge is the grounding tool, always on. */
  locked?: boolean;
}> = [
  {
    name: "searchKnowledge",
    title: "Search knowledge",
    description:
      "RAG over the assistant's Knowledge Collections with Source citations. Core grounding tool, always enabled.",
    defaultOn: true,
    locked: true,
  },
  {
    name: "remember",
    title: "Session memory",
    description:
      "Lets the assistant save short facts (role, product, preferences) that persist across turns in a conversation.",
    defaultOn: true,
  },
  {
    name: "renderTable",
    title: "Show a table",
    description:
      "Lets the assistant lay retrieved facts out as a table when the answer compares things across the same few attributes, and give a row a follow-up question the visitor can tap. It arranges what it found; it never computes values. Off by default.",
    defaultOn: false,
  },
  {
    name: "fetchUrl",
    title: "Fetch URL",
    description:
      "Fetch a public web page or API during a turn for live information the knowledge base can't have. Off by default (network egress).",
    defaultOn: false,
  },
];

interface SkillDraft {
  id: string | null;
  name: string;
  description: string;
  prompt: string;
  starter: string;
}

const EMPTY_SKILL: SkillDraft = {
  id: null,
  name: "",
  description: "",
  prompt: "",
  starter: "",
};

export function ToolsClient({
  assistantId,
  tools: initialTools,
  skills: initialSkills,
  attachedSkillIds,
  integration,
  canEdit,
}: {
  assistantId: string;
  tools: AssistantTools;
  skills: Skill[];
  attachedSkillIds: string[];
  /** The assistant's API integration, credential redacted (spec #559). */
  integration: ApiIntegrationView | null;
  canEdit: boolean;
}) {
  const [tools, setTools] = useState<AssistantTools>(initialTools);
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [attached, setAttached] = useState<string[]>(attachedSkillIds);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  /** The draft as the dialog opened, so closing can tell whether anything changed. */
  const [skillOpened, setSkillOpened] = useState<SkillDraft | null>(null);
  const [, startTransition] = useTransition();
  const [skillPending, startSkillTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  // Rapid consecutive saves must not clobber each other, patch on the latest.
  const latestTools = useRef(tools);
  const latestAttached = useRef(attached);

  function saveTools(next: AssistantTools, message: string) {
    const previous = latestTools.current;
    latestTools.current = next;
    setTools(next);
    startTransition(async () => {
      try {
        await updateAssistantAction(assistantId, { tools: next });
        toast.success(message);
      } catch {
        // Roll back only when no later toggle has landed on top of this one;
        // otherwise the newer state is the one on screen and in flight.
        if (latestTools.current === next) {
          latestTools.current = previous;
          setTools(previous);
        }
        toast.error("Could not save the change");
      }
    });
  }

  function toggleBuiltIn(item: (typeof BUILT_INS)[number], on: boolean) {
    saveTools(
      {
        ...latestTools.current,
        builtIns: { ...latestTools.current.builtIns, [item.name]: on },
      },
      `${item.title} ${on ? "enabled" : "disabled"}`
    );
  }

  function saveAttached(next: string[], message: string) {
    const previous = latestAttached.current;
    latestAttached.current = next;
    setAttached(next);
    startTransition(async () => {
      try {
        await setAssistantSkillsAction(assistantId, next);
        toast.success(message);
      } catch {
        if (latestAttached.current === next) {
          latestAttached.current = previous;
          setAttached(previous);
        }
        toast.error("Could not update the attached skills");
      }
    });
  }

  function toggleSkill(skill: Skill, on: boolean) {
    const current = latestAttached.current;
    saveAttached(
      on ? [...current, skill.id] : current.filter((id) => id !== skill.id),
      `"${skill.name}" ${on ? "attached" : "detached"}`
    );
  }

  function commitSkill(draft: SkillDraft) {
    const name = draft.name.trim();
    if (!name || !draft.prompt.trim()) {
      toast.error("Skill name and prompt are required");
      return;
    }
    startSkillTransition(async () => {
      try {
        await persistSkill(draft, name);
        // Closed only once saved, so a failure leaves the draft to retry.
        closeSkill();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save the skill"
        );
      }
    });
  }

  async function persistSkill(draft: SkillDraft, name: string) {
    const fields = {
      name,
      description: draft.description.trim(),
      prompt: draft.prompt,
      starter: draft.starter.trim(),
    };
    if (draft.id) {
      await updateSkillAction(draft.id, fields);
      setSkills((prev) => prev.map((s) => (s.id === draft.id ? { ...s, ...fields } : s)));
      toast.success("Skill updated");
    } else {
      const skill = await createSkillAction(fields, assistantId);
      setSkills((prev) => [...prev, skill]);
      latestAttached.current = [...latestAttached.current, skill.id];
      setAttached(latestAttached.current);
      toast.success("Skill created and attached");
    }
  }

  function openSkill(draft: SkillDraft) {
    setSkillDraft(draft);
    setSkillOpened(draft);
  }

  function closeSkill() {
    setSkillDraft(null);
    setSkillOpened(null);
  }

  const skillDirty =
    skillDraft !== null &&
    skillOpened !== null &&
    (skillDraft.name !== skillOpened.name ||
      skillDraft.description !== skillOpened.description ||
      skillDraft.prompt !== skillOpened.prompt ||
      skillDraft.starter !== skillOpened.starter);

  const { leave: leaveSkill } = useUnsavedChanges({
    dirty: skillDirty,
    confirmDelete,
    description: skillDraft?.id
      ? "The edits to this skill are not saved yet."
      : "This skill has not been created yet.",
  });

  function requestCloseSkill() {
    if (skillPending) return;
    leaveSkill(closeSkill);
  }

  // A Skill belongs to the Organization, so deleting it detaches it from every
  // assistant it is attached to, not only this one.
  function removeSkill(skill: Skill) {
    confirmDelete({
      title: "Delete this skill?",
      description: `“${skill.name}” is deleted for the whole organization and detached from every assistant that uses it. This cannot be undone.`,
      confirmLabel: "Delete skill",
      // Returns the promise so the confirm modal shows it pending and toasts a
      // failure; a transition here would resolve before the delete did.
      onConfirm: async () => {
        await deleteSkillAction(skill.id);
        setSkills((prev) => prev.filter((s) => s.id !== skill.id));
        latestAttached.current = latestAttached.current.filter(
          (id) => id !== skill.id
        );
        setAttached(latestAttached.current);
        toast.success("Skill deleted");
      },
    });
  }

  return (
    <div className="pt-8">
      {confirmDeleteModal}
      <SectionTimeline>
      <TimelineSection title="Built-in tools" boxed>
      <section>
        <p className="text-muted-foreground text-sm">
          What the assistant can do while answering, beyond generating text.
        </p>
        <div className="mt-4 space-y-5">
          {BUILT_INS.map((item) => (
            <div key={item.name} className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">{item.title}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {item.description}
                </p>
              </div>
              <Switch
                checked={
                  item.locked
                    ? true
                    : (tools.builtIns?.[item.name] ?? item.defaultOn)
                }
                disabled={!canEdit || item.locked}
                aria-label={`Enable ${item.title}`}
                onCheckedChange={(on) => toggleBuiltIn(item, on)}
              />
            </div>
          ))}
        </div>
      </section>
      </TimelineSection>

      <TimelineSection title="Study Mode">
        <StudySettings settings={tools.studyMode} canEdit={canEdit} onChange={patch => saveTools({ ...latestTools.current, studyMode: { ...(latestTools.current.studyMode ?? DEFAULT_STUDY_SETTINGS), ...patch } }, "Study Mode updated")} />
      </TimelineSection>

      {/* API integration (spec #559) */}
      <TimelineSection title="API integration" boxed>
      <ApiIntegrationEditor
        assistantId={assistantId}
        integration={integration}
        canEdit={canEdit}
      />
      </TimelineSection>

      {/* Skills */}
      <TimelineSection title="Skills" boxed>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            Reusable prompts. Attached skills are added to this assistant&apos;s instructions.
          </p>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => openSkill(EMPTY_SKILL)}>
              <AnimatedIcon icon={Plus} size={16} /> New skill
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {skills.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
              No skills in this organization yet.
            </p>
          )}
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <label className="flex min-w-0 cursor-pointer items-center gap-3">
                <Checkbox
                  checked={attached.includes(skill.id)}
                  disabled={!canEdit}
                  onCheckedChange={(on) => toggleSkill(skill, on === true)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{skill.name}</span>
                  {skill.description && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {skill.description}
                    </span>
                  )}
                </span>
              </label>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Hint label="Edit skill">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit skill"
                      onClick={() =>
                        openSkill({
                          id: skill.id,
                          name: skill.name,
                          description: skill.description,
                          prompt: skill.prompt,
                          starter: skill.starter ?? "",
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </Hint>
                  <Hint label="Delete skill">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete skill"
                      onClick={() => removeSkill(skill)}
                    >
                      <AnimatedIcon icon={Trash2} size={16} />
                    </Button>
                  </Hint>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      </TimelineSection>
      </SectionTimeline>

      {/* Skill dialog */}
      <Dialog open={skillDraft !== null} onOpenChange={(open) => !open && requestCloseSkill()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{skillDraft?.id ? "Edit skill" : "New skill"}</DialogTitle>
            <DialogDescription>
              A reusable prompt template. Attach it to any assistant in your
              organization.
            </DialogDescription>
          </DialogHeader>
          {skillDraft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  placeholder="Citation etiquette"
                  value={skillDraft.name}
                  onChange={(e) => setSkillDraft({ ...skillDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-description">Description</Label>
                <Input
                  id="skill-description"
                  placeholder="How to reference official sources"
                  value={skillDraft.description}
                  onChange={(e) =>
                    setSkillDraft({ ...skillDraft, description: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-prompt">Prompt</Label>
                <Textarea
                  id="skill-prompt"
                  rows={6}
                  placeholder="When citing internal policies, always name the official document and advise the user to verify with the relevant team…"
                  value={skillDraft.prompt}
                  onChange={(e) => setSkillDraft({ ...skillDraft, prompt: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-starter">Opening line (optional)</Label>
                <Textarea
                  id="skill-starter"
                  rows={2}
                  placeholder="Draft release notes for the change I paste below."
                  value={skillDraft.starter}
                  onChange={(e) =>
                    setSkillDraft({ ...skillDraft, starter: e.target.value })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  What the chat window writes into the message box when someone
                  picks this skill from the <code>/</code> menu. Write it as the asker. Leave empty to keep the skill out of the menu.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={requestCloseSkill} disabled={skillPending}>
              Cancel
            </Button>
            <Button
              onClick={() => skillDraft && commitSkill(skillDraft)}
              disabled={skillPending}
            >
              <RollInText
                text={
                  skillPending
                    ? "Saving…"
                    : skillDraft?.id
                      ? "Save skill"
                      : "Create skill"
                }
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-xs">
        <Globe className="size-3.5" />
        Changes apply to Preview immediately; publish to update the live widget.
      </p>
    </div>
  );
}
