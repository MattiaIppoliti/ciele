"use client";

import { useState } from "react";
import { RotateCw, ShieldCheck, SquareTerminal } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { ProviderBrandIcon } from "@/components/settings/provider-brand-icon";
import { TERMINAL_AUTH_COMMANDS } from "@/lib/local-terminal-setup";

function CommandBlock({
  command,
  label,
  copied,
  onCopy,
}: {
  command: string;
  label: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="bg-muted/50 flex items-center gap-2 rounded-lg border p-2">
      <code className="min-w-0 flex-1 overflow-x-auto px-1 font-mono text-xs text-foreground">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={onCopy}
      >
        <CopyFeedbackIcon copied={copied} className="size-4" />
      </Button>
    </div>
  );
}

export function LocalTerminalSetupGuide({
  onRefresh,
}: {
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { copyText, isCopied } = useCopyFeedback<string>();
  const [origin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );
  const oneCommandConnect = {
    unix: `curl -fsSL ${origin}/api/local-connector/install/sh | sh`,
    windows: `irm ${origin}/api/local-connector/install/ps1 | iex`,
  };

  async function copyCommand(command: string) {
    if (await copyText(command, command)) {
      toast.success("Command copied");
    } else {
      toast.error("Could not copy the command");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SquareTerminal className="size-4" /> Authorize from Terminal
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        snapPoints={[0.68, 0.92]}
        title="Authorize provider CLIs from Terminal"
        description="Sign in Codex and Claude locally after installing the Ciele Connector."
      >
        <div className="space-y-5 pt-3">
          <div className="border-primary/20 bg-primary/5 flex gap-3 rounded-xl border p-4">
            <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Ciele Connector is required</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Connect the Ciele Connector with the one terminal command below.
                The provider sign-in commands further down only authorize the CLIs.
              </p>
            </div>
          </div>

          <section className="border-border rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <SquareTerminal className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Connect with one command</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Paste the command for your OS. Requires Node.js 18+. Keep the
                  window open — this page detects the connector and pairs
                  automatically. No administrator rights needed.
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                  macOS / Linux
                </p>
                <CommandBlock
                  command={oneCommandConnect.unix}
                  label="macOS or Linux connect command"
                  copied={isCopied(oneCommandConnect.unix)}
                  onCopy={() => void copyCommand(oneCommandConnect.unix)}
                />
              </div>
              <div>
                <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                  Windows (PowerShell)
                </p>
                <CommandBlock
                  command={oneCommandConnect.windows}
                  label="Windows connect command"
                  copied={isCopied(oneCommandConnect.windows)}
                  onCopy={() => void copyCommand(oneCommandConnect.windows)}
                />
              </div>
            </div>
          </section>

          <div className="border-border bg-card rounded-xl border p-4">
            <div className="flex gap-3">
              <SquareTerminal className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">1. Open Terminal on this device</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  The provider CLIs must already be installed. Each login opens the
                  provider&apos;s official authentication flow; Ciele never receives the
                  resulting credentials.
                </p>
              </div>
            </div>
          </div>

          {TERMINAL_AUTH_COMMANDS.map((item, index) => (
            <section key={item.provider} className="border-border rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <ProviderBrandIcon
                  provider={item.provider}
                  className="text-muted-foreground mt-0.5 size-5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {index + 2}. Authorize {item.label}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {item.description}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                    Login
                  </p>
                  <CommandBlock
                    command={item.loginCommand}
                    label={`${item.label} login command`}
                    copied={isCopied(item.loginCommand)}
                    onCopy={() => void copyCommand(item.loginCommand)}
                  />
                </div>
                <div>
                  <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                    Verify connection
                  </p>
                  <CommandBlock
                    command={item.statusCommand}
                    label={`${item.label} status command`}
                    copied={isCopied(item.statusCommand)}
                    onCopy={() => void copyCommand(item.statusCommand)}
                  />
                </div>
              </div>
            </section>
          ))}

          <div className="border-primary/20 bg-primary/5 flex gap-3 rounded-xl border p-4">
            <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Credentials remain on your device</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                These commands only authorize the Codex and Claude CLIs. Hosted Preview
                still requires the Ciele Connector. The connector does not upload
                provider tokens and never enables personal subscriptions for published
                widget traffic.
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 pb-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            {onRefresh && (
              <Button
                type="button"
                onClick={() => {
                  onRefresh();
                  setOpen(false);
                }}
              >
                <RotateCw className="size-4" /> Refresh connector
              </Button>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
