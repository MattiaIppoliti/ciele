import { PageReveal } from "@/components/motion/page-reveal";

/** Remounted on every navigation below this layout, so each page gets its entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  // The first page of a visit paints straight from the server HTML: hiding
  // it until hydration would cost first paint and LCP on the public site.
  return <PageReveal initialLoad="skip">{children}</PageReveal>;
}
