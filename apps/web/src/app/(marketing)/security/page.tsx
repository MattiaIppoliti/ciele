import { marketingMetadata } from "@/lib/marketing/seo";
import { SecurityContent } from "@/components/marketing/security-content";

export const metadata = marketingMetadata({
  title: "Security | Ciele",
  description: "How Ciele keeps your data safe: tenant isolation, role-based access, encryption, grounded answers, and our SOC 2 and GDPR compliance programs.",
  path: "/security",
});

export default function SecurityPage() {
  return <SecurityContent />;
}
