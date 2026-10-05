import { notFound, permanentRedirect } from "next/navigation";
import { COMPONENT_FAMILIES, componentFamily, catalogPath } from "@/components/component-catalog/catalog";
import { CatalogDetail } from "@/components/component-catalog/catalog-detail";
import { marketingMetadata } from "@/lib/marketing/seo";

export const dynamicParams = false;
export function generateStaticParams() {
  return COMPONENT_FAMILIES.filter((family) => family.kind === "component").map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const family = componentFamily((await params).slug);
  if (!family) notFound();
  return marketingMetadata({ title: `${family.title} · Ciele ${family.kind === "block" ? "Blocks" : "Components"}`, description: family.description, path: catalogPath(family) });
}

export default async function ComponentPage({ params }: { params: Promise<{ slug: string }> }) {
  const family = componentFamily((await params).slug);
  if (!family) notFound();
  if (family.kind === "block") permanentRedirect(catalogPath(family));
  return <CatalogDetail key={family.slug} slug={family.slug} />;
}
