"use client";

import { useEffect } from "react";
import { useShell } from "@/components/shell/shell-provider";

/**
 * Registers ids the Developer Panel should substitute into its snippets, for a
 * page whose ids the route does not already carry (#754). Renders nothing,
 * the same shape as `AssistantTopBarActions`, which registers into the top bar.
 *
 * The Assistant id needs no registration: it is a route segment, and the shell
 * reads it from the pathname. This is for the rest, a Knowledge Collection in a
 * query parameter, say. A value that is null or undefined is dropped rather than
 * registered, so the snippet keeps its placeholder instead of rendering "null".
 */
export function SnippetVariables({
  values,
}: {
  values: Record<string, string | null | undefined>;
}) {
  const { setSnippetVariables } = useShell();
  // Effect deps compare by identity, and a fresh object literal from a server
  // component is a new identity every render; the serialized form is what
  // actually changed.
  const serialized = JSON.stringify(values);

  useEffect(() => {
    const parsed = JSON.parse(serialized) as Record<string, string | null>;
    setSnippetVariables(
      Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => !!entry[1])
      )
    );
    return () => setSnippetVariables({});
  }, [serialized, setSnippetVariables]);

  return null;
}
