import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "Subprocessors | Ciele",
  description:
    "The third-party providers that process data on Ciele's instructions, what each one does, and where it runs.",
};

const LAST_UPDATED = "5 August 2026";

const LINK_CLASS = "text-foreground font-medium underline underline-offset-4";

const TABLE_HEADERS = ["Provider", "Purpose", "Data", "Region"];

const SECTIONS: LegalSection[] = [
  {
    id: "infrastructure",
    title: "Infrastructure",
    blocks: [
      {
        type: "p",
        text: "These providers run the platform itself. Every one of them can, in the course of hosting it, hold customer content at rest or in transit.",
      },
      {
        type: "table",
        caption: "Engaged for the managed platform on platform.ciele.app.",
        headers: TABLE_HEADERS,
        rows: [
          [
            "Vercel",
            "Application hosting, edge delivery and scheduled jobs",
            "Account data, request metadata, content in transit",
            "EU",
          ],
          [
            "Supabase",
            "Managed Postgres, authentication and file storage",
            "All customer content at rest: knowledge, conversations, members",
            "EU",
          ],
          [
            "Resend",
            "Transactional email — invitations, notifications, escalation email",
            "Recipient address and message content",
            "EU / US (SCCs)",
          ],
        ],
      },
    ],
  },
  {
    id: "models",
    title: "Model providers",
    blocks: [
      {
        type: "p",
        text: "A model provider receives the prompt for a turn — the visitor's question, the knowledge retrieved to answer it, and the assistant's instructions — and returns the answer. Which providers are engaged depends on the Provider Connections an organization configures: an organization that connects only one provider is only ever routed to that one, and an organization on its own keys or a federated cloud account contracts with the provider directly.",
      },
      {
        type: "table",
        caption:
          "Engaged per turn, according to the model each assistant is configured to use.",
        headers: TABLE_HEADERS,
        rows: [
          [
            "Anthropic",
            "Answer generation, intent classification, embeddings pipeline support",
            "Prompt content: question, retrieved knowledge, assistant instructions",
            "US (SCCs)",
          ],
          [
            "OpenAI",
            "Answer generation and text embeddings for retrieval",
            "Prompt content and the text of indexed knowledge",
            "US (SCCs)",
          ],
          [
            "Google",
            "Answer generation via Gemini and Vertex AI",
            "Prompt content: question, retrieved knowledge, assistant instructions",
            "EU / US (SCCs)",
          ],
        ],
      },
      {
        type: "p",
        text: "None of these providers is permitted to use your content to train their models. That is a contractual term on our side and a configuration setting on theirs, and it applies to every turn the platform runs.",
      },
    ],
  },
  {
    id: "ingestion",
    title: "Knowledge ingestion",
    blocks: [
      {
        type: "p",
        text: "Crawling providers fetch the pages an organization asks us to index. They see the URLs configured for the crawl and the public content returned; they do not see conversations. A self-hosted crawler is available for organizations that would rather not involve a third party at all.",
      },
      {
        type: "table",
        caption: "Engaged only when a website source is configured to use them.",
        headers: TABLE_HEADERS,
        rows: [
          [
            "Apify",
            "Managed website crawling at scale",
            "Target URLs and fetched page content",
            "EU / US (SCCs)",
          ],
          [
            "Crawl4AI",
            "Crawling worker, run on our own infrastructure",
            "Target URLs and fetched page content",
            "EU",
          ],
        ],
      },
    ],
  },
  {
    id: "operations",
    title: "Business operations",
    blocks: [
      {
        type: "p",
        text: "These providers support the commercial and support side of the service. They do not process the content flowing through your assistants.",
      },
      {
        type: "table",
        headers: TABLE_HEADERS,
        rows: [
          [
            "Payment processor",
            "Subscription billing and invoicing for paid plans",
            "Billing contact and payment details, held by the processor",
            "EU / US (SCCs)",
          ],
        ],
      },
      {
        type: "p",
        text: "We do not ask you to enter card numbers into the product, and we do not store them.",
      },
    ],
  },
  {
    id: "customer-integrations",
    title: "Integrations you connect yourself",
    blocks: [
      {
        type: "p",
        text: "When an organization connects a help desk, a ticketing system, an identity provider or an external content source, data moves between Ciele and that system on that organization's instruction. Those systems are the customer's own processors, not ours, and they are not listed above — the organization chooses them, contracts with them and can disconnect them at any time.",
      },
    ],
  },
  {
    id: "changes",
    title: "Changes and notice",
    blocks: [
      {
        type: "p",
        text: (
          <>
            This page is the notice. When we add or replace a subprocessor we
            update it, and the date at the top changes with it. Customers with a
            signed{" "}
            <Link href="/policies/dpa" className={LINK_CLASS}>
              Data Processing Addendum
            </Link>{" "}
            can also ask to be notified by email before a change takes effect and
            may object on reasonable data-protection grounds.
          </>
        ),
      },
      {
        type: "p",
        text: (
          <>
            Questions about a specific provider, or a request for the current list
            in a format your procurement process needs, go to{" "}
            <a href="mailto:privacy@ciele.app" className={LINK_CLASS}>
              privacy@ciele.app
            </a>
            .
          </>
        ),
      },
    ],
  },
  {
    id: "self-hosting",
    title: "Self-hosting removes most of this list",
    blocks: [
      {
        type: "p",
        text: "The platform is open source and ships with a self-host stack. An institution that runs it inside its own perimeter keeps the database, the file storage and the application itself in-house, and engages a model provider directly rather than through us. In that setup Ciele processes nothing on your behalf and this page does not apply to you.",
      },
    ],
  },
];

export default async function SubprocessorsPage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <LegalDoc
        eyebrow="Legal"
        title="Subprocessors"
        lastUpdated={LAST_UPDATED}
        intro={
          <>
            The third parties that process data on our instructions to deliver
            the managed platform, grouped by what they are for. The list is short
            on purpose, and it is published rather than sent on request so a
            review can start without waiting on us.
          </>
        }
        sections={SECTIONS}
      />
      <HomeFooter />
    </HomeShell>
  );
}
