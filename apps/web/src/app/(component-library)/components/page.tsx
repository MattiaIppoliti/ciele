import { CatalogOverview } from "@/components/component-catalog/catalog-overview";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata = marketingMetadata({ title: "Components · Ciele", description: "One component per page: explore its states, variants, usage examples, and the source code used by Ciele.", path: "/components" });

export default function ComponentsPage() {
  return <CatalogOverview />;
}
