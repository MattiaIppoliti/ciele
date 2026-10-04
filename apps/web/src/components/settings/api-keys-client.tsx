"use client";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useState, useTransition } from "react";
import type { OrgApiKey, Role } from "@agent-hub/core";
import { Ban, BookOpen, ChevronDown, KeyRound, Plus, Trash2, TriangleAlert } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { createApiKeyAction, deleteApiKeyAction, revokeApiKeyAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { Table, type TableColumn } from "@/components/motion/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { capitalize, formatDay } from "@/lib/format";
import { canAssignApiKeyRole } from "@/lib/rbac";
import {
  Badge,
  Button,
  CopyFeedbackIcon,
  Hint,
  Input,
  useCopyFeedback,
} from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ALL_ROLES: Role[] = ["owner", "admin", "editor", "viewer"];

/** The two confirmations a key row can ask for: revoke an active key, delete a revoked one. */
const CONFIRM = {
  revoke: {
    verb: "Revoke",
    icon: TriangleAlert,
    buttonIcon: Ban,
    body: "Anything using this key stops working immediately. This cannot be undone; you can always create a new key.",
    run: revokeApiKeyAction,
    done: "API key revoked",
  },
  delete: {
    verb: "Delete",
    icon: Trash2,
    buttonIcon: Trash2,
    body: "The key is already revoked. Deleting it removes it from this list for good.",
    run: deleteApiKeyAction,
    done: "API key deleted",
  },
} as const;

export function ApiKeysClient({
  keys,
  currentRole,
  demo,
  apiDocumentationUrl,
}: {
  keys: OrgApiKey[];
  /** Caps the roles offered for a new key at the signed-in Member's own. */
  currentRole: Role | null;
  demo: boolean;
  apiDocumentationUrl: string;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [mintedSecret, setMintedSecret] = useState<string | null>(null);
  // The secret cannot be shown twice, so a stray Escape or backdrop click must
  // not throw it away before it was copied.
  const [secretCopied, setSecretCopied] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [pending, setPending] = useState<{
    key: OrgApiKey;
    action: keyof typeof CONFIRM;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { copyText, isCopied } = useCopyFeedback<string>();

  const assignable = ALL_ROLES.filter((r) =>
    canAssignApiKeyRole(currentRole, r)
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const { secret } = await createApiKeyAction(name, role);
        setSecretCopied(false);
        setConfirmingClose(false);
        setMintedSecret(secret);
        setName("");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create the key",
        );
      }
    });
  }

  function handleConfirm() {
    if (!pending || isPending) return;
    const { verb, run, done } = CONFIRM[pending.action];
    startTransition(async () => {
      try {
        await run(pending.key.id);
        toast.success(done);
        setPending(null);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Could not ${verb.toLowerCase()} the key`,
        );
      }
    });
  }

  function closeSecret() {
    setMintedSecret(null);
    setConfirmingClose(false);
  }

  const columns: TableColumn<OrgApiKey>[] = [
    {
      key: "name",
      header: "Name",
      accessor: (key) => key.name,
      sortable: true,
      width: "30%",
      cell: (key) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
            <KeyRound className="text-foreground/70 size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium"><RollInText text={key.name} /></p>
            <p className="text-muted-foreground truncate font-mono text-xs">
              <RollInText text={`${key.secretHint}…`} />
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      accessor: (key) => key.role,
      sortable: true,
      width: "14%",
      cell: (key) => (
        <Badge variant="outline" className="capitalize">
          <RollInText text={key.role} />
        </Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      accessor: (key) => key.createdAt,
      sortable: true,
      width: "16%",
      hideBelowSm: true,
      cell: (key) => (
        <span className="text-muted-foreground"><RollInText text={formatDay(key.createdAt)} /></span>
      ),
    },
    {
      key: "lastUsed",
      header: "Last used",
      accessor: (key) => key.lastUsedAt ?? "",
      sortable: true,
      width: "16%",
      hideBelowSm: true,
      cell: (key) => (
        <span className="text-muted-foreground">
          <RollInText text={key.lastUsedAt ? formatDay(key.lastUsedAt) : "Never"} />
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (key) => (key.revokedAt ? "revoked" : "active"),
      sortable: true,
      width: "12%",
      cell: (key) =>
        key.revokedAt ? (
          <StatusPill status="offline" primaryText={<RollInText text="Revoked" />} />
        ) : (
          <StatusPill status="online" primaryText={<RollInText text="Active" />} />
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      width: "12%",
      cell: (key) =>
        key.revokedAt ? (
          <Hint label="Delete key">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${key.name}`}
              className="text-destructive hover:text-destructive"
              onClick={() => setPending({ key, action: "delete" })}
            >
              <AnimatedIcon icon={Trash2} size={16} />
            </Button>
          </Hint>
        ) : (
          <Hint label="Revoke key">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Revoke ${key.name}`}
              onClick={() => setPending({ key, action: "revoke" })}
            >
              <AnimatedIcon icon={Ban} size={16} />
            </Button>
          </Hint>
        ),
    },
  ];

  const dialog = pending ? { ...CONFIRM[pending.action], name: pending.key.name } : null;

  return (
    <div className={`mt-8 ${isPending ? "opacity-70" : ""}`}>
      <SectionTimeline>
      <TimelineSection title="API keys">
<div className="space-y-4">
      <Button
        variant="outline"
        render={
          <a href={apiDocumentationUrl} target="_blank" rel="noopener noreferrer" />
        }
      >
        <BookOpen className="size-4" /> API Documentation
      </Button>
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode, API keys are not persisted
        </Badge>
      )}

      <Table
        data={keys}
        columns={columns}
        getRowId={(key) => key.id}
        emptyState="No API keys yet, you'll need one to call the API, CLI or MCP server."
        footer={<TablePagination total={keys.length} noun="API key" />}
      />
</div>
      </TimelineSection>

      <TimelineSection title="Create key" boxed>
        <p className="text-muted-foreground text-sm">
          The secret is shown only once. Store it somewhere safe.
        </p>
        <form onSubmit={handleCreate} className="mt-3 flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. CI deploy)"
            aria-label="Key name"
            autoComplete="off"
            className="w-64"
            required
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Role: ${role}`}
                />
              }
            >
              <RollInText text={capitalize(role)} />
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {assignable.map((r) => (
                <DropdownMenuItem
                  key={r}
                  className="capitalize"
                  onClick={() => setRole(r)}
                >
                  {r}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="submit" disabled={isPending}>
            <Plus className="size-4" />
            <RollInText text={isPending ? "Creating…" : "Create key"} />
          </Button>
        </form>
      </TimelineSection>

      </SectionTimeline>

      {/* The one and only time the plaintext secret exists client-side. */}
      <MorphingModal
        viewId={mintedSecret ? "secret" : null}
        title="Your new API key"
        onClose={() => {
          if (secretCopied) closeSecret();
          else setConfirmingClose(true);
        }}
        placement="bottom"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-muted rounded-full p-2">
              <AnimatedIcon icon={KeyRound} size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">Your new API key</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Copy it now: this is the only time it will be shown. Only a
                hash is stored on our side.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Copy API key"
            onClick={() =>
              mintedSecret &&
              void copyText("minted", mintedSecret).then((ok) => {
                if (ok) {
                  setSecretCopied(true);
                  setConfirmingClose(false);
                  toast.success("API key copied");
                } else {
                  toast.error("Could not copy the key");
                }
              })
            }
            className="press-control bg-muted hover:bg-muted/70 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left font-mono text-sm break-all transition-colors"
          >
            {mintedSecret}
            <CopyFeedbackIcon copied={isCopied("minted")} className="size-4 shrink-0" />
          </button>
          {confirmingClose && (
            <p role="alert" className="text-destructive text-sm">
              You have not copied this key. Once you close this, it cannot be
              shown again.
            </p>
          )}
          <div className="flex justify-end">
            {secretCopied || confirmingClose ? (
              <Button
                variant={secretCopied ? "default" : "destructive"}
                onClick={closeSecret}
              >
                <RollInText text={secretCopied ? "Done" : "Close without copying"} />
              </Button>
            ) : (
              <Button onClick={() => setConfirmingClose(true)}>Done</Button>
            )}
          </div>
        </div>
      </MorphingModal>

      <MorphingModal
        viewId={pending?.action ?? null}
        title={dialog ? `${dialog.verb} “${dialog.name}”?` : "API key"}
        onClose={() => !isPending && setPending(null)}
        placement="bottom"
      >
        {dialog && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="bg-destructive/10 text-destructive rounded-full p-2">
                <AnimatedIcon icon={dialog.icon} size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold">
                  {dialog.verb} &ldquo;<RollInText text={dialog.name} />&rdquo;?
                </h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {dialog.body}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setPending(null)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={isPending}
              >
                <dialog.buttonIcon className="size-4" /> {dialog.verb} key
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
    </div>
  );
}
