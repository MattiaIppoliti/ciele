import { ImprovementDetailSkeleton } from "@/components/improvements/improvement-detail-skeleton";

export default function ImprovementLoading() {
  return (
    <div className="h-full" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading improvement…</span>
      <ImprovementDetailSkeleton variant="page" />
    </div>
  );
}
