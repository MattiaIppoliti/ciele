import type { Metadata } from "next";
import { EnterpriseContent } from "@/components/marketing/enterprise-content";

export const metadata: Metadata = {
  title: "Enterprise | Ciele",
  description:
    "Govern every assistant from one control plane: single sign-on, roles enforced in the database, organization-owned model access, and an admin dashboard over every conversation.",
};

export default function EnterprisePage() {
  return <EnterpriseContent />;
}
