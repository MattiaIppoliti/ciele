import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import {
  checkOpenAiCompatibleBaseUrl,
  guardedOpenAiCompatibleFetch,
} from "./openai-compatible-guard";
import { testOpenAiCompatibleConnection } from "./test-openai-compatible";

const lookupMock = vi.mocked(lookup);
const PUBLIC = { address: "93.184.216.34", family: 4 };

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([PUBLIC] as never);
});
afterEach(() => {
  resetRuntimeHost();
  vi.unstubAllGlobals();
});

describe("checkOpenAiCompatibleBaseUrl, strict mode", () => {
  it.each([
    "http://169.254.169.254/v1",
    "https://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/v1",
    "https://192.168.1.5/v1",
    "http://localhost:11434/v1",
    "https://localhost/v1",
    "http://127.0.0.1:11434/v1",
    "http://public.example.com/v1",
  ])("refuses %s", async (url) => {
    expect(await checkOpenAiCompatibleBaseUrl(url)).toEqual(expect.any(String));
  });

  it("refuses a public name that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);
    expect(await checkOpenAiCompatibleBaseUrl("https://rebind.example.com/v1")).not.toBeNull();
  });

  it("accepts an https public host", async () => {
    expect(await checkOpenAiCompatibleBaseUrl("https://api.example.com/v1")).toBeNull();
  });
});

describe("checkOpenAiCompatibleBaseUrl, relaxed mode", () => {
  it("allows http and loopback", async () => {
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    expect(await checkOpenAiCompatibleBaseUrl("http://localhost:11434/v1")).toBeNull();
    expect(await checkOpenAiCompatibleBaseUrl("http://127.0.0.1:1234/v1")).toBeNull();
  });

  it("still blocks the metadata address", async () => {
    registerRuntimeHost({ allowRelaxedEgress: () => true });
    expect(await checkOpenAiCompatibleBaseUrl("http://169.254.169.254/v1")).not.toBeNull();
  });
});

describe("the guarded fetch and the test action", () => {
  it("refuses a private target before any request is made", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      guardedOpenAiCompatibleFetch("http://169.254.169.254/v1/chat/completions")
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes a public target through with redirects refused", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await guardedOpenAiCompatibleFetch("https://api.example.com/v1/models");
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });

  it("the Test action reports both legs refused for a private base URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testOpenAiCompatibleConnection({
      baseUrl: "http://10.0.0.1/v1",
      chatModel: "m",
      embeddingModel: "e",
    });
    expect(result.chat.ok).toBe(false);
    expect(result.embedding?.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
