import type { FlowTrust } from "@agent-hub/core";
import { Badge } from "@agent-hub/ui";

/**
 * Earned-trust tier for a Flow (flow trust ledger): rolling pass rate over
 * graded answers. `watch` answers always offer human escalation.
 */
const TIER_STYLES: Record<FlowTrust["tier"], string> = {
  auto: "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
  queue: "text-muted-foreground",
  watch: "border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400",
};

export function TrustBadge({ trust }: { trust: FlowTrust | null }) {
  // No materialized row yet: trust is earned, not presumed, an unmeasured
  // flow behaves as watch (always offers escalation) until it accrues history.
  if (!trust) {
    return (
      <Badge
        variant="outline"
        className={`rounded-full ${TIER_STYLES.watch}`}
        title="No graded answers yet, this flow behaves as watch (always offers escalation) until it earns history."
      >
        watch · no history
      </Badge>
    );
  }
  const rate =
    trust.runs > 0 ? Math.round((trust.passes / trust.runs) * 100) : 0;
  return (
    <Badge
      variant="outline"
      className={`rounded-full ${TIER_STYLES[trust.tier]}`}
      title={`${trust.passes} of ${trust.runs} graded answers passed (rolling window)`}
    >
      {trust.tier} · {rate}% of {trust.runs}
    </Badge>
  );
}
