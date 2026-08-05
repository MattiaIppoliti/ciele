import {
  DatabaseZap,
  FileSearch,
  KeyRound,
  Lock,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { CtaSection } from "@/components/marketing/cta-section";

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

interface Faq {
  question: string;
  answer: string;
}

const FAQS: Faq[] = [
  {
    question: "Is Ciele SOC 2 certified?",
    answer:
      "Not yet. We have recently started our SOC 2 Type II program and are putting the controls and evidence in place. We will update this page as we progress and can share more detail with prospective customers under NDA.",
  },
  {
    question: "Is Ciele GDPR compliant?",
    answer:
      "We have begun formal GDPR compliance work. In practice we already follow its core principles: data minimization, tenant isolation, encryption, and honoring data access and deletion requests. Where we transfer data internationally we rely on Standard Contractual Clauses.",
  },
  {
    question: "Who can access our organization's data?",
    answer:
      "Within your organization, access is governed by the role each member holds. On our side, access is limited to the small number of staff who need it to operate and support the service, on a least-privilege basis.",
  },
  {
    question: "Do you use our data to train AI models?",
    answer:
      "No. Your knowledge and conversations are used only to run your assistants and to generate answers for your organization. They are not used to train foundation models.",
  },
  {
    question: "Can we delete our data?",
    answer:
      "Yes. Organizations control the conversation and knowledge data their assistants collect and can delete it from within the product. On account closure we delete or return your data subject to any legal retention requirements.",
  },
  {
    question: "Where is our data processed?",
    answer:
      "The platform runs on managed cloud infrastructure and uses a small set of subprocessors, including our hosting, database and model providers, to deliver the service. We can share our current subprocessor list on request.",
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
        {/* Hero */}
        <div className="max-w-3xl">
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
          <div className="mt-8 flex flex-wrap gap-3">
            <StatusBadge label="SOC 2 Type II" />
            <StatusBadge label="GDPR compliance" />
          </div>
          <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
            We recently began our SOC 2 Type II and GDPR compliance programs. Those
            certifications are not complete yet, and we will not claim otherwise.
            The practices below are in place today.
          </p>
        </div>

        {/* Capability grid */}
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => {
            const Icon = capability.icon;
            return (
              <div
                key={capability.title}
                className="border-border bg-card/60 flex flex-col rounded-2xl border p-6 backdrop-blur-sm"
              >
                <div className="border-border bg-background flex size-10 items-center justify-center rounded-xl border">
                  <Icon className="text-foreground size-5" strokeWidth={1.75} />
                </div>
                <h2 className="text-foreground mt-5 text-base font-semibold">
                  {capability.title}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {capability.body}
                </p>
              </div>
            );
          })}
        </div>

        {/* Compliance & governance */}
        <div className="mt-20 max-w-3xl">
          <h2 className="text-foreground text-2xl font-semibold tracking-tight">
            Compliance and governance
          </h2>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            We are early in our formal compliance journey and are being deliberate
            about what we claim. Here is where things stand:
          </p>
          <ul className="mt-6 space-y-4">
            {[
              {
                term: "SOC 2 Type II",
                detail:
                  "Program recently started. We are defining and implementing the controls needed for an audit of security, availability and confidentiality.",
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
                  "A short list of hosting, database and model providers process data on our instructions. We can share the current list on request.",
              },
            ].map((row) => (
              <li
                key={row.term}
                className="border-border/60 flex flex-col gap-1 border-t pt-4 sm:flex-row sm:gap-6"
              >
                <span className="text-foreground w-48 shrink-0 text-sm font-semibold">
                  {row.term}
                </span>
                <span className="text-muted-foreground text-sm leading-relaxed">
                  {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* FAQ */}
        <div className="mt-20 max-w-3xl">
          <h2 className="text-foreground text-2xl font-semibold tracking-tight">
            Frequently asked questions
          </h2>
          <div className="mt-6 divide-border/60 border-border/60 divide-y border-t">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group py-4">
                <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                  {faq.question}
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="border-border bg-card/60 mt-20 max-w-3xl rounded-2xl border p-8 backdrop-blur-sm">
          <h2 className="text-foreground text-lg font-semibold">
            Report a security issue
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            If you believe you have found a vulnerability, or you have a question
            about our security practices, please reach out. We take reports
            seriously and will respond quickly.
          </p>
          <a
            href="mailto:security@ciele.app"
            className="text-foreground mt-4 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
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
