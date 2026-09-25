"use client";

// Shared Select entry point. Keeping this re-export means every existing form
// adopts the same animated control and remains on one implementation.
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectScrollDownArrow,
  SelectScrollUpArrow,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
