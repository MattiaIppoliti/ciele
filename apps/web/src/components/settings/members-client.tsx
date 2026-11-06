"use client";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { TableCategory, type TableCategoryTone } from "@/components/ui/table-editable-cell";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useMemo, useState, useTransition } from "react";
import type { Invite, Member, MemberAssistantScope, Role } from "@agent-hub/core";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { ChevronDown, Link2 } from "lucide-react";
import Link from "next/link";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { UserAvatar } from "@/components/ui/user-avatar";
import { createInvitesAction, updateMemberRoleAction } from "@/app/actions";
import { MAX_INVITES_PER_SUBMIT, describeInviteOutcome, parseInviteEmails } from "@/lib/invite-emails";

import { Table, type TableColumn } from "@/components/motion/table";
import { RemoveMemberModal } from "@/components/settings/remove-member-modal";
import { AssistantScopeDialog } from "@/components/settings/assistant-scope-dialog";
import { scopeSummary } from "@/lib/members/assistant-scope";
import { RollInText } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { formatDay } from "@/lib/format";
import {
  assignableRoleChoices,
  buildMemberRows,
  canManageRow,
  type MemberRow,
  type RoleChoice,
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

const ROLE_TONES = {
  owner: "purple",
  admin: "blue",
  editor: "green",
  viewer: "gray",
  support_agent: "pink",
} as const satisfies Record<Role, TableCategoryTone>;

/** A built-in keeps its colour; a custom Role reads in the colour of its tier, outlined by name. */
function roleTone(row: Pick<MemberRow, "role">): TableCategoryTone {
  return ROLE_TONES[row.role];
}

export function MembersClient({
  members,
  invites,
  currentUserId,
  canManageRoles,
  canManageOwners,
  canInvite,
  demo,
  assistantAccess,
  roles,
  capabilities,
}: {
  members: Member[];
  invites: Invite[];
  currentUserId: string;
  /** Every Role of the Organization, for the pickers. */
  roles: RoleChoice[];
  /** The signed-in Member's Capabilities: a Role is offered only when they hold all of it. */
  capabilities: readonly string[];
  /** Admins and owners edit roles and remove people. */
  canManageRoles: boolean;
  /** Only owners may grant or revoke ownership. */
  canManageOwners: boolean;
  canInvite: boolean;
  demo: boolean;
  /**
   * Each Member's Assistant scope and row count, and the Assistants to pick
   * from. Present only for those who manage members.
   */
  assistantAccess?: {
    assistants: Array<{ id: string; title: string }>;
    members: Record<string, { scope: MemberAssistantScope; rows: number }>;
  };
}) {
  const [scopes, setScopes] = useState(assistantAccess?.members ?? {});
  const [scopeFor, setScopeFor] = useState<Member | null>(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const parsedEmails = useMemo(() => parseInviteEmails(inviteEmails), [inviteEmails]);
  const inviteProblem = parsedEmails.invalid.length
    ? `Not an email address: ${parsedEmails.invalid.join(", ")}`
    : parsedEmails.tooMany
      ? `Invite at most ${MAX_INVITES_PER_SUBMIT} people at a time`
      : null;
  const assignable = useMemo(
    () => assignableRoleChoices(roles, { canManageOwners, capabilities }),
    [roles, canManageOwners, capabilities]
  );
  const inviteChoices = useMemo(() => assignable.filter((role) => role.key !== "owner"), [assignable]);
  const [inviteRoleId, setInviteRoleId] = useState<string>(
    () => (inviteChoices.find((role) => role.memberDefault) ?? inviteChoices.find((role) => role.key === "editor") ?? inviteChoices.at(-1))?.id ?? ""
  );
  const inviteRole = inviteChoices.find((role) => role.id === inviteRoleId) ?? inviteChoices[0];
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
    if (inviteProblem) return;
    startInvite(async () => {
      let outcome: Awaited<ReturnType<typeof createInvitesAction>>;
      try {
        if (!inviteRole) throw new Error("Choose a role for the invitation");
        outcome = await createInvitesAction(inviteRole.id, inviteEmails);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create the invite",
        );
        return;
      }
      // Only what failed stays in the box, so a second submit retries those.
      const summary = describeInviteOutcome(outcome);
      setInviteEmails(summary.keep);
      const [only] = outcome.created;
      const single =
        only && outcome.created.length === 1 && !outcome.failed.length &&
        !outcome.alreadyInvited.length && !outcome.alreadyMembers.length;
      if (!single) {
        if (summary.tone === "error") toast.error(summary.message);
        else if (outcome.created.length > 1) toast.success(`${summary.message}. Copy each link from the list`);
        else toast.success(summary.message);
        return;
      }
      const copied = await copyText(only.id, inviteUrl(only.token));
      if (copied) toast.success("Invite created, link copied to clipboard");
      else toast.success("Invite created, use Copy link to copy it");
    });
  }

  async function applyRole(row: MemberRow, role: RoleChoice) {
    await updateMemberRoleAction(row.subjectId, role.id);
    toast.success(`Role updated to ${role.name}`);
  }

  function changeRole(row: MemberRow, roleId: string) {
    const role = roles.find((item) => item.id === roleId);
    if (!role || role.id === row.roleId) return;
    // Ownership is the one role that can take the organization away from
    // whoever holds it now, so granting or removing it asks first.
    if (role.tier === "owner" || row.role === "owner") {
      const granting = role.tier === "owner";
      confirmDelete({
        title: granting
          ? `Make ${row.name} an owner?`
          : `Remove ${row.name} as an owner?`,
        description: granting
          ? "Owners have full control of the organization, including billing, every member's role and granting ownership to others."
          : `They become ${role.name} and lose control of billing and ownership.`,
        confirmLabel: granting ? "Make owner" : `Change to ${role.name}`,
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
      width: assistantAccess ? "28%" : "38%",
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
      width: assistantAccess ? "12%" : "14%",
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
      width: assistantAccess ? "14%" : "18%",
      hideBelowSm: true,
      cell: (row) => (
        <span className="text-muted-foreground"><RollInText text={formatDay(row.since)} /></span>
      ),
    },
    {
      key: "role",
      filterOptions: roles.map((role) => ({ value: role.name, label: role.name })),
      filterLabel: "Role",
      header: "Role",
      accessor: (row) => row.roleName,
      sortable: true,
      width: assistantAccess ? "14%" : "18%",
      editor: (row) => row.kind === "member" && row.roleId && canManageRow(row, manageOpts) ? {
        value: row.roleId, label: `Role for ${row.name}`,
        // The Role they hold stays listed even when the editor could not give it.
        options: [...assignable, ...roles.filter((role) => role.id === row.roleId && !assignable.includes(role))]
          .map((role) => ({ value: role.id, label: role.name })),
        onSave: (value) => changeRole(row, value),
      } : undefined,
      cell: (row) => <TableCategory tone={roleTone(row)}>{row.roleName}</TableCategory>,
    },
    ...(assistantAccess
      ? [
          {
            key: "assistants",
            header: "Assistants",
            accessor: (row: MemberRow) => (row.kind === "member" ? scopeSummary({ role: row.role, scope: scopes[row.subjectId]?.scope ?? "all", rows: scopes[row.subjectId]?.rows ?? 0 }) : ""),
            width: "20%",
            hideBelowSm: true,
            cell: (row: MemberRow) =>
              row.kind !== "member" ? (
                <span className="text-muted-foreground">On joining</span>
              ) : (
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate text-sm">
                    <RollInText
                      text={scopeSummary({ role: row.role, scope: scopes[row.subjectId]?.scope ?? "all", rows: scopes[row.subjectId]?.rows ?? 0 })}
                    />
                  </span>
                  {row.role !== "owner" && canManageRow(row, manageOpts) && (
                    <button
                      type="button"
                      className="press-text text-primary text-xs underline-offset-4 hover:underline"
                      onClick={() => setScopeFor(members.find((member) => member.userId === row.subjectId) ?? null)}
                    >
                      Manage assistants
                    </button>
                  )}
                </span>
              ),
          } satisfies TableColumn<MemberRow>,
        ]
      : []),
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
        rowMenu={(row) => ({
          title: row.name,
          actions: [
            row.kind === "invite" && canManageRoles && { label: "Copy invite link", icon: Link2, onSelect: () => void copyInvite(row) },
            canManageRow(row, manageOpts) && { label: row.kind === "invite" ? "Revoke invitation" : "Remove member", icon: Trash2, destructive: true, onSelect: () => setPendingRemoval(row) },
          ],
        })}
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
            Creates a join link for each address. Separate several with commas,
            spaces or new lines. Leave it empty for one link you share yourself.
          </p>
          <form onSubmit={handleInvite} className="members-invite-form mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="ada@example.com, grace@example.com"
              aria-label="Emails to invite (optional)"
              aria-invalid={inviteProblem ? true : undefined}
              aria-describedby={inviteProblem ? "invite-emails-problem" : undefined}
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full sm:w-80"
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    aria-label={`Invite role: ${inviteRole?.name ?? "none"}`}
                  />
                }
              >
                <RollInText text={inviteRole?.name ?? "Choose a role"} />
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {inviteChoices.map((role) => (
                  <DropdownMenuItem
                    key={role.id}
                    onClick={() => setInviteRoleId(role.id)}
                  >
                    {role.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="submit" className="h-9" disabled={inviting || inviteProblem !== null}>
              <Plus className="size-4" />
              <RollInText
                text={
                  inviting
                    ? "Creating…"
                    : parsedEmails.emails.length > 1
                      ? `Create ${parsedEmails.emails.length} invites`
                      : "Create invite"
                }
              />
            </Button>
          </form>
          {inviteProblem && (
            // Read with the field through `aria-describedby`; an alert here
            // would interrupt on every keystroke of an address still being typed.
            <p id="invite-emails-problem" className="text-destructive mt-2 text-sm">
              {inviteProblem}
            </p>
          )}
        </TimelineSection>
      )}
      <TimelineSection title="Roles" boxed>
        <p className="text-muted-foreground text-sm">
          {roles.length} roles decide what each member can do. Edit the built-in ones or create your own.
        </p>
        <Button variant="outline" className="mt-3 h-9" render={<Link href="/settings/roles" />}>
          Open Roles
          <ArrowRight className="size-4" />
        </Button>
      </TimelineSection>
      </SectionTimeline>
      {confirmDeleteModal}
      {assistantAccess && scopeFor && (
        <AssistantScopeDialog
          key={scopeFor.userId}
          member={scopeFor}
          assistants={assistantAccess.assistants}
          roles={roles
            .filter((role) => role.assistantLevel && role.key !== "owner")
            .map((role) => ({ id: role.id, name: role.name, key: role.key, assistantDefault: role.assistantDefault }))}
          open
          onClose={() => setScopeFor(null)}
          onSaved={(summary) => setScopes((current) => ({ ...current, [scopeFor.userId]: summary }))}
        />
      )}
    </div>
  );
}
