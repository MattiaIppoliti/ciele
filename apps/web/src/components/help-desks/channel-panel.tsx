"use client";

import { useEffect, useEffectEvent, useId, useMemo, useState, useTransition } from "react";
import type {
  ApiAuthType,
  ChannelAvailability,
  ChannelConversationData,
  ChannelFormField,
  ChannelKind,
  KeyValuePair,
  SupportChannel,
  SupportChannelConfig,
} from "@agent-hub/core";
import { Trash2, X } from "lucide-react";
import { Calendar, ChevronLeft } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import {
  createSupportChannelAction,
  updateSupportChannelAction,
} from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNEL_KINDS,
  CHANNEL_KIND_ORDER,
  CONVERSATION_DATA_ITEMS,
  FIELD_TYPES,
  FIELD_TYPE_ORDER,
  channelSetupError,
  defaultFormFor,
  newFormField,
} from "@/lib/support-channels";
import { COUNTRIES, findCountry } from "@/lib/countries";
import { TIMEZONES } from "@/lib/timezones";
import { AvailabilityScheduler } from "./availability-scheduler";
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { onRadioKeyDown } from "@/lib/radio-keys";

export type ChannelPanelState =
  | { mode: "select" }
  | { mode: "new"; kind: ChannelKind }
  | { mode: "edit"; channel: SupportChannel };

type EditTab = "setup" | "form" | "conversation" | "availability";

// Opens at the minimum (compact) width; the resize handle is always available
// for the wider editing layout without forcing every channel open at that width.
const PANEL_MIN_WIDTH = 480;
const PANEL_MAX_WIDTH = 1200;

/** Channel kinds whose escalation carries a structured payload worth annotating with chat context. */
const CHANNELS_WITH_CONVERSATION_DATA: ChannelKind[] = [
  "email",
  "api_endpoint",
  "ticket",
  "salesforce_chat",
];

const ALL_EDIT_TABS: Array<{ key: EditTab; label: string }> = [
  { key: "setup", label: "Channel Setup" },
  { key: "form", label: "Form" },
  { key: "conversation", label: "Conversation Data" },
  { key: "availability", label: "Availability" },
];

function tabsForKind(kind: ChannelKind): Array<{ key: EditTab; label: string }> {
  return CHANNELS_WITH_CONVERSATION_DATA.includes(kind)
    ? ALL_EDIT_TABS
    : ALL_EDIT_TABS.filter((t) => t.key !== "conversation");
}

const AUTH_TYPE_LABELS: Record<ApiAuthType, string> = {
  none: "No Authentication",
  api_key: "API Key",
  bearer: "Bearer Token",
  basic: "Basic Auth",
};
const AUTH_TYPE_ORDER: ApiAuthType[] = ["none", "api_key", "bearer", "basic"];

