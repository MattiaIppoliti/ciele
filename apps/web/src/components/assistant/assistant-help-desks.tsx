"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  SectionTimeline,
  TimelineSection,
} from "@/components/settings/section-timeline";
import type { HelpDesk, HelpDeskSettings } from "@agent-hub/core";
import { Search } from "lucide-react";
import { toast } from "@/lib/toast";
import { updateAssistantAction } from "@/app/actions";
import { Card } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

/** Descriptions shorter than this flag a desk as "Needs attention". */
const AI_RECOGNITION_TARGET = 200;
const DEFAULT_BUTTON_LABEL = "Contact support";

type View = "selected" | "attention" | "all";

function SettingToggle({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </div>
  );
}

export function AssistantHelpDesks({
  assistantId,
  settings: initial,
  desks,
  canEdit,
}: {
  assistantId: string;
  settings: HelpDeskSettings;
  desks: HelpDesk[];
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState<HelpDeskSettings>(initial);
  const [buttonLabel, setButtonLabel] = useState(
    initial.contactButtonLabel ?? "Contact support"
  );
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Rapid consecutive saves (toggle + toggle + label) must not clobber each
  // other, build every patch on the latest value, not the render closure.
  const latest = useRef(settings);

  function save(patch: Partial<HelpDeskSettings>, message?: string) {
    const previous = latest.current;
    const next = { ...previous, ...patch };
    latest.current = next;
    setSettings(next);
    startTransition(async () => {
      try {
        await updateAssistantAction(assistantId, { helpDeskSettings: next });
        if (message) toast.success(message);
      } catch (error) {
        // Roll the switch back to what is stored. A newer save already carries
        // this patch, so only the last one in flight reverts.
        if (latest.current === next) {
          latest.current = previous;
          setSettings(previous);
          if ("contactButtonLabel" in patch)
            setButtonLabel(previous.contactButtonLabel ?? DEFAULT_BUTTON_LABEL);
        }
        toast.error(error instanceof Error ? error.message : "Could not save the setting");
      }
    });
  }

  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLabel = useRef<string | null>(null);
  const [labelPending, setLabelPending] = useState(false);

  function commitButtonLabel(value: string) {
    const label = value.trim() || DEFAULT_BUTTON_LABEL;
    if (label === (latest.current.contactButtonLabel ?? DEFAULT_BUTTON_LABEL))
      return;
    save({ contactButtonLabel: label }, "Button name saved");
  }

  function clearLabelTimer() {
    if (labelTimer.current) clearTimeout(labelTimer.current);
    labelTimer.current = null;
    pendingLabel.current = null;
    setLabelPending(false);
  }

  function onButtonLabelChange(value: string) {
    setButtonLabel(value);
    if (labelTimer.current) clearTimeout(labelTimer.current);
    pendingLabel.current = value;
    setLabelPending(true);
    labelTimer.current = setTimeout(() => {
      clearLabelTimer();
      commitButtonLabel(value);
    }, 800);
  }

  function onButtonLabelBlur() {
    clearLabelTimer();
    const label = buttonLabel.trim() || DEFAULT_BUTTON_LABEL;
    setButtonLabel(label);
    commitButtonLabel(label);
  }

  // Leaving the section inside the debounce window must not drop the name
  // typed last: the cleanup sends it straight away instead.
  useEffect(
    () => () => {
      if (!labelTimer.current || pendingLabel.current === null) return;
      clearTimeout(labelTimer.current);
      const label = pendingLabel.current.trim() || DEFAULT_BUTTON_LABEL;
      if (label === (latest.current.contactButtonLabel ?? DEFAULT_BUTTON_LABEL)) return;
      updateAssistantAction(assistantId, {
        helpDeskSettings: { ...latest.current, contactButtonLabel: label },
      }).catch(() => toast.error("Could not save the button name"));
    },
    [assistantId]
  );

  // A reload inside the same window has no cleanup to run, so the browser's
  // own "Leave site?" prompt guards it.
  useUnsavedChanges({ dirty: labelPending });

  const selectedIds = useMemo(
    () => settings.selectedIds ?? [],
    [settings.selectedIds]
  );

  function toggleDesk(desk: HelpDesk, on: boolean) {
    const next = on
      ? [...selectedIds, desk.id]
      : selectedIds.filter((id) => id !== desk.id);
    save({ selectedIds: next }, `“${desk.name}” ${on ? "selected" : "removed"}`);
  }

  const needsAttention = useMemo(
    () =>
      desks.filter((d) => d.description.trim().length < AI_RECOGNITION_TARGET),
    [desks]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return desks.filter((desk) => {
      if (view === "selected" && !selectedIds.includes(desk.id)) return false;
      if (
        view === "attention" &&
        desk.description.trim().length >= AI_RECOGNITION_TARGET
      )
        return false;
      if (
        needle &&
        !desk.name.toLowerCase().includes(needle) &&
        !desk.description.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [desks, view, search, selectedIds]);

  const VIEWS: Array<{ key: View; label: ReactNode }> = [
    {
      key: "selected",
      label: (
        <>
          Selected (<RollingNumber value={selectedIds.length} />)
        </>
      ),
    },
    {
      key: "attention",
      label: (
        <>
          Needs attention (<RollingNumber value={needsAttention.length} />)
        </>
      ),
    },
    { key: "all", label: "All" },
  ];

  return (
    <div className="pt-8">
      <SectionTimeline>
      <TimelineSection title="Escalation behavior">
      <p className="text-muted-foreground -mt-3 text-sm">
        Configure how and when this assistant offers support escalation.
      </p>

      <Card size="sm" className="mt-4 gap-0 p-4">
        <SettingToggle
          title="AI recommended help desk"
          description="When the AI Assistant does not know the answer to a question, it will recommend a help desk based on the help desk description."
          checked={settings.aiRecommended ?? false}
          disabled={!canEdit}
          onCheckedChange={(aiRecommended) =>
            save(
              { aiRecommended },
              `AI recommended help desk ${aiRecommended ? "enabled" : "disabled"}`
            )
          }
        />
      </Card>

      <Card size="sm" className="mt-4 gap-4 p-4">
        <div className="rounded-lg border bg-muted/30 p-3.5">
          <SettingToggle
            title="Hide Always Available Escalation Button"
            description="Turn on to hide the contact support button that always floats at the bottom of the chat window."
            checked={settings.hideEscalationButton ?? false}
            disabled={!canEdit}
            onCheckedChange={(hideEscalationButton) =>
              save(
                { hideEscalationButton },
                `Escalation button ${hideEscalationButton ? "hidden" : "shown"}`
              )
            }
          />
        </div>
        <div>
          <p className="font-semibold">
            Contact Support Button Name{" "}
            <span className="text-destructive">*</span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Customize the button name to display the support options
          </p>
          <Input
            value={buttonLabel}
            aria-label="Contact support button name"
            autoComplete="off"
            onChange={(e) => onButtonLabelChange(e.target.value)}
            onBlur={onButtonLabelBlur}
            disabled={!canEdit}
            className="mt-2 h-11"
          />
        </div>
      </Card>
      </TimelineSection>

      <TimelineSection title="Select help desks">
      <p className="text-muted-foreground -mt-3 text-sm">
        Choose which help desks the assistant can recommend based on
        conversation context.
      </p>

      <Card size="sm" className="mt-4 gap-0 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">View:</span>
          <div className="bg-muted flex items-center rounded-lg p-1">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v.key
                    ? "bg-background shadow-light"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground ml-auto rounded-full border px-3 py-1 text-xs font-semibold">
            <RollingNumber value={selectedIds.length} /> selected
          </span>
        </div>

        <div className="relative mt-4">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search help desks"
            aria-label="Search help desks"
            type="search"
            autoComplete="off"
            className="h-11 pl-9"
          />
        </div>

        <div className="mt-4 space-y-3">
          {visible.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No help desks match this view.
            </p>
          )}
          {visible.map((desk) => (
            <div key={desk.id} className="rounded-lg border bg-muted/20 p-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold break-words">{desk.name}</p>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                    {desk.description || "No description yet."}
                  </p>
                </div>
                <Switch
                  checked={selectedIds.includes(desk.id)}
                  disabled={!canEdit}
                  onCheckedChange={(on) => toggleDesk(desk, on)}
                  aria-label={`Select ${desk.name}`}
                />
              </div>
              <Link
                href={`/help-desks/${desk.id}`}
                className="text-primary mt-3 inline-block text-sm font-semibold underline underline-offset-4 hover:opacity-70"
              >
                Edit help desk
              </Link>
            </div>
          ))}
        </div>
      </Card>
      </TimelineSection>
      </SectionTimeline>
    </div>
  );
}
