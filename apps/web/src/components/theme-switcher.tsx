"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { useTheme } from "@/components/theme-provider";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Segmented Light / Dark / System control for the account dropdown. */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <span className="text-sm">Theme</span>
      <div className="flex rounded-full border p-0.5" role="radiogroup" aria-label="Theme">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={`${label} theme`}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex size-6 items-center justify-center rounded-full transition-colors ${
              theme === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <AnimatedIcon icon={Icon} size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