/** Repeatable name/value rows, e.g. an API endpoint's headers or query params. */
function KeyValueListEditor({
  title,
  items,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  title: string;
  items: KeyValuePair[];
  onChange: (items: KeyValuePair[]) => void;
  namePlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  const rows = items.length > 0 ? items : [{ id: "", name: "", value: "" }];

  function updateRow(index: number, patch: Partial<KeyValuePair>) {
    if (items.length === 0) {
      onChange([{ id: crypto.randomUUID(), name: "", value: "", ...patch }]);
      return;
    }
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="font-semibold">{title}</p>
      <div className="mt-2 space-y-2">
        {rows.map((row, index) => (
          <div key={row.id || index} className="flex gap-2">
            <Input
              value={row.name}
              onChange={(e) => updateRow(index, { name: e.target.value })}
              placeholder={namePlaceholder}
              aria-label={`${title}: ${namePlaceholder} ${index + 1}`}
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
            <Input
              value={row.value}
              onChange={(e) => updateRow(index, { value: e.target.value })}
              placeholder={valuePlaceholder}
              aria-label={`${title}: ${valuePlaceholder} ${index + 1}`}
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
            <Hint label="Remove row">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Remove row"
                className="h-11 w-11 shrink-0"
                // The placeholder row shown for an empty list is not a row yet.
                disabled={items.length === 0}
                onClick={() => removeRow(index)}
              >
                <AnimatedIcon icon={Trash2} size={16} />
              </Button>
            </Hint>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-10 w-full font-semibold"
        onClick={() => onChange([...items, { id: crypto.randomUUID(), name: "", value: "" }])}
      >
        + {addLabel}
      </Button>
    </div>
  );
}

/**
 * An input's validation wiring: the id, `aria-invalid` and `aria-describedby`
 * to spread on it, and the message rendered under it.
 */
function fieldError(id: string, message: string | null) {
  const errorId = `${id}-error`;
  return {
    props: {
      id,
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? errorId : undefined,
    },
    text: message ? (
      <p id={errorId} className="text-destructive mt-1.5 text-sm">
        {message}
      </p>
    ) : null,
  };
}

/** Kind-specific destination inputs, shared by the create and edit steps. */
function ConfigFields({
  kind,
  config,
  onChange,
  primaryId,
  error,
}: {
  kind: ChannelKind;
  config: SupportChannelConfig;
  onChange: (patch: SupportChannelConfig) => void;
  /** Id of the required destination input, so a failed save can focus it. */
  primaryId: string;
  /** The `channelSetupError` message, rendered under the input it is about. */
  error: string | null;
}) {
  const { props: primary, text: errorText } = fieldError(primaryId, error);
  if (kind === "email") {
    return (
      <div>
        <p className="font-semibold">
          Destination email <span className="text-destructive">*</span>
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Escalation emails will be sent to this address.
        </p>
        <Input
          value={config.destinationEmail ?? ""}
          onChange={(e) => onChange({ destinationEmail: e.target.value })}
          {...primary}
          placeholder="help@example.com"
          aria-label="Destination email"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-11"
        />
        {errorText}
      </div>
    );
  }
  if (kind === "phone") {
    const country = findCountry(config.phoneCountry);
    return (
      <div>
        <p className="font-semibold">Phone number</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Users will be offered this number for direct support.
        </p>
        {/* A country name plus a phone number do not share a phone-width row:
            the country picker takes its own row until there is space. */}
        <div className="mt-2 grid gap-3 sm:grid-cols-[11rem_1fr]">
          <Select
            value={country.code}
            onValueChange={(value) => {
              const next = findCountry(value as string);
              const current = config.phoneNumber ?? "";
              const rest = current.startsWith(country.dialCode)
                ? current.slice(country.dialCode.length).trimStart()
                : current;
              onChange({
                phoneCountry: next.code,
                phoneNumber: `${next.dialCode}${rest ? ` ${rest}` : " "}`,
              });
            }}
          >
            <SelectTrigger className="h-11" aria-label="Country">
              <SelectValue>
                {() => country.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} ({c.dialCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            {...primary}
            value={config.phoneNumber ?? ""}
            onChange={(e) => onChange({ phoneNumber: e.target.value })}
            placeholder={`${country.dialCode} 06 1234 5678`}
            aria-label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            className="h-11"
          />
        </div>
        {errorText}
      </div>
    );
  }
  if (kind === "live_chat") {
    return (
      <div>
        <p className="font-semibold">Live chat URL</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Users will be connected to this live chat.
        </p>
        <Input
          {...primary}
          value={config.url ?? ""}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://..."
          aria-label="Live chat URL"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-11"
        />
        {errorText}
      </div>
    );
  }
  if (kind === "external_link") {
    return (
      <div>
        <p className="font-semibold">Link URL</p>
        <Input
          {...primary}
          value={config.url ?? ""}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://www.helpdeskurl.com"
          aria-label="Link URL"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-11"
        />
        {errorText}
      </div>
    );
  }
  if (kind === "api_endpoint") {
    const auth = config.authType ?? "none";
    return (
      <div className="space-y-6">
        <div>
          <p className="font-semibold">
            API Endpoint URL <span className="text-destructive">*</span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            The URL where the form data will be sent
          </p>
          <Input
            {...primary}
            value={config.url ?? ""}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://api.example.com/escalations"
            aria-label="API endpoint URL"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="mt-2 h-11"
          />
          {errorText}
        </div>

        <div>
          <p className="font-semibold">Authentication Type</p>
          <Select
            value={auth}
            onValueChange={(value) =>
              onChange({ authType: value as ApiAuthType })
            }
          >
            <SelectTrigger className="mt-2" aria-label="Authentication type">
              <SelectValue>
                {(v: string) => AUTH_TYPE_LABELS[v as ApiAuthType]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AUTH_TYPE_ORDER.map((t) => (
                <SelectItem key={t} value={t}>
                  {AUTH_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {auth === "api_key" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={config.apiKeyHeaderName ?? ""}
              onChange={(e) => onChange({ apiKeyHeaderName: e.target.value })}
              placeholder="Header name"
              aria-label="API key header name"
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
            <Input
              value={config.apiKeyValue ?? ""}
              onChange={(e) => onChange({ apiKeyValue: e.target.value })}
              placeholder="Header value"
              aria-label="API key value"
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
          </div>
        )}
        {auth === "bearer" && (
          <Input
            value={config.bearerToken ?? ""}
            onChange={(e) => onChange({ bearerToken: e.target.value })}
            placeholder="Bearer token"
            aria-label="Bearer token"
            autoComplete="off"
            spellCheck={false}
            className="h-11"
          />
        )}
        {auth === "basic" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={config.basicUsername ?? ""}
              onChange={(e) => onChange({ basicUsername: e.target.value })}
              placeholder="Username"
              aria-label="Basic auth username"
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
            <Input
              type="password"
              value={config.basicPassword ?? ""}
              onChange={(e) => onChange({ basicPassword: e.target.value })}
              placeholder="Password"
              aria-label="Basic auth password"
              // "new-password" is the one value browsers reliably honour: it
              // stops them filling the Member's own saved Ciele password into
              // a credential that belongs to somebody else's API.
              autoComplete="new-password"
              className="h-11"
            />
          </div>
        )}

        <KeyValueListEditor
          title="Headers (optional)"
          items={config.headers ?? []}
          onChange={(headers) => onChange({ headers })}
          namePlaceholder="Header name"
          valuePlaceholder="Header value"
          addLabel="Add header"
        />

        <KeyValueListEditor
          title="Query Parameters (optional)"
          items={config.queryParams ?? []}
          onChange={(queryParams) => onChange({ queryParams })}
          namePlaceholder="Parameter name"
          valuePlaceholder="Parameter value"
          addLabel="Add query parameter"
        />
      </div>
    );
  }
  return (
    <p className="text-muted-foreground text-sm">
      Destination configuration for this channel arrives with the ticketing
      integration.
    </p>
  );
}

/** Read-only rendering of one form field inside the live preview. */
function FieldPreview({ field }: { field: ChannelFormField }) {
  const control = (() => {
    switch (field.type) {
      case "long_text":
        return (
          <div className="text-muted-foreground min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm break-words">
            {field.placeholder || field.label}
          </div>
        );
      case "dropdown":
      case "string_list":
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm">
            <span className="min-w-0 truncate">{field.placeholder || field.label}</span>
            <ChevronLeft aria-hidden className="size-4 shrink-0 -rotate-90" />
          </div>
        );
      case "date":
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center gap-2 rounded-lg border bg-background px-3 text-sm">
            <Calendar aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{field.placeholder || field.label}</span>
          </div>
        );
      case "checkbox":
        return (
          // A span, not a label: this sits inside the preview's button, and a
          // label there is interactive content nested in interactive content.
          <span className="flex items-center gap-2 text-sm">
            <span className="size-4 shrink-0 rounded border" />
            <span className="min-w-0 break-words">{field.label}</span>
          </span>
        );
      default:
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center rounded-lg border bg-background px-3 text-sm">
            <span className="min-w-0 truncate">{field.placeholder || field.label}</span>
          </div>
        );
    }
  })();

  return (
    <div className={field.showInForm === false ? "opacity-40" : ""}>
      <p className="mb-1.5 text-sm font-medium break-words">
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
        {field.showInForm === false && (
          <span className="text-muted-foreground"> (hidden)</span>
        )}
      </p>
      {control}
      {field.useAsReplyTo && (
        <span className="bg-primary/10 text-primary mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold">
          Reply to
        </span>
      )}
    </div>
  );
}

/**
 * Inline editor card for the clicked form field. The draft is owned by the
 * panel, not this card, so switching fields or Save & Close can keep it
 * instead of dropping it with the unmount.
 */
function FieldEditor({
  draft,
  setDraft,
  onCancel,
  onUpdate,
  onDelete,
}: {
  draft: ChannelFormField;
  setDraft: (next: ChannelFormField) => void;
  onCancel: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const fieldId = useId();

  const CHECKS: Array<{
    key: keyof Pick<
      ChannelFormField,
      "usePlaceholderAsDefault" | "useAsReplyTo" | "required" | "showInForm"
    >;
    label: string;
  }> = [
    { key: "usePlaceholderAsDefault", label: "Use placeholder as default value" },
    { key: "useAsReplyTo", label: "Use as reply to email address" },
    { key: "required", label: "Required field" },
    { key: "showInForm", label: "Show in escalation form" },
  ];

  return (
    <div className="border-foreground/30 space-y-4 rounded-xl border bg-muted/20 p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <Hint label="Delete field">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete field"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <AnimatedIcon icon={Trash2} size={16} />
          </Button>
        </Hint>
        <div className="flex gap-2">
          <Button variant="outline" className="h-9 px-4" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="h-9 px-4" onClick={onUpdate}>
            Update
          </Button>
        </div>
      </div>

      <div>
        <p className="font-semibold">Field type</p>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Autocompleted if the user is logged in
        </p>
        <Select
          value={draft.type}
          onValueChange={(value) =>
            setDraft({ ...draft, type: value as ChannelFormField["type"] })
          }
        >
          <SelectTrigger className="mt-2" aria-label="Field type">
            <SelectValue>
              {(value: string) => {
                const fieldType = value as ChannelFormField["type"];
                const Icon = FIELD_TYPES[fieldType].icon;
                return (
                  <>
                    <Icon className="text-muted-foreground size-4" />
                    {FIELD_TYPES[fieldType].label}
                  </>
                );
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPE_ORDER.map((t) => {
              const Icon = FIELD_TYPES[t].icon;
              return (
                <SelectItem key={t} value={t}>
                  <Icon className="text-muted-foreground size-4" />
                  {FIELD_TYPES[t].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor={`${fieldId}-label`} className="font-semibold">Label</Label>
        <Input
          id={`${fieldId}-label`}
          autoComplete="off"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="mt-2 h-11"
        />
      </div>

      <div>
        <Label htmlFor={`${fieldId}-placeholder`} className="font-semibold">Placeholder</Label>
        <Input
          id={`${fieldId}-placeholder`}
          autoComplete="off"
          value={draft.placeholder ?? ""}
          onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })}
          className="mt-2 h-11"
        />
      </div>

      <div className="space-y-2.5">
        {CHECKS.map((c) => (
          <Label key={c.key} className="flex items-center gap-2.5 text-sm font-normal">
            <Checkbox
              checked={draft[c.key] ?? false}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, [c.key]: checked === true })
              }
            />
            {c.label}
          </Label>
        ))}
      </div>
    </div>
  );
}

/** "Conversation Data" tab: which conversation details ride along the escalation. */
function ConversationDataTab({
  kind,
  data,
  onChange,
}: {
  kind: ChannelKind;
  data: ChannelConversationData;
  onChange: (patch: ChannelConversationData) => void;
}) {
  return (
    <div className="mt-8">
      <p className="font-semibold">Conversation data to include</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Directly add conversation details to your {CHANNEL_KINDS[kind].label}.
      </p>
      <div className="mt-4 space-y-3">
        {CONVERSATION_DATA_ITEMS.map((item) => (
          <Label
            key={item.key}
            className="hover:bg-muted/30 flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal transition-colors"
          >
            <Checkbox
              checked={data[item.key] ?? false}
              onCheckedChange={(checked) => onChange({ [item.key]: checked === true })}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold">{item.label}</span>
              <span className="text-muted-foreground block text-sm">
                {item.description}
              </span>
            </span>
          </Label>
        ))}
      </div>
    </div>
  );
}

/** "Availability" tab: always-on vs. a weekly opening schedule. */
function AvailabilityTab({
  availability,
  onChange,
}: {
  availability: ChannelAvailability;
  onChange: (patch: Partial<ChannelAvailability>) => void;
}) {
  return (
    <div className="mt-8 space-y-5">
      <div>
        <p className="font-semibold">Availability</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Customize weekly hours and special dates when availability changes.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Availability"
        className="space-y-3"
      >
        {(
          [
            { value: "always", label: "Always available" },
            { value: "limited", label: "Limited availability" },
          ] as const
        ).map((option) => {
          const selected = availability.mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange({ mode: option.value })}
              onKeyDown={onRadioKeyDown}
              className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-4 text-left font-semibold transition-colors ${
                selected
                  ? "border-primary bg-background"
                  : "border-transparent bg-muted/60"
              }`}
            >
              <span
                aria-hidden
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {selected && <span className="bg-primary size-2.5 rounded-full" />}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>

      {availability.mode === "limited" && (
        <>
          <div>
            <p className="font-semibold">Timezone</p>
            <Select
              value={availability.timezone}
              onValueChange={(value) => onChange({ timezone: value as string })}
            >
              <SelectTrigger className="mt-2" aria-label="Timezone">
                <SelectValue>
                  {(v: string) => TIMEZONES.find((tz) => tz.value === v)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AvailabilityScheduler
            value={availability.hours}
            step={30}
            onChange={(hours) => onChange({ hours })}
          />
        </>
      )}
    </div>
  );
}

export function ChannelPanel({
  helpDeskId,
  initial,
  canEdit = true,
  onClose,
}: {
  helpDeskId: string;
  initial: ChannelPanelState;
  /** False for a Viewer: the edit step renders read-only and offers no save. */
  canEdit?: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<ChannelPanelState>(initial);
  const [tab, setTab] = useState<EditTab>("setup");
  // Create-step draft
  const [name, setName] = useState(
    initial.mode === "new" ? CHANNEL_KINDS[initial.kind].defaultName : ""
  );
  const [config, setConfig] = useState<SupportChannelConfig>({});
  // Edit-step draft
  const [channel, setChannel] = useState<SupportChannel | null>(
    initial.mode === "edit" ? initial.channel : null
  );
  // The open field editor's working copy; its id is the field being edited.
  const [fieldDraft, setFieldDraft] = useState<ChannelFormField | null>(null);
  const [error, setError] = useState<{
    target: "name" | "config";
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const baseId = useId();
  const nameInputId = `${baseId}-name`;
  const configInputId = `${baseId}-config`;
  const { width, resizing, beginResize, resizeTo, widthTransition, containerRef } =
    useResizableWidth({
      defaultWidth: PANEL_MIN_WIDTH,
      minWidth: PANEL_MIN_WIDTH,
      maxWidth: PANEL_MAX_WIDTH,
    });

  useModalFocus(true, containerRef);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  // defaultFormFor mints fresh field ids on every call: once per kind keeps
  // the preview list's keys stable and makes the created ids the previewed ones.
  const newKind = state.mode === "new" ? state.kind : null;
  const defaultForm = useMemo(
    () => (newKind ? defaultFormFor(newKind) : []),
    [newKind]
  );

  // The form as it would be saved: an open field editor's draft counts.
  const form = channel
    ? fieldDraft
      ? channel.form.map((f) => (f.id === fieldDraft.id ? fieldDraft : f))
      : channel.form
    : [];

  // Edits live only in this draft until Save & Close (or Create channel).
  // Escape, the backdrop, the X and Back all ask before dropping them, and a
  // reload or closed tab gets the browser's own prompt.
  const savedChannel = state.mode === "edit" ? state.channel : null;
  const editDirty =
    canEdit &&
    channel !== null &&
    savedChannel !== null &&
    JSON.stringify({ ...channel, form }) !== JSON.stringify(savedChannel);
  const newDirty =
    state.mode === "new" &&
    (name !== CHANNEL_KINDS[state.kind].defaultName ||
      Object.values(config).some((value) =>
        Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ""
      ));
  const dirty = editDirty || newDirty;

  const { leave } = useUnsavedChanges({
    dirty,
    confirmDelete,
    description:
      state.mode === "new"
        ? "This channel has not been created yet."
        : "The edits to this channel are not saved yet.",
  });

  function requestClose() {
    // Closing mid-save would hide whether the save landed.
    if (isPending) return;
    leave(onClose);
  }

  function requestBack() {
    if (isPending) return;
    leave(() => {
      setError(null);
      setState({ mode: "select" });
    });
  }

  // An effect event, so the listener is attached once, not per keystroke.
  const onEscape = useEffectEvent(requestClose);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The discard confirm is a dialog of its own: Escape there closes it,
      // and must not also reach the panel underneath.
      if (document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length > 1) {
        return;
      }
      onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Show a validation error beside its input and move focus there. */
  function fail(target: "name" | "config", message: string) {
    setError({ target, message });
    if (state.mode === "edit") setTab("setup");
    // After the commit, so a tab switched just now has mounted the input.
    requestAnimationFrame(() => {
      document.getElementById(target === "name" ? nameInputId : configInputId)?.focus();
    });
  }

  function failedAction(err: unknown, fallback: string) {
    if (isRedirectError(err)) throw err;
    // The panel stays open with the draft intact, so a retry is one click.
    toast.error(err instanceof Error ? err.message : fallback);
  }

  function pickKind(kind: ChannelKind) {
    const meta = CHANNEL_KINDS[kind];
    if (meta.requiresTicketing) {
      toast.info(
        `${meta.label} requires the ticketing integration, coming in a later iteration.`
      );
      return;
    }
    setName(meta.defaultName);
    setConfig({});
    setError(null);
    setState({ mode: "new", kind });
  }

  function create(kind: ChannelKind) {
    if (!name.trim()) {
      fail("name", "Channel name is required");
      return;
    }
    const setupError = channelSetupError(kind, config);
    if (setupError) {
      fail("config", setupError);
      return;
    }
    setError(null);
    startTransition(async () => {
      let created: SupportChannel;
      try {
        created = await createSupportChannelAction(helpDeskId, {
          kind,
          name: name.trim(),
          config,
          form: defaultForm,
        });
      } catch (err) {
        failedAction(err, "Could not create the channel");
        return;
      }
      toast.success(`"${created.name}" channel created`);
      setChannel(created);
      setState({ mode: "edit", channel: created });
      setTab(created.form.length > 0 ? "form" : "setup");
    });
  }

  function patchChannel(patch: Partial<SupportChannel>) {
    setChannel((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function saveAndClose() {
    if (!channel) return;
    if (!channel.name.trim()) {
      fail("name", "Channel name is required");
      return;
    }
    const setupError = channelSetupError(channel.kind, channel.config);
    if (setupError) {
      fail("config", setupError);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateSupportChannelAction(helpDeskId, channel.id, {
          name: channel.name.trim(),
          config: channel.config,
          formTitle: channel.formTitle,
          form,
          confirmationMessage: channel.confirmationMessage,
          conversationData: channel.conversationData,
          availability: channel.availability,
        });
      } catch (err) {
        failedAction(err, "Could not save the channel");
        return;
      }
      toast.success("Channel saved");
      onClose();
    });
  }

  /** Open a field's editor, keeping whatever the open one had typed. */
  function openField(field: ChannelFormField) {
    if (fieldDraft) patchChannel({ form });
    setFieldDraft(field);
  }

  function clearError() {
    if (error) setError(null);
  }

  const { props: nameErrorProps, text: nameError } = fieldError(
    nameInputId,
    error?.target === "name" ? error.message : null
  );
  const configError = error?.target === "config" ? error.message : null;

  return (
    <>
      {confirmDeleteModal}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={requestClose}
        aria-hidden
      />
      <aside
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Support channel"
        aria-busy={isPending || undefined}
        tabIndex={-1}
        style={{ width }}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l bg-background shadow-strong ${widthTransition} ${
          isPending ? "opacity-70" : ""
        }`}
      >
        <ResizeHandle
          resizing={resizing}
          onPointerDown={(event) => beginResize(event)}
          label="Resize channel panel"
          value={width}
          minValue={PANEL_MIN_WIDTH}
          maxValue={PANEL_MAX_WIDTH}
          onValueChange={resizeTo}
        />
        {/* Inner scroll container, overflow lives here, not on the aside
            itself, so the resize handle poking out at -left-1.5 isn't clipped
            (overflow-y-auto on the aside would force overflow-x to auto too).
            Inert while a create or save is in flight, so the draft cannot
            change under the request carrying it. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          inert={isPending}
        >
          {/* ---- Select channel type ---- */}
          {state.mode === "select" && (
            <div className="p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">
                  Select channel type
                </h2>
                <Hint label="Close">
                  <Button variant="ghost" size="icon" aria-label="Close" onClick={requestClose}>
                    <X className="size-5" />
                  </Button>
                </Hint>
              </div>
              <div className="mt-6 space-y-3">
                {CHANNEL_KIND_ORDER.map((kind) => {
                  const meta = CHANNEL_KINDS[kind];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => pickKind(kind)}
                      className="hover:bg-muted/50 flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left transition-colors"
                    >
                      <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
                        <Icon className="size-5" />
                      </span>
                      <span>
                        <span className="block text-base font-semibold">
                          {meta.label}
                        </span>
                        <span className="text-muted-foreground block text-sm">
                          {meta.subtitle}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- New channel (setup step) ---- */}
          {state.mode === "new" && (
            <div className="flex min-h-full flex-col p-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={requestBack}
                  className="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold hover:opacity-70"
                >
                  <ChevronLeft className="size-4" /> Back
                </button>
                <h2 className="min-w-0 text-2xl font-semibold break-words">
                  New {CHANNEL_KINDS[state.kind].label} channel
                </h2>
                <Hint label="Close">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    className="ml-auto shrink-0"
                    onClick={requestClose}
                  >
                    <X className="size-5" />
                  </Button>
                </Hint>
              </div>

              {/* Library's pill rail, so a section switcher looks the same
                  everywhere; it scrolls with edge chevrons when the drawer is
                  narrower than its tabs. */}
              <Tabs value="setup" className="mt-6">
                <TabsList aria-label="Channel setup mode">
                  {tabsForKind(state.kind).map((t) => (
                    <TabsTrigger
                      key={t.key}
                      value={t.key}
                      disabled={t.key !== "setup"}
                    >
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="mt-8 space-y-6">
                <div>
                  <p className="font-semibold">Channel name</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    The button label in the escalation menu.
                  </p>
                  <Input
                    {...nameErrorProps}
                    value={name}
                    aria-label="Channel name"
                    autoComplete="off"
                    onChange={(e) => {
                      setName(e.target.value);
                      clearError();
                    }}
                    className="mt-2 h-11"
                  />
                  {nameError}
                </div>
                <ConfigFields
                  kind={state.kind}
                  config={config}
                  primaryId={configInputId}
                  error={configError}
                  onChange={(patch) => {
                    setConfig({ ...config, ...patch });
                    clearError();
                  }}
                />
              </div>

              <div className="mt-auto pt-10">
                {defaultForm.length > 0 && (
                  <div className="text-muted-foreground mb-6 text-sm">
                    <p>Default fields that will be created:</p>
                    <ul className="mt-2 space-y-1.5">
                      {defaultForm.map((f) => {
                        const Icon = FIELD_TYPES[f.type].icon;
                        return (
                          <li key={f.id} className="flex items-center gap-2">
                            <Icon className="size-4" /> {f.label} (
                            {FIELD_TYPES[f.type].label})
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <Button
                  className="h-11 w-full rounded-xl font-semibold"
                  onClick={() => create(state.kind)}
                  disabled={isPending}
                >
                  <RollInText text={isPending ? "Creating…" : "Create channel"} />
                </Button>
              </div>
            </div>
          )}

          {/* ---- Edit channel ---- */}
          {state.mode === "edit" && channel && (
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {canEdit ? "Edit escalation channel" : "Escalation channel"}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold break-words">
                    {channel.name}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && (
                    <Button
                      className="h-10 rounded-xl px-4 font-semibold"
                      onClick={saveAndClose}
                      disabled={isPending}
                    >
                      <RollInText text={isPending ? "Saving…" : "Save & Close"} />
                    </Button>
                  )}
                  <Hint label="Close">
                    <Button variant="ghost" size="icon" aria-label="Close" onClick={requestClose}>
                      <X className="size-5" />
                    </Button>
                  </Hint>
                </div>
              </div>
              <span className="bg-primary/10 text-primary mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
                {(() => {
                  const Icon = CHANNEL_KINDS[channel.kind].icon;
                  return <Icon className="size-4" />;
                })()}
                {CHANNEL_KINDS[channel.kind].label}
              </span>

              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as EditTab)}
                className="mt-5"
              >
                <TabsList aria-label="Channel settings section">
                  {tabsForKind(channel.kind).map((t) => (
                    <TabsTrigger key={t.key} value={t.key}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {/* A Viewer can open a channel to read it; the fieldset disables
                  every native control under it, so nothing looks editable. */}
              <fieldset disabled={!canEdit} className="min-w-0">
                {tab === "setup" && (
                  <div className="mt-8 space-y-6">
                    <div>
                      <p className="font-semibold">Channel name</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        The button label in the escalation menu.
                      </p>
                      <Input
                        {...nameErrorProps}
                        value={channel.name}
                        aria-label="Channel name"
                        autoComplete="off"
                        onChange={(e) => {
                          patchChannel({ name: e.target.value });
                          clearError();
                        }}
                        className="mt-2 h-11"
                      />
                      {nameError}
                    </div>
                    <ConfigFields
                      kind={channel.kind}
                      config={channel.config}
                      primaryId={configInputId}
                      error={configError}
                      onChange={(patch) => {
                        patchChannel({ config: { ...channel.config, ...patch } });
                        clearError();
                      }}
                    />
                  </div>
                )}

                {tab === "form" && (
                  <div className="mt-6 rounded-xl border bg-card p-4">
                    <input
                      value={channel.formTitle}
                      onChange={(e) => patchChannel({ formTitle: e.target.value })}
                      aria-label="Form title"
                      autoComplete="off"
                      className="focus:ring-ring/50 -mx-2 w-full rounded-lg px-2 py-1 text-2xl font-semibold outline-none focus:ring-2"
                    />

                    <div className="mt-5 space-y-5">
                      {channel.form.map((field) =>
                        fieldDraft?.id === field.id ? (
                          <FieldEditor
                            key={field.id}
                            draft={fieldDraft}
                            setDraft={setFieldDraft}
                            onCancel={() => setFieldDraft(null)}
                            onUpdate={() => {
                              patchChannel({ form });
                              setFieldDraft(null);
                            }}
                            onDelete={() => {
                              patchChannel({
                                form: channel.form.filter((f) => f.id !== field.id),
                              });
                              setFieldDraft(null);
                            }}
                          />
                        ) : (
                          <button
                            key={field.id}
                            type="button"
                            aria-label={`Edit ${field.label} field`}
                            onClick={() => openField(field)}
                            className="hover:bg-muted/40 -m-2 block w-[calc(100%+1rem)] rounded-xl p-2 text-left transition-colors"
                          >
                            <FieldPreview field={field} />
                          </button>
                        )
                      )}
                    </div>

                    {canEdit && (
                      <div className="mt-5 flex justify-end">
                        <Button
                          variant="outline"
                          className="h-9 px-4 font-semibold"
                          onClick={() => {
                            const field = newFormField();
                            patchChannel({ form: [...form, field] });
                            setFieldDraft(field);
                          }}
                        >
                          Add field +
                        </Button>
                      </div>
                    )}

                    <div className="bg-foreground/90 text-background mt-6 rounded-xl py-3 text-center text-base font-semibold">
                      Submit
                    </div>

                    <div className="mt-6">
                      <p className="font-semibold">Message shown after submission</p>
                      <Textarea
                        value={channel.confirmationMessage}
                        aria-label="Message shown after submission"
                        onChange={(e) =>
                          patchChannel({ confirmationMessage: e.target.value })
                        }
                        placeholder="Thanks! Your request has been sent, we'll get back to you soon."
                        rows={3}
                        className="mt-2"
                      />
                    </div>
                  </div>
                )}

                {tab === "conversation" && (
                  <ConversationDataTab
                    kind={channel.kind}
                    data={channel.conversationData}
                    onChange={(patch) =>
                      patchChannel({
                        conversationData: { ...channel.conversationData, ...patch },
                      })
                    }
                  />
                )}

                {tab === "availability" && (
                  <AvailabilityTab
                    availability={channel.availability}
                    onChange={(patch) =>
                      patchChannel({
                        availability: { ...channel.availability, ...patch },
                      })
                    }
                  />
                )}
              </fieldset>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
