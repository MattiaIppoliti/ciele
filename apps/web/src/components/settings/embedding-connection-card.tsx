"use client";

import { useState, useTransition } from "react";
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import type { ProviderConnection } from "@agent-hub/core";
import { updateEmbeddingConnectionAction } from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canEmbedWithConnection } from "@agent-hub/agent/client";

const AUTOMATIC = "automatic";

/**
 * Which Provider Connection embeds this Organization's knowledge (#437).
 *
 * Retrieval only works when every chunk in a Knowledge Collection shares one
 * embedding model, vectors from two models are not comparable. Left on
 * Automatic, the runtime picks by its own provider order, which can change as
 * connections come and go; naming a connection pins it.
 *
 * Only embedding-capable connections are offered: an OpenAI-compatible
 * endpoint appears once it declares an embedding model, and Anthropic never
 * does (no embeddings API).
 */
export function EmbeddingConnectionCard({
  connections,
  canManage,
}: {
  connections: ProviderConnection[];
  canManage: boolean;
}) {
  const capable = connections.filter(canEmbedWithConnection);
  const AUTOMATIC_LABEL = "Automatic (OpenAI, then Google, then OpenAI-compatible)";
  const labelFor = (value: string) =>
    value === AUTOMATIC
      ? AUTOMATIC_LABEL
      : (capable.find((c) => c.id === value)?.displayName ?? value);
  const current = connections.find((c) => c.preferredForEmbedding)?.id;
  const [selected, setSelected] = useState<string>(current ?? AUTOMATIC);
  const [isPending, startTransition] = useTransition();
  const dirty = selected !== (current ?? AUTOMATIC);

  function save() {
    const next = selected === AUTOMATIC ? null : selected;
    startTransition(async () => {
      try {
        await updateEmbeddingConnectionAction(next);
        toast.success(
          next
            ? "New knowledge will be embedded with this connection"
            : "Embedding connection set back to automatic"
        );
      } catch {
        setSelected(current ?? AUTOMATIC);
        toast.error("Could not change the embedding connection");
      }
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AnimatedIcon icon={Boxes} className="size-4" />
          Embedding connection
        </CardTitle>
        <CardDescription>
          Which connection turns your knowledge into vectors. Everything in one
          collection must be embedded by the same model for search to work, so
          pin it here if you run more than one provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={selected}
          onValueChange={(value) => setSelected(value ?? AUTOMATIC)}
          disabled={!canManage || isPending}
        >
          <SelectTrigger className="w-full sm:w-96">
            <SelectValue>{(value: string) => labelFor(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC}>{AUTOMATIC_LABEL}</SelectItem>
            {capable.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.displayName || connection.provider}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {capable.length === 0 && (
          <p className="text-muted-foreground text-sm">
            None of your connections can embed yet. Add an OpenAI or Google key,
            or give your OpenAI-compatible endpoint an embedding model.
          </p>
        )}

        <p className="text-muted-foreground text-sm">
          Changing this embeds <strong>new and re-indexed</strong> knowledge
          with the new model. Existing vectors stay as they are, so re-index a
          collection if you want it to match.
        </p>

        {canManage && (
          <Button onClick={save} disabled={!dirty || isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
