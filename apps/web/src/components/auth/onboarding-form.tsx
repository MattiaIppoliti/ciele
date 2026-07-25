"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createOrganizationAction } from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";

export function OnboardingForm() {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    startTransition(async () => {
      await createOrganizationAction(name);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Corp"
          autoFocus
          className="bg-white"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creating..." : "Create organization"}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        Got an invite link instead? Just open it — you&apos;ll join that
        organization automatically.
      </p>
    </form>
  );
}
