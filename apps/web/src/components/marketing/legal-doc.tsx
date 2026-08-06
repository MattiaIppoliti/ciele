import type { ReactNode } from "react";
import { MarketingHero } from "@/components/marketing/marketing-hero";

/** One block of body content inside a legal section. */
export type LegalBlock =
  | { type: "p"; text: ReactNode }
  | { type: "h3"; text: string }
  | { type: "ul"; items: ReactNode[] }
  /* Disclosure tables — what the Cookie Notice needs to list cookie names,
     providers and retention side by side. */
  | { type: "table"; caption?: string; headers: string[]; rows: ReactNode[][] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "h3") {
    return (
      <h3 className="text-foreground mt-8 text-base font-semibold">{block.text}</h3>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="mt-4 space-y-2.5">
        {block.items.map((item, index) => (
          <li key={index} className="flex gap-3 text-sm leading-relaxed">
            <span
              aria-hidden="true"
              className="bg-primary/60 mt-2 size-1.5 shrink-0 rounded-full"
            />
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "table") {
    return (
      <figure className="mt-6">
        {/* The table scrolls inside its own box: five columns will not fit a
            phone, and the page body must never scroll sideways. */}
        <div className="border-border/60 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            {block.caption ? (
              <caption className="text-muted-foreground border-border/60 border-b px-4 py-3 text-left text-xs">
                {block.caption}
              </caption>
            ) : null}
            <thead>
              <tr className="border-border/60 border-b">
                {block.headers.map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="text-muted-foreground px-4 py-3 font-mono text-xs font-medium uppercase tracking-wider"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-border/60 border-b last:border-b-0"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={
                        cellIndex === 0
                          ? "text-foreground px-4 py-3 align-top font-mono text-xs leading-relaxed"
                          : "text-muted-foreground px-4 py-3 align-top text-sm leading-relaxed"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    );
  }
  return (
    <p className="text-muted-foreground mt-4 text-sm leading-relaxed">{block.text}</p>
  );
}

/**
 * Long-form policy layout: a themed hero, a sticky table of contents on the
 * left at desktop, and a single readable prose column. Rendered inside the
 * marketing HomeShell, so it inherits the sky background.
 */
export function LegalDoc({
  eyebrow,
  title,
  lastUpdated,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  lastUpdated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        {/* Hero */}
        <MarketingHero eyebrow={eyebrow} title={title}>
          <p className="text-muted-foreground mt-4 text-sm">
            Last updated {lastUpdated}
          </p>
          <div className="text-muted-foreground mt-8 text-base leading-relaxed">
            {intro}
          </div>
        </MarketingHero>

        <div className="mt-16 flex flex-col gap-12 lg:flex-row lg:gap-16">
          {/* Table of contents */}
          <nav
            aria-label="On this page"
            className="lg:sticky lg:top-28 lg:h-fit lg:w-64 lg:shrink-0"
          >
            <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
              On this page
            </p>
            <ol className="mt-4 space-y-2.5 text-sm">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-muted-foreground hover:text-foreground flex gap-2 transition-colors"
                  >
                    <span className="text-muted-foreground/60 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Body */}
          <div className="min-w-0 max-w-3xl flex-1">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-28 border-border/60 border-t py-10 first:border-t-0 first:pt-0"
              >
                <h2 className="text-foreground flex items-baseline gap-3 text-xl font-semibold tracking-tight">
                  <span className="text-muted-foreground/60 font-mono text-sm">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </h2>
                {section.blocks.map((block, blockIndex) => (
                  <Block key={blockIndex} block={block} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
