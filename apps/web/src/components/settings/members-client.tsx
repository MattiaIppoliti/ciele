"use client";

import { useState, useTransition } from "react";
import type { Invite, Member, Role } from "@agent-hub/core";
import { Plus, Trash2, UserRound } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "sonner";
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
} from "@/app/actions";
import {
  Badge,
  Button,
  Card,
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

const ROLES: Role[] = ["owner", "admin", "editor", "viewer"];

function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

export function MembersClient({
  members,
  invites,
  currentUserId,
  canChangeRoles,
  canInvite,
  demo,
}: {
  members: Member[];
  invites: Invite[];
  currentUserId: string;
  canChangeRoles: boolean;
  canInvite: boolean;
  demo: boolean;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [isPending, startTransition] = useTransition();
  const { copyText, isCopied } = useCopyFeedback<string>();

  async function copyInvite(invite: Invite) {
    if (await copyText(invite.id, inviteUrl(invite.token))) {
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
      if (copied) toast.success("Invite created — link copied to clipboard");
      else toast.success("Invite created — use Copy link to copy it");
      setInviteEmail("");
    });
  }

  return (
    <div className={`mt-8 space-y-8 ${isPending ? "opacity-70" : ""}`}>
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode — members are not persisted
        </Badge>
      )}

      {/* Members table */}
      <Card size="sm" className="gap-0 p-0">
        {members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center gap-3 border-b px-5 py-4 last:border-b-0"
          >
            <span className="bg-muted flex size-9 items-center justify-center rounded-full">
              <UserRound className="text-foreground/70 size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.email || member.userId}
                {member.userId === currentUserId && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </p>
            </div>
            {canChangeRoles && member.userId !== currentUserId ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" className="capitalize" />}
                >
                  {member.role}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ROLES.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      className="capitalize"
                      onClick={() =>
                        startTransition(async () => {
                          await updateMemberRoleAction(member.userId, role);
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
                {member.role}
              </Badge>
            )}
            {member.userId !== currentUserId && canChangeRoles && (
              <Hint label="Remove member">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove member"
                  onClick={() => {
                    if (!window.confirm("Remove this member?")) return;
                    startTransition(async () => {
                      await removeMemberAction(member.userId);
                      toast.success("Member removed");
                    });
                  }}
                >
                  <AnimatedIcon icon={Trash2} size={16} />
                </Button>
              </Hint>
            )}
          </div>
        ))}
      </Card>

      {/* Invite — admins only; editors get a read-only roster. */}
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
              render={<Button type="button" variant="outline" className="capitalize" />}
            >
              {inviteRole}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ROLES.filter((r) => r !== "owner").map((role) => (
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

        {invites.length > 0 && (
          <div className="mt-4 space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-2.5"
              >
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">
                    {invite.email || "Anyone with the link"}
                  </span>{" "}
                  <Badge variant="outline" className="ml-1 capitalize">
                    {invite.role}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyInvite(invite)}
                >
                  <CopyFeedbackIcon
                    copied={isCopied(invite.id)}
                    className="size-4"
                  />
                  {isCopied(invite.id) ? "Copied" : "Copy link"}
                </Button>
                <Hint label="Revoke invite">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Revoke invite"
                    onClick={() =>
                      startTransition(async () => {
                        await revokeInviteAction(invite.id);
                        toast.success("Invite revoked");
                      })
                    }
                  >
                    <AnimatedIcon icon={Trash2} size={16} />
                  </Button>
                </Hint>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
