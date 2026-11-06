"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import type { Member } from "@agent-hub/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@agent-hub/ui";
import {
  getMemberAssistantAccessAction,
  setMemberAssistantScopeAction,
} from "@/app/(admin)/settings/members/assistant-actions";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  choiceLabel,
  defaultAssistantChoice,
  draftAccess,
  draftFrom,
  sameDraft,
  withAllSelected,
  withRow,
  withScope,
  type AssistantRoleOption,
  type ScopeDraft,
} from "@/lib/members/assistant-scope";
import { toast } from "@/lib/toast";

/**
 * Settings > Members > Assistants: which Assistants one Member reaches, and at
 * which Role on each. "All assistants" keeps the org Role everywhere, with
 * optional overrides; "Only selected assistants" limits the Member to the
 * ticked ones, so a new Assistant stays hidden from them until it is added.
 */
export function AssistantScopeDialog({
  member,
  assistants,
  roles,
  open,
  onClose,
  onSaved,
}: {
  member: Pick<Member, "userId" | "email" | "role" | "roleName">;
  assistants: Array<{ id: string; title: string }>;
  /** The Roles offered on Assistants, custom ones included (ADR-0028). */
  roles: AssistantRoleOption[];
  open: boolean;
  onClose: () => void;
  onSaved: (summary: { scope: ScopeDraft["scope"]; rows: number }) => void;
}) {
  const [stored, setStored] = useState<ScopeDraft | null>(null);
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [query, setQuery] = useState("");
  const [saving, startSave] = useTransition();
  const fallbackRole = defaultAssistantChoice(roles);
  const overrides = [{ value: "org", label: "Organization role" }, { value: "denied", label: "Denied" }, ...roles.map((role) => ({ value: role.id, label: role.name }))];

  useEffect(() => {
    if (!open) return;
    // The parent mounts one dialog per Member (keyed), so state starts empty.
    let cancelled = false;
    getMemberAssistantAccessAction(member.userId)
      .then((current) => {
        if (cancelled) return;
        const loaded = draftFrom(current.scope, current.access);
        setStored(loaded);
        setDraft(loaded);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load this member's assistant access");
      });
    return () => {
      cancelled = true;
    };
  }, [open, member.userId]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? assistants.filter((a) => a.title.toLowerCase().includes(needle)) : assistants;
  }, [assistants, query]);

  const dirty = Boolean(draft && stored && !sameDraft(draft, stored));
  const selectedCount = draft ? draftAccess(draft, assistants.map((a) => a.id)).length : 0;
  const allShownChecked = Boolean(draft) && shown.length > 0 && shown.every((a) => draft!.rows[a.id] && draft!.rows[a.id] !== "denied");

  function save() {
    if (!draft) return;
    const access = draftAccess(draft, assistants.map((a) => a.id));
    if (draft.scope === "selected" && access.length === 0) {
      toast.error("Select at least one assistant, or give access to all assistants");
      return;
    }
    startSave(async () => {
      try {
        await setMemberAssistantScopeAction(member.userId, draft.scope, access);
        toast.success("Assistant access updated");
        onSaved({ scope: draft.scope, rows: access.length });
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update assistant access");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add assistants</DialogTitle>
          <p className="text-muted-foreground text-sm">{member.email}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {member.role === "owner" ? (
            <p className="text-muted-foreground text-sm">
              An owner always has access to every assistant, at the organization level.
            </p>
          ) : !draft ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <>
              <RadioGroup
                value={draft.scope}
                onValueChange={(value) => {
                  if (value === "all" || value === "selected") {
                    setDraft(withScope(draft, value));
                  }
                }}
                aria-label="Assistant access"
                className="sm:grid-cols-2"
                options={[
                  {
                    value: "all",
                    label: "All assistants",
                    hint: `${member.roleName ?? member.role} on every assistant, now and later.`,
                  },
                  {
                    value: "selected",
                    label: "Only selected assistants",
                    hint: "New assistants stay hidden until you add them.",
                  },
                ]}
              />

              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search assistants"
                  aria-label="Search assistants"
                  className="h-10 pl-9"
                />
              </div>

              {draft.scope === "selected" && shown.length > 0 && (
                <label className="flex items-center gap-2.5 px-1 text-sm">
                  <Checkbox
                    checked={allShownChecked}
                    onCheckedChange={(checked) =>
                      setDraft(withAllSelected(draft, shown.map((a) => a.id), Boolean(checked), fallbackRole))
                    }
                  />
                  Select all shown
                </label>
              )}

              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {shown.length === 0 && (
                  <p className="text-muted-foreground px-1 py-4 text-sm">No assistants match.</p>
                )}
                {shown.map((assistant, index) => {
                  const row = draft.rows[assistant.id] ?? null;
                  return (
                    <RollRow key={assistant.id} index={index}>
                      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                        {draft.scope === "selected" ? (
                          <label className="flex min-w-0 items-center gap-2.5 text-sm">
                            <Checkbox
                              checked={Boolean(row)}
                              onCheckedChange={(checked) =>
                                setDraft(withRow(draft, assistant.id, checked ? (row ?? fallbackRole) : null))
                              }
                            />
                            <span className="truncate">{assistant.title}</span>
                          </label>
                        ) : (
                          <span className="min-w-0 truncate text-sm">{assistant.title}</span>
                        )}
                        {draft.scope === "selected" ? (
                          <Select
                            value={row ?? fallbackRole}
                            disabled={!row}
                            onValueChange={(value) => setDraft(withRow(draft, assistant.id, String(value)))}
                          >
                            <SelectTrigger className="h-9 w-40" aria-label={`Role on ${assistant.title}`}>
                              <RollInText text={choiceLabel(row && row !== "denied" ? row : fallbackRole, roles)} />
                            </SelectTrigger>
                            <SelectContent>
                              {roles.map((role) => (
                                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={row ?? "org"}
                            onValueChange={(value) =>
                              setDraft(withRow(draft, assistant.id, value === "org" ? null : String(value)))
                            }
                          >
                            <SelectTrigger className="h-9 w-44" aria-label={`Access to ${assistant.title}`}>
                              <RollInText text={choiceLabel(row, roles)} />
                            </SelectTrigger>
                            <SelectContent>
                              {overrides.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </RollRow>
                  );
                })}
              </div>
              {draft.scope === "selected" && (
                <p className="text-muted-foreground text-xs">
                  <RollInText text={`${selectedCount} of ${assistants.length} selected`} />
                </p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {member.role !== "owner" && (
            <Button loading={saving} disabled={!dirty || saving} onClick={save}>Save</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
