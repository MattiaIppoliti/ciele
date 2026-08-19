import Link from "next/link";
import { GhostMark } from "@/components/auth/ghost-mark";
import { CookiePreferencesButton } from "@/components/cookie-consent/cookie-preferences-button";
import { FooterClock, FooterNewsletter } from "@/components/home/footer-widgets";
import {
  FallingStars,
  FlyingBirds,
  StarField,
} from "@/components/home/sky";

const COLUMNS: Array<{
  title: string;
  links: Array<{ name: string; href: string; external?: boolean }>;
}> = [
  {
    title: "Product",
    links: [
      { name: "Features", href: "#features" },
      { name: "Pricing", href: "/pricing" },
      { name: "Download", href: "/download" },
      { name: "Request a demo", href: "/contact/sales" },
      { name: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Company",
    links: [
      { name: "Docs", href: "https://docs.ciele.app", external: true },
      { name: "Home", href: "/home" },
    ],
  },
  {
    title: "Legal",
    links: [
      { name: "Security", href: "/security" },
      { name: "GDPR", href: "/security/gdpr" },
      { name: "DPA", href: "/policies/dpa" },
      { name: "Subprocessors", href: "/policies/subprocessors" },
      { name: "Privacy Policy", href: "/policies/privacy" },
      { name: "Cookie Notice", href: "/policies/cookies" },
      { name: "Terms of Service", href: "/policies/terms-of-service" },
    ],
  },
];

/* The footer mirrors the hero sky: daytime birds in light mode, stars and
   falling-star streaks in dark mode. The content sits in a rounded card
   inset from the edges, same translucent surface as the scrolled navbar
   pill, so the sky stays visible around it and blurs through it. */
export function HomeFooter() {
  return (
    <footer
      id="contact"
      /* The sky above the footer card used to run for 12rem before anything
         appeared, which left every page ending in a field of empty gradient.
         Enough for the sun and the birds, no more. */
      className="home-below-fold home-sky-footer relative scroll-mt-24 overflow-hidden px-4 pt-16 sm:px-8 sm:pt-24 lg:px-12"
    >
      {/* Light-mode top seam: the white section above blends gradually down
          into the sky over a tall band, so the two never meet on a hard edge,
          the same soft handoff the night gradient gives for free in dark
          mode. It sits at the bottom of the stack so the sun and birds paint
          over it and stay visible through the blend. */}
      <div
        aria-hidden="true"
        className="from-background pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b to-transparent sm:h-72 dark:hidden"
      />
      <div
        aria-hidden="true"
        className="home-footer-sun-rays pointer-events-none absolute inset-0 dark:hidden"
      />
      <FlyingBirds variant="footer" className="dark:hidden" />

      <StarField className="hidden dark:block" />
      <FallingStars className="hidden dark:block" />
      {/* Dark-mode top seam: painted over the night scene, matching the
          original gradual blend of the section above into the footer. */}
      <div
        aria-hidden="true"
        className="from-background pointer-events-none absolute inset-x-0 top-0 hidden h-48 bg-gradient-to-b to-transparent sm:h-56 dark:block"
      />

      <div className="text-foreground bg-background/50 border-border relative mx-auto w-full max-w-6xl rounded-t-3xl border border-b-0 backdrop-blur-lg sm:rounded-t-[2.5rem]">
        <div className="px-6 pb-10 pt-12 sm:px-10 sm:pt-14">
          {/* Top: brand on the left, link columns on the right. */}
          <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
            <Link
              href="/home"
              aria-label="Ciele home"
              className="flex shrink-0 items-center gap-2.5"
            >
              <GhostMark className="size-9" eyesClassName="ghost-footer-eyes" />
              <span className="font-brand text-3xl font-medium leading-none tracking-tight">
                Ciele
              </span>
            </Link>

            <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-3 lg:gap-x-16">
              {COLUMNS.map((column) => (
                <div key={column.title}>
                  <h3 className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
                    {column.title}
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm">
                    {column.links.map((link) => (
                      <li key={link.name}>
                        <Link
                          href={link.href}
                          target={link.external ? "_blank" : undefined}
                          rel={link.external ? "noopener noreferrer" : undefined}
                          className="text-foreground/80 hover:text-foreground transition-colors"
                        >
                          {link.name}
                        </Link>
                      </li>
                    ))}
                    {/* Withdrawing consent has to be as easy as giving it, so the
                        re-opener lives in the footer of every page, not only in
                        the notice. */}
                    {column.title === "Legal" ? (
                      <li>
                        <CookiePreferencesButton className="text-foreground/80 hover:text-foreground cursor-pointer text-left transition-colors" />
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom: copyright + Rome clock on the left, newsletter on the right. */}
          <div className="border-border mt-12 flex flex-col gap-8 border-t pt-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-muted-foreground flex flex-col gap-x-6 gap-y-1 text-sm sm:flex-row sm:items-center">
              <span>© {new Date().getFullYear()} Ciele. AI you can trust.</span>
              <FooterClock />
            </div>

            <FooterNewsletter />
          </div>
        </div>
      </div>
    </footer>
  );
}
