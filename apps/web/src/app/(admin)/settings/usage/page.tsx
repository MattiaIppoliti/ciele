import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import type { UsageDailyRow } from "@agent-hub/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const USAGE_WINDOW_DAYS = 30;

const CREDENTIAL_LABELS: Record<UsageDailyRow["credentialKind"], string> = {
  platform: "Platform",
  api_key: "Your API key",
  google_vertex_federated: "Federated (Vertex)",
  local_subscription: "Local subscription",
  unknown: "Unrecorded",
};

const KIND_LABELS: Record<UsageDailyRow["kind"], string> = {
  chat: "Chat",
  embedding: "Embedding",
};

interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

function totalsOf(rows: UsageDailyRow[]): UsageTotals {
  return rows.reduce(
    (sum, r) => ({
      calls: sum.calls + r.calls,
      inputTokens: sum.inputTokens + r.inputTokens,
      outputTokens: sum.outputTokens + r.outputTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0 }
  );
}

const formatCount = new Intl.NumberFormat("en-US").format;

export default async function UsageSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  // Usage is org-wide operational data — admins and owners only, like the
  // provider/budget settings it complements.
  if (!canManageMembers(role)) redirect("/");

  const rows = await db.getOrgUsageDaily(organizationId, USAGE_WINDOW_DAYS);
  const chat = totalsOf(rows.filter((r) => r.kind === "chat"));
  const embedding = totalsOf(rows.filter((r) => r.kind === "embedding"));
  const platformTokens = totalsOf(
    rows.filter((r) => r.credentialKind === "platform")
  );
  const ownTokens = totalsOf(
    rows.filter((r) => r.credentialKind !== "platform")
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:opacity-70"
          >
            <ChevronLeft className="size-4" strokeWidth={3} />
            All assistants
          </Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {session.organization.name}&apos;s AI usage over the last{" "}
          {USAGE_WINDOW_DAYS} days — every chat and embedding model call,
          split by the credential that answered it.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Chat</CardTitle>
              <CardDescription>
                Intent routing, answers, and scheduled AI work
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="font-medium">{formatCount(chat.calls)}</span>{" "}
                model calls
              </p>
              <p className="text-muted-foreground">
                {formatCount(chat.inputTokens)} tokens in ·{" "}
                {formatCount(chat.outputTokens)} tokens out
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Embeddings</CardTitle>
              <CardDescription>
                Knowledge indexing and vector search queries
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="font-medium">
                  {formatCount(embedding.calls)}
                </span>{" "}
                model calls
              </p>
              <p className="text-muted-foreground">
                {formatCount(embedding.inputTokens)} tokens in
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Platform vs your own credentials</CardTitle>
            <CardDescription>
              Platform-funded calls run on the platform&apos;s keys; calls on
              your own API keys or federated credentials are yours end to end.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="font-medium">Platform:</span>{" "}
              {formatCount(platformTokens.calls)} calls ·{" "}
              {formatCount(
                platformTokens.inputTokens + platformTokens.outputTokens
              )}{" "}
              tokens
            </p>
            <p>
              <span className="font-medium">Your credentials:</span>{" "}
              {formatCount(ownTokens.calls)} calls ·{" "}
              {formatCount(ownTokens.inputTokens + ownTokens.outputTokens)}{" "}
              tokens
            </p>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Daily breakdown</CardTitle>
            <CardDescription>
              Closed days come from the nightly rollup; today is live. All
              days are UTC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">
                No AI usage recorded yet. Usage appears here as soon as an
                assistant answers a message or indexes knowledge.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={`${r.day}-${r.kind}-${r.credentialKind}`}
                    >
                      <TableCell className="font-medium">{r.day}</TableCell>
                      <TableCell>{KIND_LABELS[r.kind]}</TableCell>
                      <TableCell>
                        {CREDENTIAL_LABELS[r.credentialKind]}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCount(r.calls)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCount(r.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCount(r.outputTokens)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
