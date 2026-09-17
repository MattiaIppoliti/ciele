"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@agent-hub/ui";
import { listInputText, parseListInput, sameList } from "@/lib/list-input";

/**
 * A text field that stores a list.
 *
 * The field owns the raw text; the list is what that text parses to. A field
 * that instead renders `values.join(", ")` cannot be typed in at all: the
 * keystroke that adds the separator parses to the list already held, so the
 * parent re-renders with the same array and React puts the old text back, and
 * a second entry can only ever be pasted. That is what this exists to prevent,
 * and `lib/list-input.ts` holds the pure half under test.
 *
 * Text from outside (loading a saved Flow, the agent patching the draft) still
 * wins: {@link sameList} tells that apart from the component's own echo.
 */
export function ListInput({
  values,
  onChange,
  separator,
  ...rest
}: {
  values: readonly string[] | undefined;
  onChange: (next: string[]) => void;
  /** Narrow the separator set when a value may contain spaces of its own. */
  separator?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [text, setText] = useState(() => listInputText(values));
  const parsed = useRef<readonly string[]>(values ?? []);

  useEffect(() => {
    if (sameList(values, parsed.current)) return;
    parsed.current = values ?? [];
    setText(listInputText(values));
  }, [values]);

  return (
    <Input
      {...rest}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const list = parseListInput(next, separator);
        if (sameList(list, parsed.current)) return;
        parsed.current = list;
        onChange(list);
      }}
    />
  );
}
