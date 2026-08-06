import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "Privacy Policy | Ciele",
  description:
    "How Ciele collects, uses, shares and protects personal data across its AI assistant platform.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    blocks: [
      {
        type: "p",
        text: "Ciele provides a multi-tenant platform where organizations build, test and publish AI assistants that answer questions from their own knowledge. This policy explains what personal data we process when you use our website, sign in to the admin console, or interact with an assistant that an organization has published with Ciele.",
      },
      {
        type: "p",
        text: "Ciele acts as the data controller for account and website data. When an organization uses Ciele to run its own assistants, that organization is the controller of the conversations and end-user data flowing through its assistants, and Ciele acts as a processor on its behalf.",
      },
    ],
  },
  {
    id: "data-we-collect",
    title: "Personal data we collect",
    blocks: [
      {
        type: "h3",
        text: "Information you provide",
      },
      {
        type: "ul",
        items: [
          "Account details you enter when you sign up or are invited to an organization: name, work email address and your role within the organization.",
          "Content you create in the product: assistant configuration, welcome messages, quick replies, flows, help desk setup and the knowledge sources you connect (website URLs, uploaded files and FAQs).",
          "Messages you send us through contact forms, support requests or email.",
          "Sales enquiries: when you ask to talk to our team, the name, work email address, phone number, country, institution website, institution size and product interest you enter, together with your message. Submitting the form sends this to our sales mailbox; we do not keep a separate marketing database of enquiries.",
          "Your marketing consent: if you turn on the consent toggle on our contact form, we record that you agreed and the moment you agreed, so we can show the basis on which we contacted you. You can withdraw it at any time by replying to any message from us or using the contact details below.",
        ],
      },
      {
        type: "h3",
        text: "Information collected automatically",
      },
      {
        type: "ul",
        items: [
          "Technical data such as browser type, device information, approximate location derived from IP address, and pages viewed, used to keep the service secure and to understand how it is used.",
          "For published assistants, conversation transcripts and session metadata (for example launch URL, browser, operating system and language) that the assistant records so the operating organization can review and improve its answers.",
        ],
      },
      {
        type: "p",
        text: "We do not ask you to enter payment card numbers into the product. Billing, where applicable, is handled through a third-party payment processor.",
      },
    ],
  },
  {
    id: "how-we-use",
    title: "How we use personal data",
    blocks: [
      {
        type: "ul",
        items: [
          "To operate the platform: authenticate you, keep organizations isolated from one another, run assistants and deliver answers grounded in the knowledge you connect.",
          "To maintain security, prevent fraud and abuse, and diagnose and fix problems.",
          "To communicate with you about your account, service changes and support requests.",
          "To improve our product and, where you have opted in, to send you relevant updates.",
          "To meet legal obligations.",
        ],
      },
      {
        type: "p",
        text: "We do not use the content or conversations that flow through your assistants to train foundation models, and we do not sell personal data.",
      },
    ],
  },
  {
    id: "legal-basis",
    title: "Legal basis for processing",
    blocks: [
      {
        type: "p",
        text: "Where the GDPR or UK GDPR applies, we rely on one or more of the following grounds: performance of our contract with you, our legitimate interests in operating and securing the service, your consent (for example for marketing email, which you can withdraw at any time), and compliance with legal obligations.",
      },
    ],
  },
  {
    id: "cookies",
    title: "Cookies and similar technologies",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Our website and admin console use a small number of cookies.
            Strictly necessary cookies keep you signed in and remember your
            interface preferences, such as light or dark theme. Optional
            cookies, including the privacy-respecting analytics we use to
            understand aggregate usage, are set only if you allow them, and
            you can change or withdraw that choice at any time from the cookie
            preferences link in our footer. Our{" "}
            <a
              href="/policies/cookies"
              className="text-foreground font-medium underline underline-offset-4"
            >
              Cookie Notice
            </a>{" "}
            lists every cookie we set, what it does and how long it lasts.
          </>
        ),
      },
    ],
  },
  {
    id: "how-we-share",
    title: "How we share personal data",
    blocks: [
      {
        type: "p",
        text: "We share personal data only where needed to run the service:",
      },
      {
        type: "ul",
        items: [
          "Infrastructure and subprocessors that host the platform and process data on our instructions, including our cloud hosting and database providers and the model providers that generate assistant answers.",
          "The organization whose assistant you interact with, which receives the conversations and end-user data its assistant collects.",
          "Authorities or advisors where required by law, to protect our rights, or in connection with a corporate transaction.",
        ],
      },
      {
        type: "p",
        text: "We do not sell your personal data or your end users' personal data, and we do not share it for cross-context behavioral advertising.",
      },
    ],
  },
  {
    id: "retention",
    title: "Data retention",
    blocks: [
      {
        type: "p",
        text: "We keep personal data for as long as your account is active or as needed to provide the service, then delete or anonymize it unless we are required to keep it for legal, accounting or security reasons. Organizations control the retention of the conversation data their assistants collect and can delete it from within the product.",
      },
      {
        type: "p",
        text: "Sales enquiries live in our sales mailbox rather than in the product database. We keep them for as long as we are in contact with you about the enquiry and for up to twenty-four months afterwards, then delete them. Ask us at any time and we will delete yours sooner.",
      },
    ],
  },
  {
    id: "your-rights",
    title: "Your rights and choices",
    blocks: [
      {
        type: "p",
        text: "Depending on where you live, you may have the right to access, correct, delete or export your personal data, to object to or restrict certain processing, and to withdraw consent. To exercise these rights, contact us using the details below. If you interacted with an assistant run by an organization, we may direct your request to that organization as the controller of its data.",
      },
      {
        type: "p",
        text: "You will not be discriminated against for exercising any of these rights.",
      },
    ],
  },
  {
    id: "international-transfers",
    title: "International data transfers",
    blocks: [
      {
        type: "p",
        text: "Ciele may process and store data in countries other than your own. Where we transfer personal data out of the European Economic Area, the United Kingdom or Switzerland, we rely on appropriate safeguards such as Standard Contractual Clauses.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      {
        type: "p",
        text: "We protect personal data with encryption in transit and at rest, strict tenant isolation, role-based access controls and least-privilege access for our team. No system is perfectly secure, but we work to protect your data and will notify affected users and regulators of a personal data breach where the law requires it. You can read more on our security page.",
      },
    ],
  },
  {
    id: "children",
    title: "Children",
    blocks: [
      {
        type: "p",
        text: "Ciele is intended for organizations and their staff, and is not directed to children. We do not knowingly collect personal data from anyone under 16. If you believe a child has provided us personal data, please contact us and we will delete it.",
      },
    ],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    blocks: [
      {
        type: "p",
        text: "We may update this policy from time to time. When we make material changes we will update the date at the top of this page and, where appropriate, notify you through the product or by email.",
      },
    ],
  },
  {
    id: "contact",
    title: "How to contact us",
    blocks: [
      {
        type: "p",
        text: (
          <>
            For any question about this policy or your personal data, contact us
            at{" "}
            <a
              href="mailto:privacy@ciele.app"
              className="text-foreground font-medium underline underline-offset-4"
            >
              privacy@ciele.app
            </a>
            .
          </>
        ),
      },
    ],
  },
];

export default async function PrivacyPolicyPage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <LegalDoc
        eyebrow="Legal"
        title="Privacy Policy"
        lastUpdated="July 18, 2026"
        intro="This Privacy Policy describes how Ciele handles personal data when you use our website, our admin console and the AI assistants our customers publish. We keep it plain and specific to how the product actually works."
        sections={SECTIONS}
      />
      <HomeFooter />
    </HomeShell>
  );
}
