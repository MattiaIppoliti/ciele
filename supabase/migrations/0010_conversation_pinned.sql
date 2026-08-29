-- Chat history: pinned conversations survive the 10-most-recent display cap.
alter table public.conversations
  add column if not exists pinned boolean not null default false;
