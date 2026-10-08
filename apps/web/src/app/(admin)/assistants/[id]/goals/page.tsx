import { notFound } from "next/navigation";
import { ASSISTANT_GOAL_CAP } from "@agent-hub/core";
import { Compass } from "lucide-react";
import { GoalsClient } from "@/components/assistant/goals-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function GoalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  if (!(await getAssistantCached(id))) notFound();
  const goals = await db.table("assistantGoals").list({ assistantId: id });

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        icon={Compass}
        title="Goals"
        description="Failing checks raise an Alert."
      />
      <GoalsClient
        assistantId={id}
        goals={goals}
        cap={ASSISTANT_GOAL_CAP}
        canEdit={canEdit(role)}
      />
    </div>
  );
}
