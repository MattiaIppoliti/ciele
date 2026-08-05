import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { LegalDoc, type LegalSection } from "@/components/marketing/legal-doc";

export const metadata: Metadata = {
  title: "Responsible disclosure | Ciele",
  description:
    "How to report a vulnerability in Ciele: what is in scope, what is out, what we commit to, and what we ask of you.",
};

const LAST_UPDATED = "5 August 2026";

const LINK_CLASS = "text-foreground font-medium underline underline-offset-4";

const SECTIONS: LegalSection[] = [
  {
    id: "reporting",
    title: "How to report",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Email{" "}
            <a href="mailto:security@ciele.app" className={LINK_CLASS}>
              security@ciele.app
            </a>
            . The mailbox is monitored, and a report reaches a person who can act
            on it rather than a ticket queue.
          </>
        ),
      },
      {
        type: "p",
        text: "A useful report includes:",
      },
      {
        type: "ul",
        items: [
          "What the issue is, and what an attacker could do with it.",
          "Where it is — the URL, endpoint or component, and the affected version or commit if you know it.",
          "Reproduction steps precise enough for us to see it ourselves.",
          "Any proof-of-concept request, payload or screenshot.",
          "Whether you accessed any data that was not yours, and how much.",
        ],
      },
      {
        type: "p",
        text: "Write in English or Italian. If encryption matters for what you are sending, say so in the first message and we will arrange a channel.",
      },
    ],
  },
  {
    id: "commitments",
    title: "What we commit to",
    blocks: [
      {
        type: "ul",
        items: [
          "We acknowledge a report within two business days.",
          "We give you an initial assessment, including whether we consider it in scope, within five business days.",
          "We keep you updated while we work on it, and we tell you when it is fixed.",
          "We will not pursue legal action against you, or ask anyone else to, for research carried out in good faith under this policy.",
          "We credit you publicly if you would like us to, and stay quiet about your involvement if you would rather we did.",
        ],
      },
      {
        type: "p",
        text: "We do not run a paid bug bounty. We would rather say that plainly than let a report arrive with the wrong expectation.",
      },
    ],
  },
  {
    id: "what-we-ask",
    title: "What we ask of you",
    blocks: [
      {
        type: "ul",
        items: [
          "Give us reasonable time to fix an issue before disclosing it — ninety days is the default, and we will usually be much faster.",
          "Use only accounts and organizations you own, or ones you have written permission to test.",
          "Stop as soon as you have confirmed an issue: do not enumerate further records, escalate laterally or persist access.",
          "Do not exfiltrate, retain or share data belonging to anyone else, and delete anything you incidentally accessed once you have reported it.",
          "Do not degrade the service — no denial of service, no load testing, no spam through platform email or escalation channels.",
          "Do not social-engineer our staff, customers or their students, and do not attack physical premises.",
        ],
      },
    ],
  },
  {
    id: "scope",
    title: "In scope",
    blocks: [
      {
        type: "ul",
        items: [
          "The tenant platform at platform.ciele.app, including the admin console and its server actions.",
          "The published widget runtime and the public API endpoints it calls.",
          "The marketing site at ciele.app.",
          "The open-source code in our public repository, including the self-host stack.",
        ],
      },
      {
        type: "p",
        text: "Classes of issue we especially want to hear about: anything that crosses a tenant boundary or defeats row-level security, authentication or session flaws, privilege escalation between roles, exposure of sealed credentials, server-side request forgery through the crawler or the API-integration egress path, and prompt injection that causes an assistant to leak another organization's knowledge or to reach a host it was never configured to reach.",
      },
    ],
  },
  {
    id: "out-of-scope",
    title: "Out of scope",
    blocks: [
      {
        type: "ul",
        items: [
          "Findings from automated scanners with no demonstrated impact.",
          "Missing security headers, cookie flags or TLS configuration nits with no exploitable consequence.",
          "Denial of service, volumetric or resource-exhaustion testing, and rate-limit absence without further impact.",
          "Social engineering, phishing of staff or customers, and physical attacks.",
          "Self-XSS, and issues that require a compromised device, a rooted browser or a malicious extension.",
          "Vulnerabilities in third-party services we do not control — report those to the provider; tell us if the exposure is ours.",
          "Content an assistant generates that is merely wrong, off-topic or unhelpful. That is a quality issue, not a vulnerability, and the product has an Improvements tracker for it.",
        ],
      },
    ],
  },
  {
    id: "safe-harbour",
    title: "Safe harbour",
    blocks: [
      {
        type: "p",
        text: "Research conducted in accordance with this policy is authorised, and we will treat it as such. We will not initiate or support a claim against you under computer-misuse law, contract or the DMCA for that work, and if a third party brings one we will make clear that your testing was authorised.",
      },
      {
        type: "p",
        text: "This does not extend to testing that goes beyond what is described here, and we cannot authorise testing against a customer's own self-hosted deployment or against a third-party system they have connected. Ask that customer, not us.",
      },
    ],
  },
  {
    id: "related",
    title: "Related pages",
    blocks: [
      {
        type: "ul",
        items: [
          <>
            <Link href="/security" className={LINK_CLASS}>
              Security overview
            </Link>{" "}
            — the practices and compliance status behind this policy.
          </>,
          <>
            <Link href="/security/gdpr" className={LINK_CLASS}>
              GDPR
            </Link>{" "}
            — our processor role and the measures protecting personal data.
          </>,
          <>
            <Link href="/policies/dpa" className={LINK_CLASS}>
              Data Processing Addendum
            </Link>{" "}
            — including the breach-notification commitment.
          </>,
        ],
      },
    ],
  },
];

export default async function ResponsibleDisclosurePage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <LegalDoc
        eyebrow="Security"
        title="Responsible disclosure"
        lastUpdated={LAST_UPDATED}
        intro={
          <>
            If you have found a vulnerability in Ciele, we want to hear about it
            and we would rather you did not have to guess at the rules first.
            This is what is in scope, what we commit to doing, and what we ask of
            you in return.
          </>
        }
        sections={SECTIONS}
      />
      <HomeFooter />
    </HomeShell>
  );
}
