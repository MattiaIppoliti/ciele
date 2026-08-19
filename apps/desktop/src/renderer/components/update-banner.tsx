// "A newer version is out", a strip, dismissible, never a dialog (#690).
//
// The beta is unsigned, so it cannot update itself; the honest thing is to say
// a newer build exists and link it. Absent when the app is current, and absent
// when the check could not run at all.

import { Download, X } from "lucide-react";
import type { ReactNode } from "react";
import { bridge } from "../lib/bridge";
import type { UpdateNotice } from "../../shared/state";

export function UpdateBanner({ update }: { update: UpdateNotice }): ReactNode {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface-raised px-4 py-2 text-xs">
      <Download className="size-3.5 shrink-0 text-accent" />
      <span className="text-ink-muted">
        Ciele Desktop <span className="text-ink">{update.version}</span> is available.
      </span>
      <button
        type="button"
        className="font-medium text-accent underline-offset-2 hover:underline"
        onClick={() => void bridge().openExternal(update.url)}
      >
        Get it
      </button>
      <button
        type="button"
        aria-label="Dismiss update notice"
        className="ml-auto text-ink-muted hover:text-ink"
        onClick={() => void bridge().dismissUpdate()}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
