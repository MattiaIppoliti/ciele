"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Link } from "@/components/ui/link";
import type { HelpDesk, HelpDeskSettings } from "@agent-hub/core";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { updateAssistantAction } from "@/app/actions";
import { Card } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";

/** Descriptions shorter than this flag a desk as "Needs attention". */
const AI_RECOGNITION_TARGET = 200;

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
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
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
  // other — build every patch on the latest value, not the render closure.
  const latest = useRef(settings);

  function save(patch: Partial<HelpDeskSettings>, message?: string) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setSettings(next);
    startTransition(async () => {
      await updateAssistantAction(assistantId, { helpDeskSettings: next });
      if (message) toast.success(message);
    });
  }

  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commitButtonLabel(value: string) {
    const label = value.trim() || "Contact support";
    if (label === (latest.current.contactButtonLabel ?? "Contact support"))
      return;
    save({ contactButtonLabel: label }, "Button name saved");
  }

  function onButtonLabelChange(value: string) {
    setButtonLabel(value);
    if (labelTimer.current) clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => commitButtonLabel(value), 800);
  }

  function onButtonLabelBlur() {
    if (labelTimer.current) clearTimeout(labelTimer.current);
    const label = buttonLabel.trim() || "Contact support";
    setButtonLabel(label);
    commitButtonLabel(label);
  }

  const selectedIds = useMemo(
    () => settings.selectedIds ?? [],
    [settings.selectedIds]
  );

  function toggleDesk(desk: HelpDesk, on: boolean) {
    const next = on
      ? [...selectedIds, desk.id]
      : selectedIds.filter((id) => id !== desk.id);
    save({ selectedIds: next }, `"${desk.name}" ${on ? "selected" : "removed"}`);
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

  const VIEWS: Array<{ key: View; label: string }> = [
    { key: "selected", label: `Selected (${selectedIds.length})` },
    { key: "attention", label: `Needs attention (${needsAttention.length})` },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Help desks</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Configure escalation behavior and select which help desks this
        assistant can recommend.
      </p>

      <h2 className="mt-8 text-xl font-semibold">
        Escalation behavior for this assistant
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
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
            description="Check the box below to disable the 'contact support' button that is always floating at the bottom of the chat screen."
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
            onChange={(e) => onButtonLabelChange(e.target.value)}
            onBlur={onButtonLabelBlur}
            disabled={!canEdit}
            className="mt-2 h-11"
          />
        </div>
      </Card>

      <div className="my-8 border-t" />

      <h2 className="text-xl font-semibold">Select help desks</h2>
      <p className="text-muted-foreground mt-1 text-sm">
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
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground ml-auto rounded-full border px-3 py-1 text-xs font-semibold">
            {selectedIds.length} selected
          </span>
        </div>

        <div className="relative mt-4">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search help desks"
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
                  <p className="text-base font-semibold">{desk.name}</p>
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
    </div>
  );
}
