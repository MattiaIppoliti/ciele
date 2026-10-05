import { notFound } from "next/navigation";
import { COMPONENT_FAMILIES, componentFamily, catalogPath } from "@/components/component-catalog/catalog";
import { CatalogDetail } from "@/components/component-catalog/catalog-detail";
import { marketingMetadata } from "@/lib/marketing/seo";

export const dynamicParams = false;
export function generateStaticParams() {
  return COMPONENT_FAMILIES.filter((family) => family.kind === "block").map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const family = componentFamily((await params).slug);
  if (!family || family.kind !== "block") notFound();
  return marketingMetadata({ title: `${family.title} · Ciele Blocks`, description: family.description, path: catalogPath(family) });
}

export default async function BlockPage({ params }: { params: Promise<{ slug: string }> }) {
  const family = componentFamily((await params).slug);
  if (!family || family.kind !== "block") notFound();
  return <CatalogDetail key={family.slug} slug={family.slug} />;
}
