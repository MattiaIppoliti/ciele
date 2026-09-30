import { cn } from "@/lib/utils";

// The mark's three shapes, shared by the still logo and the peeking one.
const BODY =
  "M100.198 411.34H477.259V334.873C477.259 200.396 390.245 71.1934 274.226 71.1934C192.486 71.1934 139.75 126.566 139.75 210.943C102.835 226.764 81.7405 266.316 81.7405 324.325C81.7405 355.967 89.6509 384.972 100.198 411.34Z";
const LEFT_EYE =
  "M266.316 189.849H261.043C249.392 189.849 239.948 199.293 239.948 210.943V274.226C239.948 285.877 249.392 295.321 261.043 295.321H266.316C277.966 295.321 287.411 285.877 287.411 274.226V210.943C287.411 199.293 277.966 189.849 266.316 189.849Z";
const RIGHT_EYE =
  "M358.604 189.849H353.33C341.68 189.849 332.236 199.293 332.236 210.943V274.226C332.236 285.877 341.68 295.321 353.33 295.321H358.604C370.254 295.321 379.698 285.877 379.698 274.226V210.943C379.698 199.293 370.254 189.849 358.604 189.849Z";

/**
 * Ciele AI's mark: the only Teammate face that is drawn rather than generated
 * from a seed, because it is the Organization's AI layer and not a colleague
 * among others. The mark alone, no disc behind it, drawn in the theme's own
 * tokens so it follows light, dark and the brand palette.
 */
export function CieleAiLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 559 491"
      fill="none"
      className={cn("inline-flex shrink-0", className)}
    >
      <path
        d={BODY}
        className="fill-background stroke-muted-foreground"
        strokeWidth="39.5519"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={LEFT_EYE} className="fill-muted-foreground" />
      <path d={RIGHT_EYE} className="fill-muted-foreground" />
    </svg>
  );
}

/**
 * Ciele AI peeking up from the bottom of its New chat button: the whole mark,
 * scaled past the button's height so the head and the eyes show, with room
 * above them, and the body is cut off by the button's own bottom edge. The
 * parent clips (`overflow-hidden`) and places it. In `currentColor`, so it
 * greys and darkens with the button's text. On the parent's hover (`group`)
 * the eyes glance up and to the side, a small sign of life; reduced motion
 * keeps them still.
 */
export function CieleAiPeek({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 559 491" fill="none" className={cn("w-12", className)}>
        <path
          d={BODY}
          fill="currentColor"
          fillOpacity="0.12"
          stroke="currentColor"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={LEFT_EYE}
          fill="currentColor"
          className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[14px] group-hover:-translate-y-[20px] motion-reduce:transition-none motion-reduce:group-hover:translate-none"
        />
        <path
          d={RIGHT_EYE}
          fill="currentColor"
          className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[14px] group-hover:-translate-y-[20px] motion-reduce:transition-none motion-reduce:group-hover:translate-none"
        />
    </svg>
  );
}
