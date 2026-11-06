"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, ChevronRight, Lock, RotateCcw, Search, Trash2 } from "lucide-react";
import { CAPABILITIES, CAPABILITY_CATALOG, builtinRoleDefaults, isBuiltinRoleKey } from "@agent-hub/core";
import type { RoleView } from "@ciele/ops";
import { Badge, Button, Input, Label } from "@agent-hub/ui";
import {
  createRoleAction,
  deleteRoleAction,
  resetRoleAction,
  updateRoleAction,
} from "@/app/(admin)/settings/roles/actions";
import { RollInText } from "@/components/motion/roll-in-text";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  bundleViews,
  capabilityOffered,
  heldOnBy,
  restrictToLevels,
  toggleBundle,
  toggleCapability,
} from "@/lib/roles/role-editor";
import { toast } from "@/lib/toast";

const NOTHING = "__nothing__";

/**
 * The role editor (#1164): one form, one Save. Capabilities are grouped in
 * bundles with a tri-state box; a Capability another selected one relies on
 * stays on and says which. The rules live in `lib/roles/role-editor.ts`.
 */
export function RoleEditorClient({
  mode,
  role,
  roles,
  startFromId,
  callerCapabilities,
  callerIsOwner,
  canManage,
  holdsRole,
}: {
  mode: "create" | "edit";
  role?: RoleView;
  roles: RoleView[];
  startFromId: string | null;
  callerCapabilities: readonly string[];
  callerIsOwner: boolean;
  canManage: boolean;
  /** The signed-in Member holds this Role, so they may read it but not edit it. */
  holdsRole: boolean;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const startFrom = roles.find((item) => item.id === startFromId);
  const initial = role ?? startFrom;

  const [name, setName] = useState(mode === "edit" ? role!.name : startFrom ? `${startFrom.name} copy` : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [organizationLevel, setOrganizationLevel] = useState(initial?.organizationLevel ?? true);
  const [assistantLevel, setAssistantLevel] = useState(initial?.assistantLevel ?? false);
  // A new Role starts from what the caller may hand on: Owner-only and
  // unheld Capabilities of the Role it copies are left off.
  const handOn = (ids: readonly string[]) =>
    ids.filter((id) => id !== "personalSubscriptions:manage" && (callerIsOwner || callerCapabilities.includes(id)));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial ? (mode === "create" ? handOn(initial.capabilities) : initial.capabilities) : [])
  );
  const [query, setQuery] = useState("");
  const [startChoice, setStartChoice] = useState(startFromId ?? NOTHING);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const locked = role?.locked ?? false;
  const readOnly = !canManage || locked || holdsRole;
  const held = useMemo(() => new Set(callerCapabilities), [callerCapabilities]);
  const levels = { organizationLevel };
  const views = useMemo(
    () => bundleViews(selected, { query, organizationLevel }),
    [selected, query, organizationLevel]
  );
  const offeredCount = CAPABILITY_CATALOG.filter((capability) => capabilityOffered(capability, levels)).length;

  /** Owner-only, or something the caller does not hold and so cannot hand on. */
  function unavailable(id: string): string | null {
    if (CAPABILITY_CATALOG.find((capability) => capability.id === id)?.tier === "changeRoles") return "Owner only";
    if (!callerIsOwner && !held.has(id)) return "You do not hold this";
    return null;
  }

  function clickCapability(id: string) {
    if (readOnly) return;
    if (!selected.has(id) && unavailable(id)) return;
    const next = toggleCapability(selected, id);
    if (next.size === selected.size && selected.has(id)) {
      toast.error(`Needed by ${heldOnBy(id, selected).join(", ")}. Turn those off first.`);
      return;
    }
    setSelected(next);
  }

  function clickBundle(bundle: (typeof views)[number]["bundle"]) {
    if (readOnly) return;
    const next = toggleBundle(selected, bundle, levels);
    // Ticking a bundle never adds what the caller could not hand on.
    setSelected(new Set([...next].filter((id) => selected.has(id) || !unavailable(id))));
  }

  function changeOrganizationLevel(value: boolean) {
    if (!value && !assistantLevel) setAssistantLevel(true);
    setOrganizationLevel(value);
    setSelected(restrictToLevels(selected, { organizationLevel: value }));
  }

  function chooseStart(id: string) {
    const source = roles.find((item) => item.id === id);
    setSelected(new Set(source ? handOn(source.capabilities) : []));
    if (source) {
      setOrganizationLevel(source.organizationLevel);
      setAssistantLevel(source.assistantLevel);
    }
  }

  function save() {
    const input = {
      name: name.trim(),
      description: description.trim(),
      capabilities: CAPABILITIES.filter((id) => selected.has(id)),
      organizationLevel,
      assistantLevel,
    };
    startSave(async () => {
      try {
        if (mode === "create") {
          const created = await createRoleAction(input);
          toast.success(`${created.name} created`);
          router.push(`/settings/roles/${created.id}`);
        } else {
          const updated = await updateRoleAction(role!.id, input);
          setSelected(new Set(updated.capabilities));
          toast.success(`${updated.name} saved`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the role");
      }
    });
  }

  function reset() {
    if (!role) return;
    confirmDelete({
      title: `Reset ${role.name} to default?`,
      description: "Its capabilities go back to the ones a new Organization starts with. Everyone who holds it is affected at once.",
      confirmLabel: "Reset to default",
      onConfirm: async () => {
        try {
          const updated = await resetRoleAction(role.id);
          setSelected(new Set(updated.capabilities));
          setName(updated.name);
          toast.success(`${updated.name} reset to default`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not reset the role");
        }
      },
    });
  }

  function remove() {
    if (!role) return;
    confirmDelete({
      title: `Delete ${role.name}?`,
      description: "Members, invitations and API keys that hold it must have another role first.",
      confirmLabel: "Delete role",
      onConfirm: async () => {
        try {
          await deleteRoleAction(role.id);
          toast.success(`${role.name} deleted`);
          router.push("/settings/roles");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not delete the role");
        }
      },
    });
  }

  const dirtyFromDefaults =
    role?.builtIn && role.key && isBuiltinRoleKey(role.key) && !locked
      ? builtinRoleDefaults(role.key).join() !== CAPABILITIES.filter((id) => selected.has(id)).join()
      : false;

  return (
    <div className="mt-6 space-y-6">
      <Link href="/settings/roles" className="press-text text-muted-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" />
        All roles
      </Link>

      {role && (
        <div className="flex flex-wrap items-center gap-2">
          {locked ? (
            <Badge variant="outline" className="gap-1"><Lock aria-hidden className="size-3" />Locked</Badge>
          ) : role.builtIn ? (
            <Badge variant="secondary">Built-in</Badge>
          ) : (
            <Badge variant="outline">Custom</Badge>
          )}
          {role.edited && <Badge variant="outline">Edited</Badge>}
        </div>
      )}

      {locked && (
        <p className="text-muted-foreground rounded-lg border p-3 text-sm">
          The Owner role holds every capability, including ones added later. It cannot be edited. Make someone an Owner from Members.
        </p>
      )}
      {!locked && holdsRole && (
        <p className="text-muted-foreground rounded-lg border p-3 text-sm">
          This is your role, so you cannot edit it. Ask an Owner, or someone with another role that can manage roles.
        </p>
      )}

      <section className="space-y-4">
        {mode === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor="role-start">Start from</Label>
            <Select
              value={startChoice}
              onValueChange={(value) => {
                setStartChoice(String(value));
                chooseStart(String(value));
              }}
            >
              <SelectTrigger id="role-start" className="h-10 w-full sm:w-72" aria-label="Start from">
                <SelectValue>
                  {(value: string) => roles.find((item) => item.id === value)?.name ?? "Nothing"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOTHING}>Nothing</SelectItem>
                {roles.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            disabled={readOnly}
            placeholder="Content reviewer"
            className="h-10 sm:w-96"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role-description">Description</Label>
          <Textarea
            id="role-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            disabled={readOnly}
            placeholder="What members with this role do"
            rows={2}
          />
        </div>
        <fieldset className="space-y-2" disabled={readOnly}>
          <legend className="text-sm font-medium">Available on</legend>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={organizationLevel} onCheckedChange={(value) => changeOrganizationLevel(Boolean(value))} disabled={readOnly} />
            <span>
              <span className="block">Organization</span>
              <span className="text-muted-foreground block text-xs">Give it to members, invitations and API keys.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={assistantLevel}
              onCheckedChange={(value) => {
                if (!value && !organizationLevel) return;
                setAssistantLevel(Boolean(value));
              }}
              disabled={readOnly}
            />
            <span>
              <span className="block">Assistant</span>
              <span className="text-muted-foreground block text-xs">Offer it when limiting a member to some Assistants. Only Assistant capabilities apply there.</span>
            </span>
          </label>
        </fieldset>
      </section>

      <section className="rounded-xl border">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search capabilities"
              aria-label="Search capabilities"
              className="h-9 pl-8"
            />
          </div>
          <span className="text-muted-foreground text-sm tabular-nums">
            <RollInText text={`${selected.size} of ${offeredCount} selected`} />
          </span>
          {!readOnly && (
            <Button variant="ghost" className="h-9" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear all
            </Button>
          )}
        </div>
        <ul className="divide-y">
          {views.map((view) => {
            const expanded = open.has(view.bundle) || query.trim().length > 0;
            const offered = CAPABILITY_CATALOG.filter(
              (capability) => capability.bundle === view.bundle && capabilityOffered(capability, levels)
            ).length;
            return (
              <li key={view.bundle}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={view.state === "on"}
                    indeterminate={view.state === "some"}
                    onCheckedChange={() => clickBundle(view.bundle)}
                    disabled={readOnly || offered === 0}
                    aria-label={`All of ${view.bundle}`}
                  />
                  <button
                    type="button"
                    className="press-text flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(view.bundle)) next.delete(view.bundle);
                        else next.add(view.bundle);
                        return next;
                      })
                    }
                  >
                    <span className="font-medium">{view.bundle}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      <RollInText text={`${view.selected} of ${offered}`} />
                    </span>
                    <ChevronRight
                      aria-hidden
                      className={`text-muted-foreground ml-auto size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                  </button>
                </div>
                {expanded && (
                  <ul className="bg-muted/30 border-t">
                    {view.capabilities.map((capability) => {
                      const on = selected.has(capability.id);
                      const keptOnBy = on ? heldOnBy(capability.id, selected) : [];
                      const notOffered = !capabilityOffered(capability, levels);
                      const why = notOffered ? "Organization only" : unavailable(capability.id);
                      return (
                        <li key={capability.id} className="flex items-start gap-3 py-2.5 pr-3 pl-10">
                          <Checkbox
                            checked={on}
                            onCheckedChange={() => clickCapability(capability.id)}
                            disabled={readOnly || (!on && Boolean(why))}
                            aria-label={capability.label}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm">
                              <span>{capability.label}</span>
                              <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs">{capability.id}</code>
                              {keptOnBy.length > 0 && (
                                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                  <Lock aria-hidden className="size-3" />
                                  Needed by {keptOnBy.join(", ")}
                                </span>
                              )}
                              {!on && why && <span className="text-muted-foreground text-xs">{why}</span>}
                            </p>
                            <p className="text-muted-foreground text-xs">{capability.description}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
          {views.length === 0 && <li className="text-muted-foreground p-4 text-sm">No capability matches “{query}”.</li>}
        </ul>
      </section>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} loading={saving} disabled={saving || !name.trim()}>
            {mode === "create" ? "Create role" : "Save"}
          </Button>
          <Button variant="ghost" render={<Link href="/settings/roles" />}>Cancel</Button>
          <span className="flex-1" />
          {role?.builtIn && (role.edited || dirtyFromDefaults) && (
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="size-4" />
              Reset to default
            </Button>
          )}
          {role && !role.builtIn && (
            <Button variant="outline" onClick={remove} className="text-destructive">
              <Trash2 className="size-4" />
              Delete role
            </Button>
          )}
        </div>
      )}
      {confirmDeleteModal}
    </div>
  );
}
