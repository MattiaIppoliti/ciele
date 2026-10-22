"use client";

import { usePathname } from "next/navigation";
import { ProjectViewSkeleton, projectViewFromPath } from "@/components/work/work-skeletons";

/** Wraps every view of the Project, so it draws the one the URL is heading to. */
export default function ProjectLoading() {
  return <ProjectViewSkeleton view={projectViewFromPath(usePathname())} />;
}
