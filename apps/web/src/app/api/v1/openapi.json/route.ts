import { buildOpenApiDocument } from "@/lib/api-v1/openapi";

/** The API contract, served where the API lives (#626). Unauthenticated. */
export async function GET() {
  return Response.json(buildOpenApiDocument());
}
