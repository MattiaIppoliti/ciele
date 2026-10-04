import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  teammateComputer,
  teammateComputerId,
  teammateComputerTools,
} from "./teammate-computer";

const db = getMockDb();
const master = "fixture-computer-master-secret-long";
const supervisorToken = "fixture-supervisor-secret-long";
let server: Server;
let origin: string;
let port: number;
let identityOverride: Record<string, unknown> = {};
let holdExec = false;
let currentComputerId = "";
let computerRunning = true;
let holdScreenshot = false;
let enteredScreenshot = () => {};
let releaseScreenshot = () => {};
const screenFrame = {
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  width: 1,
  height: 1,
  capturedAt: "2026-10-04T12:00:00.000Z",
  url: "https://example.com/",
};
let enteredExec = () => {};
const requests: Array<{ path: string; authorization: string | undefined }> = [];
const files = new Map<string, string>();
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = request.url ?? "";
    requests.push({ path, authorization: request.headers.authorization });
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const raw: unknown = body ? JSON.parse(body) : {};
    response.setHeader("content-type", "application/json");
    const ensure = /^\/computers\/([a-z0-9]+)\/ensure$/.exec(path);
    if (ensure)
      response.end(
        JSON.stringify({
          botId: ensure[1],
          container: "ciele-computer-" + ensure[1],
          status: "running",
          port,
          url: origin,
          ...identityOverride,
        }),
      );
    else if (path === "/computers")
      response.end(
        JSON.stringify({
          computers: [
            {
              botId: currentComputerId,
              container: "ciele-computer-" + currentComputerId,
              status: computerRunning ? "running" : "stopped",
              port,
              url: origin,
              ...identityOverride,
            },
          ],
        }),
      );
    else if (path === "/screenshot") {
      enteredScreenshot();
      if (holdScreenshot) {
        releaseScreenshot = () => response.end(JSON.stringify(screenFrame));
        return;
      }
      response.end(JSON.stringify(screenFrame));
    } else if (path.endsWith("/stop")) response.end('{"ok":true}');
    else if (path === "/exec") {
      enteredExec();
      if (holdExec) return;
      response.end(
        JSON.stringify({
          command: "sensitive command",
          stdout: master + " " + supervisorToken + " complete",
          exitCode: 0,
        }),
      );
    } else if (
      raw &&
      typeof raw === "object" &&
      "path" in raw &&
      typeof raw.path === "string"
    ) {
      if (
        path === "/files/write" &&
        "contents" in raw &&
        typeof raw.contents === "string"
      )
        files.set(raw.path, raw.contents);
      response.end(JSON.stringify({ contents: files.get(raw.path) ?? "" }));
    } else response.end('{"ok":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test listener has no port");
  port = address.port;
  origin = "http://127.0.0.1:" + port;
});
afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
});
afterEach(() => {
  vi.unstubAllEnvs();
  identityOverride = {};
  holdExec = false;
  enteredExec = () => {};
  requests.length = 0;
  files.clear();
  computerRunning = true;
  holdScreenshot = false;
  enteredScreenshot = () => {};
});
async function fixture() {
  vi.stubEnv("CIELE_COMPUTER_SUPERVISOR_URL", origin);
  vi.stubEnv("CIELE_COMPUTER_SUPERVISOR_TOKEN", supervisorToken);
  vi.stubEnv("CIELE_COMPUTER_TOKEN", master);
  vi.stubEnv("CIELE_COMPUTER_NAMESPACE", "ciele");
  const inserted = await db.table("teammates").insert({
    organizationId: DEMO_ORG.id,
    ownerId: DEMO_MEMBER.userId,
    name: "Computer coworker",
  });
  const teammate = await db.table("teammates").update(inserted.id, {
    capabilityCeiling: "edit",
    runtimeConfig: {
      harness: { kind: "ciele" },
      internet: true,
      computer: { browser: true, files: true, terminal: true },
    },
  });
  currentComputerId = teammateComputerId(teammate);
  return { teammate, computer: teammateComputer({ db, teammate }) };
}

