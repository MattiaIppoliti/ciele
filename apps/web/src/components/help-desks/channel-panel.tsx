"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ApiAuthType,
  ChannelAvailability,
  ChannelConversationData,
  ChannelFormField,
  ChannelKind,
  KeyValuePair,
  SupportChannel,
  SupportChannelConfig,
} from "@agent-hub/db";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ClipboardList,
  Settings,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "sonner";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export type ChannelPanelState =
  | { mode: "select" }
  | { mode: "new"; kind: ChannelKind }
  | { mode: "edit"; channel: SupportChannel };

type EditTab = "setup" | "form" | "conversation" | "availability";

const PANEL_MIN_WIDTH = 480;
// Open compact by default; the resize handle is always available for the
// wider editing layout without forcing every channel open at that width.
const PANEL_DEFAULT_WIDTH = PANEL_MIN_WIDTH;
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

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
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
      onChange([{ id: rid(), name: "", value: "", ...patch }]);
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
              className="h-11"
            />
            <Input
              value={row.value}
              onChange={(e) => updateRow(index, { value: e.target.value })}
              placeholder={valuePlaceholder}
              className="h-11"
            />
            <Hint label="Remove row">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Remove row"
                className="h-11 w-11 shrink-0"
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
        onClick={() => onChange([...items, { id: rid(), name: "", value: "" }])}
      >
        + {addLabel}
      </Button>
    </div>
  );
}

