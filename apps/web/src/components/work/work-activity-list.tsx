"use client";

import type { WorkActivity } from "@agent-hub/core";
import { RollInText } from "@/components/motion/roll-in-text";
import { agoText } from "@/lib/work/work-format";
import { activityActor, activityExcerpt, activityText, groupActivityByDay, type ActivityNames } from "@/lib/work/activity-text";
import { useWorkDirectory } from "./work-directory";
import { WorkAvatar } from "./work-ui";

/**
 * Work Activity, newest first and grouped by day (#1066), a comment shown by
 * its excerpt and a Teammate's write read as "Teammate for Member" (#1069).
 * The drawer's Activity tab lists one Task's entries, the Project's Activity
 * view and its Overview the Project's, where each line names its Task and
 * opens it.
 */
export function WorkActivityList({
  entries,
  withTask = false,
  onOpenTask,
}: {
  entries: WorkActivity[];
  withTask?: boolean;
  onOpenTask?: (id: string) => void;
}) {
  const dir = useWorkDirectory();
  const names: ActivityNames = {
    person: (id) => dir.person(id)?.name ?? null,
    label: (id) => dir.label(id)?.name ?? null,
    teammate: (id) => dir.teammate(id)?.name ?? null,
    today: dir.today,
  };
  if (!entries.length) return <p className="text-muted-foreground py-2 text-sm">Nothing has happened here yet.</p>;
  return (
    <div className="flex flex-col gap-5">
      {groupActivityByDay(entries, dir.today).map((group) => (
        <section key={group.day} aria-label={group.title}>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold">{group.title}</h3>
          <ol className="flex flex-col gap-2.5">
            {group.entries.map((entry) => {
              const excerpt = activityExcerpt(entry);
              const line = (
                <>
                  <span className="text-foreground font-medium">{activityActor(entry, names)}</span>{" "}
                  <span className="text-muted-foreground">{activityText(entry, names, { withTask })}</span>
                </>
              );
              return (
                <li key={entry.id} className="flex gap-2.5 text-sm">
                  <WorkAvatar person={dir.person(entry.actorMemberId)} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {withTask && entry.taskId && onOpenTask ? (
                      <button type="button" className="press-text text-left" onClick={() => onOpenTask(entry.taskId!)}>
                        {line}
                      </button>
                    ) : (
                      <p>{line}</p>
                    )}
                    {excerpt && (
                      <blockquote className="border-alpha-strong text-muted-foreground mt-1 line-clamp-3 border-l-2 pl-2.5">{excerpt}</blockquote>
                    )}
                  </div>
                  <time dateTime={entry.createdAt} className="text-muted-foreground shrink-0 text-xs">
                    <RollInText text={agoText(entry.createdAt)} />
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
