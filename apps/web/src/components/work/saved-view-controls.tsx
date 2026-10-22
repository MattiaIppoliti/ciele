"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Ellipsis, Pencil, Save, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import type { SavedView, WorkLayout, WorkViewQuery } from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from "@/app/work-actions";
import { useWorkDirectory } from "./work-directory";
import { BAR_BUTTON } from "./work-toolbar";
import { PillButton, SwatchRadioGroup } from "./work-ui";

/**
 * Saved Views (#1050): "Save view" turns the current filters, sort and group
 * into a tab every Member who can see the Project gets. Its creator or an
 * Admin renames, updates or deletes it.
 */

const LAYOUTS: { value: WorkLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
];

export function SaveViewButton({ projectId, query, layout }: { projectId: string; query: WorkViewQuery; layout: WorkLayout }) {
  const dir = useWorkDirectory();
  const [open, setOpen] = useState(false);
  if (!dir.canEdit) return null;
  return (
    <>
      <PillButton className={BAR_BUTTON} onClick={() => setOpen(true)}>
        <BookmarkPlus className="size-3.5" /> Save view
      </PillButton>
      {open && <SavedViewDialog open={open} onClose={() => setOpen(false)} projectId={projectId} query={query} layout={layout} />}
    </>
  );
}

function SavedViewDialog({
  open,
  onClose,
  projectId,
  query,
  layout: initialLayout,
  view,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  query: WorkViewQuery;
  layout: WorkLayout;
  view?: SavedView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(view?.name ?? "");
  const [layout, setLayout] = useState<WorkLayout>(view?.layout ?? initialLayout);
  const filters = query.filters.length;
  const submit = () =>
    startTransition(async () => {
      const result = view
        ? await updateSavedViewAction(view.id, { name: name.trim(), layout })
        : await createSavedViewAction({ projectId, name: name.trim(), layout, query });
      if (!result.ok) return toast.error(result.error);
      toast.success(view ? "View renamed" : "View saved");
      onClose();
      if (!view) router.push(`/projects/${projectId}/views/${result.value.id}`);
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{view ? "Rename view" : "Save view"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) submit();
          }}
        >
          <DialogBody>
            <DialogSection>
              <div className="space-y-1.5">
                <Label htmlFor="view-name">Name</Label>
                <Input id="view-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Layout</Label>
                <SwatchRadioGroup
                  label="Layout"
                  value={layout}
                  onValueChange={setLayout}
                  itemClassName="hover:bg-alpha-light text-muted-foreground rounded-lg px-3 py-1.5 text-sm data-[checked]:bg-alpha-strong data-[checked]:text-foreground data-[checked]:font-medium"
                  options={LAYOUTS.map((option) => ({ value: option.value, label: option.label, content: option.label }))}
                />
              </div>
              {!view && (
                <p className="text-muted-foreground text-xs">
                  Saves {filters ? `${filters} filter${filters === 1 ? "" : "s"}` : "no filters"}, the sort and the grouping. Everyone who can see this project gets the tab.
                </p>
              )}
            </DialogSection>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {view ? "Save" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** On a Saved View's tab: update it to the current query, rename it or delete it. */
export function SavedViewMenu({
  view,
  query,
  canManage,
}: {
  view: SavedView;
  query: WorkViewQuery;
  canManage: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  if (!canManage) return null;
  const changed = JSON.stringify(query) !== JSON.stringify(view.query);
  return (
    <div className="flex items-center gap-1">
      {changed && (
        <PillButton
          className={cn(BAR_BUTTON, "text-foreground bg-alpha-light")}
          onClick={() =>
            startTransition(async () => {
              const result = await updateSavedViewAction(view.id, { query });
              if (!result.ok) return toast.error(result.error);
              toast.success("View updated");
            })
          }
        >
          <Save className="size-3.5" /> Update view
        </PillButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<PillButton className={BAR_BUTTON} aria-label={`${view.name} view menu`} />}>
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil className="size-4" /> Rename view
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              confirmDelete({
                title: `Delete “${view.name}”?`,
                description: "The tab goes for everyone. The tasks it showed are not touched.",
                onConfirm: async () => {
                  const result = await deleteSavedViewAction(view.id);
                  if (!result.ok) throw new Error(result.error);
                  router.push(`/projects/${view.projectId}/list`);
                },
              })
            }
          >
            <Trash2 className="size-4" /> Delete view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && (
        <SavedViewDialog open={renaming} onClose={() => setRenaming(false)} projectId={view.projectId} query={view.query} layout={view.layout} view={view} />
      )}
      {confirmDeleteModal}
    </div>
  );
}
