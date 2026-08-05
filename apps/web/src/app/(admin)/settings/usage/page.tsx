import { redirect } from "next/navigation";
import type { UsageDailyRow, UsageResource } from "@agent-hub/core";
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
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { formatCredits, summarizeUsage } from "@/lib/usage-summary";
import { budgetMeterView, usageLimitsView } from "@/lib/usage-meters";
import {
  DailyBudgetCard,
  UnmeteredNotice,
  UsageLimitsBlock,
} from "@/components/settings/usage-limits";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { UsagePies } from "@/components/settings/usage-pies";

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
  crawl: "Crawl",
};

/** The three meters, in the order a plan lists them. */
const METERS: {
  resource: UsageResource;
  title: string;
  description: string;
}[] = [
  {
    resource: "ai",
    title: "AI",
    description: "Intent routing, answers, and scheduled AI work",
  },
  {
    resource: "embedding",
    title: "Embeddings",
    description: "Knowledge indexing and vector search queries",
  },
  {
    resource: "scraping",
    title: "Scraping",
    description: "Pages fetched when a Website Source is crawled",
  },
];

const formatCount = new Intl.NumberFormat("en-US").format;

export default async function UsageSettingsPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  // Usage is org-wide operational data — admins and owners only, like the
  // provider/budget settings it complements.
  if (!canManageMembers(role)) redirect("/settings/profile");

  // The plan's meters, the 30-day ledger, and the org's own daily ceiling: the
  // three things that can pause an assistant, read together so the page can
  // show them in one language.
  const [rows, limits, budget, usedTokens, usedEur] = await Promise.all([
    db.getOrgUsageDaily(organizationId, USAGE_WINDOW_DAYS),
    getEnterpriseCapabilities().metering.getUsageLimits(organizationId),
    db.getOrgBudget(organizationId),
    db.getOrgTokensUsedToday(organizationId),
    db.getOrgCostUsedToday(organizationId),
  ]);
  const summary = summarizeUsage(rows);
  const view = limits ? usageLimitsView(limits, new Date().toISOString()) : null;
  // A plan whose every meter is uncapped (a staff exemption, or billing data too
  // stale to enforce against) is not a capped state: gauges of zero under
  // "each meter is capped" copy would misdescribe it.
  const limitsView = view && !view.allUncapped ? view : null;
  const dailyBudget = budgetMeterView({
    tokenLimit: budget?.dailyTokenLimit ?? null,
    euroLimit: budget?.dailyEuroLimit ?? null,
    usedTokens,
    usedEur,
  });

  return (
    <SettingsPanel
      title="Usage"
      description={
        <>
          {session.organization.name}&apos;s usage over the last{" "}
          {USAGE_WINDOW_DAYS} days, every model call and crawled page, split by
          the credential that funded it. Credits are estimated cost: one credit
          is a cent of what the work cost to run.
        </>
      }
    >
        <UsagePies
          byResource={METERS.map((meter) => ({
            key: meter.resource,
            label: meter.title,
            credits: summary.byResource[meter.resource].credits,
          }))}
          byFunding={[
            { key: "platform", label: "Platform plan", credits: summary.platform.credits },
            { key: "own", label: "Your credentials", credits: summary.own.credits },
          ]}
        />

        {limitsView ? (
          <UsageLimitsBlock
            view={limitsView}
            budget={dailyBudget}
            ownCredentialsOnly={
              summary.own.credits > 0 && summary.platform.credits === 0
            }
          />
        ) : (
          <>
            <UnmeteredNotice plan={view?.plan} />
            {dailyBudget ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <DailyBudgetCard budget={dailyBudget} />
              </div>
            ) : null}
          </>
        )}

        <h2 className="mt-8 text-lg font-semibold tracking-tight">
          Last {USAGE_WINDOW_DAYS} days
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {METERS.map((meter) => {
            const usage = summary.byResource[meter.resource];
            return (
              <Card key={meter.resource}>
                <CardHeader>
                  <CardTitle>{meter.title}</CardTitle>
                  <CardDescription>{meter.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">
                      {formatCredits(usage.platformCredits)}
                    </span>{" "}
                    platform-funded credits
                  </p>
                  <p className="text-muted-foreground">
                    {meter.resource === "scraping"
                      ? `${formatCount(usage.pages)} pages · ${formatCount(usage.calls)} crawls`
                      : `${formatCount(usage.calls)} calls · ${formatCount(
                          usage.inputTokens + usage.outputTokens
                        )} tokens`}
                  </p>
                  {usage.credits > usage.platformCredits && (
                    <p className="text-muted-foreground">
                      + {formatCredits(usage.credits - usage.platformCredits)} on
                      your own credentials
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Platform vs your own credentials</CardTitle>
            <CardDescription>
              Platform-funded work runs on the platform&apos;s keys and counts
              against your plan; work on your own API keys or federated
              credentials is yours end to end and is never counted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="font-medium">Platform:</span>{" "}
              {formatCredits(summary.platform.credits)} credits ·{" "}
              {formatCount(summary.platform.tokens)} tokens ·{" "}
              {formatCount(summary.platform.pages)} pages
            </p>
            <p>
              <span className="font-medium">Your credentials:</span>{" "}
              {formatCredits(summary.own.credits)} credits ·{" "}
              {formatCount(summary.own.tokens)} tokens ·{" "}
              {formatCount(summary.own.pages)} pages
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
                No usage recorded yet. Usage appears here as soon as an
                assistant answers a message, indexes knowledge, or crawls a
                website.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Ran on</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in · out</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={`${r.day}-${r.kind}-${r.credentialKind}-${r.provider}-${r.modelId}`}
                    >
                      <TableCell className="font-medium">{r.day}</TableCell>
                      <TableCell>{KIND_LABELS[r.kind]}</TableCell>
                      <TableCell>
                        {CREDENTIAL_LABELS[r.credentialKind]}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.modelId || r.provider || "N/A"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCount(r.calls)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.kind === "crawl"
                          ? "N/A"
                          : `${formatCount(r.inputTokens)} · ${formatCount(
                              r.outputTokens
                            )}`}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.kind === "crawl" ? formatCount(r.units) : "N/A"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
    </SettingsPanel>
  );
}
