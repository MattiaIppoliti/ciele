import type { ProjectFile } from "@agent-hub/core";

/**
 * The Files view's rules (#1068), pure so they are tested: what kind a file
 * is, how its size reads, and how the view filters and sorts.
 */

export type FileKind = "image" | "pdf" | "document" | "spreadsheet" | "presentation" | "video" | "audio" | "archive" | "other";

export function fileKind(file: Pick<ProjectFile, "contentType" | "name">): FileKind {
  const type = file.contentType;
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/zip") return "archive";
  if (/spreadsheet|ms-excel|text\/csv/.test(type)) return "spreadsheet";
  if (/presentation|ms-powerpoint/.test(type)) return "presentation";
  if (/wordprocessing|msword|text\/plain|application\/json/.test(type)) return "document";
  return "other";
}

/** What the type filter offers: a few families, not every kind. */
export type FileFilter = "all" | "images" | "documents" | "pdfs" | "media" | "other";

export const FILE_FILTERS: { value: FileFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "images", label: "Images" },
  { value: "documents", label: "Documents" },
  { value: "pdfs", label: "PDFs" },
  { value: "media", label: "Video & audio" },
  { value: "other", label: "Other" },
];

const FILTER_KINDS: Record<Exclude<FileFilter, "all">, FileKind[]> = {
  images: ["image"],
  documents: ["document", "spreadsheet", "presentation"],
  pdfs: ["pdf"],
  media: ["video", "audio"],
  other: ["archive", "other"],
};

export type FileSort = "newest" | "oldest" | "name" | "size";

export const FILE_SORTS: { value: FileSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
];

/** "820 B", "14 KB", "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

/** The view's list: matched on the name (or the Task's key and title), filtered by family, sorted. */
export function visibleFiles<T extends Pick<ProjectFile, "name" | "contentType" | "sizeBytes" | "createdAt">>(
  files: readonly T[],
  { query, filter, sort, taskText }: { query: string; filter: FileFilter; sort: FileSort; taskText?: (file: T) => string }
): T[] {
  const q = query.trim().toLowerCase();
  const matched = files.filter((file) => {
    if (filter !== "all" && !FILTER_KINDS[filter].includes(fileKind(file))) return false;
    if (!q) return true;
    return file.name.toLowerCase().includes(q) || (taskText?.(file).toLowerCase().includes(q) ?? false);
  });
  const by: Record<FileSort, (a: T, b: T) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    size: (a, b) => b.sizeBytes - a.sizeBytes,
  };
  return [...matched].sort(by[sort]);
}

/** Whether the console previews a file in place: images by tag, PDFs in a frame, both from a fetched blob. */
export function previewable(file: Pick<ProjectFile, "contentType" | "name">): "image" | "pdf" | null {
  const kind = fileKind(file);
  return kind === "image" ? "image" : kind === "pdf" ? "pdf" : null;
}
