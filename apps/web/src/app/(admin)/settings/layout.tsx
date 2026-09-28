import { SettingsDialog } from "@/components/settings/settings-dialog";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

/**
 * Every `/settings/*` route renders inside the Settings modal. The tabs the rail
 * offers are role-gated here; each page still enforces its own access (a direct
 * URL must not be readable just because the rail hid the link).
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not awaited: the dialog and each tab's loading.tsx open at once, and only
  // the rail's cross-scope link waits for the role. A redirecting read (no
  // session) surfaces through the page itself, so the rail just hides it.
  const canManageOrg = requirePageMember().then(
    ({ role }) => canManageMembers(role),
    () => false,
  );

  return (
    <SettingsDialog canManageOrg={canManageOrg}>
      {children}
    </SettingsDialog>
  );
}
