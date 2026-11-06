"use client";
import type { McpServerConnection, McpToolSelection } from "@agent-hub/core";
import { effectiveMcpToolPolicy } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { RollRow, RollInText } from "@/components/motion/roll-in-text";
import { Checkbox } from "@/components/ui/checkbox";
export function McpToolsSettings({ servers, value, canEdit, onChange }: { servers: McpServerConnection[]; value: McpToolSelection[]; canEdit: boolean; onChange: (value: McpToolSelection[]) => void }) {
  function toggle(server: McpServerConnection, name: string, definitionHash: string, checked: boolean) {
    const previous = value.find(item => item.serverId === server.id)?.tools ?? [];
    const tools = previous.filter(tool => tool.name !== name);
    if (checked) tools.push({ name, definitionHash });
    onChange([...value.filter(item => item.serverId !== server.id), ...(tools.length ? [{ serverId: server.id, tools }] : [])]);
  }
  const stale = value.flatMap(selection => selection.tools.filter(selected => {
    const server = servers.find(server => server.id === selection.serverId);
    return !server?.tools.some(tool => tool.name === selected.name && tool.definitionHash === selected.definitionHash && effectiveMcpToolPolicy(tool) === "run_freely");
  }).map(tool => ({ serverId: selection.serverId, name: tool.name })));
  return <div className="space-y-4">
    <p className="text-muted-foreground text-sm">Only tools reviewed as Run freely can run for Visitors. Publish again after changing the selection.</p>
    {!servers.length && <p className="text-muted-foreground text-sm">An Owner or Admin can register servers in Settings → MCP servers.</p>}
    {servers.map((server, index) => <RollRow key={server.id} index={index}><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium"><RollInText text={server.name} /></legend>
      {server.tools.filter(tool => effectiveMcpToolPolicy(tool) === "run_freely").map((tool, index) => <RollRow key={tool.name} index={index}><label className="flex items-start gap-2 text-sm">
        <Checkbox disabled={!canEdit} checked={value.some(selection => selection.serverId === server.id && selection.tools.some(selected => selected.name === tool.name && selected.definitionHash === tool.definitionHash))} onCheckedChange={checked => toggle(server, tool.name, tool.definitionHash, checked === true)} />
        <span><RollInText text={tool.name} /><span className="text-muted-foreground block text-xs">{tool.description}</span></span>
      </label></RollRow>)}
    </fieldset></RollRow>)}
    {stale.map((tool, index) => <RollRow key={`${tool.serverId}/${tool.name}`} index={index}><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><RollInText text={tool.name} />: changed or unavailable. Review before publishing.</span><Button size="sm" variant="outline" disabled={!canEdit} onClick={() => onChange(value.map(selection => selection.serverId === tool.serverId ? { ...selection, tools: selection.tools.filter(selected => selected.name !== tool.name) } : selection).filter(selection => selection.tools.length > 0))}>Remove selection</Button></div></RollRow>)}
  </div>;
}
