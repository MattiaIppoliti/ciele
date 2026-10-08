import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * One Settings tab's heading, at the dialog's scale.
 *
 * The heading is the same icon tile the Assistant editor's pages open with
 * (`SectionHeading`), and a tab's sections sit on `SectionTimeline` the way
 * the editor's do, so the two surfaces read as one product.
 *
 * Deliberately its own server component rather than a second export from
 * `settings-dialog.tsx`: that module is a client component, so importing the
 * wrapper from there would pull every settings page into the client boundary.
 */
export function SettingsPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="@container/settings mx-auto min-w-0 max-w-3xl pr-6">
      <SectionHeading icon={icon} title={title} description={description} />
      {children}
    </div>
  );
}
