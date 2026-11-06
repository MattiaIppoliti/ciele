"use client";
import { useId, useState, useTransition } from "react";
import { effectiveMcpToolPolicy, type McpServerConnection, type McpToolPolicy } from "@agent-hub/core";
import { Badge, Button, Card, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@agent-hub/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { toast } from "@/lib/toast";
import { createMcpServerAction, deleteMcpServerAction, refreshMcpServerAction, setMcpToolPolicyAction } from "@/app/(admin)/settings/mcp-servers/actions";
const policyLabel = { run_freely: "Run freely", ask_first: "Ask first", off: "Off" } satisfies Record<McpToolPolicy, string>;
export function McpServersClient({ servers, available }: { servers: McpServerConnection[]; available: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", url: "", token: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const { leave } = useUnsavedChanges({ dirty: open && Boolean(draft.name || draft.url || draft.token), saving: pending, confirmDelete });
  const fieldId = useId();
  const close = () => { if (!pending) leave(() => { setOpen(false); setDraft({ name: "", url: "", token: "" }); }); };
  return <div className="space-y-4">
    <Button disabled={!available || pending} onClick={() => { setError(null); setOpen(true); }}>Add server</Button>
    {!available && <p className="text-muted-foreground text-sm">MCP server setup is available after the database migration is applied.</p>}
    {available && !servers.length && <EmptyState size="sm" title="No MCP servers yet" />}
    {servers.map((server, index) => <RollRow key={server.id} index={index}><Card size="sm" className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium"><RollInText text={server.name} /></p><p className="text-muted-foreground break-all text-xs"><RollInText text={server.url} /></p></div>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
          const result = await refreshMcpServerAction(server.id);
          if (!result.ok) toast.error(result.error); else toast.success("Tool definitions refreshed");
        })}>Refresh</Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => confirmDelete({ title: "Delete this MCP server?", description: "Teammates and Assistants stop receiving its tools.", onConfirm: async () => {
          const result = await deleteMcpServerAction(server.id);
          if (!result.ok) toast.error(result.error); else toast.success("MCP server deleted");
        } })}>Delete</Button></div>
      </div>
      {!server.tools.length && <p className="text-muted-foreground mt-3 text-sm">This server lists no tools.</p>}
      <ul className="mt-3 divide-y">{server.tools.map((tool, toolIndex) => {
        const changed = tool.approvedHash !== null && tool.definitionHash !== tool.approvedHash;
        return <RollRow key={tool.name} index={toolIndex}><li className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{tool.name} {tool.removed ? <Badge tone="gray"><RollInText text="Removed" /></Badge> : changed ? <Badge tone="amber"><RollInText text="Changed" /></Badge> : null}</p>
            {tool.readOnlyHint && <p className="text-muted-foreground text-xs">Server hint: read-only. Review the definition before enabling.</p>}</div>
            <Select value={effectiveMcpToolPolicy(tool)} disabled={pending || tool.removed} onValueChange={policy => {
              if (policy !== "run_freely" && policy !== "ask_first" && policy !== "off") return;
              startTransition(async () => {
                const result = await setMcpToolPolicyAction({ id: server.id, tool: tool.name, definitionHash: tool.definitionHash, policy });
                if (!result.ok) toast.error(result.error); else toast.success("Tool policy saved");
              });
            }}><SelectTrigger aria-label={`Policy for ${server.name}: ${tool.name}`} className="w-36"><SelectValue /></SelectTrigger><SelectContent>
              {Object.entries(policyLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent></Select>
          </div>
          <p className="text-muted-foreground text-sm">{tool.description}</p>
          <details className="text-xs"><summary className="cursor-pointer">Input schema and definition</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tool.inputSchema, null, 2)}</pre><p className="text-muted-foreground mt-2 break-all">{tool.definitionHash}</p></details>
          {changed && <p className="text-muted-foreground text-xs">This definition is suspended. Review it, then choose a policy again.</p>}
        </li></RollRow>;
      })}</ul>
    </Card></RollRow>)}
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent><DialogHeader><DialogTitle>Add MCP server</DialogTitle></DialogHeader><DialogBody>
      <form id={`${fieldId}-form`} className="space-y-4" onSubmit={event => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createMcpServerAction({ name: draft.name, url: draft.url, ...(draft.token ? { token: draft.token } : {}) });
          if (!result.ok) { setError(result.error); return; }
          setDraft({ name: "", url: "", token: "" }); setOpen(false); toast.success("MCP server registered. Its tools start Off.");
        });
      }}>
        <div className="space-y-2"><Label htmlFor={`${fieldId}-name`}>Name</Label><Input id={`${fieldId}-name`} required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /><p className="text-muted-foreground text-xs">{draft.name.length}/120</p></div>
        <div className="space-y-2"><Label htmlFor={`${fieldId}-url`}>Streamable HTTP URL</Label><Input id={`${fieldId}-url`} type="url" required maxLength={2000} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /><p className="text-muted-foreground text-xs">{draft.url.length}/2000</p></div>
        <div className="space-y-2"><Label htmlFor={`${fieldId}-token`}>Bearer token (optional)</Label><Input id={`${fieldId}-token`} type="password" maxLength={16000} autoComplete="new-password" value={draft.token} onChange={event => setDraft({ ...draft, token: event.target.value })} /><p className="text-muted-foreground text-xs">Ciele seals this token and never returns it to the browser.</p></div>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      </form>
    </DialogBody><DialogFooter><Button variant="ghost" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={`${fieldId}-form`} disabled={pending}>Connect and list tools</Button></DialogFooter></DialogContent></Dialog>
    {confirmDeleteModal}
  </div>;
}
