import { PageCrumb } from "@/components/shell/top-bar-slots";

/** Knowledge drill-down names the current page in the shell's single breadcrumb. */
export function KnowledgeBreadcrumb({
  crumbs,
}: {
  crumbs: Array<{ label: string; href?: string }>;
}) {
  const current = crumbs.at(-1);
  return current ? <PageCrumb label={current.label} /> : null;
}
