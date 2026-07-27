"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Organization } from "@agent-hub/core";
import { toast } from "sonner";
import {
  updateOrganizationAction,
  uploadOrganizationLogoAction,
} from "@/app/actions";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";

function FieldHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
    </div>
  );
}

export function OrganizationClient({
  organization,
  demo,
}: {
  organization: Organization;
  demo: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(organization.name);
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? "");
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");

  const dirty = name !== organization.name;

  function handleSave() {
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    startTransition(async () => {
      await updateOrganizationAction({ name: name.trim() });
      toast.success("Organization saved");
      router.refresh();
    });
  }

  async function uploadLogo(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(previewUrl);
    const form = new FormData();
    form.set("file", file);
    const result = await uploadOrganizationLogoAction(form);
    URL.revokeObjectURL(previewUrl);
    setLogoPreviewUrl("");
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.logoUrl) {
      setLogoUrl(result.logoUrl);
      toast.success("Logo uploaded");
      router.refresh();
    }
  }

  function removeLogo() {
    setLogoUrl("");
    startTransition(async () => {
      await updateOrganizationAction({ logoUrl: null });
      toast.success("Logo removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-10 pt-8 pb-24">
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode — changes only last for this session
        </Badge>
      )}

      <div className="space-y-3">
        <FieldHeader
          title="Logo"
          hint="Circular icon shown in the organization switcher and account menu."
        />
        <AvatarUpload
          value={logoPreviewUrl || logoUrl}
          onFile={(file) =>
            startTransition(() => {
              void uploadLogo(file);
            })
          }
          onRemove={removeLogo}
          fallback={
            <span className="bg-primary text-primary-foreground flex size-full items-center justify-center text-2xl font-semibold">
              {name.slice(0, 1).toUpperCase() || "?"}
            </span>
          }
        />
      </div>

      <div className="space-y-3">
        <FieldHeader title="Organization name" hint="Shown throughout the admin app." />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 max-w-sm"
        />
      </div>

      <div className="bg-background/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        {dirty && <span className="text-muted-foreground text-sm">Unsaved changes</span>}
        <Button onClick={handleSave} disabled={isPending || !dirty} className="px-6 font-semibold">
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
