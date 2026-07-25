import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { SecurityContent } from "@/components/marketing/security-content";

export const metadata: Metadata = {
  title: "Security — Ciele",
  description:
    "How Ciele keeps your data safe: tenant isolation, role-based access, encryption, grounded answers, and our SOC 2 and GDPR compliance programs.",
};

export default async function SecurityPage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <SecurityContent />
      <HomeFooter />
    </HomeShell>
  );
}
