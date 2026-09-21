-- Whether a published widget accepts file attachments from Visitors.
--
-- Off by default, and the default is the point. The console surfaces (the
-- Preview and a Teammate chat) are used by a signed-in Member, so an upload
-- there is attributable and already rate-limited per account. The widget is a
-- box on somebody else's website that anonymous strangers type into; accepting
-- their files costs parser CPU, a model call for every image, and a malware
-- surface. No Assistant already published should gain that because a column
-- appeared.
--
-- Nothing is retained: the bytes are read once into text and dropped, so this
-- flag governs an intake, not a store. There is no bucket to secure, no object
-- lifetime and no deletion request to answer, which is why this is one boolean
-- rather than a settings group.

alter table public.assistants
  add column if not exists attachments_enabled boolean not null default false;
