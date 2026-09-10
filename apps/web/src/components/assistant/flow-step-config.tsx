"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  ApiRequestAuthType,
  FlowAction,
  FlowActionSettings,
  FlowButtonIcon as FlowButtonIconName,
  FlowButtonType,
  FlowCondition,
  FlowConditionExample,
  FlowConditionLogic,
  FlowTrigger,
  FlowUrlOperator,
  KeyValuePair,
  NotificationButton,
  NotificationDeliveryRule,
  HttpFlowMethod,
  HttpFlowRun,
} from "@agent-hub/core";
import {
  DEFAULT_HTTP_FLOW_METHODS,
  HTTP_FLOW_METHODS,
  DEFAULT_WEBHOOK_TIMEOUT_MINUTES,
  DEFAULT_WEBHOOK_WAITING_MESSAGE,
  MAX_WEBHOOK_TIMEOUT_MINUTES,
  MIN_WEBHOOK_TIMEOUT_MINUTES,
  WEBHOOK_CALLBACK_TOKEN,
  httpWebhookSettingsIssue,
  respondSettingsIssue,
} from "@agent-hub/core";

import {
  Braces,
  ChevronDown,
  AlertCircle,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Info,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { testApiRequestAction } from "@/app/actions";
import { httpFlowRunsAction } from "@/app/(admin)/assistants/[id]/flows/flows-agent-actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FLOW_TRIGGER_LABELS } from "@/lib/flow-actions";
import { CANVAS_TRIGGERS } from "@/lib/flow-canvas";
import {
  FLOW_CONDITION_KINDS,
  FLOW_URL_OPERATORS,
  flowConditionIssue,
  flowConditionPicker,
  newFlowCondition,
  timezoneOptions,
  urlOperatorHint,
} from "@/lib/flow-conditions";
import type { FlowDwell } from "@/lib/flow-editor";
import { TEMPLATE_VARIABLES } from "@agent-hub/agent/client";
import type { ApiRequestTestResult } from "@agent-hub/agent/client";
import { cn } from "@/lib/utils";
import {
  FlowButtonIcon,
  FLOW_BUTTON_ICON_OPTIONS,
} from "@/components/chat/flow-button-icon";
import { ConnectorConfig } from "@/components/assistant/flow-connector-config";
import { HumanReviewConfig } from "@/components/assistant/flow-human-review-config";
import type { ConnectorConnectionOption } from "@/lib/connector-options";

/**
 * The Flow Builder's three steps as configuration components, hosted by both
 * of its renderings (spec #836, #837): the form's step cards and the Flow
 * Canvas's node panel. One implementation of every field, so the two views
 * cannot drift; the draft they edit and the rules that judge it live in
 * `src/lib/flow-editor.ts`.
 */

export interface AssistantOption {
  id: string;
  title: string;
}

export interface HelpDeskOption {
  id: string;
  name: string;
}

export interface FaqOption {
  id: string;
  question: string;
}



const NOTIFICATION_TITLE_LIMIT = 100;
const NOTIFICATION_CONTENT_LIMIT = 5000;

/** Order matters: the safe default comes first. */
const DELIVERY_RULE_LABELS: Record<NotificationDeliveryRule, string> = {
  session: "Once per conversation",
  visitor: "Once per user",
  always: "Every time it fires",
};

const NOTE_LIMIT = 1000;
const BUTTON_TEMPLATE_FIELDS = [
  { value: "{{user.name}}", label: "Name" },
  { value: "{{user.email}}", label: "Email" },
  { value: "{{user.id}}", label: "ID" },
];

export function localId(): string {
  return crypto.randomUUID();
}

/**
 * Strip a leading http(s):// so the Iframe "Link" field shows a bare host next
 * to the fixed `https://` prefix. The runtime re-adds the protocol when
 * rendering, so storing the bare form keeps the input and prefix in sync.
 */
function stripHttps(value: string): string {
  return value.replace(/^https?:\/\//i, "");
}

/** Compact collapsible section using the app's neutral visual language. */
function ExampleRow({
  example,
  onChange,
  onRemove,
}: {
  example: FlowConditionExample;
  onChange: (patch: Partial<FlowConditionExample>) => void;
  onRemove: () => void;
}) {
  const PolarityIcon = example.shouldTrigger ? CirclePlus : CircleMinus;
  const polarityIconClass = example.shouldTrigger
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2">
          <span
            className={`flex size-6 shrink-0 items-center justify-center ${polarityIconClass}`}
          >
            <PolarityIcon className="size-4" />
          </span>
          <input
            value={example.message}
            onChange={(e) => onChange({ message: e.target.value })}
            placeholder="User message..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <Hint label="Remove example">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove example"
            onClick={onRemove}
          >
            <AnimatedIcon icon={Trash2} size={16} />
          </Button>
        </Hint>
      </div>
      <Textarea
        value={example.note}
        onChange={(e) =>
          onChange({ note: e.target.value.slice(0, NOTE_LIMIT) })
        }
        placeholder={
          example.shouldTrigger
            ? "Explain why this message should trigger the flow"
            : "Explain why this message should not trigger the flow"
        }
        rows={2}
        className="min-h-16 resize-none bg-background text-sm"
      />
      <p className="text-muted-foreground text-right text-xs">
        {example.note.length}/{NOTE_LIMIT}
      </p>
    </div>
  );
}

function ExampleGroup({
  shouldTrigger,
  examples,
  onChange,
}: {
  shouldTrigger: boolean;
  examples: FlowConditionExample[];
  onChange: (next: FlowConditionExample[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Examples live in one array on the condition; this group edits its slice.
  const indices = examples
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.shouldTrigger === shouldTrigger);

  // Collapsed by default: a tuned condition carries a dozen examples with a
  // note each, and left open they bury the rest of the Conditions step with no
  // way to shrink them. The row states the count so it is still legible shut.
  //
  // `open` is React state rather than a `group-open:` variant on the chevron:
  // that variant does not resolve under this Tailwind setup (the step cards
  // above have the same dead class), and a disclosure whose arrow never turns
  // reads as broken.
  return (
    <details
      className="rounded-lg border"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 select-none [&::-webkit-details-marker]:hidden">
        <Badge
          className={`shrink-0 rounded-full border ${
            shouldTrigger
              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "border-red-400/50 bg-red-500/15 text-red-700 dark:text-red-300"
          }`}
        >
          {shouldTrigger ? (
            <CirclePlus className="size-3" />
          ) : (
            <CircleMinus className="size-3" />
          )}
          {shouldTrigger ? "Matching example" : "Non-matching example"}
        </Badge>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
          {indices.length === 0
            ? "No examples added"
            : `${indices.length} example${indices.length === 1 ? "" : "s"} added`}
        </span>
        {/* Swap the glyph rather than rotate one. `rotate-90` compiles to an
            unset custom property in this build (it resolves to 0deg, as the step
            cards' own `rotate-180` chevrons do) and even an explicit inline
            transform is overridden on these SVGs, so the arrow would never
            turn. Two icons cannot silently stop working. */}
        {open ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}
      </summary>
      <div className="space-y-2.5 border-t p-3">
        {indices.map(({ e, i }) => (
          <ExampleRow
            key={i}
            example={e}
            onChange={(patch) =>
              onChange(examples.map((ex, j) => (j === i ? { ...ex, ...patch } : ex)))
            }
            onRemove={() => onChange(examples.filter((_, j) => j !== i))}
          />
        ))}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              onChange([...examples, { message: "", note: "", shouldTrigger }])
            }
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            Add example <Plus className="size-4" />
          </button>
        </div>
      </div>
    </details>
  );
}

/**
 * One condition, rendered per kind: `conversation_context` keeps its
 * description + examples, while the objective kinds (URL, Schedule) get the
 * fields the runtime gate reads. Validation copy comes from
 * `flowConditionIssue` so the editor and the gate share one completeness rule.
 */
function ConditionCard({
  condition,
  onChange,
  onRemove,
}: {
  condition: FlowCondition;
  onChange: (next: FlowCondition) => void;
  onRemove: () => void;
}) {
  const issue = flowConditionIssue(condition);
  const label =
    FLOW_CONDITION_KINDS.find((meta) => meta.kind === condition.kind)?.label ??
    "Condition";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Hint label="Remove condition">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove condition"
            onClick={onRemove}
          >
            <AnimatedIcon icon={Trash2} size={16} />
          </Button>
        </Hint>
      </div>

      {condition.kind === "conversation_context" && (
        <>
          <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2">
            <span className="text-muted-foreground border-r pr-2 text-xs font-medium">
              User
            </span>
            <input
              value={condition.description}
              onChange={(e) =>
                onChange({ ...condition, description: e.target.value })
              }
              placeholder="Describe the conversation context, e.g. A customer is asking the assistant to create content for them"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <p className="text-muted-foreground text-xs">
            Add example messages to improve trigger accuracy.
          </p>

          {/* Stacked, not side by side: collapsed each group is a single row,
              so two columns would only halve the width of the count line. */}
          <div className="space-y-2">
            <ExampleGroup
              shouldTrigger
              examples={condition.examples}
              onChange={(examples) => onChange({ ...condition, examples })}
            />
            <ExampleGroup
              shouldTrigger={false}
              examples={condition.examples}
              onChange={(examples) => onChange({ ...condition, examples })}
            />
          </div>
        </>
      )}

      {condition.kind === "url" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={condition.operator}
              onValueChange={(value) =>
                onChange({ ...condition, operator: value as FlowUrlOperator })
              }
            >
              <SelectTrigger className="h-9 w-32" aria-label="URL operator">
                {/* The label, not the stored value: "Matches" is the operator's
                    name in the UI, and Base UI's Value renders the raw value. */}
                {FLOW_URL_OPERATORS.find(
                  (operator) => operator.value === condition.operator
                )?.label ?? condition.operator}
              </SelectTrigger>
              <SelectContent>
                {FLOW_URL_OPERATORS.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={condition.value}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder={
                condition.operator === "regex"
                  ? ".*/courses/.*"
                  : condition.operator === "contains"
                    ? "/courses"
                    : "https://site.com/courses"
              }
              aria-label="URL"
              aria-invalid={issue !== null}
              className="h-9 min-w-0 flex-1"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {urlOperatorHint(condition.operator)}
          </p>
          {issue && <p className="text-destructive text-xs">{issue}</p>}
        </div>
      )}

      {condition.kind === "schedule" && (
        <div className="space-y-3">
          <ScheduleBound
            label="Start date & time"
            required
            date={condition.startAt}
            timezone={condition.timezone}
            onDateChange={(startAt) => onChange({ ...condition, startAt })}
            onTimezoneChange={(timezone) => onChange({ ...condition, timezone })}
          />
          <ScheduleBound
            label="End date & time"
            date={condition.endAt ?? ""}
            timezone={condition.timezone}
            onDateChange={(endAt) => onChange({ ...condition, endAt })}
            onTimezoneChange={(timezone) => onChange({ ...condition, timezone })}
          />
          {issue && <p className="text-destructive text-xs">{issue}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * One bound of a Schedule condition: a native date input, "at", a native time
 * input, and the zone. Native inputs give the locale `dd/mm/yyyy` presentation
 * and keyboard entry for free. Both bounds write the same `timezone` field, the
 * select is rendered twice for reference parity, so a window can never straddle
 * two zones.
 */
function ScheduleBound({
  label,
  required = false,
  date,
  timezone,
  onDateChange,
  onTimezoneChange,
}: {
  label: string;
  required?: boolean;
  /** Wall-clock `YYYY-MM-DDTHH:mm`, or "". */
  date: string;
  timezone: string;
  onDateChange: (next: string) => void;
  onTimezoneChange: (next: string) => void;
}) {
  const [day, time] = date.includes("T") ? date.split("T") : [date, ""];
  const zones = useMemo(() => timezoneOptions(), []);
  const compose = (nextDay: string, nextTime: string) =>
    nextDay ? `${nextDay}T${nextTime || "00:00"}` : "";

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={day}
          onChange={(e) => onDateChange(compose(e.target.value, time))}
          aria-label={`${label} date`}
          className="h-9 w-40"
        />
        <span className="text-muted-foreground text-sm">at</span>
        <Input
          type="time"
          value={time}
          onChange={(e) => onDateChange(compose(day, e.target.value))}
          aria-label={`${label} time`}
          className="h-9 w-28"
        />
        <Select
          value={timezone}
          onValueChange={(value) => value && onTimezoneChange(value)}
        >
          <SelectTrigger className="h-9 w-56" aria-label={`${label} timezone`}>
            {zones.find((zone) => zone.value === timezone)?.label ?? timezone}
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone.value} value={zone.value}>
                {zone.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

const MAX_MANUAL_FOLLOW_UPS = 3;

function FollowUpManualConfig({
  questions,
  onChange,
}: {
  questions: string[];
  onChange: (questions: string[]) => void;
}) {
  // Always render at least one input row so the empty state is editable.
  const rows = questions.length > 0 ? questions : [""];

  const update = (index: number, value: string) => {
    const next = rows.map((q, i) => (i === index ? value : q));
    onChange(next);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
  };
  const add = () => onChange([...rows, ""]);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <Label>Follow-up questions</Label>
      {rows.map((question, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={question}
            onChange={(event) => update(index, event.target.value)}
            placeholder={`Follow-up question ${index + 1}`}
            className="bg-background"
          />
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => remove(index)}
            >
              <AnimatedIcon icon={Trash2} size={16} />
            </Button>
          )}
        </div>
      ))}
      {rows.length < MAX_MANUAL_FOLLOW_UPS && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-4" />
          Add question
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        These exact questions are shown as follow-up suggestions (up to{" "}
        {MAX_MANUAL_FOLLOW_UPS}).
      </p>
    </div>
  );
}

const SEARCH_KNOWLEDGE_FIELD_MAX = 10000;

function SearchKnowledgeAdvanced({
  settings,
  onChange,
}: {
  settings: FlowActionSettings["search_knowledge"];
  onChange: (
    patch: Partial<NonNullable<FlowActionSettings["search_knowledge"]>>
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const searchGuidelines = settings?.searchGuidelines ?? "";
  const answeringStyle = settings?.answeringStyle ?? "";
  const override = settings?.overrideAnsweringStyle ?? false;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-primary flex items-center gap-1.5 text-sm font-semibold"
      >
        <ChevronDown
          className={cn(
            "size-4 transition-transform",
            open ? "" : "-rotate-90"
          )}
        />
        Advanced settings
      </button>

      {open && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Search guidelines</Label>
            <Textarea
              value={searchGuidelines}
              maxLength={SEARCH_KNOWLEDGE_FIELD_MAX}
              onChange={(e) =>
                onChange({ searchGuidelines: e.target.value })
              }
              placeholder={
                'Example: "When searching about X, also include a search about Y." or: "Tailor results for {{user}} enrolled in {{course}}."'
              }
              rows={5}
              className="bg-background"
            />
            <p className="text-muted-foreground text-right text-xs">
              {searchGuidelines.length}/{SEARCH_KNOWLEDGE_FIELD_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Answering style</Label>
            <Textarea
              value={answeringStyle}
              maxLength={SEARCH_KNOWLEDGE_FIELD_MAX}
              onChange={(e) => onChange({ answeringStyle: e.target.value })}
              placeholder={
                'Example: "Always answer only in English or Spanish. Use British English spelling and vocabulary. Address the user as {{user}} and keep answers brief and polite."'
              }
              rows={5}
              className="bg-background"
            />
            <p className="text-muted-foreground text-right text-xs">
              {answeringStyle.length}/{SEARCH_KNOWLEDGE_FIELD_MAX}
            </p>
          </div>

          <label className="flex items-start gap-2.5">
            <Checkbox
              checked={override}
              onCheckedChange={(checked) =>
                onChange({ overrideAnsweringStyle: checked === true })
              }
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Override answering style</span>
              <span className="text-muted-foreground block text-xs">
                If unchecked, your instructions will be added to the global
                instructions.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

const API_REQUEST_AUTH_LABELS: Record<ApiRequestAuthType, string> = {
  none: "No authentication",
  bearer: "Bearer token",
  api_key: "API key header",
  basic: "Basic auth",
};

type ApiRequestSettings = NonNullable<FlowActionSettings["api_request"]>;

/** How an HTTP step names its endpoint (#837). */
const ENDPOINT_LABELS = {
  url: "A URL",
  swagger: "An operation in a Swagger/OpenAPI definition",
} as const;

/** Searchable list of template variables; clicking one inserts its token. */
function VariablePicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = TEMPLATE_VARIABLES.filter(
    (v) =>
      v.token.toLowerCase().includes(query.toLowerCase()) ||
      v.description.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Insert template variable">
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Insert template variable"
            />
          }
        >
          <Braces className="size-4" />
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-80 p-2" align="end">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search variables"
          className="mb-2"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {matches.map((v) => (
            <button
              key={v.token}
              type="button"
              className="hover:bg-muted flex w-full flex-col rounded-md px-2 py-1.5 text-left"
              onClick={() => {
                onInsert(v.token);
                setOpen(false);
                setQuery("");
              }}
            >
              <code className="text-primary text-xs">{v.token}</code>
              <span className="text-muted-foreground text-xs">{v.description}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">No matches</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Single-line input with a `{}` variable picker that inserts at the caret. */
function FieldWithPicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    onChange(value.slice(0, at) + token + value.slice(at));
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-background"
      />
      <VariablePicker onInsert={insert} />
    </div>
  );
}

/** The "Using template variables" docs modal (industry-neutral copy). */
function TemplateVariablesDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-primary text-sm font-medium hover:underline"
          />
        }
      >
        Learn more about template variables
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Using template variables</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Insert template variables into any field below. They are replaced with
          the matching value when the request is sent.
        </p>
        <ul className="space-y-1 text-sm">
          {TEMPLATE_VARIABLES.map((v) => (
            <li key={v.token} className="flex flex-col">
              <code className="text-primary text-xs">{v.token}</code>
              <span className="text-muted-foreground text-xs">{v.description}</span>
            </li>
          ))}
        </ul>
        <div className="border-warning/40 bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-md border p-2 text-xs">
          <Info className="size-4 shrink-0" />
          This is an experimental feature.
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Example</Label>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
{`{
  "message": "Hi {{user.name}}.",
  "email": "{{user.email}}"
}`}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Add/remove name–value row editor for headers and query parameters. */
function KeyValueRows({
  label,
  addLabel,
  rows,
  onChange,
}: {
  label: string;
  addLabel: string;
  rows: KeyValuePair[];
  onChange: (rows: KeyValuePair[]) => void;
}) {
  const update = (id: string, patch: Partial<KeyValuePair>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {rows.map((row) => (
        <div key={row.id} className="flex items-start gap-2">
          <Input
            value={row.name}
            onChange={(e) => update(row.id, { name: e.target.value })}
            placeholder="Name"
            className="bg-background"
          />
          <div className="flex-1">
            <FieldWithPicker
              value={row.value}
              onChange={(value) => update(row.id, { value })}
              placeholder="Value"
            />
          </div>
          <Hint label="Remove row">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove row"
              className="text-muted-foreground shrink-0"
              onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            >
              <AnimatedIcon icon={Trash2} size={16} />
            </Button>
          </Hint>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rows, { id: crypto.randomUUID(), name: "", value: "" }])
        }
      >
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  );
}

/** Add/remove rows binding a JSON path to a template-variable name. */
function JsonPathRows({
  rows,
  onChange,
}: {
  rows: NonNullable<ApiRequestSettings["jsonPaths"]>;
  onChange: (rows: NonNullable<ApiRequestSettings["jsonPaths"]>) => void;
}) {
  const update = (
    id: string,
    patch: Partial<NonNullable<ApiRequestSettings["jsonPaths"]>[number]>
  ) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <Label>Response mapping (optional)</Label>
      <p className="text-muted-foreground text-xs">
        Extract values from the JSON response into variables later actions can
        use. Leave the path blank to bind the whole response.
      </p>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            value={row.path}
            onChange={(e) => update(row.id, { path: e.target.value })}
            placeholder="$.data.user.name"
            className="bg-background font-mono text-xs"
          />
          <Input
            value={row.variable}
            onChange={(e) => update(row.id, { variable: e.target.value })}
            placeholder="userName"
            className="bg-background"
          />
          <Hint label="Remove mapping">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove mapping"
              className="text-muted-foreground shrink-0"
              onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            >
              <AnimatedIcon icon={Trash2} size={16} />
            </Button>
          </Hint>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rows, { id: crypto.randomUUID(), path: "", variable: "" }])
        }
      >
        <Plus className="size-4" />
        Add mapping
      </Button>
    </div>
  );
}

export function TestRequestControl({ settings }: { settings: ApiRequestSettings }) {
  const [pending, startTest] = useTransition();
  const [result, setResult] = useState<ApiRequestTestResult | null>(null);
  const run = () =>
    startTest(async () => {
      try {
        setResult(await testApiRequestAction(settings));
      } catch {
        setResult({
          ok: false,
          status: null,
          excerpt: null,
          extracted: [],
          parseFailed: false,
          error: { code: "network", message: "The test could not be run." },
        });
      }
    });
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !settings.url?.trim()}
        onClick={run}
      >
        {pending ? "Testing…" : "Test request"}
      </Button>
      {result && (
        <div className="bg-muted/30 space-y-2 rounded-lg border p-3 text-xs">
          <p className="text-muted-foreground">
            Sent with sample values (shown as <code>«variable»</code>).
          </p>
          {result.error ? (
            <p className="text-destructive">
              {result.error.message} <span className="opacity-60">({result.error.code})</span>
            </p>
          ) : (
            <p>
              Response status: <span className="font-mono">{result.status}</span>{" "}
              {result.ok ? "✓" : "✗"}
            </p>
          )}
          {result.parseFailed && (
            <p className="text-muted-foreground">Response was not valid JSON.</p>
          )}
          {result.extracted.length > 0 && (
            <div className="space-y-0.5">
              {result.extracted.map((e) => (
                <div key={e.variable} className="font-mono">
                  {e.variable} = {e.missed ? <span className="opacity-60">(no value)</span> : JSON.stringify(e.value)}
                </div>
              ))}
            </div>
          )}
          {result.excerpt && (
            <pre className="bg-background max-h-40 overflow-auto rounded-md p-2">
              {result.excerpt}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}


type HttpWebhookSettingsShape = NonNullable<FlowActionSettings["http_webhook"]>;
type WebhookCallShape = NonNullable<HttpWebhookSettingsShape["subscribe"]>;

/**
 * Method + URI + body, the shape both halves of the gate share, plus the same
 * credential and header slots as API request: a secret typed into the URI
 * would travel into the Publication snapshot and the transcript card in clear,
 * and these two fields are the ones `redactFlowSecrets` knows to blank.
 */
function WebhookCallFields({
  call,
  onChange,
  urlPlaceholder,
  withBody,
  withReplyPaths,
  defaultMethod,
}: {
  call: WebhookCallShape | undefined;
  onChange: (patch: Partial<WebhookCallShape>) => void;
  urlPlaceholder: string;
  withBody: boolean;
  /** Offer JSON paths over this call's own reply (the subscribe call). */
  withReplyPaths?: boolean;
  defaultMethod: WebhookCallShape["method"];
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label>Method</Label>
          <Select
            value={call?.method ?? defaultMethod}
            onValueChange={(value) =>
              onChange({ method: value as WebhookCallShape["method"] })
            }
          >
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_FLOW_METHODS.map((method) => (
                <SelectItem key={method} value={method}>
                  {method}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>URI</Label>
          <FieldWithPicker
            value={call?.url ?? ""}
            onChange={(url) => onChange({ url })}
            placeholder={urlPlaceholder}
          />
        </div>
      </div>
      {withBody && (
        <div className="space-y-1.5">
          <Label>Body</Label>
          <Textarea
            value={call?.bodyTemplate ?? ""}
            onChange={(e) => onChange({ bodyTemplate: e.target.value })}
            placeholder={CALLBACK_BODY_PLACEHOLDER}
            rows={4}
            className="bg-background font-mono text-xs"
          />
        </div>
      )}
      <ApiAuthFields auth={call?.auth} onChange={(auth) => onChange({ auth })} />
      <KeyValueRows
        label="Headers (optional)"
        addLabel="Add header"
        rows={call?.headers ?? []}
        onChange={(headers) => onChange({ headers })}
      />
      {withReplyPaths && (
        <div className="space-y-1.5">
          <JsonPathRows
            rows={call?.jsonPaths ?? []}
            onChange={(jsonPaths) => onChange({ jsonPaths })}
          />
          <p className="text-muted-foreground text-xs">
            Values from this call&rsquo;s reply, for the unsubscribe call: map{" "}
            <code className="text-xs">$.id</code> to <code className="text-xs">subscriptionId</code>{" "}
            and write <code className="text-xs">{"{{subscriptionId}}"}</code> in the unsubscribe URI.
            The whole reply is <code className="text-xs">{"{{webhook.subscribeBody}}"}</code>.
          </p>
        </div>
      )}
    </div>
  );
}

const CALLBACK_BODY_PLACEHOLDER = `{"callbackUrl": "${WEBHOOK_CALLBACK_TOKEN}"}`;

/**
 * The authentication editor `api_request` and both webhook calls share. The
 * stored secret is never shown back: a saved value renders as a placeholder
 * and typing replaces it (`redactFlowSecrets` / `mergeFlowSecrets`).
 */
function ApiAuthFields({
  auth: configured,
  onChange,
}: {
  auth: ApiRequestSettings["auth"];
  onChange: (auth: ApiRequestSettings["auth"]) => void;
}) {
  const auth = configured ?? { type: "none" };
  const setAuthType = (type: ApiRequestAuthType) =>
    onChange({ type } as ApiRequestSettings["auth"]);
  return (
    <div className="space-y-1.5">
      <Label>Authentication</Label>
      <Select value={auth.type} onValueChange={(v) => setAuthType(v as ApiRequestAuthType)}>
        <SelectTrigger className="bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(API_REQUEST_AUTH_LABELS) as ApiRequestAuthType[]).map((type) => (
            <SelectItem key={type} value={type}>
              {API_REQUEST_AUTH_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {auth.type === "bearer" && (
        <Input
          type="password"
          value={auth.token ?? ""}
          onChange={(e) => onChange({ type: "bearer", token: e.target.value })}
          placeholder={auth.hasToken ? "Saved: type to replace" : "Token"}
          className="bg-background"
          autoComplete="off"
        />
      )}
      {auth.type === "api_key" && (
        <div className="flex gap-2">
          <Input
            value={auth.header ?? ""}
            onChange={(e) => onChange({ type: "api_key", header: e.target.value, key: auth.key })}
            placeholder="Header name (e.g. X-API-Key)"
            className="bg-background"
          />
          <Input
            type="password"
            value={auth.key ?? ""}
            onChange={(e) => onChange({ type: "api_key", header: auth.header, key: e.target.value })}
            placeholder={auth.hasKey ? "Saved: type to replace" : "Key"}
            className="bg-background"
            autoComplete="off"
          />
        </div>
      )}
      {auth.type === "basic" && (
        <div className="flex gap-2">
          <Input
            value={auth.username ?? ""}
            onChange={(e) =>
              onChange({ type: "basic", username: e.target.value, password: auth.password })
            }
            placeholder="Username"
            className="bg-background"
          />
          <Input
            type="password"
            value={auth.password ?? ""}
            onChange={(e) =>
              onChange({ type: "basic", username: auth.username, password: e.target.value })
            }
            placeholder={auth.hasPassword ? "Saved: type to replace" : "Password"}
            className="bg-background"
            autoComplete="off"
          />
        </div>
      )}
    </div>
  );
}

/**
 * The callback gate (#842). Two calls and a wait between them.
 *
 * The callback URL is the whole point of the subscribe call, so the token is
 * put in front of the Editor rather than explained afterwards: the other system
 * has to be told where to answer, and there is exactly one way to tell it.
 */
function HttpWebhookConfig({
  settings,
  onChange,
}: {
  settings: FlowActionSettings["http_webhook"];
  onChange: (patch: Partial<HttpWebhookSettingsShape>) => void;
}) {
  const issue = httpWebhookSettingsIssue(settings);
  return (
    <div className="space-y-5">
      <div className="bg-muted/30 space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Lightbulb className="text-primary size-4 shrink-0" />
          <span>
            Put <code className="text-xs">{WEBHOOK_CALLBACK_TOKEN}</code> in the subscribe
            URI or body. Ciele replaces it with a signed address for this conversation,
            valid until the wait runs out.
          </span>
        </div>
        <TemplateVariablesDialog />
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="text-sm font-semibold">Subscribe</h4>
        <WebhookCallFields
          call={settings?.subscribe}
          onChange={(patch) => onChange({ subscribe: { ...settings?.subscribe, ...patch } })}
          urlPlaceholder="https://api.example.com/subscriptions"
          withBody
          withReplyPaths
          defaultMethod="POST"
        />
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <h4 className="text-sm font-semibold">Unsubscribe</h4>
        <p className="text-muted-foreground text-xs">
          Sent when the wait ends, however it ends. Optional, but without it the other
          system keeps calling an address that no longer leads anywhere.
        </p>
        <WebhookCallFields
          call={settings?.unsubscribe}
          onChange={(patch) =>
            onChange({ unsubscribe: { ...settings?.unsubscribe, ...patch } })
          }
          urlPlaceholder="https://api.example.com/subscriptions/{{subscriptionId}}"
          withBody={false}
          defaultMethod="DELETE"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Wait for (minutes)</Label>
        <Input
          type="number"
          min={MIN_WEBHOOK_TIMEOUT_MINUTES}
          max={MAX_WEBHOOK_TIMEOUT_MINUTES}
          value={settings?.timeoutMinutes ?? DEFAULT_WEBHOOK_TIMEOUT_MINUTES}
          onChange={(e) => onChange({ timeoutMinutes: Number(e.target.value) })}
          className="bg-background w-32"
        />
      </div>

      <div className="space-y-1.5">
        <Label>While waiting</Label>
        <Input
          value={settings?.waitingMessage ?? ""}
          onChange={(e) => onChange({ waitingMessage: e.target.value })}
          placeholder={DEFAULT_WEBHOOK_WAITING_MESSAGE}
          className="bg-background"
        />
      </div>
      <div className="space-y-1.5">
        <Label>If nothing arrives</Label>
        <Input
          value={settings?.haltMessage ?? ""}
          onChange={(e) => onChange({ haltMessage: e.target.value })}
          placeholder="I didn&rsquo;t hear back in time, so I&rsquo;ve stopped waiting."
          className="bg-background"
        />
      </div>

      <JsonPathRows
        rows={settings?.jsonPaths ?? []}
        onChange={(jsonPaths) => onChange({ jsonPaths })}
      />

      {issue && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <AlertCircle className="size-3.5 shrink-0" /> {issue}
        </p>
      )}
    </div>
  );
}

/** The answer to an inbound HTTP request (#843). */
function RespondConfig({
  settings,
  onChange,
}: {
  settings: FlowActionSettings["respond"];
  onChange: (patch: Partial<NonNullable<FlowActionSettings["respond"]>>) => void;
}) {
  const issue = respondSettingsIssue(settings);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Send a response to the HTTP request that started this flow. Nothing after this
        step runs: what the caller was told cannot be changed afterwards.
      </p>
      <div className="space-y-1.5">
        <Label>
          Status code <span className="text-destructive">*</span>
        </Label>
        <Input
          type="number"
          min={200}
          max={599}
          value={settings?.status ?? ""}
          placeholder="200"
          onChange={(e) =>
            onChange({ status: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="bg-background w-32"
        />
        <p className="text-muted-foreground text-xs">
          Required, 200 to 599. Without one the step is not configured and a call answers 500.
        </p>
      </div>
      <KeyValueRows
        label="Headers (optional)"
        addLabel="Add header"
        rows={settings?.headers ?? []}
        onChange={(headers) => onChange({ headers })}
      />
      <div className="space-y-1.5">
        <Label>Body (optional)</Label>
        <Textarea
          value={settings?.bodyTemplate ?? ""}
          onChange={(e) => onChange({ bodyTemplate: e.target.value })}
          placeholder={RESPONSE_BODY_PLACEHOLDER}
          rows={5}
          className="bg-background font-mono text-xs"
        />
      </div>
      {issue && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <AlertCircle className="size-3.5 shrink-0" /> {issue}
        </p>
      )}
    </div>
  );
}

const RESPONSE_BODY_PLACEHOLDER = '{"status": "{{state}}"}';

function ApiRequestConfig({
  settings,
  onChange,
}: {
  settings: FlowActionSettings["api_request"];
  onChange: (patch: Partial<ApiRequestSettings>) => void;
}) {
  const endpoint = settings?.endpoint ?? "url";
  const method = settings?.method ?? "POST";
  // A Swagger operation's method is not known until the definition is read, so
  // the body stays offered: hiding it on a guess would hide the one field a
  // POST operation needs.
  const isBodyless = endpoint === "url" && method === "GET";
  return (
    <div className="space-y-4">
      <div className="bg-muted/30 space-y-1 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Lightbulb className="text-primary size-4 shrink-0" />
          <span>
            Template variables (e.g. <code className="text-xs">{"{{user.name}}"}</code>)
            can be used in the fields below.
          </span>
        </div>
        <TemplateVariablesDialog />
      </div>

      <div className="space-y-1.5">
        <Label>Endpoint</Label>
        <Select
          value={endpoint}
          onValueChange={(value) =>
            onChange({ endpoint: value as ApiRequestSettings["endpoint"] })
          }
        >
          <SelectTrigger className="bg-background">
            {/* Explicit children: the primitive otherwise shows the stored
                value, and "url" is not what the row above it says. */}
            <SelectValue>{ENDPOINT_LABELS[endpoint]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ENDPOINT_LABELS) as (keyof typeof ENDPOINT_LABELS)[]).map(
              (option) => (
                <SelectItem key={option} value={option}>
                  {ENDPOINT_LABELS[option]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Two ways to say the same thing: a method and a path typed here, or an
          operation the organization's own definition already names. The second
          is not a shortcut for the first, it is the definition staying the
          authority, so the step keeps working when the API moves. */}
      {endpoint === "swagger" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Swagger URL</Label>
            <Input
              value={settings?.swaggerUrl ?? ""}
              onChange={(e) => onChange({ swaggerUrl: e.target.value })}
              placeholder="https://api.example.com/openapi.json"
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Operation ID</Label>
            <Input
              value={settings?.operationId ?? ""}
              onChange={(e) => onChange({ operationId: e.target.value })}
              placeholder="createRefund"
              className="bg-background"
            />
            <p className="text-muted-foreground text-xs">
              The method and the URL come from the definition. A path parameter such as{" "}
              <code className="text-xs">{"{refundId}"}</code> becomes the template variable{" "}
              <code className="text-xs">{"{{refundId}}"}</code>, so an earlier step can fill it.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select
              value={settings?.method ?? "POST"}
              onValueChange={(value) =>
                onChange({ method: value as ApiRequestSettings["method"] })
              }
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_FLOW_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Endpoint URL</Label>
            <Input
              value={settings?.url ?? ""}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://api.example.com/..."
              className="bg-background"
            />
          </div>
        </div>
      )}

      <ApiAuthFields auth={settings?.auth} onChange={(auth) => onChange({ auth })} />

      <KeyValueRows
        label="Headers (optional)"
        addLabel="Add header"
        rows={settings?.headers ?? []}
        onChange={(headers) => onChange({ headers })}
      />
      <KeyValueRows
        label="Query parameters (optional)"
        addLabel="Add query parameter"
        rows={settings?.queryParams ?? []}
        onChange={(queryParams) => onChange({ queryParams })}
      />

      <JsonPathRows
        rows={settings?.jsonPaths ?? []}
        onChange={(jsonPaths) => onChange({ jsonPaths })}
      />

      {!isBodyless && (
        <div className="space-y-1.5">
          <Label>Request JSON body</Label>
          <Textarea
            value={settings?.bodyTemplate ?? ""}
            onChange={(e) => onChange({ bodyTemplate: e.target.value })}
            placeholder={'{\n  "message": "{{workflow.message}}"\n}'}
            className="bg-background min-h-[8rem] font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            Raw JSON. Template variables inside string values are escaped
            automatically. Leave empty to send the triggering message.
          </p>
        </div>
      )}

      {settings?.url?.trim() && <TestRequestControl settings={settings} />}
    </div>
  );
}

/**
 * Buttons attached to a Notification: a link out, or a first message put into the
 * chat. Help-desk and FAQ buttons are deliberately absent, they answer a question
 * the visitor has not asked.
 */
function NotificationButtonsConfig({
  buttons,
  onChange,
}: {
  buttons: NotificationButton[];
  onChange: (buttons: NotificationButton[]) => void;
}) {
  function patch(id: string, next: Partial<NotificationButton>) {
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...next } : b)));
  }
  return (
    <div className="space-y-2">
      <Label>Buttons</Label>
      {buttons.map((button) => {
        const type = button.type ?? "external_link";
        return (
          <div key={button.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Input
                value={button.label ?? ""}
                onChange={(e) => patch(button.id, { label: e.target.value })}
                placeholder="Button name"
                className="bg-background"
              />
              <Hint label="Remove button">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove button"
                  onClick={() =>
                    onChange(buttons.filter((b) => b.id !== button.id))
                  }
                >
                  <AnimatedIcon icon={Trash2} size={16} />
                </Button>
              </Hint>
            </div>
            <div className="flex items-center rounded-lg border p-0.5">
              {(
                [
                  { value: "external_link" as const, label: "Open a link" },
                  { value: "send_text" as const, label: "Send text into chat" },
                ]
              ).map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={type === option.value ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  aria-pressed={type === option.value}
                  onClick={() => patch(button.id, { type: option.value })}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {type === "external_link" ? (
              <Input
                value={button.url ?? ""}
                onChange={(e) => patch(button.id, { url: e.target.value })}
                placeholder="https://example.com/exam-results"
                className="bg-background"
              />
            ) : (
              <Input
                value={button.text ?? ""}
                onChange={(e) => patch(button.id, { text: e.target.value })}
                placeholder="Tell me more about the exam results"
                className="bg-background"
              />
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...buttons,
            { id: `btn-${Date.now()}-${buttons.length}`, type: "external_link" },
          ])
        }
      >
        Add button <Plus className="size-4" />
      </Button>
    </div>
  );
}

function FlowButtonConfig({
  settings,
  helpDesks,
  faqs,
  onChange,
}: {
  settings: FlowActionSettings["show_button"];
  helpDesks: HelpDeskOption[];
  faqs: FaqOption[];
  onChange: (patch: Partial<NonNullable<FlowActionSettings["show_button"]>>) => void;
}) {
  const type = settings?.type ?? "external_link";
  const showIcon = settings?.showIcon ?? false;
  const icon =
    settings?.icon === "external_link"
      ? "message"
      : settings?.icon === "headphones"
        ? "headset"
        : (settings?.icon ??
          (type === "help_desk" ? "headset" : "message"));
  const label =
    settings?.label?.trim() ||
    (type === "help_desk"
      ? "Contact support"
      : type === "send_text"
        ? "Send message"
        : type === "faq"
          ? settings?.faqQuestion || "Ask FAQ"
          : "Open link");
  const patch = (
    next: Partial<NonNullable<FlowActionSettings["show_button"]>>
  ) => onChange({ ...next, type });

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <Label>Button name</Label>
        <Input
          value={settings?.label ?? ""}
          onChange={(event) => patch({ label: event.target.value })}
          placeholder={label}
          className="bg-background"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Button type</Label>
        <Select
          value={type}
          onValueChange={(value) =>
            onChange({ type: value as FlowButtonType })
          }
        >
          <SelectTrigger className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="external_link">External link</SelectItem>
            <SelectItem value="help_desk">Help desk</SelectItem>
            <SelectItem value="send_text">Send text to chat</SelectItem>
            <SelectItem value="faq">FAQ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type === "help_desk" ? (
        <div className="space-y-1.5">
          <Label>Select a help desk</Label>
          <Select
            value={settings?.helpDeskId ?? ""}
            onValueChange={(helpDeskId) =>
              patch({ helpDeskId: helpDeskId ?? undefined })
            }
          >
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select a help desk" />
            </SelectTrigger>
            <SelectContent>
              {helpDesks.map((helpDesk) => (
                <SelectItem key={helpDesk.id} value={helpDesk.id}>
                  {helpDesk.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {helpDesks.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Create a help desk before selecting this button type.
            </p>
          )}
        </div>
      ) : type === "send_text" ? (
        <div className="space-y-1.5">
          <Label>Text sent to chat</Label>
          <div className="flex gap-2">
            <Input
              value={settings?.text ?? ""}
              onChange={(event) => patch({ text: event.target.value })}
              placeholder="Enter text"
              className="bg-background"
            />
            <DropdownMenu>
              <Hint label="Insert user field">
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Insert user field"
                    />
                  }
                >
                  {"{}"}
                </DropdownMenuTrigger>
              </Hint>
              <DropdownMenuContent align="end">
                {BUTTON_TEMPLATE_FIELDS.map((field) => (
                  <DropdownMenuItem
                    key={field.value}
                    onClick={() =>
                      patch({ text: `${settings?.text ?? ""}${field.value}` })
                    }
                  >
                    <span className="font-mono text-xs">{field.value}</span>
                    <span className="text-muted-foreground ml-2">
                      {field.label}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : type === "faq" ? (
        <div className="space-y-1.5">
          <Label>Select an FAQ from Knowledge</Label>
          <Select
            value={settings?.faqId ?? ""}
            onValueChange={(faqId) => {
              const faq = faqs.find((item) => item.id === faqId);
              patch({
                faqId: faqId ?? undefined,
                faqQuestion: faq?.question,
              });
            }}
          >
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select an FAQ" />
            </SelectTrigger>
            <SelectContent>
              {faqs.map((faq) => (
                <SelectItem key={faq.id} value={faq.id}>
                  {faq.question}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {faqs.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Add an FAQ in Knowledge before selecting this button type.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>External link URL</Label>
          <Input
            value={settings?.url ?? ""}
            onChange={(event) =>
              onChange({ url: event.target.value, type: "external_link" })
            }
            placeholder="https://..."
            className="bg-background"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Show icon</p>
          <p className="text-muted-foreground text-xs">
            Display an icon inside the button.
          </p>
        </div>
        <Switch
          checked={showIcon}
          onCheckedChange={(next) => patch({ showIcon: next })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Select icon</Label>
        <Select
          value={icon}
          disabled={!showIcon}
          onValueChange={(value) =>
            patch({ icon: value as FlowButtonIconName })
          }
        >
          <SelectTrigger className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FLOW_BUTTON_ICON_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-semibold">Button preview</p>
        <Button type="button" variant="outline" className="pointer-events-none">
          {showIcon && <FlowButtonIcon icon={icon} className="size-4" />}
          {label}
        </Button>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------------ */
/* The three steps, as hosted by the form and by the canvas node panel.      */
/* ------------------------------------------------------------------------ */

const TRIGGER_OPTIONS: Array<{ value: FlowTrigger; label: string }> = CANVAS_TRIGGERS.map(
  (value) => ({ value, label: FLOW_TRIGGER_LABELS[value] })
);

/**
 * Every edit either rendering can make to the draft. The builder owns the
 * implementation (one undo history, one save path); the form's step cards and
 * the canvas's palette + node panel receive it and never touch the draft
 * directly.
 */
export type FlowStepHandlers = {
  chooseTrigger: (next: FlowTrigger) => void;
  removeTrigger: () => void;
  setDwell: (dwell: FlowDwell) => void;
  /** "On HTTP request": which methods the Flow's endpoint answers (#843). */
  setHttpMethods: (methods: HttpFlowMethod[]) => void;
  setConditionLogic: (logic: FlowConditionLogic) => void;
  setConditions: (conditions: FlowCondition[]) => void;
  /** Appends when `index` is omitted; inserts at a chain position otherwise. */
  addAction: (action: FlowAction, index?: number) => void;
  removeAction: (action: FlowAction) => void;
  setActions: (actions: FlowAction[]) => void;
  patchSettings: <K extends keyof FlowActionSettings>(
    key: K,
    patch: NonNullable<FlowActionSettings[K]>
  ) => void;
  setCustomMessage: (message: string) => void;
};


/**
 * The inbound-HTTP trigger's own settings (#843): which methods the endpoint
 * answers, and the endpoint itself.
 *
 * The URL is shown rather than configured, because it is not a choice: it is
 * derived from the Flow's id, and the Flow has to exist before it has one. An
 * unsaved Flow says so instead of showing a URL that will not work.
 */
function HttpTriggerConfig({
  methods,
  flowId,
  onChange,
}: {
  methods: HttpFlowMethod[];
  flowId: string | null;
  onChange: (next: HttpFlowMethod[]) => void;
}) {
  const selected = methods.length > 0 ? methods : DEFAULT_HTTP_FLOW_METHODS;
  const endpoint = flowId ? `/api/flows/${flowId}/trigger` : null;
  // The verb shown is one this Flow actually answers, not a hardcoded POST that
  // a Member could copy into a 405.
  const shownMethod = selected[0] ?? "POST";
  const toggle = (method: HttpFlowMethod) => {
    const next = selected.includes(method)
      ? selected.filter((m) => m !== method)
      : [...selected, method];
    // Never empty: an endpoint that accepts nothing is a Flow nobody can run,
    // and the runtime would read the empty list as the default anyway.
    onChange(next.length > 0 ? next : selected);
  };
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label>Endpoint</Label>
        {endpoint ? (
          <code className="bg-muted block rounded-md px-2 py-1.5 font-mono text-xs break-all">
            {shownMethod} {endpoint}
          </code>
        ) : (
          <p className="text-muted-foreground text-xs">
            Save the flow to get its endpoint.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Call it with an Organization API key as a Bearer token. The request body, query
          and headers are available as <code className="text-xs">{"{{request.body}}"}</code>
          , <code className="text-xs">{"{{request.query.name}}"}</code> and{" "}
          <code className="text-xs">{"{{request.header.name}}"}</code>.
        </p>
        <p className="text-muted-foreground text-xs">
          Add a <strong>Response</strong> step to decide what the caller reads. A flow that
          finishes without one answers <code className="text-xs">204 No Content</code>.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Methods</Label>
        <div className="flex flex-wrap gap-3">
          {HTTP_FLOW_METHODS.map((method) => (
            <label key={method} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(method)}
                onCheckedChange={() => toggle(method)}
              />
              {method}
            </label>
          ))}
        </div>
      </div>
      {flowId && <HttpFlowRunHistory flowId={flowId} />}
    </div>
  );
}

/**
 * The latest inbound runs (#843): a run is not a Conversation and never
 * reaches the Inbox, so this panel is where an operator learns whether the
 * endpoint is being called, what it answered, and which step failed.
 */
function HttpFlowRunHistory({ flowId }: { flowId: string }) {
  const [runs, setRuns] = useState<HttpFlowRun[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    httpFlowRunsAction(flowId)
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);
  return (
    <div className="space-y-1.5">
      <Label>Recent runs</Label>
      {failed ? (
        <p className="text-muted-foreground text-xs">The run history could not be loaded.</p>
      ) : runs === null ? (
        <p className="text-muted-foreground text-xs">Loading&hellip;</p>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No calls yet. Runs appear here once another system calls the endpoint of the published
          assistant.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-xs">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5">
              <span className="text-muted-foreground tabular-nums">
                {new Date(run.createdAt).toLocaleString()}
              </span>
              <span className="font-mono">{run.method}</span>
              <span
                className={
                  run.status >= 500
                    ? "text-destructive font-medium"
                    : run.status >= 400
                      ? "text-amber-600 font-medium"
                      : "font-medium"
                }
              >
                {run.status}
              </span>
              <span className="text-muted-foreground">{run.durationMs} ms</span>
              <span className="text-muted-foreground truncate">
                {run.ran.length > 0 ? run.ran.join(" → ") : "no steps ran"}
              </span>
              {run.failedAction && (
                <span className="text-destructive truncate" title={run.failedMessage ?? undefined}>
                  {run.failedAction} failed
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FlowTriggerConfig({
  isDefaultFlow,
  trigger,
  dwell,
  dwellOk,
  proactive,
  httpMethods,
  flowId,
  onChoose,
  onRemove,
  onDwellChange,
  onHttpMethodsChange,
}: {
  isDefaultFlow: boolean;
  trigger: FlowTrigger | null;
  dwell: FlowDwell;
  dwellOk: boolean;
  proactive: boolean;
  httpMethods?: HttpFlowMethod[];
  /** Null for a Flow that has not been saved, which has no endpoint yet. */
  flowId?: string | null;
  onChoose: (next: FlowTrigger) => void;
  onRemove: () => void;
  onDwellChange: (next: FlowDwell) => void;
  onHttpMethodsChange?: (next: HttpFlowMethod[]) => void;
}) {
  if (isDefaultFlow) {
    return (
      <p className="text-muted-foreground text-sm">
        The default flow runs whenever no other flow matches, it needs no
        trigger.
      </p>
    );
  }
  if (trigger === null) {
    return (
      <div>
        <p className="text-sm font-medium">What triggers the flow?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRIGGER_OPTIONS.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChoose(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <p className="text-sm font-semibold">{FLOW_TRIGGER_LABELS[trigger]}</p>
        <Hint label="Remove trigger">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove trigger"
            onClick={onRemove}
          >
            <AnimatedIcon icon={Trash2} size={16} />
          </Button>
        </Hint>
      </div>
      {trigger === "time_on_page" && (
        <div className="space-y-1.5 rounded-md border p-3">
          <Label>How long before it fires</Label>
          <div className="flex items-end gap-3">
            {(
              [
                { key: "minutes" as const, label: "Minutes", max: 120 },
                { key: "seconds" as const, label: "Seconds", max: 59 },
              ]
            ).map((field) => (
              <div key={field.key} className="space-y-1">
                <span className="text-muted-foreground text-xs">{field.label}</span>
                <Input
                  type="number"
                  min={0}
                  max={field.max}
                  value={dwell[field.key]}
                  onChange={(e) => {
                    const raw = Number.parseInt(e.target.value, 10);
                    const value = Number.isFinite(raw)
                      ? Math.min(Math.max(raw, 0), field.max)
                      : 0;
                    onDwellChange({ ...dwell, [field.key]: value });
                  }}
                  className="bg-background w-24"
                />
              </div>
            ))}
          </div>
          {!dwellOk && (
            <p className="text-destructive text-xs">
              Set at least one second, otherwise this is “On page load”.
            </p>
          )}
        </div>
      )}
      {trigger === "http_request" && (
        <HttpTriggerConfig
          methods={httpMethods ?? DEFAULT_HTTP_FLOW_METHODS}
          flowId={flowId ?? null}
          onChange={(next) => onHttpMethodsChange?.(next)}
        />
      )}
      {proactive && (
        <p className="text-muted-foreground text-sm">
          This flow starts on its own, without the user asking anything, so it
          has no conditions, and its response is a single notification.
        </p>
      )}
    </div>
  );
}

export function FlowConditionsConfig({
  isDefaultFlow,
  trigger,
  proactive,
  conditionLogic,
  conditions,
  onLogicChange,
  onConditionsChange,
}: {
  isDefaultFlow: boolean;
  trigger: FlowTrigger | null;
  proactive: boolean;
  conditionLogic: FlowConditionLogic;
  conditions: FlowCondition[];
  onLogicChange: (next: FlowConditionLogic) => void;
  onConditionsChange: (next: FlowCondition[]) => void;
}) {
  if (isDefaultFlow) {
    return (
      <p className="text-muted-foreground text-sm">The default flow has no conditions.</p>
    );
  }
  if (trigger === null) {
    return <p className="text-base">Select a trigger to see the available conditions.</p>;
  }
  if (proactive) {
    return (
      <p className="text-muted-foreground text-sm">
        A conversation-context condition needs a conversation to read, and this
        flow runs before the user has said anything, so there are no conditions
        to set.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {conditions.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <p className="text-sm font-medium">Condition logic</p>
          {/* Segmented control on a bordered track, selected half filled with
              `primary`: the one token that contrasts with the card in both
              themes (the theme maps muted/card/accent/secondary to one value). */}
          <div className="border-input flex items-center rounded-lg border p-0.5">
            {(
              [
                { value: "any", label: "Any condition matches" },
                { value: "all", label: "All conditions match" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={conditionLogic === o.value}
                onClick={() => onLogicChange(o.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  conditionLogic === o.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {conditions.map((condition) => (
        <ConditionCard
          key={condition.id}
          condition={condition}
          onChange={(next) =>
            onConditionsChange(conditions.map((c) => (c.id === next.id ? next : c)))
          }
          onRemove={() =>
            onConditionsChange(conditions.filter((c) => c.id !== condition.id))
          }
        />
      ))}

      <div className="space-y-2">
        <p className="text-sm font-medium">Add a condition</p>
        <div className="flex flex-wrap items-center gap-2">
          {flowConditionPicker(trigger).map((meta) => (
            <Button
              key={meta.kind}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onConditionsChange([...conditions, newFlowCondition(meta.kind, localId())])
              }
            >
              {meta.label} <Plus className="size-4" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The per-action fields, without the card chrome the form draws around them. */
export function FlowActionConfig({
  action,
  assistantId,
  settings,
  customMessage,
  helpDesks,
  faqs,
  assistants,
  connections,
  onPatchSettings,
  onCustomMessageChange,
}: {
  action: FlowAction;
  assistantId: string;
  settings: FlowActionSettings;
  customMessage: string;
  helpDesks: HelpDeskOption[];
  faqs: FaqOption[];
  assistants: AssistantOption[];
  /** The Organization's Application Connections a Connector may use (#839). */
  connections: ConnectorConnectionOption[];
  onPatchSettings: FlowStepHandlers["patchSettings"];
  onCustomMessageChange: (next: string) => void;
}) {
  const patchSettings = onPatchSettings;
  switch (action) {
    case "connector":
      return (
        <ConnectorConfig
          assistantId={assistantId}
          settings={settings.connector}
          connections={connections}
          onChange={(patch) => patchSettings("connector", patch)}
        />
      );
    case "human_review":
      return (
        <HumanReviewConfig
          settings={settings.human_review}
          connections={connections}
          onChange={(patch) => patchSettings("human_review", patch)}
        />
      );
    case "custom_message":
      return (
        <Textarea
          value={customMessage}
          onChange={(e) => onCustomMessageChange(e.target.value)}
          placeholder="The message the assistant sends when this flow triggers"
          rows={3}
          className="bg-background"
        />
      );
    case "basic_reply":
      return (
        <Textarea
          value={settings.basic_reply?.message ?? ""}
          onChange={(e) => patchSettings("basic_reply", { message: e.target.value })}
          placeholder="Leave empty to generate a short reply in the visitor's language, or pin the exact wording here"
          rows={2}
          className="bg-background"
        />
      );
    case "search_knowledge":
      return (
        <div className="space-y-3">
          <SettingToggle
            title="Prompt user to escalate to for unresolved queries"
            description="When the AI Assistant does not know the answer to a question, it will present the escalation 'contact support' button to the user."
            checked={settings.search_knowledge?.escalatePrompt ?? false}
            onCheckedChange={(escalatePrompt) =>
              patchSettings("search_knowledge", { escalatePrompt })
            }
          />
          <SettingToggle
            title="Create Knowledge Improvement Items for unresolved queries"
            description="When the AI Assistant does not know the answer to a question, it will automatically add new item to your knowledge improvement task list."
            checked={settings.search_knowledge?.improvementItems ?? false}
            onCheckedChange={(improvementItems) =>
              patchSettings("search_knowledge", { improvementItems })
            }
          />
          <SearchKnowledgeAdvanced
            settings={settings.search_knowledge}
            onChange={(patch) => patchSettings("search_knowledge", patch)}
          />
        </div>
      );
    case "follow_up_questions":
      return (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select
              value={settings.follow_up_questions?.mode ?? "ai_generated"}
              onValueChange={(value) =>
                patchSettings("follow_up_questions", {
                  mode: value as "ai_generated" | "manual",
                })
              }
            >
              <SelectTrigger className="bg-background">
                <SelectValue>
                  {(settings.follow_up_questions?.mode ?? "ai_generated") === "manual"
                    ? "Manual"
                    : "AI generated"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ai_generated">AI generated</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(settings.follow_up_questions?.mode ?? "ai_generated") === "ai_generated" ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              The AI will use the conversation context to generate relevant
              follow-up questions automatically.
            </p>
          ) : (
            <FollowUpManualConfig
              questions={settings.follow_up_questions?.questions ?? []}
              onChange={(questions) => patchSettings("follow_up_questions", { questions })}
            />
          )}
        </div>
      );
    case "show_button":
      return (
        <FlowButtonConfig
          settings={settings.show_button}
          helpDesks={helpDesks}
          faqs={faqs}
          onChange={(patch) => patchSettings("show_button", patch)}
        />
      );
    case "iframe":
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={settings.iframe?.title ?? ""}
              onChange={(e) => patchSettings("iframe", { title: e.target.value })}
              placeholder="Custom iframe's title"
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Link</Label>
            <div className="flex">
              <span className="text-muted-foreground border-input bg-muted inline-flex items-center rounded-l-md border border-r-0 px-3 text-sm">
                https://
              </span>
              <Input
                value={stripHttps(settings.iframe?.url ?? "")}
                onChange={(e) =>
                  patchSettings("iframe", { url: stripHttps(e.target.value) })
                }
                placeholder="example.com"
                className="bg-background rounded-l-none"
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={settings.iframe?.lightbox ?? true}
              onCheckedChange={(lightbox) => patchSettings("iframe", { lightbox })}
            />
            Option to open in lightbox if possible
          </label>
          <div className="space-y-1.5">
            <Label>Iframe height</Label>
            <div className="flex w-40">
              <Input
                type="number"
                min={1}
                value={settings.iframe?.height ?? 30}
                onChange={(e) =>
                  patchSettings("iframe", { height: Number(e.target.value) || undefined })
                }
                className="bg-background rounded-r-none"
              />
              <Select
                value={settings.iframe?.heightUnit ?? "vh"}
                onValueChange={(value) =>
                  patchSettings("iframe", { heightUnit: value as "vh" | "px" })
                }
              >
                <SelectTrigger className="bg-background w-20 rounded-l-none border-l-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vh">vh</SelectItem>
                  <SelectItem value="px">px</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground text-xs">Default is 30 vh</p>
          </div>
          <div className="text-muted-foreground flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
            <Info className="text-primary size-4 shrink-0" />
            Not all sites support iframes.
          </div>
        </div>
      );
    case "api_request":
      return (
        <ApiRequestConfig
          settings={settings.api_request}
          onChange={(patch) => patchSettings("api_request", patch)}
        />
      );
    case "http_webhook":
      return (
        <HttpWebhookConfig
          settings={settings.http_webhook}
          onChange={(patch) => patchSettings("http_webhook", patch)}
        />
      );
    case "respond":
      return (
        <RespondConfig
          settings={settings.respond}
          onChange={(patch) => patchSettings("respond", patch)}
        />
      );
    case "send_email":
      return (
        <div className="space-y-1.5">
          <Label>Send to</Label>
          <Input
            value={settings.send_email?.to ?? ""}
            onChange={(e) => patchSettings("send_email", { to: e.target.value })}
            placeholder="support@example.com"
            className="bg-background"
          />
        </div>
      );
    case "notification":
      return (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={settings.notification?.title ?? ""}
              onChange={(e) =>
                patchSettings("notification", {
                  title: e.target.value.slice(0, NOTIFICATION_TITLE_LIMIT),
                })
              }
              placeholder="Exam results are out"
              className="bg-background"
            />
            <p className="text-muted-foreground text-right text-xs">
              {(settings.notification?.title ?? "").length}/{NOTIFICATION_TITLE_LIMIT}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Notification content</Label>
            <Textarea
              value={settings.notification?.content ?? ""}
              onChange={(e) =>
                patchSettings("notification", {
                  content: e.target.value.slice(0, NOTIFICATION_CONTENT_LIMIT),
                })
              }
              placeholder="The message the assistant sends on its own, without being asked"
              rows={4}
              className="bg-background"
            />
            <p className="text-muted-foreground text-right text-xs">
              {(settings.notification?.content ?? "").length}/{NOTIFICATION_CONTENT_LIMIT}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Delivery</Label>
            <Select
              value={settings.notification?.deliveryRule ?? "session"}
              onValueChange={(value) =>
                patchSettings("notification", {
                  deliveryRule: value as NotificationDeliveryRule,
                })
              }
            >
              <SelectTrigger className="bg-background">
                <SelectValue>
                  {DELIVERY_RULE_LABELS[settings.notification?.deliveryRule ?? "session"]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DELIVERY_RULE_LABELS) as NotificationDeliveryRule[]).map(
                  (rule) => (
                    <SelectItem key={rule} value={rule}>
                      {DELIVERY_RULE_LABELS[rule]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <SettingToggle
            title="Allow users to reply"
            description="Let the user answer this notification in the chat. Turn it off for a one-way announcement, the composer closes and says so."
            checked={settings.notification?.allowReplies ?? true}
            onCheckedChange={(allowReplies) =>
              patchSettings("notification", { allowReplies })
            }
          />
          <NotificationButtonsConfig
            buttons={settings.notification?.buttons ?? []}
            onChange={(buttons) => patchSettings("notification", { buttons })}
          />
          <div className="text-muted-foreground flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
            <Info className="text-primary size-4 shrink-0" />
            Sent verbatim, and never more often than the delivery rule allows.
          </div>
        </div>
      );
    case "handover":
      return (
        <div className="space-y-1.5">
          <Label>Transfer to</Label>
          <Select
            value={settings.handover?.assistantId ?? ""}
            onValueChange={(value) =>
              patchSettings("handover", { assistantId: value as string })
            }
          >
            <SelectTrigger className="bg-background">
              <SelectValue>
                {(v: string) =>
                  assistants.find((a) => a.id === v)?.title || "Select an assistant…"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Select an assistant…</SelectItem>
              {assistants.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "improvement":
    case "suggest_help_desk":
      return null;
  }
}

/** Whether `FlowActionConfig` renders any field for this action. */
export function actionHasConfig(action: FlowAction): boolean {
  return action !== "improvement" && action !== "suggest_help_desk";
}
