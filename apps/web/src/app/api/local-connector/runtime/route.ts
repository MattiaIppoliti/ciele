import {
  CONNECTOR_FILENAME,
  readVerifiedConnectorRuntime,
} from "@/lib/local-connector-installer";

export const runtime = "nodejs";

// Public, unauthenticated download of the connector runtime for terminal
// self-service (`curl … | node`). The runtime is generic client code with no
// org, member or provider secret — its security rests on the connector binding
// 127.0.0.1 and validating Origin + bootstrap token at pairing time, not on the
// source being private. The same file already ships inside every authenticated
// desktop package. Served read-only over HTTPS with a digest-pinned body.
export async function GET() {
  try {
    const body = readVerifiedConnectorRuntime();
    return new Response(Uint8Array.from(body).buffer, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="${CONNECTOR_FILENAME}"`,
        "Content-Type": "application/javascript; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "runtime_unavailable" }, { status: 503 });
  }
}
