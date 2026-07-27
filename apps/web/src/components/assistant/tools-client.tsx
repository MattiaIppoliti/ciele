"use client";

import { useRef, useState, useTransition } from "react";
import type { AssistantTools, BuiltInToolName, CustomToolConfig, Skill } from "@agent-hub/core";
import { Globe, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  createSkillAction,
  deleteSkillAction,
  setAssistantSkillsAction,
  updateAssistantAction,
  updateSkillAction,
} from "@/app/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Tools & Skills SETUP section: which built-in agent tools the assistant runs
 * with, its custom HTTP tools, and the org Skills (reusable prompt templates)
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

interface CustomToolDraft {
  id: string | null;
  name: string;
  description: string;
  url: string;
  method: "GET" | "POST";
  /** One per line: `name | description | required` */
  params: string;
}

const EMPTY_TOOL: CustomToolDraft = {
  id: null,
  name: "",
  description: "",
  url: "",
  method: "POST",
  params: "",
};

function draftFromTool(tool: CustomToolConfig): CustomToolDraft {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    url: tool.url,
    method: tool.method,
    params: (tool.params ?? [])
      .map(
        (p) =>
          `${p.name} | ${p.description ?? ""}${p.required ? " | required" : ""}`
      )
      .join("\n"),
  };
}

function parseParams(text: string): CustomToolConfig["params"] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", description = "", flag = ""] = line
        .split("|")
        .map((p) => p.trim());
      return {
        name,
        description: description || undefined,
        required: flag.toLowerCase() === "required",
      };
    })
    .filter((p) => p.name);
}

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
  canEdit,
}: {
  assistantId: string;
  tools: AssistantTools;
  skills: Skill[];
  attachedSkillIds: string[];
  canEdit: boolean;
}) {
  const [tools, setTools] = useState<AssistantTools>(initialTools);
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [attached, setAttached] = useState<string[]>(attachedSkillIds);
  const [toolDraft, setToolDraft] = useState<CustomToolDraft | null>(null);
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

  function commitCustomTool(draft: CustomToolDraft) {
    const name = draft.name.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
      toast.error(
        "Tool name must start with a letter and use only letters, digits, _ or -"
      );
      return;
    }
    if (!draft.url.trim()) {
      toast.error("Endpoint URL is required");
      return;
    }
    const config: CustomToolConfig = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      description: draft.description.trim(),
      url: draft.url.trim(),
      method: draft.method,
      params: parseParams(draft.params),
    };
    const custom = latestTools.current.custom ?? [];
    const next = draft.id
      ? custom.map((t) => (t.id === draft.id ? config : t))
      : [...custom, config];
    saveTools(
      { ...latestTools.current, custom: next },
      draft.id ? "Tool updated" : "Tool added"
    );
    setToolDraft(null);
  }

  function removeCustomTool(id: string) {
    saveTools(
      {
        ...latestTools.current,
        custom: (latestTools.current.custom ?? []).filter((t) => t.id !== id),
      },
      "Tool removed"
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

  const custom = tools.custom ?? [];

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

      {/* Custom tools */}
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Custom tools</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              HTTP endpoints the assistant may call as tools — the model fills
              the parameters, the response feeds back into the answer.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setToolDraft(EMPTY_TOOL)}>
              <AnimatedIcon icon={Plus} size={16} /> Add tool
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {custom.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
              No custom tools yet.
            </p>
          )}
          {custom.map((tool) => (
            <div
              key={tool.id}
              className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <AnimatedIcon
                    icon={Wrench}
                    size={16}
                    iconClassName="text-muted-foreground"
                    className="shrink-0"
                  />
                  {tool.name}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {tool.method} {tool.url}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Hint label="Edit tool">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit tool"
                      onClick={() => setToolDraft(draftFromTool(tool))}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </Hint>
                  <Hint label="Delete tool">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete tool"
                      onClick={() => removeCustomTool(tool.id)}
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

      {/* Custom tool dialog */}
      <Dialog open={toolDraft !== null} onOpenChange={(open) => !open && setToolDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{toolDraft?.id ? "Edit tool" : "Add custom tool"}</DialogTitle>
            <DialogDescription>
              The assistant calls this endpoint during a turn; the response is
              given back to the model.
            </DialogDescription>
          </DialogHeader>
          {toolDraft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tool-name">Tool name</Label>
                <Input
                  id="tool-name"
                  placeholder="lookup_account"
                  value={toolDraft.name}
                  onChange={(e) => setToolDraft({ ...toolDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tool-description">Description (what it does, when to use it)</Label>
                <Textarea
                  id="tool-description"
                  rows={2}
                  value={toolDraft.description}
                  onChange={(e) =>
                    setToolDraft({ ...toolDraft, description: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-3">
                <div className="w-28 space-y-2">
                  <Label>Method</Label>
                  <Select
                    value={toolDraft.method}
                    onValueChange={(method) =>
                      setToolDraft({ ...toolDraft, method: method as "GET" | "POST" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="tool-url">Endpoint URL</Label>
                  <Input
                    id="tool-url"
                    placeholder="https://api.example.com/accounts"
                    value={toolDraft.url}
                    onChange={(e) => setToolDraft({ ...toolDraft, url: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tool-params">
                  Parameters — one per line: name | description | required
                </Label>
                <Textarea
                  id="tool-params"
                  rows={3}
                  placeholder={"accountId | The account identifier, e.g. ACME-123 | required\nregion | Optional region filter"}
                  value={toolDraft.params}
                  onChange={(e) => setToolDraft({ ...toolDraft, params: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToolDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => toolDraft && commitCustomTool(toolDraft)}>
              {toolDraft?.id ? "Save tool" : "Add tool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
