"use client";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useId, useState, useTransition } from "react";
import type { TicketingProvider, TicketingTarget } from "@agent-hub/core";
import { Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  disconnectTicketingIntegrationAction,
  setTicketingTargetAction,
} from "@/app/actions";
import { DialogBody, DialogSection, Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TICKETING_PLATFORMS,
  ticketingConnectionOptions,
  ticketingTargetSummary,
  type TicketingConnectionOption,
} from "@/lib/ticketing-integrations";
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { RollInText } from "@/components/motion/roll-in-text";

function PlatformLogo({ provider }: { provider: TicketingProvider }) {
  const meta = TICKETING_PLATFORMS[provider];
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${meta.color}`}
    >
      {meta.initials}
    </span>
  );
}

/**
 * The desk's ticketing target (#1088, #1089): which Organization-owned
 * Salesforce or ServiceNow Application Connection the "Create a ticket"
 * channel files through. The credential lives on the Connection, so this
 * section only ever names one; there is nothing secret to type here.
 */
export function TicketingIntegrationSection({
  helpDeskId,
  target,
  legacyIntegration,
  connections,
  canEdit,
}: {
  helpDeskId: string;
  target: TicketingTarget | null | undefined;
  /** The retired password-grant ServiceNow registration, if the desk still holds one. */
  legacyIntegration: { name: string } | null;
  connections: TicketingConnectionOption[];
  canEdit: boolean;
}) {
  const available = target !== undefined;
  const options = ticketingConnectionOptions(connections);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [table, setTable] = useState("incident");
  const [requesterField, setRequesterField] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const fieldId = useId();

  const chosen = options.find((option) => option.id === connectionId) ?? null;
  const current = target
    ? (connections.find((connection) => connection.id === target.connectionId) ?? null)
    : null;

  const initialConnectionId = target?.connectionId ?? options[0]?.id ?? "";
  const initialTable = target?.provider === "servicenow" ? target.table : "incident";
  const initialRequesterField = target?.provider === "servicenow" ? (target.requesterEmailField ?? "") : "";
  const { leave } = useUnsavedChanges({
    dirty: dialogOpen && (connectionId !== initialConnectionId || table !== initialTable || requesterField !== initialRequesterField),
    confirmDelete,
    description: "The ticketing target changes are not saved yet.",
  });

  function closeDialog() {
    if (!isPending) leave(() => setDialogOpen(false));
  }

  function openDialog() {
    if (!available) return;
    setConnectionId(target?.connectionId ?? options[0]?.id ?? "");
    setTable(target?.provider === "servicenow" ? target.table : "incident");
    setRequesterField(
      target?.provider === "servicenow" ? (target.requesterEmailField ?? "") : "",
    );
    setSubmitError(null);
    setDialogOpen(true);
  }

  function save() {
    if (!available) return;
    if (!chosen) {
      setSubmitError("Choose a connection.");
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      try {
        await setTicketingTargetAction(helpDeskId, {
          connectionId: chosen.id,
          ...(chosen.provider === "servicenow"
            ? { table, requesterEmailField: requesterField }
            : {}),
        });
      } catch (error) {
        if (isRedirectError(error)) throw error;
        setSubmitError(
          error instanceof Error ? error.message : "Could not save the ticketing target",
        );
        return;
      }
      toast.success(`Tickets now go to ${TICKETING_PLATFORMS[chosen.provider].label}`);
      setDialogOpen(false);
    });
  }

  function disconnect() {
    confirmDelete({
      title: "Remove the ticketing target?",
      description:
        "The Create a ticket channel stops filing records. The application connection itself stays connected.",
      confirmLabel: "Remove",
      onConfirm: async () => {
        await disconnectTicketingIntegrationAction(helpDeskId);
        toast.success("Ticketing target removed");
      },
    });
  }

  return (
    <>
      <p className="text-muted-foreground -mt-3 mb-4 text-sm">
        Choose where the Create a ticket channel files records. Connect Salesforce or ServiceNow
        under Knowledge → Applications first.
      </p>

      {legacyIntegration && !target && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm"
        >
          <p className="font-semibold">{legacyIntegration.name} no longer files tickets</p>
          <p className="text-muted-foreground mt-1">
            ServiceNow ticketing with a stored password is retired. Connect ServiceNow under
            Knowledge → Applications and choose that connection here. The stored credentials
            are deleted in a later release, or now with Remove.
          </p>
          {canEdit && (
            <Button variant="outline" size="sm" className="mt-3" onClick={disconnect}>
              Remove the stored credentials
            </Button>
          )}
        </div>
      )}

      <Card size="sm" className="gap-0 p-4">
        {!available ? (
          <p className="text-muted-foreground text-sm" role="status">Ticketing setup is temporarily unavailable. Try again later.</p>
        ) : target ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <PlatformLogo provider={target.provider} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">
                {TICKETING_PLATFORMS[target.provider].label}
              </p>
              <p className="text-muted-foreground truncate text-sm">
                {ticketingTargetSummary(target, current)}
              </p>
            </div>
            <StatusPill
              status={current?.status === "connected" ? "online" : "warning"}
              primaryText={current?.status === "connected" ? "Connected" : "Needs attention"}
            />
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={openDialog} disabled={isPending}>
                  Change
                </Button>
                <Hint label="Remove ticketing target">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove ticketing target"
                    className="text-destructive hover:text-destructive"
                    onClick={disconnect}
                    disabled={isPending}
                  >
                    <AnimatedIcon icon={Trash2} size={16} />
                  </Button>
                </Hint>
              </>
            )}
          </div>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Organization connection to Salesforce or ServiceNow yet. Add one under Knowledge →
            Applications, then come back here.
          </p>
        ) : (
          canEdit && (
            <Button variant="outline" className="h-11 w-full font-semibold" onClick={openDialog}>
              Choose a connection
            </Button>
          )
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Where should tickets go?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogSection>
              <div className="space-y-4 rounded-xl bg-muted/40 p-4">
                <div>
                  <Label htmlFor={`${fieldId}-connection`} className="font-semibold">
                    Connection
                  </Label>
                  <Select
                    value={connectionId}
                    onValueChange={(value) => setConnectionId(String(value))}
                  >
                    <SelectTrigger id={`${fieldId}-connection`} className="mt-2 h-11">
                      <SelectValue>
                        {() =>
                          chosen
                            ? `${chosen.name} (${TICKETING_PLATFORMS[chosen.provider].label})`
                            : "Choose a connection"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} ({TICKETING_PLATFORMS[option.provider].label})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {chosen?.provider === "salesforce" && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      Each ticket opens a Case. The Salesforce user who connected the application
                      must be allowed to create Cases.
                    </p>
                  )}
                </div>
                {chosen?.provider === "servicenow" && (
                  <>
                    <div>
                      <Label htmlFor={`${fieldId}-table`} className="font-semibold">
                        Table
                      </Label>
                      <Input
                        id={`${fieldId}-table`}
                        value={table}
                        onChange={(e) => setTable(e.target.value)}
                        placeholder="incident"
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2 h-11"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`${fieldId}-requester`} className="font-semibold">
                        Requester email column
                      </Label>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        Optional. Leave it empty to add the email to the description.
                      </p>
                      <Input
                        id={`${fieldId}-requester`}
                        value={requesterField}
                        onChange={(e) => setRequesterField(e.target.value)}
                        placeholder="u_requester_email"
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2 h-11"
                      />
                    </div>
                  </>
                )}
              </div>
            </DialogSection>
            <DialogSection>
              {submitError && (
                <p role="alert" className="text-destructive text-sm break-words">
                  {submitError}
                </p>
              )}
            </DialogSection>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button loading={isPending} onClick={save} disabled={isPending}>
              <RollInText text={isPending ? "Saving…" : "Save"} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDeleteModal}
    </>
  );
}
