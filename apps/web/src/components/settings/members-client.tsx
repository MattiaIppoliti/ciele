"use client";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { TableCategory, type TableCategoryTone } from "@/components/ui/table-editable-cell";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useMemo, useState, useTransition } from "react";
import type { Invite, Member, Role } from "@agent-hub/core";
import { Plus, Trash2 } from "lucide-react";
import { ChevronDown, Link2 } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { UserAvatar } from "@/components/ui/user-avatar";
import { createInviteAction, updateMemberRoleAction } from "@/app/actions";
import { Table, type TableColumn } from "@/components/motion/table";
import { RemoveMemberModal } from "@/components/settings/remove-member-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { capitalize, formatDay } from "@/lib/format";
import {
  assignableRoles,
  buildMemberRows,
  canManageRow,
  type MemberRow,
} from "@/lib/member-rows";
import {
  Badge,
  Button,
  CopyFeedbackIcon,
  Hint,
  Input,
  useCopyFeedback,
} from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

export function MembersClient({
  members,
  invites,
  currentUserId,
  canManageRoles,
  canManageOwners,
  canInvite,
  demo,
}: {
  members: Member[];
  invites: Invite[];
  currentUserId: string;
  /** Admins and owners edit roles and remove people. */
  canManageRoles: boolean;
  /** Only owners may grant or revoke ownership. */
  canManageOwners: boolean;
  canInvite: boolean;
  demo: boolean;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [pendingRemoval, setPendingRemoval] = useState<MemberRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [inviting, startInvite] = useTransition();
  const { copyText, isCopied } = useCopyFeedback<string>();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const rows = useMemo(
    () => buildMemberRows(members, invites, currentUserId),
    [members, invites, currentUserId]
  );
  const inviteTokens = useMemo(
    () => new Map(invites.map((i) => [i.id, i.token])),
    [invites]
  );

  async function copyInvite(row: MemberRow) {
    const token = inviteTokens.get(row.subjectId);
    if (!token) return;
    if (await copyText(row.subjectId, inviteUrl(token))) {
      toast.success("Invite link copied");
    } else {
      toast.error("Could not copy the invite link");
    }
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    startInvite(async () => {
      let invite: Invite;
      try {
        invite = await createInviteAction(inviteRole, inviteEmail || undefined);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create the invite",
        );
        return;
      }
      const copied = await copyText(invite.id, inviteUrl(invite.token));
      if (copied) toast.success("Invite created, link copied to clipboard");
      else toast.success("Invite created, use Copy link to copy it");
      setInviteEmail("");
    });
  }

  async function applyRole(row: MemberRow, role: Role) {
    await updateMemberRoleAction(row.subjectId, role);
    toast.success(`Role updated to ${role}`);
  }

  function changeRole(row: MemberRow, role: Role) {
    if (role === row.role) return;
    // Ownership is the one role that can take the organization away from
    // whoever holds it now, so granting or removing it asks first.
    if (role === "owner" || row.role === "owner") {
      const granting = role === "owner";
      confirmDelete({
        title: granting
          ? `Make ${row.name} an owner?`
          : `Remove ${row.name} as an owner?`,
        description: granting
          ? "Owners have full control of the organization, including billing, every member's role and granting ownership to others."
          : `They become ${role === "admin" ? "an" : "a"} ${role} and lose control of billing and ownership.`,
        confirmLabel: granting ? "Make owner" : `Change to ${role}`,
        onConfirm: () => applyRole(row, role),
      });
      return;
    }
    startTransition(async () => {
      try {
        await applyRole(row, role);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update the role",
        );
      }
    });
  }

  const manageOpts = { canManageMembers: canManageRoles, canManageOwners };

  const columns: TableColumn<MemberRow>[] = [
    {
      key: "name",
      header: "User",
      accessor: (row) => row.name,
      sortable: true,
      width: "38%",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          {/* One face per person, generated from who they are, so a row is
              recognisable at a glance. It was the same grey silhouette for the
              whole organization, which told you nothing. */}
          <UserAvatar
            avatarUrl={row.avatarUrl}
            userId={row.kind === "member" ? row.subjectId : null}
            email={row.email}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              <RollInText text={row.name} />
              {row.isSelf && <span className="text-muted-foreground"> (you)</span>}
            </p>
            {row.email && row.email !== row.name ? (
              <p className="text-muted-foreground truncate text-xs">
                <RollInText text={row.email} />
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      filterOptions: [{ value: "active", label: "Active" }, { value: "pending", label: "Pending" }],
      filterLabel: "Status",
      filterAnyLabel: "All statuses",
      header: "Status",
      accessor: (row) => row.status,
      sortable: true,
      width: "14%",
      cell: (row) =>
        row.status === "active" ? (
          <StatusPill status="online" primaryText={<RollInText text="Active" />} />
        ) : (
          <StatusPill status="away" primaryText={<RollInText text="Pending" />} />
        ),
    },
    {
      key: "since",
      header: "Joined",
      accessor: (row) => row.since,
      sortable: true,
      width: "18%",
      hideBelowSm: true,
      cell: (row) => (
        <span className="text-muted-foreground"><RollInText text={formatDay(row.since)} /></span>
      ),
    },
    {
      key: "role",
      filterOptions: ["owner", "admin", "editor", "viewer"].map((value) => ({ value, label: capitalize(value) })),
      filterLabel: "Role",
      header: "Role",
      accessor: (row) => row.role,
      sortable: true,
      width: "18%",
      editor: (row) => row.kind === "member" && canManageRow(row, manageOpts) ? {
        value: row.role, label: `Role for ${row.name}`,
        options: assignableRoles(canManageOwners).map((value) => ({ value, label: capitalize(value) })),
        onSave: (value) => changeRole(row, value as Role),
      } : undefined,
      cell: (row) => <TableCategory tone={({ owner: "purple", admin: "blue", editor: "green", viewer: "gray" } satisfies Record<Role, TableCategoryTone>)[row.role]}>{capitalize(row.role)}</TableCategory>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "12%",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.kind === "invite" && canManageRoles ? (
            <Hint label="Copy invite link">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy invite link"
                onClick={() => void copyInvite(row)}
              >
                {isCopied(row.subjectId) ? (
                  <CopyFeedbackIcon copied className="size-4" />
                ) : (
                  <Link2 className="size-4" />
                )}
              </Button>
            </Hint>
          ) : null}
          {canManageRow(row, manageOpts) ? (
            <Hint label={row.kind === "invite" ? "Revoke invitation" : "Remove member"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  row.kind === "invite"
                    ? `Revoke invitation for ${row.name}`
                    : `Remove ${row.name}`
                }
                onClick={() => setPendingRemoval(row)}
              >
                <AnimatedIcon icon={Trash2} size={16} />
              </Button>
            </Hint>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className={`mt-8 ${isPending ? "opacity-70" : ""}`}>
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode, members are not persisted
        </Badge>
      )}

      <SectionTimeline>
      <TimelineSection title="Members">
      <Table
        title="Members"
        data={rows}
        searchValue={(row) => `${row.name} ${row.email ?? ""}`}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState="No members yet"
        noun="member"
      />
      </TimelineSection>

      <RemoveMemberModal
        row={pendingRemoval}
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
      />

      {/* Invite, admins only; editors get a read-only roster. */}
      {canInvite && (
        <TimelineSection title="Invite people" boxed>
          <p className="text-muted-foreground text-sm">
            Creates a join link you can share. Email is optional (just a note).
          </p>
          <form onSubmit={handleInvite} className="members-invite-form mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email (optional)"
              aria-label="Invite email (optional)"
              type="email"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full sm:w-64"
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    aria-label={`Invite role: ${inviteRole}`}
                  />
                }
              >
                <RollInText text={capitalize(inviteRole)} />
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {assignableRoles(false).map((role) => (
                  <DropdownMenuItem
                    key={role}
                    className="capitalize"
                    onClick={() => setInviteRole(role)}
                  >
                    {role}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="submit" className="h-9" disabled={inviting}>
              <Plus className="size-4" />
              <RollInText text={inviting ? "Creating…" : "Create invite"} />
            </Button>
          </form>
        </TimelineSection>
      )}
      </SectionTimeline>
      {confirmDeleteModal}
    </div>
  );
}
