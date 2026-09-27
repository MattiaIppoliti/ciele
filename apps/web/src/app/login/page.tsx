import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@agent-hub/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  // Demo mode has no auth: go straight in.
  if (!isSupabaseConfigured()) redirect("/");

  return (
    <AuthShell
      title="Log in to Ciele"
      subtitle="Enter your email below to login to your account"
    >
      <LoginForm />
    </AuthShell>
  );
}
