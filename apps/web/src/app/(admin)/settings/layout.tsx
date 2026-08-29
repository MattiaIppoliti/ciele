import { SettingsDialog } from "@/components/settings/settings-dialog";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

/**
 * Every `/settings/*` route renders inside the Settings modal. The tabs the rail
 * offers are role-gated here; each page still enforces its own access (a direct
 * URL must not be readable just because the rail hid the link).
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role } = await requirePageMember();

  return (
    <SettingsDialog canManageOrg={canManageMembers(role)}>
      {children}
    </SettingsDialog>
  );
}
