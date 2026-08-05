import Link from "next/link";
import {
  ArrowRight,
  DatabaseZap,
  FileSearch,
  KeyRound,
  Lock,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { BouncyAccordion, type BouncyAccordionItem } from "@/components/motion/bouncy-accordion";
import { CtaSection } from "@/components/marketing/cta-section";
import { SpotlightCard } from "@/components/marketing/spotlight-card";

interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
}

/* Every claim here maps to something the platform actually does today:
   Postgres RLS tenant isolation, in-app RBAC, managed-infra encryption,
   grounded answers with Source citations, sealed integration credentials,
   and the no-training-on-your-data stance. Nothing is aspirational except
   the compliance programs, which are clearly marked as in progress. */
const CAPABILITIES: Capability[] = [
  {
    icon: DatabaseZap,
    title: "Tenant isolation by default",
    body: "Every organization's data is separated at the database layer. Access is enforced with Postgres row-level security, so one tenant can never read another tenant's assistants, knowledge or conversations.",
  },
  {
    icon: KeyRound,
    title: "Role-based access control",
    body: "Members are assigned roles that scope what they can see and change within their organization. Sign-in is handled through our managed authentication layer, with single sign-on through Google and Microsoft.",
  },
  {
    icon: Lock,
    title: "Encryption in transit and at rest",
    body: "Traffic to the platform is served over TLS, and data is encrypted at rest by our managed database and storage providers. Secrets and access tokens are stored sealed, never in plain text.",
  },
  {
    icon: ShieldCheck,
    title: "Your data is never used to train models",
    body: "The content and conversations flowing through your assistants are used only to answer questions for your organization. We do not use them to train foundation models, and we do not share them with other customers.",
  },
  {
    icon: FileSearch,
    title: "Grounded, auditable answers",
    body: "Assistants answer from the knowledge you connect and cite the exact Source behind each response, so every answer can be traced back to the page or document it came from rather than an opaque model guess.",
  },
  {
    icon: Plug,
    title: "Secure integrations",
    body: "Connections to knowledge sources, help desks and identity providers use scoped credentials that are sealed at rest. Operational alerts flag an integration whose credentials stop working so it can be addressed quickly.",
  },
];

/* The governance rows and the document index are the two halves of the same
   answer to "can we sign this off": what our posture is, and where the paper
   that proves it lives. */
const GOVERNANCE: Array<{ term: string; detail: string }> = [
  {
    term: "SOC 2 Type II",
    detail:
      "Program recently started. We are defining and implementing the controls needed for an audit of security, availability and confidentiality. There is no report yet, and we will not imply otherwise.",
  },
  {
    term: "GDPR",
    detail:
      "Compliance work underway. We honor data access and deletion requests today and use Standard Contractual Clauses for international transfers.",
  },
  {
    term: "Data processing",
    detail:
      "When customers run their own assistants, Ciele acts as a processor and the customer is the controller of their conversation and end-user data.",
  },
  {
    term: "Subprocessors",
    detail:
      "A short, published list of hosting, database, email and model providers process data on our instructions. Changes are reflected on the subprocessor page.",
  },
  {
    term: "Data residency",
    detail:
      "The managed platform runs on European infrastructure. Organizations that need a specific region, or their own infrastructure entirely, can self-host the open-source edition.",
  },
  {
    term: "Vulnerability reports",
    detail:
      "Reports go to a monitored security mailbox and are triaged on receipt. We do not run a paid bounty, and we do not pursue good-faith researchers.",
  },
];

interface DocLink {
  title: string;
  body: string;
  href: string;
}

