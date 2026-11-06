"use client";
import { useId, useMemo, useState, useTransition } from "react";
import { defaultChannelAvailability, type BusinessHours, type BusinessHoursInput } from "@agent-hub/core";
import { Badge, Button, Card, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@agent-hub/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { AvailabilityScheduler } from "@/components/help-desks/availability-scheduler";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { timezoneOptions } from "@/lib/flow-conditions";
import { toast } from "@/lib/toast";
import { createBusinessHoursAction, updateBusinessHoursAction, deleteBusinessHoursAction, setDefaultTimezoneAction } from "@/app/(admin)/settings/business-hours/actions";

export function BusinessHoursClient({ items, available, defaultTimezone }: { items: BusinessHours[]; available: boolean; defaultTimezone: string }) {
  const [editing, setEditing] = useState<{ id: string | null; initial: string; draft: BusinessHoursInput } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const { leave } = useUnsavedChanges({ dirty: Boolean(editing && JSON.stringify(editing.draft) !== editing.initial), saving: pending, confirmDelete });
  const fieldId = useId();
  const zones = useMemo(() => {
    const options = timezoneOptions();
    for (const value of ["UTC", defaultTimezone, editing?.draft.timezone]) if (value && !options.some(option => option.value === value)) options.unshift({ value, label: value });
    return options;
  }, [defaultTimezone, editing?.draft.timezone]);
  const close = () => { if (!pending) leave(() => setEditing(null)); };
  const edit = (schedule?: BusinessHours) => {
    const draft: BusinessHoursInput = schedule ? { name: schedule.name, timezone: schedule.timezone, hours: structuredClone(schedule.hours), holidays: structuredClone(schedule.holidays), isDefault: schedule.isDefault } : { name: "", timezone: defaultTimezone, hours: defaultChannelAvailability(defaultTimezone).hours, holidays: [], isDefault: items.length === 0 };
    setError(null); setEditing({ id: schedule?.id ?? null, draft, initial: JSON.stringify(draft) });
  };
  const patch = (value: Partial<BusinessHoursInput>) => setEditing(current => current ? { ...current, draft: { ...current.draft, ...value } } : null);
  return <div className="space-y-5">
    <div className="space-y-2"><Label htmlFor={`${fieldId}-default-zone`}>Default timezone</Label><Select value={defaultTimezone} disabled={!available || pending} onValueChange={zone => startTransition(async () => {
      const result = await setDefaultTimezoneAction(zone);
      if (!result.ok) toast.error(result.error); else toast.success("Default timezone saved");
    })}><SelectTrigger id={`${fieldId}-default-zone`}><SelectValue /></SelectTrigger><SelectContent>{zones.map(zone => <SelectItem key={zone.value} value={zone.value}>{zone.label}</SelectItem>)}</SelectContent></Select><p className="text-muted-foreground text-xs">Starting timezone for new schedules, channel availability and Flow Schedule conditions.</p></div>
    <Button disabled={!available || pending} onClick={() => edit()}>Add schedule</Button>
    {!available && <p className="text-muted-foreground text-sm">Business hours is available after the database migration is applied.</p>}
    {available && !items.length && <EmptyState size="sm" title="No schedules yet" />}
    {items.map((schedule, index) => <RollRow key={schedule.id} index={index}><Card size="sm" className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium"><RollInText text={schedule.name} /> {schedule.isDefault && <Badge tone="gray"><RollInText text="Default" /></Badge>}</p><p className="text-muted-foreground text-xs"><RollInText text={schedule.timezone} /></p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => edit(schedule)}>Edit</Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => confirmDelete({ title: `Delete ${schedule.name}?`, description: "Channels and Flows that use this schedule must select another one first.", onConfirm: async () => {
      const result = await deleteBusinessHoursAction(schedule.id);
      if (!result.ok) toast.error(result.error); else toast.success("Schedule deleted");
    } })}>Delete</Button></div></Card></RollRow>)}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{editing?.id ? "Edit schedule" : "Add schedule"}</DialogTitle></DialogHeader><DialogBody>
      {editing && <form id={`${fieldId}-form`} className="space-y-5" onSubmit={event => {
        event.preventDefault(); startTransition(async () => {
          const result = editing.id ? await updateBusinessHoursAction(editing.id, editing.draft) : await createBusinessHoursAction(editing.draft);
          if (!result.ok) { setError(result.error); return; }
          setEditing(null); toast.success("Schedule saved");
        });
      }}>
        <div className="space-y-2"><Label htmlFor={`${fieldId}-name`}>Name</Label><Input id={`${fieldId}-name`} required maxLength={120} value={editing.draft.name} onChange={event => patch({ name: event.target.value })} /><p className="text-muted-foreground text-xs">{editing.draft.name.length}/120</p></div>
        <div className="space-y-2"><Label htmlFor={`${fieldId}-zone`}>Timezone</Label><Select value={editing.draft.timezone} onValueChange={timezone => patch({ timezone })}><SelectTrigger id={`${fieldId}-zone`}><SelectValue /></SelectTrigger><SelectContent>{zones.map(zone => <SelectItem key={zone.value} value={zone.value}>{zone.label}</SelectItem>)}</SelectContent></Select></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={editing.draft.isDefault} onCheckedChange={checked => patch({ isDefault: checked === true })} />Organization default schedule</label>
        <AvailabilityScheduler value={editing.draft.hours} onChange={hours => patch({ hours })} />
        <p className="text-muted-foreground text-xs">A closing time before its opening time continues into the next day.</p>
        <div className="space-y-3"><p className="text-sm font-medium">Holidays</p>
          {editing.draft.holidays.map((holiday, index) => <RollRow key={holiday.id} index={index}><fieldset className="space-y-3 rounded-lg border border-border p-3"><legend className="text-sm"><RollInText text={holiday.name || `Holiday ${index + 1}`} /></legend>
            <div className="space-y-2"><Label htmlFor={`${fieldId}-${holiday.id}-name`}>Name</Label><Input id={`${fieldId}-${holiday.id}-name`} required maxLength={120} value={holiday.name} onChange={event => patch({ holidays: editing.draft.holidays.map(row => row.id === holiday.id ? { ...row, name: event.target.value } : row) })} /><p className="text-muted-foreground text-xs">{holiday.name.length}/120</p></div>
            <div className="grid grid-cols-2 gap-3">{(["startDate", "endDate"] as const).map(key => <div key={key} className="space-y-2"><Label htmlFor={`${fieldId}-${holiday.id}-${key}`}>{key === "startDate" ? "From" : "Through"}</Label><Input id={`${fieldId}-${holiday.id}-${key}`} type="date" required value={holiday[key]} onChange={event => patch({ holidays: editing.draft.holidays.map(row => row.id === holiday.id ? { ...row, [key]: event.target.value } : row) })} /></div>)}</div>
            <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={holiday.yearly} onCheckedChange={checked => patch({ holidays: editing.draft.holidays.map(row => row.id === holiday.id ? { ...row, yearly: checked === true } : row) })} />Repeat every year</label><Button type="button" size="sm" variant="destructive" onClick={() => confirmDelete({ title: "Remove this holiday?", description: "Save the schedule to apply this change.", onConfirm: () => patch({ holidays: editing.draft.holidays.filter(row => row.id !== holiday.id) }) })}>Remove holiday</Button></div>
          </fieldset></RollRow>)}
          <Button type="button" variant="outline" disabled={editing.draft.holidays.length >= 100} onClick={() => patch({ holidays: [...editing.draft.holidays, { id: crypto.randomUUID(), name: "", startDate: "", endDate: "", yearly: false }] })}>Add holiday</Button>
        </div>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      </form>}
    </DialogBody><DialogFooter><Button variant="ghost" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={`${fieldId}-form`} disabled={pending}>Save schedule</Button></DialogFooter></DialogContent></Dialog>
    {confirmDeleteModal}
  </div>;
}
