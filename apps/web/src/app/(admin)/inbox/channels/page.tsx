import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Keep old Inbox group links pointing to the conversation inbox. */
export default function LegacyInboxGroupsPage() {
  redirect("/inbox");
}
