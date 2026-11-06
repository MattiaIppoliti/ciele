"use client";

import { useState, useTransition } from "react";
import type { QuickText } from "@agent-hub/core";
import { Button, Input } from "@agent-hub/ui";
import { toast } from "@/lib/toast";
import {
  createQuickTextAction,
  deleteQuickTextAction,
  updateQuickTextAction,
} from "@/app/(admin)/settings/quick-texts/actions";

interface Draft {
  id: string | null;
  title: string;
  body: string;
  folder: string;
}

const EMPTY: Draft = { id: null, title: "", body: "", folder: "" };

/** Create, edit and delete the Organization's Quick Texts (#1085). */
export function QuickTextsClient({
  quickTexts,
  canEdit,
}: {
  quickTexts: QuickText[];
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(current: Draft) {
    startTransition(async () => {
      const input = {
        title: current.title,
        body: current.body,
        folder: current.folder.trim() || null,
      };
      const result = current.id
        ? await updateQuickTextAction(current.id, input)
        : await createQuickTextAction(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(current.id ? "Quick Text saved" : "Quick Text created");
      setDraft(null);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteQuickTextAction(id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Quick Text deleted");
    });
  }

  return (
    <div className="space-y-4">
      {quickTexts.length === 0 && (
        <p className="text-muted-foreground text-sm">No Quick Texts yet.</p>
      )}
      <ul className="divide-y rounded-xl border">
        {quickTexts.map((quickText) => (
          <li key={quickText.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {quickText.title}
                {quickText.folder && (
                  <span className="text-muted-foreground font-normal"> · {quickText.folder}</span>
                )}
              </p>
              <p className="text-muted-foreground line-clamp-2 text-sm whitespace-pre-wrap">{quickText.body}</p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    setDraft({
                      id: quickText.id,
                      title: quickText.title,
                      body: quickText.body,
                      folder: quickText.folder ?? "",
                    })
                  }
                >
                  Edit
                </Button>
                <Button variant="ghost" size="sm" disabled={isPending} onClick={() => remove(quickText.id)}>
                  Delete
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit && !draft && (
        <Button variant="primary" size="sm" onClick={() => setDraft(EMPTY)}>
          New Quick Text
        </Button>
      )}

      {draft && (
        <form
          className="space-y-3 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft);
          }}
        >
          <Input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Title, for example Greeting"
            aria-label="Title"
            maxLength={120}
            required
          />
          <Input
            value={draft.folder}
            onChange={(event) => setDraft({ ...draft, folder: event.target.value })}
            placeholder="Folder (optional)"
            aria-label="Folder"
            maxLength={80}
          />
          <textarea
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            placeholder="Hi {{user.name}}, thanks for waiting…"
            aria-label="Body"
            rows={5}
            maxLength={4000}
            required
            className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={isPending || !draft.title.trim() || !draft.body.trim()}
            >
              Save
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
