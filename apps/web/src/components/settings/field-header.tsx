import type { ReactNode } from "react";
import { Label } from "@agent-hub/ui";

/** A field label and hint. Associate the hint using `${htmlFor}-hint`. */
export function FieldHeader({ title, hint, htmlFor }: {
  title: string;
  hint?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div data-slot="field-header" className="space-y-1">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="leading-5">{title}</Label>
      ) : (
        <p className="text-sm font-medium leading-5">{title}</p>
      )}
      {hint && (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
