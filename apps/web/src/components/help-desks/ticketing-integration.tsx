"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HelpDesk, TicketingPlatform } from "@agent-hub/core";
import { CircleCheck, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
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
import { TICKETING_PLATFORMS } from "@/lib/ticketing-integrations";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";

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
  const [form, setForm] = useState<ServiceNowFormState>(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  function openConnectDialog() {
    setForm(EMPTY_FORM);
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
    confirmDelete({
      title: "Disconnect this ticketing integration?",
      description:
        "Escalations stop creating tickets, and the stored credentials are deleted.",
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        await disconnectTicketingIntegrationAction(helpDeskId);
        toast.success("Integration disconnected");
        router.refresh();
      },
    });
  }

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
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
              <PlatformLogo platform="servicenow" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">ServiceNow</p>
                <p className="text-muted-foreground text-sm">
                  Create ServiceNow cases from chat escalations.
                </p>
              </div>
            </div>
            {canEdit && (
              <Button
                variant="outline"
                className="mt-4 h-11 w-full font-semibold"
                onClick={openConnectDialog}
              >
                Connect ServiceNow
              </Button>
            )}
          </>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <PlatformLogo platform="servicenow" />
              <DialogTitle>
                Enter your ServiceNow authentication details
              </DialogTitle>
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
                onChange={(e) =>
                  setForm({ ...form, clientSecret: e.target.value })
                }
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
        </DialogContent>
      </Dialog>

      {confirmDeleteModal}
    </>
  );
}
