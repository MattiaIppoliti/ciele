"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Entity } from "@agent-hub/core";
import { toast } from "sonner";
import { Badge, Button, Card } from "@agent-hub/ui";
import { deleteEntityAction } from "@/app/actions";
import {
  CreateEntityDialog,
  EditEntityDialog,
} from "./entity-form-dialogs";
import { EntityImportDialog } from "./entity-import-dialog";
import { EntityRecordsDialog } from "./entity-records-dialog";
import { EntitySyncDialog } from "./entity-sync-dialog";

type EntityWithCount = Entity & { recordCount: number };

export function EntitiesClient({
  entities,
  canEdit,
}: {
  entities: EntityWithCount[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Data</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Entities describe structured business data through typed attributes
            over records imported from CSV or synchronized from REST/JSON.
          </p>
        </div>
        {canEdit && <Button onClick={() => setCreateOpen(true)}>New entity</Button>}
      </div>

      {entities.length === 0 ? (
        <Card size="sm" className="p-6">
          <p className="text-muted-foreground text-sm">
            No entities yet. Create one, then import or synchronize its records.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {entities.map((entity) => (
            <EntityCard key={entity.id} entity={entity} canEdit={canEdit} />
          ))}
        </div>
      )}

      <CreateEntityDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function EntityCard({
  entity,
  canEdit,
}: {
  entity: EntityWithCount;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [importOpen, setImportOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const closeAndRefresh = (close: (open: boolean) => void) => {
    close(false);
    router.refresh();
  };
  const remove = () =>
    startTransition(async () => {
      try {
        await deleteEntityAction(entity.id);
        toast.success(`Deleted “${entity.name}” and its records.`);
        router.refresh();
      } catch {
        toast.error("Couldn't delete the entity. Please try again.");
      }
    });

  return (
    <Card size="sm" className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{entity.name}</h2>
            <Badge variant="secondary">{entity.scope === "user" ? "User-scoped" : "Shared"}</Badge>
            <Badge variant="secondary">{entity.recordCount} record{entity.recordCount === 1 ? "" : "s"}</Badge>
          </div>
          {entity.description && <p className="text-muted-foreground mt-1 text-sm">{entity.description}</p>}
          <p className="text-muted-foreground mt-1 text-xs">
            {entity.attributes.map((attribute) => `${attribute.key}${attribute.key === entity.keyAttribute ? " (key)" : ""}: ${attribute.type}`).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setRecordsOpen(true)}>Records</Button>
          {canEdit && (
            <>
              <Button size="sm" onClick={() => setImportOpen(true)}>Import CSV</Button>
              <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}>Sync</Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
              <Button
                variant={confirmDelete ? "destructive" : "ghost"}
                size="sm"
                disabled={isPending}
                onClick={confirmDelete ? remove : () => setConfirmDelete(true)}
              >
                {confirmDelete ? "Really delete?" : "Delete"}
              </Button>
            </>
          )}
        </div>
      </div>

      <EntityImportDialog entity={entity} open={importOpen} onClose={() => closeAndRefresh(setImportOpen)} />
      <EntityRecordsDialog entity={entity} open={recordsOpen} onClose={() => setRecordsOpen(false)} />
      <EditEntityDialog entity={entity} open={editOpen} onClose={() => closeAndRefresh(setEditOpen)} />
      <EntitySyncDialog entity={entity} open={syncOpen} onClose={() => closeAndRefresh(setSyncOpen)} />
    </Card>
  );
}
