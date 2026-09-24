import { marketingMetadata } from "@/lib/marketing/seo";
import { EnterpriseContent } from "@/components/marketing/enterprise-content";

export const metadata = marketingMetadata({
  title: "Enterprise | Ciele",
  description: "Govern every assistant from one control plane: single sign-on, roles enforced in the database, organization-owned model access, and an admin dashboard over every conversation.",
  path: "/enterprise",
});

export default function EnterprisePage() {
  return <EnterpriseContent />;
}
