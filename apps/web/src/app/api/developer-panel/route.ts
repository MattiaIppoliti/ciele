import { NextRequest } from "next/server";
import { API_V1_DOMAINS, type ApiV1Domain } from "@/lib/api-v1/meta";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { appOrigin, docsOrigin } from "@/lib/origins";
import { buildPanelDomains } from "@/lib/developer-panel/catalogue";
import type { DeveloperPanelData } from "@/lib/developer-panel/types";
import { canManageApiKeys } from "@/lib/rbac";

/**
 * What the Developer Panel needs, fetched when it opens (#754).
 *
 * The catalogue is built from the /api/v1 contract registry, which imports
 * `@ciele/ops`, so it is assembled here rather than imported by the panel, and
 * the client bundle stays free of the ops layer. Fetching on open also means the
 * panel costs nothing on the many page loads where nobody opens it.
 */

export const dynamic = "force-dynamic";

function requestedDomains(request: NextRequest): ApiV1Domain[] {
  const advertised = new Set<string>(API_V1_DOMAINS);
  return (request.nextUrl.searchParams.get("domains") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ApiV1Domain => advertised.has(value));
}

/** Prefer the configured origin so a self-host never hands out the hosted one. */
function deploymentOrigin(request: NextRequest): string {
  return appOrigin(new URL(request.url).origin);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Only ask about keys when the viewer is allowed to know. An Editor gets
  // `null`, and the panel tells them who can mint one instead of asserting the
  // Organization has none.
  const hasKeys = canManageApiKeys(session.role)
    ? (await (await getDb()).listApiKeys(session.organization.id)).length > 0
    : null;

  const data: DeveloperPanelData = {
    domains: buildPanelDomains(requestedDomains(request)),
    auth: {
      origin: deploymentOrigin(request),
      hasKeys,
      demo: session.demo,
    },
    docsOrigin: docsOrigin(),
  };

  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
