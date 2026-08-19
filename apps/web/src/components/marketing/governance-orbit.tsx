import { Building2, Shield, Users, UserRound, Bot, ScrollText } from "lucide-react";

/* Orbit diagram: the Organization at the centre, everything governance touches
   placed on rings around it. Positions are hand-placed percentages rather than
   computed, the labels have different widths, and an even angular spread
   leaves them colliding at the top and bottom of the circle. */
const NODES = [
  { label: "Member", icon: UserRound, top: "28%", left: "22%" },
  { label: "Audit trail", icon: ScrollText, top: "68%", left: "9%" },
  { label: "Assistant", icon: Bot, top: "76%", left: "31%" },
  { label: "Team", icon: Users, top: "70%", left: "60%" },
  { label: "Role", icon: Shield, top: "26%", left: "60%" },
  { label: "Developer", icon: UserRound, top: "52%", left: "72%" },
  { label: "Owner", icon: Shield, top: "32%", left: "86%" },
];

function OrbitNode({
  label,
  icon: Icon,
  top,
  left,
}: (typeof NODES)[number]) {
  return (
    <div
      className="border-border bg-background/80 text-foreground absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur-sm"
      style={{ top, left }}
    >
      <Icon className="text-muted-foreground size-3.5" strokeWidth={1.75} />
      {label}
    </div>
  );
}

export function GovernanceOrbit() {
  return (
    <div className="border-border bg-background/40 relative h-72 w-full overflow-hidden rounded-2xl border sm:h-80">
      {/* Rings. Drawn in an SVG that overflows the frame so only the arcs
          crossing it are visible, the same "slice of a much bigger system"
          read as the reference. */}
      <svg
        aria-hidden
        className="text-muted-foreground/25 absolute inset-0 size-full"
        viewBox="0 0 1000 320"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
      >
        {[60, 110, 210, 320, 440].map((r) => (
          <circle key={r} cx="500" cy="160" r={r} strokeWidth="1" />
        ))}
      </svg>

      {/* The Organization at the centre. */}
      <div className="border-border bg-background/70 absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border">
        <Building2 className="text-muted-foreground size-5" strokeWidth={1.75} />
        <span className="sr-only">Your organization</span>
      </div>

      {NODES.map((node) => (
        <OrbitNode key={node.label} {...node} />
      ))}
    </div>
  );
}
