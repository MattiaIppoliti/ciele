import type { ReactNode } from "react";
import styles from "./analytics-card.module.css";

/** Charts and values share an inset surface; their caption and controls sit below. */
export function AnalyticsCard({ title, description, action, children, className = "", contentClassName = "", bare = false }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  bare?: boolean;
}) {
  return (
    <section className={`analytics-card ${styles.card} ${bare ? styles.bare : ""} ${className}`}>
      <div className={`${styles.content} ${contentClassName}`}>{children}</div>
      <footer className={styles.caption}>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </footer>
    </section>
  );
}
