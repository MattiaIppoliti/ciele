import { z } from "zod";

/**
 * The work domain's two shared input shapes (#1062). One definition each, so
 * every work operation refuses the same malformed value with the same words.
 */

/** A work entity's id: a Project, Task, Label, comment, file or Saved View. */
export const workId = z.string().min(1).max(64);

/** A calendar day, `YYYY-MM-DD`: the form every work date is kept in. */
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
