"use client";

import { usePathname } from "next/navigation";
import { ProjectViewSkeleton, projectViewFromPath } from "@/components/work/work-skeletons";

/** Board, Calendar, Timeline and Files each have a shape of their own; the rest are rows. */
export default function ProjectViewLoading() {
  return <ProjectViewSkeleton view={projectViewFromPath(usePathname())} />;
}
