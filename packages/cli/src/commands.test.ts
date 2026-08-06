import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, runCli, type CliDeps } from "./index.ts";
import { memoryConfigStore } from "./config.ts";

/** Command groups added in #628, against a stubbed fetch. */

interface Captured {
  url: string;
  method: string;
  body?: string;
  formFile?: { field: string; name: string; text: string };
}

function harness(
  respond: (c: Captured) => { status?: number; json?: unknown } = () => ({
    json: {},
  })
) {
  const calls: Captured[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    if (init?.body instanceof FormData) {
      const [field, value] = [...init.body.entries()][0];
      if (value instanceof File) {
        captured.formFile = { field, name: value.name, text: await value.text() };
      }
    }
    calls.push(captured);
    const { status = 200, json = {} } = respond(captured);
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const deps: CliDeps = {
    env: { CIELE_API_KEY: "ciele_sk_test", CIELE_BASE_URL: "http://self.host" },
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    config: memoryConfigStore(),
    fetchImpl,
  };
  return { deps, calls, out, err };
}

const tmp = () => mkdtempSync(join(tmpdir(), "ciele-cli-"));

describe("flows commands", () => {
  it("create merges --file JSON with flags (flags win) and posts it", async () => {
    const dir = tmp();
    const file = join(dir, "flow.json");
    writeFileSync(
      file,
      JSON.stringify({ name: "from-file", trigger: "message", actions: ["message"] })
    );
    const { deps, calls } = harness(() => ({ json: { id: "f1", name: "Fees" } }));
    const code = await runCli(
      ["flows", "create", "a1", "--file", file, "--name", "Fees"],
      deps
    );
    expect(code).toBe(EXIT.ok);
    expect(calls[0].url).toBe("http://self.host/api/v1/assistants/a1/flows");
    expect(JSON.parse(calls[0].body!)).toEqual({
      name: "Fees",
      trigger: "message",
      actions: ["message"],
    });
  });

  it("reorder splits --ids; delete demands --yes", async () => {
    const { deps, calls } = harness(() => ({ json: { data: [] } }));
    await runCli(["flows", "reorder", "a1", "--ids", "f2,f1"], deps);
    expect(calls[0].url).toContain("/assistants/a1/flows/reorder");
    expect(JSON.parse(calls[0].body!)).toEqual({ orderedIds: ["f2", "f1"] });

    expect(await runCli(["flows", "delete", "f1"], deps)).toBe(EXIT.usage);
    expect(calls).toHaveLength(1); // the refused delete never hit the network
  });
});

describe("knowledge commands", () => {
  it("sources add-text reads a local file; add-file uploads multipart", async () => {
    const dir = tmp();
    const textPath = join(dir, "handbook.txt");
    writeFileSync(textPath, "Tuition is due in October.");
    const { deps, calls } = harness(() => ({
      json: { id: "s1", status: "processing" },
    }));

    await runCli(["sources", "add-text", "c1", "--file", textPath], deps);
    expect(JSON.parse(calls[0].body!)).toEqual({
      kind: "text",
      name: "handbook.txt",
      text: "Tuition is due in October.",
    });

    await runCli(["sources", "add-file", "c1", "--file", textPath], deps);
    expect(calls[1].formFile).toMatchObject({
      field: "file",
      name: "handbook.txt",
      text: "Tuition is due in October.",
    });
  });

  it("faqs import streams the local CSV as multipart", async () => {
    const dir = tmp();
    const csv = join(dir, "faqs.csv");
    writeFileSync(csv, "question,answer\nQ1,A1\n");
    const { deps, calls, out } = harness(() => ({
      json: { imported: 1, skipped: [] },
    }));
    const code = await runCli(["faqs", "import", "c1", "--file", csv], deps);
    expect(code).toBe(EXIT.ok);
    expect(calls[0].url).toContain("/collections/c1/faqs/import");
    expect(calls[0].formFile?.name).toBe("faqs.csv");
    expect(out[0]).toContain("Imported 1");
  });
});

describe("publish commands", () => {
  it("status/create/restore hit the right routes; remove demands --yes", async () => {
    const { deps, calls } = harness(({ url }) =>
      url.endsWith("/publish") && !url.includes("republish")
        ? { json: { published: false } }
        : { json: { version: 2, publicationId: "p2" } }
    );
    await runCli(["publish", "status", "a1"], deps);
    expect(calls[0].method).toBe("GET");
    await runCli(["publish", "create", "a1"], deps);
    expect(calls[1].method).toBe("POST");
    await runCli(["publish", "restore", "a1", "p1"], deps);
    expect(calls[2].url).toContain("/assistants/a1/republish");
    expect(JSON.parse(calls[2].body!)).toEqual({ publicationId: "p1" });

    expect(await runCli(["publish", "remove", "a1"], deps)).toBe(EXIT.usage);
    expect(calls).toHaveLength(3);
  });
});

describe("conversations commands", () => {
  it("list forwards filters; export --out writes the records to disk", async () => {
    const dir = tmp();
    const outPath = join(dir, "export.json");
    const { deps, calls } = harness(({ url }) =>
      url.includes("/export")
        ? { json: { data: [{ ConversationId: "c1" }] } }
        : { json: { data: [], nextCursor: null } }
    );
    await runCli(
      ["conversations", "list", "--assistant", "a1", "--limit", "5"],
      deps
    );
    const listUrl = new URL(calls[0].url);
    expect(listUrl.searchParams.get("assistantId")).toBe("a1");
    expect(listUrl.searchParams.get("limit")).toBe("5");

    const code = await runCli(
      ["conversations", "export", "c1", "c2", "--out", outPath],
      deps
    );
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(calls[1].body!)).toEqual({ conversationIds: ["c1", "c2"] });
    expect(JSON.parse(readFileSync(outPath, "utf8"))).toEqual([
      { ConversationId: "c1" },
    ]);
  });
});

describe("improvements commands", () => {
  it("update maps flags to the patch (none/empty → null, tags split)", async () => {
    const { deps, calls } = harness(() => ({ json: { id: "i1" } }));
    await runCli(
      [
        "improvements", "update", "i1",
        "--status", "in_progress",
        "--priority", "none",
        "--tags", "billing,urgent",
        "--assignee", "",
        "--due", "2026-09-01",
      ],
      deps
    );
    expect(calls[0].method).toBe("PATCH");
    expect(JSON.parse(calls[0].body!)).toEqual({
      status: "in_progress",
      priority: null,
      tags: ["billing", "urgent"],
      assigneeId: null,
      dueDate: "2026-09-01",
    });
  });
});
