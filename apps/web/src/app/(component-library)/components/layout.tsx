import type { ReactNode } from "react";
import { CatalogShell } from "@/components/component-catalog/catalog-shell";

export default function ComponentLibraryLayout({ children }: { children: ReactNode }) {
  return <CatalogShell>{children}</CatalogShell>;
}
