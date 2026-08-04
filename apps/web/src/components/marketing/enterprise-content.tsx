import Link from "next/link";
import { MousePointerClick } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { AdminMetrics } from "@/components/marketing/admin-metrics";
import { GovernanceOrbit } from "@/components/marketing/governance-orbit";

interface Column {
  title: string;
  body: string;
}

/* Everything below describes what the platform does today: Supabase Auth with
   Google/Microsoft SSO, the in-app role model, org-owned Provider Connections
   with usage reporting, and the Inbox/Insights/Alerts surfaces. Anything not
   built yet is left out rather than promised. */
const GOVERNANCE: Column[] = [
  {
    title: "Single sign-on",
    body: "Members sign in through Google or Microsoft, or with email and password. Assistants themselves can sit behind your identity provider, so a chat only answers once the visitor is who they say they are.",
  },
  {
    title: "Control every member",
    body: "Invite people into your organization and give each one a role that scopes what they can see and change. Access is enforced in the database, not just the interface.",
  },
  {
    title: "Model access and spend",
    body: "Provider connections belong to the organization. Choose which models your assistants may use, watch token usage per assistant, and cut off a provider from one place.",
  },
  {
    title: "Audit trails",
    body: "Every conversation is inspectable: which flow handled the turn, which sources the answer cited, which tools ran and what they returned. Traces age out on the retention window you set.",
  },
];

const DASHBOARD: Column[] = [
  {
    title: "Inbox",
    body: "Read any conversation end to end, with workflow markers, citations and the visitor's session context beside it. Export one transcript or the whole message-level record.",
  },
  {
    title: "Insights",
    body: "Resolution rate, answer ratings, escalations, languages, unique visitors — over any window, filtered to the assistants you care about.",
  },
  {
    title: "Improvements",
    body: "Bad answers become tracked work: flagged from the Inbox or raised automatically on escalation, then triaged on a board with owners and priorities.",
  },
  {
    title: "Alerts",
    body: "When an integration's credentials stop working the platform raises it, and clears it again once the connection recovers. No silent decay.",
  },
];

function ColumnList({ columns }: { columns: Column[] }) {
  return (
    <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {columns.map((column) => (
        <div key={column.title}>
          <h3 className="text-foreground text-sm font-medium">{column.title}</h3>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{column.body}</p>
        </div>
      ))}
    </div>
  );
}

export function EnterpriseContent() {
  return (
    <main className="relative px-4 pb-24 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        {/* Hero */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-muted-foreground flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider">
              <MousePointerClick className="size-3.5" strokeWidth={1.75} />
              Governance
            </p>
            <h1 className="text-foreground mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Enterprise governance
            </h1>
          </div>
          <p className="text-muted-foreground max-w-md text-base leading-relaxed">
            Every assistant, knowledge source and conversation configured, monitored and
            governed from one control plane your whole institution shares.
          </p>
        </div>

        <section className="mt-12">
          <GovernanceOrbit />
          <ColumnList columns={GOVERNANCE} />
        </section>

        {/* Admin dashboard */}
        <section className="mt-24">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
                Admin dashboard
              </p>
              <h2 className="text-foreground mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                See what your assistants are doing
              </h2>
            </div>
            <p className="text-muted-foreground max-w-md text-base leading-relaxed">
              One console for the whole organization: live conversation volume, answer
              quality, escalations and the health of every integration behind them.
            </p>
          </div>

          <div className="mt-10">
            <AdminMetrics />
          </div>
          <ColumnList columns={DASHBOARD} />
        </section>

        {/* CTA */}
        <section className="border-border bg-background/40 mt-24 rounded-2xl border p-8 sm:p-12">
          <h2 className="text-foreground text-2xl font-semibold tracking-tight">
            Roll it out across the institution
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
            Tell us how your teams are organized and which systems the assistants need to
            reach. We will walk you through the setup, the roles and the numbers.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button nativeButton={false} render={<Link href="/contact/sales" />}>
              <span>Talk to sales</span>
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/pricing" />}>
              <span>See pricing</span>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
