"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Link } from "@/components/ui/link";
import { useRouter } from "next/navigation";
import type {
  ApiRequestAuthType,
  Flow,
  FlowAction,
  FlowActionSettings,
  FlowButtonIcon as FlowButtonIconName,
  FlowButtonType,
  FlowCondition,
  FlowConditionExample,
  FlowConditionLogic,
  FlowTrigger,
  FlowTrust,
  FlowUrlOperator,
  KeyValuePair,
  NotificationButton,
  NotificationDeliveryRule,
} from "@agent-hub/core";

import {
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleMinus,
  CirclePlus,
  Info,
  Lightbulb,
  ListFilter,
  MessageSquareReply,
  MousePointerClick,
  Plus,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import {
  createFlowAction,
  deleteFlowAction,
  testApiRequestAction,
  updateFlowAction,
} from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card, CardContent } from "@agent-hub/ui";
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
import { DEFAULT_DWELL_SECONDS, isProactiveTrigger } from "@agent-hub/core";
import {
  FLOW_ACTION_PICKER,
  FLOW_ACTIONS,
  FLOW_TRIGGER_LABELS,
  PROACTIVE_FLOW_ACTION_PICKER,
  actionsFitTrigger,
  partitionActionsForTrigger,
} from "@/lib/flow-actions";
import {
  cleanFlowConditions,
  FLOW_CONDITION_KINDS,
  FLOW_URL_OPERATORS,
  flowConditionDescription,
  flowConditionIssue,
  flowConditionPicker,
  flowConditionsSavable,
  newFlowCondition,
  timezoneOptions,
  urlOperatorHint,
} from "@/lib/flow-conditions";
import { TEMPLATE_VARIABLES } from "@agent-hub/agent/client";
import type { ApiRequestTestResult } from "@agent-hub/agent/client";
import { cn } from "@/lib/utils";
import { TrustBadge } from "@/components/assistant/trust-badge";
import {
  FlowButtonIcon,
  FLOW_BUTTON_ICON_OPTIONS,
} from "@/components/chat/flow-button-icon";

interface AssistantOption {
  id: string;
  title: string;
}

interface HelpDeskOption {
  id: string;
  name: string;
}

interface FaqOption {
  id: string;
  question: string;
}

const TRIGGER_LABELS = FLOW_TRIGGER_LABELS;

const TRIGGERS: Array<{ value: FlowTrigger; label: string }> = [
  { value: "message", label: TRIGGER_LABELS.message },
  { value: "page_load", label: TRIGGER_LABELS.page_load },
  { value: "time_on_page", label: TRIGGER_LABELS.time_on_page },
  { value: "chat_open", label: TRIGGER_LABELS.chat_open },
];

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

function localId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Strip a leading http(s):// so the Iframe "Link" field shows a bare host next
 * to the fixed `https://` prefix. The runtime re-adds the protocol when
 * rendering, so storing the bare form keeps the input and prefix in sync.
 */
function stripHttps(value: string): string {
  return value.replace(/^https?:\/\//i, "");
}

function newExample(shouldTrigger: boolean): FlowConditionExample {
  return { message: "", note: "", shouldTrigger };
}


/** Compact collapsible section using the app's neutral visual language. */
function StepCard({
  icon: Icon,
  title,
  badge,
  subtitle,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge: "required" | "optional" | null;
  subtitle: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card size="sm" className="gap-0 py-0 shadow-none">
      <details
        className="group"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
              {badge === "required" && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground h-5 rounded-full px-1.5 text-[10px]"
                >
                  Required
                </Badge>
              )}
              {badge === "optional" && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground h-5 rounded-full px-1.5 text-[10px]"
                >
                  Optional
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
          </div>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="border-t px-3 py-3">{children}</CardContent>
      </details>
    </Card>
  );
}

function StatusItem({
  ok,
  required,
  label,
}: {
  ok: boolean;
  required: boolean;
  label: string;
}) {
  if (ok) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Check className="size-4" />
        {label}
      </span>
    );
  }
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-medium ${
        required ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      <span
        className={`size-4 shrink-0 rounded-full border-2 ${
          required ? "border-destructive" : "border-input"
        }`}
      />
      {label}
    </span>
  );
}

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
            transform is overridden on these SVGs — so the arrow would never
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
            onClick={() => onChange([...examples, newExample(shouldTrigger)])}
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
 * and keyboard entry for free. Both bounds write the same `timezone` field — the
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