describe("Teammate computer perimeter", () => {
  it("observes only the owned running screen without ensure or snapshot mutations", async () => {
    const { computer } = await fixture();
    expect(await computer.screen()).toEqual(screenFrame);
    expect(requests.map((row) => row.path)).toEqual([
      "/computers",
      "/screenshot",
    ]);
    expect(requests[1]?.authorization).not.toContain(master);
  });
  it("does not restart a stopped computer when a person opens screen or files", async () => {
    const { computer } = await fixture();
    computerRunning = false;
    await expect(computer.screen()).rejects.toThrow("stopped");
    await expect(
      computer.readWorkspace("files_list", { path: "" }),
    ).rejects.toThrow("stopped");
    expect(requests.some((row) => row.path.includes("ensure"))).toBe(false);
  });
  it("refuses a sibling identity and revoked browser permission before returning pixels", async () => {
    const { teammate, computer } = await fixture();
    identityOverride = { container: "ciele-computer-foreign" };
    await expect(computer.screen()).rejects.toThrow("identity");
    identityOverride = {};
    holdScreenshot = true;
    const entered = new Promise<void>((resolve) => {
      enteredScreenshot = resolve;
    });
    const capture = computer.screen();
    await entered;
    await db
      .table("teammates")
      .update(teammate.id, {
        runtimeConfig: {
          harness: { kind: "ciele" },
          internet: true,
          computer: { browser: false, files: true, terminal: true },
        },
      });
    releaseScreenshot();
    await expect(capture).rejects.toThrow("revoked");
  });
  it("observes files through read permissions and rejects traversal without a supervisor call", async () => {
    const { teammate, computer } = await fixture();
    files.set("notes.txt", "saved note");
    expect(
      await computer.readWorkspace("files_read", { path: "notes.txt" }),
    ).toEqual({ contents: "saved note" });
    expect(requests.some((row) => row.path.includes("ensure"))).toBe(false);
    requests.length = 0;
    await expect(
      computer.readWorkspace("files_read", { path: "../secret" }),
    ).rejects.toThrow("traversal");
    expect(requests).toHaveLength(0);
    await db
      .table("teammates")
      .update(teammate.id, {
        runtimeConfig: {
          harness: { kind: "ciele" },
          internet: true,
          computer: { browser: true, files: false, terminal: true },
        },
      });
    await expect(
      computer.readWorkspace("files_read", { path: "notes.txt" }),
    ).rejects.toThrow("revoked");
  });
  it("binds every computer to Organization and Teammate, with a distinct child credential", async () => {
    const { teammate, computer } = await fixture();
    expect(teammateComputerId(teammate)).not.toBe(
      teammateComputerId({ ...teammate, organizationId: "foreign" }),
    );
    const output = await computer.action("exec", { command: "echo hello" });
    const child = createHmac("sha256", master)
      .update("ciele-computer:" + teammateComputerId(teammate))
      .digest("hex");
    expect(requests[0]).toMatchObject({
      authorization: "Bearer " + supervisorToken,
    });
    expect(requests.find((request) => request.path === "/exec")).toMatchObject({
      authorization: "Bearer " + child,
    });
    expect(output).toEqual({
      stdout: "[redacted] [redacted] complete",
      exitCode: 0,
    });
    expect(JSON.stringify(output)).not.toContain("sensitive command");
  });
  it("reuses the owned workspace across stop/start through the service contract", async () => {
    const { computer } = await fixture();
    await computer.action("files_write", {
      path: "notes/research.txt",
      contents: "kept",
    });
    await computer.stop();
    await computer.start();
    expect(
      await computer.action("files_read", { path: "notes/research.txt" }),
    ).toEqual({ contents: "kept" });
  });
  it("refuses forged container identities and arbitrary returned origins before sending a child secret", async () => {
    const { computer } = await fixture();
    for (const override of [
      { botId: "foreign" },
      { container: "ciele-computer-foreign" },
      { url: "https://attacker.example" },
      { url: "http://127.0.0.1:" + port + "/wrong" },
    ]) {
      identityOverride = override;
      await expect(
        computer.action("exec", { command: "echo refused" }),
      ).rejects.toThrow(/identity|endpoint/);
    }
    expect(requests.some((request) => request.path === "/exec")).toBe(false);
  });
  it("refuses path traversal, private navigation, read-ceiling mutations and revoked permissions", async () => {
    const { teammate, computer } = await fixture();
    await expect(
      computer.action("files_read", { path: "../secrets" }),
    ).rejects.toThrow();
    await expect(
      computer.action("navigate", { url: "http://127.0.0.1:9999" }),
    ).rejects.toThrow();
    await db
      .table("teammates")
      .update(teammate.id, { capabilityCeiling: "member" });
    await expect(
      computer.action("files_write", { path: "notes.txt", contents: "x" }),
    ).rejects.toThrow("limited to reading");
    await expect(
      computer.action("exec", { command: "echo x" }),
    ).rejects.toThrow("limited to reading");
    await db.table("teammates").update(teammate.id, {
      runtimeConfig: {
        harness: { kind: "ciele" },
        internet: false,
        computer: { browser: false, files: false, terminal: false },
      },
    });
    await expect(
      computer.action("files_read", { path: "notes.txt" }),
    ).rejects.toThrow("revoked");
    expect(requests).toEqual([]);
  });
  it("stops the owned container when an active shell is cancelled", async () => {
    const { teammate, computer } = await fixture();
    holdExec = true;
    const entered = new Promise<void>((resolve) => {
      enteredExec = resolve;
    });
    const controller = new AbortController();
    const execution = computer.action(
      "exec",
      { command: "long process" },
      controller.signal,
    );
    const rejection = expect(execution).rejects.toThrow();
    await entered;
    controller.abort();
    await rejection;
    expect(
      requests.some(
        (request) =>
          request.path ===
          "/computers/" + teammateComputerId(teammate) + "/stop",
      ),
    ).toBe(true);
  });
  it("stops an active shell when an admin revokes its execution capability", async () => {
    const { teammate, computer } = await fixture();
    holdExec = true;
    const entered = new Promise<void>((resolve) => {
      enteredExec = resolve;
    });
    const execution = computer.action("exec", { command: "long process" });
    const rejection = expect(execution).rejects.toThrow();
    await entered;
    await db.table("teammates").update(teammate.id, {
      runtimeConfig: {
        harness: { kind: "ciele" },
        internet: false,
        computer: { browser: false, files: false, terminal: false },
      },
    });
    await rejection;
    expect(requests.some((request) => request.path.endsWith("/stop"))).toBe(
      true,
    );
  });
  it("offers no host-shell fallback when the computer service is missing", async () => {
    const { teammate } = await fixture();
    vi.stubEnv("CIELE_COMPUTER_SUPERVISOR_URL", "");
    expect(teammateComputerTools(db, teammate)).toEqual([]);
    await expect(
      teammateComputer({ db, teammate }).action("exec", { command: "echo x" }),
    ).rejects.toThrow("not configured");
    expect(requests).toEqual([]);
  });
});
