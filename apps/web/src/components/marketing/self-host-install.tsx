import type { ReactNode } from "react";
import { Button, cn } from "@agent-hub/ui";
import { CodeBlock, type CodeBlockTab } from "@/components/ui/code-block";
import { CTA_CLASS } from "./plan-cards";

/**
 * The self-host install block shared by /pricing and /download: the quick
 * start beside "What you provide" and the docs + source links. `children`
 * renders under the links.
 */
export function SelfHostInstall({
  tabs,
  requirements,
  docs,
  sourceUrl,
  className,
  children,
}: {
  tabs: CodeBlockTab[];
  requirements: { title: string; detail: string }[];
  docs: { href: string; label: string };
  sourceUrl: string;
  /** The top margin, which differs per page. */
  className: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        className,
        "grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start",
      )}
    >
      <CodeBlock tabs={tabs} />

      <div className="border-border/70 bg-card/60 rounded-xl border p-6 backdrop-blur-sm">
        <p className="text-foreground text-sm font-semibold">
          What you provide
        </p>
        <ul className="mt-4 space-y-4">
          {requirements.map((requirement) => (
            <li key={requirement.title}>
              <p className="text-foreground text-sm font-medium">
                {requirement.title}
              </p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {requirement.detail}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            className={cn("h-9 w-full", CTA_CLASS)}
            variant="outline"
            nativeButton={false}
            render={<a href={docs.href} target="_blank" rel="noreferrer" />}
          >
            <span>{docs.label}</span>
          </Button>
          <Button
            className={cn("h-9 w-full", CTA_CLASS)}
            variant="outline"
            nativeButton={false}
            render={<a href={sourceUrl} target="_blank" rel="noreferrer" />}
          >
            <span>View the source</span>
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
