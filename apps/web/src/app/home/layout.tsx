import { ThemeProvider } from "@/components/theme-provider";
import { ThemeScript } from "@/components/theme-script";
import "./home.css";

/* Unlike the auth pages (always light), the marketing home is themed like
   the admin shell: day sky in light mode, starry night in dark mode. */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      {/* Serif headings are a marketing-only brand accent (see globals.css).
          `display:contents` scopes the class without adding a layout box. */}
      <div className="marketing-serif contents">
        <ThemeProvider>{children}</ThemeProvider>
      </div>
    </>
  );
}
