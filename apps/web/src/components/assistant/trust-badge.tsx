import type { FlowTrust } from "@agent-hub/core";
import { Badge, Hint } from "@agent-hub/ui";
import { formatCount, formatPercent } from "@/lib/format";

/**
 * Earned-trust tier for a Flow (flow trust ledger): rolling pass rate over
 * graded answers. `watch` answers always offer human escalation.
 */
const TIER_STYLES: Record<FlowTrust["tier"], string> = {
  auto: "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
  queue: "text-muted-foreground",
  watch: "border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400",
};

export function TrustBadge({ trust }: { trust: FlowTrust }) {
  const rate =
    trust.runs > 0 ? Math.round((trust.passes / trust.runs) * 100) : 0;
  const detail = `${formatCount(trust.passes)} of ${formatCount(trust.runs)} graded answers passed (rolling window)`;
  // A Hint, not a title attribute: a title never shows on touch or to the
  // keyboard. The sr-only sentence is the same fact for a screen reader.
  return (
    <Hint label={detail}>
      <Badge
        variant="outline"
        tabIndex={0}
        className={`rounded-full tabular-nums ${TIER_STYLES[trust.tier]}`}
      >
        <span aria-hidden>
          {trust.tier} · {formatPercent(rate)} of {formatCount(trust.runs)}
        </span>
        <span className="sr-only">
          {trust.tier}: {detail}
        </span>
      </Badge>
    </Hint>
  );
}
