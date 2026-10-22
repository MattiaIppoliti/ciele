"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Copy,
  Download,
  Ellipsis,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  LayoutGrid,
  List,
  Pencil,
  Presentation,
  Search,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
  Skeleton,
} from "@agent-hub/ui";
import type { ProjectFile, Task } from "@agent-hub/core";
import { taskKey } from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { agoText } from "@/lib/work/work-format";
import {
  FILE_FILTERS,
  FILE_SORTS,
  fileKind,
  formatBytes,
  previewable,
  visibleFiles,
  type FileFilter,
  type FileKind,
  type FileSort,
} from "@/lib/work/files";
import {
  deleteProjectFileAction,
  finishProjectFileUploadAction,
  renameProjectFileAction,
  startProjectFileUploadAction,
  uploadProjectFileAction,
} from "@/app/work-actions";
import { useWorkDirectory } from "./work-directory";
import { BAR_BUTTON } from "./work-toolbar";
import { PillButton, Segmented, WorkAvatar, WorkBar } from "./work-ui";

/**
 * Project files and Task attachments (#1068), one record behind both: the
 * drawer's Attachments list and the Project's Files view. Uploads go from the
 * browser straight to the bucket on a signed URL the server issued after
 * checking the caller may add the file; downloads and previews go through
 * `/api/work-files/{id}`, which checks the caller may read it. A preview is a
 * fetched blob shown in an image or a frame, never a navigation to the file.
 * The grid lays files out as 180px cards: a 16:10 preview with an extension
 * badge, the name and its size and age beneath.
 */

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  other: FileIcon,
};

const fileUrl = (id: string) => `/api/work-files/${id}`;
/** A download without leaving the page: the route answers as an attachment. */
function download(file: Pick<ProjectFile, "id" | "name">) {
  const link = document.createElement("a");
  link.href = fileUrl(file.id);
  link.download = file.name;
  link.click();
}

const extension = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 5).toUpperCase() : "FILE");

/** Uploads files to a Project, or to one of its Tasks. */
export function useFileUpload({ projectId, taskId, onUploaded }: { projectId: string; taskId?: string; onUploaded: () => void }) {
  const [pending, setPending] = useState<string[]>([]);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setPending((current) => [...current, ...files.map((f) => f.name)]);
    let added = 0;
    for (const file of files) {
      try {
        const start = await startProjectFileUploadAction({ projectId, taskId, name: file.name, sizeBytes: file.size });
        if (!start.ok) {
          toast.error(`${file.name}: ${start.error}`);
          continue;
        }
        if (start.value.uploadUrl) {
          const put = await fetch(start.value.uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "content-type": start.value.ticket.contentType, "x-upsert": "false" },
          });
          if (!put.ok) {
            toast.error(`${file.name} did not upload. Try again.`);
            continue;
          }
          const done = await finishProjectFileUploadAction({
            ticket: start.value.ticket,
            projectId,
            taskId,
            name: file.name,
            sizeBytes: file.size,
          });
          if (!done.ok) toast.error(`${file.name}: ${done.error}`);
          else added += 1;
        } else {
          const form = new FormData();
          form.set("projectId", projectId);
          if (taskId) form.set("taskId", taskId);
          form.set("file", file);
          const done = await uploadProjectFileAction(form);
          if (!done.ok) toast.error(`${file.name}: ${done.error}`);
          else added += 1;
        }
      } finally {
        setPending((current) => {
          const next = [...current];
          next.splice(next.indexOf(file.name), 1);
          return next;
        });
      }
    }
    if (added) {
      toast.success(added === 1 ? "File added" : `${added} files added`);
      onUploaded();
    }
  };
  return { upload, pending };
}

