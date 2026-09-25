import { cn } from "./cn";

function Skeleton({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-muted animate-pulse rounded-md motion-reduce:animate-none",
        className
      )}
      {...props}
      style={{ animationDuration: "900ms", ...style }}
    />
  );
}

export { Skeleton };
