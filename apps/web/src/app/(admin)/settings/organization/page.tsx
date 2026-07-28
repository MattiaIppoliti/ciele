import { redirect } from "next/navigation";

/** Renamed to "General" when settings became one dialog — keep old links alive. */
export default function OrganizationSettingsPage() {
  redirect("/settings/general");
}
