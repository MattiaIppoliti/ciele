import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The `work-files` bucket (#1068): Project files and Task attachments.
 *
 * Private, written and read by the service role only, behind the operations
 * in `@ciele/ops` that decide every key and type (see `project-files.ts`).
 * With no object storage configured (the demo, a self-host without it) the
 * bytes live in this process's memory instead, so the Files view works
 * end to end and a restart forgets them, like the rest of the demo store.
 */
export const WORK_FILES_BUCKET = "work-files";

interface MemoryObject {
  bytes: Uint8Array;
  contentType: string;
}

// On globalThis so a dev reload keeps what was uploaded beside the mock rows.
const memory: Map<string, MemoryObject> = ((globalThis as { __cieleWorkFiles?: Map<string, MemoryObject> }).__cieleWorkFiles ??=
  new Map());

export async function putWorkFile(
  client: SupabaseClient | null,
  input: { path: string; bytes: ArrayBuffer; contentType: string }
): Promise<void> {
  if (!client) {
    memory.set(input.path, { bytes: new Uint8Array(input.bytes), contentType: input.contentType });
    return;
  }
  // The bytes, not the File: supabase-js sends a Blob with the Blob's own type
  // and ignores `contentType`, and the type here is the one the operation chose.
  const { error } = await client.storage.from(WORK_FILES_BUCKET).upload(input.path, input.bytes, {
    cacheControl: "0",
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw error;
}

/** Removes objects; one already gone is not an error. */
export async function removeWorkFiles(client: SupabaseClient | null, paths: string[]): Promise<void> {
  if (!paths.length) return;
  if (!client) {
    for (const path of paths) memory.delete(path);
    return;
  }
  const { error } = await client.storage.from(WORK_FILES_BUCKET).remove(paths);
  if (error) throw error;
}

/** The in-memory object, for the download route when there is no bucket. */
export function memoryWorkFile(path: string): MemoryObject | null {
  return memory.get(path) ?? null;
}
