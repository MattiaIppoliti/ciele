import type { SourceStatus } from "@agent-hub/core";
import { RollInText } from "@/components/motion/roll-in-text";
import { StatusBadge, type StatusBadgeStatus } from "@/components/spaceui/status-badge";

const STATUS: Record<SourceStatus, StatusBadgeStatus> = {
  ready: "online",
  processing: "away",
  error: "error",
};
const LABEL: Record<SourceStatus, string> = {
  ready: "Ready",
  processing: "Processing…",
  error: "Error",
};

export function SourceStatusBadge({ status, error }: { status: SourceStatus; error?: string }) {
  return (
    <StatusBadge
      status={STATUS[status]}
      animated={status === "processing"}
      title={status === "error" ? error : undefined}
      primaryText={<RollInText text={LABEL[status]} />}
    />
  );
}
