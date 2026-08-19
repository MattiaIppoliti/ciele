"use client";

import { useMemo, useState, useTransition } from "react";
import type { Invite, Member, Role } from "@agent-hub/core";
import { ChevronDown, Link2, Plus, Trash2, UserRound } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { createInviteAction, updateMemberRoleAction } from "@/app/actions";
import { Table, type TableColumn } from "@/components/motion/table";
import { RemoveMemberModal } from "@/components/settings/remove-member-modal";
import { formatDay } from "@/lib/format";
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
  const { copyText, isCopied } = useCopyFeedback<string>();

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
    startTransition(async () => {
      const invite = await createInviteAction(inviteRole, inviteEmail || undefined);
      const copied = await copyText(invite.id, inviteUrl(invite.token));
      if (copied) toast.success("Invite created, link copied to clipboard");
      else toast.success("Invite created, use Copy link to copy it");
      setInviteEmail("");
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
          <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
            <UserRound className="text-foreground/70 size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {row.name}
              {row.isSelf && <span className="text-muted-foreground"> (you)</span>}
            </p>
            {row.email && row.email !== row.name ? (
              <p className="text-muted-foreground truncate text-xs">{row.email}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (row) => row.status,
      sortable: true,
      width: "14%",
      cell: (row) =>
        row.status === "active" ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="outline">Pending</Badge>
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
        <span className="text-muted-foreground">{formatDay(row.since)}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      accessor: (row) => row.role,
      sortable: true,
      width: "18%",
      // A pending invite's role is fixed at creation; there is no member row
      // to update yet, so it renders as a badge like an unmanageable member.
      cell: (row) =>
        row.kind === "member" && canManageRow(row, manageOpts) ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="capitalize" />
              }
            >
              {row.role}
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {assignableRoles(canManageOwners).map((role) => (
                <DropdownMenuItem
                  key={role}
                  className="capitalize"
                  onClick={() =>
                    startTransition(async () => {
                      await updateMemberRoleAction(row.subjectId, role);
                      toast.success(`Role updated to ${role}`);
                    })
                  }
                >
                  {role}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge variant="outline" className="capitalize">
            {row.role}
          </Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
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
    <div className={`mt-8 space-y-8 ${isPending ? "opacity-70" : ""}`}>
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode, members are not persisted
        </Badge>
      )}

      <Table
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState="No members yet"
      />

      <RemoveMemberModal
        row={pendingRemoval}
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
      />

      {/* Invite, admins only; editors get a read-only roster. */}
      {canInvite && (
        <div>
          <h2 className="text-lg font-semibold">Invite people</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates a join link you can share. Email is optional (just a note).
          </p>
          <form onSubmit={handleInvite} className="mt-3 flex flex-wrap gap-2">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email (optional)"
              type="email"
              className="w-64"
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="capitalize" />
                }
              >
                {inviteRole}
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
            <Button type="submit" disabled={isPending}>
              <Plus className="size-4" /> Create invite
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
