const siteOrigin = new URL(
  process.env.CIELE_MARKETING_ORIGIN?.trim() || "https://ciele.app"
).toString().replace(/\/$/, "");
const sourceUrl =
  process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/MattiaIppoliti/ciele";

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteOrigin}/#organization`,
      name: "Ciele",
      url: `${siteOrigin}/home`,
      logo: `${siteOrigin}/icon.svg`,
      sameAs: [sourceUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: "Ciele",
      alternateName: "Ciele AI",
      url: `${siteOrigin}/home`,
      publisher: { "@id": `${siteOrigin}/#organization` },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteOrigin}/#software`,
      name: "Ciele",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "AI assistant platform",
      operatingSystem: "Web",
      description:
        "An open-source platform for building, testing, and publishing AI assistants grounded in an organization's knowledge.",
      url: `${siteOrigin}/home`,
      codeRepository: sourceUrl,
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
      isAccessibleForFree: true,
      provider: { "@id": `${siteOrigin}/#organization` },
      offers: {
        "@type": "Offer",
        name: "Self-hosted edition",
        description: "Free, open-source self-hosted edition under AGPL-3.0.",
        price: "0",
        priceCurrency: "EUR",
        url: `${siteOrigin}/pricing`,
      },
    },
  ],
};

export function SiteStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</g, "\\u003c"),
      }}
    />
  );
}
