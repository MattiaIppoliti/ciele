import { PageReveal } from "@/components/motion/page-reveal";

/** Remounted on every navigation below this layout, so each page gets its entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageReveal>{children}</PageReveal>;
}
