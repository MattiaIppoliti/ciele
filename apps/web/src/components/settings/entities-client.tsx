"use client";

import { useState } from "react";
import type { Entity } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { Badge, Button, Card } from "@agent-hub/ui";
import { deleteEntityAction } from "@/app/actions";
import {
  CreateEntityDialog,
  EditEntityDialog,
} from "./entity-form-dialogs";
import { EntityImportDialog } from "./entity-import-dialog";
import { EntityRecordsDialog } from "./entity-records-dialog";
import { EntitySyncDialog } from "./entity-sync-dialog";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";

type EntityWithCount = Entity & { recordCount: number };

export function EntitiesClient({
  entities,
  canEdit,
}: {
  entities: EntityWithCount[];
  canEdit: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold"><RollInText text="Data" /></h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Structured business data, imported from CSV or synced from a REST API.
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
  const [importOpen, setImportOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const remove = () =>
    confirmDelete({
      title: `Delete “${entity.name}”?`,
      description: `This deletes the entity and all ${entity.recordCount} of its records. Assistants that read it stop finding them. This cannot be undone.`,
      confirmLabel: "Delete entity",
      onConfirm: async () => {
        try {
          await deleteEntityAction(entity.id);
        } catch {
          throw new Error("Couldn't delete the entity. Please try again.");
        }
        toast.success(`Deleted “${entity.name}” and its records.`);
      },
    });

  return (
    <Card size="sm" className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 font-medium break-words">{entity.name}</h2>
            <Badge variant="secondary">{entity.scope === "user" ? "User-scoped" : "Shared"}</Badge>
            <Badge variant="secondary">
              <RollingNumber value={entity.recordCount} /> record{entity.recordCount === 1 ? "" : "s"}
            </Badge>
          </div>
          {entity.description && <p className="text-muted-foreground mt-1 text-sm break-words">{entity.description}</p>}
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
                variant="ghost"
                size="sm"
                onClick={remove}
                aria-label={`Delete ${entity.name}`}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <EntityImportDialog
        entity={entity}
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <EntityRecordsDialog
        entity={entity}
        open={recordsOpen}
        onClose={() => setRecordsOpen(false)}
      />
      <EditEntityDialog
        entity={entity}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <EntitySyncDialog
        entity={entity}
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
      />
      {confirmDeleteModal}
    </Card>
  );
}
