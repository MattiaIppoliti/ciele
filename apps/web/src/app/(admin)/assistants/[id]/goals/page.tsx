import { notFound } from "next/navigation";
import { ASSISTANT_GOAL_CAP } from "@agent-hub/core";
import { GoalsClient } from "@/components/assistant/goals-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function GoalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  if (!(await getAssistantCached(id))) notFound();
  const goals = await db.listAssistantGoals(id);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Goals</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Standing golden questions, re-verified on a schedule. A goal that stops
        passing raises an Alert — nothing that worked once goes unwatched.
      </p>
      <GoalsClient
        assistantId={id}
        goals={goals}
        cap={ASSISTANT_GOAL_CAP}
        canEdit={canEdit(role)}
      />
    </div>
  );
}
