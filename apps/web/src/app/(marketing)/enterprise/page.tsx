import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { EnterpriseContent } from "@/components/marketing/enterprise-content";

export const metadata: Metadata = {
  title: "Enterprise | Ciele",
  description:
    "Govern every assistant from one control plane: single sign-on, roles enforced in the database, organization-owned model access, and an admin dashboard over every conversation.",
};

export default async function EnterprisePage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <EnterpriseContent />
      <HomeFooter />
    </HomeShell>
  );
}
