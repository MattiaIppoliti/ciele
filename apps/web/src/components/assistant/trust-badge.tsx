import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";
import type { FlowTrust } from "@agent-hub/core";
import { Hint } from "@agent-hub/ui";
import { formatCount, formatPercent } from "@/lib/format";

/**
 * Earned-trust tier for a Flow (flow trust ledger): rolling pass rate over
 * graded answers. `watch` answers always offer human escalation.
 */

export function TrustBadge({ trust }: { trust: FlowTrust }) {
  const rate =
    trust.runs > 0 ? Math.round((trust.passes / trust.runs) * 100) : 0;
  const detail = `${formatCount(trust.passes)} of ${formatCount(trust.runs)} graded answers passed (rolling window)`;
  // A Hint, not a title attribute: a title never shows on touch or to the
  // keyboard. The sr-only sentence is the same fact for a screen reader.
  return (
    <Hint label={detail}>
      <StatusPill
        status={trust.tier === "auto" ? "online" : trust.tier === "watch" ? "warning" : "offline"}
        tabIndex={0}
        className="tabular-nums"
        primaryText={<>
        <span aria-hidden>
          {trust.tier} · {formatPercent(rate)} of {formatCount(trust.runs)}
        </span>
        <span className="sr-only">
          {trust.tier}: {detail}
        </span>
        </>}
      />
    </Hint>
  );
}
