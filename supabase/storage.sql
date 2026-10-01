-- The paperwork on a sale: photos and scans the app keeps with each sold
-- customer (Home → Sold). One private bucket; every file sits under the
-- account's own folder (<user id>/<sale id>/<file>), and the policy lets a
-- signed-in user read, write and delete only inside their own folder.
--
-- Run once in the SQL Editor, like schema.sql. Safe to run again.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "docs: own folder" on storage.objects;
create policy "docs: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
