"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [firstName, setFirstName] = useState(profile?.firstName ?? "");
  const [lastName, setLastName] = useState(profile?.lastName ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");

  const dirty =
    firstName !== (profile?.firstName ?? "") ||
    lastName !== (profile?.lastName ?? "") ||
    username !== (profile?.username ?? "");

  function handleSave() {
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    startTransition(async () => {
      await updateProfileAction({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
      });
      toast.success("Profile saved");
      router.refresh();
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
      router.refresh();
    }
  }

  function removeAvatar() {
    setAvatarUrl("");
    startTransition(async () => {
      await updateProfileAction({ avatarUrl: null });
      toast.success("Photo removed");
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
          fallback={<UserAvatar avatarUrl={null} size="size-full" />}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <FieldHeader title="First name" hint="Optional." />
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-3">
          <FieldHeader title="Last name" hint="Optional." />
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="h-11"
          />
        </div>
      </div>

      <div className="space-y-3">
        <FieldHeader
          title="Username"
          hint="Starts as the part of your email before the @ — change it to whatever you like."
        />
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="h-11 max-w-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Email</p>
        <p className="text-muted-foreground text-sm">{email}</p>
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
