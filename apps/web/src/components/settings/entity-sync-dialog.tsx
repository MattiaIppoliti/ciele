"use client";

import { useEffect, useState, useTransition } from "react";
import type { Entity } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  getEntitySyncStatusAction,
  saveEntitySyncConfigAction,
  syncEntityNowAction,
  type EntitySyncStatus,
} from "@/app/actions";
import { formatDateTime } from "@/lib/format";

export function EntitySyncDialog({
  entity,
  open,
  onClose,
}: {
  entity: Entity;
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<EntitySyncStatus | null>(null);
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [mappingText, setMappingText] = useState("");
  // Text, not a number: clearing the field to type a new value used to snap
  // it straight back to 24. Parsed and checked on save.
  const [cadenceText, setCadenceText] = useState("24");
  const [prune, setPrune] = useState(false);
  const [clearHeaders, setClearHeaders] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    getEntitySyncStatusAction(entity.id)
      .then((next) => {
        setStatus(next);
        if (!next.config) return;
        setUrl(next.config.url);
        setCadenceText(String(next.config.cadenceHours));
        setPrune(next.config.prune);
        setMappingText(
          Object.entries(next.config.mapping)
            .map(([field, attribute]) => `${field} -> ${attribute}`)
            .join("\n")
        );
      })
      .catch(() => toast.error("Could not load the sync settings"));
  }, [open, entity.id]);

  const parsedMapping = () => {
    const mapping: Record<string, string> = {};
    for (const line of mappingText.split("\n")) {
      const [field, attribute] = line.split("->").map((part) => part.trim());
      if (field && attribute) mapping[field] = attribute;
    }
    return mapping;
  };

  const parsedHeaders = () =>
    headersText
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        return separator < 1
          ? null
          : {
              name: line.slice(0, separator).trim(),
              value: line.slice(separator + 1).trim(),
            };
      })
      .filter((header): header is { name: string; value: string } => Boolean(header?.name));

  // Until the stored config arrives the fields hold defaults, and saving them
  // would overwrite it.
  const loading = status === null;

  const save = () => {
    const cadenceHours = Number(cadenceText.trim());
    if (!Number.isInteger(cadenceHours) || cadenceHours < 1) {
      toast.error("Enter the interval as a whole number of hours, 1 or more");
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveEntitySyncConfigAction(entity.id, {
          url,
          headers: parsedHeaders(),
          clearHeaders,
          cadenceHours,
          prune,
          mapping: parsedMapping(),
        });
        if (result.error) toast.error(result.error);
        else toast.success("Sync source saved");
      } catch {
        toast.error("Could not save the sync source");
      }
    });
  };

  const syncNow = () =>
    startTransition(async () => {
      try {
        await syncEntityNowAction(entity.id);
        toast.success("Sync started, check back for the run report");
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Could not start the sync",
        );
      }
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync “{entity.name}”</DialogTitle>
          <DialogDescription>
            Pull records from REST/JSON on a schedule. Rows upsert by “{entity.keyAttribute}”.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sync-url">Endpoint URL</Label>
            <Input id="sync-url" disabled={loading} type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/orders" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sync-headers">Auth headers, one name: value per line{status?.config?.hasHeaders ? "; blank keeps current headers" : ""}</Label>
            <Textarea id="sync-headers" disabled={loading} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" rows={2} value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder="authorization: Bearer …" />
            {status?.config?.hasHeaders && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={clearHeaders} onCheckedChange={(value) => setClearHeaders(value === true)} />
                Remove stored headers on save
              </label>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sync-mapping">Field mapping: jsonField -&gt; attributeKey, one per line</Label>
            <Textarea id="sync-mapping" disabled={loading} spellCheck={false} rows={2} value={mappingText} onChange={(event) => setMappingText(event.target.value)} placeholder={`orderNumber -> ${entity.keyAttribute}`} />
          </div>
          <div className="flex items-center gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="sync-cadence">Every (hours)</Label>
              <Input id="sync-cadence" disabled={loading} type="number" inputMode="numeric" min={1} step={1} autoComplete="off" className="w-24" value={cadenceText} onChange={(event) => setCadenceText(event.target.value)} />
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm">
              <Checkbox disabled={loading} checked={prune} onCheckedChange={(value) => setPrune(value === true)} />
              Remove records missing from the source
            </label>
          </div>
          {status && status.runs.length > 0 && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">Recent runs</p>
              <ul className="mt-1 grid gap-1">
                {status.runs.map((run) => (
                  <li key={run.id} className="text-muted-foreground break-words">
                    {formatDateTime(run.finishedAt)}, {run.status === "succeeded"
                      ? `${run.upserted} upserted${run.pruned ? `, ${run.pruned} pruned` : ""}${run.rejected.length ? `, ${run.rejected.length} rejected` : ""}`
                      : `failed: ${run.error}`}
                    {run.rejected.slice(0, 3).map((reason) => <span key={reason} className="block pl-3">· {reason}</span>)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="outline" disabled={isPending || !status?.config} onClick={syncNow}>Sync now</Button>
          <Button onClick={save} disabled={isPending || loading || !url.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
