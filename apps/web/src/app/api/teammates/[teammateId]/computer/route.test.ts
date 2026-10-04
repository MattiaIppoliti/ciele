import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  visible: vi.fn(),
  status: vi.fn(),
  screen: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@agent-hub/agent", () => ({
  teammateComputer: () => ({
    status: mocks.status,
    screen: mocks.screen,
    readWorkspace: mocks.read,
    start: mocks.start,
    stop: mocks.stop,
  }),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/data", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/teammates/access", () => ({
  findVisibleTeammate: mocks.visible,
}));
import { GET, POST } from "./route";
const params = { params: Promise.resolve({ teammateId: "owned" }) };
const request = (query = "") =>
  new Request("http://localhost/api/teammates/owned/computer" + query);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    organization: { id: "org" },
    userId: "member",
    role: "viewer",
  });
  mocks.visible.mockResolvedValue({ id: "owned", deletedAt: null });
  mocks.status.mockResolvedValue({
    state: "running",
    permissions: { browser: true, files: true, terminal: true },
  });
  mocks.screen.mockResolvedValue({ base64: "frame", width: 1, height: 1 });
  mocks.read.mockResolvedValue({ entries: [] });
});
describe("teammate computer viewer access", () => {
  it("requires sign-in and visibility before any screen read", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET(request("?view=screen"), params)).status).toBe(401);
    mocks.visible.mockResolvedValueOnce(null);
    expect((await GET(request("?view=screen"), params)).status).toBe(404);
    expect(mocks.screen).not.toHaveBeenCalled();
  });
  it("returns a private screen and never starts a computer for a view", async () => {
    const response = await GET(request("?view=screen"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("refuses view reads on stopped computers and arbitrary action dispatch", async () => {
    mocks.status.mockResolvedValueOnce({ state: "stopped" });
    expect((await GET(request("?view=files"), params)).status).toBe(409);
    expect(mocks.read).not.toHaveBeenCalled();
    expect((await GET(request("?view=exec"), params)).status).toBe(422);
    mocks.session.mockResolvedValueOnce({
      organization: { id: "org" },
      userId: "admin",
      role: "admin",
    });
    expect(
      (
        await POST(
          new Request(request().url, {
            method: "POST",
            body: JSON.stringify({ action: "exec", command: "whoami" }),
          }),
          params,
        )
      ).status,
    ).toBe(422);
  });
  it("requires an admin for lifecycle controls but permits scoped read views", async () => {
    expect(
      (
        await POST(
          new Request(request().url, {
            method: "POST",
            body: '{"action":"stop"}',
          }),
          params,
        )
      ).status,
    ).toBe(403);
    expect(mocks.stop).not.toHaveBeenCalled();
    const response = await GET(
      request("?view=file&path=notes%2Freport.txt"),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(
      "files_read",
      { path: "notes/report.txt" },
      expect.any(AbortSignal),
    );
    const status = await GET(request(), params);
    expect((await status.json()).canManage).toBe(false);
  });
  it("clears the view with an unavailable response when access is revoked upstream", async () => {
    mocks.screen.mockRejectedValueOnce(new Error("revoked"));
    expect((await GET(request("?view=screen"), params)).status).toBe(503);
  });
});
