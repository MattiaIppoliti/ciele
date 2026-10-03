import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@agent-hub/core";
import { createAttachmentSession } from "./attachment-session";

const file = (name = "notes.txt") => new File(["notes"], name);
const receipt = { ok: true, name: "notes.txt", chars: 5, token: "sealed" } as const;

describe("conversation attachments", () => {
  it("reserves capacity synchronously across overlapping picks and reads serially", async () => {
    let finish!: (value: typeof receipt) => void;
    const upload = vi.fn(() => new Promise<typeof receipt>((resolve) => { finish = resolve; }));
    const session = createAttachmentSession();
    const batches = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, () => session.attachAll([file()], upload));
    expect(session.getSnapshot().entries).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    await Promise.resolve();
    expect(upload).toHaveBeenCalledTimes(1);
    for (let i = 0; i < MAX_ATTACHMENTS_PER_MESSAGE; i++) {
      finish(receipt);
      await batches[i];
    }
    await Promise.all(batches);
    expect(upload).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(session.getSnapshot()).toMatchObject({ busy: false, full: true });
    expect(session.getSnapshot().tokens).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it("clear discards a late read and the rest of its batch", async () => {
    let finish!: (value: typeof receipt) => void;
    const upload = vi.fn(() => new Promise<typeof receipt>((resolve) => { finish = resolve; }));
    const session = createAttachmentSession();
    const batch = session.attachAll([file(), file("second.txt")], upload);
    await Promise.resolve();
    session.clear();
    finish(receipt);
    await batch;
    expect(session.getSnapshot()).toMatchObject({ entries: [], tokens: [], busy: false, full: false });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("removing a queued file skips its read and frees a slot", async () => {
    let finish!: (value: typeof receipt) => void;
    const upload = vi.fn(() => new Promise<typeof receipt>((resolve) => { finish = resolve; }));
    const session = createAttachmentSession();
    const batch = session.attachAll([file(), file("second.txt")], upload);
    await Promise.resolve();
    session.remove(session.getSnapshot().entries[1].id);
    finish(receipt);
    await batch;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().tokens).toEqual(["sealed"]);
  });

  it("keeps refusals visible and never reads an invalid file", async () => {
    const upload = vi.fn(async () => receipt);
    const session = createAttachmentSession();
    await session.attachAll([file("old.doc")], upload);
    expect(session.getSnapshot().entries[0]).toMatchObject({ state: "failed", name: "old.doc" });
    expect(upload).not.toHaveBeenCalled();
    session.clear();
    await session.attachAll([file()], upload);
    expect(session.getSnapshot().tokens).toEqual(["sealed"]);
  });
});
