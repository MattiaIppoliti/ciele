"use client";

import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The shared look of a filter panel's text inputs and select triggers. */
export const FIELD_CLASS =
  "h-10 w-full rounded-lg border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring/50 md:text-sm";

/**
 * One labelled filter in a Filters panel: a select whose empty value reads as
 * `placeholder`, or, with `allowCustom`, a free-text input suggesting the
 * options through a datalist.
 */
export function FilterSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  allowCustom = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  allowCustom?: boolean;
}) {
  const listId = useId();
  const name = label.toLowerCase().replace(/\s+/g, "-");
  if (!allowCustom) {
    return (
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{label}</span>
        <Select value={value} onValueChange={(next) => onChange(next as string)}>
          <SelectTrigger>
            <SelectValue>
              {(next: string) =>
                options.find((option) => option.value === next)?.label ||
                placeholder
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{placeholder}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        list={listId}
        name={name}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    </label>
  );
}
