"use client";
import { useTransition } from "react";
import { useBrowserTimezone, localExportHour } from "@/lib/hooks/use-browser-timezone";
import { useRouter } from "next/navigation";
import type { ExportSchedule, InsightsFilter } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { CreateExportDialog } from "./create-export-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { pauseExportScheduleAction, deleteExportScheduleAction } from "@/app/(admin)/insights/exports/schedule-actions";
import { toast } from "@/lib/toast";
export function ScheduledExportsPanel({ items, available, members, assistants, defaultFilter, canManage }: { items: ExportSchedule[]; available: boolean; members: Array<{ userId: string; email: string }>; assistants: Array<{ id: string; title: string }>; defaultFilter: InsightsFilter; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timezone = useBrowserTimezone();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();


  function toggle(item: ExportSchedule) { startTransition(async () => { try { await pauseExportScheduleAction(item.id, !item.enabled); router.refresh(); } catch { toast.error("Could not update the export schedule"); } }); }
  return <section className="mb-6 space-y-3">
    {confirmDeleteModal}
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">Schedules</h2>{available && canManage && <CreateExportDialog assistants={assistants} defaultFilter={defaultFilter} scheduleMembers={members} onScheduled={() => router.refresh()} />}</div>
    {!available ? <p className="text-muted-foreground text-sm">Apply the latest migration to use scheduled exports.</p> : !items.length ? <EmptyState size="sm" title="No export schedules yet" /> : <div className="divide-y rounded-xl border">{items.map((item, index) => <RollRow key={item.id} index={index}><article className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="space-y-1"><p className="text-sm font-medium"><RollInText text={item.name} /></p><p className="text-muted-foreground text-xs"><RollInText text={`${item.enabled ? "Active" : "Paused"} · ${item.cadence.kind === "weekly" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][item.cadence.weekday] : `Day ${item.cadence.day}`} (UTC) · ${localExportHour(item.hour, timezone)} local · ${item.format.toUpperCase()}`} /></p><p className="text-muted-foreground text-xs"><RollInText text={item.recipientMemberIds.flatMap(id => members.find(member => member.userId === id)?.email ?? []).join(", ") || "No recipients"} /></p></div>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => toggle(item)}><RollInText text={item.enabled ? "Pause" : "Resume"} /></Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => confirmDelete({ title: "Delete export schedule?", description: "Future runs stop. Existing exports remain available.", onConfirm: async () => { await deleteExportScheduleAction(item.id); router.refresh(); } })}>Delete</Button></div>}</article></RollRow>)}</div>}
  </section>;
}
