import type { Metadata } from "next";

export const CIELE_ORIGIN = new URL(
  process.env.CIELE_MARKETING_ORIGIN?.trim() || "https://ciele.app"
);

export function isCanonicalMarketingHost(host: string | null): boolean {
  if (!host) return false;
  try {
    return new URL(`https://${host}`).hostname === CIELE_ORIGIN.hostname;
  } catch {
    return false;
  }
}

type MarketingMetadataInput = {
  title: string;
  description: string;
  path: `/${string}`;
  noIndex?: boolean;
};

/** Keep each public page's canonical, search snippet, and social card in sync. */
export function marketingMetadata({
  title,
  description,
  path,
  noIndex = false,
}: MarketingMetadataInput): Metadata {
  const canonical = new URL(path, CIELE_ORIGIN).toString();
  const image = new URL("/opengraph-image", CIELE_ORIGIN).toString();

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: !noIndex, follow: !noIndex },
    openGraph: {
      type: "website",
      siteName: "Ciele",
      title,
      description,
      url: canonical,
      images: [{ url: image, width: 1200, height: 630, alt: "Ciele" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
