import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

/**
 * Hero header for an assistant SETUP page: a rounded icon tile (the same icon
 * the sidebar uses for the section) next to the page title and subtitle.
 * Server-safe, no client hooks.
 */
export function SectionHero({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <SectionHeading icon={Icon} title={title} description={description} />
  );
}
