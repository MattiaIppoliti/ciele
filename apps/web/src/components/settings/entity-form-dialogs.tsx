"use client";

import { useState, useTransition } from "react";
import type {
  Entity,
  EntityAttributeType,
  EntityScope,
} from "@agent-hub/core";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEntityAction, updateEntityAction } from "@/app/actions";

type DialogProps = { open: boolean; onClose: () => void };
type DraftAttribute = { key: string; label: string; type: EntityAttributeType };

const ATTRIBUTE_TYPES: EntityAttributeType[] = [
  "text",
  "number",
  "date",
  "boolean",
];
const EMPTY_ATTRIBUTE: DraftAttribute = { key: "", label: "", type: "text" };

export function EditEntityDialog({
  entity,
  open,
  onClose,
}: DialogProps & { entity: Entity }) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description);

  const save = () =>
    startTransition(async () => {
      try {
        await updateEntityAction(entity.id, { name, description });
        toast.success("Entity updated.");
        onClose();
      } catch {
        toast.error("Couldn't update the entity. Please try again.");
      }
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit “{entity.name}”</DialogTitle>
          <DialogDescription>
            Attributes, key and scope are fixed once records depend on them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entity-edit-name">Name</Label>
            <Input
              id="entity-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-edit-description">Description</Label>
            <Input
              id="entity-edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={isPending || !name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateEntityDialog({ open, onClose }: DialogProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState<DraftAttribute[]>([
    { ...EMPTY_ATTRIBUTE },
  ]);
  const [keyAttribute, setKeyAttribute] = useState("");
  const [scope, setScope] = useState<EntityScope>("shared");
  const [identityAttribute, setIdentityAttribute] = useState("");
  const keys = attributes.map((attribute) => attribute.key.trim()).filter(Boolean);

  const setAttribute = (index: number, patch: Partial<DraftAttribute>) =>
    setAttributes((current) =>
      current.map((attribute, position) =>
        position === index ? { ...attribute, ...patch } : attribute
      )
    );

  const submit = () =>
    startTransition(async () => {
      const result = await createEntityAction({
        name,
        description,
        attributes: attributes.filter((attribute) => attribute.key.trim()),
        keyAttribute,
        scope,
        identityAttribute: scope === "user" ? identityAttribute : null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created “${result.entity!.name}”.`);
      setName("");
      setDescription("");
      setAttributes([{ ...EMPTY_ATTRIBUTE }]);
      setKeyAttribute("");
      setScope("shared");
      setIdentityAttribute("");
      onClose();
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New entity</DialogTitle>
          <DialogDescription>
            Describe one record type. The key identifies a record across imports.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entity-name">Name</Label>
            <Input id="entity-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Orders" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-description">Description</Label>
            <Input id="entity-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="One row per order" />
          </div>
          <div className="space-y-2">
            <Label>Attributes</Label>
            {attributes.map((attribute, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input value={attribute.key} onChange={(event) => setAttribute(index, { key: event.target.value })} placeholder="key (CSV header)" className="flex-1" />
                <Input value={attribute.label} onChange={(event) => setAttribute(index, { label: event.target.value })} placeholder="Label" className="flex-1" />
                <Select value={attribute.type} onValueChange={(value) => setAttribute(index, { type: (value ?? "text") as EntityAttributeType })}>
                  <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setAttributes((current) => current.length === 1 ? current : current.filter((_, position) => position !== index))}>✕</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setAttributes((current) => [...current, { ...EMPTY_ATTRIBUTE }])}>Add attribute</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Key attribute</Label>
              <Select value={keyAttribute || undefined} onValueChange={(value) => setKeyAttribute(value ?? "")}>
                <SelectTrigger><SelectValue placeholder="Pick an attribute" /></SelectTrigger>
                <SelectContent>{keys.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(value) => setScope((value ?? "shared") as EntityScope)}>
                <SelectTrigger><SelectValue>{(value: EntityScope) => value === "user" ? "User-scoped" : "Shared"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">Shared — anyone the assistant serves</SelectItem>
                  <SelectItem value="user">User-scoped — rows belong to one signed-in user</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {scope === "user" && (
            <div className="space-y-1.5">
              <Label>Identity attribute</Label>
              <Select value={identityAttribute || undefined} onValueChange={(value) => setIdentityAttribute(value ?? "")}>
                <SelectTrigger><SelectValue placeholder="Which attribute identifies the user" /></SelectTrigger>
                <SelectContent>{keys.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Matched against the verified sign-in identity, so each user only reads their own records.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={isPending || !name.trim()}>Create entity</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
