"use client";

import { useId, useState, useTransition } from "react";
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
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

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

/** The connect form, in display order, which is also the order errors focus in. */
const FIELDS: Array<{
  key: keyof ServiceNowFormState;
  label: string;
  hint: string;
  placeholder: string;
  kind: "text" | "code" | "url" | "secret";
}> = [
  { key: "name", label: "Name of Integration", hint: "A generic name that can help you remember this.", placeholder: "Name", kind: "text" },
  { key: "baseUrl", label: "Base URL", hint: "Enter the base URL of your account.", placeholder: "Base URL", kind: "url" },
  { key: "clientId", label: "Client ID", hint: "Enter your client ID.", placeholder: "Client ID", kind: "code" },
  { key: "clientSecret", label: "Client secret", hint: "Enter your integration client secret.", placeholder: "Client secret", kind: "secret" },
  { key: "username", label: "Username", hint: "Enter your username.", placeholder: "Username", kind: "code" },
  { key: "password", label: "Password", hint: "Enter your password.", placeholder: "Password", kind: "secret" },
];

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const fieldId = useId();
  const [form, setForm] = useState<ServiceNowFormState>(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const [missing, setMissing] = useState<ReadonlySet<keyof ServiceNowFormState>>(
    () => new Set(),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  function openConnectDialog() {
    setForm(EMPTY_FORM);
    setMissing(new Set());
    setSubmitError(null);
    setDialogOpen(true);
  }

  function update(key: keyof ServiceNowFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
    if (missing.has(key)) {
      setMissing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  // Credentials typed here exist nowhere else, so a stray Escape or backdrop
  // click asks before throwing them away. While the connect is in flight the
  // dialog stays put: closing it would hide the outcome.
  const { leave } = useUnsavedChanges({
    dirty: dialogOpen && Object.values(form).some((value) => value !== ""),
    confirmDelete,
    description: "The connection details you entered are not saved.",
  });

  function requestCloseDialog() {
    if (isPending) return;
    leave(() => setDialogOpen(false));
  }

  function connect() {
    const empty = FIELDS.filter((f) => !form[f.key].trim()).map((f) => f.key);
    if (empty.length > 0) {
      setMissing(new Set(empty));
      document.getElementById(`${fieldId}-${empty[0]}`)?.focus();
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      try {
        await connectServiceNowIntegrationAction(helpDeskId, form);
      } catch (error) {
        if (isRedirectError(error)) throw error;
        setSubmitError(
          error instanceof Error ? error.message : "Could not connect ServiceNow",
        );
        return;
      }
      toast.success("ServiceNow connected");
      setDialogOpen(false);
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
        Create tickets from escalations. Set it up before your support channels.
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : requestCloseDialog())}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <PlatformLogo platform="servicenow" />
              <DialogTitle>
                Enter your ServiceNow authentication details
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto overscroll-contain rounded-xl bg-muted/40 p-4">
            {FIELDS.map((f) => {
              const id = `${fieldId}-${f.key}`;
              const errorId = `${id}-error`;
              const invalid = missing.has(f.key);
              const common = {
                id,
                value: form[f.key],
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  update(f.key, e.target.value),
                placeholder: f.placeholder,
                "aria-invalid": invalid || undefined,
                "aria-describedby": invalid ? errorId : undefined,
                className: "mt-2 h-11",
              };
              return (
                <div key={f.key}>
                  <Label htmlFor={id} className="font-semibold">
                    {f.label} <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-muted-foreground mt-0.5 text-sm">{f.hint}</p>
                  {f.kind === "secret" ? (
                    <PasswordInput {...common} autoComplete="new-password" />
                  ) : (
                    <Input
                      {...common}
                      type={f.kind === "url" ? "url" : undefined}
                      inputMode={f.kind === "url" ? "url" : undefined}
                      autoComplete="off"
                      spellCheck={f.kind === "text" ? undefined : false}
                    />
                  )}
                  {invalid && (
                    <p id={errorId} className="text-destructive mt-1.5 text-sm">
                      {f.label} is required.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {submitError && (
            <p role="alert" className="text-destructive text-sm break-words">
              {submitError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={requestCloseDialog}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={connect} disabled={isPending}>
              <RollInText text={isPending ? "Connecting…" : "Connect"} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDeleteModal}
    </>
  );
}
