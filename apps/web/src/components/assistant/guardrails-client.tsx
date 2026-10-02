"use client";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useId, useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  GUARDRAIL_CAP,
  GUARDRAIL_LABELS,
  GUARDRAIL_TYPES,
  MODERATION_CATEGORIES,
  defaultGuardrail,
  guardrailProblem,
  orderGuardrails,
  type AssistantGuardrail,
  type GuardrailType,
} from "@agent-hub/core";
import { updateAssistantAction } from "@/app/actions";
import { Badge, Button, Card, Input, Label } from "@agent-hub/ui";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/motion-switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { formatCount } from "@/lib/format";
import { toast } from "@/lib/toast";

/**
 * The Guardrails SETUP section: one timeline section per type, in run order
 * (`GUARDRAIL_TYPES`), each a card holding that type's guardrails. The whole
 * list is one field on the Assistant, so every change (add, edit, reorder,
 * toggle, delete) saves the list whole, in run order; the ops schema
 * validates it with the same `guardrailProblem` this form shows inline.
 */

const STAGE: Record<GuardrailType, string> = {
  input_length_limit: "Visitor message",
  moderation: "Visitor message",
  regexp_guardrail: "Visitor message",
  restrict_to_topic: "Visitor message",
  sensitive_content_stream: "Answer stream",
};

/** The on/off pill beside a guardrail's switch, as on the General page. */
function StatePill({ on }: { on: boolean }) {
  return <StatusPill status={on ? "online" : "offline"} primaryText={<RollInText text={on ? "Active" : "Off"} />} />;
}

function summary(guardrail: AssistantGuardrail): string {
  switch (guardrail.type) {
    case "input_length_limit":
      return `More than ${formatCount(guardrail.max)} ${guardrail.unit}`;
    case "moderation":
      return guardrail.categories.length
        ? `Flagged as ${guardrail.categories.join(", ")}`
        : "Anything the moderation model flags";
    case "regexp_guardrail":
      return `Matches /${guardrail.pattern}/${guardrail.caseInsensitive ? "i" : ""}`;
    case "restrict_to_topic":
      return `Topics: ${guardrail.topics.join(", ")}`;
    case "sensitive_content_stream":
      return `Hides text between ${guardrail.startMarker} and ${guardrail.stopMarker}`;
  }
}

function newId(): string {
  return `gr_${crypto.randomUUID().slice(0, 8)}`;
}

function GuardrailForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
  saveLabel,
  hasOpenAiConnection,
}: {
  draft: AssistantGuardrail;
  setDraft: (d: AssistantGuardrail) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
  hasOpenAiConnection: boolean;
}) {
  const id = useId();
  const problem = guardrailProblem(draft);
  const isStream = draft.type === "sensitive_content_stream";

  return (
    <div className="bg-background/40 grid gap-4 rounded-lg border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          autoComplete="off"
          maxLength={100}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      {draft.type === "input_length_limit" && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-max`}>Limit</Label>
            <Input
              id={`${id}-max`}
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.max}
              onChange={(e) => setDraft({ ...draft, max: Number(e.target.value) })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-unit`}>Count</Label>
            <Select
              value={draft.unit}
              onValueChange={(unit) => setDraft({ ...draft, unit: unit as "characters" | "tokens" })}
            >
              <SelectTrigger id={`${id}-unit`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="characters">Characters</SelectItem>
                <SelectItem value="tokens">Tokens (about 4 characters each)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {draft.type === "moderation" && (
        <div className="grid gap-2">
          {!hasOpenAiConnection && (
            <p className="rounded-md border border-amber-400 px-3 py-2 text-xs text-amber-700 dark:border-amber-600 dark:text-amber-400">
              Moderation runs on your OpenAI connection, and this organization has none. Until you add
              one, this check cannot run and follows its failure setting below.
            </p>
          )}
          <Label>Block on these categories</Label>
          <p className="text-muted-foreground text-xs">
            Pick none to block anything the model <code>omni-moderation-latest</code> flags.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {MODERATION_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.categories.includes(category)}
                  onCheckedChange={(on) =>
                    setDraft({
                      ...draft,
                      categories:
                        on === true
                          ? [...draft.categories, category]
                          : draft.categories.filter((c) => c !== category),
                    })
                  }
                />
                {category}
              </label>
            ))}
          </div>
        </div>
      )}

      {draft.type === "regexp_guardrail" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-pattern`}>Pattern</Label>
          <Input
            id={`${id}-pattern`}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="e.g. \b\d{16}\b"
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.caseInsensitive}
              onCheckedChange={(on) => setDraft({ ...draft, caseInsensitive: on === true })}
            />
            Ignore upper and lower case
          </label>
        </div>
      )}

      {draft.type === "restrict_to_topic" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-topics`}>Allowed topics, one per line</Label>
          <Textarea
            id={`${id}-topics`}
            rows={4}
            placeholder={"Orders and shipping\nReturns and refunds\nAccount access"}
            value={draft.topics.join("\n")}
            onChange={(e) => setDraft({ ...draft, topics: e.target.value.split("\n") })}
          />
          <p className="text-muted-foreground text-xs">
            A model reads each message and blocks it when its main topic is none of these. Greetings
            and thanks are not blocked.
          </p>
        </div>
      )}

      {draft.type === "sensitive_content_stream" && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-start`}>Start marker</Label>
            <Input
              id={`${id}-start`}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="e.g. <internal>"
              value={draft.startMarker}
              onChange={(e) => setDraft({ ...draft, startMarker: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-stop`}>Stop marker</Label>
            <Input
              id={`${id}-stop`}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="e.g. </internal>"
              value={draft.stopMarker}
              onChange={(e) => setDraft({ ...draft, stopMarker: e.target.value })}
            />
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Text the model writes between the markers never reaches the visitor, and is not saved in
            the transcript. If the model never writes the stop marker, the rest of the answer stays
            hidden.
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-message`}>
          {isStream ? "Shown in place of the hidden text" : "Reply when the guardrail blocks"}
        </Label>
        <Textarea
          id={`${id}-message`}
          rows={2}
          maxLength={1000}
          value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
        />
      </div>

      {!isStream && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-action`}>When it fires</Label>
            <Select
              value={draft.action}
              onValueChange={(action) => setDraft({ ...draft, action: action as "block" | "log" })}
            >
              <SelectTrigger id={`${id}-action`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">Block the message</SelectItem>
                <SelectItem value="log">Only log it in the Inbox trace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(draft.type === "moderation" || draft.type === "restrict_to_topic") && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-on-error`}>If the check cannot run</Label>
              <Select
                value={draft.onError}
                onValueChange={(onError) => setDraft({ ...draft, onError: onError as "allow" | "block" })}
              >
                <SelectTrigger id={`${id}-on-error`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Let the message through</SelectItem>
                  <SelectItem value="block">Block the message</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {problem && <p className="text-destructive text-xs">{problem}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || problem !== null}>
          <RollInText text={saving ? "Saving…" : saveLabel} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function GuardrailsClient({
  assistantId,
  initial,
  canEdit,
  hasOpenAiConnection,
}: {
  assistantId: string;
  initial: AssistantGuardrail[];
  canEdit: boolean;
  hasOpenAiConnection: boolean;
}) {
  const [guardrails, setGuardrails] = useState(() => orderGuardrails(initial));
  // The row being edited (`new:<type>` for an unsaved one) and its draft.
  const [editing, setEditing] = useState<{ key: string; draft: AssistantGuardrail } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const persist = async (next: AssistantGuardrail[]) => {
    const ordered = orderGuardrails(next);
    await updateAssistantAction(assistantId, { guardrails: ordered });
    setGuardrails(ordered);
  };
  const save = (next: AssistantGuardrail[], ok: string, onDone?: () => void) => {
    startTransition(async () => {
      try {
        await persist(next);
        toast.success(ok);
        onDone?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  };

  /** Swap a guardrail with its neighbour of the same type. */
  const move = (guardrail: AssistantGuardrail, by: -1 | 1) => {
    const sameType = guardrails.filter((g) => g.type === guardrail.type);
    const neighbour = sameType[sameType.indexOf(guardrail) + by];
    if (!neighbour) return;
    const next = [...guardrails];
    const a = next.indexOf(guardrail);
    const b = next.indexOf(neighbour);
    [next[a], next[b]] = [next[b], next[a]];
    save(next, "Order saved");
  };

  const form = (key: string, saveLabel: string, onSave: (draft: AssistantGuardrail) => void) =>
    editing?.key === key ? (
      <GuardrailForm
        key={key}
        draft={editing.draft}
        setDraft={(draft) => setEditing({ key, draft })}
        saving={isPending}
        saveLabel={saveLabel}
        hasOpenAiConnection={hasOpenAiConnection}
        onCancel={() => setEditing(null)}
        onSave={() => onSave(editing.draft)}
      />
    ) : null;

  const full = guardrails.length >= GUARDRAIL_CAP;

  return (
    <div className="pt-6 pb-24">
      <p className="text-muted-foreground mb-8 text-sm">
        Visitor message checks run top to bottom before any Flow sees the message, and the first
        that blocks answers with its reply. Answer stream checks rewrite the answer while it is
        written. Changes apply in the Preview now and in the widget from the next publish.
      </p>
      <SectionTimeline>
        {GUARDRAIL_TYPES.map((type) => {
          const ofType = guardrails.filter((g) => g.type === type);
          const newKey = `new:${type}`;
          return (
            <TimelineSection key={type} title={GUARDRAIL_LABELS[type].title}>
              <Card size="sm" className="gap-4 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{GUARDRAIL_LABELS[type].summary}</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Runs on the {STAGE[type].toLowerCase()}.
                      {ofType.length > 0 &&
                        ` ${formatCount(ofType.length)} configured, ${formatCount(ofType.filter((g) => g.enabled).length)} active.`}
                    </p>
                  </div>
                  {canEdit && editing?.key !== newKey && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={full || editing !== null}
                      title={full ? `An Assistant can have ${GUARDRAIL_CAP} guardrails.` : undefined}
                      onClick={() => setEditing({ key: newKey, draft: defaultGuardrail(type, newId()) })}
                    >
                      Add
                    </Button>
                  )}
                </div>

                {ofType.length > 0 && (
                  <ul className="divide-y rounded-lg border">
                    {ofType.map((guardrail, index) =>
                      editing?.key === guardrail.id ? (
                        <li key={guardrail.id} className="p-2">
                          {form(guardrail.id, "Save guardrail", (draft) =>
                            save(
                              guardrails.map((g) => (g.id === guardrail.id ? draft : g)),
                              "Guardrail saved",
                              () => setEditing(null)
                            )
                          )}
                        </li>
                      ) : (
                        <li
                          key={guardrail.id}
                          className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 font-medium break-words">{guardrail.name}</span>
                              {guardrail.type !== "sensitive_content_stream" && guardrail.action === "log" && (
                                <Badge variant="outline">Log only</Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground mt-0.5 text-xs break-words">{summary(guardrail)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <StatePill on={guardrail.enabled} />
                            {canEdit && (
                              <>
                                <Switch
                                  size="sm"
                                  className="mx-1"
                                  checked={guardrail.enabled}
                                  disabled={isPending}
                                  ariaLabel={`${guardrail.enabled ? "Turn off" : "Turn on"} ${guardrail.name}`}
                                  onCheckedChange={(enabled) =>
                                    save(
                                      guardrails.map((g) => (g.id === guardrail.id ? { ...g, enabled } : g)),
                                      enabled ? "Guardrail on" : "Guardrail off"
                                    )
                                  }
                                />
                                {ofType.length > 1 && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Move ${guardrail.name} up`}
                                      disabled={isPending || index === 0}
                                      onClick={() => move(guardrail, -1)}
                                    >
                                      <ArrowUp className="size-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Move ${guardrail.name} down`}
                                      disabled={isPending || index === ofType.length - 1}
                                      onClick={() => move(guardrail, 1)}
                                    >
                                      <ArrowDown className="size-4" />
                                    </Button>
                                  </>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isPending || editing !== null}
                                  onClick={() => setEditing({ key: guardrail.id, draft: structuredClone(guardrail) })}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  disabled={isPending}
                                  onClick={() =>
                                    confirmDelete({
                                      title: "Delete this guardrail?",
                                      description: `“${guardrail.name}” stops checking this assistant's conversations.`,
                                      onConfirm: async () => {
                                        await persist(guardrails.filter((g) => g.id !== guardrail.id));
                                        toast.success("Guardrail deleted");
                                      },
                                    })
                                  }
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      )
                    )}
                  </ul>
                )}

                {form(newKey, "Add guardrail", (draft) =>
                  save([...guardrails, draft], "Guardrail added", () => setEditing(null))
                )}
              </Card>
            </TimelineSection>
          );
        })}
      </SectionTimeline>
      {canEdit && (
        <p className="text-muted-foreground mt-2 pl-7 text-xs lg:pl-10">
          <span className="tabular-nums">
            <RollingNumber value={guardrails.length} />/{formatCount(GUARDRAIL_CAP)}
          </span>{" "}
          guardrails used.
        </p>
      )}
      {confirmDeleteModal}
    </div>
  );
}
