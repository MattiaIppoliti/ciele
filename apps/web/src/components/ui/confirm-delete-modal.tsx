"use client";

import { type ReactNode, useCallback, useState, useTransition } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { toast } from "@/lib/toast";
import { Button } from "@agent-hub/ui";

/**
 * The warning step of the assistant/member delete modal on its own, for
 * destructive actions that do not warrant a type-to-confirm gate. Same panel,
 * same icon, same button pair, so a small delete never falls back to
 * `window.confirm`, which renders the browser's chrome instead of ours.
 */
export function ConfirmDeleteModal({
  open,
  title,
  description,
  confirmLabel = "Delete",
  secondaryLabel,
  pending = false,
  onConfirm,
  onSecondary,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  /** Second, further-reaching choice (e.g. delete for the whole org). */
  secondaryLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onSecondary?: () => void;
  onClose: () => void;
}) {
  function close() {
    if (pending) return;
    onClose();
  }

  return (
    <MorphingModal
      viewId={open ? "warning" : null}
      onClose={close}
      placement="bottom"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="bg-destructive/10 text-destructive rounded-full p-2">
            <AnimatedIcon icon={TriangleAlert} size={20} />
          </div>
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          {/* The wider-reaching choice sits apart from the default one, and
              never wears the primary style: picking it has to be deliberate. */}
          {secondaryLabel && onSecondary && (
            <Button variant="outline" onClick={onSecondary} disabled={pending}>
              {secondaryLabel}
            </Button>
          )}
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </MorphingModal>
  );
}

export interface ConfirmDeleteRequest {
  title: ReactNode;
  description: ReactNode;
  /** Label on the destructive button. Defaults to "Delete". */
  confirmLabel?: string;
  /** Runs once the admin confirms; awaited, so the button can show progress. */
  onConfirm: () => void | Promise<void>;
  /**
   * An optional further-reaching alternative, offered beside the default one
   * (the assistant editor's "delete for the whole organization" next to
   * "remove from this assistant"). Both share this hook's pending state and
   * error toast.
   */
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
}

/** A server action's `redirect()` surfaces as a throw the router must see. */
function isRedirectError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * Imperative wrapper: `confirmDelete({...})` where a `window.confirm` used to
 * gate the call, and render `confirmDeleteModal` once in the component. A
 * rejected `onConfirm` becomes a toast instead of the dev error overlay.
 */
export function useConfirmDelete() {
  const [request, setRequest] = useState<ConfirmDeleteRequest | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmDelete = useCallback(
    (next: ConfirmDeleteRequest) => setRequest(next),
    [],
  );

  function run(choice: "primary" | "secondary" = "primary") {
    if (!request || pending) return;
    const act =
      choice === "secondary" ? request.onSecondary : request.onConfirm;
    if (!act) return;
    startTransition(async () => {
      try {
        await act();
        setRequest(null);
      } catch (error) {
        if (isRedirectError(error)) throw error;
        setRequest(null);
        toast.error(
          error instanceof Error ? error.message : "The action failed",
        );
      }
    });
  }

  const confirmDeleteModal = (
    <ConfirmDeleteModal
      open={request !== null}
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      confirmLabel={request?.confirmLabel}
      secondaryLabel={request?.secondaryLabel}
      pending={pending}
      onConfirm={() => run("primary")}
      onSecondary={request?.onSecondary ? () => run("secondary") : undefined}
      onClose={() => setRequest(null)}
    />
  );

  return { confirmDelete, confirmDeleteModal };
}