/** A region that takes dropped files, with a dashed outline while something is over it. */
export function FileDropZone({
  onFiles,
  disabled,
  children,
  className,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  return (
    <div
      data-over={over || undefined}
      onDragOver={(event) => {
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (disabled || !carriesFiles(event)) return;
        event.preventDefault();
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
      className={cn("data-[over]:outline-ring/60 relative rounded-xl data-[over]:outline-2 data-[over]:outline-dashed", className)}
    >
      {children}
    </div>
  );
}

function PickFilesButton({ onFiles, label = "Upload", className }: { onFiles: (files: File[]) => void; label?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          onFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
      <PillButton className={cn(BAR_BUTTON, className)} onClick={() => input.current?.click()}>
        <Upload className="size-3.5" /> {label}
      </PillButton>
    </>
  );
}

/** A file's actions: preview, download, rename, copy link, delete. */
function FileMenu({
  file,
  editable,
  onPreview,
  onRename,
  onDelete,
  className,
}: {
  file: ProjectFile;
  editable: boolean;
  onPreview?: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`More for ${file.name}`}
            className={cn(
              "press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground data-[popup-open]:bg-alpha-light grid size-7 place-items-center rounded-md",
              className
            )}
          />
        }
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onPreview && (
          <DropdownMenuItem onClick={onPreview}>
            <Eye className="size-4" /> Preview
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => download(file)}>
          <Download className="size-4" /> Download
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(`${window.location.origin}${fileUrl(file.id)}`);
            toast.success("Link copied");
          }}
        >
          <Copy className="size-4" /> Copy link
        </DropdownMenuItem>
        {editable && (
          <>
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The rename, delete and preview dialogs a list of files shares. */
function useFileDialogs(onChanged: () => void) {
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [renaming, setRenaming] = useState<ProjectFile | null>(null);
  const [previewing, setPreviewing] = useState<ProjectFile | null>(null);
  const remove = (file: ProjectFile) =>
    confirmDelete({
      title: `Delete ${file.name}?`,
      description: "The file is removed from the project and from storage. This cannot be undone.",
      confirmLabel: "Delete file",
      onConfirm: async () => {
        const result = await deleteProjectFileAction(file.id);
        if (!result.ok) throw new Error(result.error);
        toast.success("File deleted");
        onChanged();
      },
    });
  const dialogs = (
    <>
      {confirmDeleteModal}
      {renaming && (
        <RenameFileDialog
          file={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={() => {
            setRenaming(null);
            onChanged();
          }}
        />
      )}
      {previewing && <FilePreviewDialog file={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
  return { remove, rename: setRenaming, preview: setPreviewing, dialogs };
}

function RenameFileDialog({ file, onClose, onRenamed }: { file: ProjectFile; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState(file.name);
  const [pending, setPending] = useState(false);
  const save = async () => {
    const next = name.trim();
    if (!next || next === file.name) return onClose();
    setPending(true);
    const result = await renameProjectFileAction(file.id, next);
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    onRenamed();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <Input autoFocus value={name} maxLength={255} onChange={(event) => setName(event.target.value)} aria-label="File name" />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** An image or a PDF, fetched and shown from a blob; anything else offers its download. */
function FilePreviewDialog({ file, onClose }: { file: ProjectFile; onClose: () => void }) {
  const kind = previewable(file);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!kind) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void fetch(fileUrl(file.id))
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: file.contentType }));
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.contentType, kind]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {!kind || failed ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {failed ? "This file could not be loaded." : "There is no preview for this kind of file."}
            </p>
          ) : !url ? (
            <Skeleton className="h-[60vh] w-full" />
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an optimisable asset
            <img src={url} alt={file.name} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
          ) : (
            <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-lg border" />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => download(file)}>
            <Download className="size-4" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A Task's attachments in its drawer: the list, an upload button, and the whole section as a drop zone. */
export function TaskAttachments({
  projectId,
  taskId,
  files,
  editable,
  onChanged,
}: {
  projectId: string;
  taskId: string;
  files: ProjectFile[];
  editable: boolean;
  onChanged: () => void;
}) {
  const dir = useWorkDirectory();
  const { upload, pending } = useFileUpload({ projectId, taskId, onUploaded: onChanged });
  const { remove, rename, preview, dialogs } = useFileDialogs(onChanged);
  return (
    <FileDropZone onFiles={(list) => void upload(list)} disabled={!editable}>
      <section aria-label="Attachments" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Attachments</h3>
          <span className="text-muted-foreground text-xs">{files.length}</span>
          <span className="flex-1" />
          {editable && <PickFilesButton onFiles={(list) => void upload(list)} label="Attach" />}
        </div>
        {files.length === 0 && pending.length === 0 ? (
          editable ? (
            <p className="border-alpha-medium text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
              Drop files here, or attach them. Up to 50 MB each.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">No attachments.</p>
          )
        ) : (
          <ul className="border-alpha-medium divide-alpha-medium divide-y overflow-hidden rounded-lg border">
            {files.map((file) => {
              const Icon = KIND_ICON[fileKind(file)];
              return (
                <li key={file.id} className="group/file hover:bg-alpha-lighter flex items-center gap-2.5 px-2.5 py-2">
                  <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  <button
                    type="button"
                    onClick={() => (previewable(file) ? preview(file) : download(file))}
                    className="press-text min-w-0 flex-1 truncate text-left text-sm"
                  >
                    {file.name}
                  </button>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatBytes(file.sizeBytes)}</span>
                  <WorkAvatar person={dir.person(file.uploadedBy)} size="xs" />
                  <FileMenu
                    file={file}
                    editable={editable}
                    onPreview={previewable(file) ? () => preview(file) : undefined}
                    onRename={() => rename(file)}
                    onDelete={() => remove(file)}
                    className="opacity-0 group-hover/file:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                  />
                </li>
              );
            })}
            {pending.map((name, i) => (
              <li key={`${name}-${i}`} className="text-muted-foreground flex items-center gap-2.5 px-2.5 py-2 text-sm" role="status">
                <Upload aria-hidden className="size-4 animate-pulse" /> Uploading {name}…
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialogs}
    </FileDropZone>
  );
}

/** The Project's Files view: every file, its own or a Task's, with search, filters, sort and two layouts. */
export function ProjectFilesView({
  projectId,
  files,
  tasks,
  editable,
  onOpenTask,
  onChanged,
}: {
  projectId: string;
  files: ProjectFile[];
  tasks: Task[];
  editable: boolean;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
}) {
  const dir = useWorkDirectory();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FileFilter>("all");
  const [sort, setSort] = useState<FileSort>("newest");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const { upload, pending } = useFileUpload({ projectId, onUploaded: onChanged });
  const { remove, rename, preview, dialogs } = useFileDialogs(onChanged);
  const byTask = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const project = dir.project(projectId);
  const keyOf = (file: ProjectFile) => {
    const task = file.taskId ? byTask.get(file.taskId) : null;
    return task && project ? taskKey(project.key, task.seq) : null;
  };
  const shown = visibleFiles(files, {
    query,
    filter,
    sort,
    taskText: (file) => {
      const task = file.taskId ? byTask.get(file.taskId) : null;
      return task ? `${keyOf(file)} ${task.title}` : "";
    },
  });

  const taskBadge = (file: ProjectFile) => {
    const key = keyOf(file);
    const task = file.taskId ? byTask.get(file.taskId) : undefined;
    return key && task ? (
      <Hint label={task.title}>
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="press-control bg-alpha-light text-muted-foreground hover:text-foreground inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 font-mono text-2xs"
        >
          {key}
        </button>
      </Hint>
    ) : null;
  };

  return (
    <FileDropZone onFiles={(list) => void upload(list)} disabled={!editable} className="flex h-full min-h-0 flex-col rounded-none">
      <WorkBar>
        <div className="relative mr-1 w-full max-w-56">
          <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="h-7 pl-7 text-xs md:text-xs"
          />
        </div>
        <Select compact value={filter} onValueChange={(value) => setFilter(value as FileFilter)}>
          <SelectTrigger size="sm" aria-label="File type" className="press-control h-7 w-auto min-w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select compact value={sort} onValueChange={(value) => setSort(value as FileSort)}>
          <SelectTrigger size="sm" aria-label="Sort files" className="press-control h-7 w-auto min-w-32 text-xs">
            <SelectValue>{(value) => `Sort: ${FILE_SORTS.find((option) => option.value === value)?.label ?? ""}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FILE_SORTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented
          label="Layout"
          className="ml-1"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "grid", label: "Grid", icon: LayoutGrid },
            { value: "list", label: "List", icon: List },
          ]}
        />
        <span className="flex-1" />
        {editable && <PickFilesButton onFiles={(list) => void upload(list)} className="text-foreground" />}
      </WorkBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3.5 pb-8">
        {pending.length > 0 && (
          <p className="text-muted-foreground mb-3 flex items-center gap-2 text-xs" role="status">
            <Upload aria-hidden className="size-3.5 animate-pulse" /> Uploading {pending.length === 1 ? pending[0] : `${pending.length} files`}…
          </p>
        )}
        {shown.length === 0 ? (
          <div className="border-alpha-medium text-muted-foreground grid place-items-center rounded-xl border border-dashed px-6 py-16 text-center text-sm">
            {files.length === 0
              ? editable
                ? "No files yet. Drop files anywhere here, or upload them. Up to 50 MB each."
                : "No files yet."
              : "No files match."}
          </div>
        ) : layout === "grid" ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {shown.map((file) => (
              <li key={file.id} className="group/card bg-content border-alpha-medium hover:border-alpha-strong relative overflow-hidden rounded-xl border transition-colors">
                <button
                  type="button"
                  onClick={() => (previewable(file) ? preview(file) : download(file))}
                  className="bg-alpha-lighter relative grid aspect-[16/10] w-full place-items-center overflow-hidden"
                  aria-label={`Open ${file.name}`}
                >
                  {fileKind(file) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private route's bytes, not an optimisable asset
                    <img src={fileUrl(file.id)} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    (() => {
                      const Icon = KIND_ICON[fileKind(file)];
                      return <Icon aria-hidden className="text-muted-foreground size-8" />;
                    })()
                  )}
                  <span className="bg-content/90 text-muted-foreground absolute right-2 bottom-2 rounded px-1.25 py-0.5 font-mono text-2xs">
                    {extension(file.name)}
                  </span>
                </button>
                <div className="flex flex-col gap-0.5 px-2.5 py-2.25">
                  <span className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5 text-2xs">
                    {formatBytes(file.sizeBytes)} · {agoText(file.createdAt)}
                    <span className="flex-1" />
                    {taskBadge(file)}
                  </span>
                </div>
                <FileMenu
                  file={file}
                  editable={editable}
                  onPreview={previewable(file) ? () => preview(file) : undefined}
                  onRename={() => rename(file)}
                  onDelete={() => remove(file)}
                  className="bg-content/90 absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="border-alpha-medium divide-alpha-medium divide-y overflow-hidden rounded-xl border">
            {shown.map((file) => {
              const Icon = KIND_ICON[fileKind(file)];
              return (
                <li key={file.id} className="group/file hover:bg-alpha-lighter flex items-center gap-3 px-3 py-2">
                  <span className="bg-alpha-light grid size-7 shrink-0 place-items-center rounded-md">
                    <Icon aria-hidden className="text-muted-foreground size-4" />
                  </span>
                  <button
                    type="button"
                    onClick={() => (previewable(file) ? preview(file) : download(file))}
                    className="press-text min-w-0 flex-1 truncate text-left text-sm"
                  >
                    {file.name}
                  </button>
                  {taskBadge(file)}
                  <span className="text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums">{formatBytes(file.sizeBytes)}</span>
                  <WorkAvatar person={dir.person(file.uploadedBy)} size="sm" />
                  <span className="text-muted-foreground hidden w-20 shrink-0 text-xs @2xl:inline">{agoText(file.createdAt)}</span>
                  <FileMenu
                    file={file}
                    editable={editable}
                    onPreview={previewable(file) ? () => preview(file) : undefined}
                    onRename={() => rename(file)}
                    onDelete={() => remove(file)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {dialogs}
    </FileDropZone>
  );
}
