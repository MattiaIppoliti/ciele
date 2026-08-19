import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { ThemeProvider } from "@/components/theme-provider";
import "./home.css";

/* Every public page, the home, the Enterprise and Pricing pitches, security
   and legal, shares one chrome: the themed sky shell (day sky in light mode,
   starry night in dark mode), the header and the footer. Kept as a route-group
   layout so the URLs stay flat (/home, /pricing, /security, /policies/privacy).

   The shell lives HERE rather than in each page on purpose: App Router only
   preserves a subtree across a navigation when it sits in a layout, so a
   per-page shell remounted the whole header on every marketing navigation,
   dropping the open mega-menu panel and snapping the nav pill back to its
   expanded state. Pages render their own content and nothing else.

   Nothing here reads a request, and that is load-bearing: this layout used to
   resolve the caller's session so the header could pick its CTA, and a layout
   that reads cookies makes every route beneath it dynamic, seven pages
   re-rendered per request to decide one button. The header now renders both CTAs
   and the signed-in hint chooses between them before first paint, so the whole
   group prerenders. See lib/auth-hint.ts. Keep it request-free. */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Serif headings are a marketing-only brand accent (see globals.css).
          `display:contents` scopes the class without adding a layout box. */}
      <div className="marketing-serif contents">
        <ThemeProvider>
          <HomeShell>
            {children}
            <HomeFooter />
          </HomeShell>
        </ThemeProvider>
      </div>
    </>
  );
}
