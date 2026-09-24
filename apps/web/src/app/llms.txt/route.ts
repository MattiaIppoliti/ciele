import { headers } from "next/headers";
import { CIELE_ORIGIN } from "@/lib/marketing/seo";
import { isCanonicalMarketingHost } from "@/lib/marketing/seo";

export const revalidate = false;

export async function GET() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isCanonicalMarketingHost(host)) return new Response(null, { status: 404 });

  const origin = CIELE_ORIGIN.toString().replace(/\/$/, "");
  const content = `# Ciele

> Ciele is an open-source platform for building, testing, and publishing AI assistants and internal AI teammates grounded in an organization's knowledge.

## Product
- [Overview](${origin}/home): AI assistants and teammates for organizations.
- [Features](${origin}/features/assistants): Configure assistants, knowledge, workflows, publishing, and team operations.
- [Pricing](${origin}/pricing): Self-hosted AGPL-3.0 edition and managed Enterprise option.
- [Security](${origin}/security): Security and data protection practices.
- [Download](${origin}/download): Self-hosting and desktop options.
- [Change log](${origin}/change-log): Product updates.

## Documentation
- [Ciele documentation](https://docs.ciele.app/): Product and developer documentation.
- [Documentation index for AI tools](https://docs.ciele.app/llms.txt)
- [Full documentation text](https://docs.ciele.app/llms-full.txt)
- [Public API reference](https://docs.ciele.app/api-reference)
- [Source repository](https://github.com/MattiaIppoliti/ciele)

## Policies
- [Privacy policy](${origin}/policies/privacy)
- [Terms of service](${origin}/policies/terms-of-service)
- [Data processing addendum](${origin}/policies/dpa)
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
