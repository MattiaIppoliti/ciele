# Improvement and Task are two entities joined by a link

## Status

Accepted, 2026-10-08. Decided in #1044 (map #1039); the three shapes were costed in #1043.

## Context

Work management gives the Organization a Task. An Improvement already looks like one: status,
priority, tags, assignee, due date, an optional Project and a kanban board. A reader will expect a
single table.

Only an Improvement has these: evidence (links to flagged assistant messages, counted as
occurrences); at most one Suggested Fix, whose accept writes a FAQ into Knowledge; nine producers
that dedup into an *open* item, open meaning neither done nor archived; Archived as a fifth lane
rather than a flag; the per-Organization `IMP-n` key from a guarded counter; Editor-only writes,
with most rows created by the service role and no author; and a Project delete that detaches it
instead of deleting it, because it is the record of what was wrong.

## Decision

An Improvement is a problem record and a Task is work. They stay two tables, and a Task may name
the Improvement it resolves.

1. **The link** is a nullable `tasks.improvement_id`, `on delete set null`, with a composite
   foreign key that keeps both rows in one Organization. A Task resolves at most one Improvement;
   an Improvement can have many Tasks. A Task that would fix two Improvements means the dedup
   missed a duplicate, and the answer is to archive the duplicate.
2. **Linking is a Task write.** It needs permission to write the Task, not the Editor rank on
   Improvements. The link is made from a **Create task** button on the Improvement detail (title
   and Project prefilled, link set) or from a **Resolves** field on the Task. The Improvement detail
   lists its Tasks.
3. **When every linked Task is Done**, an Improvement in To do or In Progress moves to In Review.
   It is the same move as accepting a Suggested Fix: finished work does not prove the answer is now
   right, so a person closes it. Reopening a Task does not move it back. In Review still counts as
   open, so a recurrence during review attaches to the same item, which is the evidence that the
   fix did not hold. The move runs on the system Db, so a Member who may complete a Task but not
   edit Improvements still triggers it, and it is recorded as caused by the Task. The rule is a
   pure function in `core`.
4. **An Improvement gains no Task features**: no subtasks, dependencies, attachments, start date,
   recurrence or estimate. Work that needs them belongs on a linked Task.
5. **The personal views** (My Tasks, the calendar, Home) list an Improvement assigned to the viewer
   as its own row, with its `IMP-n` key and its own status icon, opening `/improvements/{id}`.
6. **Nothing that ships changes**: the Improvements board, `IMP-n`, the producers and their dedup,
   the Suggested Fix, `/api/v1/improvements`, `ciele improvements`, MCP `manage_improvements`, the
   `improvements` grant domain, the `draft_improvement_proposal` job kind and the
   `improvement_proposal` usage stage. An Improvement's assignee stays a Member.

## Considered options

- **One table with a `kind` column** (about 900 to 1,300 lines). Every Improvement read, RLS
  policy and Teammate grant check gains a `kind` predicate, and one missed predicate leaks Tasks
  onto the board or lets a `tasks` grant move Improvements. One `project_id` cannot carry two
  delete rules, so it needs a trigger, and Improvements would inherit Teammate assignees. Keeping
  the table name `improvements` makes it one PR with a misleading name; renaming it makes it three
  or four.
- **A Task row extended 1:1 by an Improvement side table** (about 1,500 to 2,100 lines, three PRs).
  Every row is copied and every Improvement read becomes a join. The status mapping loses data:
  `backlog` and `urgent` have no Improvement value, and the status before archiving was never
  stored. Two notifiers fire on one assignment until one is retired.

The link (about 600 to 900 lines, one PR) pays instead with a union read in the personal views and
two status vocabularies on one screen. A merge would have been right only if an Improvement needed
the Task's features, and it does not.

## Consequences

- The personal views read two sources. They need an Improvement read by assignee and due-date
  range, which the `Db` lacks today, and an index to match (only `assignee_id` is indexed).
  Since #1076 the assignee half exists, `listImprovementsAssignedTo` over
  `improvements_org_assignee_idx`. The due-date range waits for a view that asks for one.
- Each table keeps its own Project foreign key and delete rule. Whatever deleting a Project does to
  its Tasks, its Improvements still detach.
- A Teammate is never an Improvement's assignee. To have a Teammate carry out a fix, create a
  linked Task and assign the Teammate to it, once Tasks take Teammate assignees.
