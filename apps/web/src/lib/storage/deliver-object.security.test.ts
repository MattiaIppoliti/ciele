import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import type { ObjectAccessEventInput } from "@agent-hub/core";
import { deliverObject, recordObjectAccess } from "./deliver-object";

/**
 * #801, CYB-05. Issuing a signed URL is not evidence a download happened, so
 * the property under test is that a row lands when bytes actually move, that
 * it carries the count, and that the ledger can never be what breaks a
 * download.
 */

function ledgerDb(): { db: Db; rows: ObjectAccessEventInput[] } {
  const rows: ObjectAccessEventInput[] = [];
  return {
    rows,
    db: {
      recordObjectAccess: async (event: ObjectAccessEventInput) => {
        rows.push(event);
      },
    } as unknown as Db,
  };
}

function storageAnswering(signedUrl: string | null) {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          signedUrl
            ? { data: { signedUrl }, error: null }
            : { data: null, error: new Error("no such object") },
      }),
    },
  } as never;
}

const headers = () =>
  new Headers({
    "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    "user-agent": "Mozilla/5.0",
    "x-request-id": "req-42",
  });

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const base = (db: Db) => ({
  db,
  storage: storageAnswering("https://storage.example/signed"),
  bucket: "knowledge-originals",
  path: "org-1/handbook.pdf",
  actor: { organizationId: "org-1", kind: "member" as const, id: "user-1" },
  objectKind: "knowledge_original" as const,
  sourceId: "source-1",
  filename: "handbook.pdf",
  requestHeaders: headers(),
});

describe("deliverObject", () => {
  it("streams the object and records the bytes that actually moved", async () => {
    const { db, rows } = ledgerDb();
    const response = await deliverObject(base(db));

    expect(response?.status).toBe(200);
    // The count is only true once the stream has been drained, which is also
    // the only moment anyone can say a transfer completed.
    const bytes = new Uint8Array(await response!.arrayBuffer());
    expect(bytes.byteLength).toBe(1536);
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({
      organizationId: "org-1",
      actorKind: "member",
      actorId: "user-1",
      objectPath: "org-1/handbook.pdf",
      sourceId: "source-1",
      result: "served",
      bytes: 1536,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      requestId: "req-42",
    });
  });

  it("records the partial transfer as aborted, with the bytes that moved", async () => {
    // The case a transformer's `flush` never sees, and the one an access
    // ledger most wants: an interrupted download used to leave no row at all,
    // and then it left a `failed` row, which is the value for *our* side
    // breaking and the one value the bulk-download rule ignores. Fetching
    // 99% and cancelling has to land as a transfer (#801 review, CYB-05).
    const { db, rows } = ledgerDb();
    const response = await deliverObject(base(db));

    const reader = response!.body!.getReader();
    await reader.read();
    await reader.cancel("client went away");

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({ result: "aborted", bytes: 1024 });
  });

  it("does not copy a compressed length onto an inflated body", async () => {
    // `fetch` transparently inflates a gzip response, so replaying the
    // upstream content-length would truncate the download at the compressed
    // size.
    globalThis.fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2048));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-encoding": "gzip",
          "content-length": "700",
        },
      });
    }) as unknown as typeof fetch;
    const { db } = ledgerDb();

    const response = await deliverObject(base(db));
    expect(response?.headers.get("content-length")).toBeNull();
  });

  it("never lets the object render on this origin", async () => {
    const { db } = ledgerDb();
    const response = await deliverObject(base(db));
    expect(response?.headers.get("content-disposition")).toBe(
      'attachment; filename="handbook.pdf"'
    );
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("strips quotes and newlines from the offered filename", async () => {
    const { db } = ledgerDb();
    const response = await deliverObject({
      ...base(db),
      filename: 'evil".pdf\r\nX-Injected: 1',
    });
    expect(response?.headers.get("content-disposition")).toBe(
      'attachment; filename="evil.pdfX-Injected: 1"'
    );
  });

  it("records a failure and answers null when the object cannot be signed", async () => {
    const { db, rows } = ledgerDb();
    const response = await deliverObject({
      ...base(db),
      storage: storageAnswering(null),
    });

    expect(response).toBeNull();
    expect(rows).toEqual([expect.objectContaining({ result: "failed", bytes: null })]);
  });

  it("records a failure when the upstream fetch does not answer", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { db, rows } = ledgerDb();

    expect(await deliverObject(base(db))).toBeNull();
    expect(rows[0]).toMatchObject({ result: "failed" });
  });
});

describe("recordObjectAccess", () => {
  it("swallows a ledger failure rather than turning it into an outage", async () => {
    const failing = {
      recordObjectAccess: async () => {
        throw new Error("ledger unreachable");
      },
    } as unknown as Db;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordObjectAccess({
        db: failing,
        actor: { organizationId: "org-1", kind: "member", id: "user-1" },
        objectKind: "knowledge_original",
        path: "org-1/handbook.pdf",
        sourceId: null,
        requestHeaders: headers(),
        result: "refused",
      })
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
