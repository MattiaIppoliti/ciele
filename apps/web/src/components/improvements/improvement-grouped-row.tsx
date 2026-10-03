"use client";

import { motion, useReducedMotion } from "motion/react";
import { GitPullRequest, MessageSquare } from "lucide-react";
import type { ImprovementListItem, ImprovementStatus } from "@agent-hub/core";
import { UserAvatar } from "@/components/ui/user-avatar";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { formatDay } from "@/lib/format";
import { memberDisplayName } from "@/lib/members";
import {
  improvementKey,
  improvementKeyClass,
  priorityMeta,
} from "@/lib/improvements";

export const GROUPED_TABLE_SPRING = {
  type: "spring",
  stiffness: 420,
  damping: 28,
  mass: 0.8,
} as const;

/** Stable elements change their grid positions, rather than fading between copies. */
export function ImprovementGroupedRow({
  item,
  status,
  email,
  width,
}: {
  item: ImprovementListItem;
  status: ImprovementStatus;
  email: string | null;
  width: number;
}) {
  const reduce = useReducedMotion();
  const columns = width >= 768;
  const expanded = width >= 896;
  const transition = reduce ? { duration: 0 } : GROUPED_TABLE_SPRING;
  const priority = priorityMeta(item.priority);
  const date = item.dueDate ?? item.createdAt;
  const animate = {
    layout: reduce ? false : ("position" as const),
    layoutDependency: width,
    transition,
  };

  return (
    <span
      data-slot="improvement-grouped-row"
      data-layout={expanded ? "expanded" : columns ? "columns" : "inline"}
      className={`grid min-w-max items-center gap-x-3 px-5 text-sm leading-5 ${expanded ? "grid-cols-[1rem_minmax(12rem,1fr)_6rem_7.5rem_3.5rem_5rem_1.5rem]" : columns ? "grid-cols-[1rem_minmax(12rem,1fr)_6rem_3.5rem_5rem_1.5rem]" : "grid-cols-[minmax(max-content,1fr)_auto_1.5rem] gap-x-[clamp(0.75rem,calc(4.6cqi_-_0.45rem),1.75rem)]"}`}
    >
      {columns && (
        <motion.span
          {...animate}
          data-field="priority"
          className="text-muted-foreground flex justify-center"
          title={`${priority.label} priority`}
        >
          <priority.icon
            className={`size-3.5 ${priority.iconColor}`}
            aria-hidden="true"
          />
        </motion.span>
      )}
      <span
        className={
          columns
            ? "contents"
            : "flex items-center gap-x-[clamp(0.5rem,calc(4.6cqi_-_0.7rem),1.5rem)] whitespace-nowrap"
        }
      >
        <motion.span
          {...animate}
          data-field="title"
          title={item.title}
          className={`py-3 ${columns ? "min-w-0 truncate" : "shrink-0"}`}
        >
          <RollInText text={item.title} truncate={columns} />
        </motion.span>
        <motion.span
          {...animate}
          data-field="key"
          title={improvementKey(item.seq)}
          className={`inline-flex h-6 shrink-0 items-center gap-1.5 justify-self-start rounded-full border px-2 text-xs ${improvementKeyClass(status)}`}
        >
          <GitPullRequest className="size-3.5" aria-hidden="true" />
          <RollInText text={improvementKey(item.seq)} />
        </motion.span>
        {expanded && (
          <motion.span
            {...animate}
            data-field="tags"
            className="inline-flex min-w-0 items-center gap-1 overflow-hidden"
            title={item.tags.join(", ")}
          >
            <span className={`text-muted-foreground truncate text-xs ${item.tags.length ? "rounded-full border px-2 py-0.5" : ""}`}>
              <RollInText text={item.tags.length ? item.tags.join(", ") : "No tags"} />
            </span>
          </motion.span>
        )}
        <motion.span
          {...animate}
          data-field="activity"
          className="text-muted-foreground inline-flex shrink-0 items-center gap-2 text-xs"
          title={`${item.messageCount} linked messages · ${priority.label} priority`}
        >
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            <RollingNumber value={item.messageCount} />
          </span>
          {!columns && item.priority !== "none" && (
            <priority.icon
              className={`size-3.5 ${priority.iconColor}`}
              aria-hidden="true"
            />
          )}
          <span className="sr-only">
            linked messages, {priority.label} priority
            {!expanded && item.tags.length
              ? `, tags: ${item.tags.join(", ")}`
              : ""}
          </span>
        </motion.span>
      </span>
      <motion.span
        {...animate}
        data-field="date"
        className="text-muted-foreground whitespace-nowrap py-3 text-xs"
        title={`${item.dueDate ? "Due" : "Created"} ${formatDay(date)}`}
      >
        <span className="sr-only">{item.dueDate ? "Due" : "Created"} </span>
        <RollInText text={formatDay(date)} />
      </motion.span>
      <motion.span
        {...animate}
        data-field="assignee"
        className="flex justify-end py-3"
        title={email ? memberDisplayName(email) : "Unassigned"}
      >
        <span className="sr-only">
          Assigned to {email ? memberDisplayName(email) : "nobody"}
        </span>
        <UserAvatar userId={item.assigneeId} email={email} size="size-6" />
      </motion.span>
    </span>
  );
}
