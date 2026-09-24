"use client";
import {
  GraduationCap,
  ListChecks,
  MousePointer2,
  FlipHorizontal2,
  BookOpen,
} from "lucide-react";
import type { StudyFormat, StudyModeSettings } from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const STUDY_FORMATS = [
  {
    value: "multiple_choice",
    label: "Multiple choice",
    description: "Choose the correct answer.",
    tag: "@quiz",
    icon: ListChecks,
  },
  {
    value: "drag_words",
    label: "Drag the words",
    description: "Complete the missing word.",
    tag: "@dwords",
    icon: MousePointer2,
  },
  {
    value: "true_false",
    label: "True / False",
    description: "Check whether a statement is true.",
    tag: "@truefalse",
    icon: FlipHorizontal2,
  },
  {
    value: "flashcards",
    label: "Flashcards",
    description: "Recall and type the missing word.",
    tag: "@flashcards",
    icon: BookOpen,
  },
] satisfies Array<{
  value: StudyFormat;
  label: string;
  description: string;
  tag: string;
  icon: typeof BookOpen;
}>;

export function StudyMenu({
  settings,
  disabled,
  onSelect,
}: {
  settings?: StudyModeSettings;
  disabled?: boolean;
  onSelect: (prefix: string) => void;
}) {
  if (!settings?.enabled || !settings.formats.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Study exercises"
        disabled={disabled}
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 shrink-0 place-items-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GraduationCap className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuItem
          onClick={() => onSelect("@study ")}
          className="gap-3 py-3"
        >
          <GraduationCap className="size-5" />
          <span>
            <span className="block font-medium">Choose for me</span>
            <span className="text-muted-foreground text-xs">
              A format suited to your topic.
            </span>
          </span>
        </DropdownMenuItem>
        {STUDY_FORMATS.filter((item) =>
          settings.formats.includes(item.value),
        ).map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => onSelect(`${item.tag} `)}
            className="gap-3 py-3"
          >
            <item.icon className="size-5" />
            <span>
              <span className="block font-medium">{item.label}</span>
              <span className="text-muted-foreground text-xs">
                {item.description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
