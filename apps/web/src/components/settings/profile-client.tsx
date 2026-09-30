"use client";

import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useState, useTransition } from "react";
import type { Profile } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { updateProfileAction, uploadProfileAvatarAction } from "@/app/actions";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { FieldHeader } from "@/components/settings/field-header";
import { SettingsSaveBar } from "@/components/settings/form-actions";
import { useSettingsDirty } from "@/components/settings/settings-dirty";
import { RollInText } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";

export function ProfileClient({
  email,
  profile,
  demo,
}: {
  email: string;
  profile: Profile | null;
  demo: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  // Its own transition: an upload in flight must not read as a pending save.
  const [uploading, startUpload] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const initialProfile = {
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    username: profile?.username ?? "",
  };
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [form, setForm] = useState(initialProfile);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const dirty =
    form.firstName !== savedProfile.firstName ||
    form.lastName !== savedProfile.lastName ||
    form.username !== savedProfile.username;
  useSettingsDirty(dirty);

  function edit(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((current) => ({ ...current, [key]: value }));
      setSaveStatus("idle");
    };
  }

  function handleSave() {
    if (!form.username.trim()) {
      toast.error("Username is required");
      return;
    }
    const nextProfile = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      username: form.username.trim(),
    };
    const previousProfile = form;
    setForm(nextProfile);
    setSaveStatus("saving");
    startTransition(async () => {
      try {
        const saved = await updateProfileAction(nextProfile);
        const savedFields = {
          firstName: saved.firstName,
          lastName: saved.lastName,
          username: saved.username,
        };
        setForm(savedFields);
        setSavedProfile(savedFields);
        setSaveStatus("saved");
        toast.success("Profile saved");
      } catch {
        setForm(previousProfile);
        setSaveStatus("idle");
        toast.error("Could not save profile");
      }
    });
  }

  function uploadAvatar(file: File) {
    startUpload(async () => {
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreviewUrl(previewUrl);
      try {
        const form = new FormData();
        form.set("file", file);
        const result = await uploadProfileAvatarAction(form);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.avatarUrl) {
          setAvatarUrl(result.avatarUrl);
          toast.success("Photo uploaded");
        }
      } catch {
        toast.error("Could not upload photo");
      } finally {
        URL.revokeObjectURL(previewUrl);
        setAvatarPreviewUrl("");
      }
    });
  }

  function removeAvatar() {
    confirmDelete({
      title: "Remove your photo?",
      description:
        "Your initials show in its place. You can upload a new photo at any time.",
      confirmLabel: "Remove photo",
      onConfirm: async () => {
        const previous = avatarUrl;
        setAvatarUrl("");
        try {
          await updateProfileAction({ avatarUrl: null });
        } catch {
          setAvatarUrl(previous);
          throw new Error("Could not remove photo");
        }
        toast.success("Photo removed");
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
        <TimelineSection title="Photo" boxed>
      <div className="space-y-3">
        <FieldHeader
          title="Photo"
          hint="Shown next to your name in the sidebar and the members list."
        />
        <AvatarUpload
          value={avatarPreviewUrl || avatarUrl}
          onFile={uploadAvatar}
          onRemove={removeAvatar}
          busy={uploading}
          fallback={
            <UserAvatar
              avatarUrl={null}
              userId={profile?.userId}
              email={email}
              size="size-full"
            />
          }
        />
      </div>

        </TimelineSection>
        <TimelineSection title="Details" boxed>
          <div className="space-y-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <FieldHeader title="First name" hint="Optional." />
          <Input
            value={form.firstName}
            data-testid="profile-first-name"
            aria-label="First name"
            autoComplete="given-name"
            onChange={edit("firstName")}
            className="h-11"
          />
        </div>
        <div className="space-y-3">
          <FieldHeader title="Last name" hint="Optional." />
          <Input
            value={form.lastName}
            data-testid="profile-last-name"
            aria-label="Last name"
            autoComplete="family-name"
            onChange={edit("lastName")}
            className="h-11"
          />
        </div>
      </div>

      <div className="space-y-3">
        <FieldHeader
          title="Username"
          hint="Starts as the part of your email before the @, change it to whatever you like."
        />
        <Input
          value={form.username}
          data-testid="profile-username"
          aria-label="Username"
          autoComplete="username"
          spellCheck={false}
          onChange={edit("username")}
          className="h-11 max-w-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Email</p>
        <p className="text-muted-foreground text-sm break-all">{email}</p>
      </div>

          </div>
        </TimelineSection>
      </SectionTimeline>

      <SettingsSaveBar>
        <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
          {dirty ? (
            <RollInText text="Unsaved changes" />
          ) : saveStatus === "saved" ? (
            <span data-testid="profile-saved">
              <RollInText text="Saved" />
            </span>
          ) : null}
        </span>
        {/* Only the button shows the pending save; the fields stay editable,
            a save that locks the form is the opposite of optimistic. */}
        <Button
          onClick={handleSave}
          disabled={isPending || !dirty}
          data-testid="profile-save"
          className="px-6 font-semibold"
        >
          <RollInText text={isPending ? "Saving…" : "Save changes"} />
        </Button>
      </SettingsSaveBar>
      {confirmDeleteModal}
    </div>
  );
}
