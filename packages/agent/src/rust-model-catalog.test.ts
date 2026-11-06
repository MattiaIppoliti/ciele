import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_SOURCES, type Provider } from "@agent-hub/core";
import {
  MODEL_CATALOG,
  MODEL_SOURCE_NAMES,
  PROVIDER_NAMES,
  RETIRED_MODELS,
  gatewayModelId,
} from "./catalog";
import { providerAvailability } from "./models";

/**
 * The Rust service draws the widget's model picker (#1136) from a copy of this
 * package's static model data, `services/ciele-api/src/widget/model_catalog.json`.
 * Editing the catalogue here without that file would make the two pickers
 * disagree, so this test fails until both say the same thing.
 */
const RUST = JSON.parse(
  readFileSync(new URL("../../../services/ciele-api/src/widget/model_catalog.json", import.meta.url), "utf8")
) as {
  catalog: Record<string, unknown>;
  retired: Record<string, unknown>;
  gateway: Record<string, Record<string, string | null>>;
  sources: string[];
  sourceNames: Record<string, string>;
  providerNames: Record<string, string>;
  platformEnv: Record<string, string>;
  platformGatewayEnv: string;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("services/ciele-api model_catalog.json", () => {
  it("carries the catalogue, retired ids, sources and display names", () => {
    expect(RUST.catalog).toEqual(MODEL_CATALOG);
    expect(RUST.retired).toEqual(RETIRED_MODELS);
    expect(RUST.sources).toEqual([...MODEL_SOURCES]);
    expect(RUST.sourceNames).toEqual(MODEL_SOURCE_NAMES);
    expect(RUST.providerNames).toEqual(PROVIDER_NAMES);
  });

  it("names the Gateway's id for every catalogued model, and nothing else", () => {
    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      if (provider === "openai_compatible") continue;
      const table = RUST.gateway[provider];
      expect(Object.keys(table).sort(), provider).toEqual(models.map((m) => m.id).sort());
      for (const { id } of models) {
        expect(table[id], `${provider}/${id}`).toBe(gatewayModelId(provider as Provider, id));
      }
    }
  });

  it("reads the platform keys from the variables the runtime reads", () => {
    for (const [provider, variable] of Object.entries(RUST.platformEnv)) {
      vi.stubEnv(variable, "set");
      expect(providerAvailability([])[provider as Provider].platform, variable).toBe(true);
      vi.stubEnv(variable, "");
      expect(providerAvailability([])[provider as Provider].platform, variable).toBe(false);
    }
    vi.stubEnv(RUST.platformGatewayEnv, "set");
    expect(providerAvailability([]).google.gateway).toBe(true);
  });
});
