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
  // The personal tabs read the session from here instead of asking again.
  const session = requirePageMember().then(
    ({ session, role }) => {
      const canManageOrg = canManageMembers(role);
      return {
        email: session.email,
        profile: session.profile,
        // Retention is admin configuration; everyone else gets the public half.
        organization: canManageOrg
          ? session.organization
          : {
              ...session.organization,
              traceRetentionDays: null,
              transcriptRetentionDays: null,
            },
        canManageOrg,
        demo: session.demo,
      };
    },
    () => null,
  );

  return (
    <SettingsDialog session={session}>
      {children}
    </SettingsDialog>
  );
}
