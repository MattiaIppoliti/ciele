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
      <div className="light text-foreground relative flex flex-col overflow-hidden bg-white">
        {/* Same square grid as the chatbot panel, in light-theme ink — but
            inverted mask: faint behind the form at center, visible toward
            the panel edges. Static: nothing behind the form should move. */}
        <AuthGrid tone="light" drift={false} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.94) 18%, rgba(255,255,255,0) 52%)",
          }}
        />
        {/* The panel clips the decoration; this layer carries the scroll and
            the padding. Without it a short viewport — a phone in landscape, or
            in portrait with the keyboard raised — clipped the bottom of the
            form against `overflow-hidden` and left no way to reach it.
            `min-h-full` + `flex-1` keeps the form optically centred when there
            is room and lets it grow past the fold when there is not, which
            plain `items-center` in a scroll container cannot do without
            cutting off the top. */}
        <div className="relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="flex min-h-full flex-col gap-4 p-6 md:p-10">
            <Link
              href="/"
              aria-label="Back to Ciele home"
              className="group flex w-fit shrink-0 items-end gap-2 font-medium"
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
            <div className="flex flex-1 items-center justify-center py-4">
              <div className="w-full max-w-sm">
                <div className="mb-6">
                  <h1 className="text-2xl font-bold">{title}</h1>
                  {subtitle && <p className="text-muted-foreground mt-2 text-sm text-balance">{subtitle}</p>}
                </div>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* The right panel is decoration, not a second place to sign in. It is
          dimmed, desaturated and inert (no pointer events, no focusable
          controls) behind a scrim that fades out toward the far edge, so the
          eye settles on the form at left. Its own background colour sits on the
          wrapper so the dimmed content blends into dark, not into the page. */}
      <div className="relative hidden bg-[#1a1a1a] lg:block">
        <div inert className="pointer-events-none h-full opacity-60 grayscale select-none">
          <AuthChatbotPanel />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#1a1a1a]/70 via-[#1a1a1a]/45 to-[#1a1a1a]/25"
        />
      </div>
    </div>
  );
}
