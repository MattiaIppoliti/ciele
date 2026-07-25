"use client";

import { Link } from "@/components/ui/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { signInWithPasswordAction } from "@/app/auth/actions";
import { EMPTY_AUTH_FORM_STATE } from "@/app/auth/form-state";

function LoginFormInner() {
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(
    signInWithPasswordAction,
    EMPTY_AUTH_FORM_STATE
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="my@email.com"
          className="bg-white"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="bg-white"
          required
        />
      </div>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        No account?{" "}
        <Link
          href="/contact/sales"
          className="text-primary font-medium hover:underline"
        >
          Contact sales
        </Link>
      </p>
    </form>
  );
}

export function LoginForm() {
  return (
    <Suspense>
      <LoginFormInner />
    </Suspense>
  );
}
