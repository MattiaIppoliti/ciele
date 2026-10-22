import { z } from "zod";
import type { ProjectFile } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { recordActivity, requireReadableProject, requireWritableProject, requireWritableTask, taskSnapshot } from "./work-access";
import { workId as id } from "./work-schemas";

/**
 * Project files and Task attachments (#1049 decision 12, #1068).
 *
 * The bytes never pass through an operation: the console route uploads them
 * to the private `work-files` bucket and streams them back. What lives here is
 * every rule about them, so each route is an adapter: who may add, rename or
 * remove a file (the Project's writers), who may read one (its readers), where
 * the object goes (a key the operation chooses, never the caller), what type
 * it is served as (decided by its extension, never by the uploader), and that
 * deleting a file, a Task or a Project removes the objects too, through the
 * `workFiles` port.
 */

export const PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Content types by extension. The stored type is decided here because Storage
 * replays it on every fetch; anything not listed is kept, as a plain download.
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  fig: "application/octet-stream",
};

export function projectFileContentType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return name.includes(".") && Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext]! : "application/octet-stream";
}

/** A name safe as the last segment of an object key: no separators, no control characters. */
export function storageSafeName(name: string): string {
  const cleaned = [...name.normalize("NFKC")]
    // Control characters and both path separators go; everything else is kept for the next pass.
    .filter((char) => char.charCodeAt(0) > 0x1f && char !== "\u007f" && char !== "/" && char !== "\\")
    .join("")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(-120);
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : "file";
}

/** The object key a file gets: the Organization and Project in the path, the file's id before its name. */
export function projectFilePath(organizationId: string, projectId: string, fileId: string, name: string): string {
  return `org/${organizationId}/projects/${projectId}/${fileId}/${storageSafeName(name)}`;
}

const name = z.string().trim().min(1, "A file needs a name.").max(255);

const fileEntities = (projectId: string, taskId: string | null) => [
  { kind: "project" as const, id: projectId },
  ...(taskId ? [{ kind: "task" as const, id: taskId }] : []),
];

async function requireFile(ctx: OperationContext, fileId: string): Promise<ProjectFile> {
  const file = await ctx.db.table("projectFiles").get(fileId);
  if (!file || file.organizationId !== ctx.organizationId) throw new OperationError("not_found", "File not found");
  return file;
}

/** Removes objects through the host, best effort: a stray object is swept, a failed delete is not. */
export async function removeFileObjects(ctx: OperationContext, paths: string[]): Promise<void> {
  if (!paths.length || !ctx.ports?.workFiles) return;
  try {
    await ctx.ports.workFiles.remove(paths);
  } catch (error) {
    console.warn("[project-files] object removal failed", error);
  }
}

export const listProjectFilesOp = defineOperation({
  name: "files.list",
  capability: "member",
  effect: "read",
  input: z.object({ projectId: id, taskId: id.optional() }),
  entities: () => [],
  run: async (ctx, input): Promise<ProjectFile[]> => {
    const { project } = await requireReadableProject(ctx, input.projectId);
    return ctx.db
      .table("projectFiles")
      .list(input.taskId ? { projectId: project.id, taskId: input.taskId } : { projectId: project.id }, {
        orderBy: "createdAt",
        ascending: false,
      });
  },
});

/** One file, for its download: readable wherever its Project is. */
export const getProjectFileOp = defineOperation({
  name: "files.get",
  capability: "member",
  effect: "read",
  input: z.object({ id }),
  entities: () => [],
  run: async (ctx, input): Promise<ProjectFile> => {
    const file = await requireFile(ctx, input.id);
    await requireReadableProject(ctx, file.projectId);
    return file;
  },
});

/**
 * Step one of an upload: checks the caller may add this file here, and hands
 * back the id, object key and content type the bytes must be stored under.
 * Nothing is written, so a refused upload never reaches the bucket.
 */
export const prepareProjectFileOp = defineOperation({
  name: "files.prepare",
  capability: "edit",
  effect: "read",
  input: z.object({ projectId: id, taskId: id.optional(), name, sizeBytes: z.number().int().min(0) }),
  entities: () => [],
  run: async (ctx, input): Promise<{ id: string; storagePath: string; contentType: string }> => {
    if (input.sizeBytes === 0) throw new OperationError("invalid_input", "The file is empty.");
    if (input.sizeBytes > PROJECT_FILE_MAX_BYTES) {
      throw new OperationError("invalid_input", "That file is over the 50 MB limit.");
    }
    if (input.taskId) {
      const { task } = await requireWritableTask(ctx, input.taskId);
      if (task.projectId !== input.projectId) throw new OperationError("invalid_input", "That task is in another project.");
    } else {
      await requireWritableProject(ctx, input.projectId);
    }
    const fileId = crypto.randomUUID();
    return {
      id: fileId,
      storagePath: projectFilePath(ctx.organizationId, input.projectId, fileId, input.name),
      contentType: projectFileContentType(input.name),
    };
  },
});

