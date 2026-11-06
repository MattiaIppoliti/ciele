"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { FaqDuplicate } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { checkFaqDuplicatesAction } from "@/app/(admin)/library/quality-actions";

export function FaqDuplicateCheck({ question, collectionId }: { question: string; collectionId?: string }) {
  const [checked, setChecked] = useState<{ question: string; items: FaqDuplicate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cache = useRef(new Map<string, FaqDuplicate[]>());
  const text = question.trim();
  const cacheKey = `${collectionId ?? "org"}:${text}`;
  const result = checked?.question === cacheKey ? checked : null;
  return <section className="space-y-2 rounded-lg border p-3">
    <Button variant="outline" size="sm" disabled={!text || pending} onClick={() => startTransition(async () => {
      setError(null);
      try {
        const items = cache.current.get(cacheKey) ?? await checkFaqDuplicatesAction(text, collectionId);
        cache.current.set(cacheKey, items); setChecked({ question: cacheKey, items });
      } catch { setError("Duplicate check is unavailable. You can still save this FAQ."); }
    })}><RollInText text={pending ? "Checking…" : "Check for similar FAQs"} /></Button>
    {error && <p role="status" className="text-muted-foreground text-sm">{error}</p>}
    {result && result.items.length === 0 && <p className="text-muted-foreground text-sm">No likely duplicate found. You can still save.</p>}
    {result?.items.map((item, index) => <RollRow key={item.sourceId} index={index}><div className="space-y-1 rounded-md border p-2">
      <p className="text-sm font-medium"><RollInText text={item.question} /></p>
      <p className="line-clamp-2 text-muted-foreground text-sm">{item.answerPreview}</p>
      <Link href={`/library/faqs/${item.sourceId}/${item.documentId}?edit=faq`} target="_blank" rel="noreferrer" className="text-primary text-sm hover:underline">Edit this FAQ in a new tab</Link>
    </div></RollRow>)}
    <p className="text-muted-foreground text-xs">This check warns about similar questions in the same Collection. It never blocks saving.</p>
  </section>;
}
