"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { AssistantTools, BuiltInToolName, Skill } from "@agent-hub/core";
import { Plus, Trash2 } from "lucide-react";
import { Globe, Pencil } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  deleteSkillAction,
  setAssistantSkillsAction,
  updateAssistantAction,
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
import { Hint } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";

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
  const [, startTransition] = useTransition();
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
            // A page under Tools & Skills, not a dialog: a prompt needs room,
            // and the breadcrumb says where you are.
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/assistants/${assistantId}/tools/skills/new`} />}
              nativeButton={false}
            >
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
                  <span className="block font-medium"><RollInText text={skill.name} /></span>
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
                      render={<Link href={`/assistants/${assistantId}/tools/skills/${skill.id}`} />}
                      nativeButton={false}
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


      <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-xs">
        <Globe className="size-3.5" />
        Changes apply to Preview immediately; publish to update the live widget.
      </p>
    </div>
  );
}
