"use client";
// Adapted from beui.dev/components/blocks/file-upload

import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, RotateCcw, X } from "lucide-react";
import { AlertCircle, CheckCircle2, FileCode2, FileIcon, Loader2, UploadCloud } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type FileUploadStatus = "queued" | "uploading" | "success" | "error";
export type FileUploadItem = {
  id: string;
  name: string;
  size: number;
  type?: string;
  progress?: number;
  status?: FileUploadStatus;
  error?: string;
  file?: File;
};

export interface FileUploadProps {
  value: FileUploadItem[];
  onValueChange: (items: FileUploadItem[]) => void;
  onFilesAdded: (items: FileUploadItem[]) => void;
  onRetry: (item: FileUploadItem) => void;
  accept: string;
  title: string;
  description: string;
}

const ROW_TRANSITION = { duration: 0.22, ease: EASE_OUT } as const;
const FAST_TRANSITION = { duration: 0.16, ease: EASE_OUT } as const;

const STATUS_LABEL: Record<FileUploadStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  success: "Uploaded",
  error: "Failed",
};

const STATUS_TONE: Record<FileUploadStatus, string> = {
  queued: "text-muted-foreground",
  uploading: "text-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
};

function clampProgress(value: number | undefined, status: FileUploadStatus) {
  if (status === "success") return 100;
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[exponent]
  }`;
}

function fileKind(item: FileUploadItem) {
  const extension = item.name.includes(".")
    ? item.name.split(".").pop()
    : undefined;

  if (extension) return extension.toUpperCase();
  if (item.type) return item.type.split("/").pop()?.toUpperCase();
  return "FILE";
}

function fileIcon(item: FileUploadItem, className: string) {
  const extension = item.name.includes(".")
    ? item.name.split(".").pop()?.toLowerCase()
    : undefined;
  const type = item.type ?? "";

  if (type.startsWith("image/")) return <FileImage className={className} />;
  if (type.startsWith("video/")) return <FileVideo className={className} />;
  if (type.startsWith("audio/")) return <FileAudio className={className} />;
  if (
    type.includes("zip") ||
    type.includes("compressed") ||
    ["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")
  ) {
    return <FileArchive className={className} />;
  }
  if (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    ["csv", "xls", "xlsx"].includes(extension ?? "")
  ) {
    return <FileSpreadsheet className={className} />;
  }
  if (
    type.includes("pdf") ||
    type.startsWith("text/") ||
    ["pdf", "doc", "docx", "md", "txt"].includes(extension ?? "")
  ) {
    return <FileText className={className} />;
  }
  if (
    [
      "css",
      "html",
      "js",
      "jsx",
      "json",
      "mdx",
      "ts",
      "tsx",
      "xml",
      "yaml",
      "yml",
    ].includes(extension ?? "")
  ) {
    return <FileCode2 className={className} />;
  }

  return <FileIcon className={className} />;
}

function createFileUploadItem(file: File, index = 0): FileUploadItem {
  return {
    id: `${Date.now()}-${index}-${file.name}`,
    name: file.name,
    size: file.size,
    type: file.type,
    progress: 0,
    status: "uploading",
    file,
  };
}

function StatusIcon({
  status,
  reduce,
}: {
  status: FileUploadStatus;
  reduce: boolean;
}) {
  const iconClassName = "h-4 w-4";

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={
          reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }
        }
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        exit={
          reduce
            ? { opacity: 0 }
            : { opacity: 0, transform: "translateY(-4px)" }
        }
        transition={FAST_TRANSITION}
        className={cn("grid h-6 w-6 place-items-center", STATUS_TONE[status])}
      >
        {status === "success" ? (
          <CheckCircle2 className={iconClassName} />
        ) : status === "error" ? (
          <AlertCircle className={iconClassName} />
        ) : status === "uploading" ? (
          <Loader2
            className={cn(
              iconClassName,
              "animate-spin",
              reduce && "animate-none",
            )}
          />
        ) : (
          <FileIcon className={iconClassName} />
        )}
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </motion.span>
    </AnimatePresence>
  );
}

function FileUploadRow({
  item,
  onRemove,
  onRetry,
}: {
  item: FileUploadItem;
  onRemove: (item: FileUploadItem) => void;
  onRetry: (item: FileUploadItem) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const status = item.status ?? "queued";
  const progress = clampProgress(item.progress, status);
  const progressRatio = progress / 100;
  const showProgress = status === "uploading" || status === "success";

  return (
    <motion.li
      layout={!reduce}
      initial={
        reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }
      }
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={
        reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-6px)" }
      }
      transition={ROW_TRANSITION}
      className="relative overflow-hidden rounded-2xl border border-border bg-background p-3"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          {fileIcon(item, "h-5 w-5")}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {item.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {fileKind(item)} · {formatBytes(item.size)}
                {status === "error" && item.error ? ` · ${item.error}` : null}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <StatusIcon status={status} reduce={reduce} />
              {status === "error" ? (
                <button
                  type="button"
                  onClick={() => onRetry(item)}
                  aria-label={`Retry ${item.name}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item.name}`}
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {showProgress ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label={`${item.name} upload progress`}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  status === "success" ? "bg-emerald-500" : "bg-foreground",
                )}
                style={{
                  transformOrigin: "left",
                  transform: reduce ? `scaleX(${progressRatio})` : undefined,
                }}
                initial={false}
                animate={
                  reduce ? undefined : { transform: `scaleX(${progressRatio})` }
                }
                transition={{ duration: 0.28, ease: EASE_OUT }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

export function FileUpload({
  value: items,
  onValueChange: commit,
  onFilesAdded,
  onRetry,
  accept,
  title,
  description,
}: FileUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const reduce = useReducedMotion() ?? false;
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const added = files.map((file, index) => createFileUploadItem(file, index));
      commit([...items, ...added]);
      onFilesAdded(added);
    },
    [commit, items, onFilesAdded],
  );

  const removeItem = useCallback(
    (item: FileUploadItem) => {
      commit(items.filter((entry) => entry.id !== item.id));
    },
    [commit, items],
  );

  const retryItem = useCallback(
    (item: FileUploadItem) => {
      const retryingItem = {
        ...item,
        error: undefined,
        progress: 0,
        status: "uploading" as const,
      };

      commit(
        items.map((entry) => (entry.id === item.id ? retryingItem : entry)),
      );
      onRetry(retryingItem);
    },
    [commit, items, onRetry],
  );

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setDragging(false);
  }, []);

  return (
    <div className="w-full space-y-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        aria-label="Upload files"
        accept={accept}
        multiple
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />

      <button
        type="button"
        data-dragging={dragging}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          resetDrag();
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "group relative flex w-full overflow-hidden rounded-3xl border border-dashed border-border bg-background outline-none",
          "transition-[border-color,transform] duration-200 active:scale-[0.99]",
          "hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "data-[dragging=true]:border-foreground",
          "disabled:pointer-events-none disabled:opacity-55",
          "min-h-56 flex-col items-center justify-center gap-3 p-7 text-center",
        )}
      >
        <motion.span
          aria-hidden="true"
          className="grid shrink-0 place-items-center bg-muted text-foreground h-16 w-16 rounded-[1.35rem] border border-border"
          animate={
            reduce
              ? undefined
              : {
                  transform: dragging ? "translateY(-2px)" : "translateY(0px)",
                }
          }
          transition={FAST_TRANSITION}
        >
          <UploadCloud className="h-7 w-7" />
        </motion.span>

        <span className="min-w-0 max-w-xs">
          <span className="block font-semibold text-foreground text-base">
            {title}
          </span>
          <span className="block text-xs text-muted-foreground mt-1 leading-5">
            {description}
          </span>
        </span>

        <span className="shrink-0 rounded-full border border-border text-xs font-medium text-foreground transition-colors duration-150 group-hover:bg-muted mt-1 px-4 py-2">
          Browse
        </span>
      </button>

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <FileUploadRow
              key={item.id}
              item={item}
              onRemove={removeItem}
              onRetry={retryItem}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
