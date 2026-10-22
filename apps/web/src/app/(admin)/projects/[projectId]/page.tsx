import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PROJECT_VIEW_COOKIE, defaultProjectView } from "@/lib/work/project-view-preference";

/** A Project opens on the view its Member last used, the List at first (#1050); each view is its own route. */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const [{ projectId }, jar] = await Promise.all([params, cookies()]);
  redirect(`/projects/${encodeURIComponent(projectId)}/${defaultProjectView(jar.get(PROJECT_VIEW_COOKIE)?.value)}`);
}
