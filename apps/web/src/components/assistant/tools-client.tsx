"use client";

import { useRef, useState, useTransition } from "react";
import type { AssistantTools, BuiltInToolName, Skill } from "@agent-hub/core";
import { Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  createSkillAction,
  deleteSkillAction,
  setAssistantSkillsAction,
  updateAssistantAction,
  updateSkillAction,
  type ApiIntegrationView,
} from "@/app/actions";
import { ApiIntegrationEditor } from "./api-integration-editor";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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
  /** searchKnowledge is the grounding tool — always on. */
  locked?: boolean;
}> = [
  {
    name: "searchKnowledge",
    title: "Search knowledge",
    description:
      "RAG over the assistant's Knowledge Collections with Source citations. Core grounding tool — always enabled.",
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
}

const EMPTY_SKILL: SkillDraft = { id: null, name: "", description: "", prompt: "" };

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
  const [, startTransition] = useTransition();

  // Rapid consecutive saves must not clobber each other — patch on the latest.
  const latestTools = useRef(tools);
  const latestAttached = useRef(attached);

  function saveTools(next: AssistantTools, message: string) {
    latestTools.current = next;
    setTools(next);
    startTransition(async () => {
      await updateAssistantAction(assistantId, { tools: next });
      toast.success(message);
    });
  }

  function toggleBuiltIn(name: BuiltInToolName, on: boolean) {
    saveTools(
      {
        ...latestTools.current,
        builtIns: { ...latestTools.current.builtIns, [name]: on },
      },
      `${name} ${on ? "enabled" : "disabled"}`
    );
  }

  function saveAttached(next: string[], message: string) {
    latestAttached.current = next;
    setAttached(next);
    startTransition(async () => {
      await setAssistantSkillsAction(assistantId, next);
      toast.success(message);
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
    startTransition(async () => {
      if (draft.id) {
        await updateSkillAction(assistantId, draft.id, {
          name,
          description: draft.description.trim(),
          prompt: draft.prompt,
        });
        setSkills((prev) =>
          prev.map((s) =>
            s.id === draft.id
              ? { ...s, name, description: draft.description.trim(), prompt: draft.prompt }
              : s
          )
        );
        toast.success("Skill updated");
      } else {
        const skill = await createSkillAction(
          { name, description: draft.description.trim(), prompt: draft.prompt },
          assistantId
        );
        setSkills((prev) => [...prev, skill]);
        latestAttached.current = [...latestAttached.current, skill.id];
        setAttached(latestAttached.current);
        toast.success("Skill created and attached");
      }
    });
    setSkillDraft(null);
  }

  function removeSkill(skill: Skill) {
    startTransition(async () => {
      await deleteSkillAction(assistantId, skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      latestAttached.current = latestAttached.current.filter(
        (id) => id !== skill.id
      );
      setAttached(latestAttached.current);
      toast.success("Skill deleted");
    });
  }

  return (
    <div className="mt-8 space-y-10">
      {/* Built-in tools */}
      <section>
        <h2 className="text-lg font-semibold">Built-in tools</h2>
        <p className="text-muted-foreground mt-1 text-sm">
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
                onCheckedChange={(on) => toggleBuiltIn(item.name, on)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* API integration (spec #559) */}
      <ApiIntegrationEditor
        assistantId={assistantId}
        integration={integration}
        canEdit={canEdit}
      />

      {/* Skills */}
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Skills</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Reusable prompt templates owned by your organization. Attached
              skills are layered into this assistant&apos;s system prompt.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setSkillDraft(EMPTY_SKILL)}>
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
                        setSkillDraft({
                          id: skill.id,
                          name: skill.name,
                          description: skill.description,
                          prompt: skill.prompt,
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

      {/* Skill dialog */}
      <Dialog open={skillDraft !== null} onOpenChange={(open) => !open && setSkillDraft(null)}>
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
                  placeholder="When citing internal policies, always name the official document and advise the user to verify with the relevant team..."
                  value={skillDraft.prompt}
                  onChange={(e) => setSkillDraft({ ...skillDraft, prompt: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkillDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => skillDraft && commitSkill(skillDraft)}>
              {skillDraft?.id ? "Save skill" : "Create skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Globe className="size-3.5" />
        Changes apply to Preview immediately; publish to update the live widget.
      </p>
    </div>
  );
}
