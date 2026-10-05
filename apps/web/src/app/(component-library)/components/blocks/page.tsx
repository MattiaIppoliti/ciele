import { CatalogOverview } from "@/components/component-catalog/catalog-overview";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata = marketingMetadata({ title: "Blocks · Ciele", description: "Complete Ciele features with interactive previews: tables, conversations, editors, and settings built from the shared components.", path: "/components/blocks" });

export default function BlocksPage() {
  return <CatalogOverview kind="block" />;
}
