"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The Find palette's filter controls: a toggle chip and a one-choice menu. */

export function FilterChip({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
        pressed
          ? "border-foreground/30 bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function FilterMenu({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  /** The chosen option's label, or null while the filter is off. */
  value: string | null;
  options: Array<{ key: string; label: string; selected: boolean }>;
  onSelect: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={value ? `${label}: ${value}` : label}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
              value
                ? "border-foreground/30 bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent"
            }`}
          />
        }
      >
        {value ? `${label}: ${value}` : label}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option.key} onClick={() => onSelect(option.key)}>
            <span className="flex-1">{option.label}</span>
            {option.selected && <Check aria-hidden className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
