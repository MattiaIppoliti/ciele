"use client";

import { Link } from "@/components/ui/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Button } from "@agent-hub/ui";
import { Input } from "@/components/motion/input";
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
      <Input
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="my@email.com"
        // The action reports one error for the pair — shake both fields, print
        // the message once, under the password.
        error={Boolean(state.error)}
        classNames={{ field: "bg-white" }}
        required
      />
      <Input
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={state.error ?? undefined}
        classNames={{ field: "bg-white" }}
        required
      />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Logging in..." : "Log in"}
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
      <p className="text-muted-foreground text-center text-xs">
        By signing in, you agree to our{" "}
        <Link href="/policies/terms-of-service" className="underline hover:no-underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/policies/privacy" className="underline hover:no-underline">
          Privacy Policy
        </Link>
        .
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
