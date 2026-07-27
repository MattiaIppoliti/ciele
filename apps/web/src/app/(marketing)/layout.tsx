import { ThemeProvider } from "@/components/theme-provider";
import "../home/home.css";

/* Security + legal pages share the marketing home's chrome: the same themed
   sky shell (day sky in light mode, starry night in dark mode), header and
   footer. Kept as a route-group layout so the URLs stay flat
   (/security, /policies/privacy, /policies/terms-of-service). */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Serif headings are a marketing-only brand accent (see globals.css).
          `display:contents` scopes the class without adding a layout box. */}
      <div className="marketing-serif contents">
        <ThemeProvider>{children}</ThemeProvider>
      </div>
    </>
  );
}
