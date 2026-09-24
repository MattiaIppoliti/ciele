import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { CIELE_ORIGIN, isCanonicalMarketingHost } from "@/lib/marketing/seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!isCanonicalMarketingHost(host)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/alerts",
        "/application-connect",
        "/api",
        "/assistants",
        "/help-desks",
        "/improvements",
        "/inbox",
        "/insights",
        "/join",
        "/library",
        "/login",
        "/newsletter/confirm",
        "/onboarding",
        "/reviews",
        "/settings",
        "/setup",
        "/signup",
        "/subscription-connect",
        "/teammates",
        "/widget",
      ],
    },
    sitemap: new URL("/sitemap.xml", CIELE_ORIGIN).toString(),
  };
}
