import "./change-log.css";

import { marketingMetadata } from "@/lib/marketing/seo";
import { MarketingHero } from "@/components/marketing/marketing-hero";

type ReleaseBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] };

type Release = {
  id: string;
  title: string;
  date: string;
  dateTime: string;
  blocks: ReleaseBlock[];
};

export const metadata = marketingMetadata({
  title: "Change Log | Ciele",
  description: "See what’s new in Ciele, release by release.",
  path: "/change-log",
});

const RELEASES: Release[] = [
  {
    id: "1-0-6",
    title: "1.0.6",
    date: "September 23, 2026",
    dateTime: "2026-09-23",
    blocks: [
      { type: "p", text: "The latest release expands Knowledge, AI Teammates, and the tools teams use to run assistants." },
      { type: "h3", text: "Knowledge" },
      {
        type: "ul",
        items: [
          "Browse a source through its documents, summaries, and extracted content.",
          "Review and manage assistant memories from the Knowledge area.",
          "Add spreadsheet-shaped knowledge tables and inspect their records.",
        ],
      },
      { type: "h3", text: "Assistants and Flows" },
      {
        type: "ul",
        items: [
          "Configure AI Teammates with their own conversations, groups, and knowledge scope.",
          "Use tools, Skills, mentions, and file attachments in teammate conversations.",
          "Build Flows in a visual canvas, with an AI flow builder and HTTP triggers.",
          "Improve answer checks with pre-flight routing, verification, and clearer Insights.",
        ],
      },
      { type: "h3", text: "Integrations and operations" },
      {
        type: "ul",
        items: [
          "Connect published Assistants to Slack with organization provider credentials.",
          "Track usage by spender and add credit packs.",
          "Configure organization-owned crawl credentials and follow same-site redirects.",
          "Use expanded API, CLI, and MCP coverage for Flows and Teammates.",
        ],
      },
    ],
  },
  {
    id: "1-0-2",
    title: "1.0.2",
    date: "September 2, 2026",
    dateTime: "2026-09-02",
    blocks: [
      {
        type: "ul",
        items: [
          "Added Teammates and the Library to the interactive product preview.",
          "Improved console responsiveness and completed a security hardening review.",
        ],
      },
    ],
  },
  {
    id: "1-0-1",
    title: "1.0.1",
    date: "September 1, 2026",
    dateTime: "2026-09-01",
    blocks: [
      {
        type: "ul",
        items: [
          "Fixed Library hydration so the page remains stable after navigation.",
          "Added recovery for browser tabs that have been open while the app updated.",
          "Refreshed product documentation and marketing pages to match the current product.",
        ],
      },
    ],
  },
  {
    id: "1-0-0",
    title: "1.0.0",
    date: "August 29, 2026",
    dateTime: "2026-08-29",
    blocks: [
      {
        type: "p",
        text: "Ciele 1.0 introduced the core assistant workspace. Teams can configure assistants, connect knowledge, route conversations with Flows, test changes in Preview, publish a chat widget, and review conversations and outcomes.",
      },
      {
        type: "p",
        text: "The first release also included Help Desks, organization settings, and the self-hosted edition.",
      },
    ],
  },
];

function ReleaseContent({ block }: { block: ReleaseBlock }) {
  if (block.type === "h3") {
    return (
      <h3 className="text-foreground pt-2 text-sm font-semibold">{block.text}</h3>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="text-muted-foreground list-disc space-y-2 pl-4 text-sm leading-relaxed marker:text-primary/60">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <p className="text-muted-foreground text-sm leading-relaxed">{block.text}</p>
  );
}

export default function ChangeLogPage() {
  return (
    <main className="relative px-4 pb-20 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-3xl">
        <MarketingHero eyebrow="Product updates" title="Change Log">
          <p className="text-muted-foreground mt-6 text-base leading-relaxed">
            A clear record of what’s new in Ciele. Follow product updates across
            Knowledge, Assistants, Flows, and the tools around them.
          </p>
        </MarketingHero>

        <ol aria-label="Release history" className="changelog">
          {RELEASES.map((release, index) => (
            <li key={release.id} id={release.id} className="changelog-item">
              <span aria-hidden="true" className="changelog-line" />
              <span
                aria-hidden="true"
                className={`changelog-indicator ${index === 0 ? "changelog-latest" : "changelog-past"}`}
              >
                <span className="changelog-check" />
              </span>

              <div className="changelog-heading">
                <h2 className="text-foreground text-sm font-semibold">
                  Ciele {release.title}
                </h2>
                <span className="changelog-badge">
                  {index === 0 ? "Latest release" : "Released"}
                </span>
                <time
                  dateTime={release.dateTime}
                  className="text-muted-foreground text-xs sm:ml-auto"
                >
                  {release.date}
                </time>
              </div>

              <details open className="changelog-card shadow-light">
                <summary className="changelog-summary press-text">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="changelog-avatar text-2xs">
                      C
                    </span>
                    <span className="text-muted-foreground text-xs font-medium">
                      Ciele team
                    </span>
                    <span className="sr-only">
                      — Release notes for Ciele {release.title}
                    </span>
                  </span>
                  <span aria-hidden="true" className="changelog-chevron" />
                </summary>
                <div className="changelog-content">
                  {release.blocks.map((block, blockIndex) => (
                    <ReleaseContent key={blockIndex} block={block} />
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
