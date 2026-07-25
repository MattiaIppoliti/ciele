-- Unpublish: admins may take an assistant's widget offline by deleting its
-- Publication snapshots. The widget serves getLatestPublication, so an
-- assistant with no rows is offline until the next publish.

create policy "admins delete publications" on public.publications
  for delete using (exists (
    select 1 from public.assistants a
    where a.id = publications.assistant_id and private.has_org_role(a.organization_id, 3)
  ));
