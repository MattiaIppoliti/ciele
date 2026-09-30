"use client";

import { useState, useTransition } from "react";
import type { Organization } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import {
  updateOrganizationAction,
  uploadOrganizationLogoAction,
} from "@/app/actions";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { FieldHeader } from "@/components/settings/field-header";
import { SettingsSaveBar } from "@/components/settings/form-actions";
import { useSettingsDirty } from "@/components/settings/settings-dirty";
import { RollInText } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
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
 * Retention choices, shared by both windows. "forever" maps to null (the
 * default) in each: nothing an organization already has starts disappearing
 * unless an admin opts in (#573 traces, #801/CYB-12 transcripts).
 */
const RETENTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "forever", label: "Keep forever (default)" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];

/** Days as a number, or null for "forever". */
function retentionDays(value: string): number | null {
  return value === "forever" ? null : Number.parseInt(value, 10);
}

/** A window that got shorter deletes whatever now falls outside it. */
function shortened(next: string, stored: string): number | null {
  const nextDays = retentionDays(next);
  const storedDays = retentionDays(stored);
  if (nextDays === null) return null;
  return storedDays === null || nextDays < storedDays ? nextDays : null;
}

export function OrganizationClient({
  organization,
  demo,
}: {
  organization: Organization;
  demo: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  // Its own transition: an upload in flight must not read as a pending save.
  const [uploading, startUpload] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [name, setName] = useState(organization.name);
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? "");
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const storedRetention = organization.traceRetentionDays
    ? String(organization.traceRetentionDays)
    : "forever";
  const [retention, setRetention] = useState(storedRetention);
  const storedTranscriptRetention = organization.transcriptRetentionDays
    ? String(organization.transcriptRetentionDays)
    : "forever";
  const [transcriptRetention, setTranscriptRetention] = useState(
    storedTranscriptRetention
  );

  const dirty =
    name !== organization.name ||
    retention !== storedRetention ||
    transcriptRetention !== storedTranscriptRetention;
  useSettingsDirty(dirty);

  function handleSave() {
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    const save = () =>
      startTransition(async () => {
        try {
          await updateOrganizationAction({
            name: name.trim(),
            traceRetentionDays: retentionDays(retention),
            transcriptRetentionDays: retentionDays(transcriptRetention),
          });
          toast.success("Organization saved");
        } catch {
          toast.error("Could not save the organization");
        }
      });

    // Shortening a window is the one change here that cannot be undone: the
    // nightly retention sweep deletes what falls outside it.
    const traceDays = shortened(retention, storedRetention);
    const transcriptDays = shortened(
      transcriptRetention,
      storedTranscriptRetention,
    );
    if (traceDays === null && transcriptDays === null) {
      save();
      return;
    }
    const losses = [
      transcriptDays !== null &&
        `conversations older than ${transcriptDays} days`,
      traceDays !== null && `reasoning traces older than ${traceDays} days`,
    ].filter(Boolean);
    confirmDelete({
      title: "Delete older data?",
      description: `The next nightly cleanup permanently deletes ${losses.join(
        " and ",
      )}.${
        transcriptDays !== null
          ? " Conversations under a legal hold are kept."
          : ""
      }`,
      confirmLabel: "Save and delete",
      onConfirm: save,
    });
  }

  function uploadLogo(file: File) {
    startUpload(async () => {
      const previewUrl = URL.createObjectURL(file);
      setLogoPreviewUrl(previewUrl);
      try {
        const form = new FormData();
        form.set("file", file);
        const result = await uploadOrganizationLogoAction(form);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.logoUrl) {
          setLogoUrl(result.logoUrl);
          toast.success("Logo uploaded");
        }
      } catch {
        toast.error("Could not upload logo");
      } finally {
        URL.revokeObjectURL(previewUrl);
        setLogoPreviewUrl("");
      }
    });
  }

  function removeLogo() {
    confirmDelete({
      title: "Remove the logo?",
      description:
        "The organization's initial shows in its place. You can upload a new logo at any time.",
      confirmLabel: "Remove logo",
      onConfirm: async () => {
        const previous = logoUrl;
        setLogoUrl("");
        try {
          await updateOrganizationAction({ logoUrl: null });
        } catch {
          setLogoUrl(previous);
          throw new Error("Could not remove logo");
        }
        toast.success("Logo removed");
      },
    });
  }

  return (
    <div className="space-y-6 pt-8 pb-24">
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode, changes only last for this session
        </Badge>
      )}

      <SectionTimeline>
        <TimelineSection title="Profile" boxed>
          <div className="space-y-8">
      <div className="space-y-3">
        <FieldHeader
          title="Logo"
          hint="Circular icon shown in the organization switcher and account menu."
        />
        <AvatarUpload
          value={logoPreviewUrl || logoUrl}
          onFile={uploadLogo}
          onRemove={removeLogo}
          busy={uploading}
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
          aria-label="Organization name"
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 max-w-sm"
        />
      </div>

          </div>
        </TimelineSection>
        <TimelineSection title="Data retention" boxed>
          <div className="space-y-8">
      <div className="space-y-3">
        <FieldHeader
          title="Reasoning trace retention"
          hint="How long the Thinking panel is kept. Messages stay after it is removed."
        />
        <Select
          value={retention}
          onValueChange={(value) => setRetention(value ?? "forever")}
        >
          <SelectTrigger className="h-11 w-full max-w-sm" aria-label="Reasoning trace retention">
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

      <div className="space-y-3">
        <FieldHeader
          title="Conversation retention"
          hint="How long conversations are kept before deletion. Legal holds are skipped."
        />
        <Select
          value={transcriptRetention}
          onValueChange={(value) => setTranscriptRetention(value ?? "forever")}
        >
          <SelectTrigger className="h-11 w-full max-w-sm" aria-label="Conversation retention">
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

          </div>
        </TimelineSection>
      </SectionTimeline>

      <SettingsSaveBar>
        <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
          {dirty && <RollInText text="Unsaved changes" />}
        </span>
        <Button onClick={handleSave} disabled={isPending || !dirty} className="px-6 font-semibold">
          <RollInText text={isPending ? "Saving…" : "Save changes"} />
        </Button>
      </SettingsSaveBar>
      {confirmDeleteModal}
    </div>
  );
}
