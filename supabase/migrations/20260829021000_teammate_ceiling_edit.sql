-- No catalogued Teammate action needs publish. Keep the stored vocabulary as
-- narrow as the working product surface.
alter table public.teammates
  drop constraint if exists teammates_capability_ceiling_check;

update public.teammates
set capability_ceiling = 'edit'
where capability_ceiling = 'publish';

alter table public.teammates
  add constraint teammates_capability_ceiling_check
  check (capability_ceiling in ('member', 'edit'));
