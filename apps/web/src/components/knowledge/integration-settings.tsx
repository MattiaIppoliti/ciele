import type { ReactNode } from "react";

/** The supplied Integration Settings tray, with each provider's real fields and actions. */
export function IntegrationSettings({
  logo,
  title,
  description,
  children,
  footer,
}: {
  logo: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section data-slot="integration-settings" className="overview-panels rounded-3xl bg-[var(--overview-frame)]">
      <header className="flex items-center gap-3 p-5 pr-12">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--overview-border)] bg-[var(--overview-icon)]">
          {logo}
        </span>
        <div className="min-w-0 space-y-1">
          {title}
          {description}
        </div>
      </header>
      <div data-slot="integration-settings-sheet" className="divide-y divide-[var(--overview-inset-border)] rounded-3xl border border-[var(--overview-inset-border)] bg-[var(--overview-inset)]">
        {children}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 p-4">
        {footer}
      </footer>
    </section>
  );
}
