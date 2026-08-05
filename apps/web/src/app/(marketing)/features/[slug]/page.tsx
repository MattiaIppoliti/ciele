import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { FEATURES, findFeature } from "@/components/marketing/feature-catalog";
import { FeatureContent } from "@/components/marketing/feature-content";

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
  return {
    title: `${feature.label} | Ciele`,
    description: feature.meta,
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const feature = findFeature((await params).slug);
  if (!feature) notFound();

  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <FeatureContent feature={feature} />
      <HomeFooter />
    </HomeShell>
  );
}
