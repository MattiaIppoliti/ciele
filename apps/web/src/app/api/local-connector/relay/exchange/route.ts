import { NextRequest } from "next/server";
import { exchangeRelayPairing } from "@/lib/local-inference-relay";
import { InvalidRelayPairingCodeError } from "@/lib/local-relay-pairing-code";

const MAX_PAIRING_BODY_BYTES = 1_024;
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function diagnosticCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_.-]{1,32}$/.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name : "UnknownError";
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();

    byteLength += value.byteLength;
    if (byteLength > MAX_PAIRING_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PAIRING_BODY_BYTES) {
    return Response.json({ error: "invalid_pairing" }, { status: 413 });
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    return Response.json({ error: "invalid_pairing" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_pairing" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("code" in body) ||
    typeof body.code !== "string" ||
    !PAIRING_CODE_PATTERN.test(body.code) ||
    !("origin" in body) ||
    typeof body.origin !== "string" ||
    body.origin !== request.nextUrl.origin
  ) {
    return Response.json({ error: "invalid_pairing" }, { status: 400 });
  }

  try {
    return Response.json(await exchangeRelayPairing({ code: body.code, origin: body.origin }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof InvalidRelayPairingCodeError) {
      return Response.json(
        { error: "invalid_or_expired_pairing" },
        { status: 403 }
      );
    }
    console.error(
      JSON.stringify({
        level: "error",
        message: "Local connector relay exchange failed",
        route: "/api/local-connector/relay/exchange",
        errorCode: diagnosticCode(error),
        requestId: request.headers.get("x-vercel-id"),
        durationMs: Date.now() - startedAt,
      })
    );
    return Response.json({ error: "pairing_failed" }, { status: 503 });
  }
}
