"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@agent-hub/ui";
import { FaqDialog } from "./knowledge-hub-dialogs";

/** Duplicate-warning links can open this editor without losing the new FAQ draft. */
export function DocumentFaqEditor({ sourceId, question, answer }: { sourceId: string; question: string; answer: string }) {
  const search = useSearchParams();
  const [open, setOpen] = useState(search.get("edit") === "faq");
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Edit FAQ</Button>
    <FaqDialog key={sourceId + String(open)} open={open} editing={{ id: sourceId, name: question, answerPreview: answer.slice(0, 200) }} assistants={[]} onClose={() => setOpen(false)} />
  </>;
}
