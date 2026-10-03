import { MAX_ATTACHMENTS_PER_MESSAGE } from "@agent-hub/core";
import { checkAttachment } from "./attachment-policy";
import type { AttachmentReceipt } from "./attachments";

export type AttachmentEntry =
  | { state: "reading"; id: string; name: string }
  | { state: "ready"; id: string; name: string; chars: number; token: string }
  | { state: "failed"; id: string; name: string; message: string };

export type AttachmentUpload = (file: File) => Promise<
  ({ ok: true } & AttachmentReceipt) | { ok: false; message: string }
>;

/** Owns capacity and serial reads, including reads that outlive their conversation. */
export function createAttachmentSession() {
  let entries: readonly AttachmentEntry[] = [];
  let generation = 0;
  let nextId = 0;
  let tail = Promise.resolve();
  const listeners = new Set<() => void>();
  const snapshot = () => ({
    entries,
    tokens: entries.flatMap((entry) => entry.state === "ready" ? [entry.token] : []),
    busy: entries.some((entry) => entry.state === "reading"),
    full: entries.length >= MAX_ATTACHMENTS_PER_MESSAGE,
  });
  let state = snapshot();

  function publish(next: readonly AttachmentEntry[]) {
    entries = next;
    state = snapshot();
    for (const listener of listeners) listener();
  }

  async function read(file: File, id: string, started: number, upload: AttachmentUpload) {
    if (started !== generation || !entries.some((entry) => entry.id === id)) return;
    const result = await upload(file).catch(() => ({ ok: false, message: "That file could not be read." } satisfies { ok: false; message: string }));
    if (started !== generation || !entries.some((entry) => entry.id === id)) return;
    publish(entries.map((entry): AttachmentEntry => entry.id !== id ? entry : result.ok
      ? { state: "ready", id, name: result.name, chars: result.chars, token: result.token }
      : { state: "failed", id, name: file.name, message: result.message }));
  }

  function attachAll(files: ArrayLike<File> | null | undefined, upload: AttachmentUpload): Promise<void> {
    const started = generation;
    const jobs: Array<{ file: File; id: string }> = [];
    const added = Array.from(files ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE - entries.length).map((file): AttachmentEntry => {
      const id = `a${nextId++}`;
      const check = checkAttachment(file);
      if (!check.ok) return { state: "failed", id, name: file.name, message: check.reason };
      jobs.push({ file, id });
      return { state: "reading", id, name: file.name };
    });
    // Reserve every slot before yielding, so another pick sees the actual cap.
    if (added.length) publish([...entries, ...added]);
    for (const { file, id } of jobs) tail = tail.then(() => read(file, id, started, upload));
    return tail;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachAll,
    attach: (file: File, upload: AttachmentUpload) => attachAll([file], upload),
    remove: (id: string) => publish(entries.filter((entry) => entry.id !== id)),
    clear() {
      generation++;
      publish([]);
    },
  };
}
