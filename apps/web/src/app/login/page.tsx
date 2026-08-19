import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@agent-hub/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

// Temp: set true to preview /login in local demo mode (no Supabase). Leave
// false so demo users skip straight past auth into the app.
const VIEW_LOGIN_IN_DEMO = false;

export default function LoginPage() {
  // Demo mode has no auth: go straight in.
  if (!VIEW_LOGIN_IN_DEMO && !isSupabaseConfigured()) redirect("/");

  return (
    <AuthShell
      title="Log in to Ciele"
      subtitle="Enter your email below to login to your account"
    >
      <LoginForm />
    </AuthShell>
  );
}