const DOCUMENTS: DocLink[] = [
  {
    title: "GDPR",
    body: "What GDPR requires, how we meet a processor's obligations, and where your data is stored and processed.",
    href: "/security/gdpr",
  },
  {
    title: "Data Processing Addendum",
    body: "The processor terms that govern conversation and end-user data, including transfer mechanisms and subprocessor notice.",
    href: "/policies/dpa",
  },
  {
    title: "Subprocessors",
    body: "The named providers that process data on our instructions, what each one does, and where it runs.",
    href: "/policies/subprocessors",
  },
  {
    title: "Responsible disclosure",
    body: "Scope, safe-harbour commitments and how to report a vulnerability so it reaches a human quickly.",
    href: "/security/responsible-disclosure",
  },
  {
    title: "Privacy Policy",
    body: "What personal data we collect as a controller, why, how long we keep it, and the rights you can exercise.",
    href: "/policies/privacy",
  },
  {
    title: "Cookie Notice",
    body: "Every cookie the site and product set, what each is for, how long it lasts, and how to change your choice.",
    href: "/policies/cookies",
  },
];

const FAQ_ITEMS: BouncyAccordionItem[] = [
  {
    id: "soc2",
    title: "Is Ciele SOC 2 certified?",
    description:
      "Not yet. We have recently started our SOC 2 Type II program and are putting the controls and evidence in place. We will update this page as we progress and can share more detail with prospective customers under NDA.",
  },
  {
    id: "gdpr",
    title: "Is Ciele GDPR compliant?",
    description:
      "We have begun formal GDPR compliance work. In practice we already follow its core principles: data minimization, tenant isolation, encryption, and honoring data access and deletion requests. Where we transfer data internationally we rely on Standard Contractual Clauses. The GDPR page covers this in full.",
  },
  {
    id: "access",
    title: "Who can access our organization's data?",
    description:
      "Within your organization, access is governed by the role each member holds. On our side, access is limited to the small number of staff who need it to operate and support the service, on a least-privilege basis.",
  },
  {
    id: "training",
    title: "Do you use our data to train AI models?",
    description:
      "No. Your knowledge and conversations are used only to run your assistants and to generate answers for your organization. They are not used to train foundation models.",
  },
  {
    id: "deletion",
    title: "Can we delete our data?",
    description:
      "Yes. Organizations control the conversation and knowledge data their assistants collect and can delete it from within the product. On account closure we delete or return your data subject to any legal retention requirements.",
  },
  {
    id: "residency",
    title: "Where is our data processed?",
    description:
      "The managed platform runs on European cloud infrastructure and uses a small set of subprocessors, including our hosting, database, email and model providers, to deliver the service. The subprocessor page names each one. Organizations that need full control can self-host the open-source edition instead.",
  },
  {
    id: "self-host",
    title: "Can we run Ciele on our own infrastructure?",
    description:
      "Yes. The platform is open source and ships with a self-host stack, so an institution that cannot send data to a third party can run the whole thing inside its own perimeter. In that setup we process nothing on your behalf at all.",
  },
  {
    id: "dpa",
    title: "Will you sign a DPA?",
    description:
      "Yes. Our processor terms are published so you can review them before you ask, and we counter-sign a customer DPA or accept ours, whichever your procurement process needs.",
  },
];

function StatusBadge({ label }: { label: string }) {
  return (
    <div className="border-border bg-background/50 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm backdrop-blur-sm">
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]"
      />
      <span className="text-foreground font-medium">{label}</span>
      <span className="text-muted-foreground">in progress</span>
    </div>
  );
}

