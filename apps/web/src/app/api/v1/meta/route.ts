import { API_V1_DOMAINS, API_V1_VERSION } from "@/lib/api-v1/meta";

/**
 * Unauthenticated discovery endpoint (#619): a client (CLI, MCP server)
 * asks a deployment — SaaS or self-hosted — what it speaks before calling
 * it, which is the version-skew answer for self-hosted servers older than
 * the client. Deliberately free of anything org- or auth-shaped.
 */
export async function GET() {
  return Response.json({
    api: "ciele",
    apiVersion: API_V1_VERSION,
    serverVersion: process.env.APP_VERSION ?? "dev",
    domains: API_V1_DOMAINS,
  });
}
