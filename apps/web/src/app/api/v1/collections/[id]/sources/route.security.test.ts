import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { resetUploadAllowance } from "@/lib/upload-limit";

/**
 * The /api/v1 upload door (#801 review, CYB-01 and CYB-09). The console doors
 * budget the parser per member and persist the triage verdict on the Source;
 * this route did neither, so an edit-role key could loop the parser and a file
 * that arrived by API carried no verdict. Both are asserted here.
 */

const mocks = vi.hoisted(() => ({
  extractSourceText: vi.fn(),
}));

vi.mock("@agent-hub/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-hub/agent")>();
  return { ...actual, extractSourceText: mocks.extractSourceText };
});

import { POST } from "./route";

const TRIAGE = {
  scanner: "document-triage" as const,
  version: 1,
  sha256: "ab".repeat(32),
  verdict: "clean" as const,
  at: "2026-09-01T00:00:00.000Z",
};

let secret: string;
let collectionId: string;
let assistantId: string;

beforeAll(async () => {
  const db = getMockDb();
  const raw = generateApiKeySecret();
  await db.createApiKey(DEMO_ORG.id, {
    name: "upload test key",
    role: "editor",
    secretHash: hashApiKeySecret(raw),
    secretHint: apiKeySecretHint(raw),
    createdBy: DEMO_MEMBER.userId,
  });
  secret = raw;
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Upload door" });
  assistantId = assistant.id;
  const collection = await db.createCollection(assistant.id, { name: "Uploads" });
  collectionId = collection.id;
});

beforeEach(() => {
  resetUploadAllowance();
  mocks.extractSourceText.mockReset();
  mocks.extractSourceText.mockImplementation(async (input: { name?: string; kind: string }) => ({
    name: input.name ?? "fetched page",
    text: "enough extracted text to make a source",
    ...(input.kind === "file" ? { triage: TRIAGE } : {}),
  }));
});

afterEach(() => {
  resetUploadAllowance();
});

function fileUpload(seq: number) {
  const form = new FormData();
  form.set("file", new File([`hello ${seq}`], `notes-${seq}.txt`, { type: "text/plain" }));
  form.set("assistantIds", JSON.stringify([assistantId]));
  return new Request(`http://test.local/api/v1/collections/${collectionId}/sources`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: form,
  });
}

const params = () => ({ params: Promise.resolve({ id: collectionId }) });

describe("POST /api/v1/collections/{id}/sources", () => {
  it("persists the triage verdict on a file Source, as the console doors do", async () => {
    const res = await POST(fileUpload(1), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    const source = await getMockDb().getSource(body.id);
    expect(source?.config?.triage).toEqual(TRIAGE);
  });

  it("budgets the parser per member: the 21st file in the window is a 429, unparsed", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await POST(fileUpload(i), params())).status).toBe(201);
    }
    const parses = mocks.extractSourceText.mock.calls.length;
    const refused = await POST(fileUpload(99), params());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await refused.json()).error.code).toBe("rate_limited");
    // The property CYB-01 is about: the refusal cost no parser time.
    expect(mocks.extractSourceText).toHaveBeenCalledTimes(parses);
  });

  it("budgets a url Source too, since a fetch plus a parse is the expensive step", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await POST(fileUpload(i), params())).status).toBe(201);
    }
    const parses = mocks.extractSourceText.mock.calls.length;
    const res = await POST(
      new Request(`http://test.local/api/v1/collections/${collectionId}/sources`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "url", url: "https://example.edu/handbook", assistantIds: [assistantId] }),
      }),
      params()
    );
    expect(res.status).toBe(429);
    expect(mocks.extractSourceText).toHaveBeenCalledTimes(parses);
  });

  it("leaves a text Source outside the budget: nothing is parsed or fetched", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await POST(fileUpload(i), params())).status).toBe(201);
    }
    const res = await POST(
      new Request(`http://test.local/api/v1/collections/${collectionId}/sources`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "text",
          name: "Pasted",
          text: "some pasted text that is long enough",
          assistantIds: [assistantId],
        }),
      }),
      params()
    );
    expect(res.status).toBe(201);
  });
});
