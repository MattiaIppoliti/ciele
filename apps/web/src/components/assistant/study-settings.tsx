"use client";
import type { StudyModeSettings } from "@agent-hub/core";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import { STUDY_FORMATS } from "@/components/chat/study-menu";

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
  return (
    <section id="study-mode" className="scroll-mt-24 overflow-hidden rounded-2xl border">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <h3 className="font-semibold">Study Mode</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Let visitors practise your knowledge with up to 5 interactive
            questions.
          </p>
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
              Enable at least one format. Visitors can choose from a second
              button in the chat composer.
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
                    <p className="text-muted-foreground text-sm">
                      {item.description}
                    </p>
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
            <label htmlFor="study-instructions" className="text-sm font-medium">
              Custom instructions
            </label>
            <Textarea
              id="study-instructions"
              key={settings.instructions}
              defaultValue={settings.instructions}
              disabled={!canEdit}
              maxLength={10000}
              rows={4}
              placeholder="For example: focus on definitions and explain mistakes in simple language."
              onBlur={(event) => {
                if (event.target.value !== settings.instructions)
                  onChange({ instructions: event.target.value });
              }}
            />
            <p className="text-muted-foreground text-xs">
              Questions use the assistant’s knowledge. Changes apply to the live
              widget after publishing.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
