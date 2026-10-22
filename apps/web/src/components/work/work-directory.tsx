"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Project, TaskLabel, WorkFavorite } from "@agent-hub/core";
import { taskKey } from "@agent-hub/core";
import type { WorkDirectory, WorkPerson } from "@ciele/ops";

/**
 * Who and what every work view names (#1063): the people, the Teammates, the
 * Labels, the Projects the viewer can see and their stars, plus "today" as the
 * server saw it, so a date reads the same on both sides of hydration.
 */

export interface WorkDirectoryValue {
  people: WorkPerson[];
  /** The Teammates the viewer can see, to name one that acted (#1069). */
  teammates: { id: string; name: string }[];
  labels: TaskLabel[];
  projects: Project[];
  favorites: WorkFavorite[];
  today: string;
  viewerId: string;
  canEdit: boolean;
  person(id: string | null | undefined): WorkPerson | null;
  teammate(id: string): { id: string; name: string } | null;
  project(id: string): Project | null;
  label(id: string): TaskLabel | null;
  keyOf(task: { projectId: string; seq: number }): string;
  isFavorite(target: { projectId?: string; taskId?: string }): boolean;
}

const Context = createContext<WorkDirectoryValue | null>(null);

export function WorkDirectoryProvider({
  directory,
  today,
  viewerId,
  canEdit,
  children,
}: {
  directory: WorkDirectory;
  today: string;
  viewerId: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const value = useMemo<WorkDirectoryValue>(() => {
    const people = new Map(directory.people.map((p) => [p.userId, p]));
    const teammates = new Map(directory.teammates.map((t) => [t.id, t]));
    const projects = new Map(directory.projects.map((p) => [p.id, p]));
    const labels = new Map(directory.labels.map((l) => [l.id, l]));
    return {
      ...directory,
      today,
      viewerId,
      canEdit,
      person: (id) => (id ? (people.get(id) ?? null) : null),
      teammate: (id) => teammates.get(id) ?? null,
      project: (id) => projects.get(id) ?? null,
      label: (id) => labels.get(id) ?? null,
      keyOf: (task) => taskKey(projects.get(task.projectId)?.key ?? "TASK", task.seq),
      isFavorite: ({ projectId, taskId }) =>
        directory.favorites.some((f) => (projectId ? f.projectId === projectId : f.taskId === taskId)),
    };
  }, [directory, today, viewerId, canEdit]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkDirectory(): WorkDirectoryValue {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkDirectory needs a WorkDirectoryProvider");
  return value;
}
