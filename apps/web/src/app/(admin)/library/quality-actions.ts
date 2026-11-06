"use server";
import { checkFaqDuplicatesOp, listFaqHistoryOp, restoreFaqVersionOp, setDocumentReviewOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
export async function setDocumentReviewAction(input: { sourceId: string; documentId: string; reviewed: boolean; assistantId?: string }) { return runOperation(setDocumentReviewOp, input); }
export async function faqHistoryAction(sourceId: string) { return runOperation(listFaqHistoryOp, { sourceId }); }
export async function restoreFaqVersionAction(sourceId: string, versionId: string) { return runOperation(restoreFaqVersionOp, { sourceId, versionId }); }
export async function checkFaqDuplicatesAction(question: string, collectionId?: string) { return runOperation(checkFaqDuplicatesOp, { question, collectionId }); }
