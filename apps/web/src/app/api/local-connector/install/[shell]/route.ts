import {
  buildConnectorInstallScript,
  isConnectorInstallShell,
} from "@/lib/local-connector-terminal-install";

export const runtime = "nodejs";

// Public, unauthenticated install script for terminal self-service pairing.
// It only downloads the secret-free runtime and runs it in bootstrap mode; it
// carries no org, member or provider secret. The pasted one-liner pipes this
// straight to the shell, so no execution-policy prompt or saved file is needed.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ shell: string }> }
) {
  const { shell } = await params;
  if (!isConnectorInstallShell(shell)) {
    return Response.json({ error: "unsupported_shell" }, { status: 404 });
  }
  try {
    const origin = new URL(request.url).origin;
    const script = buildConnectorInstallScript(origin, shell);
    return new Response(script, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type":
          shell === "sh"
            ? "text/x-shellscript; charset=utf-8"
            : "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "install_script_unavailable" }, { status: 503 });
  }
}