export function SecurityContent() {
  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        {/* Hero — centred over the full column, the same shape every other
            marketing page opens with. Left-aligned in a max-w-3xl box left the
            whole page hugging the left half of a wide screen. */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
            Security
          </p>
          <h1 className="text-foreground mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Security you can trace
          </h1>
          <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
            Ciele is built so organizations can trust their AI assistants: tenant
            data is isolated at the database layer, access is scoped by role,
            answers are grounded in your own knowledge, and your content is never
            used to train models.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <StatusBadge label="SOC 2 Type II" />
            <StatusBadge label="GDPR compliance" />
          </div>
          <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-sm leading-relaxed">
            We recently began our SOC 2 Type II and GDPR compliance programs. Those
            certifications are not complete yet, and we will not claim otherwise.
            The practices below are in place today.
          </p>
        </div>

        {/* Capability grid */}
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability, index) => {
            const Icon = capability.icon;
            return (
              <SpotlightCard key={capability.title} index={index}>
                <span className="bg-muted mb-5 flex size-9 items-center justify-center rounded-lg border">
                  <Icon className="text-muted-foreground size-4" strokeWidth={1.75} />
                </span>
                {/* font-sans: the marketing layout sets headings in the serif
                    display face, which at this size argues with the body copy. */}
                <h2 className="text-foreground font-sans text-sm font-medium">
                  {capability.title}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {capability.body}
                </p>
              </SpotlightCard>
            );
          })}
        </div>

        {/* Compliance & governance — section header split across the full
            width (title left, the sentence that qualifies it right), then the
            rows run edge to edge with the term in a fixed left column. */}
        <section className="mt-24">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-xl">
              <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
                Compliance
              </p>
              <h2 className="text-foreground mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Compliance and governance
              </h2>
            </div>
            <p className="text-muted-foreground max-w-md text-base leading-relaxed">
              We are early in our formal compliance journey and are being
              deliberate about what we claim. Here is where things stand today.
            </p>
          </div>
          <dl className="border-border/60 mt-10 border-t">
            {GOVERNANCE.map((row) => (
              <div
                key={row.term}
                className="border-border/60 flex flex-col gap-1 border-b py-5 sm:flex-row sm:gap-10"
              >
                <dt className="text-foreground w-full shrink-0 text-sm font-semibold sm:w-64 lg:w-72">
                  {row.term}
                </dt>
                <dd className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
                  {row.detail}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Document index — the hub half of the page: everything a procurement
            or DPO review asks for, each on its own page. */}
        <section className="mt-24">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-xl">
              <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
                Documentation
              </p>
              <h2 className="text-foreground mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Security and legal documents
              </h2>
            </div>
            <p className="text-muted-foreground max-w-md text-base leading-relaxed">
              Published rather than sent on request, so a review can start
              without waiting on us.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DOCUMENTS.map((doc) => (
              <Link
                key={doc.href}
                href={doc.href}
                className="group border-border bg-card/60 hover:border-foreground/25 flex flex-col rounded-2xl border p-6 backdrop-blur-sm transition-colors"
              >
                <span className="text-foreground flex items-center gap-2 text-sm font-medium">
                  {doc.title}
                  <ArrowRight className="size-3.5 -translate-x-1 opacity-0 duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {doc.body}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* FAQ — centred block, rows left-aligned: a question centred against
            its own chevron reads as a layout bug. Same accordion as Pricing. */}
        <div className="mx-auto mt-24 max-w-3xl">
          <h2 className="text-foreground text-center text-2xl font-semibold tracking-tight">
            Frequently asked questions
          </h2>
          <BouncyAccordion
            className="mt-6 text-left"
            items={FAQ_ITEMS}
            classNames={{
              // Match the translucent surfaces the rest of the page sits on.
              item: "bg-card/60 ring-1 ring-border/60 backdrop-blur-sm",
              title: "whitespace-normal text-wrap",
            }}
          />
        </div>

        {/* Contact */}
        <div className="border-border bg-card/60 mt-24 flex flex-col gap-6 rounded-2xl border p-8 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-12">
          <div className="max-w-2xl">
            <h2 className="text-foreground text-lg font-semibold">
              Report a security issue
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              If you believe you have found a vulnerability, or you have a question
              about our security practices, please reach out. We take reports
              seriously and will respond quickly. The{" "}
              <Link
                href="/security/responsible-disclosure"
                className="text-foreground font-medium underline underline-offset-4"
              >
                responsible disclosure policy
              </Link>{" "}
              sets out scope and what you can expect from us.
            </p>
          </div>
          <a
            href="mailto:security@ciele.app"
            className="text-foreground shrink-0 text-sm font-medium underline underline-offset-4"
          >
            security@ciele.app
          </a>
        </div>

        <CtaSection
          lead="Grounded, isolated, traceable."
          trail="See it on your own content."
          primary={{ label: "Request a demo", href: "/contact/sales" }}
          secondary={{ label: "Read the docs", href: "https://docs.ciele.app" }}
        />
      </div>
    </main>
  );
}
