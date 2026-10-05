import type { ReactNode } from "react";
import { cn } from "@agent-hub/ui";
import styles from "./catalog-surface.module.css";

/** Consistent specimen framing across controls, chat compositions and analytics. */
export function CatalogExample({ title, description, children, wide = true }: {
  title: string; description?: string; children: ReactNode; wide?: boolean;
}) {
  return <section className={cn(styles.example, "min-w-0 w-full", !wide && "max-w-xl")}>
    <div className="border-b px-4 py-3 sm:px-5"><h2 className="text-sm font-medium tracking-tight">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>
    <div className="min-w-0 space-y-3 p-4 sm:p-5">{children}</div>
  </section>;
}
