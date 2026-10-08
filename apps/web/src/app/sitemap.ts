import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { FEATURES } from "@/components/marketing/feature-catalog";
import { COMPONENT_FAMILIES, catalogPath } from "@/components/component-catalog/catalog";
import { MARKETING_SITEMAP_PATHS } from "@/lib/console-routes";
import { isCanonicalMarketingHost, marketingCanonicalUrl } from "@/lib/marketing/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  // Fork domains serve the authenticated app and docs, not Ciele's commercial
  // site. Their redirects and robots file must not advertise this sitemap.
  if (!isCanonicalMarketingHost(host)) return [];

  const paths = [
    "/components",
    "/components/blocks",
    ...COMPONENT_FAMILIES.map(catalogPath),
    ...MARKETING_SITEMAP_PATHS,
    ...FEATURES.map((feature) => `/features/${feature.slug}`),
  ];

  return paths.map((path) => ({
    url: marketingCanonicalUrl(path),
  }));
}
