"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { RoleView } from "@ciele/ops";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label } from "@agent-hub/ui";
import { deleteRoleAction, setRoleDefaultsAction } from "@/app/(admin)/settings/roles/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RollInText } from "@/components/motion/roll-in-text";
import { Table, type TableColumn } from "@/components/motion/table";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast";

/** Who holds a Role, in one phrase: "3 members · 1 key". */
function holders(role: RoleView): string {
  const parts = [
    `${role.memberCount} member${role.memberCount === 1 ? "" : "s"}`,
    role.inviteCount ? `${role.inviteCount} invited` : null,
    role.apiKeyCount ? `${role.apiKeyCount} key${role.apiKeyCount === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function availability(role: RoleView): string {
  if (role.organizationLevel && role.assistantLevel) return "Organization, Assistant";
  return role.organizationLevel ? "Organization" : "Assistant";
}

export function RolesListClient({
  roles,
  totalCapabilities,
  canManage,
  heldRoleId,
}: {
  roles: RoleView[];
  totalCapabilities: number;
  canManage: boolean;
  /** The Role the signed-in Member holds, which they cannot edit themselves. */
  heldRoleId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  function remove(role: RoleView) {
    confirmDelete({
      title: `Delete ${role.name}?`,
      description: "Members, invitations and API keys that hold it must have another role first.",
      confirmLabel: "Delete role",
      onConfirm: async () => {
        try {
          await deleteRoleAction(role.id);
          toast.success(`${role.name} deleted`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete the role");
        }
      },
    });
  }

  const columns: TableColumn<RoleView>[] = [
    {
      key: "name",
      header: "Role",
      accessor: (role) => role.name,
      sortable: true,
      width: "44%",
      cell: (role) => (
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium">
            <span className="truncate"><RollInText text={role.name} /></span>
            {role.locked ? (
              <Badge variant="outline" className="gap-1"><Lock aria-hidden className="size-3" />Locked</Badge>
            ) : role.builtIn ? (
              <Badge variant="secondary">Built-in</Badge>
            ) : (
              <Badge variant="outline">Custom</Badge>
            )}
            {role.edited && <Badge variant="outline">Edited</Badge>}
            {role.memberDefault && <Badge variant="outline">Organization default</Badge>}
            {role.assistantDefault && <Badge variant="outline">Assistant default</Badge>}
            {role.id === heldRoleId && <span className="text-muted-foreground text-xs">(your role)</span>}
          </p>
          {role.description && (
            <p className="text-muted-foreground truncate text-xs">{role.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "capabilities",
      header: "Capabilities",
      accessor: (role) => role.capabilities.length,
      sortable: true,
      width: "16%",
      cell: (role) => (
        <span className="text-muted-foreground tabular-nums">
          <RollInText text={`${role.capabilities.length} / ${totalCapabilities}`} />
        </span>
      ),
    },
    {
      key: "holders",
      header: "Held by",
      accessor: (role) => role.memberCount,
      sortable: true,
      width: "18%",
      hideBelowSm: true,
      cell: (role) => <span className="text-muted-foreground"><RollInText text={holders(role)} /></span>,
    },
    {
      key: "availability",
      header: "Available on",
      accessor: (role) => availability(role),
      filterOptions: [
        { value: "Organization", label: "Organization" },
        { value: "Assistant", label: "Assistant" },
        { value: "Organization, Assistant", label: "Both" },
      ],
      filterLabel: "Available on",
      width: "14%",
      hideBelowSm: true,
      cell: (role) => <span className="text-muted-foreground">{availability(role)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "8%",
      cell: (role) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label={`Actions for ${role.name}`} />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={`/settings/roles/${role.id}`} />}>
              <Pencil className="size-4" />
              {canManage && !role.locked && role.id !== heldRoleId ? "Edit" : "View"}
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem render={<Link href={`/settings/roles/new?from=${role.id}`} />}>
                <Copy className="size-4" />
                Duplicate
              </DropdownMenuItem>
            )}
            {canManage && !role.builtIn && (
              <DropdownMenuItem onClick={() => remove(role)} className="text-destructive">
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className={`mt-8 space-y-4 ${isPending ? "opacity-70" : ""}`}>
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9" onClick={() => setDefaultsOpen(true)}>
            Manage defaults
          </Button>
          <Button className="h-9" render={<Link href="/settings/roles/new" />}>
            <Plus className="size-4" />
            New role
          </Button>
        </div>
      )}
      <Table
        title="Roles"
        data={roles}
        searchValue={(role) => `${role.name} ${role.description}`}
        columns={columns}
        getRowId={(role) => role.id}
        onRowClick={(role) => startTransition(() => router.push(`/settings/roles/${role.id}`))}
        emptyState="No roles yet"
        noun="role"
      />
      {confirmDeleteModal}
      {defaultsOpen && <DefaultsDialog roles={roles} onClose={() => setDefaultsOpen(false)} />}
    </div>
  );
}

/**
 * Which Role a new invitation starts with, and which one a new Assistant
 * assignment starts with. Whoever invites still picks, and can only give
 * what they hold.
 */
function DefaultsDialog({ roles, onClose }: { roles: RoleView[]; onClose: () => void }) {
  const memberChoices = roles.filter((role) => role.organizationLevel && role.key !== "owner");
  const assistantChoices = roles.filter((role) => role.assistantLevel);
  const [memberRoleId, setMemberRoleId] = useState(roles.find((role) => role.memberDefault)?.id ?? memberChoices[0]?.id ?? "");
  const [assistantRoleId, setAssistantRoleId] = useState(roles.find((role) => role.assistantDefault)?.id ?? assistantChoices[0]?.id ?? "");
  const [saving, startSave] = useTransition();
  const name = (id: string) => roles.find((role) => role.id === id)?.name ?? "Choose a role";

  function save() {
    startSave(async () => {
      try {
        await setRoleDefaultsAction({ memberRoleId, assistantRoleId });
        toast.success("Default roles updated");
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the default roles");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Default roles</DialogTitle></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="default-member-role">New invitations</Label>
            <Select value={memberRoleId} onValueChange={(value) => setMemberRoleId(String(value))}>
              <SelectTrigger id="default-member-role" className="h-10 w-full" aria-label="Default role for new invitations">
                <SelectValue>{(value: string) => name(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {memberChoices.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-assistant-role">New Assistant assignments</Label>
            <Select value={assistantRoleId} onValueChange={(value) => setAssistantRoleId(String(value))}>
              <SelectTrigger id="default-assistant-role" className="h-10 w-full" aria-label="Default role on an Assistant">
                <SelectValue>{(value: string) => name(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assistantChoices.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={saving || !memberRoleId || !assistantRoleId}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
