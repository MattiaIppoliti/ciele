import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { startTopupCheckoutAction } from "@/app/(admin)/settings/billing/actions";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatCount, formatDay, formatEur } from "@/lib/format";
import { PendingSubmitButton } from "@/components/settings/pending-submit-button";

/**
 * Top-up credit packs on Billing (#852).
 *
 * The card leads with what the balance is *for*, because the ordering is the
 * product decision: a pack is drawn on only after a window's allowance is gone,
 * which is what makes it a buffer rather than a second wallet. It also prints
 * the price per credit beside the plan's own, so the reader can see for
 * themselves that sustained load is cheaper one tier up.
 */
export interface CreditPackView {
  slug: string;
  credits: number;
  priceEur: number;
}

export interface CreditGrantView {
  id: string;
  credits: number;
  source: string;
  createdAt: string;
  expiresAt: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  purchase: "Purchased",
  compensation: "Compensation",
  sales: "Sales",
  onboarding: "Onboarding",
};

export function CreditPacksCard({
  packs,
  balance,
  grants,
  planCreditPriceEur,
}: {
  packs: CreditPackView[];
  balance: number;
  grants: CreditGrantView[];
  /** What a credit costs inside the current plan, for the comparison. */
  planCreditPriceEur: number | null;
}) {
  if (packs.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Top-up credits</CardTitle>
        <CardDescription>
          Credits are used only after your plan allowance runs out, so answering doesn&apos;t pause.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          <RollingNumber value={Math.round(balance)} className="font-medium" />{" "}
          <span className="text-muted-foreground">credits held</span>
        </p>

        <div className="grid gap-3 @xl/settings:grid-cols-3">
          {packs.map((pack) => {
            const perCredit = pack.priceEur / pack.credits;
            return (
              <form
                key={pack.slug}
                action={startTopupCheckoutAction}
                className="rounded-lg border p-3"
              >
                <input type="hidden" name="pack" value={pack.slug} />
                <p className="font-medium tabular-nums">
                  {formatCount(pack.credits)} credits
                </p>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {formatEur(pack.priceEur)} · {formatEur(perCredit, 3)} per credit
                </p>
                <PendingSubmitButton
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  pendingLabel="Opening checkout…"
                  aria-label={`Buy ${formatCount(pack.credits)} credits`}
                >
                  Buy
                </PendingSubmitButton>
              </form>
            );
          })}
        </div>

        {planCreditPriceEur ? (
          <p className="text-muted-foreground text-xs">
            Your plan works out at {formatEur(planCreditPriceEur, 3)} per credit. Packs
            cost more on purpose: if you are buying one every month, moving up a
            tier is the cheaper answer.
          </p>
        ) : null}

        {grants.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">History</h3>
            <ul className="text-muted-foreground mt-1 space-y-1 text-xs">
              {grants.map((grant) => (
                <li key={grant.id} className="tabular-nums">
                  {formatDay(grant.createdAt)} ·{" "}
                  {formatCount(grant.credits)} credits ·{" "}
                  {SOURCE_LABELS[grant.source] ?? grant.source}
                  {grant.expiresAt ? ` · expires ${formatDay(grant.expiresAt)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
