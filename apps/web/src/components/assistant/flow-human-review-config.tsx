"use client";

import type { HumanReviewSettings, ReviewInputField, ReviewInputType } from "@agent-hub/core";
import {
  DEFAULT_REVIEW_HALT_MESSAGE,
  DEFAULT_REVIEW_TIMEOUT_HOURS,
  DEFAULT_REVIEW_WAITING_MESSAGE,
  humanReviewSettingsIssue,
  newReviewInputField,
  reviewRequestText,
} from "@agent-hub/core";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ConnectorConnectionOption } from "@/lib/connector-options";
import type { FlowDraft } from "@/lib/flow-editor";
import { useApplicationConnectedToast } from "@/components/knowledge/use-application-connected";

/**
 * The Human review node's fields (#841): who is asked, how, what they fill in,
 * and what the Visitor reads while waiting or when the gate closes. The rule
 * that decides "Needs setup" is `humanReviewSettingsIssue` in core, shared
 * with Publish; this component only renders the fields it names.
 */

const INPUT_TYPES: { value: ReviewInputType; label: string }[] = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "dropdown", label: "Dropdown" },
  { value: "yes_no", label: "Yes / no" },
];

const OAUTH_POPUP = "ciele-application-oauth";

export function HumanReviewConfig({
  settings,
  connections,
  onChange,
}: {
  settings: HumanReviewSettings | undefined;
  /** The Member's own connections (the page filters to org + own). */
  connections: ConnectorConnectionOption[];
  onChange: (patch: Partial<HumanReviewSettings>) => void;
}) {
  useApplicationConnectedToast("Mailbox connected.");

  const channel = settings?.channel ?? "email";
  const mailboxes = connections.filter((c) => c.provider === "microsoft_mail");
  const slacks = connections.filter(
    (c) => c.provider === "slack" && c.ownerType === "organization"
  );
  const inputs = settings?.inputs ?? [];
  const issue = humanReviewSettingsIssue(settings);

  function connectMailbox() {
    const params = new URLSearchParams({ returnTo: window.location.pathname });
    window.open(
      `/api/applications/oauth/microsoft_mail/start?${params}`,
      OAUTH_POPUP,
      "popup,width=560,height=760"
    );
  }

  function updateInput(index: number, patch: Partial<ReviewInputField>) {
    onChange({ inputs: inputs.map((field, i) => (i === index ? { ...field, ...patch } : field)) });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Title</Label>
        <Input
          value={settings?.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Approve a refund"
          className="bg-background"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Message to the reviewer</Label>
        <Textarea
          value={settings?.message ?? ""}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="A student is asking for a refund on {{workflow.message}}. Approve if the policy allows it."
          rows={3}
          className="bg-background"
        />
        <p className="text-muted-foreground text-xs">
          Template variables work here. The conversation summary is added automatically.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Assigned to</Label>
        <Input
          value={(settings?.assignees ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              assignees: e.target.value
                .split(/[,\s;]+/)
                .map((part) => part.trim())
                .filter(Boolean),
            })
          }
          placeholder="ann@campus.edu, bob@campus.edu"
          className="bg-background"
        />
        <p className="text-muted-foreground text-xs">
          Member email addresses. The first to decide closes the request.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Channel</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(["email", "slack"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={channel === candidate}
              onClick={() => onChange({ channel: candidate })}
              className={
                channel === candidate
                  ? "press-control border-primary bg-primary/10 rounded-lg border px-3 py-2 text-sm font-medium"
                  : "press-control hover:bg-muted rounded-lg border px-3 py-2 text-sm"
              }
            >
              {candidate === "email" ? "Email" : "Slack"}
            </button>
          ))}
        </div>
      </div>

      {channel === "email" ? (
        <div className="space-y-1.5">
          <Label>Sent from</Label>
          {mailboxes.length === 0 ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                Connect your Microsoft 365 mailbox. Requests are sent from your account.
              </span>
              <Button type="button" size="sm" variant="outline" onClick={connectMailbox}>
                <KeyRound className="size-4" /> Connect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={settings?.senderConnectionId ?? ""}
                onValueChange={(value) =>
                  onChange({ senderConnectionId: (value as string) || undefined })
                }
              >
                <SelectTrigger className="bg-background min-w-0 flex-1" aria-label="Sender mailbox">
                  <SelectValue>
                    {(value: string) =>
                      mailboxes.find((c) => c.id === value)?.name || "Choose a mailbox…"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Choose a mailbox…</SelectItem>
                  {mailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.id} value={mailbox.id}>
                      {mailbox.name}
                      {mailbox.status !== "connected"
                        ? ` · ${mailbox.status.replace(/_/g, " ")}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="ghost" onClick={connectMailbox}>
                <KeyRound className="size-4" /> New
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Slack channel or person</Label>
          <Input
            value={settings?.slackTarget ?? ""}
            onChange={(e) => onChange({ slackTarget: e.target.value })}
            placeholder="C0123456789 or U0123456789"
            className="bg-background"
          />
          <p className="text-muted-foreground text-xs">
            {slacks.length === 0
              ? "The organization has no Slack connection yet. Connect one under Knowledge → Applications with the chat:write scope."
              : `Posted by ${slacks[0]!.name}. Use the channel or member id from Slack.`}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Inputs the reviewer fills</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ inputs: [...inputs, newReviewInputField(inputs.length)] })}
          >
            <Plus className="size-4" /> Add input
          </Button>
        </div>
        {inputs.length === 0 && (
          <p className="text-muted-foreground text-xs">
            At least one. Each becomes a template variable for later actions, as{" "}
            <code>{"{{review.<id>}}"}</code>.
          </p>
        )}
        {inputs.map((field, index) => (
          <div key={index} className="bg-muted/30 space-y-2 rounded-lg border p-2.5">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                value={field.label}
                onChange={(e) => updateInput(index, { label: e.target.value })}
                placeholder="Label"
                aria-label="Input label"
                className="bg-background"
              />
              <Select
                value={field.type}
                onValueChange={(value) => value && updateInput(index, { type: value as ReviewInputType })}
              >
                <SelectTrigger className="bg-background" aria-label="Input type">
                  <SelectValue>
                    {(value: string) => INPUT_TYPES.find((t) => t.value === value)?.label ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {INPUT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove input"
                onClick={() => onChange({ inputs: inputs.filter((_, i) => i !== index) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Input
                value={field.id}
                onChange={(e) =>
                  updateInput(index, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })
                }
                placeholder="variable id"
                aria-label="Input id"
                className="bg-background font-mono text-xs"
              />
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={field.required !== false}
                  onCheckedChange={(checked) => updateInput(index, { required: checked === true })}
                />
                Required
              </label>
            </div>
            {field.type === "dropdown" && (
              <Input
                value={(field.options ?? []).join(", ")}
                onChange={(e) =>
                  updateInput(index, {
                    options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                  })
                }
                placeholder="Option one, Option two"
                aria-label="Dropdown options"
                className="bg-background"
              />
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Expires after (hours)</Label>
          <Input
            type="number"
            min={1}
            max={24 * 14}
            value={settings?.timeoutHours ?? DEFAULT_REVIEW_TIMEOUT_HOURS}
            onChange={(e) => onChange({ timeoutHours: Number(e.target.value) || DEFAULT_REVIEW_TIMEOUT_HOURS })}
            className="bg-background"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>While waiting, the visitor reads</Label>
        <Textarea
          value={settings?.waitingMessage ?? ""}
          onChange={(e) => onChange({ waitingMessage: e.target.value })}
          placeholder={DEFAULT_REVIEW_WAITING_MESSAGE}
          rows={2}
          className="bg-background"
        />
      </div>
      <div className="space-y-1.5">
        <Label>If rejected or expired, the visitor reads</Label>
        <Textarea
          value={settings?.haltMessage ?? ""}
          onChange={(e) => onChange({ haltMessage: e.target.value })}
          placeholder={DEFAULT_REVIEW_HALT_MESSAGE}
          rows={2}
          className="bg-background"
        />
      </div>
      {issue && <p className="text-destructive text-xs">{issue}</p>}
    </div>
  );
}

/**
 * Run node for a Human review (#841, story 20): the request as the assignee
 * will read it, with sample values, and nothing sent.
 */
export function HumanReviewPreview({ draft }: { draft: FlowDraft }) {
  const settings = draft.settings.human_review;
  const text = reviewRequestText({
    title: settings?.title?.trim() || "Review request",
    message: settings?.message ?? "",
    summary: "Visitor: (the conversation so far appears here)",
    assistantTitle: "Your assistant",
    link: "https://…/reviews/<request>?t=<signed>",
    expiresAt: null,
  });
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        What {settings?.channel === "slack" ? "the Slack message" : "the email"} will say. Nothing is sent from here.
      </p>
      <div className="bg-muted/40 rounded-lg border p-3 text-sm">
        <p className="font-medium">{text.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{text.body}</pre>
      </div>
      <p className="text-muted-foreground text-xs">
        To: {(settings?.assignees ?? []).join(", ") || "(no assignees yet)"}
      </p>
    </div>
  );
}
