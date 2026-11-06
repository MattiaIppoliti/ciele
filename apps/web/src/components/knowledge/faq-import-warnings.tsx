"use client";
import type { FaqImportDuplicate } from "@agent-hub/core";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
export function FaqImportWarnings({ duplicates }: { duplicates: FaqImportDuplicate[] }) {
  if (!duplicates.length) return null;
  return <div className="space-y-2 rounded-lg border p-3"><p className="font-medium">Likely duplicates</p>{duplicates.map((item,index) => <RollRow key={item.row} index={index}><p className="text-sm"><RollInText text={`Row ${item.row}: ${item.question}${item.rows.length ? ` · also rows ${item.rows.join(", ")}` : ""}${item.existing.length ? ` · existing: ${item.existing.map(match => match.question).join("; ")}` : ""}`} /></p></RollRow>)}</div>;
}
