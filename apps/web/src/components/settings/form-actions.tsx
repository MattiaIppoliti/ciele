"use client";

import { type ReactElement, useEffect, useRef } from "react";
import { Button } from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";
import { useSetTopBarSlot } from "@/components/shell/top-bar-slots";
import { cn } from "@/lib/utils";

export interface FormActionsProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** "Save changes" unless the page says otherwise. */
  saveLabel?: string;
  /** Extra reasons Save must wait (an upload in flight, a read-only Member). */
  saveDisabled?: boolean;
  /** Cancel with nothing to cancel is inert, unless it also means "leave". */
  cancelAlwaysEnabled?: boolean;
  className?: string;
}

/**
 * Cancel and Save for a settings page drawn as a section timeline. The same
 * pair sits at the foot of the page and, through {@link useTopBarFormActions},
 * at the right of the top bar, so a long form can be saved from wherever the
 * reader stopped scrolling.
 */
function FormActions({
  dirty,
  saving,
  onSave,
  onCancel,
  saveLabel = "Save changes",
  saveDisabled = false,
  cancelAlwaysEnabled = false,
  className,
}: FormActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={saving || (!dirty && !cancelAlwaysEnabled)}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={onSave}
        disabled={saving || !dirty || saveDisabled}
        className="font-semibold"
      >
        <RollInText text={saving ? "Saving…" : saveLabel} />
      </Button>
    </div>
  );
}

/**
 * The Settings dialog's save bar, stuck to the foot of its scroller.
 *
 * Above the fields scrolling under it (`z-10`), or a select trigger paints over
 * the bar, and in the dialog's own colour rather than the workspace panel's,
 * which the dialog does not sit on. Stuck at minus the dialog scroller's bottom
 * padding (`py-6 sm:py-7`): a sticky edge stops at that padding, which left a
 * strip of scrolling text visible under the bar.
 */
export function SettingsSaveBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background sticky -bottom-6 z-10 -mx-2 flex items-center justify-end gap-3 border-t px-2 pt-4 pb-10 sm:-bottom-7 sm:pb-11">
      {children}
    </div>
  );
}

/**
 * Put the page's Cancel and Save in the top bar while it is mounted, and
 * return the same pair for the foot of the page (`className` styles only that
 * one).
 *
 * The handlers go through a ref: a page makes new functions on every render,
 * and registering those directly would redraw the top bar on every keystroke.
 * The node is re-registered only when what it shows changes.
 */
export function useTopBarFormActions(props: FormActionsProps): ReactElement {
  const setSlot = useSetTopBarSlot();
  const handlers = useRef({ onSave: props.onSave, onCancel: props.onCancel });
  useEffect(() => {
    handlers.current = { onSave: props.onSave, onCancel: props.onCancel };
  });
  const { dirty, saving, saveLabel, saveDisabled, cancelAlwaysEnabled } = props;
  useEffect(() => {
    setSlot(
      "form",
      <FormActions
        dirty={dirty}
        saving={saving}
        saveLabel={saveLabel}
        saveDisabled={saveDisabled}
        cancelAlwaysEnabled={cancelAlwaysEnabled}
        onSave={() => handlers.current.onSave()}
        onCancel={() => handlers.current.onCancel()}
      />
    );
  }, [dirty, saving, saveLabel, saveDisabled, cancelAlwaysEnabled, setSlot]);
  useEffect(() => () => setSlot("form", null), [setSlot]);
  return <FormActions {...props} />;
}
