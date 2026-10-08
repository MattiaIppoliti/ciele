import { afterEach, describe, expect, it, vi } from "vitest";
import { marketingCanonicalUrl, marketingMetadata } from "./seo";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "ciele.app" })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/components/marketing/feature-catalog", () => ({ FEATURES: [{ slug: "flows" }] }));
vi.mock("@/components/component-catalog/catalog", () => ({ COMPONENT_FAMILIES: [], catalogPath: vi.fn() }));

import sitemap from "@/app/sitemap";

afterEach(() => {
  mocks.headers.mockResolvedValue(new Headers({ host: "ciele.app" }));
});

describe("marketing search URLs", () => {
  it("uses the public root for both homepage entry points and social metadata", () => {
    for (const path of ["/", "/home"] as const) {
      const metadata = marketingMetadata({ title: "Ciele", description: "AI teammates", path });
      expect(metadata.alternates?.canonical).toBe("https://ciele.app/");
      expect(metadata.openGraph?.url).toBe("https://ciele.app/");
      expect(metadata.robots).toEqual({ index: true, follow: true });
    }
    expect(marketingCanonicalUrl("/pricing")).toBe("https://ciele.app/pricing");
  });

  it("advertises one homepage in the sitemap at the same canonical URL", async () => {
    const urls = (await sitemap()).map(({ url }) => url);
    expect(urls.filter((url) => url === "https://ciele.app/")).toHaveLength(1);
    expect(urls).not.toContain("https://ciele.app/home");
    expect(urls).toContain("https://ciele.app/pricing");
    expect(urls).toContain("https://ciele.app/features/flows");
    expect(urls.some((url) => url.endsWith(".md") || url.includes("/onboarding"))).toBe(false);
  });

  it("does not advertise Ciele's public pages on an application fork", async () => {
    mocks.headers.mockResolvedValue(new Headers({ host: "institution.example.com" }));
    expect(await sitemap()).toEqual([]);
  });
});
