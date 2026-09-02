import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));

const { extractSourceText } = vi.hoisted(() => ({ extractSourceText: vi.fn() }));
vi.mock("@agent-hub/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-hub/agent")>()),
  extractSourceText,
}));

import { requireMember } from "@/lib/authz";
import { resetUploadAllowance } from "@/lib/upload-limit";
import { uploadFileSourceAction, uploadOrgFileSourceAction } from "./actions";

/**
 * CYB-01. A document parser is an attack surface with its own CPU and memory
 * budget, so "is the upload refused" is the wrong question. The right one is
 * "is it refused before anything reads the bytes". These tests assert the
 * parser was never entered, which is the property a reordered `await` can
 * silently lose.
 */
describe("file upload authorization runs before parsing", () => {
  const requireMemberMock = vi.mocked(requireMember);
  let db: Db;

  function pdf(sizeBytes = 4096): File {
    // Content is irrelevant: the parser must never see it.
    return new File([new Uint8Array(sizeBytes)], "invoice.pdf", {
      type: "application/pdf",
    });
  }

  function form(file: File, extra: Record<string, string> = {}): FormData {
    const data = new FormData();
    data.set("file", file);
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  }

  beforeEach(() => {
    db = getMockDb();
    extractSourceText.mockReset();
    extractSourceText.mockResolvedValue({ name: "invoice.pdf", text: "parsed" });
    requireMemberMock.mockReset();
    resetUploadAllowance();
  });

  it("refuses an unauthorized assistant upload without invoking the parser", async () => {
    requireMemberMock.mockRejectedValue(new Error("Forbidden"));

    const result = await uploadFileSourceAction(
      form(pdf(), { assistantId: "a-1", collectionId: "c-1" }),
    );

    expect(result).toEqual({ error: "Forbidden" });
    expect(extractSourceText).not.toHaveBeenCalled();
  });

  it("refuses an unauthorized library upload without invoking the parser", async () => {
    requireMemberMock.mockRejectedValue(new Error("Forbidden"));

    const result = await uploadOrgFileSourceAction(
      form(pdf(), { assistantIds: JSON.stringify(["a-1"]) }),
    );

    expect(result).toEqual({ error: "Forbidden" });
    expect(extractSourceText).not.toHaveBeenCalled();
  });

  it("still parses once the caller is an authorized member", async () => {
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: { organization: DEMO_ORG, userId: "u-demo" },
    } as never);
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    const collection = await db.createCollection(assistant.id, { name: "C" });

    await uploadFileSourceAction(
      form(pdf(), { assistantId: assistant.id, collectionId: collection.id }),
    );

    expect(extractSourceText).toHaveBeenCalledTimes(1);
  });

  /**
   * The other half of CYB-01: authorization gates who may upload, the budget
   * gates how much parser CPU one member may spend. Past the window the action
   * refuses before `extractSourceText`, which is the same "parser never
   * entered" property as the anonymous case.
   */
  it("throttles an authorized member past the upload budget, before the parser", async () => {
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: { organization: DEMO_ORG, userId: "u-demo" },
    } as never);
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    const collection = await db.createCollection(assistant.id, { name: "C" });
    const upload = () =>
      uploadFileSourceAction(
        form(pdf(), { assistantId: assistant.id, collectionId: collection.id }),
      );

    for (let i = 0; i < 20; i += 1) expect(await upload()).toBeUndefined();
    const refused = await upload();

    expect(refused).toMatchObject({ error: expect.stringContaining("Too many uploads") });
    expect(extractSourceText).toHaveBeenCalledTimes(20);
    // The library door draws on the same window, not a fresh one.
    const viaLibrary = await uploadOrgFileSourceAction(
      form(pdf(), { assistantIds: JSON.stringify([assistant.id]) }),
    );
    expect(viaLibrary).toMatchObject({ error: expect.stringContaining("Too many uploads") });
    expect(extractSourceText).toHaveBeenCalledTimes(20);
  });
});
