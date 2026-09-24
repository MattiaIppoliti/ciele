import { marketingMetadata } from "@/lib/marketing/seo";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata = marketingMetadata({
  title: "Change Log | Ciele",
  description: "See what’s new in Ciele, release by release.",
  path: "/change-log",
});

const SECTIONS: LegalSection[] = [
  {
    id: "1-0-6",
    title: "1.0.6",
    navLabel: "September 23, 2026",
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
    navLabel: "September 2, 2026",
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
    navLabel: "September 1, 2026",
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
    navLabel: "August 29, 2026",
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

export default function ChangeLogPage() {
  return (
    <LegalDoc
      eyebrow="Product updates"
      title="Change Log"
      lastUpdated="September 23, 2026"
      intro="A clear record of what’s new in Ciele. Follow product updates across Knowledge, Assistants, Flows, and the tools around them."
      sections={SECTIONS}
      showCallout={false}
    />
  );
}
