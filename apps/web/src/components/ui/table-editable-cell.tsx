"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { TableCell } from "./table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const editorClassName = "w-full min-w-0 rounded-md border border-ring bg-table-sheet px-2 py-1 text-sm text-foreground outline-none ring-1 ring-ring";

export interface TableCellEditor<T extends string = string> {
  value: T;
  label: string;
  onSave: (next: T) => void | Promise<unknown>;
  options?: readonly { value: T; label: string }[];
  maxLength?: number;
  multiline?: boolean;
}

/** A cell opens on double-click or Enter/F2. All saves use the owning domain action. */
export function TableEditableCell<T extends string>({ editor, children, ...props }: Omit<ComponentProps<typeof TableCell>, "onEdit"> & { editor?: TableCellEditor<T>; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const finishing = useRef(false);
  useEffect(() => {
    if (editing && !editor?.options) { input.current?.focus(); input.current?.select(); }
  }, [editing, editor?.options]);
  function begin() {
    if (!editor || saving) return;
    finishing.current = false;
    setDraft(editor.value);
    setEditing(true);
  }
  async function save(next: T) {
    if (!editor || finishing.current) return;
    if (next === editor.value) { setEditing(false); return; }
    finishing.current = true;
    setSaving(true);
    try {
      await editor.onSave(next);
      setEditing(false);
    } catch (error) {
      finishing.current = false;
      toast.error(error instanceof Error ? error.message : "Could not save this change");
      input.current?.focus();
    } finally { setSaving(false); }
  }
  const textProps = {
    value: draft, disabled: saving, maxLength: editor?.maxLength,
    "aria-label": editor?.label,
    className: editorClassName,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => { if (!finishing.current) void save(draft as T); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") { event.stopPropagation(); finishing.current = true; setEditing(false); event.currentTarget.closest("td")?.focus(); }
      else if (event.key === "Enter" && (!editor?.multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); void save(draft as T); }
    },
  };
  return <TableCell {...props} onEdit={editor ? begin : undefined} data-cell-editing={editing || undefined} aria-busy={saving || undefined}>
    {editing && editor ? editor.options ? (
      <DropdownMenu open onOpenChange={(open) => { if (!open && !saving) setEditing(false); }}>
        <DropdownMenuTrigger render={<button type="button" aria-label={editor.label} className="text-left outline-none" />}>
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-44 rounded-2xl bg-table-sheet p-2" align="start">
          {editor.options.map((option) => <DropdownMenuItem key={option.value} disabled={saving}
            className="rounded-lg px-3 py-2.5" data-table-option-current={option.value === editor.value || undefined}
            onClick={() => void save(option.value)}>{option.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : editor.multiline ? <textarea {...textProps} ref={(node) => { input.current = node; }} rows={3} />
      : <><span aria-hidden="true" className="pointer-events-none invisible">{children}</span>
        <input {...textProps} className={cn(editorClassName, "absolute inset-x-3 inset-y-1 h-[calc(100%_-_0.5rem)] w-[calc(100%_-_1.5rem)]")} ref={(node) => { input.current = node; }} /></> : children}
  </TableCell>;
}

export type TableCategoryTone = "purple" | "blue" | "gray" | "green" | "pink";
export function TableCategory({ tone, children }: { tone: TableCategoryTone; children: ReactNode }) {
  return <span data-slot="table-category" data-tone={tone} className="inline-flex max-w-full items-center rounded-lg border px-2.5 py-1 text-sm font-medium"><span className="truncate">{children}</span></span>;
}