/** Kind-specific destination inputs, shared by the create and edit steps. */
function ConfigFields({
  kind,
  config,
  onChange,
}: {
  kind: ChannelKind;
  config: SupportChannelConfig;
  onChange: (patch: SupportChannelConfig) => void;
}) {
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
          placeholder="help@example.com"
          className="mt-2 h-11"
        />
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
        <div className="mt-2 grid grid-cols-[11rem_1fr] gap-3">
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
            <SelectTrigger className="h-11">
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
            value={config.phoneNumber ?? ""}
            onChange={(e) => onChange({ phoneNumber: e.target.value })}
            placeholder={`${country.dialCode} 06 1234 5678`}
            className="h-11"
          />
        </div>
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
          value={config.url ?? ""}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://..."
          className="mt-2 h-11"
        />
      </div>
    );
  }
  if (kind === "external_link") {
    return (
      <div>
        <p className="font-semibold">Link URL</p>
        <Input
          value={config.url ?? ""}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://www.helpdeskurl.com"
          className="mt-2 h-11"
        />
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
            value={config.url ?? ""}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://api.example.com/escalations"
            className="mt-2 h-11"
          />
        </div>

        <div>
          <p className="font-semibold">Authentication Type</p>
          <Select
            value={auth}
            onValueChange={(value) =>
              onChange({ authType: value as ApiAuthType })
            }
          >
            <SelectTrigger className="mt-2">
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
              className="h-11"
            />
            <Input
              value={config.apiKeyValue ?? ""}
              onChange={(e) => onChange({ apiKeyValue: e.target.value })}
              placeholder="Header value"
              className="h-11"
            />
          </div>
        )}
        {auth === "bearer" && (
          <Input
            value={config.bearerToken ?? ""}
            onChange={(e) => onChange({ bearerToken: e.target.value })}
            placeholder="Bearer token"
            className="h-11"
          />
        )}
        {auth === "basic" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={config.basicUsername ?? ""}
              onChange={(e) => onChange({ basicUsername: e.target.value })}
              placeholder="Username"
              className="h-11"
            />
            <Input
              type="password"
              value={config.basicPassword ?? ""}
              onChange={(e) => onChange({ basicPassword: e.target.value })}
              placeholder="Password"
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
          <div className="text-muted-foreground min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm">
            {field.placeholder || field.label}
          </div>
        );
      case "dropdown":
      case "string_list":
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center justify-between rounded-lg border bg-background px-3 text-sm">
            {field.placeholder || field.label}
            <ChevronLeft className="size-4 -rotate-90" />
          </div>
        );
      case "date":
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center gap-2 rounded-lg border bg-background px-3 text-sm">
            <Calendar className="size-4" /> {field.placeholder || field.label}
          </div>
        );
      case "checkbox":
        return (
          <label className="flex items-center gap-2 text-sm">
            <span className="size-4 rounded border" /> {field.label}
          </label>
        );
      default:
        return (
          <div className="text-muted-foreground flex h-11 w-full items-center rounded-lg border bg-background px-3 text-sm">
            {field.placeholder || field.label}
          </div>
        );
    }
  })();

  return (
    <div className={field.showInForm === false ? "opacity-40" : ""}>
      <p className="mb-1.5 text-sm font-medium">
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

/** Inline editor card for the clicked form field. */
function FieldEditor({
  field,
  onCancel,
  onUpdate,
  onDelete,
}: {
  field: ChannelFormField;
  onCancel: () => void;
  onUpdate: (next: ChannelFormField) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ChannelFormField>(field);

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
          <Button className="h-9 px-4" onClick={() => onUpdate(draft)}>
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
          <SelectTrigger className="mt-2">
            <SelectValue>
              {(value: ChannelFormField["type"]) => {
                const Icon = FIELD_TYPES[value].icon;
                return (
                  <>
                    <Icon className="text-muted-foreground size-4" />
                    {FIELD_TYPES[value].label}
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
        <Label className="font-semibold">Label</Label>
        <Input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="mt-2 h-11"
        />
      </div>

      <div>
        <Label className="font-semibold">Placeholder</Label>
        <Input
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

      <div className="space-y-3">
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
              onClick={() => onChange({ mode: option.value })}
              className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-4 text-left font-semibold transition-colors ${
                selected
                  ? "border-primary bg-background"
                  : "border-transparent bg-muted/60"
              }`}
            >
              <span
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
              <SelectTrigger className="mt-2">
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
  onClose,
}: {
  helpDeskId: string;
  initial: ChannelPanelState;
  onClose: () => void;
}) {
  const router = useRouter();
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
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { width, resizing, setResizing, containerRef } = useResizableWidth({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
  });

  function pickKind(kind: ChannelKind) {
    const meta = CHANNEL_KINDS[kind];
    if (meta.requiresTicketing) {
      toast.info(
        `${meta.label} requires the ticketing integration — coming in a later iteration.`
      );
      return;
    }
    setName(meta.defaultName);
    setConfig({});
    setState({ mode: "new", kind });
  }

  function create(kind: ChannelKind) {
    if (!name.trim()) {
      toast.error("Channel name is required");
      return;
    }
    const setupError = channelSetupError(kind, config);
    if (setupError) {
      toast.error(setupError);
      return;
    }
    startTransition(async () => {
      const created = await createSupportChannelAction(helpDeskId, {
        kind,
        name: name.trim(),
        config,
        form: defaultFormFor(kind),
      });
      toast.success(`"${created.name}" channel created`);
      setChannel(created);
      setState({ mode: "edit", channel: created });
      setTab(created.form.length > 0 ? "form" : "setup");
      router.refresh();
    });
  }

  function patchChannel(patch: Partial<SupportChannel>) {
    setChannel((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function saveAndClose() {
    if (!channel) return;
    if (!channel.name.trim()) {
      toast.error("Channel name is required");
      return;
    }
    const setupError = channelSetupError(channel.kind, channel.config);
    if (setupError) {
      toast.error(setupError);
      setTab("setup");
      return;
    }
    startTransition(async () => {
      await updateSupportChannelAction(helpDeskId, channel.id, {
        name: channel.name.trim(),
        config: channel.config,
        formTitle: channel.formTitle,
        form: channel.form,
        confirmationMessage: channel.confirmationMessage,
        conversationData: channel.conversationData,
        availability: channel.availability,
      });
      toast.success("Channel saved");
      router.refresh();
      onClose();
    });
  }

  const TAB_ICONS: Record<EditTab, typeof Settings> = {
    setup: Settings,
    form: ClipboardList,
    conversation: Ticket,
    availability: CalendarClock,
  };

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
        aria-label="Support channel"
        style={{ width }}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l bg-background shadow-xl ${
          isPending ? "pointer-events-none opacity-70" : ""
        }`}
      >
        <ResizeHandle
          resizing={resizing}
          onPointerDown={() => setResizing(true)}
          label="Resize channel panel"
        />
        {/* Inner scroll container — overflow lives here, not on the aside
            itself, so the resize handle poking out at -left-1.5 isn't clipped
            (overflow-y-auto on the aside would force overflow-x to auto too). */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ---- Select channel type ---- */}
          {state.mode === "select" && (
            <div className="p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight">
                  Select channel type
                </h2>
                <Hint label="Close">
                  <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
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
                  onClick={() => setState({ mode: "select" })}
                  className="text-primary flex items-center gap-1 text-sm font-semibold hover:opacity-70"
                >
                  <ChevronLeft className="size-4" /> Back
                </button>
                <h2 className="text-2xl font-bold tracking-tight">
                  New {CHANNEL_KINDS[state.kind].label} channel
                </h2>
                <Hint label="Close">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    className="ml-auto"
                    onClick={onClose}
                  >
                    <X className="size-5" />
                  </Button>
                </Hint>
              </div>

              <Tabs value="setup" className="mt-6 w-fit">
                <TabsList className="h-auto rounded-xl bg-muted/60 p-1.5">
                  {tabsForKind(state.kind).map((t) => {
                    const Icon = TAB_ICONS[t.key];
                    return (
                      <TabsTrigger
                        key={t.key}
                        value={t.key}
                        disabled={t.key !== "setup"}
                        className="gap-1.5 rounded-lg px-3 py-1.5 font-semibold"
                      >
                        <Icon className="size-4" />
                        {t.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>

              <div className="mt-8 space-y-6">
                <div>
                  <p className="font-semibold">Channel name</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Displayed as a button in the escalation menu. Users click
                    this as a button name to select this method.
                  </p>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-2 h-11"
                  />
                </div>
                <ConfigFields
                  kind={state.kind}
                  config={config}
                  onChange={(patch) => setConfig({ ...config, ...patch })}
                />
              </div>

              <div className="mt-auto pt-10">
                {defaultFormFor(state.kind).length > 0 && (
                  <div className="text-muted-foreground mb-6 text-sm">
                    <p>Default fields that will be created:</p>
                    <ul className="mt-2 space-y-1.5">
                      {defaultFormFor(state.kind).map((f) => {
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
                  {isPending ? "Creating..." : "Create channel"}
                </Button>
              </div>
            </div>
          )}

          {/* ---- Edit channel ---- */}
          {state.mode === "edit" && channel && (
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                    Edit escalation channel
                  </p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight">
                    {channel.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    className="h-10 rounded-xl px-4 font-semibold"
                    onClick={saveAndClose}
                    disabled={isPending}
                  >
                    {isPending ? "Saving..." : "Save & Close"}
                  </Button>
                  <Hint label="Close">
                    <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
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
                className="mt-5 w-fit"
              >
                <TabsList className="h-auto rounded-xl bg-muted/60 p-1.5">
                  {tabsForKind(channel.kind).map((t) => {
                    const Icon = TAB_ICONS[t.key];
                    return (
                      <TabsTrigger
                        key={t.key}
                        value={t.key}
                        className="gap-1.5 rounded-lg px-3 py-1.5 font-semibold"
                      >
                        <Icon className="size-4" />
                        {t.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>

              {tab === "setup" && (
                <div className="mt-8 space-y-6">
                  <div>
                    <p className="font-semibold">Channel name</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Displayed as a button in the escalation menu. Users click
                      this as a button name to select this method.
                    </p>
                    <Input
                      value={channel.name}
                      onChange={(e) => patchChannel({ name: e.target.value })}
                      className="mt-2 h-11"
                    />
                  </div>
                  <ConfigFields
                    kind={channel.kind}
                    config={channel.config}
                    onChange={(patch) =>
                      patchChannel({ config: { ...channel.config, ...patch } })
                    }
                  />
                </div>
              )}

              {tab === "form" && (
                <div className="mt-6 rounded-xl border bg-card p-4">
                  <input
                    value={channel.formTitle}
                    onChange={(e) => patchChannel({ formTitle: e.target.value })}
                    aria-label="Form title"
                    className="focus:ring-ring/50 -mx-2 w-full rounded-lg px-2 py-1 text-2xl font-bold tracking-tight outline-none focus:ring-2"
                  />

                  <div className="mt-5 space-y-5">
                    {channel.form.map((field) =>
                      editingFieldId === field.id ? (
                        <FieldEditor
                          key={field.id}
                          field={field}
                          onCancel={() => setEditingFieldId(null)}
                          onUpdate={(next) => {
                            patchChannel({
                              form: channel.form.map((f) =>
                                f.id === next.id ? next : f
                              ),
                            });
                            setEditingFieldId(null);
                          }}
                          onDelete={() => {
                            patchChannel({
                              form: channel.form.filter((f) => f.id !== field.id),
                            });
                            setEditingFieldId(null);
                          }}
                        />
                      ) : (
                        <button
                          key={field.id}
                          type="button"
                          onClick={() => setEditingFieldId(field.id)}
                          className="hover:bg-muted/40 -m-2 block w-[calc(100%+1rem)] rounded-xl p-2 text-left transition-colors"
                        >
                          <FieldPreview field={field} />
                        </button>
                      )
                    )}
                  </div>

                  <div className="mt-5 flex justify-end">
                    <Button
                      variant="outline"
                      className="h-9 px-4 font-semibold"
                      onClick={() => {
                        const field = newFormField();
                        patchChannel({ form: [...channel.form, field] });
                        setEditingFieldId(field.id);
                      }}
                    >
                      Add field +
                    </Button>
                  </div>

                  <div className="bg-foreground/90 text-background mt-6 rounded-xl py-3 text-center text-base font-semibold">
                    Submit
                  </div>

                  <div className="mt-6">
                    <p className="font-semibold">Message shown after submission</p>
                    <Textarea
                      value={channel.confirmationMessage}
                      onChange={(e) =>
                        patchChannel({ confirmationMessage: e.target.value })
                      }
                      placeholder="Thanks! Your request has been sent — we'll get back to you soon."
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
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
