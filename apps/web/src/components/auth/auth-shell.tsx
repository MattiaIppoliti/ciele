import { AuthChatbotPanel } from "@/components/auth/auth-chatbot-panel";
import { AuthGrid } from "@/components/auth/auth-grid";
import { GhostMark } from "@/components/auth/ghost-mark";
import { Link } from "@/components/ui/link";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-full lg:grid-cols-2">
      {/* "light" forces light-theme tokens even if <html class="dark"> is
          left over from a client-side nav out of the (dark-mode) admin
          shell — otherwise text/border tokens resolve to dark-mode values
          on this always-white panel and become unreadable. */}
      <div className="light text-foreground relative flex flex-col gap-4 overflow-hidden bg-white p-6 md:p-10">
        {/* Same square grid as the chatbot panel, in light-theme ink — but
            inverted mask: faint behind the form at center, visible toward
            the panel edges. */}
        <AuthGrid tone="light" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.94) 18%, rgba(255,255,255,0) 52%)",
          }}
        />
        <Link
          href="/"
          aria-label="Back to Ciele home"
          className="group relative z-10 flex w-fit items-end gap-2 font-medium"
        >
          {/* Ghost's own base bar sits above the SVG's true bottom edge
              (empty stroke margin below it) — nudge down so the bar lines
              up with the text baseline. */}
          <GhostMark
            className="size-8 translate-y-1"
            eyesClassName="group-hover:[animation:ghost-eyes-glance_3.6s_ease-in-out_infinite]"
          />
          <span className="font-brand text-xl font-medium leading-none">Ciele</span>
        </Link>
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-6">
              <h1 className="text-2xl font-bold">{title}</h1>
              {subtitle && <p className="text-muted-foreground mt-2 text-sm text-balance">{subtitle}</p>}
            </div>
            {children}
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <AuthChatbotPanel />
      </div>
    </div>
  );
}
