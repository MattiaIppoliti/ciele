"use client";
import { useState, useTransition } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@agent-hub/ui";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { listAssistantAccessAction, setAssistantAccessAction } from "@/app/(admin)/assistants/access-actions";
import { choiceLabel, choiceOf } from "@/lib/members/assistant-scope";
import { toast } from "@/lib/toast";

type Access = Awaited<ReturnType<typeof listAssistantAccessAction>>;
type AccessMember = Access["members"][number];
const NONE = "__organization__";

/**
 * Who may do what on one Assistant (ADR-0028): the Organization Role, Denied,
 * or any Role offered on Assistants, custom ones included. A Member limited to
 * selected Assistants has no access without a row, so clearing it reads "No
 * access", and Denied would only say the same thing twice.
 */
export function ManageAccessDialog({ assistantId, open, onClose, initialMembers }: { assistantId: string; open: boolean; onClose: () => void; initialMembers: Access }) {
  const [access, setAccess] = useState(initialMembers);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const options = (member: AccessMember) => [
    { value: NONE, label: member.assistantScope === "selected" ? "No access" : "Organization Role" },
    ...(member.assistantScope === "selected" ? [] : [{ value: "denied", label: "Denied" }]),
    ...access.roles.map((role) => ({ value: role.id, label: role.name })),
  ];
  const current = (member: AccessMember) => (member.override ? choiceOf(member.override) : NONE);
  const label = (member: AccessMember) => {
    const value = current(member);
    if (value === NONE) return options(member)[0]!.label;
    return member.override?.roleName ?? choiceLabel(value, access.roles);
  };

  function change(userId: string, choice: string | null) {
    confirmDelete({
      title: "Change Assistant access?",
      description: "This changes what the Member and their API keys can see and change on this Assistant.",
      confirmLabel: "Change access",
      onConfirm: () => new Promise<void>((resolve) => startTransition(async () => {
        try {
          await setAssistantAccessAction(assistantId, userId, choice);
          setAccess(await listAssistantAccessAction(assistantId));
          toast.success("Assistant access updated");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update Assistant access");
        } finally {
          resolve();
        }
      })),
    });
  }

  return <><Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Manage access</DialogTitle></DialogHeader><DialogBody className="space-y-4">
    <p className="text-muted-foreground text-sm">A Role here replaces the member&apos;s Organization Role on this Assistant and its settings. Owners always keep full access.</p>
    {access.members.map((member, index) => <RollRow key={member.userId} index={index}><div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0"><p className="truncate text-sm"><RollInText text={member.email} /></p><p className="text-muted-foreground text-xs"><RollInText text={`Organization Role: ${member.roleName ?? member.role}${member.assistantScope === "selected" ? " · Selected assistants only" : ""}`} /></p></div>
      <Select value={current(member)} disabled={pending || member.role === "owner"} onValueChange={(value) => change(member.userId, value === NONE ? null : String(value))}>
        <SelectTrigger className="w-44" aria-label={`Access for ${member.email}`}><RollInText text={label(member)} /></SelectTrigger>
        <SelectContent>{options(member).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div></RollRow>)}
    </DialogBody><DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>{confirmDeleteModal}</>;
}
