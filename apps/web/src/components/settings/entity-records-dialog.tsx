"use client";

import { useState } from "react";
import type { Entity, EntityRecord } from "@agent-hub/core";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { listEntityRecordsAction } from "@/app/actions";

export function EntityRecordsDialog({
  entity,
  open,
  onClose,
}: {
  entity: Entity;
  open: boolean;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<EntityRecord[] | null>(null);
  const [total, setTotal] = useState(0);

  const load = () => {
    setRecords(null);
    listEntityRecordsAction(entity.id, { limit: 50 })
      .then((result) => {
        setRecords(result.records);
        setTotal(result.total);
      })
      .catch(() => toast.error("Couldn't load records."));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => next ? load() : onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>“{entity.name}” records{total > 0 && ` (${total})`}</DialogTitle>
          <DialogDescription>{total > 50 ? "Showing the first 50, key-ordered." : "Key-ordered."}</DialogDescription>
        </DialogHeader>
        {records === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-muted-foreground text-sm">No records yet, import a CSV to fill this entity.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b">
                {entity.attributes.map((attribute) => (
                  <th key={attribute.key} className="px-2 py-1.5 font-medium">
                    {attribute.label}{attribute.key === entity.keyAttribute && " 🔑"}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b last:border-0">
                    {entity.attributes.map((attribute) => {
                      const value = record.values[attribute.key];
                      return <td key={attribute.key} className="px-2 py-1.5">{value == null ? "—" : String(value)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
