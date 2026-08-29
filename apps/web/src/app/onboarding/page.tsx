import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { getSession } from "@/lib/auth";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organization) redirect("/");

  return (
    <AuthShell
      title="Create your organization"
      subtitle="Your team's workspace for assistants. You'll be the owner."
    >
      <OnboardingForm />
    </AuthShell>
  );
}
