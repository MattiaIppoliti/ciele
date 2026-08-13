import {
  buildSelfHostInstallScript,
  resolveSourceUrl,
} from "@/lib/self-host-install";

export const runtime = "nodejs";

/**
 * The public, unauthenticated self-host installer, served at `/install.sh` so
 * the pasted one-liner reads as an address rather than an API call. The route
 * segment is literally `install.sh`, the same trick `/api/v1/openapi.json`
 * uses.
 *
 * It carries no secret of any kind: it names the public repository and runs
 * `deploy/bootstrap.sh`, which generates every secret locally on the machine
 * it is installing onto. Nothing here is org- or user-scoped, which is why
 * `middleware.ts` lists the path as public.
 */
export function GET() {
  try {
    const script = buildSelfHostInstallScript(resolveSourceUrl());
    return new Response(script, {
      headers: {
        // An hour: long enough to be cheap, short enough that a fix to the
        // installer reaches the next person who pastes the command.
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // A misconfigured NEXT_PUBLIC_SOURCE_URL should serve nothing at all
    // rather than a script pointing somewhere unintended.
    return Response.json({ error: "install_script_unavailable" }, { status: 503 });
  }
}
