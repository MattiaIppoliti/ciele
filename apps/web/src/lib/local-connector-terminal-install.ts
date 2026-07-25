import { CONNECTOR_BOOTSTRAP_PORT } from "@/lib/local-connector-protocol";
import { normalizeConnectorOrigin } from "@/lib/local-connector-installer";

export type ConnectorInstallShell = "sh" | "ps1";

export function isConnectorInstallShell(
  value: string
): value is ConnectorInstallShell {
  return value === "sh" || value === "ps1";
}

/**
 * The single command a user pastes into their terminal. It fetches the
 * matching install script from this deployment and pipes it straight to the
 * shell — no file to save, no execution-policy prompt (piped input is not
 * governed by PowerShell execution policy).
 */
export function connectorInstallCommand(
  rawOrigin: string,
  shell: ConnectorInstallShell
): string {
  const origin = normalizeConnectorOrigin(rawOrigin);
  return shell === "sh"
    ? `curl -fsSL ${origin}/api/local-connector/install/sh | sh`
    : `irm ${origin}/api/local-connector/install/ps1 | iex`;
}

/**
 * The script served at /api/local-connector/install/{sh,ps1}. It downloads the
 * secret-free runtime, then runs it in bootstrap mode on the fixed discovery
 * port so the browser pairing page can complete pairing. No admin rights and
 * no autostart — the connector runs for the life of the terminal window.
 */
export function buildConnectorInstallScript(
  rawOrigin: string,
  shell: ConnectorInstallShell
): string {
  const origin = normalizeConnectorOrigin(rawOrigin);
  const runtimeUrl = `${origin}/api/local-connector/runtime`;
  const returnUrl = `${origin}/settings/ai`;
  const port = CONNECTOR_BOOTSTRAP_PORT;

  if (shell === "sh") {
    return `#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it, then re-run this command." >&2
  exit 1
fi
dir="$HOME/.ciele"
mkdir -p "$dir"
curl -fsSL "${runtimeUrl}" -o "$dir/connector.mjs"
echo "Ciele Connector is starting. Keep this window open and finish pairing in your browser."
exec node "$dir/connector.mjs" --origin "${origin}" --return-url "${returnUrl}" --port ${port} --bootstrap
`;
  }

  return `$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 18+ is required. Install it, then re-run this command."
  return
}
$dir = Join-Path $env:LOCALAPPDATA "Ciele Connector"
New-Item -ItemType Directory -Force $dir | Out-Null
$connector = Join-Path $dir "connector.mjs"
Invoke-WebRequest "${runtimeUrl}" -OutFile $connector -UseBasicParsing
Write-Host "Ciele Connector is starting. Keep this window open and finish pairing in your browser."
& node $connector --origin "${origin}" --return-url "${returnUrl}" --port ${port} --bootstrap
`;
}
