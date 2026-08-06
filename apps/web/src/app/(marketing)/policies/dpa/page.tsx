import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "Data Processing Addendum | Ciele",
  description:
    "The processor terms that govern customer personal data on the Ciele platform: scope, security measures, subprocessors, international transfers, breach notice and deletion.",
};

const LAST_UPDATED = "5 August 2026";

const LINK_CLASS = "text-foreground font-medium underline underline-offset-4";

const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    title: "Scope and roles",
    blocks: [
      {
        type: "p",
        text: "This Data Processing Addendum (the “DPA”) forms part of the agreement between Ciele and the customer for use of the Ciele platform, and applies whenever Ciele processes personal data on the customer's behalf.",
      },
      {
        type: "p",
        text: "The customer is the controller of Customer Personal Data and Ciele is the processor. Where the customer is itself acting as a processor for a third party, Ciele acts as a subprocessor and the customer's own instructions must be consistent with the ones it received.",
      },
      {
        type: "h3",
        text: "What counts as Customer Personal Data",
      },
      {
        type: "ul",
        items: [
          "Content of conversations between an end user and a published assistant, including any personal data an end user types.",
          "Knowledge the customer connects or uploads, to the extent it contains personal data.",
          "User data the customer imports for personalization, such as names, roles or student identifiers.",
          "Session metadata attached to a conversation: launch URL, IP address, browser, operating system, approximate location.",
          "Escalation submissions, including the fields a support-channel form collects.",
        ],
      },
      {
        type: "p",
        text: "Account data about the customer's own members — names, work email addresses, sign-in events, billing contacts — is processed by Ciele as a controller and is governed by the Privacy Policy rather than by this DPA.",
      },
    ],
  },
  {
    id: "instructions",
    title: "Processing instructions",
    blocks: [
      {
        type: "p",
        text: "Ciele processes Customer Personal Data only to provide, secure and support the platform in accordance with the agreement, this DPA and the customer's documented instructions. Configuring the product — which sources are ingested, which assistants are published, which retention period applies, which integrations are connected — is a documented instruction.",
      },
      {
        type: "p",
        text: "Ciele does not process Customer Personal Data for its own purposes, does not sell it, and does not use it to train foundation models. Model providers engaged to generate answers are contractually prohibited from training on it.",
      },
      {
        type: "p",
        text: "If Ciele believes an instruction infringes applicable data protection law, it will inform the customer and may suspend the affected processing until the instruction is amended or confirmed.",
      },
    ],
  },
  {
    id: "confidentiality",
    title: "Confidentiality and personnel",
    blocks: [
      {
        type: "p",
        text: "Access to Customer Personal Data is limited to the personnel who need it to operate or support the service, on a least-privilege basis. Those personnel are bound by confidentiality obligations that survive the end of their engagement, and access is removed when it is no longer required.",
      },
    ],
  },
  {
    id: "security",
    title: "Security measures",
    blocks: [
      {
        type: "p",
        text: "Ciele maintains technical and organizational measures appropriate to the risk, including:",
      },
      {
        type: "ul",
        items: [
          "Tenant isolation enforced at the database layer with Postgres row-level security.",
          "Role-based access control within each organization.",
          "Encryption in transit over TLS, and encryption at rest by the managed database and storage providers.",
          "Sealed storage of integration credentials and access tokens; no plain-text secrets.",
          "Per-organization retention controls for conversation traces, swept on a schedule.",
          "Logical separation of the staff console from the tenant application, with access restricted to an allowlist.",
          "Operational alerting on integration and credential failure.",
        ],
      },
      {
        type: "p",
        text: (
          <>
            The measures in force at any time are described on the{" "}
            <Link href="/security" className={LINK_CLASS}>
              security page
            </Link>
            . Ciele may update them, provided the level of protection is not
            reduced.
          </>
        ),
      },
    ],
  },
  {
    id: "subprocessors",
    title: "Subprocessors",
    blocks: [
      {
        type: "p",
        text: (
          <>
            The customer authorises Ciele to engage the subprocessors listed on the{" "}
            <Link href="/policies/subprocessors" className={LINK_CLASS}>
              subprocessor page
            </Link>
            . Each is engaged under a written contract imposing data protection
            obligations equivalent to those in this DPA, and Ciele remains liable
            for their performance.
          </>
        ),
      },
      {
        type: "p",
        text: "Ciele will update that page before a new subprocessor begins processing, and will notify customers who have asked to be notified. A customer may object on reasonable data-protection grounds within thirty days; if the objection cannot be resolved, the customer may terminate the affected part of the service.",
      },
    ],
  },
  {
    id: "transfers",
    title: "International transfers",
    blocks: [
      {
        type: "p",
        text: "The managed platform's primary hosting, database and storage are in the European Union. Where a subprocessor processes Customer Personal Data outside the EEA, the transfer relies on the European Commission's Standard Contractual Clauses, on an adequacy decision where one applies, and on supplementary measures where the transfer risk assessment calls for them.",
      },
      {
        type: "p",
        text: "For transfers subject to UK law the UK International Data Transfer Addendum applies to those clauses. Ciele will provide the executed clauses and its transfer risk assessment on request.",
      },
    ],
  },
  {
    id: "data-subject-requests",
    title: "Data subject requests",
    blocks: [
      {
        type: "p",
        text: "The product is built so the customer can answer most requests itself: conversations and knowledge can be searched, exported and deleted from the console without involving Ciele. Where a request cannot be satisfied that way, Ciele will provide reasonable assistance.",
      },
      {
        type: "p",
        text: "If a request from one of the customer's end users reaches Ciele directly, Ciele will not act on it unilaterally; it will refer the request to the customer.",
      },
    ],
  },
  {
    id: "breach",
    title: "Personal data breach",
    blocks: [
      {
        type: "p",
        text: "Ciele will notify the customer without undue delay after becoming aware of a personal data breach affecting Customer Personal Data, and in any case within seventy-two hours. The notice will describe what is known about the nature of the breach, the categories and approximate volume of data concerned, the likely consequences and the measures taken or proposed.",
      },
      {
        type: "p",
        text: "Ciele will provide the information the customer reasonably needs to meet its own notification obligations. A notification is not an admission of fault.",
      },
    ],
  },
  {
    id: "assistance",
    title: "Impact assessments and audits",
    blocks: [
      {
        type: "p",
        text: "Ciele will provide reasonable assistance with data protection impact assessments and prior consultations with a supervisory authority, to the extent they concern Ciele's processing and the customer cannot obtain the information itself.",
      },
      {
        type: "p",
        text: "On request Ciele will make available the information necessary to demonstrate compliance with this DPA, including its security documentation and, once available, the reports produced by its compliance programs. Where documentation is not sufficient, an audit may be conducted no more than once a year, on reasonable notice, under confidentiality, and without disrupting the service or exposing other customers' data.",
      },
      {
        type: "p",
        text: "Ciele holds no external audit report at the date of this document. Its SOC 2 Type II program is in progress, and this section will apply to the resulting report when there is one.",
      },
    ],
  },
  {
    id: "retention",
    title: "Retention, return and deletion",
    blocks: [
      {
        type: "p",
        text: "Customer Personal Data is retained for as long as the customer's account is active, subject to the retention settings the customer configures. Conversation traces are swept according to the organization's retention period.",
      },
      {
        type: "p",
        text: "On termination Ciele will delete or return Customer Personal Data, at the customer's choice, within thirty days, except where retention is required by law. Backups age out on their ordinary cycle.",
      },
    ],
  },
  {
    id: "self-hosting",
    title: "Self-hosted deployments",
    blocks: [
      {
        type: "p",
        text: "Where the customer runs the open-source edition on its own infrastructure, Ciele processes no Customer Personal Data and this DPA does not apply to that deployment. The customer is the controller and, if it engages a model provider, contracts with that provider directly.",
      },
    ],
  },
  {
    id: "signing",
    title: "Getting this signed",
    blocks: [
      {
        type: "p",
        text: (
          <>
            This DPA is published so a review can start before a conversation
            does. To have it counter-signed, or to have us review your own
            institution&rsquo;s template instead, write to{" "}
            <a href="mailto:legal@ciele.app" className={LINK_CLASS}>
              legal@ciele.app
            </a>
            . Where the customer&rsquo;s own executed DPA conflicts with this one,
            the executed document governs.
          </>
        ),
      },
    ],
  },
];

export default function DpaPage() {
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Data Processing Addendum"
      lastUpdated={LAST_UPDATED}
      intro={
        <>
          The processor terms that govern the personal data flowing through your
          assistants: what we may do with it, who else touches it, where it
          goes, what happens if something goes wrong, and how it is deleted.
          Published in full rather than sent on request.
        </>
      }
      sections={SECTIONS}
    />
  );
}