const API_REQUEST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const API_REQUEST_AUTH_LABELS: Record<ApiRequestAuthType, string> = {
  none: "No authentication",
  bearer: "Bearer token",
  api_key: "API key header",
  basic: "Basic auth",
};

type ApiRequestSettings = NonNullable<FlowActionSettings["api_request"]>;

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

function TestRequestControl({ settings }: { settings: ApiRequestSettings }) {
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

function ApiRequestConfig({
  settings,
  onChange,
}: {
  settings: FlowActionSettings["api_request"];
  onChange: (patch: Partial<ApiRequestSettings>) => void;
}) {
  const auth = settings?.auth ?? { type: "none" };
  const setAuthType = (type: ApiRequestAuthType) =>
    onChange({ auth: { type } as ApiRequestSettings["auth"] });
  const method = settings?.method ?? "POST";
  const isBodyless = method === "GET";
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
              {API_REQUEST_METHODS.map((m) => (
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

      <div className="space-y-1.5">
        <Label>Authentication</Label>
        <Select value={auth.type} onValueChange={(v) => setAuthType(v as ApiRequestAuthType)}>
          <SelectTrigger className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(API_REQUEST_AUTH_LABELS) as ApiRequestAuthType[]).map(
              (type) => (
                <SelectItem key={type} value={type}>
                  {API_REQUEST_AUTH_LABELS[type]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {auth.type === "bearer" && (
          <Input
            type="password"
            value={auth.token ?? ""}
            onChange={(e) => onChange({ auth: { type: "bearer", token: e.target.value } })}
            placeholder="Token"
            className="bg-background"
            autoComplete="off"
          />
        )}
        {auth.type === "api_key" && (
          <div className="flex gap-2">
            <Input
              value={auth.header ?? ""}
              onChange={(e) =>
                onChange({ auth: { type: "api_key", header: e.target.value, key: auth.key } })
              }
              placeholder="Header name (e.g. X-API-Key)"
              className="bg-background"
            />
            <Input
              type="password"
              value={auth.key ?? ""}
              onChange={(e) =>
                onChange({ auth: { type: "api_key", header: auth.header, key: e.target.value } })
              }
              placeholder="Key"
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
                onChange({
                  auth: { type: "basic", username: e.target.value, password: auth.password },
                })
              }
              placeholder="Username"
              className="bg-background"
            />
            <Input
              type="password"
              value={auth.password ?? ""}
              onChange={(e) =>
                onChange({
                  auth: { type: "basic", username: auth.username, password: e.target.value },
                })
              }
              placeholder="Password"
              className="bg-background"
              autoComplete="off"
            />
          </div>
        )}
      </div>

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
 * chat. Help-desk and FAQ buttons are deliberately absent — they answer a question
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

export function FlowBuilder({
  assistantId,
  flow,
  assistants,
  helpDesks,
  faqs,
  trust = null,
}: {
  assistantId: string;
  flow: Flow | null;
  /** Other assistants in the org, for the Handover action. */
  assistants: AssistantOption[];
  /** Help desks available to a response Button of type Help desk. */
  helpDesks: HelpDeskOption[];
  /** FAQ questions available to a response Button of type FAQ. */
  faqs: FaqOption[];
  /** Materialized trust for this flow, when it exists. */
  trust?: FlowTrust | null;
}) {
  const router = useRouter();
  const isEdit = flow !== null;
  const isDefaultFlow = flow?.isDefault ?? false;

  const [name, setName] = useState(flow?.name ?? "");
  const [trigger, setTrigger] = useState<FlowTrigger | null>(
    flow ? flow.trigger : null
  );
  /** A trigger change awaiting confirmation because it discards configuration. */
  const [pendingTrigger, setPendingTrigger] = useState<FlowTrigger | null>(null);
  const [dwell, setDwell] = useState<{ minutes: number; seconds: number }>(() => {
    const stored = flow?.triggerSettings?.timeOnPage;
    const total =
      (stored?.minutes ?? 0) * 60 + (stored?.seconds ?? 0) || DEFAULT_DWELL_SECONDS;
    return { minutes: Math.floor(total / 60), seconds: total % 60 };
  });
  const [conditionLogic, setConditionLogic] = useState<FlowConditionLogic>(
    flow?.conditionLogic ?? "any"
  );
  const [conditions, setConditions] = useState<FlowCondition[]>(
    flow?.conditions ?? []
  );
  const [actions, setActions] = useState<FlowAction[]>(flow?.actions ?? []);
  const [settings, setSettings] = useState<FlowActionSettings>(
    flow?.actionSettings ?? {}
  );
  const [customMessage, setCustomMessage] = useState(flow?.customMessage ?? "");
  const [isPending, startTransition] = useTransition();

  const flowsHref = `/assistants/${assistantId}/flows`;

  function patchSettings<K extends keyof FlowActionSettings>(
    key: K,
    patch: NonNullable<FlowActionSettings[K]>
  ) {
    setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  const dwellSeconds = dwell.minutes * 60 + dwell.seconds;
  // A zero dwell would make "Time on page" indistinguishable from "On page load",
  // which is a trigger the admin could have picked instead.
  const dwellOk = trigger !== "time_on_page" || dwellSeconds > 0;
  const triggerOk = isDefaultFlow || (trigger !== null && dwellOk);
  // A proactive trigger changes what the rest of the builder can offer: there is
  // no conversation to gate on and no question to answer, so conditions fall away
  // and the Response collapses to the one proactive action (#541).
  const proactive = trigger !== null && isProactiveTrigger(trigger);
  const configuredActions = actions.every((action) => {
    if (action === "notification")
      return Boolean(settings.notification?.content?.trim());
    if (action === "custom_message") return customMessage.trim().length > 0;
    if (action === "show_button") {
      const button = settings.show_button;
      if (button?.type === "help_desk") return Boolean(button.helpDeskId);
      if (button?.type === "send_text") return Boolean(button.text?.trim());
      if (button?.type === "faq") return Boolean(button.faqQuestion?.trim());
      return Boolean(button?.url?.trim());
    }
    if (action === "iframe") return Boolean(settings.iframe?.url?.trim());
    if (action === "api_request")
      return Boolean(settings.api_request?.url?.trim());
    if (action === "send_email")
      return Boolean(settings.send_email?.to?.trim());
    if (action === "handover") return Boolean(settings.handover?.assistantId);
    if (action === "follow_up_questions") {
      const followUp = settings.follow_up_questions;
      if (followUp?.mode !== "manual") return true;
      return (followUp.questions ?? []).some((q) => q.trim().length > 0);
    }
    return true;
  });
  // Belt to the braces in chooseTrigger: the runtime refuses an action its trigger
  // may not run, so the editor must never offer to save that pair — a refused save
  // has to be a disabled button with a reason, never a 500.
  const actionsMatchTrigger = actionsFitTrigger(actions, trigger);
  const responseOk = actions.length > 0 && configuredActions && actionsMatchTrigger;
  const nameOk = name.trim().length > 0;
  // An incomplete objective condition would reach the runtime as a condition
  // the gate has to ignore — refuse it here instead (spec #550).
  const conditionsOk = flowConditionsSavable(conditions);
  const canSave = triggerOk && responseOk && nameOk && conditionsOk;

  /**
   * Picks a trigger, clearing configuration the new trigger cannot express.
   * Crossing the reactive/proactive line invalidates the whole Response step (and
   * any conditions), so the admin is asked first rather than losing work silently.
   *
   * The question is asked of the *actions*, not of the previous trigger: "Remove
   * trigger" nulls the trigger while leaving the actions in place, so comparing
   * trigger kinds saw no crossing and cleared nothing — the editor then offered to
   * save `custom_message` on `chat_open`, a pair the server action refuses.
   */
  function chooseTrigger(next: FlowTrigger) {
    const { discarded } = partitionActionsForTrigger(actions, next);
    const losesConditions = isProactiveTrigger(next) && conditions.length > 0;
    if (discarded.length > 0 || losesConditions) {
      setPendingTrigger(next);
      return;
    }
    setTrigger(next);
  }

  function applyPendingTrigger() {
    if (pendingTrigger === null) return;
    // Keep whatever the new trigger can still run; drop only what it cannot.
    const { kept } = partitionActionsForTrigger(actions, pendingTrigger);
    setTrigger(pendingTrigger);
    setPendingTrigger(null);
    setActions(kept);
    if (isProactiveTrigger(pendingTrigger)) {
      setConditions([]);
      setCustomMessage("");
    }
    if (!kept.includes("notification")) {
      setSettings((prev) => ({ ...prev, notification: undefined }));
    }
  }

  const disabledHint = !dwellOk
    ? "Set how long the user must stay on the page"
    : !triggerOk
    ? `Set a trigger to enable ${isEdit ? "Save changes" : "Create flow"}`
    : actions.length === 0
      ? `Add a response action to enable ${isEdit ? "Save changes" : "Create flow"}`
      : !actionsMatchTrigger
        ? `Remove the actions this trigger cannot run: ${partitionActionsForTrigger(actions, trigger ?? "message")
            .discarded.map((action) => FLOW_ACTIONS[action].label)
            .join(", ")}`
      : !configuredActions
        ? "Complete the required settings for every response action"
        : !conditionsOk
          ? "Complete every condition you added"
          : !nameOk
            ? `Name the flow to enable ${isEdit ? "Save changes" : "Create flow"}`
            : null;

  function save() {
    if (!canSave) return;
    const cleanedConditions = cleanFlowConditions(conditions);
    // The classifier catalogs flows by description — keep it in sync with the
    // builder's semantic condition descriptions.
    const joined = flowConditionDescription(cleanedConditions);
    const payload = {
      description: joined || flow?.description || "",
      trigger: trigger ?? ("message" as FlowTrigger),
      // Only Time-on-page has trigger-scoped settings; every other trigger
      // stores an empty object rather than a stale dwell from a previous choice.
      triggerSettings:
        trigger === "time_on_page"
          ? { timeOnPage: { minutes: dwell.minutes, seconds: dwell.seconds } }
          : {},
      conditionLogic,
      conditions: cleanedConditions,
      actions,
      actionSettings: settings,
      customMessage,
    };
    startTransition(async () => {
      if (isEdit) {
        await updateFlowAction(assistantId, flow.id, {
          ...(flow.builtIn ? {} : { name: name.trim() }),
          ...payload,
        });
        toast.success("Flow updated");
      } else {
        await createFlowAction(assistantId, { name: name.trim(), ...payload });
        toast.success("Flow created");
      }
      router.push(flowsHref);
    });
  }

  function handleDelete() {
    if (!flow) return;
    if (!window.confirm(`Delete flow "${flow.name}"?`)) return;
    startTransition(async () => {
      await deleteFlowAction(assistantId, flow.id);
      toast.success("Flow deleted");
      router.push(flowsHref);
    });
  }

  return (
    <div className={isPending ? "pointer-events-none opacity-70" : ""}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={flowsHref}
          className="text-muted-foreground flex items-center gap-1 text-sm font-medium hover:opacity-70"
        >
          <ChevronLeft className="size-4" strokeWidth={3} />
          All flows
        </Link>
        <span className="text-muted-foreground">/</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this flow..."
          disabled={isEdit && flow.builtIn}
          className="h-9 min-w-0 flex-1 font-semibold"
        />
        {isEdit &&
          (trust ? (
            <div className="shrink-0">
              <TrustBadge trust={trust} />
            </div>
          ) : (
            (flow.isDefault || actions.includes("search_knowledge")) && (
              <div className="shrink-0">
                <TrustBadge trust={null} />
              </div>
            )
          ))}
        {isEdit && (
          <div className="flex items-center gap-2">
            {!flow.builtIn && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive font-semibold"
                onClick={handleDelete}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="rounded-xl px-5 font-semibold"
              onClick={() => router.push(flowsHref)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-4 pb-3">
        {/* 1 — Trigger */}
        <StepCard
          icon={MousePointerClick}
          title="Trigger"
          badge={isDefaultFlow ? null : "required"}
          subtitle="Define the event that starts this flow"
          defaultOpen={!triggerOk}
        >
          {isDefaultFlow ? (
            <p className="text-muted-foreground text-sm">
              The default flow runs whenever no other flow matches — it needs no
              trigger.
            </p>
          ) : trigger === null ? (
            <div>
              <p className="text-sm font-medium">What triggers the flow?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TRIGGERS.map((t) => (
                  <Button
                    key={t.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => chooseTrigger(t.value)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <p className="text-sm font-semibold">
                  {TRIGGER_LABELS[trigger]}
                </p>
                <Hint label="Remove trigger">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove trigger"
                    onClick={() => setTrigger(null)}
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
                        <span className="text-muted-foreground text-xs">
                          {field.label}
                        </span>
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
                            setDwell((prev) => ({ ...prev, [field.key]: value }));
                          }}
                          className="bg-background w-24"
                        />
                      </div>
                    ))}
                  </div>
                  {!dwellOk && (
                    <p className="text-destructive text-xs">
                      Set at least one second — otherwise this is “On page load”.
                    </p>
                  )}
                </div>
              )}
              {proactive && (
                <p className="text-muted-foreground text-sm">
                  This flow starts on its own, without the user asking anything —
                  so it has no conditions, and its response is a single
                  notification.
                </p>
              )}
            </div>
          )}
        </StepCard>

        {/* 2 — Conditions */}
        <StepCard
          icon={ListFilter}
          title="Conditions"
          badge={isDefaultFlow ? null : "optional"}
          subtitle="Criteria that must be met for the flow to continue."
          defaultOpen={conditions.length > 0}
        >
          {isDefaultFlow ? (
            <p className="text-muted-foreground text-sm">
              The default flow has no conditions.
            </p>
          ) : trigger === null ? (
            <p className="text-base">
              Select a trigger to see the available conditions.
            </p>
          ) : proactive ? (
            <p className="text-muted-foreground text-sm">
              A conversation-context condition needs a conversation to read, and
              this flow runs before the user has said anything — so there are no
              conditions to set.
            </p>
          ) : (
            <div className="space-y-3">
              {conditions.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                  <p className="text-sm font-medium">Condition logic</p>
                  {/* Segmented control on a bordered track, selected half
                      filled with `primary`.
                      The theme sets `--muted`, `--card`, `--accent` and
                      `--secondary` to the same value, so every "subtle surface"
                      treatment — the old `secondary`-vs-`ghost` Button variants
                      included — renders as no change at all and the choice was
                      invisible. `primary` is the one token that contrasts with
                      the card in both themes. */}
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
                        onClick={() => setConditionLogic(o.value)}
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
                    setConditions((prev) =>
                      prev.map((c) => (c.id === next.id ? next : c))
                    )
                  }
                  onRemove={() =>
                    setConditions((prev) =>
                      prev.filter((c) => c.id !== condition.id)
                    )
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
                        setConditions((prev) => [
                          ...prev,
                          newFlowCondition(meta.kind, localId()),
                        ])
                      }
                    >
                      {meta.label} <Plus className="size-4" />
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </StepCard>

        {/* 3 — Response */}
        <StepCard
          icon={MessageSquareReply}
          title="Response"
          badge={isDefaultFlow ? null : "required"}
          subtitle="Define what will happen if the trigger and conditions are met."
          defaultOpen={!responseOk}
        >
          <div className="space-y-3">
            {actions.map((action) => {
              const meta = FLOW_ACTIONS[action];
              const Icon = meta.icon;
              return (
                <div key={action} className="space-y-3 rounded-lg border bg-background p-3">
                  <div className="flex items-start gap-3">
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{meta.label}</h3>
                        {meta.beta && (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground rounded-full"
                          >
                            beta
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {meta.subtitle}
                      </p>
                    </div>
                    <Hint label={`Remove ${meta.label}`}>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Remove ${meta.label}`}
                        onClick={() =>
                          setActions((prev) => prev.filter((a) => a !== action))
                        }
                      >
                        <AnimatedIcon icon={Trash2} size={16} />
                      </Button>
                    </Hint>
                  </div>

                  {action === "custom_message" && (
                    <Textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="The message the assistant sends when this flow triggers"
                      rows={3}
                      className="bg-background"
                    />
                  )}

                  {action === "search_knowledge" && (
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
                        checked={
                          settings.search_knowledge?.improvementItems ?? false
                        }
                        onCheckedChange={(improvementItems) =>
                          patchSettings("search_knowledge", { improvementItems })
                        }
                      />
                      <SearchKnowledgeAdvanced
                        settings={settings.search_knowledge}
                        onChange={(patch) =>
                          patchSettings("search_knowledge", patch)
                        }
                      />
                    </div>
                  )}

                  {action === "follow_up_questions" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Mode</Label>
                        <Select
                          value={
                            settings.follow_up_questions?.mode ?? "ai_generated"
                          }
                          onValueChange={(value) =>
                            patchSettings("follow_up_questions", {
                              mode: value as "ai_generated" | "manual",
                            })
                          }
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue>
                              {(settings.follow_up_questions?.mode ??
                                "ai_generated") === "manual"
                                ? "Manual"
                                : "AI generated"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ai_generated">
                              AI generated
                            </SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {(settings.follow_up_questions?.mode ?? "ai_generated") ===
                      "ai_generated" ? (
                        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                          The AI will use the conversation context to generate
                          relevant follow-up questions automatically.
                        </p>
                      ) : (
                        <FollowUpManualConfig
                          questions={settings.follow_up_questions?.questions ?? []}
                          onChange={(questions) =>
                            patchSettings("follow_up_questions", { questions })
                          }
                        />
                      )}
                    </div>
                  )}

                  {action === "show_button" && (
                    <FlowButtonConfig
                      settings={settings.show_button}
                      helpDesks={helpDesks}
                      faqs={faqs}
                      onChange={(patch) => patchSettings("show_button", patch)}
                    />
                  )}

                  {action === "iframe" && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>Title</Label>
                        <Input
                          value={settings.iframe?.title ?? ""}
                          onChange={(e) =>
                            patchSettings("iframe", { title: e.target.value })
                          }
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
                              patchSettings("iframe", {
                                url: stripHttps(e.target.value),
                              })
                            }
                            placeholder="example.com"
                            className="bg-background rounded-l-none"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2.5 text-sm">
                        <Checkbox
                          checked={settings.iframe?.lightbox ?? true}
                          onCheckedChange={(lightbox) =>
                            patchSettings("iframe", { lightbox })
                          }
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
                              patchSettings("iframe", {
                                height: Number(e.target.value) || undefined,
                              })
                            }
                            className="bg-background rounded-r-none"
                          />
                          <Select
                            value={settings.iframe?.heightUnit ?? "vh"}
                            onValueChange={(value) =>
                              patchSettings("iframe", {
                                heightUnit: value as "vh" | "px",
                              })
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
                        <p className="text-muted-foreground text-xs">
                          Default is 30 vh
                        </p>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
                        <Info className="text-primary size-4 shrink-0" />
                        Not all sites support iframes.
                      </div>
                    </div>
                  )}

                  {action === "api_request" && (
                    <ApiRequestConfig
                      settings={settings.api_request}
                      onChange={(patch) => patchSettings("api_request", patch)}
                    />
                  )}

                  {action === "send_email" && (
                    <div className="space-y-1.5">
                      <Label>Send to</Label>
                      <Input
                        value={settings.send_email?.to ?? ""}
                        onChange={(e) =>
                          patchSettings("send_email", { to: e.target.value })
                        }
                        placeholder="support@example.com"
                        className="bg-background"
                      />
                    </div>
                  )}

                  {action === "notification" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Title</Label>
                        <Input
                          value={settings.notification?.title ?? ""}
                          onChange={(e) =>
                            patchSettings("notification", {
                              title: e.target.value.slice(
                                0,
                                NOTIFICATION_TITLE_LIMIT
                              ),
                            })
                          }
                          placeholder="Exam results are out"
                          className="bg-background"
                        />
                        <p className="text-muted-foreground text-right text-xs">
                          {(settings.notification?.title ?? "").length}/
                          {NOTIFICATION_TITLE_LIMIT}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Notification content</Label>
                        <Textarea
                          value={settings.notification?.content ?? ""}
                          onChange={(e) =>
                            patchSettings("notification", {
                              content: e.target.value.slice(
                                0,
                                NOTIFICATION_CONTENT_LIMIT
                              ),
                            })
                          }
                          placeholder="The message the assistant sends on its own, without being asked"
                          rows={4}
                          className="bg-background"
                        />
                        <p className="text-muted-foreground text-right text-xs">
                          {(settings.notification?.content ?? "").length}/
                          {NOTIFICATION_CONTENT_LIMIT}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Delivery</Label>
                        <Select
                          value={
                            settings.notification?.deliveryRule ?? "session"
                          }
                          onValueChange={(value) =>
                            patchSettings("notification", {
                              deliveryRule: value as NotificationDeliveryRule,
                            })
                          }
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue>
                              {DELIVERY_RULE_LABELS[
                                settings.notification?.deliveryRule ?? "session"
                              ]}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.keys(DELIVERY_RULE_LABELS) as
                                NotificationDeliveryRule[]
                            ).map((rule) => (
                              <SelectItem key={rule} value={rule}>
                                {DELIVERY_RULE_LABELS[rule]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <SettingToggle
                        title="Allow users to reply"
                        description="Let the user answer this notification in the chat. Turn it off for a one-way announcement — the composer closes and says so."
                        checked={settings.notification?.allowReplies ?? true}
                        onCheckedChange={(allowReplies) =>
                          patchSettings("notification", { allowReplies })
                        }
                      />
                      <NotificationButtonsConfig
                        buttons={settings.notification?.buttons ?? []}
                        onChange={(buttons) =>
                          patchSettings("notification", { buttons })
                        }
                      />
                      <div className="text-muted-foreground flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
                        <Info className="text-primary size-4 shrink-0" />
                        Sent verbatim, and never more often than the delivery
                        rule allows.
                      </div>
                    </div>
                  )}

                  {action === "handover" && (
                    <div className="space-y-1.5">
                      <Label>Transfer to</Label>
                      <Select
                        value={settings.handover?.assistantId ?? ""}
                        onValueChange={(value) =>
                          patchSettings("handover", {
                            assistantId: value as string,
                          })
                        }
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue>
                            {(v: string) =>
                              assistants.find((a) => a.id === v)?.title ||
                              "Select an assistant…"
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
                  )}

                </div>
              );
            })}

            <div>
              <p className="text-sm font-semibold">Add an action</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(proactive
                  ? PROACTIVE_FLOW_ACTION_PICKER
                  : FLOW_ACTION_PICKER
                ).map((key) => {
                  const meta = FLOW_ACTIONS[key];
                  const Icon = meta.icon;
                  const added = actions.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={added}
                      onClick={() => setActions((prev) => [...prev, key])}
                      className="hover:bg-muted/50 flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Icon className="text-foreground/70 mt-0.5 size-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {meta.label}
                          {meta.beta && (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground rounded-full"
                            >
                              beta
                            </Badge>
                          )}
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
          </div>
        </StepCard>
      </div>

      {/* Crossing the reactive/proactive line discards the Response step. */}
      <Dialog
        open={pendingTrigger !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTrigger(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change the trigger?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {pendingTrigger === null
              ? null
              : `“${TRIGGER_LABELS[pendingTrigger]}” cannot run ${partitionActionsForTrigger(
                  actions,
                  pendingTrigger
                )
                  .discarded.map((action) => FLOW_ACTIONS[action].label)
                  .join(", ")}${
                  isProactiveTrigger(pendingTrigger) && conditions.length > 0
                    ? ", and a flow that starts on its own has no conditions"
                    : ""
                }. Changing the trigger removes ${
                  isProactiveTrigger(pendingTrigger) && conditions.length > 0
                    ? "them"
                    : "those actions"
                }; everything else is kept.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTrigger(null)}
            >
              Keep current trigger
            </Button>
            <Button type="button" onClick={applyPendingTrigger}>
              Change and clear
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Status footer */}
      <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card/95 px-3 py-2 shadow-md backdrop-blur">
        <StatusItem ok={triggerOk} required label="Trigger set" />
        <StatusItem
          ok={proactive || conditions.length > 0}
          required={false}
          label={
            proactive
              ? "No conditions for this trigger"
              : conditions.length > 0
                ? "Conditions added"
                : "No conditions added"
          }
        />
        <StatusItem ok={responseOk} required label="Response added" />
        <div className="ml-auto flex items-center gap-4">
          {disabledHint && (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Info className="size-4" /> {disabledHint}
            </span>
          )}
          <Button
            type="button"
            disabled={!canSave || isPending}
            onClick={save}
            className="h-9 rounded-lg px-4 font-semibold"
          >
            {isPending
              ? "Saving..."
              : isEdit
                ? "Save changes"
                : "Create flow"}
          </Button>
        </div>
      </div>
    </div>
  );
}
