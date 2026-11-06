import type { SourceUsageStats } from "@agent-hub/core";
import { Card, CardContent } from "@agent-hub/ui";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatDateTime } from "@/lib/format";
export function SourceUsageCard({ usage }: { usage: SourceUsageStats | null }) {
  return <Card><CardContent className="space-y-3 pt-4">
    <p className="text-sm font-semibold">Answers citing this Source · last 30 days</p>
    {usage ? <>
      <dl className="flex flex-wrap gap-6 text-sm">
        <div><dt className="text-muted-foreground">Cited answers</dt><dd><RollingNumber value={usage.cited30} /></dd></div>
        <div><dt className="text-muted-foreground">Positive feedback</dt><dd><RollingNumber value={usage.positive30} /></dd></div>
        <div><dt className="text-muted-foreground">Negative feedback</dt><dd><RollingNumber value={usage.negative30} /></dd></div>
        <div><dt className="text-muted-foreground">Last cited</dt><dd><RollInText text={usage.lastCitedAt ? formatDateTime(usage.lastCitedAt) : "Not cited in 30 days"} /></dd></div>
      </dl>
      <div className="flex flex-wrap gap-3">{usage.assistants.map((assistant, index) => <RollRow key={assistant.id} index={index}><span className="text-sm"><RollInText text={assistant.title} /> · <RollingNumber value={assistant.answers} /></span></RollRow>)}</div>
      {usage.unused90 && <p className="text-muted-foreground text-sm">Unused: no citation in 90 days.</p>}
    </> : <p className="text-muted-foreground text-sm">Citation figures are not available yet.</p>}
    <p className="text-muted-foreground text-xs">Counts Visitor answers from Assistants. Internal previews, Teammates and proactive notifications are excluded. Each answer counts a Source once.</p>
  </CardContent></Card>;
}
