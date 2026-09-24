import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FEATURES, findFeature } from "@/components/marketing/feature-catalog";
import { FeatureContent } from "@/components/marketing/feature-content";
import { marketingMetadata } from "@/lib/marketing/seo";

export function generateStaticParams() {
  return FEATURES.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const feature = findFeature((await params).slug);
  if (!feature) return {};
  return marketingMetadata({
    title: `${feature.label} | Ciele`,
    description: feature.meta,
    path: `/features/${feature.slug}`,
  });
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const feature = findFeature((await params).slug);
  if (!feature) notFound();

  return <FeatureContent feature={feature} />;
}
