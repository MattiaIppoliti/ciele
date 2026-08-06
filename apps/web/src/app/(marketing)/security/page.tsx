import type { Metadata } from "next";
import { SecurityContent } from "@/components/marketing/security-content";

export const metadata: Metadata = {
  title: "Security | Ciele",
  description:
    "How Ciele keeps your data safe: tenant isolation, role-based access, encryption, grounded answers, and our SOC 2 and GDPR compliance programs.",
};

export default function SecurityPage() {
  return <SecurityContent />;
}
