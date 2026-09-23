"use client";

import { useState, useTransition } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  deleteCrawlerConnectionAction,
  setCrawlerConnectionAction,
} from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { Badge, Button, Card, Hint, Input, Label } from "@agent-hub/ui";

/**
 * Settings → Crawling: the Organization's own Apify account. The token is
 * sealed server-side and only its last four characters come back; the account
 * id is filled from Apify's own answer when the token is checked.
 */
export function CrawlerConnectionCard({
  connection,
  platformFallback,
}: {
  connection: { tokenHint: string; accountId: string; updatedAt: string } | null;
  /** Whether the platform's own Apify token covers crawls without one. */
  platformFallback: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await setCrawlerConnectionAction({
          token,
          accountId: accountId.trim() || undefined,
        });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Apify account connected");
        setToken("");
        setAccountId("");
        setEditing(false);
      } catch {
        toast.error("Couldn't save the Apify token");
      }
    });
  }

  function disconnect() {
    confirmDelete({
      title: "Disconnect Apify?",
      description:
        "Crawls already running on this account will stop with an error. New Apify crawls fall back to the platform's account, if there is one.",
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        await deleteCrawlerConnectionAction();
        toast.success("Apify account disconnected");
      },
    });
  }

  return (
    <Card size="sm" data-animate-group className="mt-8 gap-0 p-4">
      {confirmDeleteModal}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AnimatedIcon icon={Globe} size={16} iconClassName="text-primary" />
          <h2 className="text-base font-semibold">Apify</h2>
        </div>
        {!editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            <AnimatedIcon icon={Plus} size={16} />
            {connection ? "Replace token" : "Connect"}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        The managed crawler for file downloads, login-protected sites and large
        crawls. Find the token in Apify Console → Settings → API &amp;
        Integrations.{" "}
        {platformFallback
          ? "Without one, Apify crawls run on the platform's account."
          : "Without one, Apify is not available to this organization."}
      </p>

      {connection && !editing && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            API token
            <span className="text-muted-foreground ml-2 font-mono text-xs">
              {connection.tokenHint}
            </span>
          </span>
          {connection.accountId && (
            <Badge variant="outline" className="rounded-full font-mono">
              {connection.accountId}
            </Badge>
          )}
          <Hint label="Disconnect">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disconnect Apify"
              disabled={isPending}
              onClick={disconnect}
            >
              <AnimatedIcon icon={Trash2} size={16} />
            </Button>
          </Hint>
        </div>
      )}
      {!connection && !editing && (
        <p className="text-muted-foreground mt-3 text-sm">No account connected.</p>
      )}

      {editing && (
        <form onSubmit={save} className="mt-3 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="apify-token">API token</Label>
            <Input
              id="apify-token"
              type="password"
              autoComplete="off"
              placeholder="apify_api_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="apify-account">
              User ID <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="apify-account"
              autoComplete="off"
              placeholder="Checked against the token's own account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !token.trim()}>
              {isPending ? "Checking…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
