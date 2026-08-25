-- An Improvement can belong to a Project (#771).
--
-- Nullable and `set null`, exactly like `teammates.project_id`: most
-- Improvements are org-wide work that belongs to no project, and deleting a
-- Project must detach its Improvements rather than delete the record of what
-- was wrong. Archiving a Project leaves the link alone; the decisions stop
-- reaching a prompt, the Improvement is still an Improvement.

alter table public.improvements
  add column project_id text references public.projects (id) on delete set null;

-- Filtering the board by project is the read this column exists for, and it is
-- always org-scoped first, so the index leads with the organization.
create index improvements_project_idx
  on public.improvements (organization_id, project_id)
  where project_id is not null;
