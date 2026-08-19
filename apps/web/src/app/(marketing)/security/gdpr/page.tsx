import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "GDPR | Ciele",
  description:
    "How Ciele approaches the GDPR: our role as processor, where data is stored, the measures that protect personal data, and the resources a DPO review needs.",
};

const LAST_UPDATED = "5 August 2026";

const LINK_CLASS = "text-foreground font-medium underline underline-offset-4";

/* Answers a DPO's questions in the order they get asked, and says plainly
   where we are not there yet. Nothing on this page asserts a certification we
   do not hold. */
const SECTIONS: LegalSection[] = [
  {
    id: "what-is-gdpr",
    title: "What is the GDPR?",
    blocks: [
      {
        type: "p",
        text: "The General Data Protection Regulation (EU) 2016/679 has applied since May 2018. It governs how personal data belonging to people in the European Union and the European Economic Area is collected, used, stored and transferred, and it applies to us whether the person is a member of your organization or a student chatting with one of your assistants.",
      },
      {
        type: "p",
        text: "It gives every individual a set of rights over their own data:",
      },
      {
        type: "ul",
        items: [
          "To be informed about how their data is used.",
          "To access the data held about them.",
          "To have inaccurate data corrected.",
          "To have their data erased.",
          "To restrict how their data is processed.",
          "To receive their data in a portable form.",
          "To object to processing.",
          "Not to be subject to a solely automated decision with legal or similarly significant effect.",
        ],
      },
    ],
  },
  {
    id: "our-role",
    title: "What is Ciele's role?",
    blocks: [
      {
        type: "p",
        text: "It depends which data you mean, and the distinction matters for who is accountable.",
      },
      {
        type: "p",
        text: "Ciele is the controller for account and website data: the name and email of a member, sign-in events, billing details, analytics about our own marketing site.",
      },
      {
        type: "p",
        text: "For the data flowing through your assistants, meaning the knowledge you connect, the conversations your visitors have and any user data you import for personalization, your organization is the controller and Ciele is the processor acting on your instructions. You decide what is ingested, what is retained and for how long; we process it to deliver the service and for nothing else.",
      },
    ],
  },
  {
    id: "audit",
    title: "Who has audited Ciele?",
    blocks: [
      {
        type: "p",
        text: "Nobody yet, and we will not imply otherwise. We recently began a SOC 2 Type II program and formal GDPR compliance work; neither has produced an external report or attestation at this point. When one exists, this page will say so and name the auditor.",
      },
      {
        type: "p",
        text: "What we can offer in the meantime is specific rather than reassuring: the platform is open source, so the isolation, access-control and retention mechanisms described on the security page can be read in the source rather than taken on trust, and an institution that cannot rely on an unaudited processor can self-host the whole platform inside its own perimeter.",
      },
    ],
  },
  {
    id: "storage",
    title: "Where is data stored?",
    blocks: [
      {
        type: "p",
        text: "The managed platform runs on European cloud infrastructure, and the primary database and file storage are hosted in the EU. Model providers that generate assistant answers process the prompt and the retrieved knowledge to produce a response; where a provider processes data outside the EEA, that transfer relies on Standard Contractual Clauses and, where applicable, an adequacy decision.",
      },
      {
        type: "p",
        text: (
          <>
            Every provider that touches customer data is named on the{" "}
            <Link href="/policies/subprocessors" className={LINK_CLASS}>
              subprocessor page
            </Link>
            , with what it does and where it runs.
          </>
        ),
      },
    ],
  },
  {
    id: "measures",
    title: "What measures protect personal data?",
    blocks: [
      {
        type: "p",
        text: "The technical and organizational measures below are in place today, not planned:",
      },
      {
        type: "ul",
        items: [
          "Tenant isolation enforced at the database layer with Postgres row-level security, so one organization's queries cannot reach another organization's rows.",
          "Role-based access control within each organization, so a member sees only what their role allows.",
          "TLS for traffic to the platform, and encryption at rest by our managed database and storage providers.",
          "Integration credentials and access tokens stored sealed, never in plain text.",
          "Least-privilege internal access: a small number of staff, only where operating or supporting the service requires it.",
          "Per-organization retention controls for conversation traces, so diagnostic data is swept on a schedule you set rather than kept indefinitely.",
          "Grounded answers with Source citations, so the provenance of an answer can be audited rather than guessed at.",
        ],
      },
    ],
  },
  {
    id: "processor-obligations",
    title: "How does Ciele meet a processor's obligations?",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Our processor commitments are written down in the{" "}
            <Link href="/policies/dpa" className={LINK_CLASS}>
              Data Processing Addendum
            </Link>
            : we process only on your instructions, keep processing confidential,
            apply the measures above, engage subprocessors under equivalent
            obligations and with notice of changes, assist you with data-subject
            requests and impact assessments, notify you of a personal data breach
            without undue delay, and delete or return your data at the end of the
            relationship.
          </>
        ),
      },
      {
        type: "p",
        text: "In the product, the same obligations show up as features rather than promises: an organization can export or delete its conversations and knowledge itself, and does not have to open a ticket with us to honour an erasure request from one of its own users.",
      },
    ],
  },
  {
    id: "rights-requests",
    title: "How are data-subject requests handled?",
    blocks: [
      {
        type: "p",
        text: "If you are a member of a customer organization, or a visitor who chatted with one of its assistants, that organization is the controller. Send the request to them, and they can act on it directly in the product. If a request reaches us first we will route it to them rather than act on their data unilaterally.",
      },
      {
        type: "p",
        text: (
          <>
            For data where Ciele is the controller, write to{" "}
            <a href="mailto:privacy@ciele.app" className={LINK_CLASS}>
              privacy@ciele.app
            </a>{" "}
            and we will respond within the statutory period.
          </>
        ),
      },
    ],
  },
  {
    id: "resources",
    title: "What resources are available?",
    blocks: [
      {
        type: "ul",
        items: [
          <>
            <Link href="/policies/dpa" className={LINK_CLASS}>
              Data Processing Addendum
            </Link>
            . The processor terms, transfer mechanisms and subprocessor notice.
          </>,
          <>
            <Link href="/policies/subprocessors" className={LINK_CLASS}>
              Subprocessors
            </Link>
            . Every provider that processes data on our instructions.
          </>,
          <>
            <Link href="/policies/privacy" className={LINK_CLASS}>
              Privacy Policy
            </Link>
            . What we collect as a controller, and why.
          </>,
          <>
            <Link href="/policies/cookies" className={LINK_CLASS}>
              Cookie Notice
            </Link>
            . Every cookie, its purpose and its lifetime.
          </>,
          <>
            <Link href="/security" className={LINK_CLASS}>
              Security overview
            </Link>
            . The practices behind the measures listed above.
          </>,
        ],
      },
    ],
  },
  {
    id: "questionnaire",
    title: "Can you complete our security questionnaire?",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Yes. Send it to{" "}
            <a href="mailto:security@ciele.app" className={LINK_CLASS}>
              security@ciele.app
            </a>{" "}
            and we will complete it, including the questions where the honest
            answer is &ldquo;not yet&rdquo;. We can also walk a procurement or
            DPO team through the architecture directly.
          </>
        ),
      },
    ],
  },
];

export default function GdprPage() {
  return (
    <LegalDoc
      eyebrow="Security"
      title="GDPR"
      lastUpdated={LAST_UPDATED}
      intro={
        <>
          How the General Data Protection Regulation applies to Ciele, which
          role we play for which data, and what a data protection officer needs
          to sign us off. Where a certification is still in progress
          this page says so rather than rounding up.
        </>
      }
      sections={SECTIONS}
    />
  );
}
