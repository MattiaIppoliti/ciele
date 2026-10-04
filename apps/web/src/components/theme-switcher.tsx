"use client";

import { Moon } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Expand } from "@/components/ui/expand";
import { useTheme } from "@/components/theme-provider";

/** Two-state appearance toggle in the account preferences menu. */
export function ThemeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const nextTheme = dark ? "light" : "dark";
  return (
    <div data-animate-group className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex items-center gap-3 text-base">
        <AnimatedIcon icon={Moon} size={18} />
        Theme
      </span>
      <Expand
        toggled={dark}
        onClick={() => setTheme(nextTheme)}
        onKeyDown={(event) => {
          // Keep the menu's typeahead from consuming native button activation.
          if (event.key === " " || event.key === "Enter") event.stopPropagation();
        }}
        aria-label="Dark theme"
        title={`Switch to ${nextTheme} theme`}
        data-foley-toggle="switch"
        className="press flex size-9 items-center justify-center rounded-full border text-xl text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </div>
  );
}