/** Step two: records the stored file. The key must be the one step one chose. */
export const createProjectFileOp = defineOperation({
  name: "files.create",
  capability: "edit",
  effect: "write",
  input: z.object({
    id: z.string().uuid(),
    projectId: id,
    taskId: id.optional(),
    name,
    storagePath: z.string().min(1).max(600),
    sizeBytes: z.number().int().min(1).max(PROJECT_FILE_MAX_BYTES),
  }),
  entities: (input) => fileEntities(input.projectId, input.taskId ?? null),
  run: async (ctx, input): Promise<ProjectFile> => {
    const { project } = input.taskId
      ? await requireWritableTask(ctx, input.taskId)
      : await requireWritableProject(ctx, input.projectId);
    if (project.id !== input.projectId) throw new OperationError("invalid_input", "That task is in another project.");
    if (input.storagePath !== projectFilePath(ctx.organizationId, project.id, input.id, input.name)) {
      throw new OperationError("invalid_input", "That object key was not issued for this file.");
    }
    // The row gets its own id; the ticket's id only names the object's folder.
    const file = await ctx.db.table("projectFiles").insert({
      organizationId: ctx.organizationId,
      projectId: project.id,
      taskId: input.taskId ?? null,
      name: input.name,
      storagePath: input.storagePath,
      contentType: projectFileContentType(input.name),
      sizeBytes: input.sizeBytes,
      uploadedBy: ctx.userId || null,
    });
    if (input.taskId) {
      const task = await ctx.db.table("tasks").get(input.taskId);
      if (task) {
        await recordActivity(ctx, project.id, [
          { verb: "file.added", taskId: task.id, data: { ...taskSnapshot(task, project), fileName: file.name } },
        ]);
      }
    }
    return file;
  },
});

/**
 * The cleanup half of a refused step two: removes the object the upload left
 * behind. The key is recomputed from the ticket, never taken from the caller,
 * and an object a recorded file still names is never removed, so a failed
 * upload can only ever take its own stray with it.
 */
export const discardProjectFileUploadOp = defineOperation({
  name: "files.discard",
  capability: "edit",
  effect: "write",
  input: z.object({ id: z.string().uuid(), projectId: id, name }),
  entities: () => [],
  run: async (ctx, input): Promise<{ removed: boolean }> => {
    const { project } = await requireWritableProject(ctx, input.projectId, { allowArchived: true });
    const path = projectFilePath(ctx.organizationId, project.id, input.id, input.name);
    const files = await ctx.db.table("projectFiles").list({ projectId: project.id });
    if (files.some((file) => file.storagePath === path)) return { removed: false };
    await removeFileObjects(ctx, [path]);
    return { removed: true };
  },
});

export const renameProjectFileOp = defineOperation({
  name: "files.rename",
  capability: "edit",
  effect: "write",
  input: z.object({ id, name }),
  entities: (_input, result: ProjectFile) => fileEntities(result.projectId, result.taskId),
  run: async (ctx, input): Promise<ProjectFile> => {
    const file = await requireFile(ctx, input.id);
    await requireWritableProject(ctx, file.projectId);
    return ctx.db.table("projectFiles").update(file.id, { name: input.name });
  },
});

export const deleteProjectFileOp = defineOperation({
  name: "files.delete",
  capability: "edit",
  // The bytes go too, and there is no undo.
  effect: "consequential",
  input: z.object({ id }),
  entities: (_input, result: { projectId: string; taskId: string | null }) => fileEntities(result.projectId, result.taskId),
  run: async (ctx, input): Promise<{ deleted: true; projectId: string; taskId: string | null }> => {
    const file = await requireFile(ctx, input.id);
    const { project } = await requireWritableProject(ctx, file.projectId);
    await ctx.db.table("projectFiles").delete(file.id);
    await removeFileObjects(ctx, [file.storagePath]);
    if (file.taskId) {
      const task = await ctx.db.table("tasks").get(file.taskId);
      if (task) {
        await recordActivity(ctx, project.id, [
          { verb: "file.removed", taskId: task.id, data: { ...taskSnapshot(task, project), fileName: file.name } },
        ]);
      }
    }
    return { deleted: true, projectId: project.id, taskId: file.taskId };
  },
});
