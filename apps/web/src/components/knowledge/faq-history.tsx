"use client";
import { useEffect, useState, useTransition } from "react";
import type { FaqHistoryEntry } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { faqHistoryAction, restoreFaqVersionAction } from "@/app/(admin)/library/quality-actions";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export function FaqHistory({ sourceId, onRestored }: { sourceId: string; onRestored: (faq: { question: string; answer: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<FaqHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  useEffect(() => {
    if (!open) return;
    let active = true;
    void faqHistoryAction(sourceId).then(rows => { if (active) { setEntries(rows); setError(null); } }).catch(() => { if (active) setError("History could not be loaded"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, sourceId]);
  return <section className="space-y-3 rounded-lg border p-3">
    {confirmDeleteModal}
    <Button variant="outline" size="sm" aria-expanded={open} onClick={() => { if (!open) setLoading(true); setOpen(value => !value); }}>History</Button>
    {open && <div className="space-y-3">
      {loading && <p className="text-muted-foreground text-sm">Loading versions…</p>}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {!loading && !error && entries.length === 0 && <p className="text-muted-foreground text-sm">No previous versions. Edits keep up to 50 versions.</p>}
      {entries.map((entry, index) => <RollRow key={entry.id} index={index}><details className="space-y-2 rounded-md border p-3">
        <summary className="cursor-pointer text-sm"><RollInText text={`${entry.actor} · ${formatDateTime(entry.createdAt)}`} /></summary>
        <p className="text-sm font-medium">{entry.question}</p><p className="whitespace-pre-wrap text-sm">{entry.answer}</p>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => confirmDelete({ title: "Restore this FAQ version?", description: "This saves the selected text and keeps the current version in History. Unsaved edits in this dialog are replaced. The restored text needs a new review.", confirmLabel: "Restore version", onConfirm: () => new Promise<void>(resolve => startTransition(async () => {
          try {
            const restored = await restoreFaqVersionAction(sourceId, entry.id);
            onRestored({ question: restored.frontmatter.title ?? "", answer: restored.body });
            setEntries(await faqHistoryAction(sourceId));
            toast.success("FAQ version restored");
          } catch (failure) { toast.error(failure instanceof Error ? failure.message : "Could not restore the FAQ"); }
          finally { resolve(); }
        })) })}>Restore</Button>
      </details></RollRow>)}
    </div>}
  </section>;
}
