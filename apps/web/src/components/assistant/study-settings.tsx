"use client";
import { useId, useState } from "react";
import type { StudyModeSettings } from "@agent-hub/core";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import { STUDY_FORMATS } from "@/components/chat/study-menu";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

export const DEFAULT_STUDY_SETTINGS: StudyModeSettings = {
  enabled: false,
  formats: ["multiple_choice", "drag_words", "true_false", "flashcards"],
  instructions: "",
};

export function StudySettings({
  settings = DEFAULT_STUDY_SETTINGS,
  canEdit,
  onChange,
}: {
  settings?: StudyModeSettings;
  canEdit: boolean;
  onChange: (settings: Partial<StudyModeSettings>) => void;
}) {
  const id = useId();
  // Controlled rather than remounted per saved value, so a save landing while
  // the admin types never throws away what they typed since.
  const [draft, setDraft] = useState(settings.instructions);
  const [saved, setSaved] = useState(settings.instructions);
  if (settings.instructions !== saved) {
    setSaved(settings.instructions);
    setDraft(settings.instructions);
  }
  const dirty = draft !== settings.instructions;

  // The field saves on blur, so closing the tab while it has focus would drop
  // the draft; the browser's own "Leave site?" prompt is the guard.
  useUnsavedChanges({ dirty });

  return (
    <section id="study-mode" className="scroll-mt-24 overflow-hidden rounded-2xl border">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <h3 className="font-semibold">Study Mode</h3>
          <p className="text-muted-foreground mt-1 text-sm">Up to 5 questions.</p>
        </div>
        <Switch
          aria-label="Enable Study Mode"
          checked={settings.enabled}
          disabled={!canEdit}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
      </div>
      {settings.enabled && (
        <>
          <div className="space-y-3 border-t p-5">
            <h4 className="font-medium">Question formats</h4>
            <p className="text-muted-foreground text-sm">
              Enable at least one format.
            </p>
            {STUDY_FORMATS.map((item) => {
              const checked = settings.formats.includes(item.value);
              return (
                <div
                  key={item.value}
                  className={`flex items-center justify-between gap-4 rounded-xl border p-4 ${checked ? "border-primary/20 bg-primary/5" : ""}`}
                >
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>

                  </div>
                  <Switch
                    aria-label={item.label}
                    checked={checked}
                    disabled={
                      !canEdit || (checked && settings.formats.length === 1)
                    }
                    onCheckedChange={(enabled) =>
                      onChange({
                        formats: enabled
                          ? [...settings.formats, item.value]
                          : settings.formats.filter(
                              (format) => format !== item.value,
                            ),
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="space-y-2 border-t p-5">
            <label htmlFor={`${id}-instructions`} className="text-sm font-medium">
              Custom instructions
            </label>
            <Textarea
              id={`${id}-instructions`}
              name="studyInstructions"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!canEdit}
              maxLength={10000}
              rows={4}
              placeholder="For example: focus on definitions and explain mistakes in simple language."
              onBlur={(event) => {
                if (event.target.value !== settings.instructions)
                  onChange({ instructions: event.target.value });
              }}
            />
            <p className="text-muted-foreground text-xs">Uses this assistant’s knowledge. Publish to update live chats.</p>
          </div>
        </>
      )}
    </section>
  );
}
