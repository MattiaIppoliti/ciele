import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "Terms of Service — Ciele",
  description:
    "The terms that govern your use of the Ciele platform and AI assistants.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "the-service",
    title: "The service",
    blocks: [
      {
        type: "p",
        text: "Ciele provides a platform for building, testing and publishing AI assistants that answer questions from an organization's own knowledge. These Terms of Service govern your access to and use of the Ciele website, admin console and assistants. If your organization has signed a separate written agreement with Ciele, that agreement governs where it conflicts with these terms.",
      },
      {
        type: "p",
        text: "By creating an account, accepting an invitation to an organization or otherwise using the service, you agree to these terms.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts and security",
    blocks: [
      {
        type: "p",
        text: "You must provide accurate information when you register and keep it up to date. You are responsible for the activity under your account and for keeping your credentials secure. Access to an organization's workspace is controlled by roles; the permissions available to you depend on the role assigned to you within that organization.",
      },
      {
        type: "p",
        text: "Notify us promptly if you believe your account has been accessed without authorization.",
      },
    ],
  },
  {
    id: "your-content",
    title: "Your content and knowledge",
    blocks: [
      {
        type: "p",
        text: "You and your organization retain ownership of the content you connect, upload or create in Ciele, including knowledge sources, assistant configuration and conversation data. You grant Ciele the limited rights needed to host, process and display that content in order to provide the service, for example crawling the websites you add, indexing your files and generating grounded answers.",
      },
      {
        type: "p",
        text: "We do not use your content to train foundation models, and we do not disclose it to other customers. We may use subprocessors, such as model and infrastructure providers, to deliver the service.",
      },
      {
        type: "p",
        text: "You are responsible for ensuring you have the right to use the content you connect, and that it does not infringe the rights of others.",
      },
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    blocks: [
      {
        type: "p",
        text: "You agree not to use the service to:",
      },
      {
        type: "ul",
        items: [
          "Break the law or infringe the intellectual property, privacy or other rights of others.",
          "Upload malware, attempt to gain unauthorized access to the platform or other tenants, or probe, scan or disrupt the service.",
          "Reverse engineer the platform or attempt to extract its source code, except to the extent this restriction is prohibited by law.",
          "Use the service to build a competing product, or to abuse, harass or deceive end users.",
          "Circumvent usage limits, tenant isolation or access controls.",
        ],
      },
    ],
  },
  {
    id: "ai-output",
    title: "AI-generated answers",
    blocks: [
      {
        type: "p",
        text: "Assistants generate answers using large language models grounded in the knowledge you connect. AI answers can be incomplete or incorrect. You are responsible for reviewing how your assistants are configured and for any decisions made on the basis of their output. Ciele does not warrant that answers will be accurate, complete or fit for a particular purpose.",
      },
    ],
  },
  {
    id: "third-party",
    title: "Third-party services and integrations",
    blocks: [
      {
        type: "p",
        text: "The service can connect to third-party tools you choose, such as knowledge sources, help desk and ticketing systems and identity providers. When you connect an integration, you authorize Ciele to access the relevant data to provide the feature. Your use of a third-party service is governed by that provider's own terms, and Ciele is not responsible for third-party services.",
      },
    ],
  },
  {
    id: "billing",
    title: "Fees and billing",
    blocks: [
      {
        type: "p",
        text: "Paid plans are billed according to the plan or order you agree to. Fees are stated exclusive of taxes unless noted otherwise. Where a plan renews automatically, it continues until cancelled in line with the applicable order. If any fees are past due, we may suspend access until payment is made.",
      },
    ],
  },
  {
    id: "intellectual-property",
    title: "Our intellectual property",
    blocks: [
      {
        type: "p",
        text: "Ciele and its licensors own the platform, its software, design and brand. We grant you a limited, non-exclusive, non-transferable and revocable right to use the service in line with these terms. Nothing in these terms transfers our intellectual property to you.",
      },
    ],
  },
  {
    id: "termination",
    title: "Suspension and termination",
    blocks: [
      {
        type: "p",
        text: "You may stop using the service at any time. We may suspend or terminate access if you breach these terms, if required by law, or to protect the platform and its users. On termination, your right to use the service ends and we will delete or return your data in line with our Privacy Policy and any separate agreement, subject to legal retention requirements.",
      },
    ],
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    blocks: [
      {
        type: "p",
        text: "The service is provided on an \"as is\" and \"as available\" basis. To the fullest extent permitted by law, Ciele disclaims all warranties not expressly stated in these terms, including implied warranties of merchantability, fitness for a particular purpose and non-infringement.",
      },
    ],
  },
  {
    id: "liability",
    title: "Limitation of liability",
    blocks: [
      {
        type: "p",
        text: "To the fullest extent permitted by law, Ciele will not be liable for indirect, incidental, special or consequential damages, or for lost profits or data. Nothing in these terms limits liability that cannot be limited by law.",
      },
    ],
  },
  {
    id: "indemnification",
    title: "Indemnification",
    blocks: [
      {
        type: "p",
        text: "You agree to indemnify Ciele against claims arising from your misuse of the service, your content, or your breach of these terms or of applicable law, to the extent permitted by law.",
      },
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    blocks: [
      {
        type: "p",
        text: "We may update these terms from time to time. When we make material changes we will update the date at the top of this page and, where appropriate, notify you. Your continued use of the service after changes take effect means you accept the updated terms.",
      },
    ],
  },
  {
    id: "contact",
    title: "Contacting us",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Questions about these terms can be sent to{" "}
            <a
              href="mailto:legal@ciele.app"
              className="text-foreground font-medium underline underline-offset-4"
            >
              legal@ciele.app
            </a>
            .
          </>
        ),
      },
    ],
  },
];

export default async function TermsOfServicePage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <LegalDoc
        eyebrow="Legal"
        title="Terms of Service"
        lastUpdated="July 18, 2026"
        intro="These terms govern your use of the Ciele platform. They are written to be readable and to reflect how the product actually works, rather than to obscure it."
        sections={SECTIONS}
      />
      <HomeFooter />
    </HomeShell>
  );
}
