"use client";

import { useState, useTransition } from "react";
import type { Entity } from "@agent-hub/core";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@agent-hub/ui";
import {
  importEntityRecordsAction,
  type EntityImportReport,
} from "@/app/actions";

export function EntityImportDialog({
  entity,
  open,
  onClose,
}: {
  entity: Entity;
  open: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState("");
  const [report, setReport] = useState<EntityImportReport | null>(null);

  const runImport = () =>
    startTransition(async () => {
      try {
        const result = await importEntityRecordsAction(entity.id, csvText);
        setReport(result);
        if (result.upserted > 0) {
          toast.success(
            `Imported ${result.upserted} record${result.upserted === 1 ? "" : "s"}.`
          );
        }
      } catch {
        toast.error("Import failed. Please try again.");
      }
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import records into “{entity.name}”</DialogTitle>
          <DialogDescription>
            CSV headers should match {entity.attributes.map((attribute) => attribute.key).join(", ")}.
            Rows upsert by “{entity.keyAttribute}”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setCsvText(await file.text());
            }}
          />
          <textarea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            placeholder={`${entity.attributes.map((attribute) => attribute.key).join(",")}\n…`}
            className="border-input bg-background min-h-32 w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
          {report && (
            <div className="space-y-1 text-sm">
              <p>
                <strong>{report.upserted}</strong> record{report.upserted === 1 ? "" : "s"} imported
                {report.rejected.length > 0 && `, ${report.rejected.length} rejected`}.
              </p>
              {report.rejected.length > 0 && (
                <ul className="text-destructive max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
                  {report.rejected.map((reason, index) => <li key={index}>{reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={runImport} disabled={isPending || !csvText.trim()}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
