import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogModelOptions, discoverPlatformModel, listDiscoverableModels } from "./platform-model-discovery";

afterEach(() => vi.unstubAllGlobals());

describe("platform model discovery", () => {
  it("uses an exact catalog match, verified name, and ECB conversion", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("ai-gateway")
        ? Response.json({ data: [{ id: "anthropic/claude-new", name: "Claude New", type: "language", modalities: { output: ["text"] }, pricing: { input: "0.000002", output: "0.00001" } }] })
        : new Response("<Cube currency='USD' rate='1.25'/>", { status: 200 }),
    ));
    expect(await discoverPlatformModel("anthropic", "claude-new")).toEqual({
      provider: "anthropic",
      modelId: "claude-new",
      label: "Claude New",
      inputEurPerMillion: 1.6,
      outputEurPerMillion: 8,
    });
    await expect(discoverPlatformModel("anthropic", "claude-newer")).rejects.toThrow("not found");
  });

  it("offers only priced text models from supported providers", () => {
    const textModel = (id: string, overrides = {}) => ({
      id,
      name: id,
      type: "language",
      modalities: { output: ["text"] },
      pricing: { input: "0.000001", output: "0.000002" },
      ...overrides,
    });
    expect(catalogModelOptions([
      textModel("anthropic/claude-new"),
      textModel("openai/gpt-new"),
      textModel("google/gemini-new", { pricing: { input: "", output: "0.000002" } }),
      textModel("voyage/rerank-new"),
      textModel("openai/image-new", { modalities: { output: ["image"] } }),
      textModel("openai/unpriced", { pricing: { input: "unknown", output: "0.000002" } }),
      textModel("openai/bad id"),
    ])).toEqual([
      { provider: "anthropic", modelId: "claude-new", label: "anthropic/claude-new" },
      { provider: "openai", modelId: "gpt-new", label: "openai/gpt-new" },
    ]);
  });

  it("fails closed when the catalog has no model list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unexpected: [] })));
    await expect(listDiscoverableModels()).rejects.toThrow("unavailable");
  });
});
