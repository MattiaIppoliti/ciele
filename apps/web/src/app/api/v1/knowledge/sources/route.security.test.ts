import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { resetUploadAllowance } from "@/lib/upload-limit";

/**
 * The org-level upload door. It shares `intakeSource` with
 * `POST /collections/{id}/sources`, so the two properties #801 added there
 * (CYB-01 the per-member parser budget, CYB-09 the persisted triage verdict)
 * must hold here too. Sharing the helper is what makes that true; this is what
 * proves it stayed true, because a second door is exactly how one of them gets
 * lost.
 *
 * The capability gate is asserted separately: this route authorizes before it
 * fetches or parses anything, so a viewer key cannot make the server fetch a
 * URL it chose.
 */

const mocks = vi.hoisted(() => ({ extractSourceText: vi.fn() }));

vi.mock("@agent-hub/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-hub/agent")>();
  return { ...actual, extractSourceText: mocks.extractSourceText };
});

import { POST } from "./route";

const TRIAGE = {
  scanner: "document-triage" as const,
  version: 1,
  sha256: "cd".repeat(32),
  verdict: "clean" as const,
  at: "2026-09-12T00:00:00.000Z",
};

let editorSecret: string;
let viewerSecret: string;
let assistantId: string;

beforeAll(async () => {
  const db = getMockDb();
  const key = async (name: string, role: "editor" | "viewer") => {
    const raw = generateApiKeySecret();
    await db.createApiKey(DEMO_ORG.id, {
      name,
      role,
      secretHash: hashApiKeySecret(raw),
      secretHint: apiKeySecretHint(raw),
      createdBy: DEMO_MEMBER.userId,
    });
    return raw;
  };
  editorSecret = await key("library editor key", "editor");
  viewerSecret = await key("library viewer key", "viewer");
  // Deliberately no Collection: this is the state the org-level door exists for.
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Library door" });
  assistantId = assistant.id;
});

beforeEach(() => {
  resetUploadAllowance();
  mocks.extractSourceText.mockReset();
  mocks.extractSourceText.mockImplementation(
    async (input: { name?: string; kind: string }) => ({
      name: input.name ?? "fetched page",
      text: "enough extracted text to make a source",
      ...(input.kind === "file" ? { triage: TRIAGE } : {}),
    })
  );
});

afterEach(() => {
  resetUploadAllowance();
});

const URL_ENDPOINT = "http://test.local/api/v1/knowledge/sources";

function fileUpload(seq: number, secret = editorSecret) {
  const form = new FormData();
  form.set("file", new File([`hello ${seq}`], `notes-${seq}.txt`, { type: "text/plain" }));
  form.set("assistantIds", JSON.stringify([assistantId]));
  return new Request(URL_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: form,
  });
}

function urlAdd(secret = editorSecret) {
  return new Request(URL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      kind: "url",
      url: "https://example.test/handbook",
      assistantIds: [assistantId],
    }),
  });
}

describe("POST /api/v1/knowledge/sources", () => {
  it("lands the Source in the org Knowledge Library, no Collection named", async () => {
    const res = await POST(urlAdd());
    expect(res.status).toBe(201);
    const body = await res.json();
    const db = getMockDb();
    const library = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    expect((await db.getSource(body.id))?.collectionId).toBe(library.id);
    expect(
      (await db.listSourceAssistantLinks(body.id)).map((link) => link.assistantId)
    ).toEqual([assistantId]);
  });

  it("refuses a viewer key before it fetches anything", async () => {
    const res = await POST(urlAdd(viewerSecret));
    expect(res.status).toBe(403);
    expect(mocks.extractSourceText).not.toHaveBeenCalled();
  });

  it("persists the triage verdict on a file Source (CYB-09)", async () => {
    const res = await POST(fileUpload(1));
    expect(res.status).toBe(201);
    const source = await getMockDb().getSource((await res.json()).id);
    expect(source?.config?.triage).toEqual(TRIAGE);
  });

  it("budgets the parser per member (CYB-01): the 21st file is an unparsed 429", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await POST(fileUpload(i))).status).toBe(201);
    }
    const parses = mocks.extractSourceText.mock.calls.length;
    const refused = await POST(fileUpload(99));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await refused.json()).error.code).toBe("rate_limited");
    expect(mocks.extractSourceText).toHaveBeenCalledTimes(parses);
  });

  it("refuses an add that names no Assistant: the Library has no owner", async () => {
    const res = await POST(
      new Request(URL_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${editorSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "text", name: "Pasted", text: "long enough text" }),
      })
    );
    expect(res.status).toBe(422);
  });
});
