import type { PlatformEvalModel, Provider } from "@agent-hub/core";

type CatalogEntry = {
  id?: string;
  name?: string;
  type?: string;
  modalities?: { output?: string[] };
  pricing?: { input?: string; output?: string };
};

const CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";
const CATALOG_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];
export type CatalogModelOption = {
  provider: CatalogProvider;
  modelId: string;
  label: string;
};

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(CATALOG_URL, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("The model catalog is unavailable. Try again later.");
  const catalog = (await response.json()) as { data?: CatalogEntry[] };
  if (!Array.isArray(catalog.data)) throw new Error("The model catalog is unavailable. Try again later.");
  return catalog.data;
}

/** Only offer models that the add endpoint can identify and price. */
export function catalogModelOptions(entries: CatalogEntry[]): CatalogModelOption[] {
  return entries.flatMap((entry) => {
    const [provider, ...rest] = entry.id?.split("/") ?? [];
    const modelId = rest.join("/");
    const input = Number(entry.pricing?.input);
    const output = Number(entry.pricing?.output);
    if (
      !CATALOG_PROVIDERS.some((item) => item === provider) ||
      !modelId || modelId.length > 160 || !/^[\w./:-]+$/.test(modelId) ||
      !entry.name || entry.name.length > 100 ||
      entry.type !== "language" || !entry.modalities?.output?.includes("text") ||
      !entry.pricing?.input?.trim() || !entry.pricing?.output?.trim() ||
      !Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0
    ) return [];
    return [{ provider: provider as CatalogProvider, modelId, label: entry.name }];
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export async function listDiscoverableModels(): Promise<CatalogModelOption[]> {
  return catalogModelOptions(await fetchCatalog());
}

/** Resolve exact model identity and list prices; never trust client-supplied metadata. */
export async function discoverPlatformModel(
  provider: Exclude<Provider, "openai_compatible">,
  modelId: string,
): Promise<Pick<PlatformEvalModel, "provider" | "modelId" | "label" | "inputEurPerMillion" | "outputEurPerMillion">> {
  const [catalogResponse, fxResponse] = await Promise.all([
    fetchCatalog(),
    fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!fxResponse.ok) throw new Error("The exchange rate is unavailable. Try again later.");
  const entry = catalogResponse.find((item) => item.id === `${provider}/${modelId}`);
  if (!entry || entry.type !== "language" || !entry.modalities?.output?.includes("text"))
    throw new Error("This model ID was not found as a text model in the verified catalog.");
  const inputUsdPerToken = Number(entry.pricing?.input);
  const outputUsdPerToken = Number(entry.pricing?.output);
  const usdRate = /currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(await fxResponse.text());
  const usdPerEur = Number(usdRate?.[1]);
  if (!entry.name || entry.name.length > 100 || !entry.pricing?.input?.trim() || !entry.pricing?.output?.trim() ||
      !Number.isFinite(inputUsdPerToken) || !Number.isFinite(outputUsdPerToken) ||
      inputUsdPerToken < 0 || outputUsdPerToken < 0 || !Number.isFinite(usdPerEur) || usdPerEur <= 0)
    throw new Error("Verified name, price, or EUR exchange rate is unavailable for this model.");
  const inputEurPerMillion = Number((inputUsdPerToken * 1_000_000 / usdPerEur).toFixed(6));
  const outputEurPerMillion = Number((outputUsdPerToken * 1_000_000 / usdPerEur).toFixed(6));
  if (inputEurPerMillion > 10_000 || outputEurPerMillion > 10_000)
    throw new Error("This model's listed price exceeds the supported range.");
  return {
    provider,
    modelId,
    label: entry.name,
    inputEurPerMillion,
    outputEurPerMillion,
  };
}
