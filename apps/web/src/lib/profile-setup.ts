import type { Profile } from "@agent-hub/core";

/** Only saved values count; a generated avatar is not an uploaded profile photo. */
export function profileSetup(profile: Profile | null, email: string, demo: boolean) {
  const steps = [
    { value: profile?.firstName, label: "Add your first name" },
    { value: profile?.lastName, label: "Add your last name" },
    { value: profile?.username, label: "Choose a username" },
    { value: profile?.avatarUrl, label: "Add a profile photo" },
  ];
  const done = steps.filter((step) => step.value?.trim()).length +
    (!demo && email.trim() ? 1 : 0);
  const total = steps.length + (demo ? 0 : 1);
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
    next: steps.find((step) => !step.value?.trim())?.label ?? null,
  };
}
