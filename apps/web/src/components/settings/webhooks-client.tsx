"use client";
import { useEffect, useId, useState, useTransition } from "react";
import {
  OUTBOUND_WEBHOOK_EVENTS, isOutboundWebhookEventType,
  type OutboundWebhookEventType, type OutboundWebhookSubscription, type WebhookDelivery,
} from "@agent-hub/core";
import { Badge, Card, CardContent, Button, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@agent-hub/ui";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { toast } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createWebhookAction, updateWebhookAction, deleteWebhookAction,
  sendWebhookTestAction, webhookDeliveriesAction,
} from "@/app/(admin)/settings/webhooks/actions";

type Fields = Pick<OutboundWebhookSubscription, "name" | "url" | "eventTypes">;
type Draft = Fields & { id: string | null; initial: string };
const eventTypes = Object.keys(OUTBOUND_WEBHOOK_EVENTS).filter(isOutboundWebhookEventType);
const fieldsOf = ({ name, url, eventTypes: selected }: Fields): Fields => ({ name, url, eventTypes: [...selected].sort() });

export function WebhooksClient({ subscriptions, available }: { subscriptions: OutboundWebhookSubscription[]; available: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<{ id: string; deliveries: WebhookDelivery[]; waitingFor?: string } | null>(null);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const fieldId = useId();
  const { leave } = useUnsavedChanges({ dirty: draft !== null && JSON.stringify(fieldsOf(draft)) !== draft.initial, saving: pending, confirmDelete });

  // Poll only while an explicit test is waiting for its first attempt.
  const logId = log?.id;
  const waitingFor = log?.waitingFor;
  useEffect(() => {
    if (!logId || !waitingFor) return;
    const subscriptionId = logId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 30_000;
    async function poll() {
      const result = await webhookDeliveriesAction(subscriptionId);
      if (cancelled) return;
      if (!result.ok) { toast.error(result.error); setLog(null); return; }
      const attempted = result.value.some((delivery) => delivery.event.id === waitingFor && delivery.attempts > 0);
      const finished = attempted || Date.now() >= deadline;
      setLog({ id: subscriptionId, deliveries: result.value, ...(finished ? {} : { waitingFor }) });
      if (!finished) timer = setTimeout(poll, 1_000);
    }
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [logId, waitingFor]);

  function edit(subscription?: OutboundWebhookSubscription) {
    const fields: Fields = subscription ? fieldsOf(subscription) : { name: "", url: "", eventTypes: ["conversation.escalated"] };
    setError(null);
    setDraft({ ...fields, id: subscription?.id ?? null, initial: JSON.stringify(fields) });
  }
  function close() { if (!pending) leave(() => setDraft(null)); }
  function save(current: Draft) {
    startTransition(async () => {
      const result = current.id ? await updateWebhookAction(current.id, fieldsOf(current)) : await createWebhookAction(fieldsOf(current));
      if (!result.ok) { setError(result.error); return; }
      if ("secret" in result.value) setSecret(result.value.secret);
      setDraft(null);
      toast.success("Webhook subscription saved");
    });
  }
  function showLog(id: string) {
    startTransition(async () => {
      const result = await webhookDeliveriesAction(id);
      if (!result.ok) toast.error(result.error);
      else setLog({ id, deliveries: result.value });
    });
  }
  function sendTest(id: string) {
    startTransition(async () => {
      const result = await sendWebhookTestAction(id);
      if (!result.ok) { toast.error(result.error); return; }
      setLog({ id, deliveries: [], waitingFor: result.value.eventId });
    });
  }
  function toggleEvent(type: OutboundWebhookEventType) {
    setDraft((current) => current ? { ...current, eventTypes: current.eventTypes.includes(type) ? current.eventTypes.filter((event) => event !== type) : [...current.eventTypes, type] } : null);
  }

  return <div className="space-y-4">
    {!available && <p role="status" className="text-muted-foreground text-sm">Webhook setup is unavailable until the deployment update finishes.</p>}
    {secret && <Card size="sm"><CardContent className="space-y-3" aria-label="New signing secret">
      <p className="text-sm font-medium">Save this signing secret. Ciele shows it only once.</p>
      <code className="block break-all rounded-lg bg-muted p-3 text-xs select-all">{secret}</code>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(secret); toast.success("Signing secret copied"); }
          catch { toast.error("Select and copy the signing secret manually."); }
        }}>Copy secret</Button>
        <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
      </div>
    </CardContent></Card>}
    {available && subscriptions.length === 0 && <EmptyState size="sm" title="No webhook subscriptions yet" />}
    {subscriptions.length > 0 && <Card size="sm"><ul className="divide-y">
      {subscriptions.map((subscription, index) => <RollRow key={subscription.id} index={index}><li className="space-y-3 p-4">
        <div><p className="text-sm font-medium"><RollInText text={subscription.name} /> <Badge tone={subscription.paused ? "gray" : "green"}><RollInText text={subscription.paused ? "Paused" : "Active"} /></Badge></p>
          <p className="text-muted-foreground break-all text-xs"><RollInText text={subscription.url} /></p>
          <p className="text-muted-foreground mt-1 text-xs"><RollInText text={subscription.eventTypes.join(", ")} /></p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => edit(subscription)}>Edit</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
            const result = await updateWebhookAction(subscription.id, { paused: !subscription.paused });
            if (!result.ok) toast.error(result.error);
          })}><RollInText text={subscription.paused ? "Resume" : "Pause"} /></Button>
          <Button size="sm" variant="outline" disabled={pending || subscription.paused} onClick={() => sendTest(subscription.id)}>Send test event</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => showLog(subscription.id)}>Deliveries</Button>
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => confirmDelete({ title: "Delete this webhook subscription?", description: "Ciele stops sending events to this URL and removes its delivery log.", onConfirm: async () => {
            const result = await deleteWebhookAction(subscription.id);
            if (!result.ok) toast.error(result.error);
            else { setLog(null); toast.success("Webhook subscription deleted"); }
          } })}>Delete</Button>
        </div>
      </li></RollRow>)}
    </ul></Card>}
    <Button size="sm" disabled={!available || pending || secret !== null} onClick={() => edit()}>Add subscription</Button>
    {log && <Card size="sm"><CardContent className="space-y-3" aria-label="Webhook deliveries">
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Last 100 deliveries</h3><Button size="sm" variant="ghost" disabled={pending} onClick={() => showLog(log.id)}>Refresh</Button></div>
      {log.waitingFor && <p role="status" className="text-muted-foreground text-sm">Waiting for the test delivery…</p>}
      {log.deliveries.length === 0 && !log.waitingFor && <EmptyState size="sm" title="No deliveries yet" />}
      <ul className="divide-y">{log.deliveries.map((delivery, index) => <RollRow key={delivery.id} index={index}><li className="py-2 text-xs">
        <p><RollInText text={delivery.event.type} /> · <RollInText text={delivery.status} /></p>
        <p className="text-muted-foreground"><RollInText text={`${delivery.attempts} attempts · ${delivery.lastStatusCode === null ? "No HTTP response" : `HTTP ${delivery.lastStatusCode}`} · ${delivery.lastAttemptAt ? new Date(delivery.lastAttemptAt).toLocaleString() : "Not attempted"}`} /></p>
      </li></RollRow>)}</ul>
    </CardContent></Card>}
    <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent><DialogHeader><DialogTitle><RollInText text={draft?.id ? "Edit subscription" : "Add subscription"} /></DialogTitle></DialogHeader>
        {draft && <form onSubmit={(event) => { event.preventDefault(); save(draft); }}>
          <DialogBody><div className="space-y-4">
            <div className="space-y-2"><Label htmlFor={`${fieldId}-name`}>Name</Label><Input id={`${fieldId}-name`} required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor={`${fieldId}-url`}>URL</Label><Input id={`${fieldId}-url`} type="url" required maxLength={2000} placeholder="https://example.com/events" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></div>
            <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Events</legend>{eventTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><Checkbox className="press-control" aria-label={type} checked={draft.eventTypes.includes(type)} onCheckedChange={() => toggleEvent(type)} />{type}</label>)}</fieldset>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </div></DialogBody>
          <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" disabled={pending || draft.eventTypes.length === 0}><RollInText text={pending ? "Saving…" : "Save"} /></Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
  </div>;
}
