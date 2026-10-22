"use client";

import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/route-skeleton";
import { ProjectViewSkeleton, projectViewFromPath } from "@/components/work/work-skeletons";

/**
 * The Projects index is a grid of cards, but this boundary is also what paints
 * first on the way into a Project from elsewhere, so a Project URL draws the
 * view it is heading to instead.
 */
export default function ProjectsLoading() {
  const pathname = usePathname() ?? "";
  if (pathname.split("/")[2]) return <ProjectViewSkeleton view={projectViewFromPath(pathname)} />;
  return <RouteSkeleton variant="grid" />;
}
