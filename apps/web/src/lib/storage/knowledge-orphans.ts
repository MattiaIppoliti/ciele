import type { SupabaseClient } from "@supabase/supabase-js";
import { KNOWLEDGE_ORIGINALS_BUCKET } from "@/lib/storage/assets";

/**
 * Removes knowledge originals no Source row points at any more.
 *
 * Deleting a Source now removes its file (the `removeKnowledgeOriginals` port),
 * but two cases are out of that path's reach: an Organization deleted whole,
 * whose cascade takes every row and no file, and every file orphaned before
 * that port existed. This sweep is the backstop for both, so an erased Source
 * does not leave its upload in the bucket for good.
 *
 * An upload writes the object before the Source row that names it, so a file
 * younger than `graceMs` is never touched: that is an upload in flight, not an
 * orphan. Bounded per tick by `maxRemovals`; the next tick continues.
 */
export interface KnowledgeOrphanSweepReport {
  knowledgeOrphansScannedOrgs: number;
  knowledgeOrphansRemoved: number;
}

const PAGE = 1000;
const REMOVE_CHUNK = 100;

export async function sweepOrphanedKnowledgeOriginals(
  client: SupabaseClient,
  options: { now?: Date; graceMs?: number; maxRemovals?: number } = {}
): Promise<KnowledgeOrphanSweepReport> {
  const now = (options.now ?? new Date()).getTime();
  const graceMs = options.graceMs ?? 24 * 60 * 60 * 1000;
  const maxRemovals = options.maxRemovals ?? 1000;
  const bucket = client.storage.from(KNOWLEDGE_ORIGINALS_BUCKET);

  const orgFolders: { name: string; id?: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list("org", { limit: PAGE, offset });
    if (error) throw error;
    orgFolders.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  let scannedOrgs = 0;
  let removed = 0;
  for (const folder of orgFolders) {
    if (removed >= maxRemovals) break;
    // Folders come back with no id; a stray file at this level is not ours.
    if (folder.id !== null && folder.id !== undefined) continue;
    scannedOrgs += 1;
    const prefix = `org/${folder.name}/knowledge`;

    const referenced = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("sources")
        .select("original_object_path")
        .like("original_object_path", `${prefix}/%`)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of (data ?? []) as { original_object_path: string | null }[]) {
        if (row.original_object_path) referenced.add(row.original_object_path);
      }
      if (!data || data.length < PAGE) break;
    }

    const orphans: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
      if (error) throw error;
      for (const file of data ?? []) {
        if (file.id === null || file.id === undefined) continue;
        const path = `${prefix}/${file.name}`;
        if (referenced.has(path)) continue;
        const created = Date.parse(file.created_at ?? "");
        if (!Number.isFinite(created) || now - created < graceMs) continue;
        orphans.push(path);
      }
      if (!data || data.length < PAGE) break;
    }

    for (let i = 0; i < orphans.length && removed < maxRemovals; i += REMOVE_CHUNK) {
      const chunk = orphans.slice(i, i + Math.min(REMOVE_CHUNK, maxRemovals - removed));
      const { error } = await bucket.remove(chunk);
      if (error) throw error;
      removed += chunk.length;
    }
  }

  return { knowledgeOrphansScannedOrgs: scannedOrgs, knowledgeOrphansRemoved: removed };
}
