"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HelpDesk, TicketingPlatform } from "@agent-hub/core";
import { ChevronLeft, CircleCheck, Search, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  connectServiceNowIntegrationAction,
  disconnectTicketingIntegrationAction,
} from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Input, PasswordInput } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  SUPPORTED_TICKETING_PLATFORMS,
  TICKETING_PLATFORMS,
  TICKETING_PLATFORM_ORDER,
} from "@/lib/ticketing-integrations";

interface ServiceNowFormState {
  name: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

const EMPTY_FORM: ServiceNowFormState = {
  name: "",
  baseUrl: "",
  clientId: "",
  clientSecret: "",
  username: "",
  password: "",
};

function PlatformLogo({ platform }: { platform: TicketingPlatform }) {
  const meta = TICKETING_PLATFORMS[platform];
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white ${meta.color}`}
    >
      {meta.initials}
    </span>
  );
}

export function TicketingIntegrationSection({
  helpDeskId,
  integration,
  canEdit,
}: {
  helpDeskId: string;
  integration: HelpDesk["ticketingIntegration"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<"list" | "servicenow">("list");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ServiceNowFormState>(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();

  function openBrowseDialog() {
    setStep("list");
    setQuery("");
    setDialogOpen(true);
  }

  function handleConnectClick(platform: TicketingPlatform) {
    if (!SUPPORTED_TICKETING_PLATFORMS.includes(platform)) {
      toast.info(`${TICKETING_PLATFORMS[platform].label} integration is coming soon.`);
      return;
    }
    setForm(EMPTY_FORM);
    setStep("servicenow");
    setDialogOpen(true);
  }

  function connect() {
    if (
      !form.name.trim() ||
      !form.baseUrl.trim() ||
      !form.clientId.trim() ||
      !form.clientSecret.trim() ||
      !form.username.trim() ||
      !form.password.trim()
    ) {
      toast.error("All fields are required");
      return;
    }
    startTransition(async () => {
      await connectServiceNowIntegrationAction(helpDeskId, form);
      toast.success("ServiceNow connected");
      setDialogOpen(false);
      router.refresh();
    });
  }

  function disconnect() {
    if (!window.confirm("Disconnect this ticketing integration?")) return;
    startTransition(async () => {
      await disconnectTicketingIntegrationAction(helpDeskId);
      toast.success("Integration disconnected");
      router.refresh();
    });
  }

  const filteredPlatforms = TICKETING_PLATFORM_ORDER.filter((platform) =>
    TICKETING_PLATFORMS[platform].label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <div className="mt-10 flex items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight">Ticketing Integration</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
          Optional
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Connect a ticketing system to automatically create cases from chat
        escalations. Set this up before configuring support channels to
        enable ticket creation per channel.
      </p>

      <Card size="sm" className="mt-5 gap-0 p-4">
        {integration ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <PlatformLogo platform={integration.platform} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{integration.name}</p>
              <p className="text-muted-foreground truncate text-sm">
                {TICKETING_PLATFORMS[integration.platform].label} ·{" "}
                {integration.config.baseUrl}
              </p>
            </div>
            <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium">
              <CircleCheck className="size-3.5" /> Connected
            </span>
            {canEdit && (
              <Hint label="Disconnect integration">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Disconnect integration"
                  className="text-destructive hover:text-destructive"
                  onClick={disconnect}
                  disabled={isPending}
                >
                  <AnimatedIcon icon={Trash2} size={16} />
                </Button>
              </Hint>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm">
              Select a ticketing platform to automatically create cases from
              chat escalations.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TICKETING_PLATFORM_ORDER.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => handleConnectClick(platform)}
                  className="hover:bg-muted/60 flex flex-col items-center gap-2 rounded-lg border bg-background px-3 py-4 text-center transition-colors disabled:pointer-events-none disabled:opacity-60"
                >
                  <PlatformLogo platform={platform} />
                  <span className="text-sm font-medium">
                    {TICKETING_PLATFORMS[platform].label}
                  </span>
                </button>
              ))}
            </div>
            {canEdit && (
              <Button
                variant="outline"
                className="mt-4 h-11 w-full font-semibold"
                onClick={openBrowseDialog}
              >
                <AnimatedIcon icon={Unplug} size={16} /> Browse all integrations
              </Button>
            )}
          </>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          {step === "list" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add integration</DialogTitle>
              </DialogHeader>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="h-10 pl-8"
                />
              </div>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {filteredPlatforms.map((platform) => (
                  <div
                    key={platform}
                    className="flex items-center gap-3 rounded-xl border px-4 py-3"
                  >
                    <PlatformLogo platform={platform} />
                    <span className="min-w-0 flex-1 font-medium">
                      {TICKETING_PLATFORMS[platform].label}
                    </span>
                    <Button variant="outline" onClick={() => handleConnectClick(platform)}>
                      Connect
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep("list")}
                className="text-primary flex items-center gap-1 text-sm font-semibold hover:opacity-70"
              >
                <ChevronLeft className="size-4" strokeWidth={3} /> Back
              </button>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <PlatformLogo platform="servicenow" />
                  <DialogTitle>Enter your ServiceNow authentication details</DialogTitle>
                </div>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto rounded-xl bg-muted/40 p-4">
                <div>
                  <Label className="font-semibold">
                    Name of Integration <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    A generic name that can help you remember this.
                  </p>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Name"
                    className="mt-2 h-11"
                  />
                </div>
                <div>
                  <Label className="font-semibold">
                    Base URL <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Enter the base URL of your account.
                  </p>
                  <Input
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="Base URL"
                    className="mt-2 h-11"
                  />
                </div>
                <div>
                  <Label className="font-semibold">
                    Client ID <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Enter your client ID.
                  </p>
                  <Input
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    placeholder="Client ID"
                    className="mt-2 h-11"
                  />
                </div>
                <div>
                  <Label className="font-semibold">
                    Client secret <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Enter your integration client secret.
                  </p>
                  <PasswordInput
                    value={form.clientSecret}
                    onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                    placeholder="Client secret"
                    className="mt-2 h-11"
                  />
                </div>
                <div>
                  <Label className="font-semibold">
                    Username <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Enter your username.
                  </p>
                  <Input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="Username"
                    className="mt-2 h-11"
                  />
                </div>
                <div>
                  <Label className="font-semibold">
                    Password <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Enter your password.
                  </p>
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Password"
                    className="mt-2 h-11"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={connect} disabled={isPending}>
                  {isPending ? "Connecting..." : "Connect"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
