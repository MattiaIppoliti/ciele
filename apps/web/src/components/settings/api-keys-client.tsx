"use client";

import { useState, useTransition } from "react";
import type { OrgApiKey, Role } from "@agent-hub/core";
import { Ban, ChevronDown, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions";
import { MorphingModal } from "@/components/motion/morphing-modal";
import { Table, type TableColumn } from "@/components/motion/table";
import { formatDay } from "@/lib/format";
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

export function ApiKeysClient({
  keys,
  currentRole,
  demo,
}: {
  keys: OrgApiKey[];
  /** Caps the roles offered for a new key at the signed-in Member's own. */
  currentRole: Role | null;
  demo: boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [mintedSecret, setMintedSecret] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<OrgApiKey | null>(null);
  const [isPending, startTransition] = useTransition();
  const { copyText, isCopied } = useCopyFeedback<string>();

  const assignable = ALL_ROLES.filter((r) =>
    canAssignApiKeyRole(currentRole, r)
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const { secret } = await createApiKeyAction(name, role);
      setMintedSecret(secret);
      setName("");
    });
  }

  function handleRevoke() {
    if (!pendingRevoke || isPending) return;
    startTransition(async () => {
      await revokeApiKeyAction(pendingRevoke.id);
      toast.success("API key revoked");
      setPendingRevoke(null);
    });
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
            <p className="truncate font-medium">{key.name}</p>
            <p className="text-muted-foreground truncate font-mono text-xs">
              {key.secretHint}…
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
          {key.role}
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
        <span className="text-muted-foreground">{formatDay(key.createdAt)}</span>
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
          {key.lastUsedAt ? formatDay(key.lastUsedAt) : "Never"}
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
          <Badge variant="outline">Revoked</Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      width: "12%",
      cell: (key) =>
        key.revokedAt ? null : (
          <Hint label="Revoke key">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Revoke ${key.name}`}
              onClick={() => setPendingRevoke(key)}
            >
              <AnimatedIcon icon={Ban} size={16} />
            </Button>
          </Hint>
        ),
    },
  ];

  return (
    <div className={`mt-8 space-y-8 ${isPending ? "opacity-70" : ""}`}>
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
      />

      <div>
        <h2 className="text-lg font-semibold">Create key</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The secret is shown once, right after creation. Store it somewhere
          safe, it cannot be retrieved later.
        </p>
        <form onSubmit={handleCreate} className="mt-3 flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. CI deploy)"
            className="w-64"
            required
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" className="capitalize" />
              }
            >
              {role}
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
            <Plus className="size-4" /> Create key
          </Button>
        </form>
      </div>

      {/* The one and only time the plaintext secret exists client-side. */}
      <MorphingModal
        viewId={mintedSecret ? "secret" : null}
        onClose={() => setMintedSecret(null)}
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
            onClick={() =>
              mintedSecret &&
              void copyText("minted", mintedSecret).then((ok) =>
                ok
                  ? toast.success("API key copied")
                  : toast.error("Could not copy the key")
              )
            }
            className="bg-muted hover:bg-muted/70 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left font-mono text-sm break-all transition-colors"
          >
            {mintedSecret}
            <CopyFeedbackIcon copied={isCopied("minted")} className="size-4 shrink-0" />
          </button>
          <div className="flex justify-end">
            <Button onClick={() => setMintedSecret(null)}>Done</Button>
          </div>
        </div>
      </MorphingModal>

      <MorphingModal
        viewId={pendingRevoke ? "revoke" : null}
        onClose={() => !isPending && setPendingRevoke(null)}
        placement="bottom"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="bg-destructive/10 text-destructive rounded-full p-2">
              <AnimatedIcon icon={TriangleAlert} size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">
                Revoke &ldquo;{pendingRevoke?.name}&rdquo;?
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Anything using this key stops working immediately. This cannot
                be undone; you can always create a new key.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setPendingRevoke(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={isPending}
            >
              <Ban className="size-4" /> Revoke key
            </Button>
          </div>
        </div>
      </MorphingModal>
    </div>
  );
}
