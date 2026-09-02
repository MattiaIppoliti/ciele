"use client";

import { useState, useTransition } from "react";
import type { Profile } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { updateProfileAction, uploadProfileAvatarAction } from "@/app/actions";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { UserAvatar } from "@/components/ui/user-avatar";
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
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const initialProfile = {
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    username: profile?.username ?? "",
  };
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [firstName, setFirstName] = useState(initialProfile.firstName);
  const [lastName, setLastName] = useState(initialProfile.lastName);
  const [username, setUsername] = useState(initialProfile.username);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const dirty =
    firstName !== savedProfile.firstName ||
    lastName !== savedProfile.lastName ||
    username !== savedProfile.username;

  function handleSave() {
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    const nextProfile = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      username: username.trim(),
    };
    const previousProfile = { firstName, lastName, username };
    setFirstName(nextProfile.firstName);
    setLastName(nextProfile.lastName);
    setUsername(nextProfile.username);
    setSaveStatus("saving");
    startTransition(async () => {
      try {
        const saved = await updateProfileAction(nextProfile);
        setFirstName(saved.firstName);
        setLastName(saved.lastName);
        setUsername(saved.username);
        setSavedProfile({
          firstName: saved.firstName,
          lastName: saved.lastName,
          username: saved.username,
        });
        setSaveStatus("saved");
        toast.success("Profile saved");
      } catch {
        setFirstName(previousProfile.firstName);
        setLastName(previousProfile.lastName);
        setUsername(previousProfile.username);
        setSaveStatus("idle");
        toast.error("Could not save profile");
      }
    });
  }

  async function uploadAvatar(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl(previewUrl);
    const form = new FormData();
    form.set("file", file);
    const result = await uploadProfileAvatarAction(form);
    URL.revokeObjectURL(previewUrl);
    setAvatarPreviewUrl("");
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.avatarUrl) {
      setAvatarUrl(result.avatarUrl);
      toast.success("Photo uploaded");
    }
  }

  function removeAvatar() {
    setAvatarUrl("");
    startTransition(async () => {
      await updateProfileAction({ avatarUrl: null });
      toast.success("Photo removed");
    });
  }

  return (
    <div className="space-y-10 pt-8 pb-24">
      {demo && (
        <Badge variant="secondary" className="text-muted-foreground">
          Demo mode, changes only last for this session
        </Badge>
      )}

      <div className="space-y-3">
        <FieldHeader
          title="Photo"
          hint="Shown next to your name in the sidebar and the members list."
        />
        <AvatarUpload
          value={avatarPreviewUrl || avatarUrl}
          onFile={(file) =>
            startTransition(() => {
              void uploadAvatar(file);
            })
          }
          onRemove={removeAvatar}
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

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <FieldHeader title="First name" hint="Optional." />
          <Input
            value={firstName}
            data-testid="profile-first-name"
            onChange={(e) => {
              setFirstName(e.target.value);
              setSaveStatus("idle");
            }}
            className="h-11"
          />
        </div>
        <div className="space-y-3">
          <FieldHeader title="Last name" hint="Optional." />
          <Input
            value={lastName}
            data-testid="profile-last-name"
            onChange={(e) => {
              setLastName(e.target.value);
              setSaveStatus("idle");
            }}
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
          value={username}
          data-testid="profile-username"
          onChange={(e) => {
            setUsername(e.target.value);
            setSaveStatus("idle");
          }}
          className="h-11 max-w-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Email</p>
        <p className="text-muted-foreground text-sm">{email}</p>
      </div>

      <div className="bg-content/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        {dirty && <span className="text-muted-foreground text-sm">Unsaved changes</span>}
        {!dirty && saveStatus === "saved" && (
          <span
            className="text-muted-foreground text-sm"
            data-testid="profile-saved"
          >
            Saved
          </span>
        )}
        {/* Only the button shows the pending save; the fields stay editable,
            a save that locks the form is the opposite of optimistic. */}
        <Button
          onClick={handleSave}
          disabled={isPending || !dirty}
          data-testid="profile-save"
          className="px-6 font-semibold"
        >
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
