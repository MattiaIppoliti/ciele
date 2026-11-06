import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { FEATURES } from "@/components/marketing/feature-catalog";
import { MARKETING_SITEMAP_PATHS } from "@/lib/console-routes";
import { isCanonicalMarketingHost, marketingCanonicalUrl } from "@/lib/marketing/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  // Fork domains serve the authenticated app and docs, not Ciele's commercial
  // site. Their redirects and robots file must not advertise this sitemap.
  if (!isCanonicalMarketingHost(host)) return [];

  const paths = [
    // Only the catalogue's two index pages: its ~190 per-family pages were
    // most of Google's never-crawled queue on a young domain, starving the
    // pages that sell. They stay reachable, and crawlable, by link.
    "/components",
    "/components/blocks",
    ...MARKETING_SITEMAP_PATHS,
    ...FEATURES.map((feature) => `/features/${feature.slug}`),
  ];

  return paths.map((path) => ({
    url: marketingCanonicalUrl(path),
  }));
}
