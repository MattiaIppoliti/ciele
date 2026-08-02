"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Organization } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import {
  updateOrganizationAction,
  uploadOrganizationLogoAction,
} from "@/app/actions";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Trace-retention choices (#573). "forever" maps to null (the default): an
 * org's transcripts never lose their Thinking panels unless an admin opts in.
 */
const RETENTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "forever", label: "Keep forever (default)" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];

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
  const storedRetention = organization.traceRetentionDays
    ? String(organization.traceRetentionDays)
    : "forever";
  const [retention, setRetention] = useState(storedRetention);

  const dirty = name !== organization.name || retention !== storedRetention;

  function handleSave() {
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    startTransition(async () => {
      await updateOrganizationAction({
        name: name.trim(),
        traceRetentionDays:
          retention === "forever" ? null : Number.parseInt(retention, 10),
      });
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

      <div className="space-y-3">
        <FieldHeader
          title="Reasoning trace retention"
          hint="How long a conversation keeps its Thinking panel (the assistant's reasoning and tool calls). After the window, a nightly sweep removes the trace; the messages themselves stay."
        />
        <Select
          value={retention}
          onValueChange={(value) => setRetention(value ?? "forever")}
        >
          <SelectTrigger className="h-11 w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-content/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        {dirty && <span className="text-muted-foreground text-sm">Unsaved changes</span>}
        <Button onClick={handleSave} disabled={isPending || !dirty} className="px-6 font-semibold">
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
