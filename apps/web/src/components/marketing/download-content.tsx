import Link from "next/link";
import {
  AppWindowMac,
  ArrowUpRight,
  Container,
  GitFork,
  HardDriveDownload,
} from "lucide-react";
import { Badge, Button, cn } from "@agent-hub/ui";
import { CtaSection } from "@/components/marketing/cta-section";
import { InstallCommand } from "@/components/marketing/install-command";
import { MarketingHero } from "@/components/marketing/marketing-hero";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { CodeBlock } from "@/components/ui/code-block";
import {
  INSTALL_SCRIPT_PATH,
  resolveSourceUrl,
  selfHostInstallCommand,
} from "@/lib/self-host-install";
import { CTA_CLASS } from "./plan-cards";

/**
 * The public download page: every way to get Ciele running on your own
 * machine, self-service, without leaving the site.
 *
 * A server component, with two client islands: the card reveal/spotlight
 * (`SpotlightCard`) and the hero's copy button (`InstallCommand`). All of the
 * content itself is static.
 *
 * The commands mirror `deploy/README.md` and
 * `apps/docs/content/docs/self-hosting/*`; if those change, change this too —
 * a download page that hands out a broken bootstrap is worse than no page. The
 * hero one-liner is the exception that cannot drift: it is built by the same
 * module that serves the script (`lib/self-host-install.ts`), which is pinned
 * to `deploy/bootstrap.sh` by its own test.
 */

/**
 * The open-source repository — where the desktop build is released, what the
 * quick start clones, and where "View the source" points. Overridable so a
 * fork points at itself rather than at us; resolved through the installer's
 * helper so the clone line below and the served script name the same repo.
 */
const SOURCE_URL = resolveSourceUrl();

/**
 * Where this deployment serves `/install.sh` from. Read from the app's own
 * origin rather than hardcoded, so a fork (or a preview deployment) hands out
 * a command that actually resolves; the default is the public site.
 *
 * A build with a nonsense origin should show no command at all rather than an
 * unusable one — the helper throws, and the hero drops the pill.
 */
function installCommand(): string | null {
  try {
    return selfHostInstallCommand(
      process.env.NEXT_PUBLIC_APP_URL || "https://ciele.app"
    );
  } catch {
    return null;
  }
}

/** The macOS beta `.zip` is attached to every release of the public repo. */
const RELEASES_URL = `${SOURCE_URL}/releases/latest`;

const SELF_HOST_ANCHOR = "self-host";

/** The three ways in, easiest first. */
const CHANNELS: Array<{
  Icon: typeof AppWindowMac;
  badge?: string;
  title: string;
  body: string;
  cta: { label: string; href: string; external?: boolean };
}> = [
  {
    Icon: AppWindowMac,
    badge: "macOS beta",
    title: "Ciele Desktop",
    body: "A native app with two ways in: sign in to your organization, or stand up a complete Ciele on this machine through a guided setup — no terminal, no configuration files. Docker Desktop does the heavy lifting behind the wizard.",
    cta: { label: "Download for macOS", href: RELEASES_URL, external: true },
  },
  {
    Icon: Container,
    title: "Self-host with Docker",
    body: "One script generates every secret and starts the whole stack on your own machine or server: admin console, chat widget, database and background jobs. Build from source, or pull the prebuilt images of any release.",
    cta: { label: "See the quick start", href: `#${SELF_HOST_ANCHOR}` },
  },
  {
    Icon: GitFork,
    title: "Straight from the source",
    body: "The whole product is open source under AGPL-3.0. Clone the repository to read it, run it, change it or contribute back — the code you deploy is the code we publish.",
    cta: { label: "View on GitHub", href: SOURCE_URL, external: true },
  },
];

/**
 * The quick start, verbatim from `deploy/README.md`. `SOURCE_URL` is a
 * build-time constant, so a fork that sets NEXT_PUBLIC_SOURCE_URL gets its own
 * address in the clone line too.
 */
const INSTALL_TABS = [
  {
    label: "Quick start",
    language: "bash",
    code: `git clone ${SOURCE_URL}.git && cd ciele

# Generates every secret, starts the stack
./deploy/bootstrap.sh

# Add --seed for sanitized demo content

# Then open http://localhost:3000 — the first
# account becomes the owner of its organization`,
  },
  {
    label: "Prebuilt images",
    language: "bash",
    code: `# Skip the source build: pull the published
# images of a release instead
./deploy/bootstrap.sh --images v0.4.0

# Any release tag of the repository works;
# a later "docker compose up -d" stays in
# image mode until you clear it from deploy/.env`,
  },
  {
    label: "Local models",
    language: "bash",
    code: `# Ciele speaks to any OpenAI-compatible server,
# so a fully local setup needs no provider account
ollama pull llama3.1:8b && ollama pull nomic-embed-text

# deploy/.env
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_COMPATIBLE_CHAT_MODEL=llama3.1:8b
OPENAI_COMPATIBLE_EMBEDDING_MODEL=nomic-embed-text
OPENAI_COMPATIBLE_EMBEDDING_DIMS=768`,
  },
];

/** What a self-hosted deployment has to bring itself. */
const REQUIREMENTS = [
  {
    title: "Docker",
    detail:
      "The stack is docker compose end to end. The first source build takes a while; the prebuilt images of a release skip it entirely.",
  },
  {
    title: "Your own models",
    detail:
      "A key for any supported provider, or an OpenAI-compatible server such as Ollama for a setup with no account anywhere.",
  },
  {
    title: "TLS in front, if public",
    detail:
      "The stack listens on plain HTTP. Put a reverse proxy in front to expose it, and it is ready for the open internet.",
  },
];

