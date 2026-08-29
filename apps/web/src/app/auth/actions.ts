"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthFormState } from "./form-state";

function formValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/** Never redirect a session flow to a different origin or protocol. */
function internalPath(value: string, fallback: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export async function signInWithPasswordAction(
  _previous: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formValue(formData, "email"),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: error.message };
  redirect(internalPath(formValue(formData, "next"), "/"));
}