/** What `bootstrap.sh` actually starts — the stack, named honestly. */
const STACK = [
  {
    title: "Database & auth",
    body: "Postgres with pgvector, authentication and row-level security — every read scoped to your organization, enforced in the database.",
  },
  {
    title: "App & widget",
    body: "The same admin console and embeddable chat widget the hosted platform runs, served from your machine at localhost:3000.",
  },
  {
    title: "Migrations & jobs",
    body: "Schema migrations apply before the app starts, and the scheduled jobs run on the same clock the hosted deployment uses.",
  },
  {
    title: "Optional workers",
    body: "Graph retrieval and a JavaScript-rendering crawler are one profile switch away when you have the memory to spend.",
  },
];

export function DownloadContent() {
  const command = installCommand();

  return (
    <main className="relative px-4 pb-8 pt-28 sm:px-8 sm:pt-36 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <MarketingHero
          className="max-w-2xl"
          eyebrow={
            <>
              <HardDriveDownload className="size-3.5" strokeWidth={1.75} />
              Download
            </>
          }
          title="Run it yourself"
        >
          <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
            The whole product — console, widget, database, background jobs — on
            your own machine or servers. Open source, no account anywhere, no
            license fee.
          </p>

          {/* One command, above the fold. It fetches the source and hands off
              to the same bootstrap script the quick start below runs, so this
              is a shortcut through that section rather than a second path. */}
          {command && (
            <div className="mx-auto mt-8 max-w-xl">
              <InstallCommand command={command} />
              <p className="text-muted-foreground mt-3 text-sm">
                macOS and Linux, with Docker.{" "}
                <a
                  href={`#${SELF_HOST_ANCHOR}`}
                  className="text-foreground underline underline-offset-4 hover:no-underline"
                >
                  What it does
                </a>
                , or{" "}
                {/* Piping a script to a shell deserves the offer to read it
                    first, and the route serves it as plain text. */}
                <a
                  href={INSTALL_SCRIPT_PATH}
                  className="text-foreground underline underline-offset-4 hover:no-underline"
                >
                  read the script
                </a>{" "}
                before you run it.
              </p>
            </div>
          )}
        </MarketingHero>

        {/* The three ways in, easiest first. */}
        <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((channel, index) => (
            <SpotlightCard key={channel.title} index={index}>
              <div className="flex items-center gap-3">
                <span className="bg-muted text-foreground flex size-10 items-center justify-center rounded-xl">
                  <channel.Icon className="size-5" strokeWidth={1.75} />
                </span>
                {channel.badge && <Badge variant="outline">{channel.badge}</Badge>}
              </div>
              <h2 className="text-foreground mt-4 text-lg font-semibold tracking-tight">
                {channel.title}
              </h2>
              <p className="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">
                {channel.body}
              </p>
              <Button
                className={cn("mt-6 h-9 w-full", CTA_CLASS)}
                variant="outline"
                nativeButton={false}
                render={
                  channel.cta.external ? (
                    <a href={channel.cta.href} target="_blank" rel="noreferrer" />
                  ) : (
                    // A same-page jump, so a plain anchor: next/link would push
                    // a history entry for a hash the router does not own.
                    <a href={channel.cta.href} />
                  )
                }
              >
                <span>{channel.cta.label}</span>
                {channel.cta.external && (
                  <ArrowUpRight className="size-3.5" strokeWidth={2} />
                )}
              </Button>
            </SpotlightCard>
          ))}
        </section>

        {/* Self-service setup — the destination of the Docker card's CTA.
            `scroll-mt` clears the fixed marketing header after the jump. */}
        <section
          id={SELF_HOST_ANCHOR}
          className="mt-24 scroll-mt-28 sm:scroll-mt-32"
        >
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
              Self-service
            </p>
            <h2 className="text-foreground mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              From clone to running stack
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed">
              One bootstrap script and no form to fill in. It generates every
              secret, starts everything, and the first account you create owns
              its organization. The command at the top of this page runs exactly
              these steps for you; here they are to run by hand.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
            <CodeBlock tabs={INSTALL_TABS} />

            <div className="border-border/70 bg-card/60 rounded-xl border p-6 backdrop-blur-sm">
              <p className="text-foreground text-sm font-semibold">
                What you provide
              </p>
              <ul className="mt-4 space-y-4">
                {REQUIREMENTS.map((requirement) => (
                  <li key={requirement.title}>
                    <p className="text-foreground text-sm font-medium">
                      {requirement.title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {requirement.detail}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href="https://docs.ciele.app/self-hosting"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <span>Read the full guide</span>
                </Button>
                <Button
                  className={cn("h-9 w-full", CTA_CLASS)}
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a href={SOURCE_URL} target="_blank" rel="noreferrer" />
                  }
                >
                  <span>View the source</span>
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STACK.map((piece) => (
              <div key={piece.title}>
                <h3 className="text-foreground text-sm font-medium">
                  {piece.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {piece.body}
                </p>
              </div>
            ))}
          </div>

          <p className="text-muted-foreground mt-12 text-center text-sm">
            Prefer not to run servers?{" "}
            <Link
              href="/pricing"
              className="text-foreground underline underline-offset-4 hover:no-underline"
            >
              Ciele Cloud
            </Link>{" "}
            is the same product, hosted and kept current for you.
          </p>
        </section>

        <CtaSection
          lead="Your machine."
          trail="Your data. Your rules."
          primary={{ label: "Download for macOS", href: RELEASES_URL }}
          secondary={{ label: "See pricing", href: "/pricing" }}
        />
      </div>
    </main>
  );
}
